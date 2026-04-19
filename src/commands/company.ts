/**
 * Company management commands for Solid CLI
 *
 * solid company list                              → Show linked companies
 * solid company create "Mike's Plumbing"          → Spin up new company
 * solid company info                              → Current company details
 * solid company invite dev@agency.com             → Invite developer
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';
import { isJsonOutput } from '../lib/json-output';

export const companyCommand = new Command('company')
  .description('Manage companies (agencies & multi-company developers)');

// ── List companies ─────────────────────────────────────────────────
companyCommand
  .command('list').alias('ls')
  .description('List all companies you have access to')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const spinner = ora('Loading companies...').start();

    try {
      const response = await apiClient.companiesList();
      spinner.stop();

      const { companies, active_company_id } = response.data;

      if (isJsonOutput(options)) {
        console.log(JSON.stringify(response.data, null, 2));
        return;
      }

      if (companies.length === 0) {
        console.log(chalk.yellow('  No companies found.'));
        return;
      }

      console.log('');
      console.log(chalk.bold(`  Your Companies (${companies.length})`));
      console.log('');

      const headers = ['ID', 'Name', 'Role', 'Active'];
      const rows = companies.map((c: { id: number; name: string; role: string }) => [
        c.id === active_company_id
          ? chalk.green(`→ ${c.id}`)
          : `  ${c.id}`,
        c.id === active_company_id
          ? chalk.green(c.name)
          : c.name,
        c.role,
        c.id === active_company_id ? chalk.green('●') : chalk.dim('○'),
      ]);

      console.log(ui.table(headers, rows));
      console.log('');
      console.log(chalk.dim(`  Active company: ${active_company_id}`));
      console.log(chalk.dim('  Switch with: solid switch <id>'));
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red('Failed to list companies'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// ── Create company ─────────────────────────────────────────────────
companyCommand
  .command('create <name>')
  .description('Create a new company (shared platform or dedicated droplet)')
  .option('-t, --template <template>', 'Industry template to apply (e.g., plumber, hvac)')
  .option('-i, --industry <industry>', 'Industry name')
  .option('--tier <tier>', 'Subscription tier: starter, builder, professional, enterprise', 'starter')
  .option('--dedicated', 'Provision a dedicated droplet (own server, database, AI)')
  .option('--size <size>', 'Droplet size: small ($72/mo), medium ($144/mo), large ($288/mo)', 'small')
  .option('--region <region>', 'Droplet region: nyc1, sfo1, ams3, sgp1', 'nyc1')
  .option('--domain <domain>', 'Custom domain (e.g., app.clientsite.com)')
  .option('--json', 'Output as JSON')
  .action(async (name: string, options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const isDedicated = options.dedicated || false;

    if (isDedicated) {
      // ── Dedicated Droplet Flow ──
      const sizeMap: Record<string, { label: string; price: string }> = {
        small: { label: 's-2vcpu-4gb', price: '$72/mo' },
        medium: { label: 's-4vcpu-8gb', price: '$144/mo' },
        large: { label: 's-8vcpu-16gb', price: '$288/mo' },
      };
      const sizeInfo = sizeMap[options.size] || sizeMap.small;

      console.log('');
      console.log(chalk.bold('  Dedicated Droplet Provisioning'));
      console.log(chalk.dim(`  Company:  ${name}`));
      console.log(chalk.dim(`  Size:     ${options.size} (${sizeInfo.label}) — ${sizeInfo.price}`));
      console.log(chalk.dim(`  Region:   ${options.region}`));
      console.log(chalk.dim(`  Template: ${options.template || 'none'}`));
      if (options.domain) console.log(chalk.dim(`  Domain:   ${options.domain}`));
      console.log('');

      const spinner = ora('Provisioning dedicated droplet...').start();

      try {
        // Generate slug from name
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

        const response = await apiClient.post<any>('/api/v1/admin/droplets/provision', {
          customer_slug: slug,
          company_name: name,
          size: sizeInfo.label,
          region: options.region,
          tier_slug: options.tier,
          kb_sub_code: options.template || undefined,
          industry_name: options.industry || undefined,
          custom_domain: options.domain || undefined,
        });

        spinner.succeed(chalk.green('Dedicated droplet provisioned'));

        if (isJsonOutput(options)) {
          console.log(JSON.stringify(response.data, null, 2));
          return;
        }

        const data = response.data as Record<string, any>;
        console.log('');
        console.log(ui.successBox('Dedicated Company Created', [
          `Company:  ${data.company?.name || name}`,
          `ID:       ${data.company?.id || 'pending'}`,
          `Droplet:  ${data.droplet?.status || 'provisioning'}`,
          `IP:       ${data.droplet?.ip_address || 'assigning...'}`,
          `URL:      ${data.droplet?.subdomain ? `${data.droplet.subdomain}.solidnumber.com` : 'configuring...'}`,
          `Size:     ${options.size} — ${sizeInfo.price}`,
        ]));
        console.log('');
        console.log(chalk.dim('  Droplet takes 2-5 minutes to fully provision.'));
        console.log(chalk.dim(`  Check status: solid droplet status ${slug}`));
        console.log('');
      } catch (error) {
        spinner.fail(chalk.red('Failed to provision droplet'));
        const apiError = handleApiError(error);
        console.error(chalk.red(`  ${apiError.message}`));
      }
    } else {
      // ── Shared Platform Flow (existing) ──
      const spinner = ora(`Creating company "${name}"...`).start();

      try {
        const response = await apiClient.companyCreate(name, options.template, options.industry);
        spinner.succeed(chalk.green('Company created'));

        if (isJsonOutput(options)) {
          console.log(JSON.stringify(response.data, null, 2));
          return;
        }

        const company = response.data.company;
        console.log('');
        console.log(ui.successBox('Company Created', [
          `ID:   ${company.id}`,
          `Name: ${company.name}`,
          `Slug: ${company.slug}`,
          `Role: ${response.data.membership.role}`,
          `Mode: Shared platform (multi-tenant)`,
        ]));

        if (response.data.template) {
          console.log(chalk.dim(`  Template: ${options.template} applied`));
        }

        console.log('');
        console.log(chalk.dim('  Switch to it: ') + chalk.cyan(`solid switch ${company.id}`));
        console.log(chalk.dim('  Need a dedicated server? Add --dedicated'));
        console.log('');
      } catch (error) {
        spinner.fail(chalk.red('Failed to create company'));
        const apiError = handleApiError(error);
        console.error(chalk.red(`  ${apiError.message}`));
      }
    }
  });

// ── Company current (quick active-company lookup, no network) ─────
companyCommand
  .command('current')
  .description('Print the currently active company ID (fast, no network)')
  .option('--json', 'Output as JSON')
  .action((options: { json?: boolean }) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }
    const id = config.companyId;
    if (isJsonOutput(options)) {
      console.log(JSON.stringify({ company_id: id ?? null, email: config.userEmail ?? null }, null, 2));
      return;
    }
    if (!id) {
      console.error(chalk.yellow('No active company. Run `solid switch`.'));
      process.exit(1);
    }
    console.log(String(id));
  });

// ── Company info ───────────────────────────────────────────────────
companyCommand
  .command('info')
  .description('Show current company details')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const spinner = ora('Loading company info...').start();

    try {
      const response = await apiClient.companyInfo();
      spinner.stop();

      if (isJsonOutput(options)) {
        console.log(JSON.stringify(response.data, null, 2));
        return;
      }

      const company = (response.data as Record<string, unknown>).company as Record<string, unknown> || response.data;
      console.log('');
      console.log(ui.successBox(String(company.name || 'Company'), [
        `ID:       ${company.id || config.companyId}`,
        `Email:    ${config.userEmail}`,
        `Env:      ${config.environment}`,
      ]));
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red('Failed to load company info'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// ── List members ──────────────────────────────────────────────────
const membersCommand = new Command('members')
  .description('List and manage company members')
  .option('-c, --company <id>', 'Target company ID (default: current)')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const companyId = options.company ? parseInt(options.company, 10) : config.companyId;
    if (!companyId) {
      console.error(chalk.red('No company selected. Run `solid auth login` first.'));
      process.exit(1);
    }

    const spinner = ora('Loading members...').start();

    try {
      const response = await apiClient.companyMembers(companyId);
      spinner.stop();

      const { members, count } = response.data;

      if (isJsonOutput(options)) {
        console.log(JSON.stringify(response.data, null, 2));
        return;
      }

      if (count === 0) {
        console.log(chalk.yellow('  No members found.'));
        return;
      }

      console.log('');
      console.log(chalk.bold(`  Members (${count})`));
      console.log('');

      const headers = ['User ID', 'Email', 'Role', 'Joined'];
      const rows = members.map((m: { user_id: number; email: string; role: string; joined_at?: string }) => [
        String(m.user_id),
        m.email || chalk.dim('unknown'),
        m.role,
        m.joined_at ? m.joined_at.split('T')[0] : chalk.dim('—'),
      ]);

      console.log(ui.table(headers, rows));
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red('Failed to list members'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// ── Revoke member ─────────────────────────────────────────────────
membersCommand
  .command('revoke <userId>')
  .description('Remove a member from the company')
  .option('-c, --company <id>', 'Target company ID (default: current)')
  .option('-y, --yes', 'Skip confirmation')
  .action(async (userId: string, options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const companyId = options.company ? parseInt(options.company, 10) : config.companyId;
    if (!companyId) {
      console.error(chalk.red('No company selected. Run `solid auth login` first.'));
      process.exit(1);
    }

    const targetUserId = parseInt(userId, 10);
    if (isNaN(targetUserId)) {
      console.error(chalk.red('Invalid user ID. Must be a number.'));
      process.exit(1);
    }

    const { confirm } = await import('../lib/command-kit');
    const ok = await confirm(
      `Remove user ${targetUserId} from company ${companyId}?`,
      { autoConfirm: Boolean(options.yes) },
    );
    if (!ok) {
      console.error(chalk.dim('  Cancelled.'));
      process.exit(1);
    }

    const spinner = ora({ text: 'Revoking member access...', stream: process.stderr }).start();

    try {
      await apiClient.companyMemberRevoke(companyId, targetUserId);
      spinner.succeed(chalk.green(`Member (user_id=${targetUserId}) removed from company ${companyId}`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to revoke member'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

companyCommand.addCommand(membersCommand);

// ── Invite developer ───────────────────────────────────────────────
companyCommand
  .command('invite <email>')
  .description('Invite a developer to the current company')
  .option('-r, --role <role>', 'Role to assign', 'developer')
  .option('-c, --company <id>', 'Target company ID (default: current)')
  .action(async (email: string, options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const companyId = options.company ? parseInt(options.company, 10) : config.companyId;
    if (!companyId) {
      console.error(chalk.red('No company selected. Run `solid auth login` first.'));
      process.exit(1);
    }

    const spinner = ora(`Inviting ${email}...`).start();

    try {
      const response = await apiClient.companyInvite(companyId, email, options.role);
      spinner.succeed(chalk.green('Invitation sent'));
      console.log(chalk.dim(`  ${email} invited as ${options.role} to company ${companyId}`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to send invitation'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// ════════════════════════════════════════════════════════════════════
// T10 — Agency-managed companies + design-lock
//   solid company create-for-client  — provision + lock all + invite
//   solid company lock-status        — read current lock map
//   solid company lock               — lock areas
//   solid company unlock             — unlock areas (or --all)
//   solid company request-unlock     — client asks agency to unlock
// ════════════════════════════════════════════════════════════════════

const LOCK_AREAS = ['pages', 'brand', 'domains', 'modules', 'design', 'billing_lock'] as const;

function parseAreas(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function validateAreas(areas: string[]): string | null {
  const invalid = areas.filter((a) => !(LOCK_AREAS as readonly string[]).includes(a));
  if (invalid.length > 0) {
    return `Unknown lock area(s): ${invalid.join(', ')}. Valid: ${LOCK_AREAS.join(', ')}`;
  }
  return null;
}

function printLocks(locks: Record<string, boolean>): void {
  console.log('');
  LOCK_AREAS.forEach((area) => {
    const locked = locks[area] === true;
    const badge = locked ? chalk.red('🔒 locked  ') : chalk.green('✔ unlocked');
    console.log(`  ${badge}  ${chalk.dim(area)}`);
  });
}

// Create a company for a client, locked by default
companyCommand
  .command('create-for-client')
  .description('Provision a new company for a client — all areas locked by default')
  .requiredOption('-n, --name <name>', 'Client company name (e.g. "Joe\'s Plumbing")')
  .requiredOption('--client-email <email>', 'Client email — receives owner invite')
  .option('--client-name <name>', 'Client contact name')
  .option('--industry <industry>', 'Industry slug (e.g. "plumber", "hvac")')
  .option('--template <template>', 'KB template name (usually same as industry)')
  .option('--unlock <areas>', `Comma-separated areas to leave UNLOCKED at creation (valid: ${LOCK_AREAS.join(', ')})`)
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const unlocked = options.unlock ? parseAreas(options.unlock) : undefined;
    if (unlocked) {
      const err = validateAreas(unlocked);
      if (err) {
        console.error(chalk.red(err));
        process.exit(1);
      }
    }

    const spinner = ora(`Provisioning "${options.name}" for ${options.clientEmail}...`).start();
    try {
      const res = await apiClient.companyCreateForClient({
        name: options.name,
        client_email: options.clientEmail,
        client_name: options.clientName,
        industry: options.industry,
        template: options.template,
        initial_unlocked_areas: unlocked,
      });
      spinner.succeed(chalk.green(`Company #${res.data.company.id} created`));
      console.log('');
      console.log(`  ${chalk.bold('Name:')}         ${res.data.company.name}`);
      console.log(`  ${chalk.bold('Slug:')}         ${res.data.company.slug}`);
      console.log(`  ${chalk.bold('Agency owner:')} user_id=${res.data.agency.agency_owner_user_id}`);
      console.log(chalk.bold('\n  Lock state:'));
      printLocks(res.data.agency.locks);
      if (res.data.invitation?.sent) {
        console.log('');
        console.log(chalk.green(`  ✔ Invite sent to ${options.clientEmail}`));
        if (res.data.invitation.token) {
          console.log(chalk.dim(`    Token: ${res.data.invitation.token}`));
          console.log(chalk.dim(`    Expires: ${res.data.invitation.expires_at ?? 'n/a'}`));
        }
      } else {
        console.log(chalk.yellow(`\n  ⚠ Invite was NOT sent (non-fatal). Forward the invite manually.`));
      }
      if (res.data.next_steps?.length) {
        console.log(chalk.bold('\n  Next steps:'));
        res.data.next_steps.forEach((s) => console.log(chalk.dim(`    • ${s}`)));
      }
    } catch (error) {
      spinner.fail(chalk.red('Provisioning failed'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
      process.exit(1);
    }
  });

companyCommand
  .command('lock-status [company_id]')
  .description('Show which areas are locked on a company')
  .option('--json', 'Output as JSON')
  .action(async (companyIdArg, options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }
    const companyId = companyIdArg ? parseInt(companyIdArg, 10) : config.companyId;
    if (!companyId) {
      console.error(chalk.red('No company selected.'));
      process.exit(1);
    }
    try {
      const res = await apiClient.companyLockStatus(companyId);
      if (isJsonOutput(options)) {
        console.log(JSON.stringify(res.data, null, 2));
        return;
      }
      console.log('');
      console.log(`  ${chalk.bold('Company:')}        #${res.data.company_id}`);
      console.log(`  ${chalk.bold('Agency managed:')} ${res.data.agency_managed ? chalk.green('yes') : chalk.dim('no (self-serve)')}`);
      if (res.data.agency_owner_user_id) {
        console.log(`  ${chalk.bold('Agency owner:')}   user_id=${res.data.agency_owner_user_id}`);
      }
      console.log(chalk.bold('\n  Lock state:'));
      printLocks(res.data.locks);
    } catch (error) {
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
      process.exit(1);
    }
  });

companyCommand
  .command('lock <company_id>')
  .description('Lock one or more areas — agency owner only')
  .requiredOption('--area <areas>', `Comma-separated areas to lock (valid: ${LOCK_AREAS.join(', ')})`)
  .action(async (companyIdArg, options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }
    const companyId = parseInt(companyIdArg, 10);
    const areas = parseAreas(options.area);
    const err = validateAreas(areas);
    if (err) {
      console.error(chalk.red(err));
      process.exit(1);
    }
    const spinner = ora(`Locking ${areas.join(', ')} on company #${companyId}...`).start();
    try {
      const res = await apiClient.companyLock(companyId, areas);
      spinner.succeed(chalk.green(`Locked: ${areas.join(', ')}`));
      printLocks(res.data.locks);
    } catch (error) {
      spinner.fail(chalk.red('Lock failed'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
      process.exit(1);
    }
  });

companyCommand
  .command('unlock <company_id>')
  .description('Unlock one or more areas — agency owner only')
  .option('--area <areas>', 'Comma-separated areas to unlock')
  .option('--all', 'Unlock every area (full handoff)', false)
  .action(async (companyIdArg, options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }
    const companyId = parseInt(companyIdArg, 10);
    const all = Boolean(options.all);
    const areas = options.area ? parseAreas(options.area) : [];
    if (!all && areas.length === 0) {
      console.error(chalk.red('Provide either --area <list> or --all.'));
      process.exit(1);
    }
    if (areas.length) {
      const err = validateAreas(areas);
      if (err) {
        console.error(chalk.red(err));
        process.exit(1);
      }
    }
    const label = all ? 'ALL areas' : areas.join(', ');
    const spinner = ora(`Unlocking ${label} on company #${companyId}...`).start();
    try {
      const res = await apiClient.companyUnlock(companyId, areas, all);
      spinner.succeed(chalk.green(`Unlocked: ${label}`));
      printLocks(res.data.locks);
    } catch (error) {
      spinner.fail(chalk.red('Unlock failed'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
      process.exit(1);
    }
  });

companyCommand
  .command('request-unlock <company_id>')
  .description('Ask your agency to unlock one or more areas (client-side)')
  .requiredOption('--area <areas>', 'Comma-separated areas to request (e.g. "pages")')
  .requiredOption('--reason <reason>', 'Why you need this unlocked')
  .action(async (companyIdArg, options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }
    const companyId = parseInt(companyIdArg, 10);
    const areas = parseAreas(options.area);
    const err = validateAreas(areas);
    if (err) {
      console.error(chalk.red(err));
      process.exit(1);
    }
    const spinner = ora(`Sending unlock request...`).start();
    try {
      const res = await apiClient.companyRequestUnlock(companyId, areas, options.reason);
      spinner.succeed(chalk.green('Request sent'));
      console.log(chalk.dim(`  Agency owner: user_id=${res.data.agency_owner_user_id}`));
      console.log(chalk.dim(`  Areas: ${res.data.areas.join(', ')}`));
    } catch (error) {
      spinner.fail(chalk.red('Request failed'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
      process.exit(1);
    }
  });

import { appendExamples as __ae_company } from '../lib/command-kit';
__ae_company(companyCommand, [
  { cmd: 'solid company list',                            why: 'Companies you have access to' },
  { cmd: 'solid company current',                         why: 'Active company (same as whoami)' },
  { cmd: 'solid company info <id>',                       why: 'Settings, tier, domain' },
  { cmd: 'solid company create-for-client --name "..."',  why: 'Agency: spin up a new tenant' },
]);
