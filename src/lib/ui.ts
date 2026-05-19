/**
 * Solid# CLI — Visual Design System
 *
 * Branded terminal UI: ASCII logo, gradient text, boxed output,
 * styled tables, progress indicators.
 */

import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf-8'));

// ── Brand Colors ────────────────────────────────────────────────────
// Solid# indigo gradient (light → deep)
const BRAND_COLORS = ['#a5b4fc', '#818cf8', '#6366f1', '#4f46e5', '#4338ca'];

// ── ASCII Logo ──────────────────────────────────────────────────────
// Pure block-only font (`█` + space). Avoids box-drawing chars that render
// inconsistently across terminals with narrow font coverage (Claude Code
// transcript, legacy cmd.exe, some IDE consoles). `█` (U+2588) has the
// widest glyph coverage of any non-ASCII char.
// Letters: S O L I D  #  — spells "SOLID#"
const LOGO_LINES = [
  '  █████ █████ █     █████ ████   █ █ ',
  '  █     █   █ █       █   █   █ █████',
  '  █████ █   █ █       █   █   █  █ █ ',
  '      █ █   █ █       █   █   █ █████',
  '  █████ █████ █████ █████ ████   █ █ ',
];
const LOGO_LINES_WIDTH = 37; // widest visible column (incl. 2-space left margin)

const LOGO_SMALL = [
  '  ┏━━━┓ ┏━━━┓ ┏┓   ┏┓ ┏━━┓  ╻ ╻',
  '  ┗━┓ ┃ ┃   ┃ ┃┃   ┃┃ ┃  ┃  ┃ ┃',
  '  ┏━┛ ┃ ┃   ┃ ┃┃   ┃┃ ┃  ┃  ┣━┫',
  '  ┗━━━┛ ┗━━━┛ ┗┛   ┗┛ ┗━━┛  ╹ ╹',
];
const LOGO_SMALL_WIDTH = 32;

// ASCII-safe fallback for legacy / non-UTF8 terminals (Windows cmd, some CI)
const LOGO_ASCII = [
  '   ____        _ _     _  _   ',
  '  / ___|  ___ | (_) __| |( )  ',
  '  \\___ \\ / _ \\| | |/ _` ||/   ',
  '   ___) | (_) | | | (_| |     ',
  '  |____/ \\___/|_|_|\\__,_|     ',
];
const LOGO_ASCII_WIDTH = 32;

// ── Gradient helper (pure chalk, no dependency issues) ──────────────
function brandGradient(text: string): string {
  const colors = BRAND_COLORS;
  const chars = [...text];
  return chars.map((char, i) => {
    const colorIndex = Math.floor((i / chars.length) * colors.length);
    return chalk.hex(colors[Math.min(colorIndex, colors.length - 1)])(char);
  }).join('');
}

function gradientLines(lines: string[]): string {
  return lines.map((line) => brandGradient(line)).join('\n');
}

// Diagonal gradient: each glyph's color depends on both row and column,
// so the logo reads light→deep from top-left to bottom-right.
function gradientDiagonal(lines: string[]): string {
  const colors = BRAND_COLORS;
  const maxLen = Math.max(...lines.map((l) => l.length));
  return lines.map((line, rowIdx) => {
    return [...line].map((ch, colIdx) => {
      if (ch === ' ') return ch;
      const t = (rowIdx / Math.max(1, lines.length - 1)) * 0.5
              + (colIdx / Math.max(1, maxLen - 1)) * 0.5;
      const i = Math.min(colors.length - 1, Math.floor(t * colors.length));
      return chalk.hex(colors[i])(ch);
    }).join('');
  }).join('\n');
}

// ── Box Drawing ─────────────────────────────────────────────────────
function box(content: string, options?: { title?: string; padding?: number; width?: number }): string {
  const pad = options?.padding ?? 1;
  const lines = content.split('\n');
  const maxLen = Math.max(...lines.map((l) => stripAnsi(l).length), (options?.title || '').length + 4);
  const width = options?.width ?? Math.min(maxLen + pad * 2, 72);

  const hr = '─'.repeat(width);
  const padStr = ' '.repeat(pad);

  const top = options?.title
    ? `  ╭─ ${chalk.bold.hex('#818cf8')(options.title)} ${'─'.repeat(Math.max(0, width - stripAnsi(options.title).length - 4))}╮`
    : `  ╭${hr}╮`;
  const bottom = `  ╰${hr}╯`;

  const paddedLines = lines.map((line) => {
    const visible = stripAnsi(line).length;
    const rightPad = Math.max(0, width - visible - pad * 2);
    return `  │${padStr}${line}${' '.repeat(rightPad)}${padStr}│`;
  });

  // Add vertical padding
  const emptyLine = `  │${' '.repeat(width)}│`;
  const vPad = Array(Math.max(0, pad - 1)).fill(emptyLine);

  return [top, ...vPad, ...paddedLines, ...vPad, bottom].join('\n');
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

// ── Environment probes ──────────────────────────────────────────────
// Exported for tests; safe on any platform.

export function termWidth(): number {
  const c = process.stdout.columns;
  return typeof c === 'number' && c > 0 ? c : 80;
}

export function isTTY(): boolean {
  return !!process.stdout.isTTY;
}

export function isCI(): boolean {
  // Covers GH Actions, CircleCI, GitLab, Buildkite, Jenkins, Vercel, Netlify.
  return !!(process.env.CI || process.env.GITHUB_ACTIONS || process.env.BUILD_NUMBER);
}

export function supportsUnicode(): boolean {
  if (process.platform === 'win32') {
    // Modern Windows Terminal sets WT_SESSION; legacy cmd.exe does not.
    if (process.env.WT_SESSION || process.env.TERM_PROGRAM === 'vscode') return true;
    return false;
  }
  const locale = process.env.LC_ALL || process.env.LC_CTYPE || process.env.LANG || '';
  return /UTF-?8/i.test(locale) || locale === '' && process.platform === 'darwin';
}

/** Banner tier chosen for the current environment. Useful for tests + debugging. */
export type BannerTier = 'silent' | 'wordmark' | 'small' | 'ascii' | 'full';

export function bannerTier(): BannerTier {
  if (!isTTY() || isCI()) return 'silent';
  const w = termWidth();
  if (!supportsUnicode()) return w >= LOGO_ASCII_WIDTH + 4 ? 'ascii' : 'wordmark';
  if (w >= LOGO_LINES_WIDTH + 4) return 'full';
  if (w >= LOGO_SMALL_WIDTH + 4) return 'small';
  return 'wordmark';
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Wordmark: `Solid# · Be There. · v1.9.x`
 * Collapses gracefully on narrow terminals.
 */
function wordmarkLine(): string {
  const w = termWidth();
  const mark = chalk.bold.hex('#818cf8')('Solid') + chalk.bold.hex('#a5b4fc')('#');
  const dot = chalk.hex('#6366f1')(' · ');
  const tagline = chalk.dim('Be There.');
  const version = chalk.dim(`v${pkg.version}`);

  // Widest form: Solid# · Be There. · v1.9.99  (~30 visible cols w/ margin)
  if (w >= 52) return `  ${mark}${dot}${tagline}${dot}${version}`;
  // Medium: Solid#  Be There.
  if (w >= 36) return `  ${mark}  ${tagline}`;
  // Tight: Solid# v1.9.99
  return `  ${mark} ${version}`;
}

export function banner(): string {
  const tier = bannerTier();

  if (tier === 'silent') return '';

  if (tier === 'wordmark') {
    return `\n${wordmarkLine()}\n`;
  }

  if (tier === 'ascii') {
    const logo = LOGO_ASCII.map((l) => brandGradient(l)).join('\n');
    return `\n${logo}\n\n${wordmarkLine()}\n`;
  }

  if (tier === 'small') {
    const logo = gradientLines(LOGO_SMALL);
    return `\n${logo}\n\n${wordmarkLine()}\n`;
  }

  // full
  const logo = gradientDiagonal(LOGO_LINES);
  return `\n${logo}\n\n${wordmarkLine()}\n`;
}

export function bannerSmall(): string {
  if (!isTTY() || isCI()) return '';
  const logo = supportsUnicode()
    ? gradientLines(LOGO_SMALL)
    : LOGO_ASCII.map((l) => brandGradient(l)).join('\n');
  return `\n${logo}\n`;
}

export function welcomeBox(companyName: string, companyId: number): string {
  const content = [
    `${chalk.bold('Company:')}  ${chalk.hex('#818cf8')(companyName)}`,
    `${chalk.bold('ID:')}       ${companyId}`,
    '',
    `${chalk.dim('Run')} ${chalk.cyan('solid --help')} ${chalk.dim('to see all commands')}`,
  ].join('\n');

  return box(content, { title: 'Logged In', padding: 1 });
}

/**
 * The "arrival" screen after `solid auth login` completes. Full branded
 * moment — logo, identity, suggested next commands. This is the product's
 * first physical artifact the user (or their AI agent) touches.
 */
export function loginSuccessScreen(args: {
  email: string;
  companyName: string;
  companyId: number;
  role?: string;
}): string {
  const lines: string[] = [];

  // 1. Big branded logo (silent on dumb terminals, which is correct).
  lines.push(banner());

  // 2. The confirmation beat.
  lines.push(`  ${chalk.green('✔')} ${chalk.bold('Signed in as')} ${chalk.hex('#a5b4fc')(args.email)}`);
  lines.push('');

  // 3. Active workspace card — proper company name, not email.
  const workspace = [
    `${chalk.dim('Company'.padEnd(10))} ${chalk.bold.hex('#818cf8')(args.companyName)}`,
    `${chalk.dim('ID'.padEnd(10))} ${args.companyId}`,
  ];
  if (args.role) workspace.push(`${chalk.dim('Role'.padEnd(10))} ${args.role}`);
  lines.push(box(workspace.join('\n'), { title: 'Active workspace', padding: 1 }));
  lines.push('');

  // 4. "Try these next" — the first three commands are the highest-signal
  // ones for a new session (status + revenue + the AI-agent hook).
  lines.push(`  ${chalk.bold('Try these next')}`);
  lines.push('');
  lines.push(commandHelp([
    { cmd: 'solid ai', desc: 'launch Claude / Cursor with this company loaded' },
    { cmd: 'solid switch', desc: 'change to a different company (picker)' },
    { cmd: 'solid status', desc: 'your business, at a glance' },
    { cmd: 'solid --help', desc: 'all commands' },
  ]));
  lines.push('');

  // 5. AI-agent nod — the whole point of this CLI.
  lines.push(`  ${chalk.dim('Your token is cached at ~/.solid/config.json — any AI agent')}`);
  lines.push(`  ${chalk.dim('running in this shell inherits it. Type')} ${chalk.cyan('claude')} ${chalk.dim('and go.')}`);
  lines.push('');

  return lines.join('\n');
}

export function successBox(title: string, lines: string[]): string {
  const content = lines.join('\n');
  return box(content, { title: `${chalk.green('✓')} ${title}`, padding: 1 });
}

export function errorBox(title: string, lines: string[]): string {
  const content = lines.join('\n');
  return box(content, { title: `${chalk.red('✗')} ${title}`, padding: 1 });
}

export function infoBox(title: string, lines: string[]): string {
  const content = lines.join('\n');
  return box(content, { title, padding: 1 });
}

export function divider(label?: string): string {
  if (label) {
    const line = '─'.repeat(Math.max(0, 32 - label.length));
    return chalk.dim(`  ── ${label} ${line}`);
  }
  return chalk.dim('  ' + '─'.repeat(36));
}

export function header(text: string): string {
  return `\n  ${chalk.bold.hex('#818cf8')(text)}\n`;
}

export function label(key: string, value: string): string {
  return `  ${chalk.dim(key.padEnd(14))} ${value}`;
}

export function statusDot(ok: boolean): string {
  return ok ? chalk.green('●') : chalk.red('●');
}

export function pill(text: string, color = '#818cf8'): string {
  return chalk.hex(color).bgHex('#1e1b4b')(` ${text} `);
}

export function commandHelp(commands: { cmd: string; desc: string }[]): string {
  const maxCmd = Math.max(...commands.map((c) => c.cmd.length));
  return commands
    .map((c) => `  ${chalk.cyan(c.cmd.padEnd(maxCmd + 2))} ${chalk.dim(c.desc)}`)
    .join('\n');
}

export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => stripAnsi(r[i] || '').length))
  );

  const headerLine = headers.map((h, i) => chalk.bold(h.padEnd(widths[i]))).join('  ');
  const separator = widths.map((w) => chalk.dim('─'.repeat(w))).join('──');
  const bodyLines = rows.map((row) =>
    row.map((cell, i) => {
      const visible = stripAnsi(cell).length;
      const pad = Math.max(0, widths[i] - visible);
      return cell + ' '.repeat(pad);
    }).join('  ')
  );

  return [`  ${headerLine}`, `  ${separator}`, ...bodyLines.map((l) => `  ${l}`)].join('\n');
}

// ── Animated intro (for first-time experience) ──────────────────────
export async function animatedBanner(): Promise<void> {
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // Clear and print logo line by line
  for (const line of LOGO_LINES) {
    console.log(brandGradient(line));
    await delay(60);
  }
  console.log('');
  console.log(chalk.dim('  Be There.') + '  ' + chalk.dim(`v${pkg.version}`));
  console.log('');
}

export const ui = {
  banner,
  bannerSmall,
  bannerTier,
  termWidth,
  isTTY,
  isCI,
  supportsUnicode,
  welcomeBox,
  loginSuccessScreen,
  successBox,
  errorBox,
  infoBox,
  divider,
  header,
  label,
  statusDot,
  pill,
  commandHelp,
  table,
  animatedBanner,
  brandGradient,
  box,
};
