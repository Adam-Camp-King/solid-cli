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
import { emit as emitTelemetry } from '../lib/telemetry';

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
  .option('--no-open', "Don't auto-open the browser after creation")
  .action(async (template, name, options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const ora = (await import('ora')).default;
    const originalCompanyId = config.companyId;
    const startTime = Date.now();

    // Compact header — no box art; optimized for 80-char terminals and recording
    console.log('');
    console.log(chalk.bold.hex('#10b981')(`  ✨ Creating live AI business: ${chalk.white(name)}`));
    console.log(chalk.dim(`  Template: ${template} · expires in ${options.expires} · hold tight...`));
    console.log('');

    const spinner = ora({ text: 'Provisioning company...', prefixText: ' ' }).start();
    let step = 0;
    const updateStep = (text: string) => {
      step += 1;
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      spinner.text = `[${step}/3 · ${elapsed}s] ${text}`;
    };

    try {
      // Step 1: Create company
      updateStep('Provisioning company...');
      const createRes = await apiClient.companyCreate(name);
      const company = (createRes.data as Record<string, any>).company || createRes.data;
      const companyId = company.id || company.company_id;
      const slug = company.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

      // Step 2: Switch and apply template
      updateStep('Cloning industry template...');
      await apiClient.companySwitch(companyId);
      await apiClient.templateClone(template);

      // Step 3: Configure demo mode + auto-provision phone via backend
      updateStep('Wiring up AI + phone number...');
      const expiresHours = parseExpires(options.expires);
      const expiresAt = new Date(Date.now() + expiresHours * 60 * 60 * 1000);
      let phoneNumber: string | null = null;

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

      const elapsedSec = Math.round((Date.now() - startTime) / 1000);
      spinner.succeed(chalk.green(`Demo live in ${elapsedSec}s`));

      const url = `https://${slug}.solidnumber.com`;
      const divider = chalk.hex('#10b981')('━'.repeat(56));

      // The "receipt moment" — big + scannable + recording-friendly.
      console.log('');
      console.log('  ' + divider);
      console.log('');
      console.log(chalk.bold.hex('#10b981')(`  🎉 ${name} is LIVE.`));
      console.log('');
      if (phoneNumber) {
        // Phone number gets the biggest emphasis — it's the wow moment.
        console.log(chalk.dim('  Call the AI right now:'));
        console.log('');
        console.log(chalk.bold.green(`      📞  ${phoneNumber}`));
        console.log('');
        console.log(chalk.dim('  A real AI receptionist will answer as your business.'));
      } else {
        console.log(chalk.yellow('  ⚠  Phone provisioning pending — check back in a minute with:'));
        console.log(chalk.cyan(`    solid voice status --company ${companyId}`));
      }
      console.log('');
      console.log(chalk.dim('  Visit the site:'));
      console.log(`      🌐  ${chalk.cyan(url)}`);
      console.log('');
      console.log('  ' + divider);
      console.log('');
      console.log(chalk.dim(`  Company ID: ${companyId}  ·  Expires: ${expiresAt.toLocaleDateString()} ${expiresAt.toLocaleTimeString()}`));
      console.log('');
      console.log(chalk.dim('  Next moves:'));
      console.log(`    ${chalk.cyan(`solid demo convert ${companyId} --tier starter`)}   ${chalk.dim('# turn into a paid client')}`);
      console.log(`    ${chalk.cyan(`solid demo delete ${companyId}`)}                    ${chalk.dim('# tear it down early')}`);
      if (phoneNumber) {
        console.log(`    ${chalk.cyan(`solid voice train sarah --company ${companyId}`)}  ${chalk.dim('# teach the AI your business')}`);
      }
      console.log('');

      // Emit telemetry for funnel tracking
      try {
        emitTelemetry('demo_created', {
          command: 'demo create',
          extra: {
            template,
            company_id: companyId,
            has_phone: !!phoneNumber,
            elapsed_sec: elapsedSec,
            expires: options.expires,
          },
        });
      } catch {
        /* telemetry is never fatal */
      }

      // Auto-open browser unless --no-open explicitly passed (default is to open)
      if (options.open !== false) {
        const { exec } = await import('child_process');
        exec(`open "${url}"`);
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to create demo'));
      console.error(handleApiError(error).message);
      try {
        emitTelemetry('demo_failed', {
          command: 'demo create',
          extra: { template, error: handleApiError(error).message.slice(0, 200) },
        });
      } catch {
        /* noop */
      }
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

{
  const { withListFlags } = require('../lib/command-kit') as typeof import('../lib/command-kit');
  const listCmd = demoCommand.command('list').alias('ls').description('List all companies (find your demos)');
  withListFlags(listCmd);
  listCmd.action(async (opts: import('../lib/command-kit').ListFlags) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }
    const { runListCommand } = await import('../lib/command-kit');
    await runListCommand(opts, {
      spinnerText: 'Loading companies...',
      errorText: 'Failed to list companies',
      fetch: async () => (await apiClient.companiesList()).data,
      extract: (page) => {
        const d = page as Record<string, unknown>;
        return ((d.companies || d.items || []) as Array<Record<string, unknown>>);
      },
      render: (companies) => {
        console.log('');
        console.log(ui.header(`${companies.length} Companies`));
        console.log('');
        for (const c of companies) {
          const isActive = c.id === config.companyId;
          const marker = isActive ? chalk.green('● ') : '  ';
          console.log(`${marker}${chalk.bold(String(c.name))}  ${chalk.dim('ID:' + c.id)}  ${chalk.dim(String(c.role || ''))}`);
        }
        console.log('');
        console.log(chalk.dim('  Convert: solid demo convert <id> --tier starter'));
        console.log(chalk.dim('  Delete:  solid demo delete <id>'));
        console.log('');
      },
    });
  });
}

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
