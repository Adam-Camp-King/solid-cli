/**
 * List-envelope normalization (Sprint 1 T1.4).
 *
 * Backend list endpoints return an inconsistent bag of keys:
 *   { pages: [...], total: N }
 *   { results: [...] }
 *   { logs: [...], has_more: true }
 *   { agents: [...] }
 *   { api_keys: [...] }
 *   { items: [...] }
 *   ...
 *
 * That's fine for humans but forces agents to write `d.pages || d.items
 * || d.results || d.logs || ...` fallbacks before they can loop. This
 * module adds a stable `.items` alias + `total / page / has_more`
 * siblings on every response whose body looks like a list envelope.
 * Original keys are preserved so existing callers never break.
 *
 * Pure — no HTTP, no axios. Wired into the response interceptor in
 * api-client.ts; unit-tested with synthetic inputs.
 *
 * Opt-out: `SOLID_LEGACY_LIST_SHAPES=1` disables normalization for one
 * minor release while consumers migrate (per T1.7 two-step rollout).
 */

/**
 * Keys backend responses use to expose a list of rows, in preference
 * order. The FIRST key found on the response body whose value is an
 * array is promoted to `.items`. Order matters: when multiple keys
 * coexist (rare), the earlier one wins.
 */
export const KNOWN_LIST_KEYS: readonly string[] = [
  // Already canonical — nothing to alias.
  'items',
  // CMS / CRM / commerce
  'pages',
  'results',
  'leads',
  'agents',
  'templates',
  'companies',
  'sites',
  'api_keys',
  'logs',
  'rows',
  'records',
  'entries',
  'products',
  'services',
  'contacts',
  'customers',
  'orders',
  'invoices',
  'transactions',
  'webhooks',
  'chains',
  'flows',
  'modules',
  'domains',
];

/**
 * Array-valued keys that are diagnostics channels, never the payload. Without
 * this, a response like {status:'ok', errors:[]} would alias `errors` to
 * `items` and an agent would read the error channel as the result set.
 */
const NON_LIST_ARRAY_KEYS = new Set<string>([
  'errors',
  'warnings',
  'messages',
  'hints',
  'notices',
  'validation_errors',
]);

export interface NormalizedEnvelope {
  items: unknown[];
  total: number | null;
  page: number | string | null;
  has_more: boolean | null;
  /** Which source key the alias came from ("items" when already canonical). */
  _source_key: string | null;
}

/** Truthy values for the SOLID_LEGACY_LIST_SHAPES opt-out. */
export function legacyListShapesEnabled(env?: NodeJS.ProcessEnv): boolean {
  const v = (env ?? process.env).SOLID_LEGACY_LIST_SHAPES;
  return typeof v === 'string' && /^(1|true|yes|on)$/i.test(v);
}

/**
 * Detect which known list key (if any) holds the array payload.
 * Returns null when the body is not shaped like a list response.
 * Pure.
 */
export function detectListKey(
  body: unknown,
  knownKeys: readonly string[] = KNOWN_LIST_KEYS,
): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  for (const k of knownKeys) {
    if (Array.isArray(record[k])) return k;
  }

  // Fallback: exactly one array-valued property IS the list, whatever it's
  // called. A hardcoded roster will always trail the API — `forms`,
  // `submissions` and `deals` were all missing, so those commands silently
  // stayed un-normalized and agents had to special-case them. Only applied
  // for the default roster, so an explicit `knownKeys` argument still means
  // "only these" (see the custom-key-list test).
  if (knownKeys === KNOWN_LIST_KEYS) {
    const arrayKeys = Object.keys(record).filter(
      (k) => Array.isArray(record[k]) && !NON_LIST_ARRAY_KEYS.has(k),
    );
    if (arrayKeys.length === 1) return arrayKeys[0];
  }
  return null;
}

function safeNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return null;
}

function safePage(v: unknown): number | string | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') return v;
  return null;
}

function safeBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  return null;
}

/**
 * Produce a canonical {items, total, page, has_more} view of a list
 * response. Returns null when the body isn't a list envelope, so callers
 * can short-circuit without mutating.
 */
