/**
 * Command Kit — shared helpers for `solid` subcommands.
 *
 * Every command in `src/commands/` was repeating the same five lines:
 *   1. config.isLoggedIn() guard
 *   2. dynamic ora() spinner
 *   3. try / await apiClient.*
 *   4. if (options.json) console.log(JSON.stringify(...))
 *   5. catch { spinner.fail; console.error(handleApiError(e).message) }
 *
 * `run()` collapses that into one call so every migrated command handles
 * auth, JSON output, spinner lifecycle, and error reporting the same way.
 *
 * Design rules enforced here (so `solid X --json | jq` just works):
 *   - Spinner writes to stderr, never stdout.
 *   - `--json` output: *only* the JSON on stdout. No spinner chrome.
 *   - `--quiet`: no spinner, no success text; errors still to stderr.
 *   - Errors always on stderr, exit 1.
 *
 * See migration examples in insights.ts, reports.ts.
 */

import chalk from 'chalk';

import { config } from './config';
import { handleApiError } from './api-client';

export interface RunOptions<T> {
  /** Spinner text shown while `task` runs. `null` disables the spinner. */
  spinner?: string | null;
  /** Shown on success. If a function, called with the resolved result. */
  successText?: string | ((result: T) => string);
  /** Shown (red) next to the spinner on failure. Defaults to "Failed". */
  errorText?: string;
  /** Skip the logged-in check. Only set for fully public commands. */
  skipAuth?: boolean;
  /** Emit `JSON.stringify(result, null, 2)` instead of calling `render`. */
  json?: boolean;
  /**
   * Suppress spinner, success text, and any chrome — just data on stdout
   * (via `render` or `--json`) and errors on stderr. Ideal for scripting.
   */
  quiet?: boolean;
  /** Pretty-print the result. Not called when `json` is true. */
  render?: (result: T) => void;
}

/**
 * Minimal spinner surface used by `run()`. Real `ora` implements this,
 * and tests can inject a mock without pulling in the ESM dependency.
 */
export interface SpinnerLike {
  start(): SpinnerLike;
  stop(): SpinnerLike;
  succeed(text?: string): SpinnerLike;
  fail(text?: string): SpinnerLike;
}

type SpinnerFactory = (text: string) => SpinnerLike;

// Overridable for tests. Default lazily imports `ora`.
let spinnerFactory: SpinnerFactory | null = null;

export function __setSpinnerFactoryForTest(fn: SpinnerFactory | null): void {
  spinnerFactory = fn;
}

async function buildSpinner(text: string): Promise<SpinnerLike> {
  if (spinnerFactory) return spinnerFactory(text);
  const ora = (await import('ora')).default;
  // CRITICAL: write to stderr, NOT stdout — otherwise spinner chars leak
  // into `solid X --json | jq` and break every scripting use case.
  return ora({ text, stream: process.stderr }).start() as unknown as SpinnerLike;
}

/**
 * Guard: print "Not logged in" and exit if the user has no session.
 * Exposed for commands that run custom flows `run()` doesn't cover.
 */
export function requireAuth(): void {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    // eslint-disable-next-line no-process-exit
    process.exit(1);
  }
}

/** Returns true when any caller in the process explicitly asked for quiet mode. */
export function quietFromEnv(): boolean {
  return process.env.SOLID_QUIET === '1' || process.env.SOLID_QUIET === 'true';
}

/**
 * Interactive y/N confirmation for destructive operations.
 *
 * Call order matters:
 *   - `--yes` / `autoConfirm=true` → returns true immediately, no prompt.
 *   - stdin is not a TTY (piped / CI / agent) → returns `false` with a
 *     helpful hint. Scripts MUST pass `--yes` explicitly, never fall through.
 *   - otherwise, prompt once; answers starting with 'y' (case-insensitive)
 *     confirm; everything else denies.
 *
 * Intended for commands that delete/destroy/cancel/revoke/purge. Compose
 * with a `--dry-run` branch before this to let the user preview the call
 * without firing it.
 */
export async function confirm(
  message: string,
  options: { autoConfirm?: boolean } = {},
): Promise<boolean> {
  if (options.autoConfirm) return true;
  if (!process.stdin.isTTY) {
    console.error(chalk.red('  Refusing to run destructive op with no TTY — pass --yes to proceed.'));
    return false;
  }
  const readline = await import('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise<boolean>((resolve) => {
    rl.question(`  ${message} (y/N) `, (answer: string) => {
      rl.close();
      resolve(answer.trim().toLowerCase().startsWith('y'));
    });
  });
}

/**
 * Execute an async task with the standard auth / spinner / JSON / error
 * lifecycle. Returns void — subcommands just `await run(...)` and exit.
 */
export async function run<T>(
  task: () => Promise<T>,
  options: RunOptions<T> = {},
): Promise<void> {
  if (!options.skipAuth) requireAuth();

  const quiet = Boolean(options.quiet) || quietFromEnv();
  const useSpinner = !quiet && options.spinner !== null && options.spinner !== undefined;
  let spinner: SpinnerLike | null = null;
  if (useSpinner) {
    spinner = await buildSpinner(options.spinner as string);
  }

  try {
    const result = await task();

    if (options.json) {
      if (spinner) spinner.stop();
      // Only the JSON lands on stdout — no other output path touches it.
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (spinner) {
      const successText =
        typeof options.successText === 'function'
          ? options.successText(result)
          : options.successText;
      if (successText) {
        spinner.succeed(chalk.green(successText));
      } else {
        spinner.stop();
      }
    }

    if (!quiet && options.render) options.render(result);
    else if (quiet && options.render) options.render(result);
  } catch (error) {
    const errorText = options.errorText || 'Failed';
    if (spinner) spinner.fail(chalk.red(errorText));
    const apiError = handleApiError(error);
    console.error(chalk.red(`  ${apiError.message}`));
    // eslint-disable-next-line no-process-exit
    process.exit(1);
  }
}
