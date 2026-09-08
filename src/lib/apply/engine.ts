/**
 * `solid apply` engine — declarative desired-state reconcile.
 *
 * Parse a manifest into resources, fetch current state per kind, compute a
 * plan (create / update / noop / prune), then execute it. The planning core
 * (parseManifest, specMatches, planKind, extractList) is pure so it's unit
 * tested without HTTP; executePlan does the writes through a minimal client.
 */
import * as yaml from 'js-yaml';
import { createHash } from 'node:crypto';
import { Reconciler, reconcilerFor } from './registry';

export interface ReconcileOptions { dryRun?: boolean; prune?: boolean }
export interface ReconcileReport { dryRun: boolean; results: ExecResult[]; counts: Record<string, number> }

export interface DesiredResource {
  kind: string;
  /** Resolved identity VALUE (e.g. the email / sku / url). */
  identity: string;
  /** Desired fields. Only keys present here are managed (subset semantics). */
  spec: Record<string, unknown>;
}

export type ActionType = 'create' | 'update' | 'noop' | 'prune' | 'unsupported';

export interface PlannedAction {
  kind: string;
  identity: string;
  action: ActionType;
  reason?: string;
  id?: string | number;
  spec?: Record<string, unknown>;
  /** On an update: the declared fields whose value differs from the server. */
  changed?: string[];
  /**
   * Pre-image, captured at plan time from the live item: for an update, the
   * server's current values of the declared fields; for a prune, the whole
   * item. What `solid apply rollback` restores. Absent on create.
   */
  before?: Record<string, unknown>;
}

/** Minimal client surface the executor needs — lets tests inject a fake. */
export interface ApplyClient {
  get<T = unknown>(url: string): Promise<{ data: T }>;
  post(url: string, data: unknown, options?: { idempotencyKey?: string }): Promise<unknown>;
  put(url: string, data: unknown, options?: { idempotencyKey?: string }): Promise<unknown>;
  patch(url: string, data: unknown, options?: { idempotencyKey?: string }): Promise<unknown>;
  delete(url: string, options?: { idempotencyKey?: string }): Promise<unknown>;
}

export interface PlanOptions {
  /** Delete current resources (within a managed kind) absent from the manifest. */
  prune?: boolean;
}

/**
 * Parse a manifest string (YAML or JSON) into normalized desired resources.
 * Accepts: a single resource, a top-level array, `{ resources: [...] }`, and
 * multi-document YAML. Each resource may be `{ kind, spec }`, k8s-style
 * `{ kind, metadata, spec }`, or `{ kind, ...fields }` (fields become spec).
 * `metadata.identity` (or a top-level `identity`) overrides the kind default.
 */
export function parseManifest(text: string): DesiredResource[] {
  const docs: unknown[] = [];
  // loadAll handles both single- and multi-document YAML; JSON is valid YAML.
  yaml.loadAll(text, (d) => { if (d !== null && d !== undefined) docs.push(d); });

  const raw: unknown[] = [];
  for (const doc of docs) {
    if (Array.isArray(doc)) raw.push(...doc);
    else if (doc && typeof doc === 'object' && Array.isArray((doc as Record<string, unknown>).resources)) {
      raw.push(...((doc as Record<string, unknown>).resources as unknown[]));
    } else raw.push(doc);
  }

  return raw.map((r, i) => normalizeResource(r, i));
}

function normalizeResource(r: unknown, index: number): DesiredResource {
  if (!r || typeof r !== 'object') {
    throw new Error(`Manifest entry #${index + 1} is not an object`);
  }
  const obj = r as Record<string, unknown>;
  const kind = String(obj.kind || '').trim();
  if (!kind) throw new Error(`Manifest entry #${index + 1} is missing "kind"`);

  const recon = reconcilerFor(kind);
  if (!recon) {
    throw new Error(`Unknown kind "${kind}" (known: see \`solid apply --kinds\`)`);
  }

  const metadata = (obj.metadata && typeof obj.metadata === 'object' ? obj.metadata : {}) as Record<string, unknown>;
  // spec source: explicit `spec`, else all fields except kind/metadata.
  let spec: Record<string, unknown>;
  if (obj.spec && typeof obj.spec === 'object') {
    spec = { ...(obj.spec as Record<string, unknown>) };
  } else {
    spec = { ...obj };
    delete spec.kind;
    delete spec.metadata;
    delete spec.identity;
  }

  const identityField = String(obj.identity || metadata.identity || recon.identity);
  // A singleton has exactly one instance per company: its identity is the kind name.
  const identityValue = recon.singleton ? recon.kind : (spec[identityField] ?? metadata.name);
  if (identityValue === undefined || identityValue === null || identityValue === '') {
    throw new Error(
      `${kind} entry #${index + 1} has no identity — set spec.${identityField} (or metadata.name)`,
    );
  }
  if (recon.managedFields) {
    const allowed = new Set([...recon.managedFields, identityField, ...(recon.singleton ? [] : [])]);
    const stray = Object.keys(spec).filter((k) => !allowed.has(k));
    if (stray.length) {
      throw new Error(
        `${kind} entry #${index + 1} declares ${stray.map((f) => `"${f}"`).join(', ')} — ` +
        `apply manages only: ${recon.managedFields.join(', ')}`,
      );
    }
  }
  return { kind, identity: String(identityValue), spec };
}

