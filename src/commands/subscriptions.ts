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
  .description('Cancel a customer subscription')
  .requiredOption('--customer <id>', 'Customer ID')
  .option('--reason <text>', 'Reason')
  .action(async (opts) => {
    requireAuth();
    const body: Record<string, unknown> = { customer_id: parseInt(opts.customer, 10) };
    if (opts.reason) body.reason = opts.reason;
    const s = ora('Cancelling...').start();
    try {
      await apiClient.post('/api/v1/subscriptions/cancel', body);
      s.succeed(chalk.green('Cancelled'));
    } catch (e) { fail(s, 'Failed', e); }
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
