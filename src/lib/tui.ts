/**
 * Shared TUI primitives — pickers, progress bars, confirmations.
 *
 * Every interactive moment in the CLI routes through here so the look and
 * keybindings stay consistent. All helpers no-op in non-TTY environments
 * (CI, pipes) — they never hang waiting for stdin.
 *
 * Design:
 *  - TTY detection is cheap; do it once per call.
 *  - Non-TTY callers must pass a default; otherwise we throw. That stops
 *    silent drift where a prompt "worked" in CI by returning undefined.
 *  - All dynamic imports so this module stays cheap to `require` at
 *    CLI boot (inquirer + cli-progress both pull in ~200kb of helpers).
 */

import chalk from 'chalk';

// --------------------------------------------------------------------------
// Environment detection
// --------------------------------------------------------------------------

export function isInteractive(): boolean {
  // --yes and CI suppress prompts. Most CLIs also honor NO_INTERACTIVE.
  if (process.env.CI === 'true' || process.env.CI === '1') return false;
  if (process.env.SOLID_NO_INTERACTIVE === '1') return false;
  if (!process.stdin.isTTY) return false;
  if (!process.stdout.isTTY) return false;
  return true;
}

// --------------------------------------------------------------------------
// Select / pick
// --------------------------------------------------------------------------

export interface SelectOption<T = string> {
  name: string;
  value: T;
  description?: string;
}

/**
 * Interactive picker. In non-interactive environments, returns `fallback`
 * (or throws if no fallback is supplied — that's almost certainly a bug,
 * better to fail loudly than quietly pick something).
 */
export async function select<T = string>(
  message: string,
  options: SelectOption<T>[],
  opts?: { fallback?: T; pageSize?: number },
): Promise<T> {
  if (!isInteractive()) {
    if (opts && 'fallback' in opts) return opts.fallback as T;
    throw new Error(
      `Interactive prompt "${message}" in a non-TTY context. Pass the value as a flag or set --yes, or run in a TTY.`,
    );
  }
  const inquirer = (await import('inquirer')).default;
  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'v',
      message,
      choices: options.map((o) => ({
        name: o.description ? `${o.name} ${chalk.dim(`— ${o.description}`)}` : o.name,
        value: o.value,
      })),
      pageSize: opts?.pageSize ?? 10,
    },
  ]);
  return answers.v as T;
}

/**
 * Free-form text prompt with validation. Same non-TTY contract as select().
 */
export async function input(
  message: string,
  opts?: { fallback?: string; validate?: (v: string) => true | string; mask?: boolean },
): Promise<string> {
  if (!isInteractive()) {
    if (opts && 'fallback' in opts) return opts.fallback as string;
    throw new Error(`Interactive input "${message}" in a non-TTY context.`);
  }
  const inquirer = (await import('inquirer')).default;
  const answers = await inquirer.prompt([
    {
      type: opts?.mask ? 'password' : 'input',
      name: 'v',
      message,
      mask: opts?.mask ? '*' : undefined,
      validate: opts?.validate,
    },
  ]);
  return answers.v as string;
}

// --------------------------------------------------------------------------
// Progress bar
// --------------------------------------------------------------------------

export interface ProgressHandle {
  update(current: number, payload?: Record<string, unknown>): void;
  increment(step?: number): void;
  stop(): void;
}

/**
 * Determinate progress bar. In non-TTY environments this returns a silent
 * no-op handle — long bulk imports don't spam logs with `[==--] 42%` lines
 * when piped to a file.
 */
export async function progressBar(
  total: number,
  opts?: { label?: string; format?: string },
): Promise<ProgressHandle> {
  if (!process.stdout.isTTY || process.env.SOLID_NO_PROGRESS === '1') {
    return {
      update: () => undefined,
      increment: () => undefined,
      stop: () => undefined,
    };
  }
  const { SingleBar, Presets } = await import('cli-progress');
  const bar = new SingleBar(
    {
      format:
        opts?.format ??
        `  ${opts?.label ? chalk.cyan(opts.label) + ' ' : ''}${chalk.dim('[')}{bar}${chalk.dim(']')} {percentage}%  ${chalk.dim('{value}/{total}')}  {extras}`,
      hideCursor: true,
      barsize: 30,
      barCompleteChar: '█',
      barIncompleteChar: '░',
    },
    Presets.shades_classic,
  );
  bar.start(total, 0, { extras: '' });
  return {
    update(current: number, payload?: Record<string, unknown>) {
      bar.update(current, { extras: payload ? JSON.stringify(payload) : '' });
    },
    increment(step = 1) {
      bar.increment(step);
    },
    stop() {
      bar.stop();
    },
  };
}

// --------------------------------------------------------------------------
// Confirm — TTY-aware, respects --yes
// --------------------------------------------------------------------------

export async function confirm(
  message: string,
  opts?: { defaultTo?: boolean; autoConfirm?: boolean },
): Promise<boolean> {
  if (opts?.autoConfirm) return true;
  if (!isInteractive()) return opts?.defaultTo ?? false;
  const inquirer = (await import('inquirer')).default;
  const answers = await inquirer.prompt([
    { type: 'confirm', name: 'v', message, default: opts?.defaultTo ?? false },
  ]);
  return Boolean(answers.v);
}

// --------------------------------------------------------------------------
// Live status pane — a one-line, overwriting status display for long ops.
// Cheaper than cli-progress when you don't have a total.
// --------------------------------------------------------------------------

export function live(initial = ''): {
  set(text: string): void;
  stop(final?: string): void;
} {
  if (!process.stdout.isTTY) {
    return { set: () => undefined, stop: () => undefined };
  }
  let started = false;
  const write = (s: string) => {
    if (started) process.stdout.write('\x1b[2K\r');
    process.stdout.write(s);
    started = true;
  };
  if (initial) write(initial);
  return {
    set: (text) => write(text),
    stop: (final) => {
      if (final !== undefined) write(final);
      process.stdout.write('\n');
    },
  };
}
