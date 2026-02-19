/**
 * Authentication commands for Solid CLI
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';

export const authCommand = new Command('auth')
  .description('Authentication management');

// Login command
authCommand
  .command('login')
  .description('Login to Solid#')
  .option('-e, --email <email>', 'Email address')
  .option('-p, --password <password>', 'Password (not recommended for security)')
  .option('-t, --token <token>', 'Login with API key (sk_solid_...)')
  .action(async (options) => {
    try {
      // API key login (for scripts/CI)
      if (options.token) {
        config.accessToken = options.token;
        // Verify the key works
        const spinner = ora('Verifying API key...').start();
        try {
          const status = await apiClient.authStatus();
          if (status.data.authenticated && status.data.user) {
            config.userId = status.data.user.id;
            config.userEmail = status.data.user.email;
            config.companyId = status.data.user.company_id;
            spinner.succeed(chalk.green('Authenticated via API key'));
            console.log(chalk.dim(`  Company ID: ${status.data.user.company_id}`));
          } else {
            spinner.fail(chalk.red('Invalid API key'));
            config.accessToken = undefined;
            process.exit(1);
          }
        } catch {
          spinner.fail(chalk.red('Invalid API key'));
          config.accessToken = undefined;
          process.exit(1);
        }
        return;
      }

      let email = options.email;
      let password = options.password;

      // Prompt for credentials if not provided
      if (!email || !password) {
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'email',
            message: 'Email:',
            when: !email,
            validate: (input) => input.includes('@') || 'Please enter a valid email',
          },
          {
            type: 'password',
            name: 'password',
            message: 'Password:',
            when: !password,
            mask: '*',
          },
        ]);
        email = email || answers.email;
        password = password || answers.password;
      }

      const spinner = ora('Logging in...').start();

      try {
        const response = await apiClient.login(email, password);

        // Store credentials
        config.accessToken = response.data.access_token;
        config.refreshToken = response.data.refresh_token;
        config.tokenExpiresAt = new Date(response.data.expires_at);
        config.userId = response.data.user.id;
        config.userEmail = response.data.user.email;
        config.companyId = response.data.user.company_id;

        spinner.succeed(chalk.green('Authenticated'));

        // Check for multi-company access
        try {
          const companiesResponse = await apiClient.companiesList();
          const { companies } = companiesResponse.data;

          if (companies.length > 1) {
            // Cache company list
            config.companies = companies.map((c: { id: number; name: string; role: string }) => ({
              id: c.id,
              name: c.name,
              role: c.role,
            }));

            console.log('');
            console.log(chalk.bold(`  ${companies.length} companies available:`));
            console.log('');

            // Show picker
            const choices = companies.map((c: { id: number; name: string; role: string }) => ({
              name: c.id === response.data.user.company_id
                ? chalk.green(`${c.name} (ID: ${c.id}) — ${c.role} [default]`)
                : `${c.name} (ID: ${c.id}) — ${c.role}`,
              value: c.id,
            }));

            const answer = await inquirer.prompt([{
              type: 'list',
              name: 'companyId',
              message: 'Select company:',
              choices,
              default: response.data.user.company_id,
            }]);

            // Switch if different from default
            if (answer.companyId !== response.data.user.company_id) {
              const switchSpinner = ora('Switching...').start();
              const switchResponse = await apiClient.companySwitch(answer.companyId);
              config.accessToken = switchResponse.data.access_token;
              config.refreshToken = switchResponse.data.refresh_token;
              config.companyId = switchResponse.data.company.id;
              const expiresAt = new Date(Date.now() + switchResponse.data.expires_in * 1000);
              config.tokenExpiresAt = expiresAt;
              switchSpinner.succeed(chalk.green(`Switched to ${switchResponse.data.company.name}`));
            }

            console.log('');
            console.log(chalk.dim('  Switch later: solid switch'));
          } else {
            console.log('');
            console.log(ui.welcomeBox(
              response.data.user.email,
              config.companyId!,
            ));
          }
        } catch {
          // Company list failed — single-company user, show normal welcome
          console.log('');
          console.log(ui.welcomeBox(
            response.data.user.email,
            response.data.user.company_id,
          ));
        }

        console.log('');
      } catch (error) {
        spinner.fail(chalk.red('Login failed'));
        const apiError = handleApiError(error);
        console.error(chalk.red(`  ${apiError.message}`));
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// Logout command
authCommand
  .command('logout')
  .description('Logout from Solid#')
  .action(() => {
    config.logout();
    console.log(chalk.green('Logged out successfully'));
  });

// Status command
authCommand
  .command('status')
  .description('Check authentication status')
  .action(async () => {
    const spinner = ora('Checking authentication...').start();

    if (!config.isLoggedIn()) {
      spinner.fail(chalk.yellow('Not logged in'));
      console.log(chalk.dim('  Run `solid auth login` to authenticate'));
      return;
    }

    try {
      const response = await apiClient.authStatus();

      if (response.data.authenticated && response.data.user) {
        spinner.succeed(chalk.green('Authenticated'));
        console.log(chalk.dim(`  Email: ${response.data.user.email}`));
        console.log(chalk.dim(`  Company ID: ${response.data.user.company_id}`));
        console.log(chalk.dim(`  Environment: ${config.environment}`));
        console.log(chalk.dim(`  API URL: ${config.apiUrl}`));
      } else {
        spinner.fail(chalk.yellow('Session expired'));
        console.log(chalk.dim('  Run `solid auth login` to re-authenticate'));
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to check status'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Token management (API keys for CI/CD, LLM agents, scripts)
const tokenCommand = authCommand
  .command('token')
  .description('Manage API keys for CI/CD and automation');

tokenCommand
  .command('create')
  .description('Create a new API key')
  .requiredOption('-n, --name <name>', 'Key name (e.g., "CI Pipeline")')
  .option('-s, --scopes <scopes>', 'Comma-separated scopes', 'kb:read,pages:read')
  .option('-e, --expires <days>', 'Expiration in days (default: no expiry)')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const scopes = options.scopes.split(',').map((s: string) => s.trim());
    const expiresInDays = options.expires ? parseInt(options.expires, 10) : undefined;

    const spinner = ora('Creating API key...').start();

    try {
      const response = await apiClient.apiKeyCreate(options.name, scopes, expiresInDays);
      spinner.succeed(chalk.green('API key created'));

      console.log('');
      console.log(chalk.bold('  Your API Key:'));
      console.log('');
      console.log(`  ${chalk.green(response.data.key)}`);
      console.log('');
      console.log(chalk.yellow('  ⚠ Store this key securely. It will not be shown again.'));
      console.log('');
      console.log(chalk.dim('  Usage:'));
      console.log(chalk.dim(`    SOLID_API_KEY=${response.data.key} solid status`));
      console.log(chalk.dim(`    solid auth login --token ${response.data.key}`));
      console.log('');
      console.log(chalk.dim(`  Scopes: ${scopes.join(', ')}`));
      if (expiresInDays) {
        console.log(chalk.dim(`  Expires: ${expiresInDays} days`));
      }
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red('Failed to create API key'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

tokenCommand
  .command('list')
  .description('List API keys')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const spinner = ora('Loading API keys...').start();

    try {
      const response = await apiClient.apiKeyList();
      spinner.stop();

      if (options.json) {
        console.log(JSON.stringify(response.data, null, 2));
        return;
      }

      const { api_keys } = response.data;

      if (api_keys.length === 0) {
        console.log(chalk.dim('  No API keys found. Create one with: solid auth token create -n "My Key"'));
        return;
      }

      console.log('');
      console.log(chalk.bold(`  API Keys (${api_keys.length})`));
      console.log('');

      const headers = ['ID', 'Name', 'Prefix', 'Scopes', 'Active', 'Last Used'];
      const rows = api_keys.map((k: { id: number; name: string; key_prefix: string; scopes: string[]; is_active: boolean; last_used_at?: string }) => [
        String(k.id),
        k.name,
        chalk.dim(k.key_prefix),
        k.scopes.join(', '),
        k.is_active ? chalk.green('●') : chalk.red('○'),
        k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : chalk.dim('never'),
      ]);

      console.log(ui.table(headers, rows));
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red('Failed to list API keys'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

tokenCommand
  .command('revoke <id>')
  .description('Revoke an API key')
  .action(async (id: string) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const keyId = parseInt(id, 10);
    if (isNaN(keyId)) {
      console.error(chalk.red('Invalid key ID.'));
      process.exit(1);
    }

    const spinner = ora('Revoking API key...').start();

    try {
      await apiClient.apiKeyRevoke(keyId);
      spinner.succeed(chalk.green(`API key ${keyId} revoked`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to revoke API key'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Config command
authCommand
  .command('config')
  .description('View or update configuration')
  .option('--api-url <url>', 'Set API URL')
  .option('--environment <env>', 'Set environment (production, sandbox, development)')
  .option('--show', 'Show current configuration')
  .action((options) => {
    if (options.apiUrl) {
      config.apiUrl = options.apiUrl;
      console.log(chalk.green(`API URL set to: ${options.apiUrl}`));
    }

    if (options.environment) {
      if (!['production', 'sandbox', 'development'].includes(options.environment)) {
        console.error(chalk.red('Invalid environment. Use: production, sandbox, or development'));
        process.exit(1);
      }
      config.environment = options.environment as 'production' | 'sandbox' | 'development';
      console.log(chalk.green(`Environment set to: ${options.environment}`));
    }

    if (options.show || (!options.apiUrl && !options.environment)) {
      console.log(chalk.bold('\nCurrent Configuration:'));
      console.log(chalk.dim('  API URL:'), config.apiUrl);
      console.log(chalk.dim('  Environment:'), config.environment);
      console.log(chalk.dim('  Company ID:'), config.companyId || 'Not set');
      console.log(chalk.dim('  User:'), config.userEmail || 'Not logged in');
    }
  });
