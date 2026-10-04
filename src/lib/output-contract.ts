/**
 * What a verb hands back, read off its published `output_schema`. Pure.
 *
 * The backend marks where a schema came from in `x-solid-derivation`:
 *   proven-from-return-paths       every return path of the handler was read, so
 *                                  `required` is true of every result
 *   inferred-from-return-literals  keys worth looking for; none is promised
 *   (absent)                       the verb's author declared it
 * An agent plans its next call on the keys of a result that worked, so that is
 * what `returns` names — and it says which of the three it is reading.
 */
export interface OutputSchema {
  properties?: Record<string, { type?: string | string[] }>;
  required?: string[];
  anyOf?: Array<{ title?: string; required?: string[] }>;
  'x-solid-derivation'?: string;
}

export interface Returns {
  /** proven: read from every return path · declared: stated by the author · hint: keys seen in source, none promised. */
  basis: 'proven' | 'declared' | 'hint';
  /** Keys on every result, a refusal included. */
  always: string[];
  /** Keys on every result that worked. Same as `always` when the verb has no failure return. */
  when_it_worked: string[];
  /** Keys on a result that did not work, when the handler returns one. */
  when_it_did_not?: string[];
  /** Other keys that may appear. */
  may_include: string[];
  /** key → JSON type, only where the source fixes it. */
  types: Record<string, string | string[]>;
}

export function returnsOf(schema: unknown): Returns | null {
  if (!schema || typeof schema !== 'object') return null;
  const s = schema as OutputSchema;
  const props = s.properties && typeof s.properties === 'object' ? s.properties : {};
  const keys = Object.keys(props);
  if (!keys.length && !(s.required || []).length) return null;
  const marker = s['x-solid-derivation'];
  const basis: Returns['basis'] = marker === 'proven-from-return-paths' ? 'proven'
    : marker ? 'hint' : 'declared';
  const always = basis === 'hint' ? [] : [...(s.required || [])];
  const branch = (title: string) => (s.anyOf || []).find((b) => b.title === title)?.required;
  const worked = basis === 'hint' ? [] : [...(branch('worked') || always)];
  const didNot = basis === 'hint' ? undefined : branch('did not');
  const named = new Set([...always, ...worked, ...(didNot || [])]);
  const types: Returns['types'] = {};
  for (const k of keys) {
    const t = props[k]?.type;
    if (t) types[k] = t;
  }
  return {
    basis, always, when_it_worked: worked,
    ...(didNot ? { when_it_did_not: [...didNot] } : {}),
    may_include: keys.filter((k) => !named.has(k)).sort(),
    types,
  };
}

/**
 * Make hidden own keys visible again.
 *
 * The response interceptor moves a list onto `items` and hides the server's own key
 * (`journeys`, `drafts`) from JSON output — right for a command, which was told to read
 * `items`. A verb's result is different: its `output_schema` names the server's key, so
 * `verbs invoke` printing only `items` hands back a shape the schema never mentioned.
 */
export function revealHiddenKeys<T>(body: T): T {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  for (const k of Object.getOwnPropertyNames(body)) {
    const d = Object.getOwnPropertyDescriptor(body, k);
    if (d && !d.enumerable && d.configurable) Object.defineProperty(body, k, { ...d, enumerable: true });
  }
  return body;
}

const RECEIPT_REF = /^rcp_[a-f0-9]{8,40}$/;

/**
 * The handle of the receipt a call left, from the `X-Solid-Receipt` response header.
 * Present on a result and on a refusal. Anything that is not a well-formed handle is
 * ignored, never printed.
 */
export function receiptRefOf(headers: unknown): string | null {
  if (!headers || typeof headers !== 'object') return null;
  const h = headers as Record<string, unknown> & { get?: (k: string) => unknown };
  const raw = typeof h.get === 'function' ? h.get('x-solid-receipt') : (h['x-solid-receipt'] ?? h['X-Solid-Receipt']);
  return typeof raw === 'string' && RECEIPT_REF.test(raw) ? raw : null;
}

/**
 * The verbs an agent should meet first, then everything else by name. Pure, stable.
 *
 * The catalog is sorted by name, so the first page was `accounting_connection.*` through
 * `analytics.*`. The backend marks the verbs its connector hands an AI as tools
 * (`first_page`: "core" for the everyday set, "curated" for the rest); those lead.
 * A backend that publishes no marker leaves the order exactly as it was.
 */
export function frontPageOrder<T extends { name: string; first_page?: string | null }>(verbs: T[]): T[] {
  const rank = (v: T) => (v.first_page === 'core' ? 0 : v.first_page === 'curated' ? 1 : 2);
  return verbs
    .map((v, i) => ({ v, i }))
    .sort((a, b) => rank(a.v) - rank(b.v) || a.i - b.i)
    .map((x) => x.v);
}
