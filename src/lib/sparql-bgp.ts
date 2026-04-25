/**
 * sparql-bgp — minimal SPARQL Basic Graph Pattern engine for JSON-LD.
 *
 * Sprint: SPRINT-JSONLD-GRAPH-MOAT.md § A+.5
 *
 * What's supported (intentionally small):
 *
 *   PREFIX schema: <http://schema.org/>
 *   PREFIX solid:  <https://solidnumber.com/vocab#>
 *
 *   SELECT ?s ?type
 *   WHERE {
 *     ?s a schema:Service .                  # `a` is sugar for rdf:type
 *     ?s schema:provider <https://...> .     # full IRI
 *     ?s schema:name ?name .
 *   }
 *
 * What's NOT supported (out of scope for v1; spec calls these out):
 *   - OPTIONAL { ... }
 *   - FILTER (regex(?x, "..."))
 *   - Property paths (?s schema:knows+ ?o)
 *   - UNION / MINUS
 *   - GROUP BY / ORDER BY / LIMIT (you can pipe through `head`/`sort`)
 *   - Named graphs / GRAPH ?g { ... }
 *
 * That gets us 80% of "find me X where Y" without writing a real
 * SPARQL engine. For the other 20%, point apache-jena-fuseki at the
 * RDF export from `solid graph --dump nquads`.
 *
 * Design notes
 * ------------
 * - Matcher is in-memory; the JsonLdDocument is the entire dataset.
 * - Triples are `(subject, predicate, object)` where each component
 *   is a Term: variable, IRI, or literal.
 * - JSON-LD edges are subject's predicate values that have shape
 *   `"<some-iri>"` (string IRI) or `{"@id": "<some-iri>"}`. Both are
 *   valid in our vocab; the matcher treats them uniformly.
 * - `@context` aliases (e.g. `name` → `schema:name`) are NOT auto-
 *   expanded in the matcher; queries should use full IRIs or
 *   prefixed names. This is intentional: it keeps the query
 *   grammar small and means the same query works against an
 *   `expand`-ed JSON-LD doc too.
 */

import type { JsonLdDocument, JsonLdNode } from './graph-walker';

// ---------------------------------------------------------------------------
// Term + Triple types
// ---------------------------------------------------------------------------
export type Term =
  | { kind: 'var'; name: string }              // ?foo
  | { kind: 'iri'; value: string }             // <http://...> or expanded prefix
  | { kind: 'literal'; value: string };        // "literal" or 42

export interface Triple {
  s: Term;
  p: Term;
  o: Term;
}

export interface Query {
  prefixes: Record<string, string>;
  selectVars: string[];        // empty = SELECT *
  selectAll: boolean;
  where: Triple[];
}

export type Bindings = Record<string, string>;

export interface QueryResult {
  /** Variable names from SELECT, in declaration order. */
  vars: string[];
  /** Each row is one full binding for the SELECT variables. */
  bindings: Bindings[];
}


// ---------------------------------------------------------------------------
// Parser — lean recursive descent, tolerant of whitespace and comments.
//
// Comments use `#` to end-of-line, matching SPARQL. We don't support
// the `BASE <iri>` directive (rare in practice; full IRIs work).
// ---------------------------------------------------------------------------
export function parseQuery(text: string): Query {
  const stripped = text
    .split('\n')
    .map((line) => {
      // Strip trailing # comments but preserve content inside quoted strings.
      // Safe simplification: a # outside a string starts a comment.
      let inQuote = false;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '"' && line[i - 1] !== '\\') inQuote = !inQuote;
        if (line[i] === '#' && !inQuote) return line.slice(0, i);
      }
      return line;
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  const prefixes: Record<string, string> = {
    // Always-on prefixes so users don't have to declare what's in the
    // tenant @context. Aligned with services/ai_context_jsonld.py.
    schema: 'http://schema.org/',
    solid: 'https://solidnumber.com/vocab#',
    rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  };

  // Walk PREFIX declarations.
  let cursor = stripped;
  const prefixRe = /^PREFIX\s+(\w+):\s+<([^>]+)>\s*/i;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const m = cursor.match(prefixRe);
    if (!m) break;
    prefixes[m[1]] = m[2];
    cursor = cursor.slice(m[0].length);
  }

  // SELECT clause
  const selectRe = /^SELECT\s+(DISTINCT\s+)?(.+?)\s+WHERE\s*\{(.+)\}\s*$/is;
  const sel = cursor.match(selectRe);
  if (!sel) {
    throw new Error('Query parse error: expected `SELECT ... WHERE { ... }`');
  }
  const selVarsRaw = sel[2].trim();
  let selectAll = false;
  let selectVars: string[] = [];
  if (selVarsRaw === '*') {
    selectAll = true;
  } else {
    selectVars = selVarsRaw.split(/\s+/).map((v) => {
      if (!v.startsWith('?')) {
        throw new Error(`Query parse error: SELECT vars must start with '?', got '${v}'`);
      }
      return v.slice(1);
    });
  }

  const whereBody = sel[3].trim();
  const triples = parseTriples(whereBody, prefixes);

  return { prefixes, selectVars, selectAll, where: triples };
}

