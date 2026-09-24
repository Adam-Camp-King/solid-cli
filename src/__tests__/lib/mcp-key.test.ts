/**
 * The MCP client config must carry a long-lived sk_ key for THIS company —
 * never the expiring session token, and never a cached key left over from
 * another company. Every path here is an explicit temp file: nothing reads or
 * writes the real ~/.solid (os.homedir() is not isolated under Jest).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getOrCreateMcpApiKey, keyIsListed, MCP_KEY_NAME } from '../../lib/mcp-key';

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mcpkey-')), 'mcp-key');
const REAL = path.join(os.homedir(), '.solid', 'mcp-key');

function api(keys: Array<{ key_prefix: string; is_active?: boolean }>, newKey = 'sk_live_FAKE_NEWKEYNEWKEYNEWKEYNEWKEY_rest') {
  return {
    apiKeyList: jest.fn(async () => ({ data: { api_keys: keys, available_scopes: ['kb:read', 'verbs:write'] } })),
    apiKeyCreate: jest.fn(async () => ({ data: { key: newKey } })),
  };
}

test('never resolves to the real home file in these tests', () => {
  expect(tmpFile()).not.toBe(REAL);
});

test('reuses a cached key that is active on this company', async () => {
  const f = tmpFile();
  fs.writeFileSync(f, 'sk_live_FAKE_abcdefghijklmnopqREST');
  const a = api([{ key_prefix: 'sk_live_FAKE_abcdefghijklmnopq...', is_active: true }]);
  expect(await getOrCreateMcpApiKey(a, f)).toEqual({ key: 'sk_live_FAKE_abcdefghijklmnopqREST', source: 'cached' });
  expect(a.apiKeyCreate).not.toHaveBeenCalled();
});

test('mints (and caches) a new key when the cached one belongs to another company', async () => {
  const f = tmpFile();
  fs.writeFileSync(f, 'sk_live_FAKE_OTHERCOMPANYKEYxxxxxREST');
  const a = api([{ key_prefix: 'sk_live_FAKE_abcdefghijklmnopq...', is_active: true }]);
  const got = await getOrCreateMcpApiKey(a, f);
  expect(got?.source).toBe('minted');
  expect(a.apiKeyCreate).toHaveBeenCalledWith(MCP_KEY_NAME, ['kb:read', 'verbs:write']);
  expect(fs.readFileSync(f, 'utf-8')).toBe(got?.key);
});

test('a revoked cached key is not reused', async () => {
  const f = tmpFile();
  fs.writeFileSync(f, 'sk_live_FAKE_abcdefghijklmnopqREST');
  const a = api([{ key_prefix: 'sk_live_FAKE_abcdefghijklmnopq...', is_active: false }]);
  expect((await getOrCreateMcpApiKey(a, f))?.source).toBe('minted');
});

test('keyIsListed matches on the published prefix', () => {
  expect(keyIsListed('sk_abcdef', [{ key_prefix: 'sk_abc...' }])).toBe(true);
  expect(keyIsListed('sk_xyz', [{ key_prefix: 'sk_abc...' }])).toBe(false);
  expect(keyIsListed('sk_abc', [{ key_prefix: '...' }])).toBe(false);
});
