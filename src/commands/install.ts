/**
 * `solid install` — one-time setup so `claude` always sees fresh Solid context.
 *
 * Writes a SessionStart hook into ~/.claude/settings.json. After this, every
 * Claude Code session (in any directory, any time) auto-refreshes
 * .claude/CLAUDE.md before the model gets its first token.
 *
 * Stupid easy:
 *   $ solid install            ← run once, ever
 *   $ solid auth login
 *   $ claude                    ← context is already fresh
 *
 * Idempotent: safe to run many times. Existing settings are preserved.
 */
import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { ui } from '../lib/ui';

const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
// The command Claude Code runs before every session. `--quiet` keeps the hook
// silent on success; failures still print so the user sees what's up.
const HOOK_COMMAND = 'solid context --claude --quiet';

type HookEntry = { type: 'command'; command: string };
type HookGroup = { hooks: HookEntry[] };

function loadSettings(): Record<string, unknown> {
  if (!fs.existsSync(CLAUDE_SETTINGS_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8'));
  } catch (err) {
    // Corrupt JSON — refuse to clobber. User has to fix it first.
    throw new Error(`~/.claude/settings.json is not valid JSON (${(err as Error).message}). Fix the file and re-run.`);
  }
}

function saveSettings(obj: Record<string, unknown>): void {
  const dir = path.dirname(CLAUDE_SETTINGS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
}

// Idempotent merge: add our hook entry if (and only if) it isn't already there.
// Returns true when the file was modified.
function upsertSessionStartHook(settings: Record<string, unknown>): boolean {
  const hooks = (settings.hooks as Record<string, unknown> | undefined) || {};
  const sessionStart = (hooks.SessionStart as HookGroup[] | undefined) || [];

  const alreadyHasOurs = sessionStart.some((group) =>
    (group.hooks || []).some((h) => h.command === HOOK_COMMAND),
  );
  if (alreadyHasOurs) return false;

  sessionStart.push({
    hooks: [{ type: 'command', command: HOOK_COMMAND }],
  });
  hooks.SessionStart = sessionStart;
  settings.hooks = hooks;
  return true;
}

function removeSessionStartHook(settings: Record<string, unknown>): boolean {
  const hooks = settings.hooks as Record<string, unknown> | undefined;
  if (!hooks || !Array.isArray(hooks.SessionStart)) return false;

  const before = (hooks.SessionStart as HookGroup[]).length;
  const filtered = (hooks.SessionStart as HookGroup[])
    .map((group) => ({ ...group, hooks: (group.hooks || []).filter((h) => h.command !== HOOK_COMMAND) }))
    .filter((group) => group.hooks.length > 0);

  if (filtered.length === before && filtered.every((g, i) => g.hooks.length === (hooks.SessionStart as HookGroup[])[i].hooks.length)) {
    return false;
  }

  if (filtered.length === 0) {
    delete hooks.SessionStart;
  } else {
    hooks.SessionStart = filtered;
  }
  return true;
}

export const installCommand = new Command('install')
  .description('One-time setup: wire Claude Code to auto-refresh Solid context at every session start')
  .option('--uninstall', 'Remove the Solid hook from ~/.claude/settings.json')
  .option('--preview', 'Show what would change without writing (same effect as the global --dry-run)')
  .action((options) => {
    try {
      const settings = loadSettings();

      const changed = options.uninstall
        ? removeSessionStartHook(settings)
        : upsertSessionStartHook(settings);

      const preview = JSON.stringify({ hooks: settings.hooks }, null, 2);

      // Honor BOTH the local --preview flag and the global --dry-run so users
      // can't accidentally install when they think they're previewing.
      const isPreview = options.preview || process.env.SOLID_DRY_RUN === '1' || process.argv.includes('--dry-run');
      if (isPreview) {
        console.log(chalk.dim('  Would write to ~/.claude/settings.json:'));
        console.log('');
        console.log(preview);
        return;
      }

      if (!changed) {
        if (options.uninstall) {
          console.log(ui.infoBox('Nothing to do', [
            `${chalk.dim('No Solid hook found in')} ~/.claude/settings.json`,
          ]));
        } else {
          console.log(ui.successBox('Already installed', [
            `${chalk.dim('Solid hook is already in')} ~/.claude/settings.json`,
            '',
            `${chalk.dim('Verify with:')} ${chalk.cyan('solid install --dry-run')}`,
          ]));
        }
        return;
      }

      saveSettings(settings);

      if (options.uninstall) {
        console.log(ui.successBox('Uninstalled', [
          `${chalk.dim('Removed Solid SessionStart hook from')} ~/.claude/settings.json`,
          `${chalk.dim('Claude Code will no longer auto-refresh .claude/CLAUDE.md.')}`,
        ]));
        return;
      }

      console.log(ui.successBox('Installed', [
        `${chalk.bold('Wired Claude Code to auto-load Solid context.')}`,
        '',
        `${chalk.dim('Next session:')} when you type ${chalk.cyan('claude')}, Claude Code runs:`,
        `              ${chalk.cyan(HOOK_COMMAND)}`,
        `              and reads the fresh .claude/CLAUDE.md as context.`,
        '',
        `${chalk.dim('Try it:')}  ${chalk.cyan('solid auth login')} ${chalk.dim('→')} ${chalk.cyan('claude')}`,
        `${chalk.dim('Undo:')}   ${chalk.cyan('solid install --uninstall')}`,
      ]));
    } catch (err) {
      console.error(chalk.red((err as Error).message));
      process.exit(1);
    }
  });
