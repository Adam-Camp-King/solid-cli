/**
 * The "get an AI" menu — one place that knows how to install every AI we
 * can launch, plus the always-works browser path.
 *
 * Shown whenever the user doesn't have a working AI yet (`solid ai` with
 * nothing installed, `solid setup` when no editor is found). A normal user
 * should never research "how do I install Claude" — we hand them the exact
 * line per AI and tell them the browser works with zero install.
 */
import chalk from 'chalk';

export interface AiInstallOption {
  /** Display name. */
  name: string;
  /** The exact thing to run or visit. */
  install: string;
  /** One-line qualifier (OS floors, follow-up command). */
  note?: string;
}

export const AI_INSTALL_OPTIONS: AiInstallOption[] = [
  {
    name: 'Claude (browser)',
    install: 'https://claude.ai/code',
    note: 'nothing to install — works on any device',
  },
  {
    name: 'Claude Code',
    install: 'npm i -g @anthropic-ai/claude-code',
    note: 'terminal AI — needs macOS 13+ on Mac',
  },
  {
    name: 'VS Code + Claude',
    install: 'https://code.visualstudio.com',
    note: 'works on older Macs — we add the Claude extension for you',
  },
  {
    name: 'Cursor',
    install: 'https://cursor.com',
  },
  {
    name: 'Codex (OpenAI)',
    install: 'npm i -g @openai/codex',
  },
  {
    name: 'Gemini (Google)',
    install: 'npm i -g @google/gemini-cli',
  },
  {
    name: 'Grok (xAI)',
    install: 'https://grok.com',
    note: 'browser',
  },
];

/**
 * Render the menu for terminal output. Returns lines (no trailing newline)
 * so callers control stdout vs stderr.
 */
export function renderAiInstallOptions(): string[] {
  const lines: string[] = [];
  lines.push(`  ${chalk.bold('Get an AI — pick one, then run')} ${chalk.cyan('solid ai')}${chalk.bold(':')}`);
  const pad = Math.max(...AI_INSTALL_OPTIONS.map((o) => o.name.length)) + 2;
  for (const o of AI_INSTALL_OPTIONS) {
    const target = chalk.cyan(o.install);
    lines.push(`    ${o.name.padEnd(pad)}${target}${o.note ? chalk.dim(`  — ${o.note}`) : ''}`);
  }
  return lines;
}
