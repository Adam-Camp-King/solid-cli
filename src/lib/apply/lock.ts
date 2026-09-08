/**
 * `solid apply` lockfile, drift classification, rollback plan and export shaping.
 *
 * The lock lives NEXT TO the manifest (`site.yaml` → `site.lock.json`) so it is
 * committed with it. It records, per resource, the server id and the managed
 * fields as they stood when apply last wrote them — which is what makes a
 * three-way comparison possible:
 *
 *   manifest (git)   lock (last apply)   live (production)
 *
 * and what `rollback` restores from: every run stores a pre-image (`before`)
 * for each write it made.
 *
 * Everything in here that decides is pure (classifyDrift, buildRollbackPlan,
 * shapeForExport, mergeRun); the two functions that touch disk are thin.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { Reconciler, READ_ONLY_FIELDS } from './registry';
import { DesiredResource, ExecResult, PlannedAction, valuesEqual } from './engine';

export const LOCK_VERSION = 1;
export const MAX_RUNS = 20;

export interface LockedResource {
  kind: string;
  identity: string;
  id?: string | number;
  /** Managed fields as last applied (the desired spec that was written). */
  spec: Record<string, unknown>;
  spec_hash: string;
  applied_at: string;
}

export interface RunAction {
  kind: string;
  identity: string;
  action: 'create' | 'update' | 'prune';
  id?: string | number;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

export interface LockRun {
  run_id: string;
  at: string;
  cli_version: string;
  kind: 'apply' | 'rollback';
  /** For a rollback: the run it reverted. */
  reverts?: string;
  actions: RunAction[];
}

export interface ApplyLock {
  version: number;
  company_id: number;
  manifest: string;
  applied_at: string | null;
  cli_version: string;
  resources: Record<string, LockedResource>;
  runs: LockRun[];
}

export function lockKey(kind: string, identity: string): string { return `${kind}/${identity}`; }

export function lockPathFor(manifestPath: string): string {
  const dir = path.dirname(manifestPath);
  const base = path.basename(manifestPath).replace(/\.(ya?ml|json)$/i, '');
  return path.join(dir, `${base}.lock.json`);
}

export function specHash(spec: Record<string, unknown>): string {
  return createHash('sha256').update(stableStringify(spec)).digest('hex').slice(0, 16);
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
}

export function emptyLock(companyId: number, manifestPath: string, cliVersion: string): ApplyLock {
  return {
    version: LOCK_VERSION, company_id: companyId, manifest: path.basename(manifestPath),
    applied_at: null, cli_version: cliVersion, resources: {}, runs: [],
  };
}

export function readLock(lockPath: string): ApplyLock | null {
  if (!fs.existsSync(lockPath)) return null;
  const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as ApplyLock;
  if (parsed.version !== LOCK_VERSION) {
    throw new Error(`${path.basename(lockPath)} is lock version ${parsed.version}; this CLI writes version ${LOCK_VERSION}`);
  }
  return parsed;
}

export function writeLock(lockPath: string, lock: ApplyLock): void {
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
}

export function newRunId(now = new Date()): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Fold an executed (non-dry-run) plan into the lock: resources that were
 * created/updated/unchanged are recorded with the spec that now holds on the
 * server; pruned ones are dropped; failed actions leave the lock untouched for
 * that resource. Returns the new lock and the run record that was appended.
 */
export function mergeRun(
  lock: ApplyLock,
  results: ExecResult[],
  opts: { cliVersion: string; kind?: 'apply' | 'rollback'; reverts?: string; now?: Date },
): { lock: ApplyLock; run: LockRun } {
  const now = opts.now ?? new Date();
  const at = now.toISOString();
  const resources = { ...lock.resources };
  const actions: RunAction[] = [];
  for (const r of results) {
    const key = lockKey(r.kind, r.identity);
    if (r.status === 'failed') continue;
    if (r.action === 'noop') {
      // Re-affirm: the server already matched the manifest. Record it so a
      // later `drift` has a baseline even for resources apply never wrote.
      if (r.spec || resources[key]) {
        const spec = r.spec ?? resources[key].spec;
        resources[key] = { kind: r.kind, identity: r.identity, id: r.id ?? resources[key]?.id, spec, spec_hash: specHash(spec), applied_at: resources[key]?.applied_at ?? at };
      }
      continue;
    }
    if (r.action === 'unsupported') continue;
    if (r.action === 'prune') {
      delete resources[key];
      actions.push({ kind: r.kind, identity: r.identity, action: 'prune', id: r.id, before: r.before ?? null, after: null });
      continue;
    }
    if (r.action === 'create' || r.action === 'update') {
      const spec = r.spec ?? {};
      resources[key] = { kind: r.kind, identity: r.identity, id: r.id, spec, spec_hash: specHash(spec), applied_at: at };
      actions.push({
        kind: r.kind, identity: r.identity, action: r.action, id: r.id,
        before: r.action === 'update' ? (r.before ?? null) : null, after: spec,
      });
    }
  }
  const run: LockRun = { run_id: newRunId(now), at, cli_version: opts.cliVersion, kind: opts.kind ?? 'apply', actions };
  if (opts.reverts) run.reverts = opts.reverts;
  const runs = [...lock.runs, run].slice(-MAX_RUNS);
  return { lock: { ...lock, applied_at: at, cli_version: opts.cliVersion, resources, runs }, run };
}

// ── Drift ────────────────────────────────────────────────────────────────────

export type DriftState =
  | 'in_sync'            // manifest == lock == live
  | 'manifest_changed'   // git moved, production still where apply left it (an apply will change it)
  | 'live_changed'       // production moved since the last apply — the drift that matters
  | 'conflict'           // both moved
  | 'missing'            // declared, but not on the server
  | 'never_applied'      // declared and live, but no lock entry (no baseline)
  | 'removed_from_manifest'; // locked, but no longer declared

export interface DriftEntry {
  kind: string;
  identity: string;
  state: DriftState;
  /** Fields where LIVE differs from the lock (production edits). */
  live_diff?: Array<{ field: string; lock: unknown; live: unknown }>;
  /** Fields where the MANIFEST differs from the lock (git edits). */
  manifest_diff?: Array<{ field: string; lock: unknown; manifest: unknown }>;
}

export function classifyDrift(
  desired: DesiredResource[],
  lock: ApplyLock | null,
  liveByKind: Map<string, { recon: Reconciler; items: Array<Record<string, unknown>> }>,
): DriftEntry[] {
  const out: DriftEntry[] = [];
  const declared = new Set<string>();
  for (const d of desired) {
    const key = lockKey(d.kind, d.identity);
    declared.add(key);
    const live = liveByKind.get(d.kind);
    const item = live?.items.find((i) => String(i[live.recon.identity]) === d.identity);
    const locked = lock?.resources[key];
    if (!item) { out.push({ kind: d.kind, identity: d.identity, state: 'missing' }); continue; }
    if (!locked) { out.push({ kind: d.kind, identity: d.identity, state: 'never_applied' }); continue; }
    const fields = Array.from(new Set([...Object.keys(locked.spec), ...Object.keys(d.spec)]));
    const live_diff: DriftEntry['live_diff'] = [];
    const manifest_diff: DriftEntry['manifest_diff'] = [];
    for (const f of fields) {
      const lockV = locked.spec[f];
      if (!valuesEqual(lockV ?? null, item[f] ?? null)) live_diff.push({ field: f, lock: lockV ?? null, live: item[f] ?? null });
      if (!valuesEqual(lockV ?? null, d.spec[f] ?? null)) manifest_diff.push({ field: f, lock: lockV ?? null, manifest: d.spec[f] ?? null });
    }
    const state: DriftState =
      live_diff.length && manifest_diff.length ? 'conflict'
      : live_diff.length ? 'live_changed'
      : manifest_diff.length ? 'manifest_changed'
      : 'in_sync';
    const e: DriftEntry = { kind: d.kind, identity: d.identity, state };
    if (live_diff.length) e.live_diff = live_diff;
    if (manifest_diff.length) e.manifest_diff = manifest_diff;
    out.push(e);
  }
  if (lock) {
    for (const key of Object.keys(lock.resources)) {
      if (!declared.has(key)) {
        const r = lock.resources[key];
        out.push({ kind: r.kind, identity: r.identity, state: 'removed_from_manifest' });
      }
    }
  }
  return out;
}

/** States that mean production moved behind git's back. */
export function isProductionDrift(e: DriftEntry): boolean {
  return e.state === 'live_changed' || e.state === 'conflict';
}

// ── Rollback ─────────────────────────────────────────────────────────────────

/**
 * Invert one run into a plan, most recent action first:
 *   update → update back to `before`
 *   create → prune the id it created
 *   prune  → create from `before` (server-only fields stripped)
 * Pure; the caller executes it with the ordinary engine.
 */
export function buildRollbackPlan(
  run: LockRun,
  reconFor: (kind: string) => Reconciler | undefined,
): { actions: PlannedAction[]; skipped: Array<{ kind: string; identity: string; reason: string }> } {
  const actions: PlannedAction[] = [];
  const skipped: Array<{ kind: string; identity: string; reason: string }> = [];
  for (const a of [...run.actions].reverse()) {
    const recon = reconFor(a.kind);
    if (!recon) { skipped.push({ kind: a.kind, identity: a.identity, reason: 'unknown kind' }); continue; }
    if (a.action === 'update') {
      if (!a.before) { skipped.push({ kind: a.kind, identity: a.identity, reason: 'no pre-image recorded' }); continue; }
      if (recon.updateMethod === null) { skipped.push({ kind: a.kind, identity: a.identity, reason: `${a.kind} is immutable` }); continue; }
      actions.push({ kind: a.kind, identity: a.identity, action: 'update', id: a.id, spec: a.before, changed: Object.keys(a.before), before: a.after ?? undefined });
    } else if (a.action === 'create') {
      if (recon.prunable === false || recon.singleton) { skipped.push({ kind: a.kind, identity: a.identity, reason: `${a.kind} is never deleted by apply` }); continue; }
      if (a.id === undefined || a.id === null) { skipped.push({ kind: a.kind, identity: a.identity, reason: 'created id was not recorded' }); continue; }
      actions.push({ kind: a.kind, identity: a.identity, action: 'prune', id: a.id, before: a.after ?? undefined });
    } else if (a.action === 'prune') {
      if (!a.before) { skipped.push({ kind: a.kind, identity: a.identity, reason: 'no pre-image recorded' }); continue; }
      if (recon.create === null) { skipped.push({ kind: a.kind, identity: a.identity, reason: `${a.kind} cannot be created by apply` }); continue; }
      actions.push({ kind: a.kind, identity: a.identity, action: 'create', spec: shapeForExport(recon, a.before) });
    }
  }
  return { actions, skipped };
}

// ── Export ───────────────────────────────────────────────────────────────────

/** The manifest-worthy view of one live item: allow-listed fields, or everything minus read-only. */
export function shapeForExport(recon: Reconciler, item: Record<string, unknown>): Record<string, unknown> {
  const fields = recon.exportFields ?? recon.managedFields;
  const out: Record<string, unknown> = {};
  if (!recon.singleton) out[recon.identity] = item[recon.identity];
  if (fields) {
    for (const f of fields) if (item[f] !== undefined) out[f] = item[f];
    return out;
  }
  for (const [k, v] of Object.entries(item)) {
    if (READ_ONLY_FIELDS.has(k) || k.endsWith('_at')) continue;
    out[k] = v;
  }
  return out;
}

export function toManifestYaml(docs: Array<{ kind: string; spec: Record<string, unknown> }>, yamlDump: (o: unknown) => string): string {
  return docs.map((d) => yamlDump({ kind: d.kind, ...d.spec }).trimEnd()).join('\n---\n') + '\n';
}
