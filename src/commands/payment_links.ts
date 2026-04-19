/**
 * Payment links — create, text-to-pay, mark paid.
 * Wraps controllers/payment_links.py at /api/v1/payment-links/*.
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

export const paymentLinksCommand = new Command('payment-links')
  .alias('paylinks')
  .description('Pay-by-link — create, text-to-pay, mark paid');

{
  const { withListFlags } = require('../lib/command-kit') as typeof import('../lib/command-kit');
  const listCmd = paymentLinksCommand.command('list').alias('ls').description('List payment links');
  withListFlags(listCmd);
  listCmd.action(async (opts: import('../lib/command-kit').ListFlags) => {
    requireAuth();
    const { runListCommand } = await import('../lib/command-kit');
    await runListCommand(opts, {
      spinnerText: 'Loading payment links...',
      errorText: 'Failed to load payment links',
      fetch: async (offset, limit) =>
        (await apiClient.get('/api/v1/payment-links/', { params: { limit, offset } })).data,
      extract: (page) => {
        if (Array.isArray(page)) return page as Array<Record<string, unknown>>;
        const d = page as Record<string, unknown>;
        return ((d.links || d.items || []) as Array<Record<string, unknown>>);
      },
      render: (items) => {
        if (!items.length) { console.log(chalk.dim('  No payment links.')); return; }
        for (const l of items) {
          const status = l.status === 'paid' ? chalk.green(String(l.status)) : chalk.yellow(String(l.status || ''));
          console.log(`  ${chalk.bold(String(l.id))}  $${l.amount}  ${status}  ${chalk.dim(String(l.description || ''))}`);
        }
      },
    });
  });
}

paymentLinksCommand
  .command('get <id>')
  .description('Get a payment link')
  .option('--json', 'Output as JSON')
  .action(async (id, opts) => {
    requireAuth();
    const s = ora('Loading...').start();
    try {
      const res = await apiClient.get(`/api/v1/payment-links/${id}`);
      if (isJsonOutput(opts)) { s.stop(); console.log(JSON.stringify(res.data, null, 2)); return; }
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
  .description('Send a payment link via SMS (prompts + SMS preview by default)')
  .requiredOption('--phone <e164>', 'Phone number')
  .requiredOption('--amount <dollars>', 'Amount')
  .option('--description <text>', 'Description')
  .option('--preview', 'Render the SMS body without sending')
  .option('-y, --yes', 'Skip confirmation prompt (for CI)')
  .action(async (opts: { phone: string; amount: string; description?: string; preview?: boolean; yes?: boolean }) => {
    requireAuth();
    const amountNum = parseFloat(opts.amount);
    const body: Record<string, unknown> = { phone: opts.phone, amount: amountNum };
    if (opts.description) body.description = opts.description;

    // Preview mimics the server template so you see what the customer sees.
    // Server may tweak copy; treat this as an approximation, not a contract.
    const fauxSms = [
      `You have a new payment request${opts.description ? ': ' + opts.description : ''}.`,
      `Amount: $${amountNum.toFixed(2)}`,
      'Pay: https://pay.solidnumber.com/…',
    ].join('\n');

    console.error('');
    console.error(chalk.bold('  SMS preview'));
    console.error(chalk.dim('  ──────────────────────────────────────'));
    console.error(chalk.dim(`  To:  ${opts.phone}`));
    console.error('');
    fauxSms.split('\n').forEach((line) => console.error(`  ${line}`));
    console.error('');

    if (opts.preview) { console.error(chalk.yellow('  (preview only — nothing sent)')); return; }

    const { confirm } = await import('../lib/command-kit');
    const ok = await confirm(`Send this SMS to ${opts.phone}?`, { autoConfirm: Boolean(opts.yes) });
    if (!ok) { console.error(chalk.dim('  Cancelled.')); process.exit(1); }

    const s = ora({ text: 'Sending text-to-pay...', stream: process.stderr }).start();
    try {
      const res = await apiClient.post('/api/v1/payment-links/send-text2pay', body);
      const r = res.data as Record<string, unknown>;
      s.succeed(chalk.green('SMS sent'));
      if (r.link_id) console.log(chalk.dim(`  link_id: ${r.link_id}`));
    } catch (e) { fail(s, 'Failed', e); process.exit(1); }
  });

paymentLinksCommand
  .command('mark-paid <id>')
  .description('Mark a payment link as paid')
  .option('--amount <dollars>', 'Amount paid (if different from original)')
  .action(async (id, opts) => {
    requireAuth();
    const body: Record<string, unknown> = { link_id: parseInt(id, 10) };
    if (opts.amount) body.amount = parseFloat(opts.amount);
    const s = ora({ text: 'Marking paid...', stream: process.stderr }).start();
    try {
      await apiClient.post('/api/v1/payment-links/mark-paid', body);
      s.succeed(chalk.green('Marked paid'));
    } catch (e) { fail(s, 'Failed', e); }
  });

paymentLinksCommand
  .command('delete <id>')
  .description('Delete a payment link (prompts by default)')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (id: string, opts: { yes?: boolean }) => {
    requireAuth();
    const { confirm } = await import('../lib/command-kit');
    const ok = await confirm(`Delete payment link ${id}?`, { autoConfirm: Boolean(opts.yes) });
    if (!ok) { console.error(chalk.dim('  Cancelled.')); process.exit(1); }
    const s = ora({ text: 'Deleting...', stream: process.stderr }).start();
    try {
      await apiClient.delete(`/api/v1/payment-links/${id}`);
      s.succeed(chalk.green('Deleted'));
    } catch (e) { fail(s, 'Failed', e); }
  });

import { appendExamples as __ae_pl } from '../lib/command-kit';
__ae_pl(paymentLinksCommand, [
  { cmd: 'solid paylinks list',                                       why: 'Your payment links' },
  { cmd: 'solid paylinks create --amount 99 --description "Consult"', why: 'Generate a new link' },
  { cmd: 'solid paylinks text2pay --phone +15125550199 --amount 99',  why: 'Text-to-pay an invoice' },
  { cmd: 'solid paylinks mark-paid <id>',                             why: 'Manual payment reconciliation' },
]);
