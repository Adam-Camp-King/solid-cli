/**
 * Health check commands for Solid CLI
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';

export const healthCommand = new Command('health')
  .description('Health check commands')
  .option('--full', 'Run full 6-layer health check')
  .option('--mcp', 'Check MCP status only')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const spinner = ora('Checking health...').start();

    try {
      if (options.mcp) {
        // MCP health check
        const response = await apiClient.healthMcp();

        if (options.json) {
          spinner.stop();
          console.log(JSON.stringify(response.data, null, 2));
          return;
        }

        if (response.data.status === 'healthy') {
          spinner.succeed(chalk.green('MCP healthy'));
        } else {
          spinner.warn(chalk.yellow('MCP not healthy'));
        }

        console.log(chalk.dim(`  MCP Enabled: ${response.data.mcp_enabled}`));
        console.log(chalk.dim(`  Total Agents: ${response.data.agents?.total_agents || 0}`));

      } else if (options.full) {
        // Full health check
        const response = await apiClient.healthFull();

        if (options.json) {
          spinner.stop();
          console.log(JSON.stringify(response.data, null, 2));
          return;
        }

        const summary = response.data.summary;
        const allHealthy = summary.healthy_layers === summary.total_layers;

        if (allHealthy) {
          spinner.succeed(chalk.green(`All ${summary.total_layers} layers healthy`));
        } else {
          spinner.warn(chalk.yellow(`${summary.healthy_layers}/${summary.total_layers} layers healthy`));
        }

        console.log('');
        console.log(chalk.bold('Layers:'));

        const layers = response.data.layers as Record<string, { status: string }>;
        for (const [name, data] of Object.entries(layers)) {
          const icon = data.status === 'healthy' ? chalk.green('✓') :
            data.status === 'degraded' ? chalk.yellow('!') :
            chalk.red('✗');
          const displayName = name.replace('layer_', '').replace(/_/g, ' ');
          console.log(`  ${icon} ${displayName}`);
        }

      } else {
        // Quick health check
        const response = await apiClient.healthQuick();

        if (options.json) {
          spinner.stop();
          console.log(JSON.stringify(response.data, null, 2));
          return;
        }

        if (response.data.status === 'healthy') {
          spinner.succeed(chalk.green('System healthy'));
        } else {
          spinner.warn(chalk.yellow(`Status: ${response.data.status}`));
        }

        console.log(chalk.dim(`  Timestamp: ${response.data.timestamp}`));
      }
    } catch (error) {
      spinner.fail(chalk.red('Health check failed'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));

      // Try to give more context
      if (apiError.status === 0 || apiError.message.includes('ECONNREFUSED')) {
        console.log(chalk.dim('  Tip: Check if the API server is running'));
        console.log(chalk.dim(`  API URL: ${config.apiUrl}`));
      }
    }
  });

// Subcommands for convenience
healthCommand
  .command('quick')
  .description('Quick health check')
  .action(() => {
    healthCommand.parseAsync(['node', 'health']);
  });

healthCommand
  .command('full')
  .description('Full 6-layer health check')
  .action(() => {
    healthCommand.parseAsync(['node', 'health', '--full']);
  });

healthCommand
  .command('mcp')
  .description('MCP health check')
  .action(() => {
    healthCommand.parseAsync(['node', 'health', '--mcp']);
  });
