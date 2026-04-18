import { Command } from 'commander';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';
import { isJsonOutput } from '../lib/json-output';

export const notificationsCommand = new Command('notifications')
  .description('View and manage notifications')
  .action(async () => { notificationsCommand.outputHelp(); });

{
  const { withListFlags } = require('../lib/command-kit') as typeof import('../lib/command-kit');
  const listCmd = notificationsCommand.command('list').description('List recent notifications');
  withListFlags(listCmd, '20');
  listCmd.option('--unread', 'Only unread');
  listCmd.action(async (opts: { unread?: boolean } & import('../lib/command-kit').ListFlags) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const { runListCommand } = await import('../lib/command-kit');
    await runListCommand(opts, {
      spinnerText: 'Loading notifications...',
      errorText: 'Failed to load notifications',
      fetch: async (offset, limit) => {
        const params: Record<string, unknown> = { limit, offset };
        if (opts.unread) params.unread_only = true;
        return (await apiClient.get('/api/v1/notifications', { params })).data;
      },
      extract: (page) => {
        const d = page as Record<string, unknown>;
        return ((d.notifications || d.items || []) as Array<Record<string, unknown>>);
      },
      render: (items) => {
        console.log('');
        console.log(ui.header(`Notifications (${items.length})`));
        if (items.length === 0) { console.log(chalk.dim('  No notifications.')); }
        else {
          for (const n of items) {
            const read = n.is_read ? chalk.dim('○') : chalk.blue('●');
            console.log(`  ${read} ${n.title || n.message}`);
            if (n.created_at) console.log(chalk.dim(`    ${n.created_at}`));
          }
        }
        console.log('');
      },
    });
  });
}

notificationsCommand.command('read-all').description('Mark all as read')
  .action(async () => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Marking all as read...').start();
    try {
      await apiClient.post('/api/v1/notifications/read-all');
      spinner.succeed(chalk.green('All notifications marked as read'));
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });
