import { Command } from 'commander';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';

export const domainsCommand = new Command('domains')
  .description('Custom domain management')
  .action(async () => { domainsCommand.outputHelp(); });

domainsCommand.command('list').description('List configured domains')
  .option('--json', 'JSON output')
  .action(async (options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Loading domains...').start();
    try {
      const res = await apiClient.get('/api/v1/domains');
      spinner.stop();
      if (options.json) { console.log(JSON.stringify(res.data, null, 2)); return; }
      const domains = (res.data as any).domains || (res.data as any).items || [];
      console.log('');
      console.log(ui.header(`Domains (${domains.length})`));
      if (domains.length === 0) {
        console.log(chalk.dim('  No custom domains. Use `solid domains add <domain>` to connect one.'));
      } else {
        for (const d of domains) {
          const ssl = d.ssl_active ? chalk.green('SSL ✓') : chalk.yellow('SSL pending');
          const primary = d.is_primary ? chalk.hex('#818cf8')(' [primary]') : '';
          console.log(`  ${chalk.bold(d.domain)}${primary}  ${ssl}`);
        }
      }
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });

domainsCommand.command('add <domain>').description('Add a custom domain')
  .action(async (domain) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora(`Adding ${domain}...`).start();
    try {
      const res = await apiClient.post('/api/v1/domains', { domain });
      spinner.stop();
      const d = res.data as any;
      console.log('');
      console.log(ui.successBox('Domain Added', [
        `${chalk.dim('Domain:')} ${domain}`,
        '', chalk.dim('Add this CNAME record to your DNS:'),
        `  ${chalk.cyan(d.cname_target || d.dns_target || '{slug}.solidnumber.com')}`,
      ]));
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });

domainsCommand.command('remove <domain>').description('Remove a domain')
  .action(async (domain) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora(`Removing ${domain}...`).start();
    try {
      await apiClient.delete('/api/v1/domains', { params: { domain } });
      spinner.succeed(chalk.green(`${domain} removed`));
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });

domainsCommand.command('verify <domain>').description('Check DNS status')
  .action(async (domain) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora(`Checking ${domain}...`).start();
    try {
      const res = await apiClient.get('/api/v1/domains/verify', { params: { domain } });
      spinner.stop();
      const d = res.data as any;
      if (d.verified || d.dns_verified) { console.log(chalk.green(`  ✓ ${domain} — verified`)); }
      else { console.log(chalk.yellow(`  ○ ${domain} — DNS not yet propagated`)); }
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });
