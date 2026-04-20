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

// ===========================================================================
// T1.2 — Dry-run existence verification
// ===========================================================================
//
// The T11.2 dry-run interceptor short-circuits mutations and synthesizes
// success. That lied when the resource didn't exist: `solid pages update
// 99999 --dry-run` would report synthetic success for an ID that 404s.
//
// Closing that lie: before short-circuiting, issue a GET against the
// resource's existence URL. If it 404s, surface NOT_FOUND. If 200, proceed
// with the synthetic success. Routes that are not resource-targeted
// (collection POSTs, action endpoints) skip verification entirely and
// retain the previous behavior.
//
// Pure — no HTTP here, just URL derivation. Actual GET is done in
// api-client.ts's request interceptor.

/** Methods whose dry-run is verifiable via a GET on the same URL. */
const EXISTENCE_VERIFIABLE_METHODS: ReadonlySet<string> = new Set([
  'PATCH',
  'PUT',
  'DELETE',
]);

/** Last-segment tokens that indicate an ACTION endpoint, not a resource.
 * These tail the URL but aren't IDs, e.g. /api/v1/cms/pages/42/publish.
 * A GET on such a URL would 404 or 405 — not a useful existence check. */
const ACTION_SUFFIXES: ReadonlySet<string> = new Set([
  'publish',
  'unpublish',
  'preview',
  'discard',
  'approve',
  'reject',
  'cancel',
  'retry',
  'send',
  'rotate',
  'revoke',
  'restore',
  'enable',
  'disable',
  'lock',
  'unlock',
  'verify',
  'deploy',
  'run',
  'execute',
  'test',
  'sync',
]);

/**
 * Derive the GET URL to verify existence before a dry-run mutation.
 * Returns null when the mutation is not existence-verifiable:
 *   - Non-mutating method (GET/HEAD/OPTIONS)
 *   - POST (creating; nothing to verify)
 *   - Collection URL (no trailing ID segment)
 *   - Action endpoint (trailing /publish, /send, etc.)
 *
 * Pure function — no I/O. Unit-tested directly.
 */
export function deriveExistenceGet(
  method: string | undefined,
  url: string | undefined,
): string | null {
  if (!method || !url) return null;
  if (!EXISTENCE_VERIFIABLE_METHODS.has(method.toUpperCase())) return null;

  // Separate path from query string — preserve query on the derived GET.
  const qIdx = url.indexOf('?');
  const pathOnly = qIdx >= 0 ? url.slice(0, qIdx) : url;
  const query = qIdx >= 0 ? url.slice(qIdx) : '';

  const segments = pathOnly.split('/').filter(Boolean);
  if (segments.length < 2) return null; // too shallow to have an ID

  const last = segments[segments.length - 1];

  // Last segment must LOOK like an ID (numeric, uuid, slug, etc.).
  // Empty, pure-alpha collection names, or pure-action suffixes are rejected.
  if (!/^[A-Za-z0-9_\-.:@]+$/.test(last)) return null;

  // Action endpoints don't have a GET shape at the same URL.
  if (ACTION_SUFFIXES.has(last.toLowerCase())) return null;

  // All-alpha AND short AND not a recognizable ID-ish value → likely a
  // collection endpoint (e.g. /api/v1/leads). Require at least one digit,
  // or a length > 24 (uuid-ish), or a dot/dash/underscore (slug-ish).
  const looksLikeId =
    /\d/.test(last) ||
    last.length > 24 ||
    /[-_.:]/.test(last);
  if (!looksLikeId) return null;

  return pathOnly + query;
}
