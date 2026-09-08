/**
 * `solid apply` lock / drift / rollback / export — the pure decisions.
 *
 * The lock is what turns apply from "write what the file says" into a system
 * with a memory: a three-way comparison (manifest, last apply, production)
 * and a recorded pre-image for every write. These tests pin those decisions
 * without touching disk or HTTP.
 */
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseManifest, ExecResult, extractList, planKind } from '../../lib/apply/engine';
import { RECONCILERS, reconcilerFor } from '../../lib/apply/registry';
import {
  emptyLock, mergeRun, classifyDrift, isProductionDrift, buildRollbackPlan,
  shapeForExport, lockPathFor, readLock, writeLock, LockRun, toManifestYaml,
} from '../../lib/apply/lock';

const NOW = new Date('2026-09-07T12:00:00.000Z');

function applied(results: Partial<ExecResult>[]) {
  const lock = emptyLock(61, '/tmp/site.yaml', '2.17.0');
  return mergeRun(lock, results as ExecResult[], { cliVersion: '2.17.0', now: NOW });
}

describe('lock: mergeRun', () => {
  it('records created and updated resources with the spec that now holds, and a pre-image per write', () => {
    const { lock, run } = applied([
      { kind: 'page', identity: 'home', action: 'create', status: 'done', spec: { slug: 'home', title: 'Home' } },
      { kind: 'page', identity: 'about', action: 'update', status: 'done', id: 4, spec: { slug: 'about', title: 'About' }, before: { slug: 'about', title: 'Old' } },
      { kind: 'page', identity: 'contact', action: 'noop', status: 'skipped', id: 5, spec: { slug: 'contact', title: 'Contact' } },
    ]);
    expect(Object.keys(lock.resources).sort()).toEqual(['page/about', 'page/contact', 'page/home']);
    expect(lock.resources['page/about'].id).toBe(4);
    expect(lock.resources['page/about'].spec).toEqual({ slug: 'about', title: 'About' });
    expect(run.actions).toEqual([
      { kind: 'page', identity: 'home', action: 'create', id: undefined, before: null, after: { slug: 'home', title: 'Home' } },
      { kind: 'page', identity: 'about', action: 'update', id: 4, before: { slug: 'about', title: 'Old' }, after: { slug: 'about', title: 'About' } },
    ]);
    expect(run.run_id).toBe('20260907T120000Z');
    expect(lock.applied_at).toBe(NOW.toISOString());
  });

  it('drops pruned resources and leaves a failed write out of the lock', () => {
    const first = applied([
      { kind: 'product', identity: 'A1', action: 'create', status: 'done', id: 1, spec: { sku: 'A1', price: 10 } },
      { kind: 'product', identity: 'B2', action: 'create', status: 'done', id: 2, spec: { sku: 'B2', price: 20 } },
    ]).lock;
    const { lock } = mergeRun(first, [
      { kind: 'product', identity: 'A1', action: 'prune', status: 'done', id: 1, before: { id: 1, sku: 'A1', price: 10 } },
      { kind: 'product', identity: 'B2', action: 'update', status: 'failed', id: 2, spec: { sku: 'B2', price: 99 }, error: '500' },
    ] as ExecResult[], { cliVersion: '2.17.0', now: NOW });
    expect(lock.resources['product/A1']).toBeUndefined();
    expect(lock.resources['product/B2'].spec).toEqual({ sku: 'B2', price: 20 }); // failed write not recorded
    expect(lock.runs).toHaveLength(2);
  });

  it('keeps at most twenty runs', () => {
    let lock = emptyLock(1, 'x.yaml', '2.17.0');
    for (let i = 0; i < 25; i++) {
      lock = mergeRun(lock, [{ kind: 'page', identity: 'p', action: 'update', status: 'done', id: 1, spec: { slug: 'p', title: String(i) }, before: { slug: 'p', title: String(i - 1) } }] as ExecResult[],
        { cliVersion: '2.17.0', now: new Date(NOW.getTime() + i * 1000) }).lock;
    }
    expect(lock.runs).toHaveLength(20);
  });
});

