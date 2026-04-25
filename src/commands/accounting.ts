/**
 * Accounting command for Solid CLI — QuickBooks / Xero sync.
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';
import { isJsonOutput } from '../lib/json-output';

export const accountingCommand = new Command('accounting')
  .description('Accounting sync — QuickBooks, Xero')
  .action(async () => { accountingCommand.outputHelp(); });

accountingCommand.command('sync').description('Trigger a full accounting sync')
  .option('--json', 'JSON output')
  .action(async (options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Starting accounting sync...').start();
    try {
      const res = await apiClient.post('/api/v1/accounting/sync');
      spinner.stop();
      if (isJsonOutput(options)) { console.log(JSON.stringify(res.data, null, 2)); return; }
      const d = res.data as Record<string, any>;
      console.log('');
      console.log(ui.successBox('Sync Started', [`${chalk.dim('Status:')}  ${d.status || 'running'}`, `${chalk.dim('Sync ID:')} ${d.sync_id || d.id || 'n/a'}`]));
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); process.exit(1); }
  });

accountingCommand.command('status').description('Check sync status')
  .option('--json', 'JSON output')
  .action(async (options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Loading...').start();
    try {
      const res = await apiClient.get('/api/v1/accounting/sync/status');
      spinner.stop();
      if (isJsonOutput(options)) { console.log(JSON.stringify(res.data, null, 2)); return; }
      const d = res.data as Record<string, any>;
      console.log('');
      console.log(ui.header('Accounting Sync'));
      if (d.provider) console.log(ui.label('Provider', d.provider));
      if (d.status) console.log(ui.label('Status', d.status === 'connected' ? chalk.green(d.status) : chalk.yellow(d.status)));
      if (d.last_sync) console.log(ui.label('Last Sync', d.last_sync));
      if (d.records_synced !== undefined) console.log(ui.label('Records', String(d.records_synced)));
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); process.exit(1); }
  });

accountingCommand.command('history').description('View sync history')
  .option('--limit <n>', 'Entries', '10').option('--json', 'JSON output')
  .action(async (options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Loading...').start();
    try {
      const res = await apiClient.get('/api/v1/accounting/sync/history', { params: { limit: options.limit } });
      spinner.stop();
      if (isJsonOutput(options)) { console.log(JSON.stringify(res.data, null, 2)); return; }
      const d = res.data as Record<string, any>;
      const entries = d.history || d.syncs || [];
      console.log('');
      console.log(ui.header(`Sync History (${entries.length})`));
      if (entries.length === 0) { console.log(chalk.dim('  No sync history yet.')); }
      else { for (const e of entries) { const s = e.status === 'success' ? chalk.green('✓') : chalk.red('✗'); console.log(`  ${s} ${e.created_at || e.date} — ${e.records || 0} records`); } }
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); process.exit(1); }
  });

import { appendExamples as __ae_accounting } from '../lib/command-kit';
__ae_accounting(accountingCommand, [
  { cmd: 'solid accounting sync',          why: 'Sync orders → QuickBooks/Xero now' },
  { cmd: 'solid accounting status',        why: 'Connected provider + last sync time' },
  { cmd: 'solid accounting history',       why: 'Sync attempts + failures' },
]);
