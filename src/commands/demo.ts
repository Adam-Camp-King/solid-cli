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
import { apiClient, CLI_VERSION, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';
import { emit as emitTelemetry } from '../lib/telemetry';
import { captureEmail, getIdentity } from '../lib/first-run';
import { input as tuiInput, isInteractive } from '../lib/tui';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Capture email at the highest-intent moment — user is about to receive a
 * phone number. Skipped if we already have an email, telemetry is disabled,
 * or stdin is not a TTY (CI, pipes). Never blocks the command on failure.
 */
export async function captureEmailForDemo(template: string): Promise<void> {
  try {
    if (process.env.SOLID_DISABLE_TELEMETRY === '1') return;
    if (!isInteractive()) return;
    const id = getIdentity();
    if (id?.email) return;

    console.log(chalk.dim('  Where should we send the phone number? (we use this to reach you if the demo needs help)'));
    const answer = await tuiInput('Email', {
      validate: (v: string) => {
        const t = v.trim();
        if (!t) return 'Email is required to deliver the phone number.';
        if (!EMAIL_RE.test(t)) return 'That doesn\'t look like a valid email.';
        return true;
      },
    });

    await captureEmail(answer.trim(), 'demo-create');

    try {
      emitTelemetry('demo_email_captured', {
        command: 'demo create',
        extra: { template, source: 'demo-create' },
      });
    } catch {
      /* telemetry never fatal */
    }
  } catch {
    /* never block demo creation on email-capture issues */
  }
}

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
  .option('--guest', 'No-signup ephemeral demo (default 24h, no email gate). Hits the public anonymous endpoint instead of the authenticated agency flow.')
  .action(async (template, name, options) => {
    // Guest mode: zero-friction path. POSTs to /api/v1/public/demo/create
    // directly — no login, no email capture, no agency context. Synthetic
    // email keeps the audit row intact without surfacing a real address.
    if (options.guest) {
      await createGuestDemo(template, name, options);
      return;
    }

    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      console.error(chalk.dim('Or try the guest path: solid demo create ' + template + ' "' + name + '" --guest'));
      process.exit(1);
    }

    // Highest-intent capture moment: user wants the phone number, they trade
    // email. No-ops if already captured, telemetry off, or non-TTY.
    await captureEmailForDemo(template);

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
      // Restore original company before exiting so state isn't left wrong.
      if (originalCompanyId) {
        await apiClient.companySwitch(originalCompanyId).catch(() => {});
        config.companyId = originalCompanyId;
      }
      process.exit(1);
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
      process.exit(1);
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
      process.exit(1);
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

// ── Guest-mode (no signup, no auth, no email gate) ───────────────

interface GuestDemoResponse {
  demo_token: string;
  company_id: number;
  slug: string;
  site_url: string;
  phone_number: string | null;
  expires_at: string;
  template_label: string;
}

/**
 * Generate a synthetic email for the audit row so the public endpoint's
 * email validator accepts the request. The address routes to a discard
 * mailbox at @anonymous.solidnumber.com — no real human ever receives mail
 * sent here. Pattern lets analytics filter on `*@anonymous.solidnumber.com`
 * to count guest-CLI demos.
 */
export function synthesizeGuestEmail(): string {
  const rand = Math.random().toString(36).slice(2, 12);
  const ts = Date.now().toString(36);
  return `cli-guest-${ts}-${rand}@anonymous.solidnumber.com`;
}

async function createGuestDemo(
  template: string,
  name: string,
  options: { expires?: string; open?: boolean },
): Promise<void> {
  const ora = (await import('ora')).default;
  const startTime = Date.now();

  // Guest default is 24h unless user explicitly overrode --expires.
  const wasExplicitExpires =
    options.expires !== undefined && options.expires !== '72h';
  const expiresHours = wasExplicitExpires
    ? Math.min(parseExpires(options.expires!), 168)
    : 24;

  const apiUrl = process.env.SOLID_API_URL || 'https://api.solidnumber.com';
  const endpoint = `${apiUrl}/api/v1/public/demo/create`;

  console.log('');
  console.log(
    chalk.bold.hex('#10b981')(
      `  ✨ Creating guest demo: ${chalk.white(name)} (${template})`,
    ),
  );
  console.log(
    chalk.dim(
      `  No account · expires in ${expiresHours}h · hold tight...`,
    ),
  );
  console.log('');

  const spinner = ora({
    text: 'Provisioning anonymous demo...',
    prefixText: ' ',
  }).start();

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': `solid-cli/${CLI_VERSION || 'dev'} guest-mode`,
      },
      body: JSON.stringify({
        template,
        business_name: name,
        email: synthesizeGuestEmail(),
        consent: true,
        expires_hours: expiresHours,
      }),
    });

    if (!res.ok) {
      let detail = '';
      try {
        const err = (await res.json()) as { detail?: { message?: string } };
        detail = err.detail?.message ?? '';
      } catch {
        /* ignore parse errors */
      }
      spinner.fail(chalk.red(`Demo failed (HTTP ${res.status})`));
      if (res.status === 429) {
        console.error(
          chalk.yellow(
            '  Rate limited (3 demos per IP per hour). Try again in a bit.',
          ),
        );
      } else if (detail) {
        console.error(chalk.dim(`  ${detail}`));
      }
      process.exit(1);
    }

    const data = (await res.json()) as GuestDemoResponse;
    const elapsedSec = Math.round((Date.now() - startTime) / 1000);
    spinner.succeed(chalk.green(`Guest demo live in ${elapsedSec}s`));

    const divider = chalk.hex('#10b981')('━'.repeat(56));
    console.log('');
    console.log('  ' + divider);
    console.log('');
    console.log(
      chalk.bold.hex('#10b981')(`  🎉 ${name} is LIVE (guest mode).`),
    );
    console.log('');
    if (data.phone_number) {
      console.log(chalk.dim('  Call the AI right now:'));
      console.log('');
      console.log(chalk.bold.green(`      📞  ${data.phone_number}`));
      console.log('');
      console.log(
        chalk.dim('  A real AI receptionist will answer as your business.'),
      );
    } else {
      console.log(
        chalk.yellow('  ⚠  Phone provisioning pending or unavailable.'),
      );
    }
    console.log('');
    console.log(chalk.dim('  Visit the site:'));
    console.log(`      🌐  ${chalk.cyan(data.site_url)}`);
    console.log('');
    console.log('  ' + divider);
    console.log('');
    console.log(
      chalk.dim(
        `  Company ID: ${data.company_id}  ·  Expires: ${new Date(
          data.expires_at,
        ).toLocaleString()}`,
      ),
    );
    console.log('');
    console.log(
      chalk.dim(
        '  Like it? Keep it: `npm i -g @solidnumber/cli && solid auth login`',
      ),
    );
    console.log('');

    if (options.open !== false) {
      const { exec } = await import('child_process');
      exec(`open "${data.site_url}"`);
    }
  } catch (error) {
    spinner.fail(chalk.red('Failed to create guest demo'));
    const msg = error instanceof Error ? error.message : String(error);
    console.error(chalk.dim(`  ${msg}`));
    process.exit(1);
  }
}
