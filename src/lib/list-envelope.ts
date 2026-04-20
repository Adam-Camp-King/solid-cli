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
 * Apply the normalization in-place on a response body, adding the
 * aliased keys without removing existing ones. Returns the body back
 * for easy chaining in the axios response interceptor.
 *
 * No-op when:
 *  - body is not a list envelope
 *  - body already has `items` (then we just ensure `total` is present)
 *  - SOLID_LEGACY_LIST_SHAPES is truthy
 *
 * Pure wrt env: caller can pass its own env map for tests.
 */
export function applyListEnvelope<T>(
  body: T,
  env?: NodeJS.ProcessEnv,
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
  return body;
}
