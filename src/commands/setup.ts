/**
 * `solid setup` — one verb that wires everything a new user needs.
 *
 * Phase 2 of SPRINT-CLI-ONE-COMMAND-ONBOARDING.md. Today the install.sh
 * bootstrap chains six verbs in shell. Now it chains them in TypeScript:
 * one place, one cohesive UX, testable, idempotent.
 *
 * Steps (in order, each idempotent — skipped if already done):
 *   1. Auth          — `solid auth login` if no valid token
 *   2. Editor MCP    — detect claude / cursor / windsurf, wire MCP into each
 *   3. Claude hook   — SessionStart hook if `claude` is on PATH
 *   4. Completion    — install for the active shell (bash/zsh/fish/PS)
 *   5. (Optional)    — `solid render --install` for headless Chromium
 *   6. First action  — "what would you like to do first?" picker
 *
 * Modes:
 *   solid setup              # full interactive wizard
 *   solid setup --yes        # accept every default (CI / scripted installs)
 *   solid setup --skip-auth  # everything except step 1
 *   solid setup --skip-completion
 *   solid setup --skip-mcp
 *   solid setup --skip-render
 *   solid setup --skip-first-action
 *   solid setup --json       # machine-readable progress envelope
 *
 * Re-running `solid setup` after a successful run finishes in <1s and
 * reports "all steps already complete." That's the test for "idempotent."
 */

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { config } from '../lib/config';
import { ui } from '../lib/ui';
import { isJsonOutput } from '../lib/json-output';
import { getResolvedApiUrl, apiClient } from '../lib/api-client';
import {
  preflightEditor,
  ensureVsCodeClaudeExtension,
  resolveVsCodeBinary,
  type PreflightResult,
} from '../lib/editor-preflight';

// 'warn' = environment problem that isn't the wizard's fault (e.g. an editor
// is installed but its binary can't run on this macOS). Loud in the summary,
// but doesn't flip the exit code — the CLI itself is fully set up.
type StepStatus = 'done' | 'skipped' | 'failed' | 'warn' | 'pending';

interface StepResult {
  step: string;
  status: StepStatus;
  detail?: string;
}

interface SetupOptions {
  yes?: boolean;
  skipAuth?: boolean;
  skipMcp?: boolean;
  skipCompletion?: boolean;
  skipRender?: boolean;
  skipFirstAction?: boolean;
  json?: boolean;
  installToken?: string;
}

const INSTALL_TOKEN_PREFIX = 'ist_';

// Override for tests only — production stays at 30s. A configurable
// timeout lets the unit test assert the timeout path without waiting
// 30 real seconds; clamped to a sane range so a misconfigured shell
// can't disable the safety entirely.
function getInstallTokenTimeoutMs(): number {
  const raw = process.env.SOLID_INSTALL_TOKEN_TIMEOUT_MS;
  if (!raw) return 30_000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 50 || n > 120_000) return 30_000;
  return n;
}

const EDITORS: Array<{ binary: string; clientFlag: string; pretty: string }> = [
  { binary: 'claude', clientFlag: 'claude', pretty: 'Claude Code' },
  { binary: 'cursor', clientFlag: 'cursor', pretty: 'Cursor' },
  { binary: 'windsurf', clientFlag: 'windsurf', pretty: 'Windsurf' },
  // The Claude Code VS Code extension runs inside VS Code's own runtime,
  // so it works on older macOS where the native `claude` binary can't
  // launch (needs 13+). Detecting `code` gives those machines a working
  // path instead of a dead end.
  { binary: 'code', clientFlag: 'vscode', pretty: 'VS Code (Claude Code extension)' },
];

// Resolve an editor to a launchable binary. VS Code needs special handling:
// a fresh install does NOT put `code` on PATH (the user has to run "Shell
// Command: Install 'code' command in PATH" inside VS Code, which a normal
// user never does), so it falls back to the app-bundle locations.
function resolveEditorBinary(binary: string): string | null {
  if (binary === 'code') return resolveVsCodeBinary();
  return isInstalled(binary) ? binary : null;
}

