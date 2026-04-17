/**
 * Payment links — create, text-to-pay, mark paid.
 * Wraps controllers/payment_links.py at /api/v1/payment-links/*.
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

export const paymentLinksCommand = new Command('payment-links')
  .alias('paylinks')
  .description('Pay-by-link — create, text-to-pay, mark paid');

paymentLinksCommand
  .command('list')
  .description('List payment links')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const s = ora('Loading...').start();
    try {
      const res = await apiClient.get('/api/v1/payment-links/');
      const data = res.data as Record<string, any>;
      const items = data.links || data.items || data;
      const list = Array.isArray(items) ? items : (items.links || []);
      if (opts.json) { s.stop(); console.log(JSON.stringify(data, null, 2)); return; }
      s.succeed(chalk.green(`${list.length} link(s)`));
      for (const l of list as Record<string, any>[]) {
        const status = l.status === 'paid' ? chalk.green(l.status) : chalk.yellow(l.status);
        console.log(`  ${chalk.bold(l.id)}  $${l.amount}  ${status}  ${chalk.dim(l.description || '')}`);
      }
    } catch (e) { fail(s, 'Failed', e); }
  });

paymentLinksCommand
  .command('get <id>')
  .description('Get a payment link')
  .option('--json', 'Output as JSON')
  .action(async (id, opts) => {
    requireAuth();
    const s = ora('Loading...').start();
    try {
      const res = await apiClient.get(`/api/v1/payment-links/${id}`);
      if (opts.json) { s.stop(); console.log(JSON.stringify(res.data, null, 2)); return; }
      s.succeed(chalk.green(`Payment link ${id}`));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { fail(s, 'Failed', e); }
  });

paymentLinksCommand
  .command('create')
  .description('Create a payment link')
  .requiredOption('--amount <dollars>', 'Amount in dollars')
  .option('--description <text>', 'Description')
  .option('--customer-email <email>', 'Customer email')
  .action(async (opts) => {
    requireAuth();
    const body: Record<string, unknown> = { amount: parseFloat(opts.amount) };
    if (opts.description) body.description = opts.description;
    if (opts.customerEmail) body.customer_email = opts.customerEmail;
    const s = ora('Creating payment link...').start();
    try {
      const res = await apiClient.post('/api/v1/payment-links/create', body);
      const r = res.data as Record<string, any>;
      s.succeed(chalk.green(`Link created: ${r.id}`));
      if (r.url) console.log(chalk.cyan(`  ${r.url}`));
    } catch (e) { fail(s, 'Failed', e); }
  });

paymentLinksCommand
  .command('text2pay')
  .description('Send a payment link via SMS (text-to-pay)')
  .requiredOption('--phone <e164>', 'Phone number')
  .requiredOption('--amount <dollars>', 'Amount')
  .option('--description <text>', 'Description')
  .action(async (opts) => {
    requireAuth();
    const body: Record<string, unknown> = {
      phone: opts.phone,
      amount: parseFloat(opts.amount),
    };
    if (opts.description) body.description = opts.description;
    const s = ora('Sending text-to-pay...').start();
    try {
      const res = await apiClient.post('/api/v1/payment-links/send-text2pay', body);
      const r = res.data as Record<string, any>;
      s.succeed(chalk.green('SMS sent'));
      if (r.link_id) console.log(chalk.dim(`  link_id: ${r.link_id}`));
    } catch (e) { fail(s, 'Failed', e); }
  });

paymentLinksCommand
  .command('mark-paid <id>')
  .description('Mark a payment link as paid')
  .option('--amount <dollars>', 'Amount paid (if different from original)')
  .action(async (id, opts) => {
    requireAuth();
    const body: Record<string, unknown> = { link_id: parseInt(id, 10) };
    if (opts.amount) body.amount = parseFloat(opts.amount);
    const s = ora('Marking paid...').start();
    try {
      await apiClient.post('/api/v1/payment-links/mark-paid', body);
      s.succeed(chalk.green('Marked paid'));
    } catch (e) { fail(s, 'Failed', e); }
  });

paymentLinksCommand
  .command('delete <id>')
  .description('Delete a payment link')
  .action(async (id) => {
    requireAuth();
    const s = ora('Deleting...').start();
    try {
      await apiClient.delete(`/api/v1/payment-links/${id}`);
      s.succeed(chalk.green('Deleted'));
    } catch (e) { fail(s, 'Failed', e); }
  });
