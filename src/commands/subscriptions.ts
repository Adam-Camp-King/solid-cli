/**
 * Subscriptions — wraps controllers/subscriptions.py at /api/v1/subscriptions/*.
 *
 * ⚠️ That controller is Solid#'s OWN billing of this company (BillingCustomer
 * keyed by tenant_id), not subscriptions this company sells. `list` is
 * honest about that; see the note above it.
 */

import { Command } from 'commander';
import ora from '../lib/spinner';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient } from '../lib/api-client';
import { isJsonOutput } from '../lib/json-output';

function requireAuth() {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
}

export const subscriptionsCommand = new Command('subscriptions')
  .alias('subs')
  .description('Recurring subscription products you sell to YOUR customers');

/**
 * ⛔ GET /api/v1/subscriptions takes NO query parameters and returns ONE
 * object: this company's own Solid# plan (tier, status, period end) — not a
 * list of subscriptions the company sells. The old `list` sent page_size /
 * offset / customer_id / status, which the route never declared and silently
 * dropped, then looked for an array that is never there and printed "No
 * subscriptions found" for every tenant. Those flags are gone; this prints
 * what the route actually returns, and says what it is.
 */
subscriptionsCommand
  .command('list').alias('ls')
  .description('Show this company\'s Solid# plan subscription (the route returns one plan, not a list)')
  .option('--json', 'Output as JSON')
  .action(async (opts: { json?: boolean }) => {
    requireAuth();
    const s = ora({ text: 'Loading subscription...', stream: process.stderr }).start();
    try {
      const res = await apiClient.get('/api/v1/subscriptions');
      s.stop();
      const d = (res.data || {}) as Record<string, unknown>;
      if (isJsonOutput(opts)) { console.log(JSON.stringify(d, null, 2)); return; }
      console.log('');
      console.log(`  ${chalk.bold('Solid# plan')}  company ${d.company_id ?? '—'}`);
      console.log(`  ${chalk.dim('tier:')}    ${d.tier ?? '—'}`);
      console.log(`  ${chalk.dim('status:')}  ${d.status ?? '—'}`);
      if (d.billing_account === false) {
        console.log(`  ${chalk.dim(String(d.summary || 'No billing account.'))}`);
      } else {
        if (d.current_period_end && d.current_period_end !== 'None') console.log(`  ${chalk.dim('renews:')}  ${d.current_period_end}`);
        if (d.cancel_at_period_end) console.log(`  ${chalk.yellow('cancels at period end')}`);
      }
      console.log('');
      console.log(chalk.dim('  Plan changes and invoices: solid billing'));
      console.log('');
    } catch (e) { fail(s, 'Failed to load subscription', e); }
  });

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

import { appendExamples as __appendExamplesSubs, fail } from '../lib/command-kit';
__appendExamplesSubs(subscriptionsCommand, [
  { cmd: 'solid subs list', why: 'This company\'s Solid# plan: tier, status, renewal' },
  { cmd: 'solid subs upgrade --customer <id> --plan <plan-id>', why: 'Enroll a customer' },
  { cmd: 'solid subs cancel --customer <id> --yes', why: 'Cancel at period end' },
]);
