/**
 * Authentication commands for Solid CLI
 */

import * as http from 'http';
import * as crypto from 'crypto';
import { spawn } from 'child_process';
import { URL } from 'url';
import { Command } from 'commander';
import inquirer from 'inquirer';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';
import { isJsonOutput } from '../lib/json-output';
import { frontendUrlFor } from '../lib/url-utils';

// ---------------------------------------------------------------------------
// Browser login (loopback OAuth — like `npm login`, `gh auth login`)
// ---------------------------------------------------------------------------

const BROWSER_LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '""', url] : [url];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // Caller is expected to print the URL anyway as a fallback
  }
}

export { frontendUrlFor } from '../lib/url-utils';

interface BrowserLoginResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

async function browserLogin(
  opts: { companyId?: number; fresh?: boolean } = {},
  onReady?: (url: string) => void,
): Promise<BrowserLoginResult> {
  const state = crypto.randomBytes(32).toString('hex');

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        server.close();
      } catch {
        /* ignore */
      }
      fn();
    };

    const server = http.createServer((req, res) => {
      try {
        const reqUrl = new URL(req.url || '/', 'http://localhost');
        if (reqUrl.pathname !== '/callback') {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not found');
          return;
        }

        const returnedState = reqUrl.searchParams.get('state') || '';
        const token = reqUrl.searchParams.get('token') || '';
        const refresh = reqUrl.searchParams.get('refresh_token') || undefined;
        const expires = reqUrl.searchParams.get('expires_in');
        const errorParam = reqUrl.searchParams.get('error');

        if (errorParam) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderHtml('Login cancelled', `Error: ${escapeHtml(errorParam)}. You can close this tab.`, false));
          finish(() => reject(new Error(`Browser auth error: ${errorParam}`)));
          return;
        }

        // Constant-time state comparison
        const a = Buffer.from(state);
        const b = Buffer.from(returnedState);
        const stateOk = a.length === b.length && crypto.timingSafeEqual(a, b);

        if (!stateOk || !token) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderHtml('Login failed', 'Invalid response. You can close this tab and try again.', false));
          finish(() => reject(new Error('Browser auth failed: state mismatch or missing token')));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderHtml('You\'re signed in', 'You can close this tab and return to your terminal.', true));
        finish(() => resolve({
          accessToken: token,
          refreshToken: refresh,
          expiresIn: expires ? parseInt(expires, 10) : undefined,
        }));
      } catch (err) {
        try {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Internal error');
        } catch {
          /* ignore */
        }
        finish(() => reject(err instanceof Error ? err : new Error(String(err))));
      }
    });

    server.on('error', (err) => finish(() => reject(err)));

    const timer = setTimeout(() => {
      finish(() => reject(new Error('Browser login timed out (no callback received)')));
    }, BROWSER_LOGIN_TIMEOUT_MS);

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        finish(() => reject(new Error('Failed to bind local port')));
        return;
      }
      const port = addr.port;
      const params = new URLSearchParams({ port: String(port), state });
      if (opts.companyId) params.set('company', String(opts.companyId));
      if (opts.fresh) params.set('fresh', '1');
      const url = `${frontendUrlFor(config.apiUrl)}/auth/cli-auth?${params.toString()}`;
      if (onReady) onReady(url);
      openBrowser(url);
    });
  });
}

function renderHtml(title: string, body: string, success: boolean): string {
  const accent = success ? '#10b981' : '#ef4444';
  const icon = success ? '✓' : '✕';
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  html,body{margin:0;height:100%;background:#0a0a0f;color:#fff;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Inter,sans-serif}
  .wrap{display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
  .card{max-width:420px;width:100%;text-align:center;padding:40px 32px;border-radius:24px;
        background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.02));
        border:1px solid rgba(255,255,255,.08)}
  .icon{width:56px;height:56px;border-radius:50%;background:${accent};color:#000;font-size:28px;font-weight:800;
        line-height:56px;margin:0 auto 20px}
  h1{font-size:22px;font-weight:800;margin:0 0 8px}
  p{font-size:14px;color:rgba(255,255,255,.6);margin:0;line-height:1.55}
  .brand{margin-top:32px;font-size:12px;color:rgba(255,255,255,.35);letter-spacing:.08em;text-transform:uppercase}
  .brand b{color:#fff}.brand span{color:#10b981}
</style></head>
<body><div class="wrap"><div class="card">
  <div class="icon">${icon}</div>
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(body)}</p>
  <div class="brand"><b>Solid<span>#</span></b> &nbsp;CLI</div>
</div></div></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c] as string));
}

