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
 * See migration examples in insights.ts, reports.ts, agent.ts.
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
  return ora(text).start() as unknown as SpinnerLike;
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

/**
 * Execute an async task with the standard auth / spinner / JSON / error
 * lifecycle. Returns void — subcommands just `await run(...)` and exit.
 */
export async function run<T>(
  task: () => Promise<T>,
  options: RunOptions<T> = {},
): Promise<void> {
  if (!options.skipAuth) requireAuth();

  const useSpinner = options.spinner !== null && options.spinner !== undefined;
  let spinner: SpinnerLike | null = null;
  if (useSpinner) {
    // spinnerFactory case returns an already-started spinner; ora().start() does too.
    spinner = await buildSpinner(options.spinner as string);
  }

  try {
    const result = await task();

    if (options.json) {
      if (spinner) spinner.stop();
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

    if (options.render) options.render(result);
  } catch (error) {
    const errorText = options.errorText || 'Failed';
    if (spinner) spinner.fail(chalk.red(errorText));
    const apiError = handleApiError(error);
    console.error(chalk.red(`  ${apiError.message}`));
    // eslint-disable-next-line no-process-exit
    process.exit(1);
  }
}