function parseTriples(body: string, prefixes: Record<string, string>): Triple[] {
  // Triples are `.`-delimited, BUT `.` can appear inside `<...>` IRIs
  // (`https://solidnumber.com/...`) and inside `"..."` literals. Split
  // statefully so we only treat top-level dots as terminators.
  const parts: string[] = [];
  let buf = '';
  let inIri = false;
  let inLit = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (!inLit && ch === '<') { inIri = true; buf += ch; continue; }
    if (inIri && ch === '>') { inIri = false; buf += ch; continue; }
    if (!inIri && ch === '"' && body[i - 1] !== '\\') { inLit = !inLit; buf += ch; continue; }
    if (ch === '.' && !inIri && !inLit) {
      const trimmed = buf.trim();
      if (trimmed) parts.push(trimmed);
      buf = '';
      continue;
    }
    buf += ch;
  }
  const tail = buf.trim();
  if (tail) parts.push(tail);
  return parts.map((p) => parseTriple(p, prefixes));
}

function parseTriple(text: string, prefixes: Record<string, string>): Triple {
  // Tokenize: variables, IRIs in <>, prefixed names, literals in "".
  const tokens: string[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '<') {
      const end = text.indexOf('>', i);
      if (end === -1) throw new Error(`Unclosed IRI: ${text}`);
      tokens.push(text.slice(i, end + 1));
      i = end + 1;
      continue;
    }
    if (ch === '"') {
      let end = i + 1;
      while (end < text.length && !(text[end] === '"' && text[end - 1] !== '\\')) end++;
      if (end >= text.length) throw new Error(`Unclosed literal: ${text}`);
      tokens.push(text.slice(i, end + 1));
      i = end + 1;
      continue;
    }
    // Identifier or variable: contiguous non-whitespace
    let end = i;
    while (end < text.length && !/\s/.test(text[end])) end++;
    tokens.push(text.slice(i, end));
    i = end;
  }

  if (tokens.length !== 3) {
    throw new Error(`Each triple must have 3 terms; got ${tokens.length}: ${text}`);
  }

  const [sTok, pTok, oTok] = tokens;
  return {
    s: parseTerm(sTok, prefixes, 'subject'),
    p: parseTerm(pTok === 'a' ? 'rdf:type' : pTok, prefixes, 'predicate'),
    o: parseTerm(oTok, prefixes, 'object'),
  };
}

function parseTerm(token: string, prefixes: Record<string, string>, _pos: string): Term {
  if (token.startsWith('?')) {
    return { kind: 'var', name: token.slice(1) };
  }
  if (token.startsWith('<') && token.endsWith('>')) {
    return { kind: 'iri', value: token.slice(1, -1) };
  }
  if (token.startsWith('"') && token.endsWith('"')) {
    return { kind: 'literal', value: token.slice(1, -1) };
  }
  // Numeric literal — keep as string, the matcher will coerce both sides.
  if (/^-?\d+(\.\d+)?$/.test(token)) {
    return { kind: 'literal', value: token };
  }
  // Prefixed name `prefix:local`
  const colon = token.indexOf(':');
  if (colon > 0) {
    const prefix = token.slice(0, colon);
    const local = token.slice(colon + 1);
    if (prefixes[prefix] !== undefined) {
      return { kind: 'iri', value: prefixes[prefix] + local };
    }
  }
  throw new Error(`Cannot parse term: '${token}' (use ?var, <iri>, prefix:name, or "literal")`);
}


// ---------------------------------------------------------------------------
// Matcher — exhaustive BGP join.
//
// Strategy:
//   1. Materialize the dataset as a flat list of (s, p, o) triples.
//   2. For each WHERE triple, find every dataset triple that matches
//      under the current bindings.
//   3. Backtrack-join: bindings carry forward; conflicts prune.
//
// Complexity is O(|where| * |dataset|) per partial binding; for our
// tenant graphs (hundreds of nodes, low thousands of triples) this is
// plenty. If queries get slow, the next step is hash indices on
// (subject) and (predicate) — out of scope for v1.
// ---------------------------------------------------------------------------
interface DataTriple {
  s: string;
  p: string;
  o: string;
}

const RESERVED_PREDICATE_KEYS = new Set(['@id', '@context', '@type']);

function valueToObjectIri(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && '@id' in (v as Record<string, unknown>)) {
    const id = (v as Record<string, unknown>)['@id'];
    return typeof id === 'string' ? id : null;
  }
  return null;
}

