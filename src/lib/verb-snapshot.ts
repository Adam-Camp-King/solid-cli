/**
 * "What changed since I last looked?" for the verb catalog.
 *
 * ⛔ WHY A SNAPSHOT AND NOT A DATE. The catalog carries no per-verb timestamp — a verb is
 * code, and the registry is rebuilt on every release — so "changed since <date>" cannot be
 * answered honestly by anyone. What CAN be answered exactly is "changed since the catalog
 * you were holding": the agent keeps a snapshot (name → fingerprint, ~40 KB), hands it
 * back, and gets the names that were added, removed or changed. No local cache file for
 * the CLI to keep, so nothing here can go stale behind the agent's back.
 *
 * The fingerprint covers what an agent decides on: description, inputs, side effects,
 * status, how it is undone, what it is an alias of — and, from v2, what it returns and
 * what it refuses on. Pure.
 *
 * ⛔ v1 SNAPSHOTS STILL DIFF CORRECTLY. v1 left `output_schema` and `refuses_when` out, so
 * a verb whose return shape changed read as unchanged. Adding them changes every
 * fingerprint, and a v1 file compared against v2 fingerprints would report the whole
 * catalog as changed. So a snapshot is always compared with the fingerprint of its own
 * schema, and the reply says to take a new one.
 */
import { createHash } from 'crypto';

export const SNAPSHOT_SCHEMA = 'solid:verb-snapshot/v2';
export const SNAPSHOT_SCHEMA_V1 = 'solid:verb-snapshot/v1';

export interface SnapshotVerb {
  name: string;
  description?: string;
  input_schema?: unknown;
  side_effects?: string;
  status?: string;
  undone_by?: string | null;
  same_as?: string | null;
  output_schema?: unknown;
  refuses_when?: unknown;
}
export interface VerbSnapshot {
  schema: string;
  taken_at: string;
  etag?: string;
  verbs: Record<string, string>;
}

/** Keys sorted at every level, so the same verb always prints the same. */
function canonical(o: unknown): unknown {
  if (Array.isArray(o)) return o.map(canonical);
  if (o && typeof o === 'object') {
    return Object.fromEntries(Object.entries(o as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  }
  return o;
}

export function fingerprint(v: SnapshotVerb, schema: string = SNAPSHOT_SCHEMA): string {
  const basis: Record<string, unknown> = {
    d: v.description || '', i: v.input_schema ?? null, s: v.side_effects || '',
    st: v.status || 'active', u: v.undone_by ?? null, a: v.same_as ?? null,
  };
  if (schema !== SNAPSHOT_SCHEMA_V1) {
    basis.o = v.output_schema ?? null;
    // An empty list and an absent one are the same answer: it refuses on nothing declared.
    basis.r = Array.isArray(v.refuses_when) && v.refuses_when.length ? v.refuses_when : null;
  }
  return createHash('sha1').update(JSON.stringify(canonical(basis))).digest('hex').slice(0, 12);
}

export function takeSnapshot(
  verbs: SnapshotVerb[], etag?: string, now = new Date(), schema: string = SNAPSHOT_SCHEMA,
): VerbSnapshot {
  const out: Record<string, string> = {};
  for (const v of [...verbs].sort((a, b) => a.name.localeCompare(b.name))) out[v.name] = fingerprint(v, schema);
  return { schema, taken_at: now.toISOString(), ...(etag ? { etag } : {}), verbs: out };
}

export function isSnapshot(o: unknown): o is VerbSnapshot {
  const schema = (o as VerbSnapshot | null)?.schema;
  return !!o && typeof o === 'object' && (schema === SNAPSHOT_SCHEMA || schema === SNAPSHOT_SCHEMA_V1)
    && typeof (o as VerbSnapshot).verbs === 'object' && (o as VerbSnapshot).verbs !== null;
}

export interface SnapshotDiff {
  since: string;
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: number;
  /** Set when the snapshot predates v2: it cannot see a changed return shape or refusal. */
  blind_to?: string[];
}

export function diffSnapshot(prev: VerbSnapshot, verbs: SnapshotVerb[]): SnapshotDiff {
  // Compared with the fingerprint of the snapshot's OWN schema — see the header.
  const now = takeSnapshot(verbs, undefined, new Date(), prev.schema).verbs;
  const added: string[] = [];
  const changed: string[] = [];
  let unchanged = 0;
  for (const [name, fp] of Object.entries(now)) {
    if (!(name in prev.verbs)) added.push(name);
    else if (prev.verbs[name] !== fp) changed.push(name);
    else unchanged++;
  }
  const removed = Object.keys(prev.verbs).filter((n) => !(n in now)).sort();
  return {
    since: prev.taken_at, added, removed, changed, unchanged,
    ...(prev.schema === SNAPSHOT_SCHEMA_V1 ? { blind_to: ['output_schema', 'refuses_when'] } : {}),
  };
}
