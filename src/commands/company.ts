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

export const companyCommand = new Command('company')
  .description('Manage companies (agencies & multi-company developers)');

// ── List companies ─────────────────────────────────────────────────
companyCommand
  .command('list')
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

      if (options.json) {
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

        const response = await apiClient.post<any>('/admin/droplets/provision', {
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

        if (options.json) {
          console.log(JSON.stringify(response.data, null, 2));
          return;
        }

        const data = response.data as any;
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

        if (options.json) {
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

      if (options.json) {
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

      if (options.json) {
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

    if (!options.yes) {
      const inquirer = await import('inquirer');
      const { confirm } = await inquirer.default.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: chalk.yellow(`Remove user ${targetUserId} from company ${companyId}?`),
        default: false,
      }]);
      if (!confirm) {
        console.log(chalk.dim('  Cancelled.'));
        return;
      }
    }

    const spinner = ora('Revoking member access...').start();

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
