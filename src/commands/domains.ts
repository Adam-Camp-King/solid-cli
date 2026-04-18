import { Command } from 'commander';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';
import { isJsonOutput } from '../lib/json-output';

export const domainsCommand = new Command('domains')
  .description('Custom domain management — list, add, verify, attach tenant subdomains')
  .addHelpText('after', `
Examples:
  $ solid domains list
  $ solid domains add my-client.com
  $ solid domains verify my-client.com
  $ solid domains remove my-client.com --yes

On-demand TLS is issued automatically by Caddy after verification.
See: Owners-Manual/09-Core-Innovations/CUSTOM-DOMAINS-ON-DEMAND-TLS.md`)
  .action(async () => { domainsCommand.outputHelp(); });

domainsCommand.command('list').description('List configured domains')
  .option('--json', 'JSON output')
  .action(async (options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Loading domains...').start();
    try {
      // Get subdomain + custom domains
      const [subRes, customRes] = await Promise.all([
        apiClient.get('/api/v1/domains/subdomain').catch(() => ({ data: {} })),
        apiClient.get('/api/v1/domains/custom').catch(() => ({ data: [] })),
      ]);
      spinner.stop();

      if (isJsonOutput(options)) {
        console.log(JSON.stringify({ subdomain: subRes.data, custom: customRes.data }, null, 2));
        return;
      }

      const sub = subRes.data as Record<string, any>;
      const customs = (customRes.data as Record<string, any>).domains || customRes.data || [];

      console.log('');
      console.log(ui.header('Domains'));

      // Subdomain
      if (sub.subdomain) {
        console.log(`  ${chalk.bold(`${sub.subdomain}.solidnumber.com`)} ${chalk.green('● active')} ${chalk.hex('#818cf8')('[subdomain]')}`);
      }

      // Custom domains
      if (customs.length > 0) {
        for (const d of customs) {
          const verified = d.verified ? chalk.green('● verified') : chalk.yellow('○ pending');
          console.log(`  ${chalk.bold(d.domain)} ${verified}`);
        }
      }

      if (!sub.subdomain && customs.length === 0) {
        console.log(chalk.dim('  No domains configured. Use `solid domains add <domain>` to connect one.'));
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
      const res = await apiClient.post('/api/v1/domains/custom', { domain });
      spinner.stop();
      const d = res.data as Record<string, any>;
      console.log('');
      console.log(ui.successBox('Domain Added', [
        `${chalk.dim('Domain:')} ${domain}`,
        '',
        chalk.dim('Add this CNAME record to your DNS:'),
        `  ${chalk.bold('Type:')}   CNAME`,
        `  ${chalk.bold('Name:')}   ${domain}`,
        `  ${chalk.bold('Target:')} ${d.cname_target || d.dns_target || 'cname.solidnumber.com'}`,
        '',
        chalk.dim('Then verify: solid domains verify ' + domain),
      ]));
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });

domainsCommand.command('remove <id>').description('Remove a custom domain by ID')
  .action(async (id) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const domainId = parseInt(id, 10);
    if (isNaN(domainId)) { console.error(chalk.red('Invalid domain ID. Use `solid domains list` to find IDs.')); process.exit(1); }
    const spinner = ora(`Removing domain #${domainId}...`).start();
    try {
      await apiClient.delete(`/api/v1/domains/custom/${domainId}`);
      spinner.succeed(chalk.green(`Domain #${domainId} removed`));
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });

domainsCommand.command('verify <id>').description('Verify DNS for a custom domain')
  .action(async (id) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const domainId = parseInt(id, 10);
    if (isNaN(domainId)) { console.error(chalk.red('Invalid domain ID.')); process.exit(1); }
    const spinner = ora(`Verifying domain #${domainId}...`).start();
    try {
      const res = await apiClient.post(`/api/v1/domains/custom/${domainId}/verify`);
      spinner.stop();
      const d = res.data as Record<string, any>;
      if (d.verified) {
        console.log(chalk.green(`  ✓ Domain verified and active`));
      } else {
        console.log(chalk.yellow(`  ○ DNS not yet propagated. Check your CNAME record.`));
      }
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });
