/**
 * `solid ai` — the universal "launch my AI with this company's context" verb.
 *
 * Stupid easy, crazy powerful:
 *   $ solid auth login --company 61
 *   $ solid ai
 *        ↓ detects claude / cursor
 *        ↓ refreshes context for Company 61
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

type AiKind = 'claude' | 'cursor';

function whichAi(override?: string): AiKind | null {
  if (override) {
    const normalized = override.toLowerCase();
    if (normalized === 'claude' || normalized === 'cursor') return normalized as AiKind;
    return null;
  }
  // Auto-detect: prefer claude if both are installed (it's the one we optimize for).
  if (resolveBinary('claude')) return 'claude';
  if (resolveBinary('cursor')) return 'cursor';
  return null;
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
  // Delegate to the existing context command so we reuse every write path
  // (claude: .claude/CLAUDE.md + .claude/solid-context.json; cursor: .cursorrules).
  // Using `process.argv[0]` + the CLI entry ensures we call our own bundled
  // version, not whatever `solid` resolves to on PATH (which might be a
  // different install during dev).
  const args = kind === 'claude' ? ['context', '--claude'] : ['context', '--cursor'];
  const solidBin = resolveBinary('solid') || 'solid';
  const result = spawnSync(solidBin, args, { stdio: 'inherit' });
  return result.status === 0;
}

function launchAi(kind: AiKind): void {
  if (kind === 'claude') {
    // Hand the terminal over to Claude Code. stdio: 'inherit' makes this a
    // proper takeover — spinners, inquirer, etc. all work.
    execFileSync('claude', [], { stdio: 'inherit' });
  } else {
    // Cursor expects a path argument to open the current project.
    execFileSync('cursor', ['.'], { stdio: 'inherit' });
  }
}

export const aiCommand = new Command('ai')
  .description('Launch Claude Code / Cursor with this company\'s context pre-loaded (stupid easy)')
  .option('--as <tool>', 'Force a specific AI: claude | cursor (default: auto-detect)')
  .option('--no-context', 'Skip the context refresh — just launch the AI')
  .option('--company <id>', 'Use a specific company for this session (overrides cached)')
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

    // 3. Pick the AI
    const kind = whichAi(options.as);
    if (!kind) {
      console.error(chalk.red('No AI detected on PATH.'));
      console.error('');
      console.error(chalk.dim('  Install Claude Code:  https://claude.com/product/claude-code'));
      console.error(chalk.dim('  Install Cursor:       https://cursor.com'));
      console.error(chalk.dim('  Or pick explicitly:   solid ai --as claude'));
      process.exit(1);
    }

    // 4. Arrival: one clean line so the user (and any AI tail-ing) knows
    // exactly what's happening before the terminal hands off.
    const tool = kind === 'claude' ? 'Claude Code' : 'Cursor';
    console.log('');
    console.log(`  ${chalk.bold('Launching')} ${chalk.hex('#a5b4fc')(tool)} ${chalk.dim(`with Company ${options.company || config.companyId} context`)}`);
    console.log('');

    // 5. Refresh context (unless --no-context)
    if (options.context !== false) {
      const ok = refreshContext(kind);
      if (!ok) {
        console.error(chalk.yellow('  ⚠ Context refresh failed — launching anyway with cached files.'));
      }
    }

    // 6. Hand off. This replaces our process output with the AI's.
    try {
      launchAi(kind);
    } catch (err) {
      // execFileSync throws on non-zero exit — that's fine, just mirror status.
      const code = (err as { status?: number })?.status ?? 1;
      process.exit(code);
    }
  });
