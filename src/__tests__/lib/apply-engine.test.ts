import {
  parseManifest, specMatches, extractList, planKind, executePlan,
  actionIdempotencyKey, ApplyClient, PlannedAction,
} from '../../lib/apply/engine';
import { RECONCILERS } from '../../lib/apply/registry';

const product = RECONCILERS.product;
const webhook = RECONCILERS.webhook;

describe('parseManifest', () => {
  it('parses a JSON array of flat resources and resolves default identity', () => {
    const r = parseManifest(JSON.stringify([
      { kind: 'product', sku: 'A1', name: 'Widget' },
      { kind: 'contact', email: 'a@b.com', first_name: 'Ann' },
    ]));
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ kind: 'product', identity: 'A1' });
    expect(r[0].spec).toEqual({ sku: 'A1', name: 'Widget' });
    expect(r[1].identity).toBe('a@b.com');
  });

  it('parses multi-document YAML', () => {
    const r = parseManifest('kind: product\nsku: A1\nname: W\n---\nkind: product\nsku: B2\nname: X\n');
    expect(r.map((x) => x.identity)).toEqual(['A1', 'B2']);
  });

  it('parses { resources: [...] } and k8s-style {kind, metadata, spec}', () => {
    const r = parseManifest(JSON.stringify({
      resources: [{ kind: 'product', metadata: { identity: 'sku' }, spec: { sku: 'Z9', name: 'Z' } }],
    }));
    expect(r[0]).toMatchObject({ kind: 'product', identity: 'Z9' });
    expect(r[0].spec).toEqual({ sku: 'Z9', name: 'Z' });
  });

  it('honors metadata.name as identity fallback', () => {
    const r = parseManifest(JSON.stringify([{ kind: 'product', metadata: { name: 'SKU-FROM-META' }, spec: {} }]));
    expect(r[0].identity).toBe('SKU-FROM-META');
  });

  it('throws on missing kind, unknown kind, and missing identity', () => {
    expect(() => parseManifest(JSON.stringify([{ sku: 'x' }]))).toThrow(/missing "kind"/);
    expect(() => parseManifest(JSON.stringify([{ kind: 'wormhole', x: 1 }]))).toThrow(/Unknown kind/);
    expect(() => parseManifest(JSON.stringify([{ kind: 'product', name: 'no sku' }]))).toThrow(/no identity/);
  });
});

describe('specMatches', () => {
  it('is true when every declared field matches (subset semantics)', () => {
    expect(specMatches({ name: 'W' }, { name: 'W', id: 5, extra: 'server-only' })).toBe(true);
  });
  it('is false when a declared field differs or is absent', () => {
    expect(specMatches({ name: 'W', price: 10 }, { name: 'W', price: 12 })).toBe(false);
    expect(specMatches({ color: 'red' }, { name: 'W' })).toBe(false);
  });
  it('deep-compares nested objects/arrays', () => {
    expect(specMatches({ meta: { a: [1, 2] } }, { meta: { a: [1, 2] } })).toBe(true);
    expect(specMatches({ meta: { a: [1, 2] } }, { meta: { a: [1, 3] } })).toBe(false);
  });
});

describe('extractList', () => {
  it('handles arrays and common envelope shapes', () => {
    expect(extractList([{ sku: 'A' }], product)).toHaveLength(1);
    expect(extractList({ products: [{ sku: 'A' }] }, product)).toHaveLength(1);
    expect(extractList({ items: [{ sku: 'A' }] }, product)).toHaveLength(1);
    expect(extractList({ nothing: true }, product)).toEqual([]);
  });
});

describe('planKind', () => {
  const desired = parseManifest(JSON.stringify([
    { kind: 'product', sku: 'A1', name: 'Widget', price: 10 },
    { kind: 'product', sku: 'B2', name: 'Gadget', price: 20 },
  ]));

  it('creates missing, no-ops matching, updates drifted', () => {
    const current = [
      { id: 1, sku: 'A1', name: 'Widget', price: 10 },      // matches → noop
      { id: 2, sku: 'B2', name: 'Gadget', price: 99 },       // drift → update
    ];
    const actions = planKind(product, desired, current);
    expect(actions.find((a) => a.identity === 'A1')!.action).toBe('noop');
    const upd = actions.find((a) => a.identity === 'B2')!;
    expect(upd.action).toBe('update');
    expect(upd.id).toBe(2);
  });

  it('marks a missing resource for create', () => {
    const actions = planKind(product, desired, [{ id: 1, sku: 'A1', name: 'Widget', price: 10 }]);
    expect(actions.find((a) => a.identity === 'B2')!.action).toBe('create');
  });

  it('reports immutable drift as unsupported (webhook)', () => {
    const d = parseManifest(JSON.stringify([{ kind: 'webhook', url: 'https://x', events: ['a'] }]));
    const actions = planKind(webhook, d, [{ id: 9, url: 'https://x', events: ['b'] }]);
    expect(actions[0].action).toBe('unsupported');
  });

  it('prunes unmanaged current only when prune is set', () => {
    const current = [
      { id: 1, sku: 'A1', name: 'Widget', price: 10 },
      { id: 2, sku: 'B2', name: 'Gadget', price: 20 },
      { id: 3, sku: 'ORPHAN', name: 'Old', price: 1 },     // not in manifest
    ];
    expect(planKind(product, desired, current).some((a) => a.action === 'prune')).toBe(false);
    const pruned = planKind(product, desired, current, { prune: true }).find((a) => a.action === 'prune')!;
    expect(pruned.identity).toBe('ORPHAN');
    expect(pruned.id).toBe(3);
  });
});