/** Pull the resource array out of a list response, tolerating common shapes. */
export function extractList(resp: unknown, recon: Reconciler): Array<Record<string, unknown>> {
  if (recon.singleton) {
    // `{ brand: {...} }` or `{ brand: null }` → zero or one item, identity = kind.
    const o = (resp && typeof resp === 'object') ? (resp as Record<string, unknown>) : {};
    const one = recon.listKey ? o[recon.listKey] : resp;
    if (!one || typeof one !== 'object' || Array.isArray(one)) return [];
    return [{ ...(one as Record<string, unknown>), [recon.identity]: recon.kind }];
  }
  if (Array.isArray(resp)) return resp as Array<Record<string, unknown>>;
  if (!resp || typeof resp !== 'object') return [];
  const o = resp as Record<string, unknown>;
  const candidates = [recon.listKey, 'items', 'results', 'entries', 'data', `${recon.kind}s`].filter(Boolean) as string[];
  for (const key of candidates) {
    if (Array.isArray(o[key])) return o[key] as Array<Record<string, unknown>>;
  }
  return [];
}

/**
 * True when every field declared in `desired` already equals the value on the
 * current server item (subset semantics — unmanaged server fields are ignored).
 */
export function specMatches(desired: Record<string, unknown>, current: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(desired)) {
    if (!deepEqual(v, current[k])) return false;
  }
  return true;
}

/** Declared fields whose value differs from the current server item. */
export function changedFields(desired: Record<string, unknown>, current: Record<string, unknown>): string[] {
  return Object.keys(desired).filter((k) => !deepEqual(desired[k], current[k]));
}

/** The server's current values of exactly the declared fields (an update's pre-image). */
export function preImage(desired: Record<string, unknown>, current: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(desired)) out[k] = current[k] === undefined ? null : current[k];
  return out;
}

export function valuesEqual(a: unknown, b: unknown): boolean { return deepEqual(a, b); }

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = Object.keys(ao);
  if (keys.length !== Object.keys(bo).length) return false;
  return keys.every((k) => deepEqual(ao[k], bo[k]));
}

/**
 * Compute the reconcile plan for one kind. Pure — given the desired resources
 * and the current server items, returns the ordered list of actions.
 */
export function planKind(
  recon: Reconciler,
  desired: DesiredResource[],
  current: Array<Record<string, unknown>>,
  opts: PlanOptions = {},
): PlannedAction[] {
  const currentByIdentity = new Map<string, Record<string, unknown>>();
  for (const item of current) {
    const idv = item[recon.identity];
    if (idv !== undefined && idv !== null) currentByIdentity.set(String(idv), item);
  }

  const actions: PlannedAction[] = [];
  const seen = new Set<string>();

  for (const d of desired) {
    seen.add(d.identity);
    const existing = currentByIdentity.get(d.identity);
    if (!existing) {
      if (recon.create === null) {
        actions.push({
          kind: d.kind, identity: d.identity, action: 'unsupported',
          reason: recon.createReason ?? `${d.kind} cannot be created by apply`,
        });
      } else {
        actions.push({ kind: d.kind, identity: d.identity, action: 'create', spec: d.spec });
      }
      continue;
    }
    if (specMatches(d.spec, existing)) {
      // Carry the spec: an unchanged resource still becomes a lock baseline.
      actions.push({ kind: d.kind, identity: d.identity, action: 'noop', id: existing[recon.idField] as string | number, spec: d.spec });
    } else if (recon.updateMethod === null) {
      actions.push({
        kind: d.kind, identity: d.identity, action: 'unsupported',
        reason: `${d.kind} is immutable — delete and recreate to change`,
        id: existing[recon.idField] as string | number,
      });
    } else {
      actions.push({
        kind: d.kind, identity: d.identity, action: 'update',
        id: existing[recon.idField] as string | number, spec: d.spec,
        changed: changedFields(d.spec, existing),
        before: preImage(d.spec, existing),
      });
    }
  }

  if (opts.prune && recon.prunable !== false && !recon.singleton) {
    for (const [idv, item] of currentByIdentity) {
      if (!seen.has(idv)) {
        actions.push({
          kind: recon.kind, identity: idv, action: 'prune',
          id: item[recon.idField] as string | number,
          before: { ...item },
        });
      }
    }
  }

  return actions;
}

