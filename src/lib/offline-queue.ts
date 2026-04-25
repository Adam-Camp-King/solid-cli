/**
 * Offline mutation queue (A+.6).
 *
 * Closes the offline symmetry: read side is fully offline via
 * `.claude/solid-context.jsonld`, write side now also works without
 * a live backend. Field agents, travel, air-gapped demos.
 *
 * Activation (any of, checked in order):
 *   1. CLI flag:   --queue        (set at program level via setQueueMode)
 *   2. Env var:    SOLID_OFFLINE_QUEUE=1
 *   3. Runtime:    setQueueMode(true)
 *
 * Behavior when on:
 *   - GET requests pass through unchanged (read side never queues)
 *   - Mutations (POST/PUT/PATCH/DELETE) are written to
 *     `.solid/queue/<utc>-<uuid>.jsonld` and the call returns a
 *     synthetic success carrying the queue file path.
 *
 * Replaying:
 *   - `solid push --flush` reads every file under `.solid/queue/`,
 *     replays each mutation in chronological order with its
 *     idempotency key, deletes on success, leaves on failure.
 *
 * File format (one mutation per file):
 *
 *   {
 *     "@context": { ... ai-context vocab ... },
 *     "@id": "urn:solid:queued:<uuid>",
 *     "@type": ["solid:QueuedMutation"],
 *     "method": "POST",
 *     "url": "/api/v1/kb",
 *     "body": { ... },
 *     "idempotencyKey": "<uuid>",
 *     "queuedAt": "2026-04-25T12:34:56.789Z",
 *     "cliVersion": "1.23.0"
 *   }
 *
 * The file IS a JSON-LD document so `solid graph --offline` over the
 * queue directory could walk what's pending — useful for the eventual
 * conflict-resolution UX in v1.1.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import chalk from 'chalk';

let enabled = false;
let bannerShown = false;

export function setQueueMode(on: boolean): void {
  enabled = Boolean(on);
}

export function isQueueMode(): boolean {
  if (process.env.SOLID_OFFLINE_QUEUE && /^(1|true|yes|on)$/i.test(process.env.SOLID_OFFLINE_QUEUE)) {
    return true;
  }
  return enabled;
}

export function activateQueueModeIfRequested(argv: string[]): void {
  // The flag is `--queue` (singular). `--offline` already means
  // something different on `solid graph` (read from local file). We
  // keep the namespaces separate so a user passing `--offline` to
  // graph doesn't accidentally arm queue mode.
  const hasFlag = argv.includes('--queue');
  if (hasFlag || isQueueMode()) {
    setQueueMode(true);
    showBanner();
  }
}

function showBanner(): void {
  if (bannerShown) return;
  bannerShown = true;
  process.stderr.write(
    chalk.cyan.bold('\n📥 [QUEUE]') +
      chalk.cyan(' Offline mode — mutations are written to .solid/queue/ instead of sent.\n') +
      chalk.dim('    Replay later with: solid push --flush\n\n'),
  );
}


// ---------------------------------------------------------------------------
// Queue file format + storage
// ---------------------------------------------------------------------------

export interface QueuedMutation {
  '@context': Record<string, unknown>;
  '@id': string;
  '@type': string[];
  method: string;
  url: string;
  body?: unknown;
  idempotencyKey: string;
  queuedAt: string;  // ISO 8601
  cliVersion?: string;
}

const QUEUE_DIR_NAME = '.solid/queue';

export function queueDir(cwd: string = process.cwd()): string {
  return path.join(cwd, QUEUE_DIR_NAME);
}

function ensureQueueDir(cwd: string = process.cwd()): string {
  const dir = queueDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeUuid(): string {
  // randomUUID is on Node 14.17+. We require Node >= 20 (engines.node)
  // so this is always available.
  return crypto.randomUUID();
}


// ---------------------------------------------------------------------------
// Write — called by the api-client interceptor when isQueueMode() is true.
// ---------------------------------------------------------------------------

export interface QueueWriteResult {
  /** Absolute path to the queue file. */
  path: string;
  /** The serialized queued mutation. */
  mutation: QueuedMutation;
}

