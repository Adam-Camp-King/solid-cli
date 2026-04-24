/**
 * solid doctor env — automated § 650.5 environment check.
 *
 * The reverse-lookup in Owners-Manual/03-AI-Systems/CLAUDE-CONTEXT-
 * CANONICAL-TRUTH.md § 650.5 walks an operator through seven manual
 * steps when "my tenant's context looks wrong." This module turns the
 * first five of them into a single command that runs all checks and
 * prints a status table. The sixth (force refresh) and seventh (re-run
 * install) are remediations — the checks tell you which one to run.
 *
 * Checks implemented:
 *
 *   1. auth         — logged in? which source (JWT / env var / ...)?
 *   2. token        — cached JWT present with expiry? expired yet?
 *   3. manifest     — .solid/manifest.json present? matches active
 *                     company_id?
 *   4. hook         — SessionStart hook registered in
 *                     ~/.claude/settings.json with the current command?
 *   5. context      — .claude/CLAUDE.md present in CWD? freshly
 *                     regenerated (mtime within freshness window)?
 *   6. backend      — GET /api/v1/auth/me succeeds within 2s?
 *
 * Pure(-ish) and testable: the main entry point takes a ``DoctorEnv``
 * dependency bundle so tests can pass fakes for cwd / home / config /
 * apiClient. The CLI wrapper fills in the real dependencies.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'skip';

export interface CheckResult {
  name: string;
  label: string;
  status: CheckStatus;
  detail: string;
  hint?: string;
}

export interface DoctorEnvDeps {
  cwd: string;
  home: string;
  claudeSettingsPath: string;
  hookCommand: string;
  config: {
    isLoggedIn(): boolean;
    readonly companyId: number | undefined;
    readonly accessToken: string | undefined;
    readonly tokenExpiresAt: Date | undefined;
  };
  apiGet: (p: string) => Promise<{ status: number }>;
  freshnessWindowMs?: number;
  now?: () => Date;
}

const DEFAULT_FRESHNESS_MS = 24 * 60 * 60 * 1000;

function readJsonIfPresent(p: string): unknown {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return { __parseError: true };
  }
}

// -- individual checks -----------------------------------------------------

export function checkAuth(deps: DoctorEnvDeps): CheckResult {
  const source =
    process.env.SOLID_API_KEY ? 'SOLID_API_KEY env' :
    process.env.SOLID_TOKEN ? 'SOLID_TOKEN env' :
    deps.config.accessToken ? 'cached access_token' :
    null;

  if (!deps.config.isLoggedIn() || !source) {
    return {
      name: 'auth',
      label: 'authenticated',
      status: 'fail',
      detail: 'no credentials found (JWT or SOLID_API_KEY/SOLID_TOKEN env)',
      hint: 'run: solid auth login',
    };
  }
  const cid = deps.config.companyId;
  return {
    name: 'auth',
    label: 'authenticated',
    status: 'pass',
    detail: `${source}${cid ? `, company_id=${cid}` : ''}`,
  };
}

export function checkToken(deps: DoctorEnvDeps): CheckResult {
  if (process.env.SOLID_API_KEY || process.env.SOLID_TOKEN) {
    return {
      name: 'token',
      label: 'token freshness',
      status: 'skip',
      detail: 'env-var auth — no local expiry to check',
    };
  }
  const expiry = deps.config.tokenExpiresAt;
  if (!deps.config.accessToken) {
    return {
      name: 'token',
      label: 'token freshness',
      status: 'skip',
      detail: 'no cached access_token',
    };
  }
  if (!expiry) {
    return {
      name: 'token',
      label: 'token freshness',
      status: 'warn',
      detail: 'cached token has no expiry record',
      hint: 're-login to refresh: solid auth login',
    };
  }
  const now = (deps.now ? deps.now() : new Date()).getTime();
  const ms = expiry.getTime() - now;
  if (ms <= 0) {
    return {
      name: 'token',
      label: 'token freshness',
      status: 'fail',
      detail: `expired ${Math.round(-ms / 60_000)}m ago`,
      hint: 'run: solid auth login',
    };
  }
  const mins = Math.round(ms / 60_000);
  if (mins < 30) {
    return {
      name: 'token',
      label: 'token freshness',
      status: 'warn',
      detail: `expires in ${mins}m`,
      hint: 'consider re-logging soon',
    };
  }
  return {
    name: 'token',
    label: 'token freshness',
    status: 'pass',
    detail: `expires in ${mins}m`,
  };
}

export function checkManifest(deps: DoctorEnvDeps): CheckResult {
  const home = path.resolve(deps.home);
  const cwd = path.resolve(deps.cwd);
  if (cwd === home || cwd === path.join(home, '.claude')) {
    return {
      name: 'manifest',
      label: 'tenant manifest',
      status: 'fail',
      detail: 'current directory is a protected root ($HOME / $HOME/.claude)',
      hint: 'cd into a tenant project directory',
    };
  }
  const manifestPath = path.join(cwd, '.solid', 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return {
      name: 'manifest',
      label: 'tenant manifest',
      status: 'warn',
      detail: 'no .solid/manifest.json in CWD',
      hint: 'run `solid pull` to bind this directory to a tenant',
    };
  }
  const raw = readJsonIfPresent(manifestPath) as
    | { company_id?: number; company_name?: string; __parseError?: boolean }
    | null;
  if (!raw || raw.__parseError) {
    return {
      name: 'manifest',
      label: 'tenant manifest',
      status: 'fail',
      detail: 'manifest present but not valid JSON',
      hint: `inspect ${manifestPath}`,
    };
  }
  const manifestId = raw.company_id;
  const activeId = deps.config.companyId;
  if (typeof manifestId !== 'number') {
    return {
      name: 'manifest',
      label: 'tenant manifest',
      status: 'fail',
      detail: 'manifest missing company_id field',
      hint: 'regenerate: rm -rf .solid/ && solid pull',
    };
  }
  if (activeId !== undefined && activeId !== manifestId) {
    return {
      name: 'manifest',
      label: 'tenant manifest',
      status: 'fail',
      detail: `manifest binds company_id=${manifestId} (${raw.company_name ?? '?'}) but active login is company_id=${activeId}`,
      hint: `solid switch ${manifestId}`,
    };
  }
  return {
    name: 'manifest',
    label: 'tenant manifest',
    status: 'pass',
    detail: `bound to company_id=${manifestId}${raw.company_name ? ` (${raw.company_name})` : ''}`,
  };
}

export function checkHook(deps: DoctorEnvDeps): CheckResult {
  const settingsPath = deps.claudeSettingsPath;
  if (!fs.existsSync(settingsPath)) {
    return {
      name: 'hook',
      label: 'SessionStart hook',
      status: 'fail',
      detail: `${settingsPath} does not exist`,
      hint: 'run: solid install',
    };
  }
  const settings = readJsonIfPresent(settingsPath) as
    | { hooks?: { SessionStart?: Array<{ hooks?: Array<{ command?: string }> }> } }
    | { __parseError?: boolean }
    | null;
  if (!settings || (settings as { __parseError?: boolean }).__parseError) {
    return {
      name: 'hook',
      label: 'SessionStart hook',
      status: 'fail',
      detail: `${settingsPath} is not valid JSON`,
      hint: 'fix the file manually then re-run: solid install',
    };
  }
  const groups = (settings as {
    hooks?: { SessionStart?: Array<{ hooks?: Array<{ command?: string }> }> };
  }).hooks?.SessionStart;
  const commands = (groups ?? [])
    .flatMap((g) => g.hooks ?? [])
    .map((h) => h.command ?? '');
  if (commands.includes(deps.hookCommand)) {
    return {
      name: 'hook',
      label: 'SessionStart hook',
      status: 'pass',
      detail: `installed (${deps.hookCommand})`,
    };
  }
  const looksLegacy = commands.some((c) => c.startsWith('solid context'));
  if (looksLegacy) {
    return {
      name: 'hook',
      label: 'SessionStart hook',
      status: 'warn',
      detail: 'a solid context hook is present but command has drifted',
      hint: 'run: solid install (idempotent — rewrites to current command)',
    };
  }
  return {
    name: 'hook',
    label: 'SessionStart hook',
    status: 'fail',
    detail: 'no solid context SessionStart hook found',
    hint: 'run: solid install',
  };
}

export function checkContextFreshness(deps: DoctorEnvDeps): CheckResult {
  const claudeMd = path.join(deps.cwd, '.claude', 'CLAUDE.md');
  if (!fs.existsSync(claudeMd)) {
    return {
      name: 'context',
      label: 'context freshness',
      status: 'warn',
      detail: '.claude/CLAUDE.md not present in CWD',
      hint: 'run: solid context --claude',
    };
  }
  const stat = fs.statSync(claudeMd);
  const window = deps.freshnessWindowMs ?? DEFAULT_FRESHNESS_MS;
  const age = (deps.now ? deps.now() : new Date()).getTime() - stat.mtimeMs;
  if (age > window) {
    const hours = Math.round(age / 3_600_000);
    return {
      name: 'context',
      label: 'context freshness',
      status: 'warn',
      detail: `.claude/CLAUDE.md is ${hours}h old`,
      hint: 'run: solid context --claude',
    };
  }
  const mins = Math.max(1, Math.round(age / 60_000));
  return {
    name: 'context',
    label: 'context freshness',
    status: 'pass',
    detail: `regenerated ${mins}m ago`,
  };
}

export async function checkBackend(deps: DoctorEnvDeps): Promise<CheckResult> {
  if (!deps.config.isLoggedIn()) {
    return {
      name: 'backend',
      label: 'backend reachable',
      status: 'skip',
      detail: 'not authenticated — auth check failed first',
    };
  }
  const t0 = Date.now();
  try {
    const res = await deps.apiGet('/api/v1/auth/me');
    const ms = Date.now() - t0;
    if (res.status >= 500) {
      return {
        name: 'backend',
        label: 'backend reachable',
        status: 'fail',
        detail: `status ${res.status} in ${ms}ms`,
        hint: 'check https://api.solidnumber.com/api/v1/health',
      };
    }
    if (ms > 2000) {
      return {
        name: 'backend',
        label: 'backend reachable',
        status: 'warn',
        detail: `slow response: status ${res.status} in ${ms}ms`,
      };
    }
    return {
      name: 'backend',
      label: 'backend reachable',
      status: 'pass',
      detail: `status ${res.status} in ${ms}ms`,
    };
  } catch (err) {
    const ms = Date.now() - t0;
    const message = err instanceof Error ? err.message : String(err);
    return {
      name: 'backend',
      label: 'backend reachable',
      status: 'fail',
      detail: `request failed after ${ms}ms: ${message}`,
      hint: 'check network / VPN / api.solidnumber.com DNS',
    };
  }
}

// -- runner ---------------------------------------------------------------

export interface DoctorEnvReport {
  ok: boolean;
  results: CheckResult[];
  summary: { pass: number; warn: number; fail: number; skip: number };
}

export async function runDoctorEnv(
  deps: DoctorEnvDeps,
): Promise<DoctorEnvReport> {
  const results: CheckResult[] = [
    checkAuth(deps),
    checkToken(deps),
    checkManifest(deps),
    checkHook(deps),
    checkContextFreshness(deps),
  ];
  results.push(await checkBackend(deps));

  const summary = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const r of results) summary[r.status]++;
  return { ok: summary.fail === 0, results, summary };
}

export function defaultDoctorEnvDeps(
  config: DoctorEnvDeps['config'],
  apiGet: DoctorEnvDeps['apiGet'],
): DoctorEnvDeps {
  return {
    cwd: process.cwd(),
    home: os.homedir(),
    claudeSettingsPath:
      process.env.SOLID_CLAUDE_SETTINGS_PATH ||
      path.join(os.homedir(), '.claude', 'settings.json'),
    hookCommand: 'solid context --claude --raw',
    config,
    apiGet,
  };
}
