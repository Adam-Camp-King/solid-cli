/**
 * solid transaction — Atomic batch primitive for agent-driven mutations.
 *
 * Pairs with the backend services/cli_transaction.py (Phase 2.4 of the
 * agent-attraction roadmap). An agent opens a transaction, runs N
 * mutations under that handle, then commits or aborts. The transaction
 * gives the operator + the agent a single rollback point.
 *
 * Commands:
 *   solid transaction start [--tag <name>]
 *   solid transaction append <txn-id> <verb> [--payload <json>] [--receipt <id>]
 *   solid transaction commit <txn-id>
 *   solid transaction abort  <txn-id>
 *   solid transaction get    <txn-id>
 *
 * See: Owners-Manual/73-WebMCP-Integration/NEW-VERBS-PROPOSAL.md (Shape 4)
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { config } from '../lib/config';
import { apiClient, handleApiError, failApi } from '../lib/api-client';
import { isJsonOutput } from '../lib/json-output';

function requireLogin(): void {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
}

function parseJsonArg(name: string, raw: string | undefined): any {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error(chalk.red(`--${name} must be valid JSON`));
    process.exit(1);
  }
}

function emit(data: any, opts: { json?: boolean }, fallback: () => void): void {
  if (opts.json || isJsonOutput()) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    fallback();
  }
}

export const transactionCommand = new Command('transaction')
  .alias('txn')
  .description('Open / append / commit / abort CLI transactions for atomic batches');

transactionCommand
  .command('start')
  .description('Open a new transaction handle')
  .option('--tag <name>', 'Human label for the transaction')
  .option('--ttl <seconds>', 'TTL in seconds (default 86400 = 24h)')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireLogin();
    const spinner = options.json ? null : ora('Opening transaction...').start();
    try {
      const body: Record<string, any> = {};
      if (options.tag) body.tag = options.tag;
      if (options.ttl) body.ttl_seconds = parseInt(options.ttl, 10);
      const res = await apiClient.post('/api/v1/agent/transaction/start', body);
      spinner?.stop();
      const data: any = res.data;
      emit(data, options, () => {
        console.log(chalk.green('✓ transaction opened'));
        console.log(`  id:     ${chalk.cyan(data.transaction_id)}`);
        console.log(`  status: ${data.status}`);
        if (data.tag) console.log(`  tag:    ${data.tag}`);
      });
    } catch (e) {
      spinner?.stop();
      failApi(e);
    }
  });

transactionCommand
  .command('append <transactionId> <verb>')
  .description('Append a staged op to an open transaction')
  .option('--payload <json>', 'JSON-encoded payload for the op')
  .option('--receipt <id>', 'UCP receipt id this op is linked to')
  .option('--json', 'Output as JSON')
  .action(async (transactionId, verb, options) => {
    requireLogin();
    const spinner = options.json ? null : ora('Appending op...').start();
    try {
      const body: Record<string, any> = {
        transaction_id: transactionId,
        verb,
      };
      const payload = parseJsonArg('payload', options.payload);
      if (payload) body.payload = payload;
      if (options.receipt) body.receipt_id = options.receipt;
      const res = await apiClient.post('/api/v1/agent/transaction/append', body);
      spinner?.stop();
      const data: any = res.data;
      emit(data, options, () => {
        console.log(chalk.green(`✓ op appended (${data.op_count} total)`));
      });
    } catch (e) {
      spinner?.stop();
      failApi(e);
    }
  });

transactionCommand
  .command('commit <transactionId>')
  .description('Seal a transaction as committed')
  .option('--json', 'Output as JSON')
  .action(async (transactionId, options) => {
    requireLogin();
    const spinner = options.json ? null : ora('Committing transaction...').start();
    try {
      const res = await apiClient.post(`/api/v1/agent/transaction/${transactionId}/commit`);
      spinner?.stop();
      const data: any = res.data;
      emit(data, options, () => {
        console.log(chalk.green(`✓ committed (${data.op_count} ops sealed)`));
      });
    } catch (e) {
      spinner?.stop();
      failApi(e);
    }
  });

transactionCommand
  .command('abort <transactionId>')
  .description('Abort a transaction — reverses all mutations via entity versioning')
  .option('--json', 'Output as JSON')
  .action(async (transactionId, options) => {
    requireLogin();
    const spinner = options.json ? null : ora('Reversing transaction...').start();
    try {
      const res = await apiClient.post(`/api/v1/agent/transaction/${transactionId}/abort`);
      spinner?.stop();
      const data: any = res.data;
      emit(data, options, () => {
        const reversed = data.reversed_count || 0;
        const failed = (data.failed_reversals || []).length;
        console.log(chalk.yellow(`✗ aborted — ${reversed} ops reversed${failed > 0 ? `, ${failed} failed` : ''}`));
        if (failed > 0) {
          for (const f of data.failed_reversals) {
            console.log(chalk.red(`  ✗ ${f}`));
          }
        }
      });
    } catch (e) {
      spinner?.stop();
      failApi(e);
    }
  });

transactionCommand
  .command('rollback <transactionId>')
  .description('Reverse a committed transaction — restores all entities to pre-transaction state')
  .option('--yes', 'Skip confirmation')
  .option('--json', 'Output as JSON')
  .action(async (transactionId, options) => {
    requireLogin();
    if (!options.yes) {
      const inquirer = (await import('inquirer')).default;
      const { confirm } = await inquirer.prompt([{ type: 'confirm', name: 'confirm', message: `Rollback committed transaction ${transactionId}? All mutations will be reversed.`, default: false }]);
      if (!confirm) { console.log(chalk.dim('Cancelled.')); return; }
    }
    const spinner = options.json ? null : ora('Reversing committed transaction...').start();
    try {
      const res = await apiClient.post(`/api/v1/agent/transaction/${transactionId}/rollback`);
      spinner?.stop();
      const data: any = res.data;
      emit(data, options, () => {
        const reversed = data.reversed_count || 0;
        const failed = (data.failed_reversals || []).length;
        console.log(chalk.green(`✓ Transaction rolled back — ${reversed} ops reversed${failed > 0 ? `, ${failed} failed` : ''}`));
        if (failed > 0) {
          for (const f of data.failed_reversals) {
            console.log(chalk.red(`  ✗ ${f}`));
          }
        }
      });
    } catch (e) {
      spinner?.stop();
      failApi(e);
    }
  });

transactionCommand
  .command('get <transactionId>')
  .description('Load a transaction\'s metadata + staged ops')
  .option('--json', 'Output as JSON')
  .action(async (transactionId, options) => {
    requireLogin();
    const spinner = options.json ? null : ora('Loading transaction...').start();
    try {
      const res = await apiClient.get(`/api/v1/agent/transaction/${transactionId}`);
      spinner?.stop();
      const data: any = res.data;
      emit(data, options, () => {
        if (!data.success) {
          console.error(chalk.red(`error: ${data.error_code}`));
          process.exit(1);
        }
        const t = data.transaction;
        console.log(chalk.cyan(`Transaction ${t.transaction_id}`));
        console.log(`  status:  ${t.status}`);
        console.log(`  tag:     ${t.tag ?? '-'}`);
        console.log(`  ops:     ${t.op_count}`);
        if (data.ops?.length) {
          console.log('');
          data.ops.forEach((op: any, i: number) => {
            console.log(`  [${i}] ${chalk.gray(op.verb)} ${op.receipt_id ? `(receipt:${op.receipt_id})` : ''}`);
          });
        }
      });
    } catch (e) {
      spinner?.stop();
      failApi(e);
    }
  });
