/**
 * Demo company for agency prospects — the killer sales tool
 *
 * solid demo create plumber "Joe's Plumbing"           → Live demo with AI
 * solid demo create plumber "Joe's" --expires 72h      → Auto-destroys after 72h
 * solid demo list                                      → Active demos
 * solid demo convert <id> --tier starter               → Convert demo to paid
 * solid demo delete <id>                               → Clean up
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';

export const demoCommand = new Command('demo')
  .description('Create live demo companies for prospects — AI answers the phone')
  .addHelpText('after', `
Examples:
  $ solid demo create plumber "Joe's Plumbing"        # live in ~20s, real AI + fake phone #
  $ solid demo create hvac "Northwind" --expires 72h  # auto-destroys after 72h (default)
  $ solid demo list                                   # all active demos for this agency
  $ solid demo convert 47 --tier starter              # turn demo 47 into a paid tenant
  $ solid demo delete 47 --yes                        # tear it down early

Output: each demo prints a dashboard URL (hosted on *.solidnumber.com) and
a test phone number. Use in a sales meeting — call the number, the AI answers.`);

// ── Create demo ──────────────────────────────────────────────────

demoCommand
  .command('create <template> <name>')
  .description('Spin up a live demo with AI agents and a real phone number')
  .option('--expires <duration>', 'Auto-destroy after duration (e.g., 72h, 7d)', '72h')
  .option('--password <pass>', 'Set a demo login password')
  .option('--open', 'Open in browser after creation')
  .action(async (template, name, options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const ora = (await import('ora')).default;
    const originalCompanyId = config.companyId;

    console.log('');
    console.log(ui.header(`Creating Demo — ${name}`));
    console.log('');

    const spinner = ora('Provisioning company...').start();

    try {
      // Step 1: Create company
      const createRes = await apiClient.companyCreate(name);
      const company = (createRes.data as Record<string, any>).company || createRes.data;
      const companyId = company.id || company.company_id;
      const slug = company.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

      // Step 2: Switch and apply template
      spinner.text = 'Applying industry template...';
      await apiClient.companySwitch(companyId);
      await apiClient.templateClone(template);

      // Step 3: Configure demo mode + auto-provision phone via backend
      spinner.text = 'Setting up demo (provisioning AI phone)...';
      const expiresHours = parseExpires(options.expires);
      const expiresAt = new Date(Date.now() + expiresHours * 60 * 60 * 1000);
      let phoneNumber = null;

      try {
        const demoRes = await apiClient.post(`/api/v1/cli/companies/${companyId}/demo-setup`);
        const demoData = demoRes.data as Record<string, any>;
        if (demoData.phone?.phone_number) {
          phoneNumber = demoData.phone.phone_number;
        }
      } catch {
        // Demo setup endpoint may not exist yet — fall back to checking existing phones
        try {
          const phoneRes = await apiClient.get('/api/v1/phone-numbers');
          const phones = (phoneRes.data as Record<string, any>).phone_numbers || [];
          if (phones.length > 0) {
            phoneNumber = phones[0].number || phones[0].phone_number;
          }
        } catch {
          // No phone — demo still works, just without voice AI
        }
      }

      // Switch back to original company
      if (originalCompanyId && originalCompanyId !== companyId) {
        await apiClient.companySwitch(originalCompanyId).catch(() => {});
        config.companyId = originalCompanyId;
      }

      spinner.succeed(chalk.green('Demo ready'));
      console.log('');
      console.log(`  ${chalk.bold('Company ID:')}  ${companyId}`);
      console.log(`  ${chalk.bold('Template:')}    ${template}`);
      console.log(`  ${chalk.bold('URL:')}         ${chalk.cyan(`https://${slug}.solidnumber.com`)}`);
      if (phoneNumber) {
        console.log(`  ${chalk.bold('AI Phone:')}    ${chalk.green(phoneNumber)} ${chalk.dim('— call it live')}`);
      }
      console.log(`  ${chalk.bold('Password:')}    ${options.password || chalk.dim('(auto-generated)')}`);
      console.log(`  ${chalk.bold('Expires:')}     ${expiresAt.toLocaleDateString()} ${expiresAt.toLocaleTimeString()} ${chalk.dim(`(${options.expires})`)}`);
      console.log('');
      console.log(chalk.dim('  Share the URL with your prospect.'));
      if (phoneNumber) {
        console.log(chalk.dim('  Have them call the number — AI answers as their business.'));
      }
      console.log('');
      console.log(`  ${chalk.dim('Convert to paid:')}  ${chalk.cyan(`solid demo convert ${companyId} --tier starter`)}`);
      console.log(`  ${chalk.dim('Clean up:')}         ${chalk.cyan(`solid demo delete ${companyId}`)}`);
      console.log('');

      if (options.open) {
        const { exec } = await import('child_process');
        exec(`open "https://${slug}.solidnumber.com"`);
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to create demo'));
      console.error(handleApiError(error).message);
      // Restore original company
      if (originalCompanyId) {
        await apiClient.companySwitch(originalCompanyId).catch(() => {});
        config.companyId = originalCompanyId;
      }
    }
  });

// ── Convert demo to paid ─────────────────────────────────────────

demoCommand
  .command('convert <companyId>')
  .description('Convert a demo to a paid company')
  .option('--tier <tier>', 'Subscription tier (starter, builder, professional, enterprise)', 'starter')
  .action(async (companyId, options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const ora = (await import('ora')).default;
    const spinner = ora(`Converting company ${companyId} to ${options.tier}...`).start();

    try {
      // Generate a checkout link for the company
      const res = await apiClient.post('/api/v1/billing/checkout-link', {
        company_id: parseInt(companyId),
        tier: options.tier,
      });

      const data = res.data as Record<string, any>;
      const checkoutUrl = data.url || data.checkout_url;

      if (checkoutUrl) {
        spinner.succeed(chalk.green('Checkout link generated'));
        console.log('');
        console.log(`  ${chalk.bold('Tier:')}     ${options.tier}`);
        console.log(`  ${chalk.bold('Checkout:')} ${chalk.cyan(checkoutUrl)}`);
        console.log('');
        console.log(chalk.dim('  Send this link to the client to complete payment.'));
        console.log(chalk.dim('  Once paid, demo restrictions are removed automatically.'));
        console.log('');

        // Try to open in browser
        const { exec } = await import('child_process');
        exec(`open "${checkoutUrl}"`);
      } else {
        spinner.succeed(chalk.green('Company converted'));
        console.log(chalk.dim('  Demo mode disabled. Company is now active.'));
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to convert'));
      console.error(handleApiError(error).message);
    }
  });

// ── List demos ───────────────────────────────────────────────────

demoCommand
  .command('list')
  .description('List all companies (find your demos)')
  .action(async () => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const ora = (await import('ora')).default;
    const spinner = ora('Loading companies...').start();

    try {
      const res = await apiClient.companiesList();
      const companies = res.data.companies || [];
      spinner.stop();

      console.log('');
      console.log(ui.header(`${companies.length} Companies`));
      console.log('');

      for (const c of companies) {
        const isActive = c.id === config.companyId;
        const marker = isActive ? chalk.green('● ') : '  ';
        console.log(`${marker}${chalk.bold(c.name)}  ${chalk.dim('ID:' + c.id)}  ${chalk.dim(c.role)}`);
      }

      console.log('');
      console.log(chalk.dim('  Convert: solid demo convert <id> --tier starter'));
      console.log(chalk.dim('  Delete:  solid demo delete <id>'));
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red('Failed'));
      console.error(handleApiError(error).message);
    }
  });

// ── Delete demo ──────────────────────────────────────────────────

demoCommand
  .command('delete <companyId>')
  .description('Delete a demo company')
  .action(async (companyId) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const ora = (await import('ora')).default;
    const spinner = ora(`Deleting company ${companyId}...`).start();

    try {
      await apiClient.delete(`/api/v1/cli/companies/${companyId}`);
      spinner.succeed(chalk.green(`Company ${companyId} deleted`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to delete'));
      console.error(handleApiError(error).message);
      console.log(chalk.dim('  Note: Only demo/test companies can be deleted via CLI.'));
    }
  });

// ── Helpers ──────────────────────────────────────────────────────

function parseExpires(duration: string): number {
  const match = duration.match(/^(\d+)(h|d|w)$/);
  if (!match) return 72; // default 72 hours
  const [, num, unit] = match;
  const n = parseInt(num);
  if (unit === 'h') return n;
  if (unit === 'd') return n * 24;
  if (unit === 'w') return n * 24 * 7;
  return 72;
}
