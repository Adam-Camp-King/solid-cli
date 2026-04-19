import { Command } from 'commander';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';
import { isJsonOutput } from '../lib/json-output';

export const billingCommand = new Command('billing')
  .description('Subscription, usage, and invoices')
  .action(async () => { billingCommand.outputHelp(); });

billingCommand.command('status').description('Current subscription and usage')
  .option('--json', 'JSON output')
  .action(async (options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Loading billing...').start();
    try {
      const res = await apiClient.get('/api/v1/billing/overview');
      spinner.stop();
      if (isJsonOutput(options)) { console.log(JSON.stringify(res.data, null, 2)); return; }
      const d = res.data as Record<string, any>;
      console.log('');
      console.log(ui.header('Subscription'));
      if (d.tier || d.plan) console.log(ui.label('Tier', chalk.hex('#818cf8')(d.tier || d.plan)));
      if (d.status) console.log(ui.label('Status', d.status === 'active' ? chalk.green(d.status) : chalk.yellow(d.status)));
      if (d.current_period_end) console.log(ui.label('Renews', d.current_period_end));
      if (d.amount) console.log(ui.label('Amount', chalk.green(`$${d.amount}/mo`)));
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });

billingCommand.command('usage').description('Current period usage (tokens, storage, API calls)')
  .option('--json', 'JSON output')
  .action(async (options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Loading usage...').start();
    try {
      const res = await apiClient.get('/api/v1/billing/current-statement');
      spinner.stop();
      if (isJsonOutput(options)) { console.log(JSON.stringify(res.data, null, 2)); return; }
      const d = res.data as Record<string, any>;
      console.log('');
      console.log(ui.header('Usage This Period'));
      if (d.tokens_used !== undefined) console.log(ui.label('AI Tokens', d.tokens_used.toLocaleString()));
      if (d.token_limit !== undefined) console.log(ui.label('Token Limit', d.token_limit.toLocaleString()));
      if (d.api_calls !== undefined) console.log(ui.label('API Calls', d.api_calls.toLocaleString()));
      if (d.storage_mb !== undefined) console.log(ui.label('Storage', `${d.storage_mb} MB`));
      if (d.voice_minutes !== undefined) console.log(ui.label('Voice Min', String(d.voice_minutes)));
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });

billingCommand.command('invoices').description('List invoices')
  .option('--limit <n>', 'Count', '10').option('--json', 'JSON output')
  .action(async (options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Loading invoices...').start();
    try {
      const res = await apiClient.get('/api/v1/billing/invoices', { params: { limit: options.limit } });
      spinner.stop();
      if (isJsonOutput(options)) { console.log(JSON.stringify(res.data, null, 2)); return; }
      const invoices = (res.data as Record<string, any>).invoices || (res.data as Record<string, any>).items || [];
      console.log('');
      console.log(ui.header(`Invoices (${invoices.length})`));
      if (invoices.length === 0) { console.log(chalk.dim('  No invoices yet.')); }
      else { for (const inv of invoices) { const status = inv.status === 'paid' ? chalk.green('paid') : chalk.yellow(inv.status); console.log(`  ${inv.date || inv.created_at}  $${inv.amount || inv.total}  ${status}`); } }
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });

// Generate checkout link for a client company
billingCommand.command('checkout-link <companyId>')
  .description('Generate a Stripe checkout URL for a client company')
  .option('-t, --tier <tier>', 'Subscription tier', 'starter')
  .action(async (companyId: string, options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Generating checkout link...').start();
    try {
      const res = await apiClient.post('/api/v1/billing/checkout-link', {
        company_id: parseInt(companyId, 10),
        tier_slug: options.tier,
      });
      const d = res.data as Record<string, any>;
      spinner.succeed(chalk.green('Checkout link ready'));
      console.log('');
      console.log(`  ${chalk.bold('URL:')}     ${chalk.cyan(d.url)}`);
      console.log(`  ${chalk.bold('Tier:')}    ${d.tier_slug}`);
      console.log(`  ${chalk.bold('Amount:')}  $${(d.amount_cents / 100).toFixed(2)}/mo`);
      console.log('');
      console.log(chalk.dim('  Send this link to your client. When they pay, their account activates automatically.'));
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });

// Create and send an invoice
billingCommand.command('invoice <companyIdOrEmail>')
  .description('Send a Stripe invoice to a client')
  .requiredOption('-a, --amount <cents>', 'Amount in cents (8900 = $89.00)')
  .requiredOption('-d, --description <text>', 'Invoice description')
  .option('--due <days>', 'Days until due', '30')
  .option('--type <type>', 'Invoice type (agency_service, platform_subscription)', 'agency_service')
  .action(async (target: string, options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const amountCents = parseInt(options.amount, 10);
    if (isNaN(amountCents) || amountCents <= 0) {
      console.error(chalk.red('Amount must be a positive number in cents (e.g., 8900 = $89.00)'));
      process.exit(1);
    }

    const isEmail = target.includes('@');
    const spinner = ora(`Sending invoice for $${(amountCents / 100).toFixed(2)}...`).start();

    try {
      const body: Record<string, unknown> = {
        amount_cents: amountCents,
        description: options.description,
        days_until_due: parseInt(options.due, 10),
        invoice_type: options.type,
      };
      if (isEmail) {
        body.email = target;
      } else {
        body.company_id = parseInt(target, 10);
      }

      const res = await apiClient.post('/api/v1/billing/invoice', body);
      const d = res.data as Record<string, any>;
      spinner.succeed(chalk.green(`Invoice sent to ${d.recipient}`));
      console.log('');
      console.log(`  ${chalk.bold('Invoice:')}  ${d.invoice_id}`);
      console.log(`  ${chalk.bold('Amount:')}   $${(d.amount_cents / 100).toFixed(2)}`);
      console.log(`  ${chalk.bold('Due:')}      ${d.due_date?.split('T')[0]}`);
      console.log(`  ${chalk.bold('Pay URL:')} ${chalk.cyan(d.hosted_url)}`);
      if (d.pdf_url) console.log(`  ${chalk.bold('PDF:')}     ${d.pdf_url}`);
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed to send invoice')); console.error(handleApiError(e).message); }
  });

// Download an invoice PDF
billingCommand.command('invoice-pdf <invoiceId>')
  .description('Download an invoice as PDF (accepts Stripe in_... id or internal numeric id)')
  .option('--out <file>', 'Output file path (default: invoice-<id>.pdf)')
  .action(async (invoiceId: string, options: { out?: string }) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora(`Fetching invoice ${invoiceId} PDF...`).start();
    try {
      const fs = await import('fs');
      const res = await apiClient.get(`/api/v1/billing/invoices/${encodeURIComponent(invoiceId)}/pdf`, {
        responseType: 'arraybuffer',
      });
      const filename = options.out || `invoice-${invoiceId}.pdf`;
      fs.writeFileSync(filename, Buffer.from(res.data as ArrayBuffer));
      spinner.succeed(chalk.green(`Saved: ${filename}`));
    } catch (e) { spinner.fail(chalk.red('Failed to download invoice PDF')); console.error(handleApiError(e).message); }
  });

// ── Payment methods ──────────────────────────────────────────────────

billingCommand.command('methods').description('List saved payment methods')
  .option('--json', 'JSON output')
  .action(async (options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Loading payment methods...').start();
    try {
      const res = await apiClient.get('/api/v1/billing/payment-methods');
      const data = res.data as Record<string, any>;
      const items = data.payment_methods || data.items || [];
      if (isJsonOutput(options)) { spinner.stop(); console.log(JSON.stringify(data, null, 2)); return; }
      spinner.succeed(chalk.green(`${items.length} payment method(s)`));
      console.log('');
      for (const m of items as Record<string, any>[]) {
        const def = m.is_default ? chalk.cyan(' (default)') : '';
        console.log(`  ${chalk.bold(m.id)}  ${m.brand || m.type || '—'} •••• ${m.last4 || '????'}  ${chalk.dim(`${m.exp_month}/${m.exp_year}`)}${def}`);
        if (m.nickname) console.log(chalk.dim(`      ${m.nickname}`));
      }
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });

billingCommand.command('method-add').description('Attach a new payment method from a Stripe token')
  .requiredOption('--token <pm>', 'Stripe payment method token (pm_...)')
  .action(async (options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Attaching payment method...').start();
    try {
      const res = await apiClient.post('/api/v1/billing/payment-method/add', { payment_method_token: options.token });
      spinner.succeed(chalk.green(`Payment method attached: ${(res.data as Record<string, any>).id}`));
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });

billingCommand.command('method-default <id>').description('Set a payment method as default')
  .action(async (id) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora(`Setting ${id} as default...`).start();
    try {
      await apiClient.patch(`/api/v1/billing/payment-method/${id}/set-default`);
      spinner.succeed(chalk.green('Default set'));
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });

billingCommand.command('method-nickname <id>').description('Rename a payment method')
  .requiredOption('--nickname <text>', 'Nickname')
  .action(async (id, options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Updating nickname...').start();
    try {
      await apiClient.patch(`/api/v1/billing/payment-method/${id}/nickname`, { nickname: options.nickname });
      spinner.succeed(chalk.green('Nickname updated'));
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });

billingCommand.command('method-remove <id>').description('Remove a payment method')
  .action(async (id) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora(`Removing ${id}...`).start();
    try {
      await apiClient.delete(`/api/v1/billing/payment-method/${id}`);
      spinner.succeed(chalk.green('Removed'));
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });

// ── Charges, statement, subscription detail ──────────────────────────

billingCommand.command('charges').description('List charges')
  .option('-l, --limit <n>', 'Max results', '50')
  .option('--json', 'JSON output')
  .action(async (options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Loading charges...').start();
    try {
      const res = await apiClient.get('/api/v1/billing/charges', { params: { limit: parseInt(options.limit, 10) } });
      const data = res.data as Record<string, any>;
      const items = data.charges || data.items || [];
      if (isJsonOutput(options)) { spinner.stop(); console.log(JSON.stringify(data, null, 2)); return; }
      spinner.succeed(chalk.green(`${items.length} charge(s)`));
      console.log('');
      for (const c of items as Record<string, any>[]) {
        console.log(`  ${chalk.bold(c.id)}  $${c.amount || (c.amount_cents / 100).toFixed(2)}  ${chalk.dim(c.status || '')}  ${chalk.dim(c.created_at?.split('T')[0] || '')}`);
      }
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });

billingCommand.command('statement').description('Current billing statement')
  .option('--json', 'JSON output')
  .action(async (options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Loading statement...').start();
    try {
      const res = await apiClient.get('/api/v1/billing/current-statement');
      if (isJsonOutput(options)) { spinner.stop(); console.log(JSON.stringify(res.data, null, 2)); return; }
      spinner.succeed(chalk.green('Current statement'));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });

billingCommand.command('subscription <customerId>').description('Subscription details for a customer')
  .option('--json', 'JSON output')
  .action(async (customerId, options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Loading...').start();
    try {
      const res = await apiClient.get(`/api/v1/billing/subscription/${customerId}`);
      if (isJsonOutput(options)) { spinner.stop(); console.log(JSON.stringify(res.data, null, 2)); return; }
      spinner.succeed(chalk.green('Subscription'));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });

billingCommand.command('trial').description('Trial status')
  .action(async () => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Loading trial status...').start();
    try {
      const res = await apiClient.get('/api/v1/billing/trial-status');
      spinner.succeed(chalk.green('Trial'));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });

billingCommand.command('upgrade-trial').description('Convert trial to paid subscription')
  .requiredOption('--plan <slug>', 'Target plan slug')
  .action(async (options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Upgrading trial...').start();
    try {
      await apiClient.post('/api/v1/billing/upgrade-trial', { plan_slug: options.plan });
      spinner.succeed(chalk.green('Trial upgraded'));
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });

import { appendExamples as __appendExamplesBilling } from '../lib/command-kit';
__appendExamplesBilling(billingCommand, [
  { cmd: 'solid billing status', why: 'Tier, next invoice, usage caps' },
  { cmd: 'solid billing usage --range 30d', why: 'Metered usage (SMS, calls, AI tokens)' },
  { cmd: 'solid billing invoices', why: 'Past invoices + payment status' },
  { cmd: 'solid billing checkout-link --amount 199', why: 'One-off invoice → Stripe checkout URL' },
  { cmd: 'solid billing invoice --customer <id> --amount 500', why: 'Bill a specific customer' },
]);