function isInstalled(binary: string): boolean {
  // Use `command -v` on POSIX and `where` on Windows; both exit 0 when found.
  // Don't rely on `which` — it's not always available on Windows + minimal containers.
  const isWin = process.platform === 'win32';
  const probe = isWin ? `where ${binary}` : `command -v ${binary}`;
  try {
    const out = execSync(probe, { stdio: ['ignore', 'pipe', 'ignore'], shell: isWin ? undefined : '/bin/sh' });
    return out.toString().trim().length > 0;
  } catch {
    return false;
  }
}

function runVerb(args: string[], opts?: { interactive?: boolean }): { ok: boolean; detail: string } {
  // Spawn a child `solid <verb>` so step actions reuse the same auth /
  // config / interceptor stack as a real invocation. We invoke node on
  // our own bin entry so the child sees the same dist/ — works in dev
  // (jest spawns ts-node? no, we run against built dist) and in prod.
  //
  // The bin path is derived from process.argv[1] (the file the user
  // ran). Tests can override via SOLID_SELF_BIN env var.
  const selfBin = process.env.SOLID_SELF_BIN || process.argv[1];
  // SOLID_NO_TENANT_WARN: the IMPLICIT_TENANT advisory is for interactive
  // use; inside the wizard it would get captured as the step's "detail" and
  // dump a raw JSON blob into the summary box (seen 2026-06-04).
  //
  // interactive: steps that hand the terminal to the child (auth login's
  // browser-URL fallback, the first-action verbs — `solid ai` launches a
  // full-screen editor). Piping those swallows their UI: a fresh user
  // staring at a silent terminal while a login waits on a URL they never
  // saw. Inherited stdio means no captured detail — that's the trade.
  const result = spawnSync(process.execPath, [selfBin, ...args], {
    stdio: opts?.interactive ? 'inherit' : 'pipe',
    encoding: 'utf-8',
    env: { ...process.env, SOLID_SKIP_VERSION_CHECK: '1', SOLID_NO_TENANT_WARN: '1' },
  });
  const ok = result.status === 0;
  const detail = opts?.interactive
    ? (ok ? '' : `exited with code ${result.status}`)
    : (result.stderr || result.stdout || '').toString().trim().slice(0, 500);
  return { ok, detail };
}

async function confirm(message: string, defaultYes: boolean, autoYes: boolean): Promise<boolean> {
  if (autoYes) return defaultYes;
  if (!process.stdin.isTTY) return defaultYes;
  const { ok } = await inquirer.prompt<{ ok: boolean }>([
    { type: 'confirm', name: 'ok', message, default: defaultYes },
  ]);
  return ok;
}

// ─────────────────────────────────────────────────────────────────────────────
// Steps
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Phase 3 magic-link auth: redeem an `ist_*` install token from the
 * dashboard for a real CLI access+refresh token, stamp the config,
 * and skip the browser auth step entirely.
 *
 * Returns null if no --install-token was supplied (regular flow).
 * Returns 'failed' if a token was supplied but the exchange failed —
 * we DON'T silently fall through to browser auth in that case, because
 * the user explicitly asked for token-based auth and a fall-through
 * could mask a real expiry/replay/network problem.
 */
