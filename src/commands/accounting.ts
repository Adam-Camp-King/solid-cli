/**
 * `solid accounting` — the OPTIONAL mirror of Solid#'s books into QuickBooks,
 * Xero or FreshBooks. The books themselves are `solid books`, `solid invoices`
 * and `solid expenses` (commands/books.ts) — every company has those, with or
 * without an accounting system.
 *
 * ⛔ Fixed 2026-09-11 — all three commands spoke to an API that never existed:
 * `sync` POSTed with no connection_id (the backend requires one → 422),
 * `history` called /sync/history (only /sync/history/{connection_id} exists → 404),
 * and `status` read provider/status/last_sync at the top level when the backend
 * returns {connections: [...]}.
 */
import { Command } from 'commander';
import chalk from 'chalk';

import { apiClient, handleApiError } from '../lib/api-client';
import { appendExamples, requireAuth } from '../lib/command-kit';
import { isJsonOutput } from '../lib/json-output';
import { ui } from '../lib/ui';
import { invokeAgentVerbShortcut as read } from './dispatch_shortcuts';

interface Connection {
  id: number;
  provider: string;
  last_sync: string | null;
  last_sync_status?: string | null;
  last_error?: string | null;
  sync_enabled: boolean;
  connected_company_name?: string | null;
}

async function connectionFor(connectionId?: string): Promise<Connection> {
  const res = await apiClient.get('/api/v1/accounting/connections');
  const list = (((res.data as any) || {}).connections || []) as Connection[];
  if (list.length === 0) {
    throw new Error('No accounting system is connected — connect one in Integrations → Accounting.');
  }
  if (!connectionId) return list[0];
  const match = list.find((c) => c.id === Number(connectionId));
  if (!match) throw new Error(`No accounting connection ${connectionId} on this account.`);
  return match;
}

export const accountingCommand = new Command('accounting')
  .description('Optional mirror of your books into QuickBooks / Xero / FreshBooks (the books: `solid books`)')
  .action(async () => { accountingCommand.outputHelp(); });

accountingCommand.command('status').description('Each connected accounting system and how its last sync went')
  .option('--json', 'JSON output')
  .action(async (options) => {
    requireAuth();
    const ora = (await import('ora')).default;
    const spinner = ora('Loading...').start();
    try {
      const res = await apiClient.get('/api/v1/accounting/sync/status');
      spinner.stop();
      if (isJsonOutput(options)) { console.log(JSON.stringify(res.data, null, 2)); return; }
      const connections = (((res.data as any) || {}).connections || []) as Array<Record<string, any>>;
      console.log('');
      console.log(ui.header('Accounting'));
      if (connections.length === 0) console.log(chalk.dim('  Nothing connected — your books live in Solid# (`solid books summary`).'));
      for (const c of connections) {
        const status = c.last_status === 'success' ? chalk.green(c.last_status)
          : c.last_status ? chalk.yellow(c.last_status) : chalk.dim('never synced');
        console.log(ui.label(`${c.provider} (#${c.connection_id})`, `${status}${c.last_sync ? chalk.dim(`  ${c.last_sync}`) : ''}`));
      }
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); process.exit(1); }
  });

accountingCommand.command('sync').description('Send what is waiting to the connected accounting system now')
  .option('--connection-id <id>', 'Which connection (default: the first)')
  .option('--json', 'JSON output')
  .action(async (options) => {
    requireAuth();
    const ora = (await import('ora')).default;
    const spinner = ora('Starting sync...').start();
    try {
      const connection = await connectionFor(options.connectionId);
      const res = await apiClient.post('/api/v1/accounting/sync', { connection_id: connection.id });
      spinner.stop();
      if (isJsonOutput(options)) { console.log(JSON.stringify(res.data, null, 2)); return; }
      console.log('');
      console.log(ui.successBox('Sync started', [
        `${chalk.dim('Provider:')} ${connection.provider}`,
        chalk.dim('Each expense and invoice records how it landed — `solid accounting history`.'),
      ]));
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); process.exit(1); }
  });

accountingCommand.command('history').description('What was sent, and how each landed')
  .option('--connection-id <id>', 'Which connection (default: the first)')
  .option('--limit <n>', 'Entries', '20')
  .option('--json', 'JSON output')
  .action(async (options) => {
    requireAuth();
    const ora = (await import('ora')).default;
    const spinner = ora('Loading...').start();
    try {
      const connection = await connectionFor(options.connectionId);
      const res = await apiClient.get(`/api/v1/accounting/sync/history/${connection.id}`, { params: { limit: options.limit } });
      spinner.stop();
      if (isJsonOutput(options)) { console.log(JSON.stringify(res.data, null, 2)); return; }
      const items = (((res.data as any) || {}).items || []) as Array<Record<string, any>>;
      console.log('');
      console.log(ui.header(`${connection.provider} — sync history (${items.length})`));
      if (items.length === 0) console.log(chalk.dim('  Nothing sent yet.'));
      for (const e of items) {
        const mark = e.status === 'success' ? chalk.green('✓') : e.status === 'failed' ? chalk.red('✗') : chalk.yellow('…');
        const where = e.remote_id ? ` → ${e.remote_id}` : '';
        console.log(`  ${mark} ${e.entity_type} ${e.solid_id}${where}  ${chalk.dim(e.synced_at || '')}${e.error ? chalk.red(`  ${e.error}`) : ''}`);
      }
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); process.exit(1); }
  });

accountingCommand.command('setup').description('Where money out and money in land in the connected books, and what is still missing')
  .option('--accounts', 'Also list the accounts in their books to choose from')
  .option('--json', 'JSON output')
  .action(async (options) => {
    const payload = { include_accounts: Boolean(options.accounts) };
    await read('integration.accounting_expense_setup', payload, options, 'Money out...');
    await read('integration.accounting_receivable_setup', payload, options, 'Money in...');
  });

appendExamples(accountingCommand, [
  { cmd: 'solid accounting status', why: 'Connected systems + how the last sync went' },
  { cmd: 'solid accounting setup --accounts', why: 'Where expenses and invoices land, what to choose' },
  { cmd: 'solid accounting sync', why: 'Send what is waiting now' },
  { cmd: 'solid accounting history', why: 'What was sent, and how each landed' },
]);
