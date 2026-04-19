/**
 * Subscriptions — client-facing subscription product management.
 * Wraps controllers/subscriptions.py at /api/v1/subscriptions/*.
 *
 * NOTE: these are subscriptions THIS COMPANY sells, not their Solid# plan.
 * For the Solid# plan use `solid billing`.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { isJsonOutput } from '../lib/json-output';

function requireAuth() {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
}
function fail(s: ReturnType<typeof ora>, m: string, e: unknown) { s.fail(chalk.red(m)); console.error(chalk.red(`  ${handleApiError(e).message}`)); }

export const subscriptionsCommand = new Command('subscriptions')
  .alias('subs')
  .description('Recurring subscription products you sell to YOUR customers');

{
  const { withListFlags } = require('../lib/command-kit') as typeof import('../lib/command-kit');
  const listCmd = subscriptionsCommand.command('list').alias('ls').description('List active subscriptions for a customer (or all)');
  withListFlags(listCmd, '50');
  listCmd.option('--customer <id>', 'Filter by customer ID');
  listCmd.option('--status <status>', 'Filter by status (active, cancelled, past_due)');
  listCmd.action(async (opts: { customer?: string; status?: string } & import('../lib/command-kit').ListFlags) => {
    requireAuth();
    const { runListCommand } = await import('../lib/command-kit');
    await runListCommand(opts, {
      spinnerText: 'Loading subscriptions...',
      errorText: 'Failed to load subscriptions',
      fetch: async (offset, limit) => {
        const params: Record<string, unknown> = { page_size: limit, offset };
        if (opts.customer) params.customer_id = parseInt(opts.customer, 10);
        if (opts.status) params.status = opts.status;
        return (await apiClient.get('/api/v1/subscriptions', { params })).data;
      },
      extract: (page) => {
        const d = page as Record<string, unknown>;
        return ((d.subscriptions || d.items || []) as Array<Record<string, unknown>>);
      },
      render: (items) => {
        if (!items.length) { console.log(chalk.dim('  No subscriptions found.')); return; }
        console.log('');
        for (const sub of items) {
          const status = sub.status === 'active' ? chalk.green('active') : chalk.yellow(String(sub.status || '?'));
          console.log(`  #${sub.id}  ${sub.customer_name || sub.customer_id || '—'}  ${status}  ${sub.plan_name || sub.plan_slug || '—'}`);
        }
        console.log('');
      },
    });
  });
}

subscriptionsCommand
  .command('get <id>')
  .description('Get subscription detail by ID')
  .option('--json', 'Output as JSON')
  .action(async (id: string, opts: { json?: boolean }) => {
    requireAuth();
    const s = ora({ text: `Loading subscription ${id}...`, stream: process.stderr }).start();
    try {
      const res = await apiClient.get(`/api/v1/subscriptions/${id}`);
      s.stop();
      if (isJsonOutput(opts)) { console.log(JSON.stringify(res.data, null, 2)); return; }
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { fail(s, 'Failed', e); process.exit(1); }
  });

subscriptionsCommand
  .command('upgrade')
  .description('Upgrade a customer subscription')
  .requiredOption('--customer <id>', 'Customer ID')
  .requiredOption('--plan <slug>', 'Target plan slug')
  .action(async (opts) => {
    requireAuth();
    const s = ora('Upgrading subscription...').start();
    try {
      await apiClient.post('/api/v1/subscriptions/upgrade', {
        customer_id: parseInt(opts.customer, 10),
        plan_slug: opts.plan,
      });
      s.succeed(chalk.green('Upgraded'));
    } catch (e) { fail(s, 'Failed', e); }
  });

subscriptionsCommand
  .command('downgrade')
  .description('Downgrade a customer subscription')
  .requiredOption('--customer <id>', 'Customer ID')
  .requiredOption('--plan <slug>', 'Target plan slug')
  .action(async (opts) => {
    requireAuth();
    const s = ora('Downgrading...').start();
    try {
      await apiClient.post('/api/v1/subscriptions/downgrade', {
        customer_id: parseInt(opts.customer, 10),
        plan_slug: opts.plan,
      });
      s.succeed(chalk.green('Downgraded'));
    } catch (e) { fail(s, 'Failed', e); }
  });

subscriptionsCommand
  .command('cancel')
  .description('Cancel a customer subscription (prompts by default)')
  .requiredOption('--customer <id>', 'Customer ID')
  .option('--reason <text>', 'Reason')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (opts: { customer: string; reason?: string; yes?: boolean }) => {
    requireAuth();
    const { confirm } = await import('../lib/command-kit');
    const ok = await confirm(`Cancel subscription for customer ${opts.customer}?`, { autoConfirm: Boolean(opts.yes) });
    if (!ok) { console.error(chalk.dim('  Cancelled.')); process.exit(1); }
    const body: Record<string, unknown> = { customer_id: parseInt(opts.customer, 10) };
    if (opts.reason) body.reason = opts.reason;
    const s = ora({ text: 'Cancelling...', stream: process.stderr }).start();
    try {
      await apiClient.post('/api/v1/subscriptions/cancel', body);
      s.succeed(chalk.green('Cancelled'));
    } catch (e) { fail(s, 'Failed', e); process.exit(1); }
  });

subscriptionsCommand
  .command('reactivate')
  .description('Reactivate a cancelled subscription')
  .requiredOption('--customer <id>', 'Customer ID')
  .action(async (opts) => {
    requireAuth();
    const s = ora('Reactivating...').start();
    try {
      await apiClient.post('/api/v1/subscriptions/reactivate', {
        customer_id: parseInt(opts.customer, 10),
      });
      s.succeed(chalk.green('Reactivated'));
    } catch (e) { fail(s, 'Failed', e); }
  });

subscriptionsCommand
  .command('health')
  .description('Subscription subsystem health')
  .action(async () => {
    requireAuth();
    const s = ora('Checking...').start();
    try {
      const res = await apiClient.get('/api/v1/subscriptions/health');
      s.succeed(chalk.green('Health'));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { fail(s, 'Failed', e); }
  });