async function stepInstallToken(opts: SetupOptions): Promise<StepResult | null> {
  // Prefer SOLID_INSTALL_TOKEN env var over --install-token argv. argv
  // is visible in `ps -ef` for the lifetime of the process — on a
  // multi-user box, anyone can read the token. The env var stays in
  // the process's own env block. install.sh sets the env var; users
  // can also `export SOLID_INSTALL_TOKEN=ist_…` before running setup.
  const envToken = process.env.SOLID_INSTALL_TOKEN;
  const argvToken = opts.installToken;

  if (!envToken && !argvToken) return null;

  if (argvToken && !envToken) {
    // Loud-but-non-fatal warning: argv tokens still work, but the
    // user (or installer) should switch to the env var.
    process.stderr.write(
      '⚠  --install-token on argv is visible in process listings (ps -ef). ' +
      'Prefer SOLID_INSTALL_TOKEN=ist_… as an env var.\n',
    );
  }

  const token = (envToken || argvToken || '').trim();
  if (!token.startsWith(INSTALL_TOKEN_PREFIX)) {
    // Don't echo any bytes of the user-supplied value — even partial
    // characters of a bearer credential leak entropy into stderr/CI
    // logs. The prefix is a public constant; the rest is secret.
    return {
      step: 'install_token',
      status: 'failed',
      detail: `--install-token must start with "${INSTALL_TOKEN_PREFIX}" (got something else)`,
    };
  }

  const apiUrl = getResolvedApiUrl().replace(/\/+$/, '');
  const exchangeUrl = `${apiUrl}/api/v1/auth/install-token/exchange`;

  // 30-second hard ceiling on the exchange call. A one-paste install
  // can't afford to hang forever if the backend is unreachable —
  // users would see no progress and assume their terminal is dead.
  // AbortSignal.timeout() is Node 18+ / browser standard.
  let res: Response;
  try {
    res = await fetch(exchangeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, label: 'CLI (install-token)' }),
      signal: AbortSignal.timeout(getInstallTokenTimeoutMs()),
    });
  } catch (e) {
    const err = e as Error;
    const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError';
    return {
      step: 'install_token',
      status: 'failed',
      detail: isTimeout
        ? `timed out after ${Math.round(getInstallTokenTimeoutMs() / 1000)}s contacting ${exchangeUrl} — backend unreachable or slow`
        : `network error contacting ${exchangeUrl}: ${err.message}`,
    };
  }

  if (!res.ok) {
    // 401 = invalid/expired/replayed. 429 = rate-limited. Anything else
    // is unexpected — surface the body verbatim for debugging.
    let body = '';
    try { body = (await res.text()).slice(0, 200); } catch { /* ignore */ }
    const reason = res.status === 401
      ? 'token invalid, expired, or already used — generate a fresh one from the dashboard'
      : `HTTP ${res.status} ${body}`;
    return { step: 'install_token', status: 'failed', detail: reason };
  }

  let data: any;
  try {
    data = await res.json();
  } catch (e) {
    return { step: 'install_token', status: 'failed', detail: `bad JSON in exchange response` };
  }

  if (!data.access_token || !data.refresh_token) {
    return { step: 'install_token', status: 'failed', detail: 'exchange response missing tokens' };
  }

  // Stamp the config — same shape `solid auth login` writes.
  config.accessToken = data.access_token;
  config.refreshToken = data.refresh_token;
  if (data.user) {
    if (data.user.id) config.userId = data.user.id;
    if (data.user.email) config.userEmail = data.user.email;
    if (data.user.company_id) config.companyId = data.user.company_id;
  }
  if (data.expires_in) {
    config.tokenExpiresAt = new Date(Date.now() + Number(data.expires_in) * 1000);
  }

  const company = data.company?.name ? ` for ${data.company.name}` : '';
  return {
    step: 'install_token',
    status: 'done',
    detail: `authenticated via install token${company}`,
  };
}

async function stepAuth(opts: SetupOptions): Promise<StepResult> {
  if (opts.skipAuth) return { step: 'auth', status: 'skipped', detail: '--skip-auth' };
  if (config.isLoggedIn()) {
    return { step: 'auth', status: 'done', detail: 'already logged in' };
  }
  if (!process.stdin.isTTY && !opts.yes) {
    return { step: 'auth', status: 'skipped', detail: 'no TTY (run `solid auth login` manually or pass SOLID_API_KEY)' };
  }
  // Spawn `solid auth login` so it shows its own UI in this terminal.
  const r = runVerb(['auth', 'login'], { interactive: true });
  return r.ok
    ? { step: 'auth', status: 'done', detail: 'logged in' }
    : { step: 'auth', status: 'failed', detail: r.detail };
}

