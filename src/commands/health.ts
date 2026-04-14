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
        // Full health check — /api/v1/health
        const response = await apiClient.healthFull();

        if (options.json) {
          spinner.stop();
          console.log(JSON.stringify(response.data, null, 2));
          return;
        }

        spinner.stop();

        const d = response.data;
        const isHealthy = d.status === 'healthy';
        const statusIcon = isHealthy ? chalk.green('● healthy') :
          d.status === 'degraded' ? chalk.yellow('● degraded') :
          chalk.red('● ' + d.status);

        const lines: string[] = [
          `${chalk.bold('Status:')}    ${statusIcon}`,
          `${chalk.bold('API:')}       ${chalk.dim(config.apiUrl)}`,
          `${chalk.bold('Timestamp:')} ${chalk.dim(d.timestamp)}`,
        ];

        // Show detailed info if available (requires HEALTH_CHECK_SECRET)
        if (d.checks) {
          lines.push('');
          for (const [name, value] of Object.entries(d.checks)) {
            const displayName = name.replace(/_/g, ' ');
            const icon = value === 'ok' || value === 'loaded' ? chalk.green('●') :
              String(value).includes('active') ? chalk.green('●') :
              chalk.red('●');
            lines.push(`  ${icon} ${displayName.padEnd(20)} ${chalk.dim(String(value))}`);
          }
        }

        if (d.ports) {
          lines.push('');
          for (const [name, value] of Object.entries(d.ports)) {
            const displayName = name.replace(/^\d+_/, '').replace(/_/g, ' ');
            const icon = value === 'listening' || value === 'connected' ? chalk.green('●') :
              chalk.red('●');
            lines.push(`  ${icon} ${displayName.padEnd(20)} ${chalk.dim(String(value))}`);
          }
        }

        if (d.warnings && d.warnings.length > 0) {
          lines.push('');
          for (const w of d.warnings) {
            lines.push(`  ${chalk.yellow('⚠')} ${chalk.dim(w)}`);
          }
        }

        if (!d.checks) {
          lines.push('');
          lines.push(chalk.dim('  Detailed checks require HEALTH_CHECK_SECRET'));
        }

        console.log('');
        console.log(ui.infoBox('System Health', lines));
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

// Usage:
//   solid health          → quick check
//   solid health --full   → 6-layer check (admin-only in prod)
//   solid health --mcp    → MCP/agent check