export function enqueue(
  method: string,
  url: string,
  body: unknown,
  opts: { cwd?: string; cliVersion?: string } = {},
): QueueWriteResult {
  const dir = ensureQueueDir(opts.cwd);

  const idempotencyKey = makeUuid();
  const queuedAt = new Date().toISOString();
  const id = `urn:solid:queued:${idempotencyKey}`;

  // Lazy-import the vocab so this module stays usable in environments
  // where the JSON-LD context isn't loaded (e.g., direct unit tests).
  // The @context is informational on the wire; replay reads only the
  // method/url/body/idempotencyKey fields.
  const ctx: Record<string, unknown> = {
    '@version': 1.1,
    schema: 'http://schema.org/',
    solid: 'https://solidnumber.com/vocab#',
  };

  const mutation: QueuedMutation = {
    '@context': ctx,
    '@id': id,
    '@type': ['solid:QueuedMutation'],
    method: method.toUpperCase(),
    url,
    body,
    idempotencyKey,
    queuedAt,
    cliVersion: opts.cliVersion,
  };

  // Filename: <utc>-<uuid>.jsonld so directory listing is naturally
  // chronological. UTC compact form (no `:` for filesystem safety).
  const utc = queuedAt.replace(/[:.]/g, '-');
  const filename = `${utc}-${idempotencyKey}.jsonld`;
  const filepath = path.join(dir, filename);
  fs.writeFileSync(filepath, JSON.stringify(mutation, null, 2));

  process.stderr.write(
    `${chalk.cyan('[QUEUE]')} ${chalk.cyan(method.toUpperCase().padEnd(6))} ${url} ${chalk.dim('→')} ${chalk.dim(path.relative(opts.cwd ?? process.cwd(), filepath))}\n`,
  );

  return { path: filepath, mutation };
}


// ---------------------------------------------------------------------------
// Read — for `solid push --flush`.
// ---------------------------------------------------------------------------

/**
 * Return every queued mutation, sorted chronologically by `queuedAt`.
 * Files that fail to parse are skipped with a warning to stderr (we
 * never fail-fast on the queue; one bad file shouldn't block the
 * rest from replaying).
 */
export function readQueue(cwd: string = process.cwd()): Array<{ path: string; mutation: QueuedMutation }> {
  const dir = queueDir(cwd);
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonld'));
  const out: Array<{ path: string; mutation: QueuedMutation }> = [];
  for (const f of entries) {
    const p = path.join(dir, f);
    try {
      const raw = fs.readFileSync(p, 'utf-8');
      const parsed = JSON.parse(raw) as QueuedMutation;
      if (parsed && typeof parsed === 'object' && parsed.method && parsed.url) {
        out.push({ path: p, mutation: parsed });
      } else {
        process.stderr.write(chalk.yellow(`[QUEUE] skipping malformed file: ${f}\n`));
      }
    } catch (err) {
      process.stderr.write(chalk.yellow(`[QUEUE] skipping unreadable file: ${f}: ${(err as Error).message}\n`));
    }
  }
  out.sort((a, b) => a.mutation.queuedAt.localeCompare(b.mutation.queuedAt));
  return out;
}

/** Remove a queued mutation file from disk (called after successful replay). */
export function deleteQueued(filepath: string): void {
  try {
    fs.unlinkSync(filepath);
  } catch {
    // Already gone — fine.
  }
}

/** Total queue size — surfaced by `solid push --flush --dry-run` etc. */
export function queueSize(cwd: string = process.cwd()): number {
  const dir = queueDir(cwd);
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonld')).length;
}


// ---------------------------------------------------------------------------
// A+.6b — Auto-flush after a successful mutation.
//
// When the CLI proves connectivity (a mutation just succeeded), drain
// any pending offline queue silently. This is the "holy shit" moment:
// user lost wifi mid-flight, kept working, regains wifi, the next
// successful mutation triggers everything they queued to land in
// chronological order without them lifting a finger.
//
// Best-effort: a failure on one queued mutation leaves it in the queue
// (next attempt picks it up), but every other queued mutation still
// gets a chance. We use a guard flag so the auto-flush itself doesn't
// recurse — when each replay fires through the response interceptor,
// the guard suppresses inner auto-flush attempts.
// ---------------------------------------------------------------------------
let _autoFlushInFlight = false;

export function isAutoFlushInProgress(): boolean {
  return _autoFlushInFlight;
}

export interface AutoFlushStats {
  succeeded: number;
  failed: number;
  total: number;
}

/** Replay every queued mutation using the supplied dispatcher.
 *  The dispatcher is injected so this module stays free of axios. */
export async function autoFlushQueue(
  dispatch: (method: string, url: string, body: unknown) => Promise<void>,
  cwd: string = process.cwd(),
): Promise<AutoFlushStats> {
  if (_autoFlushInFlight) return { succeeded: 0, failed: 0, total: 0 };
  const items = readQueue(cwd);
  if (items.length === 0) return { succeeded: 0, failed: 0, total: 0 };

  _autoFlushInFlight = true;
  let succeeded = 0;
  let failed = 0;
  try {
    for (const { path: filepath, mutation } of items) {
      try {
        await dispatch(mutation.method, mutation.url, mutation.body);
        deleteQueued(filepath);
        succeeded++;
      } catch {
        // Leave file in queue for the next attempt.
        failed++;
      }
    }
  } finally {
    _autoFlushInFlight = false;
  }
  return { succeeded, failed, total: items.length };
}
