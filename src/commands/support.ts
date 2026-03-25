/**
 * Support command for Solid CLI — customer support tickets.
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';

export const supportCommand = new Command('support')
  .description('Customer support tickets')
  .action(async () => { supportCommand.outputHelp(); });

supportCommand.command('list').description('List support tickets')
  .option('--status <status>', 'Filter: open, closed, pending')
  .option('--limit <n>', 'Count', '20').option('--json', 'JSON output')
  .action(async (options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Loading tickets...').start();
    try {
      const params: Record<string, unknown> = { limit: options.limit };
      if (options.status) params.status = options.status;
      const res = await apiClient.get('/api/v1/support/tickets', { params });
      spinner.stop();
      if (options.json) { console.log(JSON.stringify(res.data, null, 2)); return; }
      const tickets = (res.data as any).tickets || (res.data as any).items || [];
      console.log('');
      console.log(ui.header(`Support Tickets (${tickets.length})`));
      if (tickets.length === 0) { console.log(chalk.dim('  No tickets.')); }
      else { for (const t of tickets) { const s = t.status === 'open' ? chalk.green('●') : t.status === 'pending' ? chalk.yellow('●') : chalk.dim('●'); const p = t.priority === 'high' ? chalk.red(' [HIGH]') : ''; console.log(`  ${s} #${t.id}${p} ${t.subject || t.title}`); } }
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });

supportCommand.command('get <id>').description('View ticket details')
  .option('--json', 'JSON output')
  .action(async (id, options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Loading...').start();
    try {
      const res = await apiClient.get(`/api/v1/support/tickets/${id}`);
      spinner.stop();
      if (options.json) { console.log(JSON.stringify(res.data, null, 2)); return; }
      const t = res.data as any;
      console.log('');
      console.log(ui.header(`Ticket #${t.id || id}`));
      if (t.subject || t.title) console.log(ui.label('Subject', t.subject || t.title));
      if (t.status) console.log(ui.label('Status', t.status));
      if (t.priority) console.log(ui.label('Priority', t.priority));
      if (t.description || t.body) { console.log(''); console.log(`  ${t.description || t.body}`); }
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });
