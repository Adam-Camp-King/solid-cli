/**
 * Integration management commands for Solid CLI
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';

export const integrationsCommand = new Command('integrations')
  .alias('int')
  .description('Integration management');

// Ensure logged in
function requireAuth(): void {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
}

// List integrations
integrationsCommand
  .command('list')
  .alias('ls')
  .description('List integrations')
  .option('-s, --status <status>', 'Filter by status (draft, deployed, disabled, etc.)')
  .action(async (options) => {
    requireAuth();

    const spinner = ora('Fetching integrations...').start();

    try {
      const response = await apiClient.integrationsList(options.status);

      spinner.succeed(`Found ${response.data.total} integrations`);
      console.log('');

      if (response.data.integrations.length === 0) {
        console.log(chalk.dim('  No integrations found. Create one with `solid integrations create`'));
        return;
      }

      // Table header
      console.log(
        chalk.bold('  ID'.padEnd(12)) +
        chalk.bold('NAME'.padEnd(30)) +
        chalk.bold('TYPE'.padEnd(18)) +
        chalk.bold('STATUS'.padEnd(12))
      );
      console.log(chalk.dim('  ' + '-'.repeat(70)));

      // Table rows
      for (const int of response.data.integrations) {
        const statusColor = int.status === 'deployed' ? chalk.green :
          int.status === 'validated' ? chalk.blue :
          int.status === 'failed' ? chalk.red :
          chalk.dim;

        console.log(
          `  ${int.id.slice(0, 10).padEnd(12)}` +
          `${int.name.slice(0, 28).padEnd(30)}` +
          `${int.integration_type.padEnd(18)}` +
          statusColor(int.status)
        );
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to list integrations'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Get catalog
integrationsCommand
  .command('catalog')
  .description('Show integration capabilities catalog')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireAuth();

    const spinner = ora('Fetching catalog...').start();

    try {
      const response = await apiClient.integrationsCatalog();

      spinner.succeed('Catalog retrieved');

      if (options.json) {
        console.log(JSON.stringify(response.data, null, 2));
        return;
      }

      console.log('');
      console.log(chalk.bold('Internal APIs:'));
      const apis = response.data.internal_apis as Record<string, { endpoints: Array<{ method: string; path: string; description: string }> }>;
      for (const [category, data] of Object.entries(apis)) {
        console.log(chalk.cyan(`  ${category}:`));
        if (data.endpoints) {
          for (const ep of data.endpoints.slice(0, 3)) {
            console.log(chalk.dim(`    ${ep.method} ${ep.path}`));
          }
          if (data.endpoints.length > 3) {
            console.log(chalk.dim(`    ... and ${data.endpoints.length - 3} more`));
          }
        }
      }

      console.log('');
      console.log(chalk.bold('External Integrations:'));
      const external = response.data.external_integrations as Record<string, { status: string; capabilities: string[] }>;
      for (const [name, data] of Object.entries(external)) {
        const statusIcon = data.status === 'connected' ? chalk.green('✓') : chalk.dim('○');
        console.log(`  ${statusIcon} ${name}: ${data.capabilities?.join(', ') || 'N/A'}`);
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to fetch catalog'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Check health
integrationsCommand
  .command('health')
  .description('Check integration system health')
  .action(async () => {
    requireAuth();

    const spinner = ora('Checking health...').start();

    try {
      const response = await apiClient.integrationsHealth();

      if (response.data.healthy) {
        spinner.succeed(chalk.green('System healthy'));
      } else if (response.data.can_proceed) {
        spinner.warn(chalk.yellow('System degraded but operational'));
      } else {
        spinner.fail(chalk.red('System unhealthy'));
      }

      console.log('');
      for (const [name, check] of Object.entries(response.data.checks)) {
        const icon = check.status === 'healthy' ? chalk.green('✓') :
          check.status === 'degraded' ? chalk.yellow('!') :
          chalk.red('✗');
        console.log(`  ${icon} ${name}: ${check.message}`);
      }

      if (response.data.warnings.length > 0) {
        console.log('');
        console.log(chalk.yellow('Warnings:'));
        for (const warning of response.data.warnings) {
          console.log(chalk.dim(`  • ${warning}`));
        }
      }
    } catch (error) {
      spinner.fail(chalk.red('Health check failed'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Create integration
integrationsCommand
  .command('create <name>')
  .description('Create a new integration')
  .option('-t, --type <type>', 'Integration type (api_call, mcp_tool_call, external_sync, data_fetch)')
  .option('-d, --description <desc>', 'Description')
  .option('--endpoint <endpoint>', 'API endpoint (for api_call/data_fetch)')
  .option('--method <method>', 'HTTP method (GET, POST, PUT)')
  .option('--provider <provider>', 'External provider (for external_sync)')
  .option('--tool <tool>', 'MCP tool name (for mcp_tool_call)')
  .action(async (name, options) => {
    requireAuth();

    let integrationType = options.type;
    let description = options.description;

    // Interactive prompts if not provided
    if (!integrationType || !description) {
      const answers = await inquirer.prompt([
        {
          type: 'list',
          name: 'type',
          message: 'Integration type:',
          choices: [
            { name: 'API Call - Call internal Solid# APIs', value: 'api_call' },
            { name: 'MCP Tool - Use MCP tools', value: 'mcp_tool_call' },
            { name: 'External Sync - Sync with external services', value: 'external_sync' },
            { name: 'Data Fetch - Read-only data retrieval', value: 'data_fetch' },
          ],
          when: !integrationType,
        },
        {
          type: 'input',
          name: 'description',
          message: 'Description:',
          when: !description,
          validate: (input) => input.length >= 10 || 'Description must be at least 10 characters',
        },
      ]);
      integrationType = integrationType || answers.type;
      description = description || answers.description;
    }

    const spinner = ora('Creating integration...').start();

    try {
      const response = await apiClient.integrationsGenerate({
        name,
        description,
        integration_type: integrationType,
        method: options.method,
        endpoint: options.endpoint,
        provider: options.provider,
        tool_name: options.tool,
      });

      spinner.succeed(chalk.green('Integration created'));
      console.log('');
      console.log(chalk.dim('  ID:'), response.data.integration.id);
      console.log(chalk.dim('  Status:'), response.data.integration.status);
      console.log('');
      console.log(chalk.bold('Code Preview:'));
      console.log(chalk.dim(response.data.code_preview));
      console.log('');
      console.log(chalk.dim(`Next: Run \`solid integrations validate ${response.data.integration.id.slice(0, 8)}\``));
    } catch (error) {
      spinner.fail(chalk.red('Failed to create integration'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Validate integration
integrationsCommand
  .command('validate <id>')
  .description('Validate an integration for security')
  .action(async (id) => {
    requireAuth();

    const spinner = ora('Validating...').start();

    try {
      const response = await apiClient.integrationsValidate(id);

      if (response.data.valid) {
        spinner.succeed(chalk.green('Validation passed'));
        console.log(chalk.dim(`  Next: Run \`solid integrations test ${id.slice(0, 8)}\``));
      } else {
        spinner.fail(chalk.red(`Validation failed (${response.data.blocking_issues_count} blocking issues)`));
        console.log('');
        for (const issue of response.data.issues) {
          const icon = issue.severity === 'critical' ? chalk.red('✗') :
            issue.severity === 'high' ? chalk.red('!') :
            issue.severity === 'medium' ? chalk.yellow('!') :
            chalk.dim('•');
          console.log(`  ${icon} [${issue.severity}] ${issue.message}`);
        }
      }
    } catch (error) {
      spinner.fail(chalk.red('Validation failed'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Test integration
integrationsCommand
  .command('test <id>')
  .description('Test an integration in sandbox')
  .action(async (id) => {
    requireAuth();

    const spinner = ora('Testing in sandbox...').start();

    try {
      const response = await apiClient.integrationsTest(id);

      if (response.data.success) {
        spinner.succeed(chalk.green('Test passed'));
        console.log(chalk.dim(`  ${response.data.message}`));
        console.log(chalk.dim(`  Next: Run \`solid integrations deploy ${id.slice(0, 8)}\``));
      } else {
        spinner.fail(chalk.red('Test failed'));
        console.log(chalk.red(`  ${response.data.message}`));
      }
    } catch (error) {
      spinner.fail(chalk.red('Test failed'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Deploy integration
integrationsCommand
  .command('deploy <id>')
  .description('Deploy an integration to production')
  .option('-y, --yes', 'Skip confirmation')
  .action(async (id, options) => {
    requireAuth();

    if (!options.yes) {
      const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: `Deploy integration ${id.slice(0, 8)} to production?`,
        default: false,
      }]);
      if (!confirm) {
        console.log(chalk.dim('Deployment cancelled'));
        return;
      }
    }

    const spinner = ora('Deploying...').start();

    try {
      const response = await apiClient.integrationsDeploy(id);

      spinner.succeed(chalk.green('Deployed successfully'));
      console.log(chalk.dim(`  Deployed at: ${response.data.deployed_at}`));
    } catch (error) {
      spinner.fail(chalk.red('Deployment failed'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Disable integration
integrationsCommand
  .command('disable <id>')
  .description('Disable an integration')
  .option('-r, --reason <reason>', 'Reason for disabling')
  .action(async (id, options) => {
    requireAuth();

    const spinner = ora('Disabling...').start();

    try {
      const response = await apiClient.integrationsDisable(id, options.reason);

      spinner.succeed(chalk.green('Integration disabled'));
    } catch (error) {
      spinner.fail(chalk.red('Failed to disable'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Rollback integration
integrationsCommand
  .command('rollback <id>')
  .description('Rollback a deployed integration')
  .option('-r, --reason <reason>', 'Reason for rollback')
  .option('-y, --yes', 'Skip confirmation')
  .action(async (id, options) => {
    requireAuth();

    if (!options.yes) {
      const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: `Rollback integration ${id.slice(0, 8)} from production?`,
        default: false,
      }]);
      if (!confirm) {
        console.log(chalk.dim('Rollback cancelled'));
        return;
      }
    }

    const spinner = ora('Rolling back...').start();

    try {
      const response = await apiClient.integrationsRollback(id, options.reason);

      spinner.succeed(chalk.green('Rollback complete'));
    } catch (error) {
      spinner.fail(chalk.red('Rollback failed'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// View logs
integrationsCommand
  .command('logs <id>')
  .description('View integration logs')
  .option('-n, --lines <number>', 'Number of log entries', '20')
  .action(async (id, options) => {
    requireAuth();

    const spinner = ora('Fetching logs...').start();

    try {
      const response = await apiClient.integrationsLogs(id, parseInt(options.lines));

      spinner.succeed(`${response.data.total} log entries`);
      console.log('');

      if (response.data.logs.length === 0) {
        console.log(chalk.dim('  No logs found'));
        return;
      }

      for (const log of response.data.logs) {
        const icon = log.success ? chalk.green('✓') : chalk.red('✗');
        const time = new Date(log.created_at).toLocaleString();
        console.log(`  ${icon} [${time}] ${log.action}`);
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to fetch logs'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });
