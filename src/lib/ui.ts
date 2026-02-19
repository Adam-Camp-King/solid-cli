/**
 * Solid# CLI — Visual Design System
 *
 * Branded terminal UI: ASCII logo, gradient text, boxed output,
 * styled tables, progress indicators.
 */

import chalk from 'chalk';

// ── Brand Colors ────────────────────────────────────────────────────
// Solid# purple/indigo gradient
const BRAND_COLORS = ['#818cf8', '#6366f1', '#4f46e5', '#4338ca'];

// ── ASCII Logo ──────────────────────────────────────────────────────
const LOGO_LINES = [
  '  ███████╗ ██████╗ ██╗     ██╗██████╗  ██╗  ██╗',
  '  ██╔════╝██╔═══██╗██║     ██║██╔══██╗ ██║  ██║',
  '  ███████╗██║   ██║██║     ██║██║  ██║ ███████║',
  '  ╚════██║██║   ██║██║     ██║██║  ██║ ╚════██║',
  '  ███████║╚██████╔╝███████╗██║██████╔╝      ██║',
  '  ╚══════╝ ╚═════╝ ╚══════╝╚═╝╚═════╝       ╚═╝',
];

const LOGO_SMALL = [
  '  ┏━━━┓ ┏━━━┓ ┏┓   ┏┓ ┏━━┓  ╻ ╻',
  '  ┗━┓ ┃ ┃   ┃ ┃┃   ┃┃ ┃  ┃  ┃ ┃',
  '  ┏━┛ ┃ ┃   ┃ ┃┃   ┃┃ ┃  ┃  ┣━┫',
  '  ┗━━━┛ ┗━━━┛ ┗┛   ┗┛ ┗━━┛  ╹ ╹',
];

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

// ── Public API ──────────────────────────────────────────────────────

export function banner(): string {
  const logo = gradientLines(LOGO_LINES);
  const tagline = chalk.dim('  AI Business Infrastructure');
  const version = chalk.dim(`  v1.0.0`);

  return `\n${logo}\n${tagline}  ${version}\n`;
}

export function bannerSmall(): string {
  const logo = gradientLines(LOGO_SMALL);
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
  console.log(chalk.dim('  AI Business Infrastructure') + '  ' + chalk.dim('v1.0.0'));
  console.log('');
}

export const ui = {
  banner,
  bannerSmall,
  welcomeBox,
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