// ---------------------------------------------------------------------------
// Company picker (handles 1 or 1200 companies)
// ---------------------------------------------------------------------------

const PICKER_INLINE_THRESHOLD = 20;

interface CompanyChoice {
  id: number;
  name: string;
  role: string;
}

function formatChoice(c: CompanyChoice, defaultId: number) {
  const label = `${c.name} (ID: ${c.id}) — ${c.role}`;
  return c.id === defaultId
    ? { name: chalk.green(`${label} [current]`), value: c.id }
    : { name: label, value: c.id };
}

async function pickCompany(companies: CompanyChoice[], defaultId: number): Promise<number> {
  // Small list — show as a normal list
  if (companies.length <= PICKER_INLINE_THRESHOLD) {
    const { companyId } = await inquirer.prompt([{
      type: 'list',
      name: 'companyId',
      message: 'Select company:',
      choices: companies.map((c) => formatChoice(c, defaultId)),
      default: defaultId,
      pageSize: PICKER_INLINE_THRESHOLD,
    }]);
    return companyId;
  }

  // Large list — filter first, then choose
  console.log(chalk.dim(`  ${companies.length} companies — type to filter (name or ID), or press Enter to skip and keep [current].`));
  const { filter } = await inquirer.prompt([{
    type: 'input',
    name: 'filter',
    message: 'Filter:',
  }]);

  const q = (filter as string || '').trim().toLowerCase();
  if (!q) return defaultId;

  const matches = companies.filter((c) =>
    c.name.toLowerCase().includes(q) || String(c.id).includes(q),
  );

  if (matches.length === 0) {
    console.log(chalk.yellow('  No matches — keeping current company.'));
    return defaultId;
  }
  if (matches.length === 1) {
    const m = matches[0];
    console.log(chalk.dim(`  → ${m.name} (ID: ${m.id})`));
    return m.id;
  }

  const visible = matches.slice(0, 30);
  const truncated = matches.length > visible.length;
  if (truncated) {
    console.log(chalk.dim(`  Showing first ${visible.length} of ${matches.length} matches — refine filter for more.`));
  }
  const { companyId } = await inquirer.prompt([{
    type: 'list',
    name: 'companyId',
    message: 'Select company:',
    choices: visible.map((c) => formatChoice(c, defaultId)),
    default: defaultId,
    pageSize: 15,
  }]);
  return companyId;
}

export const authCommand = new Command('auth')
  .description('Authentication management');

