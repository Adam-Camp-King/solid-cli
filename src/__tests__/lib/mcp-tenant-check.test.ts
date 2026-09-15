/**
 * 2026-09-15: logged the CLI into company 61 (ANGL, a real client), typed
 * `claude`, and the agent reported confidently on company 1 — listing its pages
 * and asking which of ITS cards to extend. Correct answers, wrong business.
 *
 * `solid switch` re-scopes the JWT in ~/.solid/config.json; the MCP server
 * authenticates with a static SOLID_API_KEY and the backend takes the tenant
 * from the key record. Switching cannot move the agent, and nothing said so.
 */
import * as fs from 'fs';

import { readMcpApiKey, checkMcpTenant } from '../../lib/mcp-tenant-check';

jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

function withConfig(json: unknown) {
  mockFs.existsSync.mockReturnValue(true as never);
  mockFs.readFileSync.mockReturnValue(JSON.stringify(json) as never);
}

const okFetch = (companyId: number) =>
  jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ user: { company_id: companyId } }),
  });

beforeEach(() => jest.resetAllMocks());

describe('readMcpApiKey', () => {
  it('finds the solid server entry and its key', () => {
    withConfig({ mcpServers: { solid: { env: { SOLID_API_KEY: 'sk_live_abc' } } } });
    expect(readMcpApiKey('vscode')?.apiKey).toBe('sk_live_abc');
  });

  it('returns null when no solid server is configured — a normal state, not an error', () => {
    withConfig({ mcpServers: { github: { env: {} } } });
    expect(readMcpApiKey('vscode')).toBeNull();
  });

  it('returns null on a malformed config instead of throwing', () => {
    mockFs.existsSync.mockReturnValue(true as never);
    mockFs.readFileSync.mockReturnValue('{ not json' as never);
    expect(readMcpApiKey('vscode')).toBeNull();
  });
});

describe('checkMcpTenant', () => {
  it('flags the exact 2026-09-15 case: session 61, key bound to 1', async () => {
    withConfig({ mcpServers: { solid: { env: { SOLID_API_KEY: 'sk_1' } } } });
    (global as any).fetch = okFetch(1);

    const s = await checkMcpTenant(61, 'https://api.solidnumber.com', 'vscode');
    expect(s?.mismatch).toBe(true);
    expect(s?.keyCompanyId).toBe(1);
    expect(s?.sessionCompanyId).toBe(61);
  });

  it('passes when the key and the session agree', async () => {
    withConfig({ mcpServers: { solid: { env: { SOLID_API_KEY: 'sk_1' } } } });
    (global as any).fetch = okFetch(61);

    expect((await checkMcpTenant(61, 'https://x', 'vscode'))?.mismatch).toBe(false);
  });

  it('⛔ does NOT report unresolved as a mismatch', async () => {
    // Failing the launch because the network blipped would make the check the
    // problem instead of the thing it guards.
    withConfig({ mcpServers: { solid: { env: { SOLID_API_KEY: 'sk_1' } } } });
    (global as any).fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const s = await checkMcpTenant(61, 'https://x', 'vscode');
    expect(s?.mismatch).toBe(false);
    expect(s?.unresolved).toMatch(/ECONNREFUSED/);
  });

  it('⛔ does NOT report a rejected key as a mismatch either', async () => {
    withConfig({ mcpServers: { solid: { env: { SOLID_API_KEY: 'sk_dead' } } } });
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 });

    const s = await checkMcpTenant(61, 'https://x', 'vscode');
    expect(s?.mismatch).toBe(false);
    expect(s?.unresolved).toMatch(/401/);
  });

  it('returns null when there is nothing to compare', async () => {
    withConfig({ mcpServers: {} });
    expect(await checkMcpTenant(61, 'https://x', 'vscode')).toBeNull();
    // No session company is also "cannot tell", never "matches".
    expect(await checkMcpTenant(undefined, 'https://x', 'vscode')).toBeNull();
  });
});