describe('drift: classifyDrift (manifest vs lock vs production)', () => {
  const page = RECONCILERS.page;
  const manifest = parseManifest(JSON.stringify([
    { kind: 'page', slug: 'home', title: 'Home' },
    { kind: 'page', slug: 'about', title: 'About v2' },
    { kind: 'page', slug: 'pricing', title: 'Pricing' },
    { kind: 'page', slug: 'careers', title: 'Careers' },
    { kind: 'page', slug: 'new', title: 'New' },
  ]));
  const lock = applied([
    { kind: 'page', identity: 'home', action: 'create', status: 'done', id: 1, spec: { slug: 'home', title: 'Home' } },
    { kind: 'page', identity: 'about', action: 'create', status: 'done', id: 2, spec: { slug: 'about', title: 'About' } },
    { kind: 'page', identity: 'pricing', action: 'create', status: 'done', id: 3, spec: { slug: 'pricing', title: 'Pricing' } },
    { kind: 'page', identity: 'careers', action: 'create', status: 'done', id: 4, spec: { slug: 'careers', title: 'Careers' } },
    { kind: 'page', identity: 'legacy', action: 'create', status: 'done', id: 9, spec: { slug: 'legacy', title: 'Legacy' } },
  ]).lock;
  const live = new Map([[ 'page', { recon: page, items: [
    { id: 1, slug: 'home', title: 'Home' },                 // untouched
    { id: 2, slug: 'about', title: 'About' },               // git moved, prod did not
    { id: 3, slug: 'pricing', title: 'Pricing (edited in dashboard)' }, // prod moved
    { id: 4, slug: 'careers', title: 'Careers!' },          // both moved? manifest same as lock → live only
    { id: 7, slug: 'new', title: 'whatever' },              // live but never applied
    { id: 9, slug: 'legacy', title: 'Legacy' },             // locked, removed from manifest
  ] } ]]);

  it('names every state and diffs the field that moved', () => {
    const byId = Object.fromEntries(classifyDrift(manifest, lock, live).map((e) => [e.identity, e]));
    expect(byId.home.state).toBe('in_sync');
    expect(byId.about.state).toBe('manifest_changed');
    expect(byId.about.manifest_diff).toEqual([{ field: 'title', lock: 'About', manifest: 'About v2' }]);
    expect(byId.pricing.state).toBe('live_changed');
    expect(byId.pricing.live_diff).toEqual([{ field: 'title', lock: 'Pricing', live: 'Pricing (edited in dashboard)' }]);
    expect(byId.careers.state).toBe('live_changed');
    expect(byId.new.state).toBe('never_applied');
    expect(byId.legacy.state).toBe('removed_from_manifest');
  });

  it('flags a conflict when both git and production moved the same resource', () => {
    const m = parseManifest(JSON.stringify([{ kind: 'page', slug: 'pricing', title: 'Pricing v2' }]));
    const [e] = classifyDrift(m, lock, live);
    expect(e.state).toBe('conflict');
    expect(isProductionDrift(e)).toBe(true);
  });

  it('reports missing when declared but absent on the server, and never_applied everywhere without a lock', () => {
    const m = parseManifest(JSON.stringify([{ kind: 'page', slug: 'ghost', title: 'Ghost' }, { kind: 'page', slug: 'home', title: 'Home' }]));
    const noLock = classifyDrift(m, null, live);
    expect(noLock.map((e) => e.state)).toEqual(['missing', 'never_applied']);
  });

  it('only live_changed and conflict count as production drift', () => {
    const states = classifyDrift(manifest, lock, live).map((e) => [e.state, isProductionDrift(e)]);
    for (const [state, isDrift] of states) {
      expect(isDrift).toBe(state === 'live_changed' || state === 'conflict');
    }
  });
});

