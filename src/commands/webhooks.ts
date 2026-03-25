/**
 * Webhooks command for Solid CLI — custom webhook management.
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';

export const webhooksCommand = new Command('webhooks')
  .description('Custom webhook management')
  .action(async () => { webhooksCommand.outputHelp(); });

webhooksCommand.command('list').description('List configured webhooks')
  .option('--json', 'JSON output')
  .action(async (options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Loading webhooks...').start();
    try {
      const res = await apiClient.get('/api/v1/developer/webhooks');
      spinner.stop();
      if (options.json) { console.log(JSON.stringify(res.data, null, 2)); return; }
      const hooks = (res.data as any).webhooks || (res.data as any).items || [];
      console.log('');
      console.log(ui.header(`Webhooks (${hooks.length})`));
      if (hooks.length === 0) { console.log(chalk.dim('  No webhooks. Use `solid webhooks create` to add one.')); }
      else { for (const h of hooks) { const s = h.is_active ? chalk.green('●') : chalk.red('●'); console.log(`  ${s} ${chalk.bold(h.name || h.url)}`); console.log(chalk.dim(`    ${h.url}`)); if (h.events) console.log(chalk.dim(`    Events: ${Array.isArray(h.events) ? h.events.join(', ') : h.events}`)); } }
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });

webhooksCommand.command('create <url>').description('Create a webhook')
  .option('-n, --name <name>', 'Name').option('-e, --events <events>', 'Comma-separated events')
  .action(async (url, options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Creating...').start();
    try {
      const events = options.events ? options.events.split(',').map((e: string) => e.trim()) : [];
      const res = await apiClient.post('/api/v1/developer/webhooks', { url, name: options.name || url, events });
      spinner.stop();
      const d = res.data as any;
      console.log('');
      console.log(ui.successBox('Webhook Created', [`${chalk.dim('URL:')}    ${url}`, `${chalk.dim('ID:')}     ${d.id || 'n/a'}`, `${chalk.dim('Secret:')} ${d.secret || 'check dashboard'}`]));
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });

webhooksCommand.command('delete <id>').description('Delete a webhook')
  .action(async (id) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Deleting...').start();
    try {
      await apiClient.delete(`/api/v1/developer/webhooks/${id}`);
      spinner.succeed(chalk.green(`Webhook ${id} deleted`));
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });
