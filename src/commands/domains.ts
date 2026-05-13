import { Command } from 'commander';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';
import { isJsonOutput } from '../lib/json-output';

export const domainsCommand = new Command('domains')
  .description('Per-site domain management — list, add, verify, set canonical')
  .addHelpText('after', `
Examples:
  $ solid domains list                            # every site + every address
  $ solid domains add acme.com                    # attach to primary site
  $ solid domains add shop.acme.com --site shop   # attach to specific site
  $ solid domains verify <id>                     # re-check DNS (canonical
                                                  # flips to this domain
                                                  # automatically when verified)
  $ solid domains set-canonical <site> <address>  # force canonical override
  $ solid domains remove <id> --yes

Canonical: exactly one address per site is the URL customers see. Non-
canonical addresses 301-redirect to canonical. The solidnumber.com
subdomain ALWAYS stays active as a failover — never deleted.

See: Owners-Manual/29-Provisioning/SITE-AND-DOMAIN-ARCHITECTURE.md`)
  .action(async () => { domainsCommand.outputHelp(); });

domainsCommand.command('list').alias('ls').description('List every site + every address (canonical first)')
  .option('--json', 'JSON output')
  .option('--show-fallback', 'Always show the {slug}.solidnumber.com fallback (overrides per-site config.show_vanilla_address)')
  .action(async (options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Loading sites and addresses...').start();
    try {
      // /api/sites already returns enriched canonical_url + addresses[] per
      // site (backend P A1). One call, everything on screen.
      const res = await apiClient.get('/api/v1/sites');
      spinner.stop();

      const body = res.data as Record<string, any>;
      const sites: any[] = body.sites || [];

      if (isJsonOutput(options)) {
        console.log(JSON.stringify({ sites }, null, 2));
        return;
      }

      console.log('');
      console.log(ui.header('Your sites and domains'));

      if (sites.length === 0) {
        console.log(chalk.dim('  No sites provisioned yet.'));
        console.log('');
        return;
      }

      for (const site of sites) {
        const liveBadge = site.is_live ? chalk.green('● LIVE') : chalk.dim('○ draft');
        console.log('');
        console.log(`  ${chalk.bold(site.name)} ${liveBadge} ${chalk.hex('#818cf8')(`[${site.site_type}]`)}`);

        // Canonical first
        if (site.canonical_host) {
          console.log(`    ${chalk.green('★')} ${chalk.bold(site.canonical_host)} ${chalk.dim('(canonical)')}`);
        } else {
          console.log(`    ${chalk.dim('no canonical — site has no addresses yet')}`);
        }

        // Alternates — apply the same vanilla visibility rule the
        // Settings UI uses (SPRINT-DNS-UNIFICATION). When the canonical
        // is a verified custom domain, hide the solidnumber.com fallback
        // unless --show-fallback is passed OR the site has flipped
        // `Site.config.show_vanilla_address=true`.
        const allAlts = (site.addresses || []).filter((a: any) => !a.is_canonical && a.is_active);
        const hasCustomCanonical =
          site.addresses?.some((a: any) =>
            (a.kind === 'custom_domain' || a.kind === 'custom_subdomain') && a.is_canonical && a.is_verified,
          );
        const showFallback = options.showFallback === true || site.config?.show_vanilla_address === true;
        const alts = hasCustomCanonical && !showFallback
          ? allAlts.filter((a: any) => a.kind !== 'solidnumber_subdomain')
          : allAlts;
        const hiddenFallbacks = allAlts.length - alts.length;

        for (const addr of alts) {
          const status = addr.is_verified
            ? chalk.green('● verified')
            : chalk.yellow('○ pending');
          const kindLabel = addr.kind === 'solidnumber_subdomain'
            ? chalk.dim('[solidnumber fallback]')
            : addr.kind === 'custom_subdomain'
              ? chalk.dim('[custom subdomain]')
              : chalk.dim('[custom domain]');
          console.log(`    ${chalk.dim('└')} ${addr.value} ${status} ${kindLabel}`);
        }
        if (hiddenFallbacks > 0) {
          console.log(chalk.dim(`    └ ${hiddenFallbacks} solidnumber.com fallback${hiddenFallbacks === 1 ? '' : 's'} hidden — use --show-fallback to display`));
        }
      }
      console.log('');
      console.log(chalk.dim('  ★ = canonical. Non-canonical addresses 301-redirect to canonical.'));
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); process.exit(1); }
  });

