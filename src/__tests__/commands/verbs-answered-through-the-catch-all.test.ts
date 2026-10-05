/**
 * Commands whose verb is served by the backend's catch-all read the verb's answer.
 *
 * ⛔ WHY THIS EXISTS. See lib/verb-envelope.ts. `solid app get` printed
 * "undefined  undefined  (offline)" for a live app; `solid notes add` printed
 * "Note #undefined added (undefined)"; `solid history recent` and `solid code
 * history` printed empty lists. Each test answers the way the server does.
 */
import { jest } from '@jest/globals';

import { asDispatched } from '../../lib/verb-envelope';

jest.mock('chalk', () => {
  const id = (s: string) => s;
  const proxy: any = new Proxy(id, { get: () => proxy });
  return { __esModule: true, default: proxy };
});
jest.mock('../../lib/spinner', () => {
  const lines: string[] = (globalThis as any).__spin = [];
  const spin = { start: () => spin, stop: () => spin, succeed: (m: string) => { lines.push(m); return spin; }, fail: (m: string) => { lines.push(m); return spin; } };
  return { __esModule: true, default: () => spin };
});

const post = jest.fn<any>();
jest.mock('../../lib/api-client', () => ({
  apiClient: { post: (...a: unknown[]) => post(...a), get: jest.fn() },
  handleApiError: (e: Error) => ({ message: e.message }),
  failApi: jest.fn(() => { throw new Error('FAILAPI'); }),
}));
jest.mock('../../lib/config', () => ({ config: { isLoggedIn: () => true, companyId: 78 } }));

/* eslint-disable @typescript-eslint/no-var-requires */
const { appCommand } = require('../../commands/app');
const { notesCommand } = require('../../commands/notes');
const { codeCommand } = require('../../commands/code');
const { historyCommand } = require('../../commands/history');

const GET = {
  ok: true, slug: 'sell', status: 'active', url: 'https://trade-now.solidhost.app/sell/', live_version: 1,
  versions: [{ n: 1, published_at: '2026-10-02T15:14:37+00:00', files: 3, bytes: 720629, source: 'upload' }],
  warnings: [], outside_hosts: [],
};

async function run(root: any, argv: string[]): Promise<string> {
  const out: string[] = [];
  const spun: string[] = (globalThis as any).__spin;
  spun.length = 0;
  const log = jest.spyOn(console, 'log').mockImplementation((...a) => { out.push(a.join(' ')); });
  const err = jest.spyOn(console, 'error').mockImplementation((...a) => { out.push(a.join(' ')); });
  const write = jest.spyOn(process.stdout, 'write').mockImplementation((s: any) => (out.push(String(s)), true));
  try {
    for (const c of [root, ...root.commands]) { c._optionValues = {}; c._optionValueSources = {}; }
    await root.parseAsync(['node', 'solid', ...argv]);
  } finally {
    log.mockRestore(); err.mockRestore(); write.mockRestore();
  }
  return [...spun, ...out].join('\n');
}

beforeEach(() => { post.mockReset(); process.exitCode = 0; });

describe('solid app', () => {
  it('get prints the live app, not "undefined undefined (offline)"', async () => {
    post.mockResolvedValue({ data: asDispatched('app.get', GET) });
    const text = await run(appCommand, ['get', 'sell']);
    expect(text).toContain('sell  active  https://trade-now.solidhost.app/sell/');
    expect(text).toContain('v1 (live)');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('(offline)');
  });

  it('get --json still prints the answer as the server sent it', async () => {
    const sent = asDispatched('app.get', GET);
    post.mockResolvedValue({ data: sent });
    const text = await run(appCommand, ['get', 'sell', '--json']);
    expect(JSON.parse(text)).toEqual(sent);
  });

  it('list reads the apps out of the envelope', async () => {
    post.mockResolvedValue({ data: asDispatched('app.list', { ok: true, apps: [{ slug: 'sell', status: 'active', live_version: 1, url: GET.url }] }) });
    const text = await run(appCommand, ['list']);
    expect(text).toContain('sell  active  v1  https://trade-now.solidhost.app/sell/');
    expect(text).not.toContain('No apps published yet');
  });

  it('rollback names the version and address that are live', async () => {
    post.mockResolvedValue({ data: asDispatched('app.rollback', { ok: true, live_version: 1, url: GET.url }) });
    const text = await run(appCommand, ['rollback', 'sell', '1', '--confirm']);
    expect(text).toContain('sell v1 is live: https://trade-now.solidhost.app/sell/');
  });
});

describe('solid notes / code / history', () => {
  it('notes add names the note it added', async () => {
    post.mockResolvedValue({ data: asDispatched('notes.add', { note_id: 41, note_type: 'decision' }) });
    const text = await run(notesCommand, ['add', 'Use the judged search']);
    expect(text).toContain('Note #41 added (decision)');
    expect(text).not.toContain('undefined');
  });

  it('notes search counts the results it was given', async () => {
    post.mockResolvedValue({ data: asDispatched('notes.search', { method: 'semantic', results: [{ id: 1, content: 'a', note_type: 'x' }, { id: 2, content: 'b', note_type: 'x' }] }) });
    const text = await run(notesCommand, ['search', 'judged']);
    expect(text).toContain('2 result(s) via semantic');
  });

  it('code history lists the changes inside the envelope', async () => {
    // Keys as the backend publishes them for code.history: history, total.
    post.mockResolvedValue({ data: asDispatched('code.history', { history: [{ system: 'cms', type: 'page', id: 5, version: 3, verb: 'page.update', at: '2026-10-04T00:00:00Z' }], total: 1 }) });
    const text = await run(codeCommand, ['history']);
    expect(text).toContain('1 changes');
    expect(text).toContain('[cms] page #5  v3');
  });

  it('history recent counts the versions inside the envelope', async () => {
    // Keys as the backend publishes them for history.recent: changes, total.
    post.mockResolvedValue({ data: asDispatched('history.recent', { changes: [{ entity_type: 'page', entity_id: 7, version: 2, verb_name: 'page.update', created_at: '2026-10-04T00:00:00Z' }], total: 1 }) });
    const text = await run(historyCommand, ['recent']);
    expect(text).toContain('1 recent changes');
    expect(text).toContain('page #7  v2');
  });

  it('--json still prints the answer as sent', async () => {
    const sent = asDispatched('notes.add', { note_id: 41, note_type: 'decision' });
    post.mockResolvedValue({ data: sent });
    const text = await run(notesCommand, ['add', 'x', '--json']);
    expect(JSON.parse(text)).toEqual(sent);
  });
});
