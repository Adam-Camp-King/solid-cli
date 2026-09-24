/**
 * `solid keys rotate` used to revoke the old key BEFORE creating the new one,
 * so a failed create left the caller with no working key. It also had no
 * --add-scope, which every SCOPE_MISSING hint told people to run.
 */
jest.mock('ora', () => ({
  __esModule: true,
  default: () => ({
    start: jest.fn().mockReturnThis(), stop: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(), fail: jest.fn().mockReturnThis(),
    warn: jest.fn().mockReturnThis(),
  }),
}));
jest.mock('../../lib/api-client', () => ({
  apiClient: { apiKeyList: jest.fn(), apiKeyCreate: jest.fn(), apiKeyRevoke: jest.fn() },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));

import { apiClient } from '../../lib/api-client';
import { config } from '../../lib/config';

const list = apiClient.apiKeyList as jest.Mock;
const create = apiClient.apiKeyCreate as jest.Mock;
const revoke = apiClient.apiKeyRevoke as jest.Mock;

const OLD = { id: 7, name: 'ci', key_prefix: 'sk_live_FAKE_abcdefghijklmnopq...', scopes: ['kb:read'], is_active: true, require_approval: true };

async function run(argv: string[]) {
  let cmd: any;
  jest.isolateModules(() => { cmd = require('../../commands/keys').keysCommand; });
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  const err = jest.spyOn(console, 'error').mockImplementation(() => {});
  const w = jest.spyOn(process.stdout, 'write').mockImplementation((() => true) as any);
  const we = jest.spyOn(process.stderr, 'write').mockImplementation((() => true) as any);
  try { await cmd.parseAsync(['node', 'keys', ...argv]); }
  finally { log.mockRestore(); err.mockRestore(); w.mockRestore(); we.mockRestore(); }
}

beforeEach(() => {
  list.mockReset(); create.mockReset(); revoke.mockReset();
  list.mockResolvedValue({ data: { api_keys: [OLD], count: 1, available_scopes: [] } });
});

test('creates the replacement first, with --add-scope merged, then revokes', async () => {
  const order: string[] = [];
  create.mockImplementation(async () => { order.push('create'); return { data: { key: 'sk_new', api_key: { id: 8, name: 'ci', scopes: ['kb:read', 'verbs:write', 'crm:write'] } } }; });
  revoke.mockImplementation(async () => { order.push('revoke'); return { data: {} }; });
  await run(['rotate', '7', '--add-scope', 'verbs:write', '--add-scope', 'crm:write']);
  expect(order).toEqual(['create', 'revoke']);
  expect(create).toHaveBeenCalledWith('ci', ['kb:read', 'verbs:write', 'crm:write'], undefined, { require_approval: true });
  expect(revoke).toHaveBeenCalledWith(7);
});

test('a failed create never revokes the old key', async () => {
  create.mockRejectedValue(new Error('boom'));
  await expect(run(['rotate', '7', '--add-scope', 'verbs:write'])).rejects.toThrow(/process.exit/);
  expect(revoke).not.toHaveBeenCalled();
});

test('--keep-old creates without revoking', async () => {
  create.mockResolvedValue({ data: { key: 'sk_new', api_key: { id: 8, name: 'ci', scopes: ['kb:read'] } } });
  await run(['rotate', '7', '--keep-old']);
  expect(revoke).not.toHaveBeenCalled();
});

test('no key id rotates the sk_ key the CLI is using', async () => {
  // config is the global jest mock (src/__tests__/setup.ts): a plain object.
  const token = 'sk_live_FAKE_abcdefghijklmnopqRESTOFKEY';
  (config as any).effectiveToken = token;
  create.mockResolvedValue({ data: { key: 'sk_new', api_key: { id: 8, name: 'ci', scopes: ['kb:read', 'verbs:write'] } } });
  revoke.mockResolvedValue({ data: {} });
  try {
    await run(['rotate', '--add-scope', 'verbs:write']);
  } finally {
    (config as any).effectiveToken = 'test_token_do_not_use_in_production';
  }
  expect(create).toHaveBeenCalledWith('ci', ['kb:read', 'verbs:write'], undefined, { require_approval: true });
  expect(revoke).toHaveBeenCalledWith(7);
});

test('no key id and a session token → refuses, touches nothing', async () => {
  await expect(run(['rotate', '--add-scope', 'verbs:write'])).rejects.toThrow(/process.exit/);
  expect(create).not.toHaveBeenCalled();
  expect(revoke).not.toHaveBeenCalled();
});