domainsCommand.command('add <domain>').description('Attach a custom domain to a site (defaults to primary)')
  .option('--site <slug>', 'Site slug to attach domain to (defaults to primary)')
  .option('--type <type>', 'Domain type: website, landing, survey', 'website')
  .action(async (domain, options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora(`Resolving target site...`).start();
    try {
      // Resolve site_id from --site slug (or leave undefined → backend defaults to primary)
      let siteId: number | undefined;
      if (options.site) {
        const siteRes = await apiClient.get(`/api/v1/sites/by-slug/${encodeURIComponent(options.site)}`);
        siteId = (siteRes.data as any)?.site?.id;
        if (!siteId) {
          spinner.fail(chalk.red(`Site "${options.site}" not found`));
          process.exit(1);
        }
      }
      spinner.text = `Attaching ${domain}...`;
      const res = await apiClient.post('/api/v1/domains/custom', {
        domain,
        type: options.type || 'website',
        ...(siteId ? { site_id: siteId } : {}),
      });
      spinner.stop();
      const d = res.data as Record<string, any>;
      console.log('');
      console.log(ui.successBox('Domain Attached', [
        `${chalk.dim('Domain:')} ${domain}`,
        `${chalk.dim('Site:')}   ${options.site || 'primary (default)'}`,
        '',
        chalk.dim('Add this CNAME record at your DNS provider:'),
        `  ${chalk.bold('Type:')}   CNAME`,
        `  ${chalk.bold('Name:')}   ${domain}`,
        `  ${chalk.bold('Target:')} ${d.dns_target || d.cname_target || 'proxy.solidnumber.com'}`,
        '',
        chalk.dim('Then verify: solid domains verify ' + (d.id || '<id>')),
        chalk.dim('Canonical flips to this domain automatically on verify.'),
      ]));
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); process.exit(1); }
  });

domainsCommand.command('set-canonical <site> <address>')
  .description('Force canonical to a specific address (e.g. solid domains set-canonical main-site example.com)')
  .action(async (siteSlug, address) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora(`Looking up site ${siteSlug}...`).start();
    try {
      const siteRes = await apiClient.get(`/api/v1/sites/by-slug/${encodeURIComponent(siteSlug)}`);
      const site = (siteRes.data as any)?.site;
      if (!site) {
        spinner.fail(chalk.red(`Site "${siteSlug}" not found`));
        process.exit(1);
      }
      const match = (site.addresses || []).find(
        (a: any) => a.value === address || a.url === address,
      );
      if (!match) {
        spinner.fail(chalk.red(`Address "${address}" not found on site ${siteSlug}`));
        console.log(chalk.dim('Available addresses:'));
        for (const a of site.addresses || []) {
          console.log(`  ${chalk.bold(a.value)} ${chalk.dim(`[${a.kind}]`)}`);
        }
        process.exit(1);
      }
      spinner.text = `Setting canonical to ${address}...`;
      // set_canonical endpoint: POST /api/v1/sites/{id}/canonical
      // (small new route — keep the logic on backend so we don't duplicate
      // validation here)
      await apiClient.post(`/api/v1/sites/${site.id}/canonical`, {
        table: match.table,
        row_id: match.row_id,
      });
      spinner.succeed(chalk.green(`Canonical for ${siteSlug} is now ${address}`));
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); process.exit(1); }
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
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); process.exit(1); }
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
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); process.exit(1); }
  });

import { appendExamples as __appendExamplesDomains } from '../lib/command-kit';
__appendExamplesDomains(domainsCommand, [
  { cmd: 'solid domains list', why: 'All attached domains + status' },
  { cmd: 'solid domains add acme.com', why: 'Attach a custom domain' },
  { cmd: 'solid domains verify acme.com', why: 'Re-check DNS + re-issue cert' },
  { cmd: 'solid domains remove acme.com --yes', why: 'Detach' },
]);
