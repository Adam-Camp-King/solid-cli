/**
 * Health check commands for Solid CLI
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';

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

        spinner.stop();

        const mcpOk = response.data.status === 'healthy';
        const agents = response.data.agents?.total_agents || 0;

        console.log('');
        console.log(ui.infoBox('MCP / AI Agents', [
          `${chalk.bold('Status:')}  ${mcpOk ? chalk.green('● healthy') : chalk.red('● unhealthy')}`,
          `${chalk.bold('MCP:')}     ${response.data.mcp_enabled ? chalk.green('enabled') : chalk.yellow('disabled')}`,
          `${chalk.bold('Agents:')}  ${chalk.hex('#818cf8')(agents.toString())} active`,
        ]));
        console.log('');

      } else if (options.full) {
        // Full health check
        const response = await apiClient.healthFull();

        if (options.json) {
          spinner.stop();
          console.log(JSON.stringify(response.data, null, 2));
          return;
        }

        spinner.stop();

        const summary = response.data.summary;
        const allHealthy = summary.healthy_layers === summary.total_layers;

        const layers = response.data.layers as Record<string, { status: string }>;
        const layerLines = Object.entries(layers).map(([name, data]) => {
          const icon = data.status === 'healthy' ? chalk.green('●') :
            data.status === 'degraded' ? chalk.yellow('●') :
            chalk.red('●');
          const displayName = name.replace('layer_', '').replace(/_/g, ' ');
          const statusText = data.status === 'healthy' ? chalk.green(data.status) :
            data.status === 'degraded' ? chalk.yellow(data.status) :
            chalk.red(data.status);
          return `  ${icon} ${displayName.padEnd(20)} ${statusText}`;
        });

        console.log('');
        console.log(ui.infoBox(
          allHealthy ? `${summary.total_layers} Layers Healthy` : `${summary.healthy_layers}/${summary.total_layers} Healthy`,
          [
            `${chalk.bold('API:')} ${chalk.dim(config.apiUrl)}`,
            '',
            ...layerLines,
          ]
        ));
        console.log('');

      } else {
        // Quick health check
        const response = await apiClient.healthQuick();

        if (options.json) {
          spinner.stop();
          console.log(JSON.stringify(response.data, null, 2));
          return;
        }

        spinner.stop();

        const healthy = response.data.status === 'healthy';

        console.log('');
        console.log(ui.infoBox('System Health', [
          `${chalk.bold('Status:')}    ${healthy ? chalk.green('● healthy') : chalk.red('● ' + response.data.status)}`,
          `${chalk.bold('API:')}       ${chalk.dim(config.apiUrl)}`,
          `${chalk.bold('Timestamp:')} ${chalk.dim(response.data.timestamp)}`,
        ]));

        if (healthy) {
          console.log('');
          console.log(chalk.dim('  Run `solid health --full` for detailed 6-layer check'));
        }
        console.log('');
      }
    } catch (error) {
      spinner.fail(chalk.red('Health check failed'));
      const apiError = handleApiError(error);

      console.log('');
      console.log(ui.errorBox('Connection Failed', [
        apiError.message,
        '',
        `${chalk.dim('API URL:')} ${config.apiUrl}`,
        '',
        chalk.dim('Check if the API server is running.'),
      ]));
      console.log('');
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
