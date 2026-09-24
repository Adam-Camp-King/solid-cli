/**
 * `--limit` must reach the route under the name that route reads.
 *
 * ⛔ THE BUG CLASS. A query parameter the server does not declare is DROPPED by
 * FastAPI without a word, so the route answers with its own default and the
 * response looks perfectly healthy. `crm contacts --limit=2` returned all 31
 * contacts with `limit: 100` on the envelope (found 2026-09-23); `blog list`
 * did the same, and its `--status` filter never filtered anything either. It is
 * the same defect the audit filters had — sent as `user_email`/`action_type`
 * against a route that reads `user_id`/`event_type`.
 *
 * ⚠️ WHY THIS FILE IS BEHAVIOURAL AND NOT A SOURCE GREP. The existing
 * blog.test.ts checks the source text for endpoints, and it was green across
 * the whole life of this bug: the URL was always right, only the parameter
 * names were wrong. Reading the request the command actually issues is the only
 * check that can see it. Each expectation below names the route it is pinned to
 * so the pair can be re-read together:
 *
 *   /api/v1/crm/contacts      controllers/crm.py::list_contacts
 *                             search, source, tags, crm_company_id, has_ai,
 *                             sort, limit, offset
 *   /api/v1/cms/blog/posts    controllers/blog_posts.py::list_posts
 *                             published, category, featured, search, skip, limit
 */
jest.mock('ora', () => ({
  __esModule: true,
  default: () => ({
    start: jest.fn().mockReturnThis(), stop: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(), fail: jest.fn().mockReturnThis(),
    warn: jest.fn().mockReturnThis(),
  }),
}));
jest.mock('chalk', () => {
  const make = (): any => new Proxy(function (...a: any[]) {
    return a.length === 1 && typeof a[0] === 'string' && a[0].startsWith('#') ? make() : a.join(' ');
  }, { get: () => make() });
  return { __esModule: true, default: make() };
});
jest.mock('../../lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
  failApi: jest.fn(),
}));
jest.mock('../../lib/config', () => ({
  config: { isLoggedIn: () => true, apiUrl: 'https://api.test', companyId: 3 },
}));

import { apiClient } from '../../lib/api-client';

const mockGet = apiClient.get as jest.Mock;

/** Drive a command the way the real binary does, capturing stdout. */
async function run(modulePath: string, exportName: string, argv: string[]) {
  let cmd: any;
  jest.isolateModules(() => { cmd = require(modulePath)[exportName]; });
  const out: string[] = [];
  const log = jest.spyOn(console, 'log').mockImplementation((...a: any[]) => { out.push(a.join(' ')); });
  const err = jest.spyOn(console, 'error').mockImplementation((...a: any[]) => { out.push(`ERR ${a.join(' ')}`); });
  const write = jest.spyOn(process.stdout, 'write').mockImplementation(((s: any) => { out.push(String(s)); return true; }) as any);
  try {
    await cmd.parseAsync(['node', exportName, ...argv]);
  } finally {
    log.mockRestore(); err.mockRestore(); write.mockRestore();
  }
  return out.join('\n');
}

beforeEach(() => mockGet.mockReset());

// ---------------------------------------------------------------------------
// crm contacts
// ---------------------------------------------------------------------------

