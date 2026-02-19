/**
 * Authentication commands for Solid CLI
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';

export const authCommand = new Command('auth')
  .description('Authentication management');

// Login command
authCommand
  .command('login')
  .description('Login to Solid#')
  .option('-e, --email <email>', 'Email address')
  .option('-p, --password <password>', 'Password (not recommended for security)')
  .action(async (options) => {
    try {
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

        spinner.succeed(chalk.green('Login successful!'));
        console.log(chalk.dim(`  Logged in as: ${response.data.user.email}`));
        console.log(chalk.dim(`  Company ID: ${response.data.user.company_id}`));
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