/** Stable idempotency key for a resource action, derived from its content. */
export function actionIdempotencyKey(a: PlannedAction): string {
  const h = createHash('sha256')
    .update(`${a.action}:${a.kind}:${a.identity}:${JSON.stringify(a.spec ?? {})}`)
    .digest('hex')
    .slice(0, 32);
  return `apply-${h}`;
}

export interface ExecResult extends PlannedAction {
  status: 'done' | 'skipped' | 'failed';
  error?: string;
}

/** Count results by action (+ failed) for a summary line. */
export function tallyResults(results: ExecResult[]): Record<string, number> {
  const c = { create: 0, update: 0, noop: 0, prune: 0, unsupported: 0, failed: 0 };
  for (const r of results) {
    if (r.status === 'failed') c.failed++;
    if (r.action in c) (c as Record<string, number>)[r.action]++;
  }
  return c;
}

/**
 * Reconcile a set of desired resources end-to-end: group by kind, fetch current
 * state, plan, execute. Pure orchestration with NO prompting — the interactive
 * prune confirmation lives in the `apply` command, not here, so this is safe to
 * call programmatically (the @solidnumber/cli/client facade uses it). Unknown
 * kinds are skipped (parseManifest already validates when used via the CLI).
 */
export async function reconcile(
  client: ApplyClient,
  resources: DesiredResource[],
  opts: ReconcileOptions = {},
): Promise<ReconcileReport> {
  const byKind = new Map<string, DesiredResource[]>();
  for (const r of resources) {
    const arr = byKind.get(r.kind) ?? [];
    arr.push(r);
    byKind.set(r.kind, arr);
  }
  const results: ExecResult[] = [];
  for (const [kind, desired] of byKind) {
    const recon = reconcilerFor(kind);
    if (!recon) continue;
    const resp = await client.get(recon.list);
    const current = extractList(resp.data, recon);
    const actions = planKind(recon, desired, current, { prune: opts.prune });
    results.push(...(await executePlan(client, recon, actions, !!opts.dryRun)));
  }
  return { dryRun: !!opts.dryRun, results, counts: tallyResults(results) };
}

/** Execute a plan. `dryRun` returns the plan annotated as skipped, no writes. */
export async function executePlan(
  client: ApplyClient,
  recon: Reconciler,
  actions: PlannedAction[],
  dryRun: boolean,
): Promise<ExecResult[]> {
  const results: ExecResult[] = [];
  for (const a of actions) {
    if (a.action === 'noop' || a.action === 'unsupported') {
      results.push({ ...a, status: 'skipped' });
      continue;
    }
    if (dryRun) {
      results.push({ ...a, status: 'skipped' });
      continue;
    }
    const key = actionIdempotencyKey(a);
    const item = recon.itemPath.replace('{id}', String(a.id));
    try {
      if (a.action === 'create') {
        if (recon.create === null) throw new Error(`${recon.kind} cannot be created by apply`);
        await client.post(recon.create, a.spec, { idempotencyKey: key });
      } else if (a.action === 'update') {
        await executeUpdate(client, recon, a, item, key);
      } else if (a.action === 'prune') {
        await client.delete(item, { idempotencyKey: key });
      }
      results.push({ ...a, status: 'done' });
    } catch (e) {
      results.push({ ...a, status: 'failed', error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}

/**
 * Write one update. A kind with `updateRoutes` splits the CHANGED fields across
 * routes (an agent's autonomy, pause state and model each live behind a
 * different endpoint); a route that owns no changed field is never called, so
 * reconciling one setting cannot touch another. `writeMap` turns a read-side
 * field into its write-side body (a line's `is_active` is written as `status`).
 */
async function executeUpdate(
  client: ApplyClient,
  recon: Reconciler,
  a: PlannedAction,
  item: string,
  key: string,
): Promise<void> {
  const spec = a.spec ?? {};
  if (!recon.updateRoutes) {
    const body = toWriteBody(recon, spec);
    if (recon.updateMethod === 'put') await client.put(item, body, { idempotencyKey: key });
    else await client.patch(item, body, { idempotencyKey: key });
    return;
  }
  const changed = new Set(a.changed ?? Object.keys(spec));
  for (let i = 0; i < recon.updateRoutes.length; i++) {
    const route = recon.updateRoutes[i];
    const subset: Record<string, unknown> = {};
    for (const f of route.fields) if (changed.has(f) && f in spec) subset[f] = spec[f];
    if (Object.keys(subset).length === 0) continue;
    const body = toWriteBody(recon, subset);
    const path = route.path.replace('{id}', String(a.id));
    const routeKey = `${key}-${i}`;
    if (route.method === 'put') await client.put(path, body, { idempotencyKey: routeKey });
    else await client.patch(path, body, { idempotencyKey: routeKey });
  }
}

function toWriteBody(recon: Reconciler, spec: Record<string, unknown>): Record<string, unknown> {
  if (!recon.writeMap) return spec;
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(spec)) {
    const map = recon.writeMap[k];
    Object.assign(body, map ? map(v) : { [k]: v });
  }
  return body;
}