export function normalizeListEnvelope(body: unknown): NormalizedEnvelope | null {
  const key = detectListKey(body);
  if (!key) return null;
  const record = body as Record<string, unknown>;
  const items = (record[key] as unknown[]) ?? [];
  const total =
    safeNumber(record.total) ??
    safeNumber(record.count) ??
    items.length;
  const page =
    safePage(record.page) ??
    safePage(record.cursor) ??
    safePage(record.next_cursor) ??
    null;
  const has_more =
    safeBool(record.has_more) ?? safeBool(record.hasMore) ?? null;
  return {
    items,
    total,
    page,
    has_more,
    _source_key: key,
  };
}

/**
 * Apply the normalization in-place on a response body: promote the rows to
 * `items`, add `total / page / has_more`, and DROP the source key.
 *
 * ⛔ T1.7 STEP TWO. Step one aliased the rows to `items` and kept the original
 * key so existing callers would not break. Step two — dropping it — never
 * landed, and every list response has carried both ever since: `solid find`
 * was 49% duplicate bytes, `solid where` about half the Gazetteer, on reads an
 * agent makes constantly.
 *
 * The compatibility being protected is agents, which re-read the schema on
 * every call and do not hold a cached shape between them. Paying ~2x on every
 * list forever to protect a consumer that does not exist is the wrong trade —
 * particularly in a repo that took context from 27,369 tokens to 177.
 *
 * `SOLID_LEGACY_LIST_SHAPES=1` restores the old shape entirely (no `items`,
 * no dropping) for anything that genuinely pinned a source key.
 *
 * No-op when:
 *  - body is not a list envelope
 *  - the source key IS `items` (nothing to drop)
 *  - SOLID_LEGACY_LIST_SHAPES is truthy
 *
 * Pure wrt env: caller can pass its own env map for tests.
 */
export function applyListEnvelope<T>(
  body: T,
  env?: NodeJS.ProcessEnv,
  opts?: { hideSourceKey?: boolean },
): T {
  if (legacyListShapesEnabled(env)) return body;
  const normalized = normalizeListEnvelope(body);
  if (!normalized) return body;
  const record = body as unknown as Record<string, unknown>;

  // Only fill in what's missing; never clobber a caller-supplied field.
  if (!('items' in record) || record.items === undefined) {
    record.items = normalized.items;
  }
  if (!('total' in record) || record.total === undefined || record.total === null) {
    record.total = normalized.total;
  }
  if (!('page' in record) || record.page === undefined) {
    record.page = normalized.page;
  }
  if (!('has_more' in record) || record.has_more === undefined) {
    record.has_more = normalized.has_more;
  }

  // ⛔ Drop the source key now its rows live on `items` — the half of T1.7
  // that never shipped. Only when `items` actually holds THESE rows: if a
  // caller supplied its own `items`, the source key is different data and
  // removing it would lose rows rather than duplicate them.
  // ⛔ HIDE THE SOURCE KEY, DO NOT DELETE IT.
  //
  // Deleting is what step two was supposed to do, and it breaks the CLI's own
  // commands: 20 files read their source key straight off the response —
  // `solid where` does `(res.data as {places?: Place[]}).places || []` — so a
  // delete turned the Gazetteer into `count: 0, items: []`. That is almost
  // certainly why step two never landed.
  //
  // Non-enumerable gets the whole byte win with none of that risk:
  // JSON.stringify skips non-enumerable properties, so the duplicate rows
  // leave the wire entirely, while `d.places` still resolves for every
  // internal caller. Those can migrate to `.items` on their own schedule, and
  // this stops costing anything the moment they do.
  // ⛔ ONLY for backend responses (the axios interceptor), never for a
  // command's own payload.
  //
  // A backend key IS a duplicate alias: `items` carries the same rows and the
  // caller was told to read `items`. A command's payload is different — it
  // declares its own shape next to a versioned `schema:` tag, and
  // `solid verbs list` promising `verbs` is a contract, not an accident.
  // Hiding both indiscriminately silently rewrote ~20 declared schemas, which
  // is a breaking change wearing a byte-saving costume.
  const sourceKey = normalized._source_key;
  if (opts?.hideSourceKey && sourceKey && sourceKey !== 'items' && record.items === normalized.items) {
    Object.defineProperty(record, sourceKey, {
      value: record[sourceKey],
      enumerable: false,   // <- invisible to JSON.stringify and Object.keys
      writable: true,
      configurable: true,
    });
  }
  return body;
}
