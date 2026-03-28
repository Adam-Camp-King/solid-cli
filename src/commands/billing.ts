import { Command } from 'commander';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';

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
      if (options.json) { console.log(JSON.stringify(res.data, null, 2)); return; }
      const d = res.data as any;
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
      if (options.json) { console.log(JSON.stringify(res.data, null, 2)); return; }
      const d = res.data as any;
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
      if (options.json) { console.log(JSON.stringify(res.data, null, 2)); return; }
      const invoices = (res.data as any).invoices || (res.data as any).items || [];
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
      const d = res.data as any;
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
      const d = res.data as any;
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
