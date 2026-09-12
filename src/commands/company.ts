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
import { isJsonOutput, printJson } from '../lib/json-output';

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
      fail(spinner, 'Failed to list companies', error);
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
        fail(spinner, 'Failed to provision droplet', error);
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
        fail(spinner, 'Failed to create company', error);
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
      printJson({ company_id: id ?? null, email: config.userEmail ?? null });
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
      fail(spinner, 'Failed to load company info', error);
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
      fail(spinner, 'Failed to list members', error);
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
      fail(spinner, 'Failed to revoke member', error);
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
      fail(spinner, 'Failed to send invitation', error);
    }
  });

// ════════════════════════════════════════════════════════════════════
// T10 — Agency-managed companies + verb-scoped locks (SPRINT-AGENT-FIREWALL Phase 0)
//   solid company create-for-client  — provision + lock all + invite
//   solid company lock-status        — read current lock map (grouped by area)
//   solid company lock               — lock keys (or legacy areas — the server expands them)
//   solid company unlock             — unlock keys (or --all)
//   solid company lock-preset        — apply a whole posture: design-lock | content-freeze | read-only
//   solid company request-unlock     — client asks agency to unlock
// ════════════════════════════════════════════════════════════════════

// Lock keys are `area:verb`. `{"design:write": true, "pages:delete": true}` (the
// `design-lock` preset) still lets the client add a landing page, edit copy and
// change business hours — that is what "lock my design" means. Single source of
// truth: solid-backend/services/policy/lock.py::VALID_LOCK_KEYS. A bare legacy
// area (`pages`) is still accepted and expands to every key under it.
const LOCK_KEYS = [
  'design:write',
  'pages:create', 'pages:update', 'pages:delete',
  'content:metadata',
  'brand:logo', 'brand:colors',
  'domains:add', 'domains:remove',
  'modules:deploy', 'modules:remove',
  'billing_lock',
] as const;
const LEGACY_LOCK_AREAS = ['pages', 'brand', 'domains', 'modules', 'design', 'billing_lock'] as const;
const LOCK_PRESETS = ['design-lock', 'content-freeze', 'read-only'] as const;
const LOCK_AREAS = LOCK_KEYS; // kept for callers that read the list

function parseAreas(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function validateAreas(areas: string[]): string | null {
  const known = [...LOCK_KEYS, ...LEGACY_LOCK_AREAS] as readonly string[];
  const invalid = areas.filter((a) => !known.includes(a));
  if (invalid.length > 0) {
    return `Unknown lock key(s): ${invalid.join(', ')}. Valid keys: ${LOCK_KEYS.join(', ')} (legacy areas ${LEGACY_LOCK_AREAS.join(', ')} expand to every key under them)`;
  }
  return null;
}

function printLocks(locks: Record<string, boolean>): void {
  console.log('');
  // Group by area so the map reads as a posture, not a wall of booleans.
  const keys = Object.keys(locks).length ? Object.keys(locks) : [...LOCK_KEYS];
  const byArea = new Map<string, string[]>();
  keys.forEach((key) => {
    const area = key.includes(':') ? key.split(':')[0] : key;
    byArea.set(area, [...(byArea.get(area) ?? []), key]);
  });
  byArea.forEach((areaKeys, area) => {
    const lockedCount = areaKeys.filter((k) => locks[k] === true).length;
    const rollup =
      lockedCount === areaKeys.length ? chalk.red('locked') :
      lockedCount > 0 ? chalk.yellow('partial') : chalk.green('unlocked');
    console.log(`  ${chalk.bold(area.padEnd(13))} ${rollup}`);
    areaKeys.forEach((key) => {
      const locked = locks[key] === true;
      const badge = locked ? chalk.red('🔒 locked  ') : chalk.green('✔ unlocked');
      const verb = key.includes(':') ? key.split(':')[1] : '';
      console.log(`      ${badge}  ${chalk.dim(verb ? `${area}:` : '')}${verb || chalk.dim(key)}`);
    });
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
  .option('--unlock <keys>', `Comma-separated lock keys to leave UNLOCKED at creation (valid: ${LOCK_KEYS.join(', ')}; a legacy area like "pages" expands to every key under it)`)
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
      fail(spinner, 'Provisioning failed', error);
    }
  });

companyCommand
  .command('lock-status [company_id]')
  .description('Show which lock keys are locked on a company, grouped by area')
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
  .description('Lock one or more keys (area:verb) — agency owner only')
  .requiredOption('--area <keys>', `Comma-separated lock keys (valid: ${LOCK_KEYS.join(', ')}; a legacy area like "pages" expands to every key under it)`)
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
      fail(spinner, 'Lock failed', error);
    }
  });

companyCommand
  .command('unlock <company_id>')
  .description('Unlock one or more keys (area:verb) — agency owner only')
  .option('--area <keys>', 'Comma-separated lock keys to unlock (a legacy area expands to every key under it)')
  .option('--all', 'Unlock every key (full handoff)', false)
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
    const label = all ? 'ALL keys' : areas.join(', ');
    const spinner = ora(`Unlocking ${label} on company #${companyId}...`).start();
    try {
      const res = await apiClient.companyUnlock(companyId, areas, all);
      spinner.succeed(chalk.green(`Unlocked: ${label}`));
      printLocks(res.data.locks);
    } catch (error) {
      fail(spinner, 'Unlock failed', error);
    }
  });

companyCommand
  .command('request-unlock <company_id>')
  .description('Ask your agency to unlock one or more keys (client-side)')
  .requiredOption('--area <keys>', 'Comma-separated lock keys to request (e.g. "pages:update")')
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
      console.log(chalk.dim(`  Keys: ${res.data.areas.join(', ')}`));
    } catch (error) {
      fail(spinner, 'Request failed', error);
    }
  });

companyCommand
  .command('lock-preset <company_id>')
  .description('Apply a lock posture — REPLACES the whole map. Agency owner only')
  .requiredOption('--profile <name>', `One of: ${LOCK_PRESETS.join(', ')}`)
  .action(async (companyIdArg, options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }
    const companyId = parseInt(companyIdArg, 10);
    const profile = String(options.profile);
    if (!(LOCK_PRESETS as readonly string[]).includes(profile)) {
      console.error(chalk.red(`Unknown preset '${profile}'. Valid: ${LOCK_PRESETS.join(', ')}`));
      process.exit(1);
    }
    const spinner = ora(`Applying '${profile}' on company #${companyId}...`).start();
    try {
      const res = await apiClient.companyLockPreset(companyId, profile);
      spinner.succeed(chalk.green(`Applied: ${profile}`));
      printLocks(res.data.locks);
    } catch (error) {
      fail(spinner, 'Preset failed', error);
    }
  });

import { appendExamples as __ae_company, fail } from '../lib/command-kit';
__ae_company(companyCommand, [
  { cmd: 'solid company list',                            why: 'Companies you have access to' },
  { cmd: 'solid company current',                         why: 'Active company (same as whoami)' },
  { cmd: 'solid company info <id>',                       why: 'Settings, tier, domain' },
  { cmd: 'solid company create-for-client --name "..."',  why: 'Agency: spin up a new tenant' },
  { cmd: 'solid company lock-preset 47 --profile design-lock', why: 'Lock design + deletes; new pages and copy edits stay open' },
  { cmd: 'solid company lock 47 --area design:write,pages:delete', why: 'Lock individual keys (area:verb)' },
]);
