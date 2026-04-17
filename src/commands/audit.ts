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
      const res = await apiClient.get('/api/v1/security/audit/logs', { params });
      spinner.stop();
      if (options.json) { console.log(JSON.stringify(res.data, null, 2)); return; }
      const entries = (res.data as Record<string, any>).entries || (res.data as Record<string, any>).logs || (res.data as Record<string, any>).items || [];
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

// ── Subcommands for the rest of the security/audit surface ─────────

auditCommand.command('export').description('Export audit logs (CSV)')
  .option('--from <date>', 'Start date (YYYY-MM-DD)')
  .option('--to <date>', 'End date (YYYY-MM-DD)')
  .option('-o, --output <path>', 'Save to file')
  .action(async (options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Exporting...').start();
    try {
      const params: Record<string, unknown> = {};
      if (options.from) params.from_date = options.from;
      if (options.to) params.to_date = options.to;
      const res = await apiClient.get('/api/v1/security/audit/export', { params });
      const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
      if (options.output) {
        (await import('fs')).writeFileSync(options.output, body);
        spinner.succeed(chalk.green(`Saved to ${options.output}`));
      } else {
        spinner.stop();
        process.stdout.write(body);
      }
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });

auditCommand.command('suspicious <userId>').description('Suspicious activity for a user')
  .option('--json', 'JSON output')
  .action(async (userId, options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Loading...').start();
    try {
      const res = await apiClient.get(`/api/v1/security/audit/suspicious/${userId}`);
      if (options.json) { spinner.stop(); console.log(JSON.stringify(res.data, null, 2)); return; }
      spinner.succeed(chalk.green('Suspicious activity'));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });

auditCommand.command('compliance-report').description('Compliance summary report')
  .action(async () => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Loading...').start();
    try {
      const res = await apiClient.get('/api/v1/security/compliance/report');
      spinner.succeed(chalk.green('Compliance'));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });

auditCommand.command('gdpr-export').description('Trigger GDPR data export for a user')
  .requiredOption('--user <id>', 'User ID')
  .action(async (options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Initiating GDPR export...').start();
    try {
      const res = await apiClient.post('/api/v1/security/gdpr/export', { user_id: parseInt(options.user, 10) });
      spinner.succeed(chalk.green('GDPR export started'));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });

auditCommand.command('gdpr-delete').description('Trigger GDPR data deletion (right to be forgotten)')
  .requiredOption('--user <id>', 'User ID')
  .action(async (options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Initiating GDPR deletion...').start();
    try {
      await apiClient.post('/api/v1/security/gdpr/delete', { user_id: parseInt(options.user, 10) });
      spinner.succeed(chalk.green('GDPR deletion initiated'));
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });

auditCommand.command('gdpr-consent <userId>').description('Get a user\'s GDPR consent record')
  .action(async (userId) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Loading consent...').start();
    try {
      const res = await apiClient.get(`/api/v1/security/gdpr/consent/${userId}`);
      spinner.succeed(chalk.green('Consent'));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });

auditCommand.command('gdpr-consent-set').description('Record a GDPR consent decision')
  .requiredOption('--user <id>', 'User ID')
  .requiredOption('--consent <type>', 'Consent type key')
  .requiredOption('--granted <bool>', 'true|false')
  .action(async (options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Recording...').start();
    try {
      await apiClient.post('/api/v1/security/gdpr/consent', {
        user_id: parseInt(options.user, 10),
        consent_type: options.consent,
        granted: options.granted === 'true',
      });
      spinner.succeed(chalk.green('Consent recorded'));
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });
