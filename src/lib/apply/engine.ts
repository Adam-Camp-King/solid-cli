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
  const identityValue = spec[identityField] ?? metadata.name;
  if (identityValue === undefined || identityValue === null || identityValue === '') {
    throw new Error(
      `${kind} entry #${index + 1} has no identity — set spec.${identityField} (or metadata.name)`,
    );
  }
  return { kind, identity: String(identityValue), spec };
}

/** Pull the resource array out of a list response, tolerating common shapes. */
export function extractList(resp: unknown, recon: Reconciler): Array<Record<string, unknown>> {
  if (Array.isArray(resp)) return resp as Array<Record<string, unknown>>;
  if (!resp || typeof resp !== 'object') return [];
  const o = resp as Record<string, unknown>;
  const candidates = [recon.listKey, 'items', 'results', 'data', `${recon.kind}s`].filter(Boolean) as string[];
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
      actions.push({ kind: d.kind, identity: d.identity, action: 'create', spec: d.spec });
      continue;
    }
    if (specMatches(d.spec, existing)) {
      actions.push({ kind: d.kind, identity: d.identity, action: 'noop', id: existing[recon.idField] as string | number });
    } else if (recon.updateMethod === null) {
      actions.push({
        kind: d.kind, identity: d.identity, action: 'unsupported',
        reason: `${d.kind} is immutable — delete and recreate to change`,
        id: existing[recon.idField] as string | number,
      });
    } else {
      actions.push({ kind: d.kind, identity: d.identity, action: 'update', id: existing[recon.idField] as string | number, spec: d.spec });
    }
  }

  if (opts.prune) {
    for (const [idv, item] of currentByIdentity) {
      if (!seen.has(idv)) {
        actions.push({ kind: recon.kind, identity: idv, action: 'prune', id: item[recon.idField] as string | number });
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
        await client.post(recon.create, a.spec, { idempotencyKey: key });
      } else if (a.action === 'update') {
        if (recon.updateMethod === 'put') await client.put(item, a.spec, { idempotencyKey: key });
        else await client.patch(item, a.spec, { idempotencyKey: key });
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
