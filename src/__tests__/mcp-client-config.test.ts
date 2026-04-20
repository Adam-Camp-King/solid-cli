/**
 * Unit tests for src/lib/mcp-client-config.ts (Sprint 1 T1.5).
 * Pure — no fs, no process.env reads (except defaults via env injection).
 */
import * as path from 'path';

import {
  DEFAULT_MCP_PACKAGE,
  SUPPORTED_CLIENTS,
  buildServerEntry,
  configPathForClient,
  isSupportedClient,
  mergeIntoConfig,
  removeFromConfig,
  serializeConfig,
} from '../lib/mcp-client-config';

describe('isSupportedClient', () => {
  it.each(SUPPORTED_CLIENTS)('%s → true', (c) => {
    expect(isSupportedClient(c)).toBe(true);
  });

  it.each([undefined, null, '', 'vscode', 'zed', 'claude-web'])('%s → false', (v) => {
    expect(isSupportedClient(v as string | null | undefined)).toBe(false);
  });
});

describe('configPathForClient', () => {
  const home = '/home/user';

  it('claude on macOS uses Application Support', () => {
    expect(configPathForClient('claude', { platform: 'darwin', homeDir: home })).toBe(
      path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    );
  });

  it('claude on Linux uses ~/.config/Claude', () => {
    expect(configPathForClient('claude', { platform: 'linux', homeDir: home })).toBe(
      path.join(home, '.config', 'Claude', 'claude_desktop_config.json'),
    );
  });

  it('claude on win32 uses AppData/Roaming', () => {
    expect(configPathForClient('claude', { platform: 'win32', homeDir: home })).toBe(
      path.join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'),
    );
  });

  it('cursor uses ~/.cursor regardless of platform', () => {
    expect(configPathForClient('cursor', { platform: 'darwin', homeDir: home })).toBe(
      path.join(home, '.cursor', 'mcp.json'),
    );
    expect(configPathForClient('cursor', { platform: 'linux', homeDir: home })).toBe(
      path.join(home, '.cursor', 'mcp.json'),
    );
    expect(configPathForClient('cursor', { platform: 'win32', homeDir: home })).toBe(
      path.join(home, '.cursor', 'mcp.json'),
    );
  });

  it('windsurf on Linux/macOS uses ~/.codeium/windsurf', () => {
    expect(configPathForClient('windsurf', { platform: 'darwin', homeDir: home })).toBe(
      path.join(home, '.codeium', 'windsurf', 'mcp_config.json'),
    );
    expect(configPathForClient('windsurf', { platform: 'linux', homeDir: home })).toBe(
      path.join(home, '.codeium', 'windsurf', 'mcp_config.json'),
    );
  });

  it('windsurf on win32 uses AppData/Roaming/Codeium/Windsurf', () => {
    expect(configPathForClient('windsurf', { platform: 'win32', homeDir: home })).toBe(
      path.join(home, 'AppData', 'Roaming', 'Codeium', 'Windsurf', 'mcp_config.json'),
    );
  });
});

describe('buildServerEntry', () => {
  it('returns the minimal shape with no env when no input', () => {
    const e = buildServerEntry();
    expect(e.command).toBe('npx');
    expect(e.args).toEqual(['-y', DEFAULT_MCP_PACKAGE]);
    expect(e.env).toBeUndefined();
  });

  it('includes SOLID_API_KEY when apiKey supplied', () => {
    const e = buildServerEntry({ apiKey: 'sk_live_abc' });
    expect(e.env?.SOLID_API_KEY).toBe('sk_live_abc');
  });

  it('includes SOLID_API_URL when apiUrl supplied', () => {
    const e = buildServerEntry({ apiUrl: 'https://api.solidnumber.com' });
    expect(e.env?.SOLID_API_URL).toBe('https://api.solidnumber.com');
  });

  it('includes SOLID_COMPANY_ID when companyId supplied', () => {
    expect(buildServerEntry({ companyId: 61 }).env?.SOLID_COMPANY_ID).toBe('61');
    expect(buildServerEntry({ companyId: '42' }).env?.SOLID_COMPANY_ID).toBe('42');
  });

  it('omits companyId env when empty string', () => {
    expect(buildServerEntry({ companyId: '' }).env).toBeUndefined();
  });

  it('packageName override flows through to args', () => {
    const e = buildServerEntry({ packageName: '@myorg/custom-mcp' });
    expect(e.args).toEqual(['-y', '@myorg/custom-mcp']);
  });

  it('extraEnv merges and drops empty strings', () => {
    const e = buildServerEntry({
      apiKey: 'k',
      extraEnv: { FOO: 'bar', EMPTY: '' },
    });
    expect(e.env?.FOO).toBe('bar');
    expect(e.env?.EMPTY).toBeUndefined();
    expect(e.env?.SOLID_API_KEY).toBe('k');
  });

  it('is pure — does not mutate extraEnv', () => {
    const extra = { FOO: 'bar' };
    const snap = { ...extra };
    buildServerEntry({ extraEnv: extra });
    expect(extra).toEqual(snap);
  });
});

