/**
 * `solid mcp install` must write an sk_ key, not the session token (which
 * expires), and must write @solidnumber/mcp@latest so npx re-resolves.
 * The config path and the key helper are mocked: nothing touches the real
 * home directory.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpinstall-'));
const cfgFile = path.join(tmpDir, 'claude.json');

jest.mock('../../lib/mcp-client-config', () => ({
  ...jest.requireActual('../../lib/mcp-client-config'),
  configPathForClient: () => cfgFile,
}));
const mockGetOrCreate = jest.fn();
jest.mock('../../lib/mcp-key', () => ({
  getOrCreateMcpApiKey: (...a: unknown[]) => mockGetOrCreate(...a),
  readMcpKey: () => null,
  defaultMcpKeyFile: () => '/nonexistent/should-not-be-read',
}));
jest.mock('../../lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), apiKeyList: jest.fn(), apiKeyCreate: jest.fn() },
  handleApiError: jest.fn(),
}));

async function install(argv: string[]) {
  let cmd: any;
  jest.isolateModules(() => { cmd = require('../../commands/mcp').mcpCommand; });
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  const err = jest.spyOn(console, 'error').mockImplementation(() => {});
  const we = jest.spyOn(process.stderr, 'write').mockImplementation((() => true) as any);
  const wo = jest.spyOn(process.stdout, 'write').mockImplementation((() => true) as any);
  try { await cmd.parseAsync(['node', 'mcp', 'install', ...argv]); }
  finally { log.mockRestore(); err.mockRestore(); we.mockRestore(); wo.mockRestore(); }
}

const prevKey = process.env.SOLID_API_KEY;
beforeEach(() => { mockGetOrCreate.mockReset(); try { fs.unlinkSync(cfgFile); } catch { /* none */ } delete process.env.SOLID_API_KEY; });
afterAll(() => { if (prevKey !== undefined) process.env.SOLID_API_KEY = prevKey; });

test('config path is the temp file, never the real home', () => {
  expect(cfgFile.startsWith(os.tmpdir())).toBe(true);
});

test('writes a minted sk_ key and @latest, not the session token', async () => {
  mockGetOrCreate.mockResolvedValue({ key: 'sk_live_minted', source: 'minted' });
  await install(['claude']);
  const written = JSON.parse(fs.readFileSync(cfgFile, 'utf-8'));
  expect(written.mcpServers.solid.env.SOLID_API_KEY).toBe('sk_live_minted');
  expect(written.mcpServers.solid.args).toEqual(['-y', '@solidnumber/mcp@latest']);
  expect(JSON.stringify(written)).not.toContain('test_token_do_not_use_in_production');
});

test('--api-key wins and nothing is minted', async () => {
  await install(['claude', '--api-key', 'sk_explicit']);
  expect(mockGetOrCreate).not.toHaveBeenCalled();
  expect(JSON.parse(fs.readFileSync(cfgFile, 'utf-8')).mcpServers.solid.env.SOLID_API_KEY).toBe('sk_explicit');
});

test('--preview mints nothing', async () => {
  await install(['claude', '--preview']);
  expect(mockGetOrCreate).not.toHaveBeenCalled();
  expect(fs.existsSync(cfgFile)).toBe(false);
});

test('falls back to the session token only when no key can be had, and warns', async () => {
  mockGetOrCreate.mockResolvedValue(null);
  const writes: string[] = [];
  let cmd: any;
  jest.isolateModules(() => { cmd = require('../../commands/mcp').mcpCommand; });
  const we = jest.spyOn(process.stderr, 'write').mockImplementation(((s: any) => { writes.push(String(s)); return true; }) as any);
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  try { await cmd.parseAsync(['node', 'mcp', 'install', 'claude']); } finally { we.mockRestore(); log.mockRestore(); }
  expect(writes.join('')).toMatch(/EXPIRES/);
});
