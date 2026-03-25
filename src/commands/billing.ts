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
      const res = await apiClient.get('/api/v1/billing/subscription');
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
      const res = await apiClient.get('/api/v1/billing/usage');
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
