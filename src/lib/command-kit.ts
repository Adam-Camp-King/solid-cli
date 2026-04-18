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
  /**
   * Write the payload (JSON when `json: true`, otherwise nothing — pretty
   * output still goes to stdout) to this file path instead of stdout.
   * Parent dirs are created if they don't exist.
   */
  outputFile?: string;
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
  if (process.env.SOLID_QUIET === '1' || process.env.SOLID_QUIET === 'true') return true;
  // --no-spinner / --raw are documented aliases (audit #3): same effect as
  // --quiet for the spinner but more discoverable names. Detected via argv
  // here so subcommands don't each need to thread the flag manually.
  if (process.argv.includes('--no-spinner') || process.argv.includes('--raw')) return true;
  return false;
}

// Global hints set by the root program BEFORE parsing, so subcommands
// don't each need to wire these flags through their action() signatures.
// Captured here and exported so commands can read them without coupling
// to the argv shape.
let globalOutputFile: string | null = null;
let globalListFormat: string | null = null;
let globalListSortBy: string | null = null;
let globalListOrder: string | null = null;

export function setOutputFile(path: string | null): void { globalOutputFile = path; }
export function getOutputFile(): string | null { return globalOutputFile; }
export function setListFormat(fmt: string | null): void { globalListFormat = fmt; }
export function getListFormat(): string | null { return globalListFormat; }
export function setListSortBy(field: string | null): void { globalListSortBy = field; }
export function getListSortBy(): string | null { return globalListSortBy; }
export function setListOrder(order: string | null): void { globalListOrder = (order === 'desc' ? 'desc' : 'asc'); }
export function getListOrder(): 'asc' | 'desc' { return globalListOrder === 'desc' ? 'desc' : 'asc'; }

/**
 * One-call migration helper for "list" commands that want the full
 * contract: --limit, --offset, --all, --quiet, --json, --sort-by,
 * --order, --format csv|tsv, --output <file>.
 *
 * The caller provides:
 *   - fetch(offset, limit): hits the backend, returns an opaque page body
 *   - extract(body): pulls the Record<string, unknown>[] list out
 *   - render(items): pretty-prints when neither --json nor --format is set
 *
 * Behaviors wired in for you:
 *   - auth guard
 *   - spinner on stderr (stopped in --quiet)
 *   - single-page vs --all (via fetchAllPages)
 *   - applyListSort (--sort-by, --order)
 *   - renderDelimited (--format csv|tsv)
 *   - JSON to stdout or file (run() handles --output)
 *   - errorText + exit 1 on failure
 */
export async function runListCommand(
  opts: ListFlags,
  spec: {
    fetch: (offset: number, limit: number) => Promise<unknown>;
    extract: (page: unknown) => Array<Record<string, unknown>>;
    render: (items: Array<Record<string, unknown>>) => void;
    spinnerText?: string;
    errorText?: string;
  },
): Promise<void> {
  const asJson = (await import('./json-output')).isJsonOutput(opts) || Boolean(getOutputFile());

  await run<{ items: Array<Record<string, unknown>>; count: number }>(
    async () => {
      const items = opts.all
        ? await fetchAllPages(spec.fetch, spec.extract, { limit: 100 })
        : spec.extract(await spec.fetch(parseInt(opts.offset, 10), parseInt(opts.limit, 10)));
      // Sort HERE, before the result is returned — so --json, --format csv,
      // and the pretty renderer all see the same ordering. Prior impl only
      // sorted inside `render`, which --json skipped.
      applyListSort(items);
      return { items, count: items.length };
    },
    {
      spinner: asJson || opts.quiet ? null : (spec.spinnerText || 'Loading...'),
      errorText: spec.errorText || 'Failed',
      quiet: opts.quiet,
      json: asJson,
      render: ({ items }) => {
        const fmt = getListFormat();
        if (fmt === 'csv' || fmt === 'tsv') {
          process.stdout.write(renderDelimited(items, fmt));
          return;
        }
        spec.render(items);
      },
    },
  );
}

/**
 * Render an array of records as CSV or TSV. Row 0 is the header — union
 * of all keys across items so sparse rows still line up. Values are CSV-
 * escaped (quotes doubled, embedded quote/comma/newline triggers quoting).
 */
export function renderDelimited(items: Array<Record<string, unknown>>, format: 'csv' | 'tsv'): string {
  if (!items.length) return '';
  const delim = format === 'tsv' ? '\t' : ',';
  const cols = Array.from(items.reduce<Set<string>>((acc, item) => {
    Object.keys(item).forEach((k) => acc.add(k));
    return acc;
  }, new Set()));
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    if (format === 'csv' && /[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    if (format === 'tsv') return s.replace(/\t/g, ' ').replace(/\n/g, ' ');
    return s;
  };
  const rows = [cols.join(delim), ...items.map((item) => cols.map((c) => esc(item[c])).join(delim))];
  return rows.join('\n') + '\n';
}

/**
 * Shared options for list commands. Every list command that wants the
 * full scripting contract accepts these — wire via `applyListOptions`.
 */
export interface ListFlags {
  limit: string;
  offset: string;
  all?: boolean;
  quiet?: boolean;
  json?: boolean;
}

/**
 * Drop the standard list-command flag set onto a commander Command.
 * Returns the same command for chaining. Call this instead of writing
 * the five .option() lines by hand so defaults stay consistent.
 *
 * Uses a structural type so we can accept commander's Command without
 * importing its generic signature soup into this shared helper.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withListFlags<T extends { option: (...args: any[]) => T }>(cmd: T, defaultLimit = '50'): T {
  return cmd
    .option('-l, --limit <n>', 'Page size', defaultLimit)
    .option('--offset <n>', 'Pagination offset', '0')
    .option('--all', 'Auto-paginate every page')
    .option('--quiet', 'Suppress spinner + success chrome')
    .option('--json', 'Output as JSON');
}

/**
 * Apply global --sort-by / --order to an array in place (returns the
 * same array). Does nothing if no sort hint is set.
 */
export function applyListSort<T extends Record<string, unknown>>(items: T[]): T[] {
  const field = getListSortBy();
  if (!field) return items;
  const order = getListOrder();
  items.sort((a, b) => {
    const av = a[field], bv = b[field];
    if (av === bv) return 0;
    if (av === undefined || av === null) return 1;
    if (bv === undefined || bv === null) return -1;
    // numeric if both numeric-ish
    const an = Number(av), bn = Number(bv);
    if (!Number.isNaN(an) && !Number.isNaN(bn)) {
      return order === 'desc' ? bn - an : an - bn;
    }
    return order === 'desc'
      ? String(bv).localeCompare(String(av))
      : String(av).localeCompare(String(bv));
  });
  return items;
}

/**
 * Auto-paginate a backend list endpoint.
 *
 * Calls `fetchPage(offset, limit)` with a rising offset until the page
 * returns fewer items than requested (the standard terminator for our
 * offset-based APIs). Returns the concatenated item array.
 *
 * Safety caps:
 *   - `maxPages` (default 40) prevents runaway loops if the server lies
 *     about page sizes.
 *   - `limit` (default 100) keeps each request small enough to stream.
 *
 * `extract` is run on every page's response; if your endpoint nests the
 * list under a key other than `items`, pass a custom extractor.
 */
export async function fetchAllPages<TItem, TPage>(
  fetchPage: (offset: number, limit: number) => Promise<TPage>,
  extract: (page: TPage) => TItem[],
  options: { limit?: number; maxPages?: number } = {},
): Promise<TItem[]> {
  const limit = options.limit ?? 100;
  const maxPages = options.maxPages ?? 40;
  const all: TItem[] = [];
  let offset = 0;
  for (let page = 0; page < maxPages; page++) {
    const body = await fetchPage(offset, limit);
    const items = extract(body) || [];
    all.push(...items);
    if (items.length < limit) break;
    offset += limit;
  }
  return all;
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
      const payload = JSON.stringify(result, null, 2);
      const targetFile = options.outputFile || globalOutputFile;
      if (targetFile) {
        const fs = await import('fs');
        const path = await import('path');
        fs.mkdirSync(path.dirname(path.resolve(targetFile)), { recursive: true });
        fs.writeFileSync(targetFile, payload);
        if (!quiet) console.error(chalk.green(`  Wrote ${payload.length} bytes to ${targetFile}`));
      } else {
        // Only the JSON lands on stdout — no other output path touches it.
        console.log(payload);
      }
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
