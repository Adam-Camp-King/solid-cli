/**
 * Reporting commands for Solid CLI
 *
 * All operations are scoped to the authenticated company.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';

const REPORT_TYPES = [
  { key: 'sales_overview_daily', description: 'Daily sales breakdown' },
  { key: 'payments_by_tender', description: 'Payments grouped by tender type' },
  { key: 'financial_summary', description: 'Financial overview' },
  { key: 'inventory_summary', description: 'Inventory status report' },
  { key: 'top_items', description: 'Top-selling items' },
];

function requireAuth() {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
}

export const reportsCommand = new Command('reports')
  .description('Business reports & analytics');

// List report types
reportsCommand
  .command('list')
  .description('List available report types')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireAuth();
    const spinner = ora('Loading report definitions...').start();

    try {
      const response = await apiClient.get('/Reports/definitions');
      const data = response.data as any;
      const definitions = data.definitions || data.reports || REPORT_TYPES;

      if (options.json) {
        spinner.stop();
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      spinner.succeed(chalk.green(`${definitions.length} report type(s)`));
      console.log('');

      for (const r of definitions) {
        console.log(`  ${chalk.bold(r.key || r.name)}  ${chalk.dim(r.description || '')}`);
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to load report types'));
      console.error(chalk.red(`  ${handleApiError(error).message}`));
    }
  });

// Run a report
reportsCommand
  .command('run <type>')
  .description('Run a report (sales_overview_daily, payments_by_tender, financial_summary, inventory_summary, top_items)')
  .option('--from <date>', 'Start date (YYYY-MM-DD)')
  .option('--to <date>', 'End date (YYYY-MM-DD)')
  .option('--days <n>', 'Shortcut: last N days')
  .option('--json', 'Output as JSON')
  .action(async (type, options) => {
    requireAuth();
    const spinner = ora(`Running ${type} report...`).start();

    try {
      const body: Record<string, unknown> = { key: type };
      if (options.from) body.date_from = options.from;
      if (options.to) body.date_to = options.to;
      if (options.days) {
        const now = new Date();
        const from = new Date(now.getTime() - parseInt(options.days) * 86400000);
        body.date_from = from.toISOString().split('T')[0];
        body.date_to = now.toISOString().split('T')[0];
      }

      const response = await apiClient.post('/Reports/run', body);
      const data = response.data as any;

      if (options.json) {
        spinner.stop();
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      spinner.succeed(chalk.green(`Report: ${type}`));
      console.log('');

      // Render rows if present
      const rows = data.rows || data.data || data.results || [];
      if (rows.length > 0) {
        const cols = Object.keys(rows[0]);
        console.log(chalk.dim(`  ${cols.join('  |  ')}`));
        console.log(chalk.dim(`  ${'─'.repeat(cols.join('  |  ').length)}`));
        for (const row of rows.slice(0, 50)) {
          const vals = cols.map((c) => String(row[c] ?? ''));
          console.log(`  ${vals.join('  |  ')}`);
        }
        if (rows.length > 50) {
          console.log(chalk.dim(`  ... and ${rows.length - 50} more rows`));
        }
      } else if (data.summary) {
        for (const [k, v] of Object.entries(data.summary)) {
          console.log(`  ${chalk.bold(k)}: ${v}`);
        }
      } else {
        console.log(chalk.dim('  No data returned for this period.'));
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to run report'));
      console.error(chalk.red(`  ${handleApiError(error).message}`));
    }
  });

// Revenue summary
reportsCommand
  .command('revenue')
  .description('Revenue summary')
  .option('--days <n>', 'Period in days', '30')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireAuth();
    const spinner = ora('Loading revenue data...').start();

    try {
      const params = { days: parseInt(options.days) };
      const response = await apiClient.get('/Reports/revenue-summary', { params });
      const data = response.data as any;

      if (options.json) {
        spinner.stop();
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      spinner.succeed(chalk.green(`Revenue — last ${options.days} days`));
      console.log('');

      if (data.total_revenue !== undefined) console.log(`  ${chalk.bold('Total Revenue:')}  ${chalk.green('$' + Number(data.total_revenue).toFixed(2))}`);
      if (data.transaction_count !== undefined) console.log(`  ${chalk.bold('Transactions:')}   ${data.transaction_count}`);
      if (data.avg_order_value !== undefined) console.log(`  ${chalk.bold('Avg Order:')}      $${Number(data.avg_order_value).toFixed(2)}`);
      if (data.growth_pct !== undefined) {
        const arrow = data.growth_pct >= 0 ? chalk.green(`+${data.growth_pct}%`) : chalk.red(`${data.growth_pct}%`);
        console.log(`  ${chalk.bold('Growth:')}         ${arrow}`);
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to load revenue data'));
      console.error(chalk.red(`  ${handleApiError(error).message}`));
    }
  });

// Top products
reportsCommand
  .command('top-products')
  .description('Top products by revenue')
  .option('--limit <n>', 'Number of products', '10')
  .option('--days <n>', 'Period in days', '30')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireAuth();
    const spinner = ora('Loading top products...').start();

    try {
      const params = { limit: parseInt(options.limit), days: parseInt(options.days) };
      const response = await apiClient.get('/Reports/top-products', { params });
      const data = response.data as any;
      const items = data.products || data.items || [];

      if (options.json) {
        spinner.stop();
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      spinner.succeed(chalk.green(`Top ${items.length} products — last ${options.days} days`));

      if (items.length === 0) {
        console.log(chalk.dim('  No product data for this period.'));
        return;
      }

      console.log('');
      for (let i = 0; i < items.length; i++) {
        const p = items[i];
        const rev = p.revenue !== undefined ? chalk.green(`$${Number(p.revenue).toFixed(2)}`) : '';
        const qty = p.quantity_sold !== undefined ? chalk.dim(`${p.quantity_sold} sold`) : '';
        console.log(`  ${chalk.dim(`${i + 1}.`)} ${chalk.bold(p.name || p.title)}  ${rev}  ${qty}`);
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to load top products'));
      console.error(chalk.red(`  ${handleApiError(error).message}`));
    }
  });

// Export report
reportsCommand
  .command('export <type>')
  .description('Export report to CSV')
  .option('--from <date>', 'Start date (YYYY-MM-DD)')
  .option('--to <date>', 'End date (YYYY-MM-DD)')
  .action(async (type, options) => {
    requireAuth();
    const spinner = ora(`Exporting ${type}...`).start();

    try {
      const body: Record<string, unknown> = { key: type };
      if (options.from) body.date_from = options.from;
      if (options.to) body.date_to = options.to;

      const response = await apiClient.post('/Reports/export', body);
      const data = response.data as any;

      if (data.csv || data.content) {
        const csv = data.csv || data.content;
        const filename = data.filename || `${type}-export.csv`;
        const fs = await import('fs');
        fs.writeFileSync(filename, csv);
        spinner.succeed(chalk.green(`Exported to ${filename}`));
      } else if (data.url) {
        spinner.succeed(chalk.green(`Export ready: ${data.url}`));
      } else {
        spinner.succeed(chalk.green('Export complete'));
        console.log(JSON.stringify(data, null, 2));
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to export report'));
      console.error(chalk.red(`  ${handleApiError(error).message}`));
    }
  });