const MCP_KEY_NAME = 'mcp-server (auto-provisioned by solid setup)';
const MCP_KEY_FILE = path.join(os.homedir(), '.solid', 'mcp-key');

function readMcpKey(): string | null {
  try {
    if (!fs.existsSync(MCP_KEY_FILE)) return null;
    const key = fs.readFileSync(MCP_KEY_FILE, 'utf-8').trim();
    return key.startsWith('sk_') ? key : null;
  } catch { return null; }
}

function writeMcpKey(key: string): void {
  try {
    const dir = path.dirname(MCP_KEY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(MCP_KEY_FILE, key, { mode: 0o600 });
  } catch { /* best-effort */ }
}

async function getOrCreateMcpApiKey(): Promise<string | null> {
  const cached = readMcpKey();
  if (cached) return cached;

  try {
    const listRes = await apiClient.apiKeyList();
    const allScopes = listRes.data.available_scopes || [];
    if (allScopes.length === 0) return null;

    const createRes = await apiClient.apiKeyCreate(MCP_KEY_NAME, allScopes);
    const key = createRes.data.key;
    if (key) writeMcpKey(key);
    return key || null;
  } catch {
    return null;
  }
}

// One preflight per binary per wizard run — both the MCP step and the
// Claude-hook step ask about `claude`, no reason to spawn it twice.
const preflightCache = new Map<string, PreflightResult>();
function preflightCached(binary: string): PreflightResult {
  const hit = preflightCache.get(binary);
  if (hit) return hit;
  const r = preflightEditor(binary);
  preflightCache.set(binary, r);
  return r;
}

async function stepEditorsMcp(opts: SetupOptions): Promise<StepResult[]> {
  if (opts.skipMcp) return [{ step: 'mcp', status: 'skipped', detail: '--skip-mcp' }];
  const found = EDITORS
    .map((e) => ({ ...e, resolvedBin: resolveEditorBinary(e.binary) }))
    .filter((e): e is typeof e & { resolvedBin: string } => !!e.resolvedBin);
  if (found.length === 0) {
    return [{ step: 'mcp', status: 'skipped', detail: 'no supported editor found (claude/cursor/windsurf/VS Code)' }];
  }

  // "Installed" ≠ "can run". A binary built for a newer macOS aborts at
  // launch (dyld) — wiring MCP into it would report ✓ for an editor the
  // user can never open. Surface the real problem as a loud ⚠ instead.
  const results: StepResult[] = [];
  const present: typeof found = [];
  for (const editor of found) {
    const pf = preflightCached(editor.resolvedBin);
    if (pf.ok) {
      present.push(editor);
    } else {
      results.push({
        step: `mcp.${editor.clientFlag}`,
        status: 'warn',
        detail: `${pf.reason} ${pf.hint || ''}`.trim(),
      });
    }
  }
  if (present.length === 0) return results;

  const mcpKey = config.isLoggedIn() ? await getOrCreateMcpApiKey() : null;

  for (const editor of present) {
    const ok = await confirm(`Wire Solid# MCP into ${editor.pretty}?`, true, !!opts.yes);
    if (!ok) {
      results.push({ step: `mcp.${editor.clientFlag}`, status: 'skipped', detail: 'user declined' });
      continue;
    }
    const args = ['mcp', 'install', editor.clientFlag];
    if (mcpKey) args.push('--api-key', mcpKey);
    const r = runVerb(args);
    let detail = r.ok ? `wired into ${editor.pretty}` : r.detail;
    // VS Code path: also make sure the Claude Code extension is installed,
    // so Claude is just there when the user opens VS Code — they never
    // have to learn what an extension is.
    if (r.ok && editor.clientFlag === 'vscode') {
      const ext = ensureVsCodeClaudeExtension(undefined, editor.resolvedBin);
      if (ext.justInstalled) detail += ' + installed Claude Code extension';
      else if (!ext.installed) detail += ` (install the Claude Code extension in VS Code manually${ext.detail ? ` — ${ext.detail}` : ''})`;
    }
    results.push({
      step: `mcp.${editor.clientFlag}`,
      status: r.ok ? 'done' : 'failed',
      detail,
    });
  }
  return results;
}

async function stepClaudeHook(opts: SetupOptions): Promise<StepResult> {
  if (opts.skipMcp) return { step: 'claude_hook', status: 'skipped', detail: '--skip-mcp' };
  if (!isInstalled('claude')) {
    return { step: 'claude_hook', status: 'skipped', detail: 'Claude Code not on PATH' };
  }
  const pf = preflightCached('claude');
  if (!pf.ok) {
    // Wiring a SessionStart hook for an editor that can't launch would just
    // bury the real problem under a green checkmark.
    return { step: 'claude_hook', status: 'warn', detail: `${pf.reason} ${pf.hint || ''}`.trim() };
  }
  const r = runVerb(['install']);
  return r.ok
    ? { step: 'claude_hook', status: 'done', detail: 'SessionStart hook wired' }
    : { step: 'claude_hook', status: 'failed', detail: r.detail };
}

async function stepCompletion(opts: SetupOptions): Promise<StepResult> {
  if (opts.skipCompletion) return { step: 'completion', status: 'skipped', detail: '--skip-completion' };
  const ok = await confirm('Install shell tab-completion?', true, !!opts.yes);
  if (!ok) return { step: 'completion', status: 'skipped', detail: 'user declined' };
  const r = runVerb(['completion', 'install']);
  return r.ok
    ? { step: 'completion', status: 'done', detail: 'completion installed' }
    : { step: 'completion', status: 'failed', detail: r.detail };
}

async function stepRenderChromium(opts: SetupOptions): Promise<StepResult> {
  if (opts.skipRender) return { step: 'render_chromium', status: 'skipped', detail: '--skip-render' };
  // Default NO for the optional ~150MB download — opt-in only.
  const ok = await confirm(
    'Install headless Chromium for `solid render --png` (~150MB)?',
    false,
    !!opts.yes,
  );
  if (!ok) return { step: 'render_chromium', status: 'skipped', detail: 'declined (opt-in)' };
  const r = runVerb(['render', '--install']);
  return r.ok
    ? { step: 'render_chromium', status: 'done', detail: 'Chromium installed' }
    : { step: 'render_chromium', status: 'failed', detail: r.detail };
}

async function stepFirstAction(opts: SetupOptions): Promise<StepResult> {
  if (opts.skipFirstAction || opts.yes) {
    // --yes mode never prompts for an action; the user can pick on their own.
    return { step: 'first_action', status: 'skipped', detail: opts.yes ? '--yes (no prompt)' : '--skip-first-action' };
  }
  if (!process.stdin.isTTY) {
    return { step: 'first_action', status: 'skipped', detail: 'no TTY' };
  }
  const { choice } = await inquirer.prompt<{ choice: string }>([
    {
      type: 'list',
      name: 'choice',
      message: 'What would you like to do first?',
      choices: [
        { name: 'Scaffold a new business (52 industry templates)', value: 'clone' },
        { name: 'Pull an existing company\'s data locally', value: 'pull' },
        { name: 'Spin up a live demo company', value: 'demo' },
        { name: 'Launch Claude Code / Cursor with this company\'s context', value: 'ai' },
        { name: 'I\'ll explore on my own', value: 'none' },
      ],
      default: 'clone',
    },
  ]);
  if (choice === 'none') {
    return { step: 'first_action', status: 'done', detail: 'no action chosen' };
  }
  const verbMap: Record<string, string[]> = {
    clone: ['clone'],
    pull: ['pull'],
    demo: ['demo', 'create'],
    ai: ['ai'],
  };
  // Interactive: these verbs own the terminal (clone's wizard, `solid ai`
  // launching a full-screen editor). Piping them shows the user nothing.
  const r = runVerb(verbMap[choice], { interactive: true });
  return {
    step: 'first_action',
    status: r.ok ? 'done' : 'failed',
    detail: `${choice}: ${r.ok ? 'launched' : r.detail}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Output helpers
// ─────────────────────────────────────────────────────────────────────────────

function statusGlyph(s: StepStatus): string {
  switch (s) {
    case 'done':    return chalk.green('✓');
    case 'skipped': return chalk.dim('○');
    case 'failed':  return chalk.red('✗');
    case 'warn':    return chalk.yellow('⚠');
    default:        return chalk.dim('•');
  }
}

function printHumanSummary(results: StepResult[]): void {
  console.log('');
  console.log(ui.banner());
  console.log(ui.successBox('Setup complete', [
    chalk.bold('Solid# CLI is wired up. Run `solid` from any terminal.'),
    '',
    ...results.map((r) => `  ${statusGlyph(r.status)} ${chalk.dim(r.step.padEnd(18))} ${r.detail || ''}`),
    '',
    chalk.dim('  Re-run `solid setup` any time — every step is idempotent.'),
    chalk.dim('  Help:  `solid --help`     ·   Docs:  https://solidnumber.com/docs/cli'),
    '',
    chalk.cyan('  💡 Wire Claude Desktop / Cursor to this tenant:'),
    chalk.dim('     solid mcp install claude'),
  ]));
}

// ─────────────────────────────────────────────────────────────────────────────
// Verb
// ─────────────────────────────────────────────────────────────────────────────

export const setupCommand = new Command('setup')
  .description('One-command onboarding: auth + editor MCP + Claude hook + completion + first action')
  .option('-y, --yes', 'Accept every default (CI / scripted installs)')
  .option('--skip-auth', 'Skip the auth step (login already handled out-of-band)')
  .option('--skip-mcp', 'Skip editor MCP wiring + Claude SessionStart hook')
  .option('--skip-completion', 'Skip shell tab-completion install')
  .option('--skip-render', 'Skip the optional Chromium download for solid render')
  .option('--skip-first-action', 'Skip the "what would you like to do first?" picker')
  .option('--install-token <token>', 'Redeem an ist_* install token from /dashboard/install-command instead of opening a browser to log in')
  .option('--json', 'Emit a structured progress envelope to stdout')
  .action(async (options: SetupOptions) => {
    const results: StepResult[] = [];

    try {
      // Phase 3: if an install token was supplied, redeem it FIRST so the
      // browser-auth step below sees `config.isLoggedIn() === true` and
      // becomes a no-op. If the exchange fails we record the failure and
      // bail — don't silently fall through to a browser flow that the
      // user may not be able to complete (e.g., headless / scripted install).
      const installTokenResult = await stepInstallToken(options);
      if (installTokenResult) {
        results.push(installTokenResult);
        if (installTokenResult.status === 'failed') {
          if (isJsonOutput(options)) {
            process.stdout.write(JSON.stringify({ ok: false, results }, null, 2) + '\n');
          } else {
            printHumanSummary(results);
          }
          process.exit(1);
        }
      }

      results.push(await stepAuth(options));
      const mcpResults = await stepEditorsMcp(options);
      results.push(...mcpResults);
      results.push(await stepClaudeHook(options));
      results.push(await stepCompletion(options));
      results.push(await stepRenderChromium(options));
      results.push(await stepFirstAction(options));
    } catch (err) {
      results.push({ step: 'wizard', status: 'failed', detail: (err as Error).message });
    }

    if (isJsonOutput(options)) {
      process.stdout.write(
        JSON.stringify(
          {
            ok: !results.some((r) => r.status === 'failed'),
            results,
          },
          null,
          2,
        ) + '\n',
      );
    } else {
      printHumanSummary(results);
    }

    // Exit 1 if any required step failed (skipped is OK, auth-failed is not).
    const requiredFailed = results.some(
      (r) => r.status === 'failed' && !['render_chromium', 'first_action', 'completion'].includes(r.step),
    );
    process.exit(requiredFailed ? 1 : 0);
  });
