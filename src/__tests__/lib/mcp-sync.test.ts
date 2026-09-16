/**
 * The AI credential must follow the CLI's company.
 *
 * 2026-09-15: `claude` reads a STATIC SOLID_API_KEY from ~/.claude.json and the
 * backend takes the tenant from the key record. Logging in or switching writes
 * ~/.solid/config.json — a file the MCP server never opens — so the agent stayed
 * on whatever company the key was minted for, and answered confidently about it.
 */
import * as fs from 'fs';

import { syncMcpCredential, describeMcpSync } from '../../lib/mcp-sync';

jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

const CONFIG = { mcpServers: { solid: { env: { SOLID_API_KEY: 'sk_old' } } } };

function withConfig(json: unknown = CONFIG) {
  mockFs.existsSync.mockReturnValue(true as never);
  mockFs.readFileSync.mockReturnValue(JSON.stringify(json) as never);
  mockFs.writeFileSync.mockImplementation(() => undefined);
}

const keyResolvesTo = (companyId: number) =>
  jest.fn().mockResolvedValue({ ok: true, json: async () => ({ user: { company_id: companyId } }) });

beforeEach(() => jest.resetAllMocks());

it('re-points the credential when the key belongs to another company', async () => {
  withConfig();
  (global as any).fetch = keyResolvesTo(1);
  const createKey = jest.fn().mockResolvedValue('sk_new_for_61');

  const r = await syncMcpCredential(61, { apiUrl: 'https://x', createKey }, ['vscode']);

  expect(r.status).toBe('updated');
  expect(createKey).toHaveBeenCalledTimes(1);
  expect(mockFs.writeFileSync).toHaveBeenCalled();
  // The NEW key must actually reach the file the agent reads.
  expect(String(mockFs.writeFileSync.mock.calls[0][1])).toContain('sk_new_for_61');
});

it('⛔ does nothing when the key already matches — no mint, no write', async () => {
  // Re-minting on every login would burn the 25-active-keys-per-company cap
  // and leave orphaned credentials nobody can attribute.
  withConfig();
  (global as any).fetch = keyResolvesTo(61);
  const createKey = jest.fn();

  const r = await syncMcpCredential(61, { apiUrl: 'https://x', createKey }, ['vscode']);

  expect(r.status).toBe('ok');
  expect(createKey).not.toHaveBeenCalled();
  expect(mockFs.writeFileSync).not.toHaveBeenCalled();
});

it('⛔ treats an unresolvable key as NOT stale', async () => {
  // A network blip must never cause us to mint a key and overwrite a config
  // that was perfectly correct.
  withConfig();
  (global as any).fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
  const createKey = jest.fn();

  const r = await syncMcpCredential(61, { apiUrl: 'https://x', createKey }, ['vscode']);

  expect(r.status).toBe('ok');
  expect(createKey).not.toHaveBeenCalled();
  expect(mockFs.writeFileSync).not.toHaveBeenCalled();
});

it('skips when no Solid MCP server is configured', async () => {
  withConfig({ mcpServers: { github: {} } });
  const createKey = jest.fn();

  const r = await syncMcpCredential(61, { apiUrl: 'https://x', createKey }, ['vscode']);

  expect(r.status).toBe('skipped');
  expect(createKey).not.toHaveBeenCalled();
});

it('skips when the session has no company', async () => {
  withConfig();
  const createKey = jest.fn();
  expect((await syncMcpCredential(undefined, { apiUrl: 'https://x', createKey })).status).toBe('skipped');
  expect(createKey).not.toHaveBeenCalled();
});

it('reports failure without throwing when the key cannot be minted', async () => {
  // A login must not fail because the credential sync did.
  withConfig();
  (global as any).fetch = keyResolvesTo(1);
  const createKey = jest.fn().mockRejectedValue(new Error('403 forbidden'));

  const r = await syncMcpCredential(61, { apiUrl: 'https://x', createKey }, ['vscode']);

  expect(r.status).toBe('failed');
  expect(r.reason).toMatch(/403/);
  expect(mockFs.writeFileSync).not.toHaveBeenCalled();
});

describe('describeMcpSync', () => {
  it('stays silent when nothing changed', () => {
    expect(describeMcpSync({ status: 'ok', companyId: 61, written: [] })).toBeNull();
    expect(describeMcpSync({ status: 'skipped', companyId: 61, written: [] })).toBeNull();
  });

  it('names the remedy on failure', () => {
    const msg = describeMcpSync({ status: 'failed', companyId: 61, written: [], reason: 'nope' });
    expect(msg).toContain('solid mcp install --company 61');
  });
});


/**
 * ⛔ THE ENTRY WITH NO KEY AT ALL — the case this function used to skip.
 *
 * Measured on the reporting machine 2026-09-15, ~/.claude.json held:
 *
 *   "solid": { "command": "npx", "args": ["-y", "@solidnumber/mcp"],
 *              "env": { "SOLID_API_URL": "https://api.solidnumber.com" } }
 *
 * No SOLID_API_KEY. The sync looked for targets with `readMcpApiKey`, which
 * returns null without a key, found none, and returned
 * `skipped: no Solid MCP server configured` — on a machine that plainly HAD one.
 * So every login and every switch left that server authenticating as nobody,
 * and reported success while doing it. A server that cannot authenticate is the
 * case most in need of repair, and it was the one case we walked past.
 */
it('mints a key for a Solid server that has none, instead of reporting "skipped"', async () => {
  withConfig({
    mcpServers: {
      solid: { command: 'npx', args: ['-y', '@solidnumber/mcp'], env: { SOLID_API_URL: 'https://api.solidnumber.com' } },
    },
  });
  // No key to resolve, so fetch must never be needed to reach the right answer.
  (global as any).fetch = jest.fn(() => { throw new Error('should not be called'); });
  const createKey = jest.fn().mockResolvedValue('sk_minted_for_61');

  const r = await syncMcpCredential(61, { apiUrl: 'https://x', createKey }, ['vscode']);

  expect(r.status).toBe('updated');
  expect(createKey).toHaveBeenCalledTimes(1);
  expect(String(mockFs.writeFileSync.mock.calls[0][1])).toContain('sk_minted_for_61');
});

it('still leaves a correct, already-matching key alone', async () => {
  // The 25-active-keys-per-company cap is real: re-minting on every login would
  // exhaust it in a fortnight and leave orphaned credentials nobody can attribute.
  withConfig();
  (global as any).fetch = keyResolvesTo(61);
  const createKey = jest.fn();

  const r = await syncMcpCredential(61, { apiUrl: 'https://x', createKey }, ['vscode']);

  expect(r.status).toBe('ok');
  expect(createKey).not.toHaveBeenCalled();
  expect(mockFs.writeFileSync).not.toHaveBeenCalled();
});