describe('rollback: buildRollbackPlan', () => {
  it('inverts a run most-recent-first: update→restore before, create→prune, prune→recreate without read-only fields', () => {
    const run: LockRun = {
      run_id: 'r1', at: NOW.toISOString(), cli_version: '2.17.0', kind: 'apply',
      actions: [
        { kind: 'product', identity: 'A1', action: 'update', id: 1, before: { sku: 'A1', price: 10 }, after: { sku: 'A1', price: 12 } },
        { kind: 'product', identity: 'B2', action: 'create', id: 2, before: null, after: { sku: 'B2', price: 20 } },
        { kind: 'product', identity: 'C3', action: 'prune', id: 3, before: { id: 3, company_id: 61, sku: 'C3', price: 30, created_at: 'x', updated_at: 'y' }, after: null },
      ],
    };
    const { actions, skipped } = buildRollbackPlan(run, reconcilerFor);
    expect(skipped).toEqual([]);
    expect(actions.map((a) => [a.action, a.identity])).toEqual([['create', 'C3'], ['prune', 'B2'], ['update', 'A1']]);
    expect(actions[0].spec).toEqual({ sku: 'C3', price: 30 });
    expect(actions[1].id).toBe(2);
    expect(actions[2].spec).toEqual({ sku: 'A1', price: 10 });
    expect(actions[2].changed).toEqual(['sku', 'price']);
  });

  it('refuses to invert what the kind forbids and says why', () => {
    const run: LockRun = {
      run_id: 'r2', at: NOW.toISOString(), cli_version: '2.17.0', kind: 'apply',
      actions: [
        { kind: 'agent', identity: 'sales', action: 'update', id: 7, before: null, after: { autonomy_level: 4 } },
        { kind: 'webhook', identity: 'https://x', action: 'update', id: 1, before: { url: 'https://x' }, after: { url: 'https://x' } },
        { kind: 'voice_line', identity: '+1555', action: 'prune', id: 3, before: { phone_number: '+1555' }, after: null },
      ],
    };
    const { actions, skipped } = buildRollbackPlan(run, reconcilerFor);
    expect(actions).toEqual([]);
    expect(skipped.map((s) => s.reason)).toEqual([
      'voice_line cannot be created by apply',
      'webhook is immutable',
      'no pre-image recorded',
    ]);
  });
});

describe('export: shapeForExport', () => {
  it('uses the allow-list for kinds that have one and strips read-only fields otherwise', () => {
    expect(shapeForExport(RECONCILERS.service, { id: 1, company_id: 61, slug: 'x', title: 'Cut', price: 40, created_at: 'a', currency: 'USD' }))
      .toEqual({ title: 'Cut', price: 40, currency: 'USD' });
    expect(shapeForExport(RECONCILERS.product, { id: 1, company_id: 61, sku: 'A1', name: 'W', updated_at: 'z', stats: {} }))
      .toEqual({ sku: 'A1', name: 'W' });
    expect(shapeForExport(RECONCILERS.agent, { id: 7, agent_type: 'sales', name: 'Jackson', autonomy_level: 3, is_enabled: true, stats: {} }))
      .toEqual({ agent_type: 'sales', autonomy_level: 3, is_enabled: true });
  });

  it('a singleton exports its managed fields without an identity field', () => {
    expect(shapeForExport(RECONCILERS.brand, { id: 1, name: 'Acme', design: { primary: '#000' }, voice: {}, rules: {}, created_at: 'x' }))
      .toEqual({ name: 'Acme', design: { primary: '#000' }, voice: {}, rules: {} });
  });

  it('round-trips: an exported manifest re-parses to the same identities', () => {
    const yaml = require('js-yaml') as typeof import('js-yaml');
    const docs = [
      { kind: 'service', spec: shapeForExport(RECONCILERS.service, { id: 1, title: 'Cut', price: 40 }) },
      { kind: 'brand', spec: shapeForExport(RECONCILERS.brand, { name: 'Acme', design: {}, voice: {}, rules: {} }) },
    ];
    const text = toManifestYaml(docs, (o) => yaml.dump(o));
    const parsed = parseManifest(text);
    expect(parsed.map((r) => [r.kind, r.identity])).toEqual([['service', 'Cut'], ['brand', 'brand']]);
  });
});

