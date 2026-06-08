/**
 * @solidnumber/cli/client — programmatic capability facade. Verifies it wraps
 * the api-client (inheriting idempotency etc.), dispatches verbs with the right
 * body, applies a manifest in-process, and resolves auth via env.
 */
const mockCalls: Array<{ method: string; url: string; body?: unknown }> = [];

jest.mock('../lib/api-client', () => {
  const rec = (method: string) => (url: string, body?: unknown) => {
    mockCalls.push({ method, url, body });
    if (method === 'get' && url.startsWith('/api/v1/products')) {
      return Promise.resolve({ data: { products: [] }, status: 200, success: true });
    }
    if (url === '/api/v1/ada/cli-dispatch') {
      return Promise.resolve({ data: { ok: true, result: { status: 'ok' } }, status: 200, success: true });
    }
    return Promise.resolve({ data: { ok: true }, status: 200, success: true });
  };
  return { apiClient: { get: rec('get'), post: rec('post'), put: rec('put'), patch: rec('patch'), delete: rec('delete') } };
});

import { createSolidClient } from '../client';

describe('createSolidClient', () => {
  beforeEach(() => { mockCalls.length = 0; });
  afterEach(() => { delete process.env.SOLID_API_KEY; delete process.env.SOLID_COMPANY_ID; });

  it('resolves auth via env (apiKey + companyId)', () => {
    createSolidClient({ apiKey: 'sk_test_123', companyId: 76 });
    expect(process.env.SOLID_API_KEY).toBe('sk_test_123');
    expect(process.env.SOLID_COMPANY_ID).toBe('76');
  });

  it('get/post return the response body, not the envelope', async () => {
    const solid = createSolidClient();
    await expect(solid.get('/api/v1/health')).resolves.toEqual({ ok: true });
    const posted = await solid.post('/api/v1/x', { a: 1 });
    expect(posted).toEqual({ ok: true });
    expect(mockCalls).toContainEqual({ method: 'post', url: '/api/v1/x', body: { a: 1 } });
  });

  it('dispatch posts the verb envelope to cli-dispatch', async () => {
    const solid = createSolidClient();
    const out = await solid.dispatch('crm_lead_promote', { contact_id: 1 }, { confirm: true });
    expect(out).toMatchObject({ ok: true });
    expect(mockCalls).toContainEqual({
      method: 'post',
      url: '/api/v1/ada/cli-dispatch',
      body: { verb: 'crm_lead_promote', args: { contact_id: 1 }, confirm: true, typed_phrase: null },
    });
  });

  it('signalTail builds the right query', async () => {
    await createSolidClient().signalTail({ topic: 'deal.any', sinceId: 42, limit: 10 });
    const call = mockCalls.find((c) => c.url.startsWith('/api/v1/signal/tail'));
    expect(call!.url).toContain('topic=deal.any');
    expect(call!.url).toContain('since_id=42');
    expect(call!.url).toContain('limit=10');
  });

  it('apply reconciles a manifest in-process (lists then creates missing)', async () => {
    const report = await createSolidClient().apply(
      JSON.stringify([{ kind: 'product', sku: 'A1', name: 'Widget' }]),
    );
    // listed current products, found none, created one
    expect(mockCalls.find((c) => c.method === 'get' && c.url.startsWith('/api/v1/products'))).toBeTruthy();
    const create = mockCalls.find((c) => c.method === 'post' && c.url === '/api/v1/products/');
    expect(create!.body).toMatchObject({ sku: 'A1', name: 'Widget' });
    expect(report.counts.create).toBe(1);
    expect(report.results[0].status).toBe('done');
  });

  it('apply --dry-run plans without writing', async () => {
    const report = await createSolidClient().apply(
      JSON.stringify([{ kind: 'product', sku: 'A1', name: 'Widget' }]),
      { dryRun: true },
    );
    expect(mockCalls.some((c) => c.method === 'post')).toBe(false);
    expect(report.dryRun).toBe(true);
    expect(report.results[0].status).toBe('skipped');
  });

  it('exposes the supported apply kinds', () => {
    expect(createSolidClient().applyKinds()).toEqual(expect.arrayContaining(['product', 'contact', 'deal', 'webhook']));
  });
});
