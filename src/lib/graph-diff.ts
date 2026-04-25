/**
 * graph-diff — compare two JSON-LD documents at the graph level.
 *
 * Sprint: SPRINT-JSONLD-GRAPH-MOAT.md § A+.4
 *
 * Input: two JsonLdDocument values (typically the output of
 * `solid context --jsonld` taken at different points in time).
 *
 * Output: a report listing added, removed, and modified nodes.
 * Modified nodes carry per-predicate operations in JSON-Patch style
 * so consumers can apply or revert any subset.
 *
 * Design notes
 * ------------
 * - Identity is by `@id`. A node with no `@id` is skipped (we can't
 *   diff anonymous nodes meaningfully — they'd produce a phantom
 *   add+remove for every reshape).
 * - `@type` order is normalized for comparison (sorted) so a node that
 *   reorders its types isn't flagged as modified.
 * - Edge changes appear as predicate changes on the source node — we
 *   don't emit a separate "edge diff" because every edge in JSON-LD is
 *   a predicate value pointing at a target IRI.
 * - Multi-tenant isolation: the caller is responsible for ensuring
 *   both documents come from the same tenant. The diff function does
 *   not enforce this; it does, however, guarantee that no node from
 *   one document leaks into the other's report — every entry comes
 *   from one of `before` or `after`, never invented.
 */

import type { JsonLdDocument, JsonLdNode } from './graph-walker';

export type Op = 'add' | 'remove' | 'replace';

export interface PredicateChange {
  predicate: string;
  op: Op;
  before?: unknown;
  after?: unknown;
}

export interface NodeChange {
  '@id': string;
  '@type'?: string | string[];
  predicates: PredicateChange[];
}

export interface DiffReport {
  /** Nodes whose `@id` is in `after` but not `before`. */
  added: JsonLdNode[];
  /** Nodes whose `@id` is in `before` but not `after`. */
  removed: JsonLdNode[];
  /** Nodes whose `@id` is in both, but predicates differ. */
  modified: NodeChange[];
  /** Aggregate counts so consumers can decide "is anything different?"
   *  without iterating every list. */
  summary: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
  };
}

const RESERVED_KEYS = new Set(['@id', '@context', '@type']);

function nodesById(doc: JsonLdDocument): Map<string, JsonLdNode> {
  const out = new Map<string, JsonLdNode>();
  const list = doc.graph ?? [];
  for (const node of list) {
    if (node && typeof node === 'object' && typeof node['@id'] === 'string') {
      out.set(node['@id'], node);
    }
  }
  return out;
}

function normalizeType(t: unknown): string[] {
  if (Array.isArray(t)) return [...t.map(String)].sort();
  if (typeof t === 'string') return [t];
  return [];
}

function predicateKeys(node: JsonLdNode): string[] {
  return Object.keys(node).filter((k) => !RESERVED_KEYS.has(k));
}

/**
 * Deep equality for JSON-LD predicate values. We don't need full
 * structural equality (functions, Symbols, NaN) — JSON-LD payloads are
 * pure JSON values, so JSON serialization with sorted keys is the
 * correct equality check.
 */
function predicateEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a == null || b == null) return a === b;
  // Order-insensitive comparison via canonical JSON.
  return canonical(a) === canonical(b);
}

function canonical(v: unknown): string {
  if (v == null) return JSON.stringify(v);
  if (typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) {
    return `[${v.map(canonical).join(',')}]`;
  }
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
}

/**
 * Compute per-predicate operations between two snapshots of the same
 * @id. Returns an empty array when nothing changed (the caller treats
 * that as "unchanged").
 */
function predicateDiff(before: JsonLdNode, after: JsonLdNode): PredicateChange[] {
  const changes: PredicateChange[] = [];

  // @type changes: normalize so reordering doesn't trigger a modify.
  const tBefore = normalizeType(before['@type']);
  const tAfter = normalizeType(after['@type']);
  if (canonical(tBefore) !== canonical(tAfter)) {
    changes.push({
      predicate: '@type',
      op: 'replace',
      before: before['@type'],
      after: after['@type'],
    });
  }

  const beforeKeys = new Set(predicateKeys(before));
  const afterKeys = new Set(predicateKeys(after));

  // Predicates added in `after`
  for (const k of afterKeys) {
    if (!beforeKeys.has(k)) {
      changes.push({ predicate: k, op: 'add', after: after[k] });
    }
  }
  // Predicates removed in `after`
  for (const k of beforeKeys) {
    if (!afterKeys.has(k)) {
      changes.push({ predicate: k, op: 'remove', before: before[k] });
    }
  }
  // Predicates present in both — replace if value changed.
  for (const k of beforeKeys) {
    if (!afterKeys.has(k)) continue;
    if (!predicateEqual(before[k], after[k])) {
      changes.push({ predicate: k, op: 'replace', before: before[k], after: after[k] });
    }
  }

  // Stable predicate ordering for deterministic output (tests, snapshots).
  changes.sort((a, b) => a.predicate.localeCompare(b.predicate));
  return changes;
}

/**
 * Compare two JSON-LD documents and return a structured report.
 *
 * Both documents should have a `@graph` array of nodes (the standard
 * shape `services/ai_context_jsonld.build_jsonld()` emits). Documents
 * without a graph array produce an all-empty report.
 */
export function diff(before: JsonLdDocument, after: JsonLdDocument): DiffReport {
  const beforeMap = nodesById(before);
  const afterMap = nodesById(after);

  const added: JsonLdNode[] = [];
  const removed: JsonLdNode[] = [];
  const modified: NodeChange[] = [];
  let unchanged = 0;

  for (const [id, node] of afterMap) {
    if (!beforeMap.has(id)) {
      added.push(node);
    }
  }
  for (const [id, node] of beforeMap) {
    if (!afterMap.has(id)) {
      removed.push(node);
    }
  }
  for (const [id, beforeNode] of beforeMap) {
    const afterNode = afterMap.get(id);
    if (!afterNode) continue;
    const changes = predicateDiff(beforeNode, afterNode);
    if (changes.length === 0) {
      unchanged++;
    } else {
      modified.push({
        '@id': id,
        '@type': afterNode['@type'],
        predicates: changes,
      });
    }
  }

  // Stable @id ordering for deterministic output.
  added.sort((a, b) => a['@id'].localeCompare(b['@id']));
  removed.sort((a, b) => a['@id'].localeCompare(b['@id']));
  modified.sort((a, b) => a['@id'].localeCompare(b['@id']));

  return {
    added,
    removed,
    modified,
    summary: {
      added: added.length,
      removed: removed.length,
      modified: modified.length,
      unchanged,
    },
  };
}