describe('executePlan', () => {
  function fakeClient() {
    const calls: Array<{ method: string; url: string; body?: unknown; key?: string }> = [];
    const rec = (method: string) => (url: string, body?: unknown, options?: { idempotencyKey?: string }) => {
      // delete passes options as 2nd arg
      const opts = (method === 'delete' ? (body as { idempotencyKey?: string }) : options) || {};
      calls.push({ method, url, body: method === 'delete' ? undefined : body, key: opts.idempotencyKey });
      return Promise.resolve({});
    };
    const client: ApplyClient = {
      get: (() => Promise.resolve({ data: {} })) as ApplyClient['get'],
      post: rec('post') as ApplyClient['post'],
      put: rec('put') as ApplyClient['put'],
      patch: rec('patch') as ApplyClient['patch'],
      delete: rec('delete') as ApplyClient['delete'],
    };
    return { client, calls };
  }

  const actions: PlannedAction[] = [
    { kind: 'product', identity: 'A1', action: 'create', spec: { sku: 'A1', name: 'W' } },
    { kind: 'product', identity: 'B2', action: 'update', id: 2, spec: { sku: 'B2', name: 'G' } },
    { kind: 'product', identity: 'C3', action: 'prune', id: 3 },
    { kind: 'product', identity: 'D4', action: 'noop', id: 4 },
  ];

  it('dry-run performs no writes and marks everything skipped', async () => {
    const { client, calls } = fakeClient();
    const results = await executePlan(client, product, actions, true);
    expect(calls).toHaveLength(0);
    expect(results.every((r) => r.status === 'skipped')).toBe(true);
  });

  it('executes create/update/prune with idempotency keys; skips noop', async () => {
    const { client, calls } = fakeClient();
    const results = await executePlan(client, product, actions, false);
    expect(calls.map((c) => c.method)).toEqual(['post', 'patch', 'delete']);
    expect(calls.find((c) => c.method === 'patch')!.url).toBe('/api/v1/products/2');
    expect(calls.find((c) => c.method === 'delete')!.url).toBe('/api/v1/products/3');
    expect(calls.every((c) => typeof c.key === 'string' && c.key.startsWith('apply-'))).toBe(true);
    expect(results.find((r) => r.identity === 'D4')!.status).toBe('skipped');
    expect(results.filter((r) => r.status === 'done')).toHaveLength(3);
  });

  it('captures a write failure without aborting the rest', async () => {
    const { client } = fakeClient();
    client.post = () => Promise.reject(new Error('boom'));
    const results = await executePlan(client, product, actions, false);
    const created = results.find((r) => r.identity === 'A1')!;
    expect(created.status).toBe('failed');
    expect(created.error).toMatch(/boom/);
    // update + prune still ran
    expect(results.find((r) => r.identity === 'B2')!.status).toBe('done');
  });
});

describe('actionIdempotencyKey', () => {
  it('is stable for identical content and differs by content', () => {
    const a: PlannedAction = { kind: 'product', identity: 'A1', action: 'create', spec: { name: 'W' } };
    const b: PlannedAction = { kind: 'product', identity: 'A1', action: 'create', spec: { name: 'W' } };
    const c: PlannedAction = { kind: 'product', identity: 'A1', action: 'create', spec: { name: 'X' } };
    expect(actionIdempotencyKey(a)).toBe(actionIdempotencyKey(b));
    expect(actionIdempotencyKey(a)).not.toBe(actionIdempotencyKey(c));
  });
});