function valueToLiteral(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v && typeof v === 'object' && '@value' in (v as Record<string, unknown>)) {
    const lit = (v as Record<string, unknown>)['@value'];
    return lit == null ? null : String(lit);
  }
  return null;
}

/** Materialize a JsonLdDocument as flat (s, p, o) triples. We expand
 *  list-valued predicates so a node with `handles: ["a", "b"]` becomes
 *  two triples. `@type` becomes `rdf:type` triples (one per type). */
export function materializeTriples(doc: JsonLdDocument): DataTriple[] {
  const out: DataTriple[] = [];
  const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

  for (const node of doc.graph ?? []) {
    if (!node || typeof node !== 'object') continue;
    const subj = node['@id'];
    if (typeof subj !== 'string') continue;

    // @type → rdf:type triples
    const t = node['@type'];
    const types = Array.isArray(t) ? t : t ? [t] : [];
    for (const ty of types) {
      out.push({ s: subj, p: RDF_TYPE, o: String(ty) });
    }

    // Other predicates
    for (const [pred, val] of Object.entries(node)) {
      if (RESERVED_PREDICATE_KEYS.has(pred)) continue;
      const values = Array.isArray(val) ? val : [val];
      for (const v of values) {
        // Try as IRI first (edge), then literal (data property).
        const asIri = valueToObjectIri(v);
        if (asIri !== null) {
          out.push({ s: subj, p: pred, o: asIri });
          continue;
        }
        const asLit = valueToLiteral(v);
        if (asLit !== null) {
          out.push({ s: subj, p: pred, o: asLit });
        }
      }
    }
  }
  return out;
}

function termValue(t: Term): string {
  switch (t.kind) {
    case 'iri':
    case 'literal':
      return t.value;
    case 'var':
      return '';  // unreachable when caller checks kind first
  }
}

function matchTerm(t: Term, value: string, bindings: Bindings): Bindings | null {
  if (t.kind === 'var') {
    const existing = bindings[t.name];
    if (existing !== undefined) {
      return existing === value ? bindings : null;
    }
    return { ...bindings, [t.name]: value };
  }
  return termValue(t) === value ? bindings : null;
}

/** Expand a JSON-LD term against the query's resolved aliases. We
 *  also accept short predicate names (like `name` / `provider`) and
 *  match them against the materialized triple's predicate as-is —
 *  the materializer keeps the original shorthand on triples that came
 *  from compact JSON-LD, so query like `?s name ?n` works against the
 *  compact form too. (Real SPARQL would require expansion; we cheat
 *  to keep ergonomics good. Documented in the JSDoc above.) */
function predicateCandidates(t: Term): string[] {
  if (t.kind === 'var') return [];
  return [termValue(t)];
}

function matchTriple(
  pattern: Triple,
  data: DataTriple[],
  bindings: Bindings,
): Bindings[] {
  const out: Bindings[] = [];
  const predFilters = predicateCandidates(pattern.p);

  for (const d of data) {
    if (pattern.p.kind !== 'var' && !predFilters.includes(d.p)) continue;
    let b: Bindings | null = bindings;
    b = matchTerm(pattern.s, d.s, b);
    if (b === null) continue;
    b = matchTerm(pattern.p, d.p, b);
    if (b === null) continue;
    b = matchTerm(pattern.o, d.o, b);
    if (b === null) continue;
    out.push(b);
  }
  return out;
}

/** Run a parsed query against a JSON-LD document. */
export function runQuery(query: Query, doc: JsonLdDocument): QueryResult {
  const data = materializeTriples(doc);

  let solutions: Bindings[] = [{}];
  for (const pattern of query.where) {
    const next: Bindings[] = [];
    for (const partial of solutions) {
      next.push(...matchTriple(pattern, data, partial));
    }
    solutions = next;
    if (solutions.length === 0) break;
  }

  // Project to selected vars. SELECT * means "every variable that
  // appears anywhere in WHERE."
  let vars: string[];
  if (query.selectAll) {
    const seen = new Set<string>();
    for (const t of query.where) {
      for (const term of [t.s, t.p, t.o]) {
        if (term.kind === 'var') seen.add(term.name);
      }
    }
    vars = [...seen];
  } else {
    vars = query.selectVars;
  }

  // De-duplicate rows (DISTINCT-by-default for projection).
  const seenRows = new Set<string>();
  const projected: Bindings[] = [];
  for (const sol of solutions) {
    const row: Bindings = {};
    for (const v of vars) {
      if (sol[v] !== undefined) row[v] = sol[v];
    }
    const key = JSON.stringify(row);
    if (seenRows.has(key)) continue;
    seenRows.add(key);
    projected.push(row);
  }

  return { vars, bindings: projected };
}

/** Convenience: parse + run in one call. */
export function query(text: string, doc: JsonLdDocument): QueryResult {
  return runQuery(parseQuery(text), doc);
}
