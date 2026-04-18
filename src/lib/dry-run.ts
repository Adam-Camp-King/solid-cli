/**
 * Global dry-run plumbing (T11.2).
 *
 * Every mutation the CLI issues goes through `apiClient.{post,put,patch,delete}`.
 * When dry-run is on, we short-circuit at the request-interceptor layer:
 * NO network call is made. Instead we return a synthetic response that
 * describes what would have happened, and the command's success-path
 * prints the normal UI the user expects (so they can eyeball intent).
 *
 * How to turn it on (any of these, checked in order):
 *   1. CLI flag:  --dry-run   (applied at program level in index.ts)
 *   2. Env var:   SOLID_DRY_RUN=1
 *   3. Runtime:   setDryRun(true) from an action handler
 *
 * The flag is sticky for the lifetime of the process. Read commands
 * (GET) are NEVER affected — dry-run only gates mutations.
 *
 * Output channels:
 *   - stderr gets the "[DRY RUN]" banner once per process
 *   - every intercepted call prints a one-line summary to stderr
 *   - the handler's own success output runs as if the mutation succeeded
 */
import chalk from 'chalk';

let enabled = false;
let bannerShown = false;
const actions: Array<{ method: string; url: string; body?: unknown; ts: string }> = [];

export function setDryRun(on: boolean): void {
  enabled = Boolean(on);
}

export function isDryRun(): boolean {
  // Re-check env var each call so tests can toggle via env.
  if (process.env.SOLID_DRY_RUN && /^(1|true|yes|on)$/i.test(process.env.SOLID_DRY_RUN)) {
    return true;
  }
  return enabled;
}

/**
 * Called once at program boot (from index.ts after argv parse) to flip
 * the flag and surface the banner. Idempotent.
 */
export function activateDryRunIfRequested(argv: string[]): void {
  const hasFlag = argv.includes('--dry-run') || argv.includes('--dryRun');
  if (hasFlag || isDryRun()) {
    setDryRun(true);
    showBanner();
  }
}

function showBanner(): void {
  if (bannerShown) return;
  bannerShown = true;
  // stderr so --json output to stdout stays clean
  process.stderr.write(
    chalk.yellow.bold('\n⚠️  [DRY RUN]') +
      chalk.yellow(' No mutations will reach the server. GET calls still run.\n') +
      chalk.dim('    Unset with: run again without --dry-run or export SOLID_DRY_RUN=0\n\n'),
  );
}

/**
 * The synthetic result shape an intercepted mutation returns. Mirrors
 * axios response shape so existing `.data.status / .data.id` consumers
 * don't blow up — they get sensible placeholders.
 */
export interface DryRunResult {
  dry_run: true;
  would: { method: string; url: string; body?: unknown };
  // Optimistic placeholders so `response.data.id`, `.status`, `.success`
  // don't crash the rendering code:
  id: string;
  status: 'dry_run';
  success: true;
  message: string;
}

export function makeDryRunResult(method: string, url: string, body?: unknown): DryRunResult {
  const ts = new Date().toISOString();
  actions.push({ method: method.toUpperCase(), url, body, ts });
  // One-line summary on stderr
  const bodyStr =
    body === undefined || body === null
      ? ''
      : typeof body === 'string'
        ? ` ${chalk.dim(body.slice(0, 120))}`
        : ` ${chalk.dim(truncate(JSON.stringify(body), 120))}`;
  process.stderr.write(
    `${chalk.yellow('[DRY]')} ${chalk.cyan(method.toUpperCase().padEnd(6))} ${url}${bodyStr}\n`,
  );
  return {
    dry_run: true,
    would: { method: method.toUpperCase(), url, body },
    id: `dry_run_${actions.length}`,
    status: 'dry_run',
    success: true,
    message: 'dry run — no changes made',
  };
}

/** Invoked at process end (optional) to print a summary. */
export function dryRunSummary(): string {
  if (!enabled || actions.length === 0) return '';
  const lines: string[] = [];
  lines.push('');
  lines.push(chalk.yellow.bold(`[DRY RUN] Summary — ${actions.length} mutation(s) skipped`));
  actions.forEach((a, i) => {
    lines.push(`  ${String(i + 1).padStart(2)}. ${chalk.cyan(a.method.padEnd(6))} ${a.url}`);
  });
  lines.push('');
  return lines.join('\n');
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
