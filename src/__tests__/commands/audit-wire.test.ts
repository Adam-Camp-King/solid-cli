/**
 * `solid audit` against the backend's REAL response shapes — behavioural.
 *
 * Three silent failures, found by reading both sides (2026-09-23):
 *  · filters were sent as user_email / action_type; the route takes user_id /
 *    event_type, so every filter returned the unfiltered log;
 *  · rows were read as action / user_email / entity_type, which the backend
 *    never sends, so the columns printed blank;
 *  · `audit export -o` wrote the JSON envelope, not the CSV in `content`.
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
  // Chainable and callable, including chalk.bold.hex('#abc')(text) as ui.header uses.
  const make = (): any => new Proxy(function (...a: any[]) {
    return a.length === 1 && typeof a[0] === 'string' && a[0].startsWith('#') ? make() : a.join(' ');
  }, { get: () => make() });
  return { __esModule: true, default: make() };
});
jest.mock('../../lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn() },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));
jest.mock('../../lib/config', () => ({
  config: { isLoggedIn: () => true, apiUrl: 'https://api.test', companyId: 3 },
}));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { apiClient } from '../../lib/api-client';

const mockGet = apiClient.get as jest.Mock;

async function run(argv: string[]) {
  let cmd: any;
  jest.isolateModules(() => { cmd = require('../../commands/audit').auditCommand; });
  const out: string[] = [];
  const log = jest.spyOn(console, 'log').mockImplementation((...a: any[]) => { out.push(a.join(' ')); });
  const err = jest.spyOn(console, 'error').mockImplementation((...a: any[]) => { out.push(`ERR ${a.join(' ')}`); });
  const write = jest.spyOn(process.stdout, 'write').mockImplementation(((s: any) => { out.push(String(s)); return true; }) as any);
  try {
    await cmd.parseAsync(['node', 'audit', ...argv]);
  } catch (e) {
    throw new Error(`${(e as Error).message}\n${out.join('\n')}`);
  } finally {
    log.mockRestore(); err.mockRestore(); write.mockRestore();
  }
  return out.join('\n');
}

beforeEach(() => mockGet.mockReset());

test('filters go out under the names the route reads', async () => {
  mockGet.mockResolvedValue({ data: { logs: [], total: 0, scoped_to: { company_id: 3 } } });
  await run(['--user', '7', '--action', 'auth.login_failed']);
  const [url, opts] = mockGet.mock.calls[0];
  expect(url).toBe('/api/v1/security/audit/logs');
  expect(opts.params).toMatchObject({ user_id: 7, event_type: 'auth.login_failed' });
  expect(opts.params).not.toHaveProperty('user_email');
  expect(opts.params).not.toHaveProperty('action_type');
});

test('rows print the fields the backend actually returns', async () => {
  mockGet.mockResolvedValue({ data: {
    total: 1, scoped_to: { company_id: 3 },
    logs: [{ timestamp: '2026-09-23T10:00:00', event_type: 'auth.login_failed',
             user_id: 7, channel: 'cli', ip_address: '203.0.113.9' }],
  } });
  const out = await run([]);
  expect(out).toContain('auth.login_failed');
  expect(out).toContain('cli · 203.0.113.9');
  expect(out).toContain('company 3');
});

test('export -o writes the CSV content, not the envelope', async () => {
  const csv = 'timestamp,event_type\n2026-09-23,auth.login\n';
  mockGet.mockResolvedValue({ data: { success: true, format: 'csv', content: csv, record_count: 1,
                                     total_matching: 1, truncated: false } });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'audit-')), 'out.csv');
  await run(['export', '-o', file]);
  expect(mockGet.mock.calls[0][1].params).toEqual({ format: 'csv' });
  expect(fs.readFileSync(file, 'utf-8')).toBe(csv);
});

// ---------------------------------------------------------------------------
// ⛔ THE OPTION VALUE IS NOT A SUBCOMMAND — and why the tests above missed it.
// ---------------------------------------------------------------------------
// `solid audit --limit 3` failed on a real terminal with "Unknown command:
// solid audit 3". The guard in the action sliced the REAL process.argv after
// "audit" and dropped anything starting with "-" — which drops the FLAG and
// keeps its VALUE. Every option on this command takes a value, so the ordinary
// space-separated syntax was broken for all of them, and only `--limit=3` worked.
//
// ⚠️ The test above passes `--user 7 --action …` in exactly that broken form and
// was GREEN throughout, because under Jest process.argv holds Jest's own argv:
// it never contains "audit", so the guard found nothing to complain about and
// the code path under test was never the code path that ran. A test that reads
// parsed argv cannot see a bug in code that reads the process's argv. These set
// process.argv to what a shell would really pass.
describe('option values written with a space are not read as subcommands', () => {
  const realArgv = process.argv;
  let exited: number | null;
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    exited = null;
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(((c?: number) => {
      exited = c ?? 0;
      throw new Error(`process.exit(${exited})`);
    }) as any);
  });
  afterEach(() => { process.argv = realArgv; exitSpy.mockRestore(); });

  test('--limit 3 reaches the route as limit=3 and does not exit', async () => {
    mockGet.mockResolvedValue({ data: { logs: [], total: 0, scoped_to: { company_id: 3 } } });
    process.argv = ['node', '/usr/local/bin/solid', 'audit', '--limit', '3'];
    await run(['--limit', '3']);
    expect(exited).toBeNull();
    expect(mockGet.mock.calls[0][1].params).toMatchObject({ limit: '3' });
  });

  test('--action auth.login filters, written with a space', async () => {
    mockGet.mockResolvedValue({ data: { logs: [], total: 0, scoped_to: { company_id: 3 } } });
    process.argv = ['node', '/usr/local/bin/solid', 'audit', '--action', 'auth.login'];
    await run(['--action', 'auth.login']);
    expect(exited).toBeNull();
    expect(mockGet.mock.calls[0][1].params).toMatchObject({ event_type: 'auth.login' });
  });

  test('the attached form still works — it was the only one that did', async () => {
    mockGet.mockResolvedValue({ data: { logs: [], total: 0, scoped_to: { company_id: 3 } } });
    process.argv = ['node', '/usr/local/bin/solid', 'audit', '--limit=3'];
    await run(['--limit=3']);
    expect(exited).toBeNull();
    expect(mockGet.mock.calls[0][1].params).toMatchObject({ limit: '3' });
  });

  // The audit-specific guard is GONE, so something else must still catch a
  // genuine typo. That job belongs to the root program's forbidExcessArgs()
  // walk (src/index.ts), which sets allowExcessArguments(false) on every
  // command — `audit` declares no arguments, so any operand is excess. Asserted
  // the way it really happens: through a parent, not on the bare command, which
  // is permissive on its own under Commander 12.
  test('a real typo is still rejected before any request is made', async () => {
    const { Command } = require('commander');
    let audit: any;
    jest.isolateModules(() => { audit = require('../../commands/audit').auditCommand; });
    const program = new Command('solid').exitOverride();
    program.addCommand(audit);
    (function forbid(c: any) { c.allowExcessArguments(false); c.exitOverride(); c.commands.forEach(forbid); })(program);
    process.argv = ['node', '/usr/local/bin/solid', 'audit', 'bogus'];
    await expect(
      program.parseAsync(['node', 'solid', 'audit', 'bogus']),
    ).rejects.toThrow(/too many arguments/i);
    expect(mockGet).not.toHaveBeenCalled();
  });

  test('and the same parent still lets an option value through', async () => {
    mockGet.mockResolvedValue({ data: { logs: [], total: 0, scoped_to: { company_id: 3 } } });
    const { Command } = require('commander');
    let audit: any;
    jest.isolateModules(() => { audit = require('../../commands/audit').auditCommand; });
    const program = new Command('solid').exitOverride();
    program.addCommand(audit);
    (function forbid(c: any) { c.allowExcessArguments(false); c.exitOverride(); c.commands.forEach(forbid); })(program);
    process.argv = ['node', '/usr/local/bin/solid', 'audit', '--limit', '3'];
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await program.parseAsync(['node', 'solid', 'audit', '--limit', '3']);
    } finally { log.mockRestore(); }
    expect(mockGet.mock.calls[0][1].params).toMatchObject({ limit: '3' });
  });
});