// Login command
authCommand
  .command('login')
  .description('Login to Solid# (opens browser by default)')
  .option('-e, --email <email>', 'Email address (forces password mode)')
  .option('-t, --token <token>', 'Login with API key (sk_solid_...)')
  .option('-p, --password', 'Use email/password prompt instead of browser')
  .option('-c, --company <id>', 'Skip multi-company picker — auth directly into this company ID', (v) => parseInt(v, 10))
  .option('--fresh', 'Force a new login — ignore any existing browser session')
  .action(async (options) => {
    try {
      // API key login (for scripts/CI)
      if (options.token) {
        config.accessToken = options.token;
        // Verify the key works
        const spinner = ora('Verifying API key...').start();
        try {
          const status = await apiClient.authStatus();
          if (status.data.authenticated && status.data.user) {
            config.userId = status.data.user.id;
            config.userEmail = status.data.user.email;
            config.companyId = status.data.user.company_id;
            spinner.succeed(chalk.green('Authenticated via API key'));
            console.log(chalk.dim(`  Company ID: ${status.data.user.company_id}`));
          } else {
            spinner.fail(chalk.red('Invalid API key'));
            config.accessToken = undefined;
            process.exit(1);
          }
        } catch {
          spinner.fail(chalk.red('Invalid API key'));
          config.accessToken = undefined;
          process.exit(1);
        }
        return;
      }

      // Browser login (default — no flags or only --email passed without --password)
      // If --email or --password is set, fall through to email/password prompt
      const usePassword = options.password || options.email;
      if (!usePassword) {
        let spinner: ReturnType<typeof ora> | null = null;
        try {
          const result = await browserLogin({ companyId: options.company, fresh: options.fresh }, (url) => {
            console.log('');
            console.log(chalk.dim('  Opening browser to authenticate...'));
            console.log(chalk.dim(`  If it does not open, visit: ${url}`));
            console.log('');
            spinner = ora('Waiting for browser authentication...').start();
          });
          // TS narrows `spinner` to never because the closure assignment is
          // invisible from the outer scope. Cast back to preserve typing.
          if (spinner) (spinner as ReturnType<typeof ora>).stop();
          config.accessToken = result.accessToken;
          if (result.refreshToken) config.refreshToken = result.refreshToken;
          if (result.expiresIn) {
            config.tokenExpiresAt = new Date(Date.now() + result.expiresIn * 1000);
          }

          const status = await apiClient.authStatus();
          if (!status.data.authenticated || !status.data.user) {
            console.error(chalk.red('Login failed — token did not validate'));
            config.accessToken = undefined;
            config.refreshToken = undefined;
            process.exit(1);
          }

          config.userId = status.data.user.id;
          config.userEmail = status.data.user.email;
          config.companyId = status.data.user.company_id;

          // Resolve the real company name + role so the arrival screen
          // shows something better than an email echo. Best-effort: we fall
          // back to a friendly placeholder if the lookup fails.
          let resolvedCompanyName = `Solid# workspace`;
          let resolvedRole: string | undefined;
          let companiesForPicker: Array<{ id: number; name: string; role: string }> | null = null;
          try {
            const companiesResponse = await apiClient.companiesList();
            companiesForPicker = companiesResponse.data.companies;
            const active = companiesForPicker?.find((c) => c.id === status.data.user!.company_id);
            if (active) {
              resolvedCompanyName = active.name;
              resolvedRole = active.role;
            }
          } catch {
            // Networkless / permissions — arrival screen still renders.
          }

          const renderArrival = (name: string, id: number, role?: string) => {
            console.log(ui.loginSuccessScreen({
              email: status.data.user!.email,
              companyName: name,
              companyId: id,
              role,
            }));
          };

          // If --company was passed, the token is already scoped — skip picker
          if (options.company) {
            renderArrival(resolvedCompanyName, status.data.user.company_id, resolvedRole);
            return;
          }

          // Multi-company picker path
          if (companiesForPicker && companiesForPicker.length > 1) {
            config.companies = companiesForPicker.map((c) => ({ id: c.id, name: c.name, role: c.role }));
            console.log('');
            console.log(chalk.bold(`  ${companiesForPicker.length} companies available:`));
            console.log('');
            const picked = await pickCompany(companiesForPicker, status.data.user.company_id);
            if (picked && picked !== status.data.user.company_id) {
              const switchSpinner = ora('Switching...').start();
              const switchResponse = await apiClient.companySwitch(picked);
              config.accessToken = switchResponse.data.access_token;
              config.refreshToken = switchResponse.data.refresh_token;
              config.companyId = switchResponse.data.company.id;
              config.tokenExpiresAt = new Date(Date.now() + switchResponse.data.expires_in * 1000);
              switchSpinner.succeed(chalk.green(`Switched to ${switchResponse.data.company.name}`));
              resolvedCompanyName = switchResponse.data.company.name;
              resolvedRole = companiesForPicker.find((c) => c.id === picked)?.role || resolvedRole;
            }
            renderArrival(resolvedCompanyName, config.companyId!, resolvedRole);
            console.log(chalk.dim('  Switch later: solid switch'));
            console.log(chalk.dim('  Skip picker:  solid auth login --company <id>'));
            console.log('');
            return;
          }

          renderArrival(resolvedCompanyName, config.companyId!, resolvedRole);
          return;
        } catch (err) {
          if (spinner) (spinner as ReturnType<typeof ora>).fail(chalk.red('Browser login failed'));
          else console.error(chalk.red('Browser login failed'));
          const msg = err instanceof Error ? err.message : String(err);
          console.error(chalk.red(`  ${msg}`));
          console.log('');
          console.log(chalk.dim('  Fallbacks:'));
          console.log(chalk.dim('    solid auth login --password       # email/password prompt'));
          console.log(chalk.dim('    solid auth login --token sk_...   # API key (CI/CD)'));
          process.exit(1);
        }
      }

      let email = options.email;

      // Always prompt for credentials securely
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'email',
          message: 'Email:',
          when: !email,
          validate: (input) => input.includes('@') || 'Please enter a valid email',
        },
        {
          type: 'password',
          name: 'password',
          message: 'Password:',
          mask: '*',
        },
      ]);
      email = email || answers.email;
      const password = answers.password;

      const spinner = ora('Logging in...').start();

      try {
        const response = await apiClient.login(email, password);

        // Store credentials
        config.accessToken = response.data.access_token;
        config.refreshToken = response.data.refresh_token;
        // Backend returns expires_in (seconds), not expires_at
        config.tokenExpiresAt = new Date(Date.now() + (response.data.expires_in || 3600) * 1000);
        config.userId = response.data.user.id;
        config.userEmail = response.data.user.email;
        config.companyId = response.data.user.company_id;

        spinner.succeed(chalk.green('Authenticated'));

        // Check for multi-company access
        try {
          const companiesResponse = await apiClient.companiesList();
          const { companies } = companiesResponse.data;

          if (companies.length > 1) {
            // Cache company list
            config.companies = companies.map((c: { id: number; name: string; role: string }) => ({
              id: c.id,
              name: c.name,
              role: c.role,
            }));

            console.log('');
            console.log(chalk.bold(`  ${companies.length} companies available:`));
            console.log('');

            const picked = await pickCompany(companies, response.data.user.company_id);

            if (picked && picked !== response.data.user.company_id) {
              const switchSpinner = ora('Switching...').start();
              const switchResponse = await apiClient.companySwitch(picked);
              config.accessToken = switchResponse.data.access_token;
              config.refreshToken = switchResponse.data.refresh_token;
              config.companyId = switchResponse.data.company.id;
              const expiresAt = new Date(Date.now() + switchResponse.data.expires_in * 1000);
              config.tokenExpiresAt = expiresAt;
              switchSpinner.succeed(chalk.green(`Switched to ${switchResponse.data.company.name}`));
            }

            console.log('');
            console.log(chalk.dim('  Switch later: solid switch'));
          } else {
            console.log('');
            console.log(ui.welcomeBox(
              response.data.user.email,
              config.companyId!,
            ));
          }
        } catch {
          // Company list failed — single-company user, show normal welcome
          console.log('');
          console.log(ui.welcomeBox(
            response.data.user.email,
            response.data.user.company_id,
          ));
        }

        console.log('');
      } catch (error) {
        spinner.fail(chalk.red('Login failed'));
        const apiError = handleApiError(error);
        console.error(chalk.red(`  ${apiError.message}`));
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// Force-refresh the cached access token without waiting for a 401.
authCommand
  .command('refresh')
  .description('Force-rotate the cached access token using the stored refresh token')
  .option('--json', 'Output as JSON')
  .action(async (options: { json?: boolean }) => {
    if (!config.refreshToken) {
      if (isJsonOutput(options)) {
        console.log(JSON.stringify({ refreshed: false, reason: 'no_refresh_token' }, null, 2));
      } else {
        console.error(chalk.red('No refresh token cached. Run `solid auth login` first.'));
      }
      process.exit(1);
    }
    const spinner = ora({ text: 'Refreshing token...', stream: process.stderr }).start();
    const ok = await apiClient.forceRefreshToken();
    if (!ok) {
      spinner.fail(chalk.red('Refresh failed — your refresh token may be expired.'));
      if (isJsonOutput(options)) {
        console.log(JSON.stringify({ refreshed: false, reason: 'refresh_rejected' }, null, 2));
      } else {
        console.error(chalk.dim('  Run `solid auth login` to re-authenticate.'));
      }
      process.exit(1);
    }
    spinner.succeed(chalk.green('Token refreshed'));
    if (isJsonOutput(options)) {
      console.log(JSON.stringify({
        refreshed: true,
        token_expires_at: config.tokenExpiresAt ? config.tokenExpiresAt.toISOString() : null,
      }, null, 2));
      return;
    }
    const ttl = formatTokenTTL();
    if (ttl) console.log(chalk.dim(`  ${ttl}`));
  });

// Logout command
authCommand
  .command('logout')
  .description('Logout from Solid# (clears cached credentials)')
  .option('-y, --yes', 'Skip confirmation prompt')
  .option('--all-devices', 'Revoke the refresh token server-side so every session signs out')
  .action(async (options: { yes?: boolean; allDevices?: boolean }) => {
    const { confirm } = await import('../lib/command-kit');
    if (!config.userEmail && !config.accessToken) {
      console.error(chalk.dim('  Already logged out.'));
      return;
    }
    const message = options.allDevices
      ? `Log ${config.userEmail || 'this user'} out of EVERY device? (revokes the refresh token server-side)`
      : `Log out ${config.userEmail || 'the cached session'} on ${config.apiUrl}?`;
    const ok = await confirm(message, { autoConfirm: Boolean(options.yes) });
    if (!ok) {
      console.error(chalk.dim('  Cancelled.'));
      process.exit(1);
    }

    if (options.allDevices) {
      const spinner = ora({ text: 'Revoking all sessions...', stream: process.stderr }).start();
      try {
        // Backend endpoint; falls through to local logout either way so we
        // never leave stale creds on the machine.
        await apiClient.post('/api/v1/auth/logout', { all_devices: true });
        spinner.succeed(chalk.green('All sessions revoked server-side'));
      } catch (error) {
        spinner.warn(chalk.yellow('Server-side revoke failed — clearing local session anyway'));
        const apiError = handleApiError(error);
        console.error(chalk.dim(`  ${apiError.message}`));
      }
    }

    config.logout();
    console.log(chalk.green('Logged out successfully'));
    console.log(chalk.dim('  Browser session still active. Use `solid auth login --fresh` to sign in as a different user.'));
  });

// Status command
// Formats the stored tokenExpiresAt into a humane "expires in 2h 14m" string.
// Returns null if no expiry is tracked.
function formatTokenTTL(): string | null {
  const exp = config.tokenExpiresAt;
  if (!exp) return null;
  const ms = exp.getTime() - Date.now();
  if (ms <= 0) return chalk.red('expired');
  const mins = Math.floor(ms / 60000);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (days > 0) return `expires in ${days}d ${hrs % 24}h`;
  if (hrs > 0) return `expires in ${hrs}h ${mins % 60}m`;
  return `expires in ${mins}m`;
}

/**
 * Best-effort lookup of the bound company name + role + tier for `whoami`.
 * Both calls are independent and may fail (offline / restricted token); a
 * failed lookup just yields `undefined` for that field — never throws.
 */
async function resolveWhoamiContext(
  companyId: number | null | undefined,
): Promise<{ companyName?: string; role?: string; tier?: string }> {
  if (!companyId) return {};
  const out: { companyName?: string; role?: string; tier?: string } = {};
  const [companies, features] = await Promise.allSettled([
    apiClient.companiesList(),
    apiClient.get<{ tier?: string }>(`/api/v1/companies/${companyId}/features`),
  ]);
  if (companies.status === 'fulfilled') {
    const active = companies.value.data.companies?.find((c) => c.id === companyId);
    if (active) {
      out.companyName = active.name;
      out.role = active.role;
    }
  }
  if (features.status === 'fulfilled' && features.value.data.tier) {
    out.tier = features.value.data.tier;
  }
  return out;
}

async function runAuthStatus(options: { json?: boolean; features?: boolean } = {}): Promise<void> {
  // Detect --json from any of: local option, root --json, SOLID_JSON env.
  // Detect --output from the root-level global. The prior impl only read
  // options.json and ignored the root + env + output flags — that silently
  // broke `solid whoami --json`, `solid auth status --output file`, and
  // `SOLID_JSON=1 solid whoami`.
  const { isJsonOutput } = await import('../lib/json-output');
  const { getOutputFile } = await import('../lib/command-kit');
  const asJson = isJsonOutput(options) || Boolean(getOutputFile());
  const outputFile = getOutputFile();

  // JSON path: machine-readable, no spinner chrome
  if (asJson) {
    const payload: Record<string, unknown> = {
      authenticated: config.isLoggedIn(),
      email: config.userEmail || null,
      company_id: config.companyId || null,
      environment: config.environment,
      api_url: config.apiUrl,
      token_expires_at: config.tokenExpiresAt ? config.tokenExpiresAt.toISOString() : null,
    };
    // If --token was passed, try the server even without a cached session
    // — the api-client interceptor uses the override automatically.
    const hasOverride = Boolean(process.argv.find((a) => a === '--token' || a.startsWith('--token=')));
    if (config.isLoggedIn() || hasOverride) {
      try {
        const response = await apiClient.authStatus();
        payload.authenticated = response.data.authenticated;
        if (response.data.user) {
          payload.email = response.data.user.email;
          payload.company_id = response.data.user.company_id;
          payload.user_id = response.data.user.id;
        }
      } catch {
        payload.authenticated = config.userEmail || config.companyId ? 'offline' : false;
      }
    }

    // Best-effort: which company (name) + role + tier the session is bound to.
    if (payload.authenticated === true && payload.company_id) {
      const ctx = await resolveWhoamiContext(payload.company_id as number);
      if (ctx.companyName) payload.company_name = ctx.companyName;
      if (ctx.role) payload.role = ctx.role;
      if (ctx.tier) payload.tier = ctx.tier;
    }

    // --features: include the tier's feature allowlist so agents can
    // check access before running a gated command. Skipped on offline
    // or unauthenticated sessions.
    if (options.features && config.companyId && payload.authenticated === true) {
      try {
        const fr = await apiClient.get<{ enabled_features: string[]; tier?: string; features_count?: number }>(
          `/api/v1/companies/${config.companyId}/features`,
        );
        payload.features = {
          tier: fr.data.tier,
          count: fr.data.features_count,
          enabled: fr.data.enabled_features,
        };
      } catch (err) {
        payload.features = { error: (err as Error).message };
      }
    }
    const serialized = JSON.stringify(payload, null, 2);
    if (outputFile) {
      const fs = await import('fs');
      const path = await import('path');
      fs.mkdirSync(path.dirname(path.resolve(outputFile)), { recursive: true });
      fs.writeFileSync(outputFile, serialized);
      console.error(chalk.green(`  Wrote ${serialized.length} bytes to ${outputFile}`));
    } else {
      console.log(serialized);
    }
    return;
  }

  const spinner = ora({ text: 'Checking authentication...', stream: process.stderr }).start();

  if (!config.isLoggedIn()) {
    spinner.fail(chalk.yellow('Not logged in'));
    console.log(chalk.dim('  Run `solid auth login` to authenticate'));
    return;
  }

  try {
    const response = await apiClient.authStatus();

    if (response.data.authenticated && response.data.user) {
      spinner.succeed(chalk.green('Authenticated'));
      const cid = response.data.user.company_id;
      // Best-effort: resolve the bound company name + role (which company)
      // and tier (permission level) so `whoami` answers "what am I bound to"
      // at a glance. Either lookup may fail (network/permissions) — we just
      // omit that line rather than erroring.
      const { companyName, role, tier } = await resolveWhoamiContext(cid);
      console.log(chalk.dim(`  Email:       ${response.data.user.email}`));
      if (companyName) {
        console.log(chalk.dim(`  Company:     ${companyName} (ID ${cid})`));
      } else {
        console.log(chalk.dim(`  Company ID:  ${cid}`));
      }
      if (role) console.log(chalk.dim(`  Role:        ${role}`));
      if (tier) console.log(chalk.dim(`  Tier:        ${tier}`));
      console.log(chalk.dim(`  Environment: ${config.environment}`));
      console.log(chalk.dim(`  API URL:     ${config.apiUrl}`));
      const ttl = formatTokenTTL();
      if (ttl) console.log(chalk.dim(`  Token:       ${ttl}`));
    } else {
      spinner.fail(chalk.yellow('Session expired'));
      console.log(chalk.dim('  Run `solid auth login` to re-authenticate'));
    }
  } catch (error) {
    // Network failed — fall back to local config
    if (config.userEmail || config.companyId) {
      spinner.succeed(chalk.green('Authenticated (offline)'));
      console.log(chalk.dim(`  Email:       ${config.userEmail || 'unknown'}`));
      console.log(chalk.dim(`  Company ID:  ${config.companyId || 'unknown'}`));
      console.log(chalk.dim(`  Environment: ${config.environment}`));
      console.log(chalk.dim(`  API URL:     ${config.apiUrl}`));
      const ttl = formatTokenTTL();
      if (ttl) console.log(chalk.dim(`  Token:       ${ttl}`));
      console.log(chalk.dim('  (Could not verify with server)'));
    } else {
      spinner.fail(chalk.red('Failed to check status'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  }
}

authCommand
  .command('status')
  .description('Check authentication status')
  .option('--json', 'JSON output')
  .option('--features', 'Include the tier feature allowlist (implies --json)')
  .action((opts: { json?: boolean; features?: boolean }) =>
    runAuthStatus({ json: opts.json || opts.features, features: opts.features }),
  );

// Top-level alias: `solid whoami` → `solid auth status`.
// Exported so the entrypoint can register it on the root program.
export const whoamiCommand = new Command('whoami')
  .description('Show who you are logged in as (alias for `solid auth status`)')
  .option('--json', 'JSON output')
  .option('--features', 'Include the tier feature allowlist (implies --json)')
  .action((opts: { json?: boolean; features?: boolean }) =>
    runAuthStatus({ json: opts.json || opts.features, features: opts.features }),
  );

// Token management (API keys for CI/CD, LLM agents, scripts)
const tokenCommand = authCommand
  .command('token')
  .description('Manage API keys for CI/CD and automation');

tokenCommand
  .command('create')
  .description('Create a new API key')
  .requiredOption('-n, --name <name>', 'Key name (e.g., "CI Pipeline")')
  .option('-s, --scopes <scopes>', 'Comma-separated scopes', 'kb:read,pages:read')
  .option('-e, --expires <days>', 'Expiration in days (default: no expiry)')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const scopes = options.scopes.split(',').map((s: string) => s.trim());
    const expiresInDays = options.expires ? parseInt(options.expires, 10) : undefined;

    const spinner = ora('Creating API key...').start();

    try {
      const response = await apiClient.apiKeyCreate(options.name, scopes, expiresInDays);
      spinner.succeed(chalk.green('API key created'));

      console.log('');
      console.log(chalk.bold('  Your API Key:'));
      console.log('');
      console.log(`  ${chalk.green(response.data.key)}`);
      console.log('');
      console.log(chalk.yellow('  ⚠ Store this key securely. It will not be shown again.'));
      console.log('');
      console.log(chalk.dim('  Usage:'));
      console.log(chalk.dim(`    SOLID_API_KEY=${response.data.key} solid status`));
      console.log(chalk.dim(`    solid auth login --token ${response.data.key}`));
      console.log('');
      console.log(chalk.dim(`  Scopes: ${scopes.join(', ')}`));
      if (expiresInDays) {
        console.log(chalk.dim(`  Expires: ${expiresInDays} days`));
      }
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red('Failed to create API key'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

tokenCommand
  .command('list').alias('ls')
  .description('List API keys')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const spinner = ora('Loading API keys...').start();

    try {
      const response = await apiClient.apiKeyList();
      spinner.stop();

      if (isJsonOutput(options)) {
        console.log(JSON.stringify(response.data, null, 2));
        return;
      }

      const { api_keys } = response.data;

      if (api_keys.length === 0) {
        console.log(chalk.dim('  No API keys found. Create one with: solid auth token create -n "My Key"'));
        return;
      }

      console.log('');
      console.log(chalk.bold(`  API Keys (${api_keys.length})`));
      console.log('');

      const headers = ['ID', 'Name', 'Prefix', 'Scopes', 'Active', 'Last Used'];
      const rows = api_keys.map((k: { id: number; name: string; key_prefix: string; scopes: string[]; is_active: boolean; last_used_at?: string }) => [
        String(k.id),
        k.name,
        chalk.dim(k.key_prefix),
        k.scopes.join(', '),
        k.is_active ? chalk.green('●') : chalk.red('○'),
        k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : chalk.dim('never'),
      ]);

      console.log(ui.table(headers, rows));
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red('Failed to list API keys'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

tokenCommand
  .command('revoke <id>')
  .description('Revoke an API key')
  .action(async (id: string) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const keyId = parseInt(id, 10);
    if (isNaN(keyId)) {
      console.error(chalk.red('Invalid key ID.'));
      process.exit(1);
    }

    const spinner = ora('Revoking API key...').start();

    try {
      await apiClient.apiKeyRevoke(keyId);
      spinner.succeed(chalk.green(`API key ${keyId} revoked`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to revoke API key'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Config command
authCommand
  .command('config')
  .description('View or update configuration')
  .option('--api-url <url>', 'Set API URL')
  .option('--environment <env>', 'Set environment (production, sandbox, development)')
  .option('--show', 'Show current configuration')
  .action((options) => {
    if (options.apiUrl) {
      config.apiUrl = options.apiUrl;
      console.log(chalk.green(`API URL set to: ${options.apiUrl}`));
    }

    if (options.environment) {
      if (!['production', 'sandbox', 'development'].includes(options.environment)) {
        console.error(chalk.red('Invalid environment. Use: production, sandbox, or development'));
        process.exit(1);
      }
      config.environment = options.environment as 'production' | 'sandbox' | 'development';
      console.log(chalk.green(`Environment set to: ${options.environment}`));
    }

    if (options.show || (!options.apiUrl && !options.environment)) {
      console.log(chalk.bold('\nCurrent Configuration:'));
      console.log(chalk.dim('  API URL:    '), config.apiUrl);
      console.log(chalk.dim('  Environment:'), config.environment);
      console.log(chalk.dim('  Company ID: '), config.companyId || 'Not set');
      console.log(chalk.dim('  User:       '), config.userEmail || 'Not logged in');
      const ttl = formatTokenTTL();
      if (ttl) console.log(chalk.dim('  Token:      '), ttl);
      if (config.accessToken) {
        // Plaintext-token warning (audit #28). Scripts + agents often log
        // this output — they need to know the file is readable to any
        // process running as this UID.
        console.log('');
        console.log(chalk.yellow(
          '  ⚠ Credentials are stored in plaintext at ~/.solid/config.json (chmod 600).\n' +
          '    On shared machines, prefer SOLID_API_KEY / SOLID_TOKEN env vars\n' +
          '    or a short-lived automation key.',
        ));
      }
    }
  });

authCommand.addHelpText('after', `
Examples:
  $ solid auth login                       # Browser-based login (preferred)
  $ solid auth login --token sk_...        # Login with an existing token
  $ solid whoami                           # Who am I / which company am I in?
  $ solid whoami --features                # Dump the feature allowlist for this tier
  $ solid auth config --show                # Print the on-disk config path + token status
  $ solid auth refresh                      # Rotate the token if near expiry
  $ solid auth logout --all-devices        # Revoke tokens everywhere

Tip: --token applies per-invocation (never persisted). Use it in CI instead
of baking a token into ~/.solid/config.
`);
