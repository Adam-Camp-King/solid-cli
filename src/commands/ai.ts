/**
 * `solid ai` — the universal "launch my AI with this company's context" verb.
 *
 * Stupid easy, crazy powerful:
 *   $ solid auth login
 *   $ solid ai
 *        ↓ detects claude / cursor
 *        ↓ refreshes context for your current company
 *        ↓ exec's the AI
 *
 * One command. Any AI. Any company. The CLI is the adapter.
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { spawnSync, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { config } from '../lib/config';
import { ui } from '../lib/ui';
import { parseAgentMode, modeDescriptor, type AgentMode } from '../lib/agent-mode';
import { preflightEditor } from '../lib/editor-preflight';

type AiKind = 'claude' | 'cursor' | 'codex';

const AI_PREFERENCE: AiKind[] = ['claude', 'cursor', 'codex'];

interface AiPick {
  kind: AiKind | null;
  /** Editors that are on PATH but failed preflight (can't actually run). */
  broken: Array<{ kind: AiKind; reason: string; hint?: string }>;
}

// "On PATH" is not "can run" — a binary built for a newer macOS aborts at
// launch (dyld symbol errors). Preflight each candidate so auto-detect
// falls through to the next working editor instead of handing the terminal
// to a crash dump. See lib/editor-preflight.ts for the real-world case.
function whichAi(override?: string): AiPick {
  if (override) {
    const normalized = override.toLowerCase();
    if (normalized === 'claude' || normalized === 'cursor' || normalized === 'codex') {
      const kind = normalized as AiKind;
      if (!resolveBinary(kind)) return { kind: null, broken: [] };
      const pf = preflightEditor(kind);
      if (!pf.ok) {
        return { kind: null, broken: [{ kind, reason: pf.reason!, hint: pf.hint }] };
      }
      return { kind, broken: [] };
    }
    return { kind: null, broken: [] };
  }
  // Auto-detect. Preference order reflects what we ship first-class support
  // for: claude > cursor > codex. Change this when product priorities shift.
  const broken: AiPick['broken'] = [];
  for (const kind of AI_PREFERENCE) {
    if (!resolveBinary(kind)) continue;
    const pf = preflightEditor(kind);
    if (pf.ok) return { kind, broken };
    broken.push({ kind, reason: pf.reason!, hint: pf.hint });
  }
  return { kind: null, broken };
}

// Resolve a binary via PATH without depending on `which` being installed.
// `spawnSync` with shell=false is safe against injection because we pass argv
// array, but we still only accept known names from whichAi() above.
function resolveBinary(name: string): string | null {
  const pathEntries = (process.env.PATH || '').split(path.delimiter);
  for (const entry of pathEntries) {
    if (!entry) continue;
    const candidate = path.join(entry, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // not here, keep looking
    }
  }
  return null;
}

function refreshContext(kind: AiKind): boolean {
  // Delegate to the existing context command so we reuse every write path:
  //   claude → .claude/CLAUDE.md + .claude/solid-context.json
  //   cursor → .cursorrules
  //   codex  → AGENTS.md
  //
  // --if-tenant turns "no manifest here" / "protected root (home, platform
  // monorepo)" into a silent exit 0 instead of the loud refusal banner.
  // That's correct for `solid ai`: when launched from $HOME or anywhere
  // not bound to a tenant, the right behavior is "launch the AI with
  // whatever cached files exist", not "print a scary error and then
  // launch anyway." Mismatched-company manifests still loud-fail because
  // silent skip there would let stale or wrong-tenant context flow into
  // the AI session.
  const flag = kind === 'claude' ? '--claude' : kind === 'cursor' ? '--cursor' : '--codex';
  const solidBin = resolveBinary('solid') || 'solid';
  const result = spawnSync(solidBin, ['context', flag, '--if-tenant'], { stdio: 'inherit' });
  return result.status === 0;
}

function launchAi(kind: AiKind): void {
  if (kind === 'claude') {
    // Hand the terminal over to Claude Code. stdio: 'inherit' makes this a
    // proper takeover — spinners, inquirer, etc. all work.
    execFileSync('claude', [], { stdio: 'inherit' });
  } else if (kind === 'cursor') {
    // Cursor expects a path argument to open the current project.
    execFileSync('cursor', ['.'], { stdio: 'inherit' });
  } else {
    // Codex (OpenAI's CLI) launches in the current directory; no args needed.
    execFileSync('codex', [], { stdio: 'inherit' });
  }
}

