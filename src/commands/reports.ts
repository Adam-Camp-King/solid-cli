/**
 * Reporting commands for Solid CLI
 *
 * All operations are scoped to the authenticated company.
 */

import { Command } from 'commander';
import chalk from 'chalk';

import { apiClient } from '../lib/api-client';
import { run } from '../lib/command-kit';
import { isJsonOutput } from '../lib/json-output';

const REPORT_TYPES = [
  { key: 'sales_overview_daily', description: 'Daily sales breakdown' },
  { key: 'payments_by_tender', description: 'Payments grouped by tender type' },
  { key: 'financial_summary', description: 'Financial overview' },
  { key: 'inventory_summary', description: 'Inventory status report' },
  { key: 'top_items', description: 'Top-selling items' },
];

interface ReportDefinition {
  key?: string;
  name?: string;
  description?: string;
}

interface ReportDefinitionsResponse {
  definitions?: ReportDefinition[];
  reports?: ReportDefinition[];
}

interface ReportRunResponse {
  rows?: Record<string, unknown>[];
  data?: Record<string, unknown>[];
  results?: Record<string, unknown>[];
  summary?: Record<string, unknown>;
}

interface RevenueSummaryResponse {
  total_revenue?: number;
  transaction_count?: number;
  avg_order_value?: number;
  growth_pct?: number;
}

interface TopProduct {
  name?: string;
  title?: string;
  revenue?: number;
  quantity_sold?: number;
}

interface TopProductsResponse {
  products?: TopProduct[];
  items?: TopProduct[];
}

interface ExportResponse {
  csv?: string;
  content?: string;
  filename?: string;
  url?: string;
}

export const reportsCommand = new Command('reports')
  .description('Business reports & analytics');

reportsCommand
  .command('list').alias('ls')
  .description('List available report types')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    await run<ReportDefinitionsResponse>(
      async () => (await apiClient.get('/api/v1/Reports/definitions')).data as ReportDefinitionsResponse,
      {
        spinner: 'Loading report definitions...',
        errorText: 'Failed to load report types',
        json: isJsonOutput(options),
        render: (data) => {
          const definitions: ReportDefinition[] = data.definitions || data.reports || REPORT_TYPES;
          console.log('');
          for (const r of definitions) {
            console.log(`  ${chalk.bold(r.key || r.name || '?')}  ${chalk.dim(r.description || '')}`);
          }
        },
      },
    );
  });

reportsCommand
  .command('run [type]')
  .description('Run a report. Use --list to discover valid types.')
  .option('--list', 'List available report types and exit')
  .option('--from <date>', 'Start date (YYYY-MM-DD)')
  .option('--to <date>', 'End date (YYYY-MM-DD)')
  .option('--days <n>', 'Shortcut: last N days')
  .option('--json', 'Output as JSON')
  .action(async (type: string | undefined, options) => {
    // --list: forward to the `list` action so `reports run --list` works the
    // same as `reports list`. Matches intuition; doesn't require the user
    // to know two commands.
    if (options.list) {
      await run<ReportDefinitionsResponse>(
        async () => (await apiClient.get('/api/v1/Reports/definitions')).data as ReportDefinitionsResponse,
        {
          spinner: 'Loading report definitions...',
          errorText: 'Failed to load report types',
          json: isJsonOutput(options),
          render: (data) => {
            const defs: ReportDefinition[] = data.definitions || data.reports || REPORT_TYPES;
            console.log('');
            for (const r of defs) {
              console.log(`  ${chalk.bold(r.key || r.name || '?')}  ${chalk.dim(r.description || '')}`);
            }
          },
        },
      );
      return;
    }
    if (!type) {
      console.error(chalk.red('Missing report type. Use `solid reports run --list` to see valid types.'));
      process.exit(2);
    }
    await run<ReportRunResponse>(
      async () => {
        const body: Record<string, unknown> = { key: type };
        if (options.from) body.date_from = options.from;
        if (options.to) body.date_to = options.to;
        if (options.days) {
          const now = new Date();
          const from = new Date(now.getTime() - parseInt(options.days, 10) * 86400000);
          body.date_from = from.toISOString().split('T')[0];
          body.date_to = now.toISOString().split('T')[0];
        }
        return (await apiClient.post('/api/v1/Reports/run', body)).data as ReportRunResponse;
      },
      {
        spinner: `Running ${type} report...`,
        successText: `Report: ${type}`,
        errorText: 'Failed to run report',
        json: isJsonOutput(options),
        render: (data) => {
          console.log('');
          const rows = data.rows || data.data || data.results || [];
          if (rows.length > 0) {
            const cols = Object.keys(rows[0]);
            console.log(chalk.dim(`  ${cols.join('  |  ')}`));
            console.log(chalk.dim(`  ${'─'.repeat(cols.join('  |  ').length)}`));
            for (const row of rows.slice(0, 50)) {
              const vals = cols.map((c) => String((row as Record<string, unknown>)[c] ?? ''));
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
        },
      },
    );
  });

reportsCommand
  .command('revenue')
  .description('Revenue summary')
  .option('--days <n>', 'Period in days', '30')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    await run<RevenueSummaryResponse>(
      async () => (await apiClient.get('/api/v1/Reports/revenue-summary', {
        params: { days: parseInt(options.days, 10) },
      })).data as RevenueSummaryResponse,
      {
        spinner: 'Loading revenue data...',
        successText: `Revenue — last ${options.days} days`,
        errorText: 'Failed to load revenue data',
        json: isJsonOutput(options),
        render: (d) => {
          console.log('');
          if (d.total_revenue !== undefined) console.log(`  ${chalk.bold('Total Revenue:')}  ${chalk.green('$' + Number(d.total_revenue).toFixed(2))}`);
          if (d.transaction_count !== undefined) console.log(`  ${chalk.bold('Transactions:')}   ${d.transaction_count}`);
          if (d.avg_order_value !== undefined) console.log(`  ${chalk.bold('Avg Order:')}      $${Number(d.avg_order_value).toFixed(2)}`);
          if (d.growth_pct !== undefined) {
            const arrow = d.growth_pct >= 0 ? chalk.green(`+${d.growth_pct}%`) : chalk.red(`${d.growth_pct}%`);
            console.log(`  ${chalk.bold('Growth:')}         ${arrow}`);
          }
        },
      },
    );
  });

