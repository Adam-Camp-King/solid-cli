/**
 * Support command for Solid CLI — customer support tickets.
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';
import { isJsonOutput } from '../lib/json-output';

export const supportCommand = new Command('support')
  .description('Customer support tickets')
  .action(async () => { supportCommand.outputHelp(); });

{
  const { withListFlags } = require('../lib/command-kit') as typeof import('../lib/command-kit');
  const listCmd = supportCommand.command('list').description('List support tickets');
  withListFlags(listCmd, '20');
  listCmd.option('--status <status>', 'Filter: open, closed, pending');
  listCmd.action(async (opts: { status?: string } & import('../lib/command-kit').ListFlags) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const { runListCommand } = await import('../lib/command-kit');
    await runListCommand(opts, {
      spinnerText: 'Loading tickets...',
      errorText: 'Failed to load tickets',
      fetch: async (offset, limit) => {
        const params: Record<string, unknown> = { limit, offset };
        if (opts.status) params.status = opts.status;
        return (await apiClient.get('/api/v1/support/tickets', { params })).data;
      },
      extract: (page) => {
        const d = page as Record<string, unknown>;
        return ((d.tickets || d.items || []) as Array<Record<string, unknown>>);
      },
      render: (tickets) => {
        console.log('');
        console.log(ui.header(`Support Tickets (${tickets.length})`));
        if (!tickets.length) { console.log(chalk.dim('  No tickets.')); }
        else {
          for (const t of tickets) {
            const s = t.status === 'open' ? chalk.green('●') : t.status === 'pending' ? chalk.yellow('●') : chalk.dim('●');
            const p = t.priority === 'high' ? chalk.red(' [HIGH]') : '';
            console.log(`  ${s} #${t.id}${p} ${t.subject || t.title}`);
          }
        }
        console.log('');
      },
    });
  });
}

supportCommand.command('get <id>').description('View ticket details')
  .option('--json', 'JSON output')
  .action(async (id, options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Loading...').start();
    try {
      const res = await apiClient.get(`/api/v1/support/tickets/${id}`);
      spinner.stop();
      if (isJsonOutput(options)) { console.log(JSON.stringify(res.data, null, 2)); return; }
      const t = res.data as Record<string, any>;
      console.log('');
      console.log(ui.header(`Ticket #${t.id || id}`));
      if (t.subject || t.title) console.log(ui.label('Subject', t.subject || t.title));
      if (t.status) console.log(ui.label('Status', t.status));
      if (t.priority) console.log(ui.label('Priority', t.priority));
      if (t.description || t.body) { console.log(''); console.log(`  ${t.description || t.body}`); }
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });
