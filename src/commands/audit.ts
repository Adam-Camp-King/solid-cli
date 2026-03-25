import { Command } from 'commander';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';

export const auditCommand = new Command('audit')
  .description('Activity log — who changed what, when')
  .option('--limit <n>', 'Number of entries', '20')
  .option('--user <email>', 'Filter by user email')
  .option('--action <type>', 'Filter by action (create, update, delete)')
  .option('--json', 'JSON output')
  .action(async (options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Loading audit log...').start();
    try {
      const params: Record<string, unknown> = { limit: options.limit };
      if (options.user) params.user_email = options.user;
      if (options.action) params.action_type = options.action;
      const res = await apiClient.get('/api/v1/audit/log', { params });
      spinner.stop();
      if (options.json) { console.log(JSON.stringify(res.data, null, 2)); return; }
      const entries = (res.data as any).entries || (res.data as any).logs || (res.data as any).items || [];
      console.log('');
      console.log(ui.header(`Audit Log (${entries.length})`));
      if (entries.length === 0) { console.log(chalk.dim('  No activity recorded yet.')); }
      else {
        for (const entry of entries) {
          const action = entry.action || entry.action_type || '';
          const color = action === 'delete' ? chalk.red : action === 'create' ? chalk.green : chalk.yellow;
          const user = entry.user_email || entry.user || '';
          const entity = entry.entity_type || entry.resource || '';
          const time = entry.created_at || entry.timestamp || '';
          console.log(`  ${chalk.dim(time)}  ${color(action.padEnd(8))}  ${entity}  ${chalk.dim(user)}`);
        }
      }
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });
