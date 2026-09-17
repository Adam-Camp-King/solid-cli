/**
 * Onboarding / setup-wizard commands.
 * Wraps controllers/setup_wizard.py at /api/v1/setup-wizard/* and
 * controllers/onboarding_v2.py at /api/v1/onboarding-v2/*.
 *
 * This is the programmatic path to provision a brand-new client end-to-end:
 * email + domain + phone (BUY a Twilio number) + payment + website. Anything
 * an agency does in the UI wizard, they can do here.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient } from '../lib/api-client';
import { isJsonOutput } from '../lib/json-output';
import { adoptSessionToken, AdoptResult } from '../lib/session-token';

function requireAuth() {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
}


// NOTE: previously aliased as `setup`, but `solid setup` is now the local-CLI
// onboarding wizard (Phase 2 of SPRINT-CLI-ONE-COMMAND-ONBOARDING). The two
// concepts collided — this one provisions a NEW CLIENT (email/domain/phone/
// payment/website), the other wires the local CLI install. The local one is
// hit far more often, so it owns the `setup` verb.
export const onboardingCommand = new Command('onboarding')
  .description('Programmatic CLIENT onboarding (email, domain, phone-buy, payment, website)');

// ── Status ────────────────────────────────────────────────────────────

onboardingCommand
  .command('status')
  .description('Overall onboarding status for the company')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading status...').start();
    try {
      const res = await apiClient.get('/api/v1/setup-wizard/status');
      const s = res.data as Record<string, any>;
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(s, null, 2)); return; }
      spinner.succeed(chalk.green('Setup status'));
      console.log('');
      const dot = (b: any) => (b ? chalk.green('✓') : chalk.dim('○'));
      console.log(`  ${dot(s.email_complete)} Email`);
      console.log(`  ${dot(s.phone_complete)} Phone`);
      console.log(`  ${dot(s.payment_complete)} Payment`);
      console.log(`  ${dot(s.website_complete)} Website`);
      console.log(`  ${dot(s.complete)} ${chalk.bold('Overall complete')}`);
    } catch (e) { fail(spinner, 'Failed to load status', e); }
  });

onboardingCommand
  .command('health')
  .description('Setup wizard infrastructure health check')
  .action(async () => {
    requireAuth();
    const spinner = ora('Checking...').start();
    try {
      const res = await apiClient.get('/api/v1/setup-wizard/health');
      spinner.succeed(chalk.green('Health'));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

// ── Email subcommand group ────────────────────────────────────────────

const emailCmd = new Command('email').description('Email onboarding (domain, addresses, provider)');

emailCmd
  .command('status')
  .description('Email setup status')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading email status...').start();
    try {
      const res = await apiClient.get('/api/v1/setup-wizard/email/status');
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(res.data, null, 2)); return; }
      spinner.succeed(chalk.green('Email status'));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

emailCmd
  .command('domain-check <domain>')
  .description('Check whether a domain is available + already-configured')
  .action(async (domain) => {
    requireAuth();
    const spinner = ora(`Checking ${domain}...`).start();
    try {
      const res = await apiClient.post('/api/v1/setup-wizard/email/domain/check', { domain });
      spinner.succeed(chalk.green('Result'));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

emailCmd
  .command('domain-add <domain>')
  .description('Add a custom domain for email')
  .action(async (domain) => {
    requireAuth();
    const spinner = ora(`Adding ${domain}...`).start();
    try {
      await apiClient.post('/api/v1/setup-wizard/email/domain/add', { domain });
      spinner.succeed(chalk.green('Domain added — verify ownership next'));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

emailCmd
  .command('domain-verify-ownership <domain>')
  .description('Trigger ownership verification (DNS TXT)')
  .action(async (domain) => {
    requireAuth();
    const spinner = ora(`Verifying ownership of ${domain}...`).start();
    try {
      const res = await apiClient.post('/api/v1/setup-wizard/email/domain/verify-ownership', { domain });
      spinner.succeed(chalk.green('Ownership verification result'));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

emailCmd
  .command('domain-verify <domain>')
  .description('Verify SPF/DKIM/DMARC (final email-domain verification)')
  .action(async (domain) => {
    requireAuth();
    const spinner = ora(`Verifying ${domain}...`).start();
    try {
      const res = await apiClient.post('/api/v1/setup-wizard/email/domain/verify', { domain });
      spinner.succeed(chalk.green('Verify result'));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

emailCmd
  .command('address-create')
  .description('Create a single email address')
  .requiredOption('--local <part>', 'Local part (left of @)')
  .requiredOption('--domain <domain>', 'Domain')
  .option('--name <name>', 'Display name')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Creating address...').start();
    try {
      const body: Record<string, unknown> = { local_part: opts.local, domain: opts.domain };
      if (opts.name) body.display_name = opts.name;
      const res = await apiClient.post('/api/v1/setup-wizard/email/addresses/create', body);
      spinner.succeed(chalk.green('Address created'));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

emailCmd
  .command('address-defaults')
  .description('Bulk-create default agent addresses (sarah@, marcus@, info@, etc.)')
  .requiredOption('--domain <domain>', 'Domain')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Creating default addresses...').start();
    try {
      const res = await apiClient.post('/api/v1/setup-wizard/email/addresses/create-defaults', { domain: opts.domain });
      spinner.succeed(chalk.green('Defaults created'));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

emailCmd
  .command('address-employee')
  .description('Create an employee email address')
  .requiredOption('--user-id <id>', 'User ID')
  .requiredOption('--local <part>', 'Local part')
  .requiredOption('--domain <domain>', 'Domain')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Creating employee address...').start();
    try {
      const res = await apiClient.post('/api/v1/setup-wizard/email/addresses/create-employee', {
        user_id: parseInt(opts.userId, 10),
        local_part: opts.local,
        domain: opts.domain,
      });
      spinner.succeed(chalk.green('Created'));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

emailCmd
  .command('address-delete <address_id>')
  .description('Delete an email address')
  .action(async (id) => {
    requireAuth();
    const spinner = ora('Deleting...').start();
    try {
      await apiClient.post('/api/v1/setup-wizard/email/addresses/delete', { address_id: parseInt(id, 10) });
      spinner.succeed(chalk.green('Deleted'));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

emailCmd
  .command('connect-oauth')
  .description('Begin OAuth flow to connect an existing email provider (Gmail/M365)')
  .requiredOption('--provider <name>', 'gmail | microsoft365')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Initiating OAuth...').start();
    try {
      const res = await apiClient.post('/api/v1/setup-wizard/email/connect-oauth', { provider: opts.provider });
      const r = res.data as Record<string, any>;
      spinner.succeed(chalk.green('OAuth flow started'));
      if (r.auth_url) console.log(chalk.cyan(`\n  ${r.auth_url}`));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

emailCmd
  .command('skip')
  .description('Skip the email step for this company')
  .action(async () => {
    requireAuth();
    const spinner = ora('Skipping...').start();
    try {
      await apiClient.post('/api/v1/setup-wizard/email/skip');
      spinner.succeed(chalk.green('Email step skipped'));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

emailCmd
  .command('complete')
  .description('Mark the email step complete')
  .action(async () => {
    requireAuth();
    const spinner = ora('Completing...').start();
    try {
      await apiClient.post('/api/v1/setup-wizard/email/complete');
      spinner.succeed(chalk.green('Email step complete'));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

onboardingCommand.addCommand(emailCmd);

// ── Phone subcommand group (BUY a Twilio number) ──────────────────────

const phoneCmd = new Command('phone').description('Phone provisioning — search + buy Twilio numbers');

phoneCmd
  .command('status')
  .description('Phone setup status')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading...').start();
    try {
      const res = await apiClient.get('/api/v1/setup-wizard/phone/status');
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(res.data, null, 2)); return; }
      spinner.succeed(chalk.green('Phone status'));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

phoneCmd
  .command('search')
  .description('Search Twilio inventory for available numbers')
  .option('--area-code <code>', 'Area code (e.g. 415)')
  .option('--type <t>', 'local | toll_free', 'local')
  .option('-l, --limit <n>', 'Max results (1-20)', '10')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const body: Record<string, unknown> = {
      number_type: opts.type,
      limit: parseInt(opts.limit, 10),
    };
    if (opts.areaCode) body.area_code = opts.areaCode;
    const spinner = ora('Searching Twilio...').start();
    try {
      const res = await apiClient.post('/api/v1/setup-wizard/phone/search', body);
      const data = res.data as Record<string, any>;
      const items = data.numbers || data.results || [];
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(data, null, 2)); return; }
      // Surface backend's "Twilio not configured" message so users don't think
      // they got 0 real results — they got 0 because the account is unwired.
      if (data.message) {
        spinner.warn(chalk.yellow(data.message));
      } else if (items.length === 0) {
        spinner.warn(chalk.yellow('No matching numbers available. Try a different --area-code or --type toll_free.'));
      } else {
        spinner.succeed(chalk.green(`${items.length} number(s) available`));
        const cost = data.monthly_cost ? ` (monthly cost: $${(data.monthly_cost / 100).toFixed(2)})` : '';
        if (cost) console.log(chalk.dim(`  Pricing:${cost}`));
        console.log('');
      }
      for (const n of items as Record<string, any>[]) {
        const caps = (n.capabilities && typeof n.capabilities === 'object')
          ? Object.entries(n.capabilities).filter(([, v]) => v).map(([k]) => k).join(',')
          : '';
        console.log(`  ${chalk.bold(n.phone_number || n.number)}  ${chalk.dim(n.locality || n.region || '')}  ${chalk.dim(caps)}`);
      }
    } catch (e) { fail(spinner, 'Search failed', e); }
  });

phoneCmd
  .command('buy <e164>')
  .description('PURCHASE a phone number from Twilio (incurs cost)')
  .action(async (e164) => {
    requireAuth();
    const spinner = ora(`Provisioning ${e164}...`).start();
    try {
      const res = await apiClient.post('/api/v1/setup-wizard/phone/provision', { phone_number: e164 });
      const r = res.data as Record<string, any>;
      spinner.succeed(chalk.green(`Number provisioned: ${r.phone_number || e164}`));
    } catch (e) { fail(spinner, 'Provision failed', e); }
  });

phoneCmd
  .command('verify <e164>')
  .description('Trigger verification SMS to the new number')
  .action(async (e164) => {
    requireAuth();
    const spinner = ora('Sending verification...').start();
    try {
      await apiClient.post('/api/v1/setup-wizard/phone/verify', { phone_number: e164 });
      spinner.succeed(chalk.green('Verification sent'));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

phoneCmd
  .command('own-number')
  .description('Use a phone number you already own (BYOC)')
  .requiredOption('--e164 <number>', 'Existing E.164 number')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Configuring...').start();
    try {
      await apiClient.post('/api/v1/setup-wizard/phone/own-number', { phone_number: opts.e164 });
      spinner.succeed(chalk.green('Configured'));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

phoneCmd
  .command('assign-agent')
  .description('Assign an AI agent to a phone number')
  .requiredOption('--e164 <number>', 'Phone number')
  .requiredOption('--agent <type>', 'Agent type (e.g. sarah)')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora(`Assigning ${opts.agent} to ${opts.e164}...`).start();
    try {
      await apiClient.post('/api/v1/setup-wizard/phone/assign-agent', {
        phone_number: opts.e164,
        agent_type: opts.agent,
      });
      spinner.succeed(chalk.green('Agent assigned'));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

phoneCmd
  .command('agents')
  .description('List agents available to assign to a phone line')
  .action(async () => {
    requireAuth();
    const spinner = ora('Loading agents...').start();
    try {
      const res = await apiClient.get('/api/v1/setup-wizard/phone/agents');
      spinner.succeed(chalk.green('Agents'));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

phoneCmd
  .command('skip')
  .description('Skip phone setup')
  .action(async () => {
    requireAuth();
    const spinner = ora('Skipping...').start();
    try {
      await apiClient.post('/api/v1/setup-wizard/phone/skip');
      spinner.succeed(chalk.green('Skipped'));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

phoneCmd
  .command('complete')
  .description('Mark phone setup complete')
  .action(async () => {
    requireAuth();
    const spinner = ora('Completing...').start();
    try {
      await apiClient.post('/api/v1/setup-wizard/phone/complete');
      spinner.succeed(chalk.green('Complete'));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

onboardingCommand.addCommand(phoneCmd);

// ── Payment subcommand group ──────────────────────────────────────────

const paymentCmd = new Command('payment').description('Payment setup');

paymentCmd
  .command('save')
  .description('Save a payment method (token from frontend Stripe Elements)')
  .requiredOption('--token <token>', 'Stripe payment method token')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Saving payment method...').start();
    try {
      await apiClient.post('/api/v1/setup-wizard/payment/save', { payment_method_token: opts.token });
      spinner.succeed(chalk.green('Payment method saved'));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

paymentCmd
  .command('skip')
  .description('Skip payment setup')
  .action(async () => {
    requireAuth();
    const spinner = ora('Skipping...').start();
    try {
      await apiClient.post('/api/v1/setup-wizard/payment/skip');
      spinner.succeed(chalk.green('Skipped'));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

onboardingCommand.addCommand(paymentCmd);

// ── Website subcommand group ──────────────────────────────────────────

const websiteCmd = new Command('website').description('Website provisioning');

websiteCmd
  .command('save')
  .description('Save initial website config (template + domain)')
  .requiredOption('--template <slug>', 'Template slug (e.g. basecamp)')
  .option('--domain <domain>', 'Custom domain')
  .action(async (opts) => {
    requireAuth();
    const body: Record<string, unknown> = { template: opts.template };
    if (opts.domain) body.domain = opts.domain;
    const spinner = ora('Saving website config...').start();
    try {
      await apiClient.post('/api/v1/setup-wizard/website/save', body);
      spinner.succeed(chalk.green('Website config saved'));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

websiteCmd
  .command('verify-domain <domain>')
  .description('Verify the website custom domain DNS')
  .action(async (domain) => {
    requireAuth();
    const spinner = ora(`Verifying ${domain}...`).start();
    try {
      const res = await apiClient.post('/api/v1/setup-wizard/website/verify-domain', { domain });
      spinner.succeed(chalk.green('Verify result'));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

websiteCmd
  .command('skip')
  .description('Skip website setup')
  .action(async () => {
    requireAuth();
    const spinner = ora('Skipping...').start();
    try {
      await apiClient.post('/api/v1/setup-wizard/website/skip');
      spinner.succeed(chalk.green('Skipped'));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

onboardingCommand.addCommand(websiteCmd);

// ── Top-level: complete entire wizard ─────────────────────────────────

onboardingCommand
  .command('complete')
  .description('Mark the whole onboarding wizard complete')
  .action(async () => {
    requireAuth();
    const spinner = ora('Completing onboarding...').start();
    try {
      await apiClient.post('/api/v1/setup-wizard/complete');
      spinner.succeed(chalk.green('Onboarding complete 🎉'));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

onboardingCommand
  .command('help-request')
  .description('Send a help request from the onboarding wizard')
  .requiredOption('--message <text>', 'Help message')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Sending...').start();
    try {
      await apiClient.post('/api/v1/setup-wizard/help-request', { message: opts.message });
      spinner.succeed(chalk.green('Help request sent'));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

// ── Onboarding v2 (newer business-discover flow) ──────────────────────
//
// ⛔ NO LOGIN REQUIRED for discover / set-business / provision / session.
// These are how someone WITHOUT an account signs up from the terminal; the
// backend routes (solid-backend controllers/onboarding_v2.py) are public and
// rate-limited (discover/set-business/session 30/min, provision 5/hour per IP).
// `provision` returns an `auth_token`, which is stored as the CLI session the
// same way `solid auth login --token` stores one (lib/session-token.ts).

/**
 * Pure: build the provision request body from `--data` JSON plus explicit
 * flags (flags win). Returns the body or the list of missing required fields.
 */
export function buildProvisionBody(
  data: string | undefined,
  flags: Record<string, unknown>,
): { body: Record<string, unknown>; missing: string[] } | { error: string } {
  let body: Record<string, unknown> = {};
  if (data) {
    try {
      const parsed = JSON.parse(data);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { error: '--data must be a JSON object' };
      }
      body = { ...parsed };
    } catch (e) {
      return { error: `--data is not valid JSON: ${(e as Error).message}` };
    }
  }
  const map: Array<[string, string]> = [
    ['session', 'session_id'], ['email', 'email'], ['businessName', 'business_name'],
    ['password', 'password'], ['ownerName', 'owner_name'], ['industry', 'industry'],
    ['zip', 'business_zip'], ['state', 'business_state'], ['city', 'business_city'], ['street', 'business_street'],
  ];
  for (const [flag, field] of map) {
    const v = flags[flag];
    if (typeof v === 'string' && v.trim() !== '') body[field] = v;
  }
  const missing = ['session_id', 'email', 'business_name'].filter(
    (k) => typeof body[k] !== 'string' || String(body[k]).trim() === '',
  );
  return { body, missing };
}

onboardingCommand
  .command('discover')
  .description('Step 1 of terminal sign-up (no login needed): match a business to an industry template, get a session ID')
  .requiredOption('--message <text>', 'Business description or industry keyword (e.g. "plumber", "acme plumbing services")')
  .option('--session <id>', 'Existing session ID (resume a flow)')
  .option('--ref <code>', 'Partner referral code')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const body: Record<string, unknown> = { message: opts.message };
    if (opts.session) body.session_id = opts.session;
    if (opts.ref) body.ref_code = opts.ref;
    const json = isJsonOutput(opts);
    const spinner = ora({ text: 'Discovering...', isSilent: json }).start();
    try {
      const res = await apiClient.post('/api/v1/onboarding-v2/discover', body);
      const r = res.data as Record<string, any>;
      if (json) { spinner.stop(); console.log(JSON.stringify(r, null, 2)); return; }
      if (r.blocked) {
        spinner.warn(chalk.yellow(r.blocked_message || 'Discovery blocked'));
        process.exitCode = 1;
        return;
      }
      spinner.succeed(chalk.green(r.matched ? 'Match found' : 'No direct match'));
      console.log('');
      console.log(`  ${chalk.bold('Session:')}   ${r.session_id}`);
      if (r.industry) {
        console.log(`  ${chalk.bold('Industry:')}  ${r.industry.name || r.industry.code || JSON.stringify(r.industry)}`);
      }
      if (r.suggestions && r.suggestions.length > 0) {
        console.log('');
        console.log(chalk.bold('  Suggestions:'));
        for (const s of r.suggestions) {
          console.log(`    ${typeof s === 'string' ? s : (s.label || s.name || JSON.stringify(s))}`);
        }
      }
      console.log('');
      console.log(chalk.dim(`  Next: solid onboarding set-business --session ${r.session_id} --name "<business name>"`));
    } catch (e) { fail(spinner, 'Discovery failed', e); }
  });

