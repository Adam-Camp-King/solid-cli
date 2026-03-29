import { Command } from 'commander';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';

export const notificationsCommand = new Command('notifications')
  .description('View and manage notifications')
  .action(async () => { notificationsCommand.outputHelp(); });

notificationsCommand.command('list').description('List recent notifications')
  .option('--unread', 'Only unread').option('--limit <n>', 'Count', '20').option('--json', 'JSON output')
  .action(async (options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Loading notifications...').start();
    try {
      const params: Record<string, unknown> = { limit: options.limit };
      if (options.unread) params.unread_only = true;
      const res = await apiClient.get('/api/v1/notifications', { params });
      spinner.stop();
      if (options.json) { console.log(JSON.stringify(res.data, null, 2)); return; }
      const items = (res.data as Record<string, any>).notifications || (res.data as Record<string, any>).items || [];
      console.log('');
      console.log(ui.header(`Notifications (${items.length})`));
      if (items.length === 0) { console.log(chalk.dim('  No notifications.')); }
      else { for (const n of items) { const read = n.is_read ? chalk.dim('○') : chalk.blue('●'); console.log(`  ${read} ${n.title || n.message}`); if (n.created_at) console.log(chalk.dim(`    ${n.created_at}`)); } }
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });

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
