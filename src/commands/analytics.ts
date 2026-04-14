/**
 * Analytics command for Solid CLI
 *
 * Surface business analytics from the terminal.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';

export const analyticsCommand = new Command('analytics')
  .description('Business analytics and insights')
  .action(async () => {
    analyticsCommand.outputHelp();
  });

analyticsCommand
  .command('dashboard')
  .description('Revenue, customers, transactions overview')
  .option('--period <days>', 'Period in days', '30')
  .option('--json', 'JSON output')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const ora = (await import('ora')).default;
    const spinner = ora('Loading analytics...').start();

    try {
      const response = await apiClient.get('/api/v1/dashboard/summary', {
        params: { period: options.period },
      });
      spinner.stop();

      if (options.json) {
        console.log(JSON.stringify(response.data, null, 2));
        return;
      }

      const d = response.data as Record<string, any>;
      console.log('');
      console.log(ui.header('Business Analytics'));

      const hasData = d.revenue !== undefined || d.transactions !== undefined || d.customers !== undefined;
      if (hasData) {
        if (d.revenue !== undefined) console.log(ui.label('Revenue', chalk.green(`$${(d.revenue || 0).toLocaleString()}`)));
        if (d.transactions !== undefined) console.log(ui.label('Transactions', String(d.transactions || 0)));
        if (d.customers !== undefined) console.log(ui.label('Customers', String(d.customers || 0)));
        if (d.new_customers !== undefined) console.log(ui.label('New Customers', String(d.new_customers || 0)));
        if (d.avg_transaction !== undefined) console.log(ui.label('Avg Transaction', chalk.green(`$${(d.avg_transaction || 0).toFixed(2)}`)));
      } else {
        console.log(chalk.dim('  No analytics data available yet.'));
        console.log(chalk.dim('  Data appears after your first transactions.'));
      }
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red('Failed to load analytics'));
      console.error(handleApiError(error).message);
    }
  });

analyticsCommand
  .command('mcp-traffic')
  .description('AI crawler traffic — who is reading your site')
  .option('--json', 'JSON output')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const ora = (await import('ora')).default;
    const spinner = ora('Loading MCP traffic...').start();

    try {
      const response = await apiClient.get('/api/v1/analytics/mcp/traffic');
      spinner.stop();

      if (options.json) {
        console.log(JSON.stringify(response.data, null, 2));
        return;
      }

      const d = response.data as Record<string, any>;
      console.log('');
      console.log(ui.header('AI Crawler Traffic'));

      if (d.total_hits !== undefined) console.log(ui.label('Total Hits', String(d.total_hits)));
      if (d.google_hits !== undefined) console.log(ui.label('Google AI', String(d.google_hits)));
      if (d.bing_hits !== undefined) console.log(ui.label('Bing AI', String(d.bing_hits)));
      if (d.chatgpt_hits !== undefined) console.log(ui.label('ChatGPT', String(d.chatgpt_hits)));
      if (d.claude_hits !== undefined) console.log(ui.label('Claude', String(d.claude_hits)));
      if (d.perplexity_hits !== undefined) console.log(ui.label('Perplexity', String(d.perplexity_hits)));
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red('Failed to load MCP traffic'));
      console.error(handleApiError(error).message);
    }
  });