export const aiCommand = new Command('ai')
  .description('Launch Claude Code / Cursor / Codex with this company\'s context pre-loaded (stupid easy)')
  .option('--as <tool>', 'Force a specific AI: claude | cursor | codex (default: auto-detect)')
  .option('--no-context', 'Skip the context refresh — just launch the AI')
  .option('--company <id>', 'Use a specific company for this session (overrides cached)')
  .option('--mode <mode>', 'Cap the AI to a role: customer | developer | agency | full (default: full)')
  .option('--sandbox', 'Safe-preview mode: every mutation is intercepted (dry-run). The AI sees what would happen without making changes.')
  .action(async (options) => {
    // 1. Auth guard
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run: solid auth login'));
      process.exit(1);
    }
    if (!config.companyId) {
      console.error(chalk.red('No company selected. Run: solid auth login'));
      process.exit(1);
    }

    // 2. --company override: set per-process so the refresh we're about to
    // trigger scopes to the right tenant without re-login. The token still
    // belongs to the logged-in user; the backend verifies membership.
    if (options.company) {
      const id = parseInt(options.company, 10);
      if (!Number.isFinite(id) || id <= 0) {
        console.error(chalk.red(`Invalid --company value: ${options.company}`));
        process.exit(1);
      }
      // SOLID_COMPANY_OVERRIDE is read by the api-client's X-Company-ID path.
      // If that env isn't honored (legacy), at worst we fall back to the
      // cached company_id — surfaced in the arrival message below.
      process.env.SOLID_COMPANY_OVERRIDE = String(id);
    }

    // 3. Resolve agent mode — this scopes what the AI can call. Default
    // is `full` (no cap) to preserve today's behavior for humans. When an
    // agent session is explicit, the guard in index.ts enforces the
    // allowlist on every subsequent `solid ...` invocation inside the AI.
    const mode: AgentMode = parseAgentMode(options.mode) || 'full';

    // 4. Pick the AI — preflighted, so "installed but can't run on this
    // machine" produces a plain explanation instead of a dyld crash dump.
    const pick = whichAi(options.as);
    for (const b of pick.broken) {
      console.error(chalk.yellow(`  ⚠ ${b.reason}`));
      if (b.hint) console.error(chalk.dim(`    ${b.hint}`));
    }
    const kind = pick.kind;
    if (!kind) {
      if (pick.broken.length === 0) {
        console.error(chalk.red('No AI detected on PATH.'));
      } else {
        console.error(chalk.red('No working AI found on this machine.'));
      }
      console.error('');
      console.error(chalk.dim('  Install Claude Code:  https://claude.com/product/claude-code'));
      console.error(chalk.dim('  Install Cursor:       https://cursor.com'));
      console.error(chalk.dim('  Install Codex CLI:    https://github.com/openai/codex'));
      console.error(chalk.dim('  Or pick explicitly:   solid ai --as claude'));
      process.exit(1);
    }

    // 5. Set the agent/human headers + mode env vars. Every `solid ...`
    // invocation the AI spawns will inherit these via process.env, so the
    // api-client attaches the right headers on every API call and the
    // top-level mode guard refuses out-of-scope commands.
    process.env.SOLID_AGENT = kind;
    process.env.SOLID_AGENT_MODE = mode;
    if (config.userEmail) process.env.SOLID_HUMAN_INITIATOR = config.userEmail;

    // Sandbox mode: flip the existing CLI-wide dry-run switch. Every
    // mutation the AI attempts gets intercepted at the api-client layer
    // and returned as a synthetic success — no real writes, no real
    // charges, no real deletes. The AI's reasoning still works because
    // it sees a "would have worked" response shape. Human re-runs without
    // --sandbox to actually apply. This is the "world class" safety net
    // promised in the Five Builds — #2 sandbox.
    if (options.sandbox) {
      process.env.SOLID_DRY_RUN = '1';
      process.env.SOLID_AGENT_SANDBOX = '1';
    }

    // 6. Arrival: one clean line so the user (and any AI tail-ing) knows
    // exactly what's happening before the terminal hands off.
    const tool = kind === 'claude' ? 'Claude Code' : kind === 'cursor' ? 'Cursor' : 'Codex';
    console.log('');
    console.log(`  ${chalk.bold('Launching')} ${chalk.hex('#a5b4fc')(tool)} ${chalk.dim(`with Company ${options.company || config.companyId} context`)}`);
    if (mode !== 'full') {
      console.log(`  ${chalk.dim('Mode:')} ${chalk.yellow(modeDescriptor(mode))}`);
    }
    if (options.sandbox) {
      console.log(`  ${chalk.dim('Sandbox:')} ${chalk.hex('#fbbf24')('ON — every mutation intercepted (dry-run). No real writes.')}`);
    }
    console.log('');

    // 7. Refresh context (unless --no-context)
    if (options.context !== false) {
      const ok = refreshContext(kind);
      if (!ok) {
        console.error(chalk.yellow('  ⚠ Context refresh failed — launching anyway with cached files.'));
      }
    }

    // 8. Hand off. This replaces our process output with the AI's.
    try {
      launchAi(kind);
    } catch (err) {
      // execFileSync throws on non-zero exit — that's fine, just mirror status.
      const code = (err as { status?: number })?.status ?? 1;
      process.exit(code);
    }
  });
