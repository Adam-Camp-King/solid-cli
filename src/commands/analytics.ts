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
import { isJsonOutput } from '../lib/json-output';

export const analyticsCommand = new Command('analytics')
  .description('Business analytics and insights')
  .action(async () => {
    analyticsCommand.outputHelp();
  });

// Shared window parser — accepts either `--period <days>` or
// `--date-range <ISO..ISO>` / `--from X --to Y`. Returns the `period`
// (backwards compat) plus explicit from/to when supplied.
function resolveWindow(opts: { period?: string; dateRange?: string; from?: string; to?: string }): Record<string, string> {
  const out: Record<string, string> = {};
  if (opts.dateRange) {
    const [from, to] = opts.dateRange.split(/\.{2,}|,/).map((s) => s.trim());
    if (from) out.date_from = from;
    if (to) out.date_to = to;
  } else {
    if (opts.from) out.date_from = opts.from;
    if (opts.to) out.date_to = opts.to;
  }
  if (opts.period) out.period = opts.period;
  // If user passed a range without a period, the backend still wants a hint.
  if (!out.period && (out.date_from || out.date_to)) out.period = '0';
  return out;
}

analyticsCommand
  .command('dashboard')
  .description('Revenue, customers, transactions overview')
  .option('--period <days>', 'Period in days (shortcut; used when --date-range is not given)', '30')
  .option('--date-range <from..to>', 'Date range as ISO dates, e.g. 2026-01-01..2026-04-17')
  .option('--from <date>', 'Start date (ISO)')
  .option('--to <date>', 'End date (ISO)')
  .option('--json', 'JSON output')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const ora = (await import('ora')).default;
    const spinner = ora({ text: 'Loading analytics...', stream: process.stderr }).start();

    try {
      const response = await apiClient.get('/api/v1/dashboard/summary', {
        params: resolveWindow(options),
      });
      spinner.stop();

      if (isJsonOutput(options)) {
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

      if (isJsonOutput(options)) {
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
