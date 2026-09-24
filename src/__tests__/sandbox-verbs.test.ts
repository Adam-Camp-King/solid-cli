/**
 * `solid sandbox fork/status/diff/promote/exit/preview` ride the sandbox.*
 * verbs. The old REST routes resolved the tenant from the Host header and
 * 404'd "No tenant found for this domain" through api.solidnumber.com for
 * every company; preview printed a URL even with no sandbox.
 */
import {
  VerbClient, sandboxStatus, sandboxFork, sandboxDiff, sandboxPromote, sandboxExit,
  scopeFromFlag, pageChanges, diffLines, absoluteUrl, unwrapVerb,
} from '../lib/sandbox-verbs';

function fakeClient(responses: Record<string, unknown>) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const client: VerbClient = {
    async post(url: string, body?: unknown) {
      calls.push({ url, body });
      return { data: responses[url] ?? {} };
    },
  };
  return { client, calls };
}

describe('sandbox verbs', () => {
  test('every command hits /api/v1/agent/sandbox/*, never the Host-routed /api/v1/sandbox/*', async () => {
    const { client, calls } = fakeClient({});
    await sandboxStatus(client);
    await sandboxFork(client, null);
    await sandboxDiff(client);
    await sandboxPromote(client);
    await sandboxExit(client);
    expect(calls.map((c) => c.url)).toEqual([
      '/api/v1/agent/sandbox/status', '/api/v1/agent/sandbox/fork', '/api/v1/agent/sandbox/diff',
      '/api/v1/agent/sandbox/promote', '/api/v1/agent/sandbox/exit',
    ]);
    for (const c of calls) expect(c.url.startsWith('/api/v1/sandbox/')).toBe(false);
  });

  test('writes carry confirm:true (the command is the consent); reads do not', async () => {
    const { client, calls } = fakeClient({});
    await sandboxFork(client, { pages: true });
    await sandboxPromote(client);
    await sandboxExit(client);
    await sandboxStatus(client);
    expect(calls[0].body).toEqual({ confirm: true, scope: { pages: true } });
    expect(calls[1].body).toEqual({ confirm: true });
    expect(calls[2].body).toEqual({ confirm: true });
    expect(calls[3].body).toEqual({});
  });

  test('status: no sandbox is a value, not a crash — and unwraps {ok, result}', async () => {
    const { client } = fakeClient({ '/api/v1/agent/sandbox/status': { ok: true, verb: 'sandbox.status', result: { active: false, status: 'no_sandbox' } } });
    const st = await sandboxStatus(client);
    expect(st.active).toBe(false);
    expect(unwrapVerb({ active: true })).toEqual({ active: true });
  });

  test('diff renders created and edited pages and assets', async () => {
    const diff = {
      changes: [
        { entity_type: 'website_page', entity_id: 7, change: 'created', slug: 'promo', title: 'Promo', publish_on_promote: true },
        { entity_type: 'website_page', entity_id: 3, change: 'edited', slug: 'home', fields: ['layout_json'] },
        { entity_type: 'asset', entity_id: 9, change: 'created', filename: 'hero.png' },
      ],
    };
    const { client } = fakeClient({ '/api/v1/agent/sandbox/diff': diff });
    const d = await sandboxDiff(client);
    expect(pageChanges(d).map((p) => p.entity_id)).toEqual([7, 3]);
    const lines = diffLines(d);
    expect(lines[0]).toMatch(/^\+ page #7 \/promo "Promo" — publishes on promote$/);
    expect(lines[1]).toMatch(/^~ page #3 \/home \(layout_json\)$/);
    expect(lines[2]).toBe('+ asset #9 hero.png');
  });

  test('scope flag maps to the verb scope; unknown scope is refused', () => {
    expect(scopeFromFlag('all')).toBeNull();
    expect(scopeFromFlag('pages')).toEqual({ pages: true, assets: true, kb: false, data: false });
    expect(() => scopeFromFlag('everything')).toThrow(/Unknown --scope/);
  });

  test('preview URLs are absolute', () => {
    expect(absoluteUrl('https://api.solidnumber.com/', '/api/v1/cms/pages/preview/t'))
      .toBe('https://api.solidnumber.com/api/v1/cms/pages/preview/t');
    expect(absoluteUrl('https://x', 'https://y/z')).toBe('https://y/z');
  });
});