describe('crm contacts list', () => {
  const rows = { contacts: [{ id: 1, status: 'new', contact_type: 'lead' }], total: 31, limit: 100, offset: 0 };

  test('sends limit — the name list_contacts declares — not page_size', async () => {
    mockGet.mockResolvedValue({ data: rows });
    await run('../../commands/crm', 'crmCommand', ['contacts', '--limit', '2']);
    const [url, opts] = mockGet.mock.calls[0];
    expect(url).toBe('/api/v1/crm/contacts');
    expect(opts.params).toMatchObject({ limit: 2, offset: 0 });
    expect(opts.params).not.toHaveProperty('page_size');
  });

  test('the attached form carries the same value', async () => {
    mockGet.mockResolvedValue({ data: rows });
    await run('../../commands/crm', 'crmCommand', ['contacts', '--limit=7']);
    expect(mockGet.mock.calls[0][1].params).toMatchObject({ limit: 7 });
  });

  test('--all paginates with limit too, not page_size', async () => {
    mockGet.mockResolvedValue({ data: { contacts: [], total: 0 } });
    await run('../../commands/crm', 'crmCommand', ['contacts', '--all']);
    expect(mockGet.mock.calls[0][1].params).not.toHaveProperty('page_size');
    expect(mockGet.mock.calls[0][1].params).toHaveProperty('limit');
  });

  test('search and source DO go to the server — they are real parameters', async () => {
    mockGet.mockResolvedValue({ data: rows });
    await run('../../commands/crm', 'crmCommand', ['contacts', '--search', 'dana', '--source', 'voice']);
    expect(mockGet.mock.calls[0][1].params).toMatchObject({ search: 'dana', source: 'voice' });
  });

  test('status and contact_type are NOT sent — the route would ignore them', async () => {
    // `status` is derived per row inside list_contacts from order activity, and
    // `contact_type` is simply not a parameter. Sending either is the same lie
    // as sending page_size, so they are applied to the rows instead.
    mockGet.mockResolvedValue({ data: rows });
    await run('../../commands/crm', 'crmCommand', ['contacts', '--status', 'new', '--type', 'lead']);
    const params = mockGet.mock.calls[0][1].params;
    expect(params).not.toHaveProperty('status');
    expect(params).not.toHaveProperty('contact_type');
  });

  test('a locally applied filter says so, and leaves no count it no longer describes', async () => {
    mockGet.mockResolvedValue({ data: {
      items: [{ id: 1, status: 'new' }, { id: 2, status: 'active' }],
      total: 31, limit: 2, offset: 0,
    } });
    const out = await run('../../commands/crm', 'crmCommand',
      ['contacts', '--limit', '2', '--status', 'new', '--json']);
    const body = JSON.parse(out.slice(out.indexOf('{')));
    expect(body.items).toHaveLength(1);
    expect(body.count).toBe(1);
    expect(body.filtered_locally).toEqual(['status']);
    expect(body.filter_scope).toContain('this page');
    // The server's 31 described its own page, not this subset.
    expect(body.total).not.toBe(31);
  });

  test('filtering writes back to the key the rows arrived on, leaving no stale copy', async () => {
    mockGet.mockResolvedValue({ data: {
      items: [{ id: 1, status: 'new' }, { id: 2, status: 'active' }], total: 2,
    } });
    const out = await run('../../commands/crm', 'crmCommand',
      ['contacts', '--status', 'new', '--json']);
    const body = JSON.parse(out.slice(out.indexOf('{')));
    // An unfiltered list left behind under a second name is worse than none.
    expect(body.contacts).toBeUndefined();
    expect(body.items).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// blog list
// ---------------------------------------------------------------------------

describe('blog list', () => {
  const posts = { posts: [{ id: 1, title: 'Hello', published: true }], total: 1 };

  test('sends limit and skip — list_posts declares those, not page_size/page', async () => {
    mockGet.mockResolvedValue({ data: posts });
    await run('../../commands/blog', 'blogCommand', ['list', '--limit', '2']);
    const [url, opts] = mockGet.mock.calls[0];
    expect(url).toBe('/api/v1/cms/blog/posts');
    expect(opts.params).toMatchObject({ limit: 2, skip: 0 });
    expect(opts.params).not.toHaveProperty('page_size');
    expect(opts.params).not.toHaveProperty('page');
  });

  test('--status published becomes the boolean the route reads', async () => {
    mockGet.mockResolvedValue({ data: posts });
    await run('../../commands/blog', 'blogCommand', ['list', '--status', 'published']);
    const params = mockGet.mock.calls[0][1].params;
    expect(params).toMatchObject({ published: true });
    expect(params).not.toHaveProperty('status');
  });

  test('--status draft becomes published=false', async () => {
    mockGet.mockResolvedValue({ data: posts });
    await run('../../commands/blog', 'blogCommand', ['list', '--status', 'draft']);
    expect(mockGet.mock.calls[0][1].params).toMatchObject({ published: false });
  });

  test('an unknown status is refused rather than silently dropped', async () => {
    // It raises, command-kit turns that into an error envelope and exits — the
    // test harness makes that exit throw. What matters is that it does NOT
    // quietly fall through and list every post as though nothing was asked.
    mockGet.mockResolvedValue({ data: posts });
    await expect(
      run('../../commands/blog', 'blogCommand', ['list', '--status', 'archived']),
    ).rejects.toThrow(/process\.exit/);
    expect(mockGet).not.toHaveBeenCalled();
  });
});