describe('site-publish kinds (page / site / domain / survey)', () => {
  const page = RECONCILERS.page;
  const site = RECONCILERS.site;
  const domain = RECONCILERS.domain;
  const survey = RECONCILERS.survey;

  it('registers the kinds with the real API shapes', () => {
    expect(page).toMatchObject({
      identity: 'slug', list: '/api/v1/cms/pages', updateMethod: 'patch', listKey: 'pages',
    });
    expect(site).toMatchObject({
      identity: 'slug', list: '/api/v1/sites', updateMethod: null, listKey: 'sites',
    });
    expect(domain).toMatchObject({
      identity: 'domain', list: '/api/v1/domains/custom', updateMethod: null,
    });
    expect(survey).toMatchObject({
      identity: 'title', list: '/api/v1/surveys', create: '/api/v1/surveys/create', updateMethod: 'put',
    });
  });

  it('resolves slug/domain/title identities from flat manifest entries', () => {
    const r = parseManifest(JSON.stringify([
      { kind: 'page', slug: 'about-us', title: 'About Us' },
      { kind: 'site', slug: 'main', template: 'basecamp' },
      { kind: 'domain', domain: 'acme.com', site_id: 4 },
      { kind: 'survey', title: 'Contact Us', fields: [{ name: 'email' }] },
    ]));
    expect(r.map((x) => x.identity)).toEqual(['about-us', 'main', 'acme.com', 'Contact Us']);
  });

  it('plans page create + patch update keyed by slug', () => {
    const desired = parseManifest(JSON.stringify([
      { kind: 'page', slug: 'home', title: 'Home', is_published: true },
      { kind: 'page', slug: 'contact', title: 'Contact' },
    ]));
    const current = [{ id: 11, slug: 'home', title: 'Old Home', is_published: true }];
    const actions = planKind(page, desired, current);
    const upd = actions.find((a) => a.identity === 'home')!;
    expect(upd.action).toBe('update');
    expect(upd.id).toBe(11);
    expect(actions.find((a) => a.identity === 'contact')!.action).toBe('create');
  });

  it('reports site and domain drift as unsupported (immutable kinds)', () => {
    const ds = parseManifest(JSON.stringify([{ kind: 'site', slug: 'main', template: 'horizon' }]));
    const sActions = planKind(site, ds, [{ id: 4, slug: 'main', template: 'basecamp' }]);
    expect(sActions[0].action).toBe('unsupported');

    const dd = parseManifest(JSON.stringify([{ kind: 'domain', domain: 'acme.com', site_id: 9 }]));
    const dActions = planKind(domain, dd, [{ id: 7, domain: 'acme.com', site_id: 4 }]);
    expect(dActions[0].action).toBe('unsupported');
  });

  it('extracts the bare-array domain list response', () => {
    expect(extractList([{ id: 7, domain: 'acme.com' }], domain)).toHaveLength(1);
    expect(extractList({ domains: [{ id: 7, domain: 'acme.com' }] }, domain)).toHaveLength(1);
  });

  it('updates surveys with PUT at the item path', async () => {
    const calls: Array<{ method: string; url: string }> = [];
    const client: ApplyClient = {
      get: (() => Promise.resolve({ data: {} })) as ApplyClient['get'],
      post: ((url: string) => { calls.push({ method: 'post', url }); return Promise.resolve({}); }) as ApplyClient['post'],
      put: ((url: string) => { calls.push({ method: 'put', url }); return Promise.resolve({}); }) as ApplyClient['put'],
      patch: ((url: string) => { calls.push({ method: 'patch', url }); return Promise.resolve({}); }) as ApplyClient['patch'],
      delete: ((url: string) => { calls.push({ method: 'delete', url }); return Promise.resolve({}); }) as ApplyClient['delete'],
    };
    const actions: PlannedAction[] = [
      { kind: 'survey', identity: 'Contact Us', action: 'create', spec: { title: 'Contact Us' } },
      { kind: 'survey', identity: 'Feedback', action: 'update', id: 3, spec: { title: 'Feedback' } },
    ];
    await executePlan(client, survey, actions, false);
    expect(calls).toEqual([
      { method: 'post', url: '/api/v1/surveys/create' },
      { method: 'put', url: '/api/v1/surveys/3' },
    ]);
  });

  it('parses one site manifest declaring the whole business surface', () => {
    const manifest = [
      'kind: site',
      'slug: main',
      'template: basecamp',
      '---',
      'kind: page',
      'slug: home',
      'title: Home',
      'is_published: true',
      '---',
      'kind: page',
      'slug: contact',
      'title: Contact Us',
      '---',
      'kind: domain',
      'domain: acme.com',
      '---',
      'kind: survey',
      'title: Contact Form',
      '---',
      'kind: product',
      'sku: SVC-1',
      'name: Consultation',
      'price: 99',
    ].join('\n');
    const r = parseManifest(manifest);
    expect(r.map((x) => x.kind)).toEqual(['site', 'page', 'page', 'domain', 'survey', 'product']);
  });
});