reportsCommand
  .command('top-products')
  .description('Top products by revenue')
  .option('--limit <n>', 'Number of products', '10')
  .option('--days <n>', 'Period in days', '30')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    await run<TopProductsResponse>(
      async () => (await apiClient.get('/api/v1/Reports/top-products', {
        params: { limit: parseInt(options.limit, 10), days: parseInt(options.days, 10) },
      })).data as TopProductsResponse,
      {
        spinner: 'Loading top products...',
        errorText: 'Failed to load top products',
        json: isJsonOutput(options),
        render: (data) => {
          const items = data.products || data.items || [];
          if (items.length === 0) {
            console.log(chalk.dim('  No product data for this period.'));
            return;
          }
          console.log('');
          for (let i = 0; i < items.length; i++) {
            const p = items[i];
            const rev = p.revenue !== undefined ? chalk.green(`$${Number(p.revenue).toFixed(2)}`) : '';
            const qty = p.quantity_sold !== undefined ? chalk.dim(`${p.quantity_sold} sold`) : '';
            console.log(`  ${chalk.dim(`${i + 1}.`)} ${chalk.bold(p.name || p.title || '?')}  ${rev}  ${qty}`);
          }
        },
      },
    );
  });

reportsCommand
  .command('export <type>')
  .description('Export report to CSV')
  .option('--from <date>', 'Start date (YYYY-MM-DD)')
  .option('--to <date>', 'End date (YYYY-MM-DD)')
  .action(async (type: string, options) => {
    await run<ExportResponse>(
      async () => {
        const body: Record<string, unknown> = { key: type };
        if (options.from) body.date_from = options.from;
        if (options.to) body.date_to = options.to;
        return (await apiClient.post('/api/v1/Reports/export', body)).data as ExportResponse;
      },
      {
        spinner: `Exporting ${type}...`,
        errorText: 'Failed to export report',
        render: async (data) => {
          if (data.csv || data.content) {
            const csv = (data.csv || data.content) as string;
            const filename = data.filename || `${type}-export.csv`;
            const fs = await import('fs');
            fs.writeFileSync(filename, csv);
            console.log(chalk.green(`  Exported to ${filename}`));
          } else if (data.url) {
            console.log(chalk.green(`  Export ready: ${data.url}`));
          } else {
            console.log(JSON.stringify(data, null, 2));
          }
        },
      },
    );
  });

import { appendExamples as __ae_reports } from '../lib/command-kit';
__ae_reports(reportsCommand, [
  { cmd: 'solid reports list',                  why: 'Available reports' },
  { cmd: 'solid reports revenue --range 30d',   why: 'Revenue — last 30 days' },
  { cmd: 'solid reports top-products',          why: 'Best sellers' },
  { cmd: 'solid reports revenue --format csv',  why: 'Export to CSV' },
]);
