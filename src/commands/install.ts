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
import { HOOK_COMMAND, loadSettings, removeSessionStartHook, saveSettings, upsertSessionStartHook } from '../lib/claude-hook';
import { ui } from '../lib/ui';

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

      // Every terminal-facing outcome below gets the branded banner so
      // install feels like a first-class "welcome" moment — same tier as
      // the login arrival screen, not a plain box.
      const brand = ui.banner();

      if (!changed) {
        console.log(brand);
        if (options.uninstall) {
          console.log(ui.infoBox('Nothing to do', [
            `${chalk.dim('No Solid hook found in')} ~/.claude/settings.json`,
          ]));
        } else {
          console.log(ui.successBox('Already installed', [
            `${chalk.dim('Solid hook is already in')} ~/.claude/settings.json`,
            '',
            `${chalk.dim('Verify with:')} ${chalk.cyan('solid install --preview')}`,
          ]));
        }
        return;
      }

      saveSettings(settings);

      if (options.uninstall) {
        console.log(brand);
        console.log(ui.successBox('Uninstalled', [
          `${chalk.dim('Removed Solid SessionStart hook from')} ~/.claude/settings.json`,
          `${chalk.dim('Claude Code will no longer auto-refresh .claude/CLAUDE.md.')}`,
        ]));
        return;
      }

      console.log(brand);
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