onboardingCommand
  .command('set-business')
  .description('Step 2 of terminal sign-up (no login needed): save the business name to a discovery session')
  .requiredOption('--name <name>', 'Business name')
  .option('--session <id>', 'Existing session ID (omit to start a new session)')
  .option('--phone <phone>', 'Business phone')
  .option('--sub-category <label>', 'Industry sub-category label (from discover suggestions)')
  .option('--kb-sub-code <code>', 'Industry kb_sub_code (from discover suggestions)')
  .option('--mcc <code>', 'MCC code (from discover suggestions)')
  .option('--ref <code>', 'Partner referral code')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const body: Record<string, unknown> = { business_name: opts.name };
    if (opts.session) body.session_id = opts.session;
    if (opts.phone) body.business_phone = opts.phone;
    if (opts.subCategory) body.sub_category = opts.subCategory;
    if (opts.kbSubCode !== undefined) {
      const code = parseInt(String(opts.kbSubCode), 10);
      if (Number.isNaN(code)) { console.error(chalk.red('--kb-sub-code must be a number')); process.exit(1); }
      body.kb_sub_code = code;
    }
    if (opts.mcc) body.mcc_code = opts.mcc;
    if (opts.ref) body.ref_code = opts.ref;
    const json = isJsonOutput(opts);
    const spinner = ora({ text: 'Saving business name...', isSilent: json }).start();
    try {
      const res = await apiClient.post('/api/v1/onboarding-v2/set-business', body);
      spinner.stop();
      const r = res.data as Record<string, any>;
      if (json) { console.log(JSON.stringify(r, null, 2)); return; }
      console.log(chalk.green('  Saved'));
      console.log(`  ${chalk.bold('Session:')} ${r.session_id}   ${chalk.dim(`state: ${r.state}`)}`);
      console.log('');
      console.log(chalk.dim(`  Next: solid onboarding provision --session ${r.session_id} --email <you@example.com> --business-name "${opts.name}" --password <min 8 chars>`));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

onboardingCommand
  .command('provision')
  .description('Step 3 of terminal sign-up (no login needed): create the account + company and log this CLI in as it')
  .option('--session <id>', 'Session ID from discover / set-business (required)')
  .option('--email <email>', 'Owner email (required)')
  .option('--business-name <name>', 'Business name (required)')
  .option('--password <password>', 'Account password, min 8 chars (strongly recommended — without it the backend sets a random one)')
  .option('--owner-name <name>', 'Owner full name')
  .option('--industry <name>', 'Industry keyword (used only if the session has no industry match)')
  .option('--zip <zip>', 'Business ZIP (decides which card-fee programs are legal where you trade)')
  .option('--state <st>', 'Business state (2 letters)')
  .option('--city <city>', 'Business city')
  .option('--street <street>', 'Business street address')
  .option('--data <json>', 'Full request body as JSON (fields: session_id, email, business_name, password, …); flags override it')
  .option('--no-login', 'Do not store the returned token as this CLI\'s session (prints it instead)')
  .option('--json', 'Output as JSON (the token is redacted when it was stored)')
  .action(async (opts) => {
    const built = buildProvisionBody(opts.data, opts);
    if ('error' in built) { console.error(chalk.red(built.error)); process.exit(1); }
    if (built.missing.length > 0) {
      console.error(chalk.red(`Missing required: ${built.missing.join(', ')}`));
      console.error(chalk.dim('  Use --session, --email, --business-name (or put them in --data).'));
      process.exit(1);
    }
    const json = isJsonOutput(opts);
    if (!built.body.password && !json) {
      console.error(chalk.yellow('  No --password given: the backend will set a random password you will not see.'));
      console.error(chalk.yellow('  This CLI session will work, but to log in elsewhere you will need a password reset.'));
    }
    const spinner = ora({ text: 'Provisioning tenant...', isSilent: json }).start();
    let r: Record<string, any>;
    try {
      const res = await apiClient.post('/api/v1/onboarding-v2/provision', built.body);
      r = res.data as Record<string, any>;
    } catch (e) { fail(spinner, 'Provision failed', e); }

    // The backend answers business-rule refusals (duplicate email, duplicate
    // business name, blocked industry, internal failure) as HTTP 200 with
    // success:false — that is a failure, and must exit non-zero.
    if (!r.success) {
      spinner.stop();
      if (json) {
        console.log(JSON.stringify({ ...r, auth_token: undefined }, null, 2));
      } else {
        console.error(chalk.red(`  Provision refused: ${r.message || 'unknown reason'}`));
      }
      process.exit(1);
    }

    const token: string | undefined = r.auth_token || undefined;
    let adopt: AdoptResult | null = null;
    const previousCompany = config.isLoggedIn() ? config.companyId : undefined;
    if (token && opts.login !== false) {
      adopt = await adoptSessionToken(token, {
        companyId: r.company_id,
        userId: r.user_id,
        email: typeof built.body.email === 'string' ? built.body.email : undefined,
      });
    }
    spinner.stop();

    if (json) {
      const out: Record<string, unknown> = { ...r };
      if (adopt) {
        out.auth_token = '[stored as the CLI session]';
        out.session = {
          stored: true,
          confirmed: adopt.confirmed,
          ...(adopt.confirmed ? {} : { reason: adopt.reason }),
          previous_company_id: previousCompany ?? null,
        };
      } else {
        out.session = { stored: false, reason: token ? 'no_login_flag' : 'backend_returned_no_token' };
      }
      console.log(JSON.stringify(out, null, 2));
      return;
    }

    console.log(chalk.green(`  ✓ ${r.message || 'Account created'}`));
    console.log(`  ${chalk.bold('Company ID:')} ${r.company_id}`);
    console.log(`  ${chalk.bold('User ID:')}    ${r.user_id}`);
    if (r.dashboard_url) console.log(`  ${chalk.bold('Dashboard:')}  https://app.solidnumber.com${r.dashboard_url}`);
    console.log('');
    if (adopt) {
      console.log(chalk.green(`  ✓ Logged this CLI in as company ${r.company_id}.`));
      if (previousCompany && previousCompany !== r.company_id) {
        console.log(chalk.yellow(`    (Replaced the previous session for company ${previousCompany} — \`solid auth login\` to go back.)`));
      }
      if (!adopt.confirmed) {
        console.log(adopt.reason === 'env_credential_overrides'
          ? chalk.yellow('    SOLID_API_KEY / SOLID_TOKEN is set and outranks the stored session — unset it to act as the new account.')
          : chalk.yellow('    Stored, but /auth/me could not confirm it yet. Check with: solid auth status'));
      }
      console.log(chalk.dim('    The token has no refresh token; when it expires run `solid auth login`.'));
    } else if (token) {
      console.log(chalk.yellow('  --no-login: token NOT stored. Use it with: solid auth login --token <token>'));
      console.log(`  ${token}`);
    } else {
      console.log(chalk.yellow('  The backend returned no auth token. Log in with: solid auth login'));
    }
  });

onboardingCommand
  .command('session')
  .description('Get an onboarding v2 session (no login needed)')
  .requiredOption('--session <id>', 'Session ID from discover / set-business')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const json = isJsonOutput(opts);
    const spinner = ora({ text: 'Loading session...', isSilent: json }).start();
    try {
      const res = await apiClient.get('/api/v1/onboarding-v2/session', { params: { session_id: opts.session } });
      spinner.stop();
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

import { appendExamples as __ae_onb, fail } from '../lib/command-kit';
__ae_onb(onboardingCommand, [
  { cmd: 'solid onboarding status',                                   why: 'Onboarding progress per company' },
  { cmd: 'solid onboarding health',                                   why: 'Onboarding service health' },
  { cmd: 'solid onboarding discover --message "plumber"',              why: 'Sign up with no account: step 1' },
  { cmd: 'solid onboarding provision --session <id> --email <e> --business-name <n> --password <p>', why: 'Create the account + log the CLI in' },
  { cmd: 'solid onboarding address-create --line1 ... --city ...',    why: 'Seed a company address' },
]);
