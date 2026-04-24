/**
 * Graph walker for JSON-LD tenant context.
 *
 * Consumes the output of `GET /api/v1/cli/context?format=jsonld` —
 * a Schema.org + solid:* typed graph — and offers the primitives the
 * `solid graph` CLI command (and anything else that wants to navigate
 * the tenant context) needs: a normalised adjacency map, BFS up to N
 * hops from a root IRI, filters by @type, and a short-form expander
 * (``kb/42`` → full IRI).
 *
 * The walker is intentionally schema-light: it treats any string-valued
 * field whose value is an `@id` found in the graph as an outbound edge,
 * plus anything declared ``@type: @id`` in the document's @context. This
 * means the moment a new relationship predicate is added to
 * `services/ai_context_jsonld.py` it is walkable without changing this
 * file.
 */

export type JsonLdNode = Record<string, unknown> & { '@id': string; '@type'?: string | string[] };

export interface JsonLdDocument {
  '@context'?: Record<string, unknown> | string;
  '@id'?: string;
  '@type'?: string | string[];
  graph?: JsonLdNode[];
  // Migration-window flat tree — ignored by the walker.
  'solid:raw'?: unknown;
  // Accept any additional envelope fields.
  [key: string]: unknown;
}

export interface AdjacencyEntry {
  node: JsonLdNode;
  outEdges: Array<{ predicate: string; target: string }>;
  inEdges: Array<{ predicate: string; source: string }>;
}

export type AdjacencyMap = Map<string, AdjacencyEntry>;

/**
 * Edge discovery — which predicates in a node are links to other nodes.
 *
 * Approach: any string value that matches an ``@id`` already in the
 * graph is considered an outbound edge; any array of strings whose
 * entries match IDs is a bag of outbound edges. That covers every
 * edge declared in the current @context (``provider``, ``company``,
 * ``withinTier``, ``inIndustry``, ``shelfOf``, ``clonedFromTemplate``,
 * ``handles``, ``operatesOn``, ``offers``, ``supersededBy``, ...) plus
 * any future ones, without having to enumerate them here.
 */
function collectEdges(node: JsonLdNode, knownIds: Set<string>): Array<{ predicate: string; target: string }> {
  const out: Array<{ predicate: string; target: string }> = [];
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('@')) continue;
    if (typeof value === 'string' && knownIds.has(value) && value !== node['@id']) {
      out.push({ predicate: key, target: value });
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && knownIds.has(item) && item !== node['@id']) {
          out.push({ predicate: key, target: item });
        } else if (item && typeof item === 'object' && '@id' in (item as object)) {
          const embeddedId = (item as { '@id'?: unknown })['@id'];
          if (typeof embeddedId === 'string' && knownIds.has(embeddedId) && embeddedId !== node['@id']) {
            out.push({ predicate: key, target: embeddedId });
          }
        }
      }
    } else if (value && typeof value === 'object' && '@id' in (value as object)) {
      // Embedded node reference (e.g. nested schema:Offer) — treat its
      // @id as an outbound edge when it resolves inside the graph.
      const embeddedId = (value as { '@id'?: unknown })['@id'];
      if (typeof embeddedId === 'string' && knownIds.has(embeddedId) && embeddedId !== node['@id']) {
        out.push({ predicate: key, target: embeddedId });
      }
    }
  }
  return out;
}

/**
 * Build an adjacency map keyed by @id. Every node's outbound and
 * inbound edges are precomputed so BFS + reverse lookup are O(1).
 */
export function buildAdjacency(doc: JsonLdDocument): AdjacencyMap {
  const graph = doc.graph ?? [];
  const map: AdjacencyMap = new Map();
  const knownIds = new Set<string>(graph.map((n) => n['@id']));

  for (const node of graph) {
    map.set(node['@id'], { node, outEdges: [], inEdges: [] });
  }
  for (const node of graph) {
    const edges = collectEdges(node, knownIds);
    const entry = map.get(node['@id']);
    if (!entry) continue;
    entry.outEdges = edges;
    for (const e of edges) {
      const targetEntry = map.get(e.target);
      if (targetEntry) {
        targetEntry.inEdges.push({ predicate: e.predicate, source: node['@id'] });
      }
    }
  }
  return map;
}

/**
 * BFS outward from a root IRI. Returns the set of visited IDs; depth
 * limit is the maximum number of edges traversed from the root.
 * ``hops = 0`` returns just the root; ``hops = 1`` returns root + all
 * direct neighbors; etc.
 */
