/**
 * Email commands.
 * Wraps controllers/email_addresses.py (/api/v1/email/*) and
 * controllers/email_communication.py (/api/v1/EmailCommunication/*).
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

export const emailsCommand = new Command('emails')
  .alias('email')
  .description('Email — addresses, templates, send transactional messages');

// ── Addresses ────────────────────────────────────────────────────────

const addrCmd = new Command('addresses').alias('addr').description('Manage company email addresses');

{
  const { withListFlags } = require('../lib/command-kit') as typeof import('../lib/command-kit');
  const listCmd = addrCmd.command('list').description('List company email addresses');
  withListFlags(listCmd);
  listCmd.action(async (opts: import('../lib/command-kit').ListFlags) => {
    const { runListCommand } = await import('../lib/command-kit');
    await runListCommand(opts, {
      spinnerText: 'Loading addresses...',
      errorText: 'Failed to load addresses',
      fetch: async (offset, limit) =>
        (await apiClient.get('/api/v1/email/addresses', { params: { limit, offset } })).data,
      extract: (page) => {
        if (Array.isArray(page)) return page as Array<Record<string, unknown>>;
        const d = page as Record<string, unknown>;
        return ((d.addresses || d.items || []) as Array<Record<string, unknown>>);
      },
      render: (items) => {
        if (!items.length) { console.log(chalk.dim('  No addresses.')); return; }
        for (const a of items) {
          const def = a.is_default ? chalk.cyan(' (default)') : '';
          console.log(`  ${chalk.bold(String(a.id))}  ${a.email}${def}  ${chalk.dim(String(a.purpose || ''))}`);
        }
      },
    });
  });
}

addrCmd
  .command('get <id>')
  .description('Get an address')
  .option('--json', 'Output as JSON')
  .action(async (id, opts) => {
    requireAuth();
    const s = ora('Loading...').start();
    try {
      const res = await apiClient.get(`/api/v1/email/addresses/${id}`);
      if (opts.json) { s.stop(); console.log(JSON.stringify(res.data, null, 2)); return; }
      s.succeed(chalk.green('Address'));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { fail(s, 'Failed', e); }
  });

addrCmd
  .command('create')
  .description('Create an email address')
  .requiredOption('--email <email>', 'Full email address')
  .option('--display-name <name>', 'Display name')
  .option('--purpose <purpose>', 'Purpose (info, agent, user, transactional)')
  .action(async (opts) => {
    requireAuth();
    const body: Record<string, unknown> = { email: opts.email };
    if (opts.displayName) body.display_name = opts.displayName;
    if (opts.purpose) body.purpose = opts.purpose;
    const s = ora('Creating...').start();
    try {
      const res = await apiClient.post('/api/v1/email/addresses', body);
      s.succeed(chalk.green(`Address created: ${(res.data as any).id}`));
    } catch (e) { fail(s, 'Failed', e); }
  });

addrCmd
  .command('update <id>')
  .description('Update an address')
  .option('--display-name <name>')
  .option('--purpose <purpose>')
  .action(async (id, opts) => {
    requireAuth();
    const body: Record<string, unknown> = {};
    if (opts.displayName) body.display_name = opts.displayName;
    if (opts.purpose) body.purpose = opts.purpose;
    if (Object.keys(body).length === 0) { console.error(chalk.red('Nothing to update')); process.exit(1); }
    const s = ora('Updating...').start();
    try {
      await apiClient.put(`/api/v1/email/addresses/${id}`, body);
      s.succeed(chalk.green('Updated'));
    } catch (e) { fail(s, 'Failed', e); }
  });

addrCmd
  .command('delete <id>')
  .description('Delete an email address (prompts by default)')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (id: string, opts: { yes?: boolean }) => {
    requireAuth();
    const { confirm } = await import('../lib/command-kit');
    const ok = await confirm(`Delete email address ${id}?`, { autoConfirm: Boolean(opts.yes) });
    if (!ok) { console.error(chalk.dim('  Cancelled.')); process.exit(1); }
    const s = ora({ text: 'Deleting...', stream: process.stderr }).start();
    try {
      await apiClient.delete(`/api/v1/email/addresses/${id}`);
      s.succeed(chalk.green('Deleted'));
    } catch (e) { fail(s, 'Failed', e); }
  });

addrCmd
  .command('set-default <id>')
  .description('Set an address as the default')
  .action(async (id) => {
    requireAuth();
    const s = ora('Setting default...').start();
    try {
      await apiClient.post(`/api/v1/email/addresses/${id}/set-default`);
      s.succeed(chalk.green('Default set'));
    } catch (e) { fail(s, 'Failed', e); }
  });

addrCmd
  .command('for-purpose <purpose>')
  .description('Resolve the address used for a purpose (info, invoice, etc.)')
  .action(async (purpose) => {
    requireAuth();
    const s = ora('Resolving...').start();
    try {
      const res = await apiClient.get(`/api/v1/email/address-for-purpose/${purpose}`);
      s.succeed(chalk.green('Resolved'));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { fail(s, 'Failed', e); }
  });

addrCmd
  .command('usage')
  .description('Email address usage / limits')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const s = ora('Loading usage...').start();
    try {
      const [usage, limits] = await Promise.all([
        apiClient.get('/api/v1/email/usage'),
        apiClient.get('/api/v1/email/limits'),
      ]);
      const payload = { usage: usage.data, limits: limits.data };
      if (opts.json) { s.stop(); console.log(JSON.stringify(payload, null, 2)); return; }
      s.succeed(chalk.green('Email usage / limits'));
      console.log(JSON.stringify(payload, null, 2));
    } catch (e) { fail(s, 'Failed', e); }
  });

emailsCommand.addCommand(addrCmd);

// ── Templates ────────────────────────────────────────────────────────

emailsCommand
  .command('templates')
  .description('List email templates')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const s = ora('Loading templates...').start();
    try {
      const res = await apiClient.get('/api/v1/EmailCommunication/templates');
      if (opts.json) { s.stop(); console.log(JSON.stringify(res.data, null, 2)); return; }
      s.succeed(chalk.green('Templates'));
      const list = res.data as Record<string, any>[];
      for (const t of list ?? []) console.log(`  ${chalk.bold(t.template_name || t.name)}  ${chalk.dim(t.description || '')}`);
    } catch (e) { fail(s, 'Failed', e); }
  });

emailsCommand
  .command('template-vars <template_name>')
  .description('Show variables required by a template')
  .action(async (name) => {
    requireAuth();
    const s = ora('Loading...').start();
    try {
      const res = await apiClient.get(`/api/v1/EmailCommunication/templates/${name}/variables`);
      s.succeed(chalk.green('Template variables'));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { fail(s, 'Failed', e); }
  });

// ── Send ─────────────────────────────────────────────────────────────

emailsCommand
  .command('send <template_name>')
  .description('Send a transactional email using a template')
  .requiredOption('--to <email>', 'Recipient')
  .requiredOption('--vars <json>', 'JSON object of template variables')
  .option('--subject <subject>', 'Override subject')
  .action(async (name, opts) => {
    requireAuth();
    let vars: unknown;
    try {
      vars = JSON.parse(opts.vars);
    } catch {
      console.error(chalk.red('Invalid JSON passed to --vars'));
      process.exit(1);
    }
    const body: Record<string, unknown> = {
      to: opts.to,
      variables: vars,
    };
    if (opts.subject) body.subject = opts.subject;
    const s = ora(`Sending ${name}...`).start();
    try {
      await apiClient.post(`/api/v1/EmailCommunication/send/${name}`, body);
      s.succeed(chalk.green('Sent'));
    } catch (e) { fail(s, 'Failed', e); }
  });

emailsCommand
  .command('send-invoice')
  .description('Send an invoice email')
  .requiredOption('--invoice <id>', 'Invoice ID')
  .requiredOption('--to <email>', 'Recipient')
  .action(async (opts) => {
    requireAuth();
    const s = ora('Sending invoice email...').start();
    try {
      await apiClient.post('/api/v1/EmailCommunication/send/invoice', {
        invoice_id: parseInt(opts.invoice, 10),
        to: opts.to,
      });
      s.succeed(chalk.green('Invoice email sent'));
    } catch (e) { fail(s, 'Failed', e); }
  });

emailsCommand
  .command('send-payment-link')
  .description('Send a payment link email')
  .requiredOption('--link <id>', 'Payment link ID')
  .requiredOption('--to <email>', 'Recipient')
  .action(async (opts) => {
    requireAuth();
    const s = ora('Sending...').start();
    try {
      await apiClient.post('/api/v1/EmailCommunication/send/payment-link', {
        link_id: parseInt(opts.link, 10),
        to: opts.to,
      });
      s.succeed(chalk.green('Payment link email sent'));
    } catch (e) { fail(s, 'Failed', e); }
  });