describe('new kinds: kb, service, brand', () => {
  it('kb is keyed by title, lists with a 500 cap and reads results/entries envelopes', () => {
    const kb = RECONCILERS.kb;
    expect(kb.list).toContain('limit=500');
    expect(extractList({ results: [{ title: 'Hours' }] }, kb)).toHaveLength(1);
    expect(extractList({ entries: [{ title: 'Hours' }] }, kb)).toHaveLength(1);
    const r = parseManifest(JSON.stringify([{ kind: 'kb', title: 'Hours', category: 'faq', content: '9-5' }]));
    expect(r[0].identity).toBe('Hours');
  });

  it('brand is a singleton: identity is the kind, present-or-absent from the envelope, never pruned', () => {
    const brand = RECONCILERS.brand;
    expect(extractList({ brand: null }, brand)).toEqual([]);
    expect(extractList({ brand: { id: 1, name: 'Acme', design: {} } }, brand)).toEqual([{ id: 1, name: 'Acme', design: {}, brand: 'brand' }]);
    const desired = parseManifest(JSON.stringify([{ kind: 'brand', name: 'Acme', design: { primary: '#111' } }]));
    expect(desired[0].identity).toBe('brand');
    const create = planKind(brand, desired, extractList({ brand: null }, brand), { prune: true });
    expect(create.map((a) => a.action)).toEqual(['create']);
    const update = planKind(brand, desired, extractList({ brand: { id: 1, name: 'Acme', design: { primary: '#000' } } }, brand), { prune: true });
    expect(update.map((a) => a.action)).toEqual(['update']);
    expect(update[0].before).toEqual({ name: 'Acme', design: { primary: '#000' } });
    expect(update[0].changed).toEqual(['design']);
  });

  it('a brand manifest may only carry the four brand fields', () => {
    expect(() => parseManifest(JSON.stringify([{ kind: 'brand', name: 'Acme', logo_url: 'x' }]))).toThrow(/manages only/);
  });

  it('plan captures a pre-image for updates and prunes so rollback has something to restore', () => {
    const product = RECONCILERS.product;
    const desired = parseManifest(JSON.stringify([{ kind: 'product', sku: 'A1', price: 12 }]));
    const actions = planKind(product, desired, [{ id: 1, sku: 'A1', price: 10, name: 'W' }, { id: 2, sku: 'B2', price: 5 }], { prune: true });
    expect(actions.find((a) => a.identity === 'A1')!.before).toEqual({ sku: 'A1', price: 10 });
    expect(actions.find((a) => a.identity === 'B2')!.before).toEqual({ id: 2, sku: 'B2', price: 5 });
  });
});

describe('lock file on disk', () => {
  it('sits beside the manifest, round-trips, and refuses a foreign version', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solid-apply-lock-'));
    const manifest = path.join(dir, 'site.yaml');
    const lockPath = lockPathFor(manifest);
    expect(lockPath).toBe(path.join(dir, 'site.lock.json'));
    expect(readLock(lockPath)).toBeNull();
    const { lock } = applied([{ kind: 'page', identity: 'home', action: 'create', status: 'done', id: 1, spec: { slug: 'home' } }]);
    writeLock(lockPath, lock);
    expect(readLock(lockPath)!.resources['page/home'].id).toBe(1);
    fs.writeFileSync(lockPath, JSON.stringify({ version: 99 }));
    expect(() => readLock(lockPath)).toThrow(/lock version 99/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