export function bfs(adj: AdjacencyMap, root: string, hops: number): Set<string> {
  if (!adj.has(root)) return new Set();
  const visited = new Set<string>([root]);
  if (hops <= 0) return visited;

  let frontier: string[] = [root];
  for (let depth = 0; depth < hops; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      const entry = adj.get(id);
      if (!entry) continue;
      for (const e of entry.outEdges) {
        if (!visited.has(e.target)) {
          visited.add(e.target);
          next.push(e.target);
        }
      }
      // Inbound edges too — a "relationships around X" view should show
      // the things that point AT X, not just the things X points at.
      // The user can drop this via --directed.
      for (const e of entry.inEdges) {
        if (!visited.has(e.source)) {
          visited.add(e.source);
          next.push(e.source);
        }
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return visited;
}

/** Directed variant — only outbound edges. */
export function bfsOut(adj: AdjacencyMap, root: string, hops: number): Set<string> {
  if (!adj.has(root)) return new Set();
  const visited = new Set<string>([root]);
  if (hops <= 0) return visited;

  let frontier: string[] = [root];
  for (let depth = 0; depth < hops; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      const entry = adj.get(id);
      if (!entry) continue;
      for (const e of entry.outEdges) {
        if (!visited.has(e.target)) {
          visited.add(e.target);
          next.push(e.target);
        }
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return visited;
}

/**
 * Return every node whose @type array contains ``targetType``. Handles
 * both string and array shapes. ``targetType`` may be a bare Schema.org
 * fragment (``"Service"``), a Solid# vocab term (``"solid:Agent"``), or
 * a full IRI; we match suffix-wise so casual inputs work.
 */
export function nodesOfType(doc: JsonLdDocument, targetType: string): JsonLdNode[] {
  const graph = doc.graph ?? [];
  const needle = targetType.toLowerCase();
  return graph.filter((n) => {
    const t = n['@type'];
    if (!t) return false;
    const arr = Array.isArray(t) ? t : [t];
    return arr.some((ty) => {
      const s = String(ty).toLowerCase();
      return s === needle || s.endsWith(':' + needle) || s.endsWith('/' + needle);
    });
  });
}

/** Enumerate every distinct @type value in the graph, sorted. */
export function listTypes(doc: JsonLdDocument): string[] {
  const graph = doc.graph ?? [];
  const seen = new Set<string>();
  for (const n of graph) {
    const t = n['@type'];
    if (!t) continue;
    const arr = Array.isArray(t) ? t : [t];
    for (const ty of arr) seen.add(String(ty));
  }
  return [...seen].sort();
}

/**
 * Short-form expander. Accepts the bare argument the user typed on the
 * CLI and returns the full IRI when it can be resolved:
 *
 *   "kb/42"                                    →  docRoot + "/kb/42"
 *   "co/61/service/3"                          →  SOLID + "/co/61/service/3"
 *   "https://solidnumber.com/co/61/kb/42"      →  unchanged (already full)
 *   "tier/builder"                             →  SOLID + "/vocab/tier/builder"
 *
 * ``docRoot`` should be the graph document's own ``@id`` (the tenant
 * Organization) so relative paths resolve against the caller's tenant.
 */
export function resolveIri(input: string, docRoot: string | undefined): string {
  const trimmed = input.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;

  // "vocab/<type>/<slug>" or "tier/<slug>" — platform-wide.
  const platformPrefixes = ['tier/', 'industry/', 'shelf/', 'agent-default/', 'cli-tool/', 'kb-template/'];
  if (platformPrefixes.some((p) => trimmed.startsWith(p))) {
    return `https://solidnumber.com/vocab/${trimmed}`;
  }
  if (trimmed.startsWith('vocab/')) {
    return `https://solidnumber.com/${trimmed}`;
  }

  // "co/<id>/<type>/<entity>" — full company-scoped path sans scheme.
  if (trimmed.startsWith('co/')) {
    return `https://solidnumber.com/${trimmed}`;
  }

  // Relative to this tenant's doc root, e.g. "kb/42" → "<doc>/kb/42".
  if (docRoot) return `${docRoot.replace(/\/$/, '')}/${trimmed}`;
  return trimmed;
}

/** Extract a subgraph (a fresh JsonLdDocument) containing only the
 *  nodes in ``ids`` — useful for ``solid graph --json`` output. */
export function subgraph(doc: JsonLdDocument, ids: Set<string>): JsonLdDocument {
  const graph = (doc.graph ?? []).filter((n) => ids.has(n['@id']));
  return {
    '@context': doc['@context'],
    '@id': doc['@id'],
    '@type': doc['@type'],
    graph,
  };
}

// -- Validation -----------------------------------------------------------

export type ValidationSeverity = 'error' | 'warn';

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  nodeId: string;
  message: string;
}

export interface ValidationReport {
  ok: boolean;
  issues: ValidationIssue[];
  nodeCount: number;
  edgeCount: number;
}

/**
 * Per-type required-field registry. Matched against the @type array
 * using the same suffix rules as ``nodesOfType``. Each required field
 * is either a predicate that must be present and non-empty, or an
 * edge that must resolve inside @graph.
 *
 * Missing required fields are ERROR by default; edge targets that
 * exist but don't resolve in-document are ERROR. Structural issues
 * (like a duplicate @id) are ERROR too.
 *
 * The registry is permissive: unknown types don't produce issues.
 * New types are validated the moment they're added to this map.
 */
const REQUIRED_FIELDS: Array<{ matchType: string; fields: string[] }> = [
  { matchType: 'Organization',         fields: ['name'] },
  { matchType: 'solid:Company',        fields: ['name', 'identifier'] },
  { matchType: 'Service',              fields: ['name', 'provider'] },
  { matchType: 'Product',              fields: ['name', 'provider'] },
  { matchType: 'solid:KnowledgeBaseEntry', fields: ['name', 'company'] },
  { matchType: 'solid:Agent',          fields: ['name'] },
  { matchType: 'solid:WebsitePage',    fields: ['name', 'company'] },
  { matchType: 'solid:Site',           fields: ['name', 'company'] },
  { matchType: 'solid:AgentChain',     fields: ['name', 'company'] },
  { matchType: 'solid:InboundWebhook', fields: ['solid:eventKey', 'company'] },
  { matchType: 'solid:CustomDomain',   fields: ['name', 'company'] },
  { matchType: 'solid:Tier',           fields: ['name'] },
  { matchType: 'solid:Industry',       fields: ['name'] },
];

function nodeTypeMatches(node: JsonLdNode, target: string): boolean {
  const t = node['@type'];
  if (!t) return false;
  const arr = Array.isArray(t) ? t : [t];
  const needle = target.toLowerCase();
  return arr.some((ty) => {
    const s = String(ty).toLowerCase();
    return s === needle || s.endsWith(':' + needle) || s.endsWith('/' + needle);
  });
}

function hasNonEmptyField(node: JsonLdNode, field: string): boolean {
  const v = node[field];
  if (v === undefined || v === null || v === '') return false;
  if (Array.isArray(v) && v.length === 0) return false;
  if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) return false;
  return true;
}

export function validate(doc: JsonLdDocument): ValidationReport {
  const issues: ValidationIssue[] = [];
  const graph = doc.graph ?? [];
  const ids = new Set<string>();
  let edgeCount = 0;

  // Pass 1: duplicate @id detection + build the id set.
  for (const node of graph) {
    const id = node['@id'];
    if (!id) {
      issues.push({
        severity: 'error',
        code: 'missing_id',
        nodeId: '(unnamed)',
        message: `node lacks @id — graph cannot reference it`,
      });
      continue;
    }
    if (ids.has(id)) {
      issues.push({
        severity: 'error',
        code: 'duplicate_id',
        nodeId: id,
        message: `@id appears more than once in @graph`,
      });
    }
    ids.add(id);
  }

  // Pass 2: per-node edge + required-field checks.
  for (const node of graph) {
    const id = node['@id'];
    if (!id) continue;

    // Required fields per type.
    for (const rule of REQUIRED_FIELDS) {
      if (!nodeTypeMatches(node, rule.matchType)) continue;
      for (const field of rule.fields) {
        if (!hasNonEmptyField(node, field)) {
          issues.push({
            severity: 'error',
            code: 'missing_required',
            nodeId: id,
            message: `@type ${rule.matchType} requires field "${field}" — missing or empty`,
          });
        }
      }
    }

    // Edge targets — any string value resolving to an IRI-shaped id
    // should exist in @graph. This is the same edge-discovery logic
    // the walker uses; dangling edges = bad graph.
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith('@')) continue;
      const targets: string[] = [];
      if (typeof value === 'string' && /^https?:\/\//.test(value)) {
        targets.push(value);
      } else if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'string' && /^https?:\/\//.test(item)) targets.push(item);
        }
      } else if (value && typeof value === 'object' && '@id' in (value as object)) {
        const inner = (value as { '@id'?: unknown })['@id'];
        if (typeof inner === 'string' && /^https?:\/\//.test(inner)) targets.push(inner);
      }

      for (const target of targets) {
        edgeCount++;
        // External IRIs (outside solidnumber.com) aren't expected to
        // resolve inside @graph — e.g. schema:image might point at a
        // CDN URL. We only enforce resolution for solidnumber.com IDs.
        if (!target.startsWith('https://solidnumber.com')) continue;
        if (target === id) continue;  // self-ref is benign
        if (!ids.has(target)) {
          issues.push({
            severity: 'error',
            code: 'dangling_edge',
            nodeId: id,
            message: `"${key}" → ${target} — target not in @graph`,
          });
        }
      }
    }
  }

  return {
    ok: issues.filter((i) => i.severity === 'error').length === 0,
    issues,
    nodeCount: graph.length,
    edgeCount,
  };
}
