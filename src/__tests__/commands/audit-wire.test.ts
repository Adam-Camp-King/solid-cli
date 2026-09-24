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