describe('mergeIntoConfig', () => {
  it('creates mcpServers when absent', () => {
    const entry = buildServerEntry({ apiKey: 'k' });
    const out = mergeIntoConfig(null, entry);
    expect(out.mcpServers).toEqual({ solid: entry });
  });

  it('preserves existing mcpServers siblings', () => {
    const entry = buildServerEntry({ apiKey: 'k' });
    const existing = {
      mcpServers: { github: { command: 'npx', args: ['-y', '@github/mcp'] } },
    };
    const out = mergeIntoConfig(existing, entry);
    expect(out.mcpServers?.github).toBeDefined();
    expect(out.mcpServers?.solid).toEqual(entry);
  });

  it('overwrites existing solid entry', () => {
    const entry = buildServerEntry({ apiKey: 'new' });
    const existing = {
      mcpServers: { solid: { command: 'old', args: ['old'] } },
    };
    expect(mergeIntoConfig(existing, entry).mcpServers?.solid).toEqual(entry);
  });

  it('preserves unknown top-level keys', () => {
    const entry = buildServerEntry();
    const existing = { theme: 'dark', fontSize: 14 } as unknown;
    const out = mergeIntoConfig(existing as any, entry) as any;
    expect(out.theme).toBe('dark');
    expect(out.fontSize).toBe(14);
  });

  it('supports a custom serverKey', () => {
    const entry = buildServerEntry();
    const out = mergeIntoConfig(null, entry, 'solid-dev');
    expect(out.mcpServers?.['solid-dev']).toEqual(entry);
  });

  it('does not mutate the input', () => {
    const existing = {
      mcpServers: { github: { command: 'npx', args: ['gh'] } },
    };
    const snap = JSON.parse(JSON.stringify(existing));
    mergeIntoConfig(existing, buildServerEntry());
    expect(existing).toEqual(snap);
  });
});

describe('removeFromConfig', () => {
  it('removes the solid entry', () => {
    const out = removeFromConfig({
      mcpServers: {
        solid: { command: 'npx', args: ['a'] },
        github: { command: 'npx', args: ['b'] },
      },
    });
    expect(out.mcpServers?.solid).toBeUndefined();
    expect(out.mcpServers?.github).toBeDefined();
  });

  it('leaves empty mcpServers when solid was the only entry', () => {
    const out = removeFromConfig({
      mcpServers: { solid: { command: 'x', args: [] } },
    });
    expect(out.mcpServers).toEqual({});
  });

  it('no-op when no mcpServers', () => {
    const out = removeFromConfig({ theme: 'dark' });
    expect(out.theme).toBe('dark');
  });

  it('no-op on null / undefined', () => {
    expect(removeFromConfig(null)).toEqual({});
    expect(removeFromConfig(undefined)).toEqual({});
  });
});

describe('serializeConfig', () => {
  it('pretty-prints with 2-space indent and trailing newline', () => {
    const out = serializeConfig({ mcpServers: { solid: { command: 'npx', args: ['x'] } } });
    expect(out.endsWith('\n')).toBe(true);
    expect(out).toContain('  "mcpServers"');
  });

  it('is reversible (JSON.parse round-trip)', () => {
    const cfg = { mcpServers: { solid: { command: 'npx', args: ['x'], env: { KEY: 'v' } } } };
    expect(JSON.parse(serializeConfig(cfg))).toEqual(cfg);
  });
});
