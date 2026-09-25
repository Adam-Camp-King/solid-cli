/**
 * `solid update` keeps the MCP server current, not just the CLI.
 *
 * A client config that launches a bare `@solidnumber/mcp` runs whatever npx
 * cached on the first launch — forever. Every config written before CLI 2.24.8
 * looks like that. These drive the real functions against in-memory configs and
 * a fake io; no test touches a real home directory.
 */
import {
  classifySpec,
  FreshnessIo,
  MCP_LATEST_SPEC,
  refreshConfig,
  refreshMcp,
} from '../../lib/mcp-freshness';
import { configPathForClient } from '../../lib/mcp-client-config';

const HOME = '/tmp/fake-home-mcp-freshness';

function fakeIo(files: Record<string, string>, globalVersion: string | null = null, upgradeOk = true) {
  const writes: Record<string, string> = {};
  let upgraded = 0;
  const io: FreshnessIo = {
    readFile: (p) => (p in files ? files[p] : null),
    writeFile: (p, body) => {
      writes[p] = body;
    },
    globalMcpVersion: () => globalVersion,
    upgradeGlobalMcp: () => {
      upgraded += 1;
      return upgradeOk;
    },
  };
  return { io, writes, upgrades: () => upgraded };
}

const registry = (version: string) =>
  jest.fn().mockResolvedValue({ ok: true, json: async () => ({ version }) }) as unknown as typeof fetch;

describe('classifySpec', () => {
  it('tells bare, latest and pinned apart, and ignores other packages', () => {
    expect(classifySpec('@solidnumber/mcp')).toBe('bare');
    expect(classifySpec('@solidnumber/mcp@latest')).toBe('latest');
    expect(classifySpec('@solidnumber/mcp@1.2.0')).toBe('pinned');
    expect(classifySpec('@solidnumber/mcp-other')).toBeNull();
    expect(classifySpec('-y')).toBeNull();
    expect(classifySpec(42)).toBeNull();
  });
});

describe('refreshConfig', () => {
  it('switches a bare spec to @latest and touches nothing else', () => {
    const before = {
      theme: 'dark',
      mcpServers: {
        solid: { command: 'npx', args: ['-y', '@solidnumber/mcp'], env: { SOLID_API_KEY: 'sk_x' } },
        github: { command: 'npx', args: ['-y', '@github/mcp'] },
      },
    };
    const { config, changed, findings } = refreshConfig(before);
    expect(changed).toBe(true);
    expect(config).toEqual({
      theme: 'dark',
      mcpServers: {
        solid: { command: 'npx', args: ['-y', MCP_LATEST_SPEC], env: { SOLID_API_KEY: 'sk_x' } },
        github: { command: 'npx', args: ['-y', '@github/mcp'] },
      },
    });
    expect(findings).toEqual([{ scope: 'mcpServers', server: 'solid', spec: '@solidnumber/mcp', kind: 'bare' }]);
    // input untouched
    expect(before.mcpServers.solid.args[1]).toBe('@solidnumber/mcp');
  });

  it('matches on the package, not the server name', () => {
    const { config, changed } = refreshConfig({
      mcpServers: { 'my-business': { command: 'npx', args: ['-y', '@solidnumber/mcp'] } },
    });
    expect(changed).toBe(true);
    expect((config.mcpServers as any)['my-business'].args[1]).toBe(MCP_LATEST_SPEC);
  });

  it("reaches Claude Code's per-project servers in ~/.claude.json", () => {
    const { config, findings } = refreshConfig({
      projects: { '/Users/x/acme': { mcpServers: { solid: { command: 'npx', args: ['@solidnumber/mcp'] } } } },
    });
    expect((config.projects as any)['/Users/x/acme'].mcpServers.solid.args[0]).toBe(MCP_LATEST_SPEC);
    expect(findings[0].scope).toBe('projects[/Users/x/acme].mcpServers');
  });

  it('leaves a deliberate pin alone', () => {
    const { changed, findings } = refreshConfig({
      mcpServers: { solid: { command: 'npx', args: ['-y', '@solidnumber/mcp@1.2.0'] } },
    });
    expect(changed).toBe(false);
    expect(findings[0].kind).toBe('pinned');
  });
});

describe('refreshMcp', () => {
  const claude = configPathForClient('claude', { homeDir: HOME });
  const cursor = configPathForClient('cursor', { homeDir: HOME });

  it('rewrites stale configs and reports current ones', async () => {
    const { io, writes } = fakeIo({
      [claude]: JSON.stringify({ mcpServers: { solid: { command: 'npx', args: ['-y', '@solidnumber/mcp'] } } }),
      [cursor]: JSON.stringify({ mcpServers: { solid: { command: 'npx', args: ['-y', MCP_LATEST_SPEC] } } }),
    });
    const report = await refreshMcp({ apply: true, io, homeDir: HOME, fetchImpl: registry('1.3.3') });
    expect(report.clients.map((c) => [c.client, c.status])).toEqual([
      ['claude', 'rewritten'],
      ['cursor', 'current'],
    ]);
    expect(JSON.parse(writes[claude]).mcpServers.solid.args).toEqual(['-y', MCP_LATEST_SPEC]);
    expect(writes[cursor]).toBeUndefined();
  });

  it('--check writes nothing and upgrades nothing', async () => {
    const { io, writes, upgrades } = fakeIo(
      { [claude]: JSON.stringify({ mcpServers: { solid: { command: 'npx', args: ['@solidnumber/mcp'] } } }) },
      '1.1.0',
    );
    const report = await refreshMcp({ apply: false, io, homeDir: HOME, fetchImpl: registry('1.3.3') });
    expect(report.clients[0].status).toBe('would_rewrite');
    expect(report.global).toEqual({ installed: '1.1.0', action: 'would_upgrade' });
    expect(writes).toEqual({});
    expect(upgrades()).toBe(0);
  });

  it('upgrades a stale global install, and leaves a current one alone', async () => {
    const stale = fakeIo({}, '1.1.0');
    expect((await refreshMcp({ apply: true, io: stale.io, homeDir: HOME, fetchImpl: registry('1.3.3') })).global)
      .toEqual({ installed: '1.1.0', action: 'upgraded' });
    expect(stale.upgrades()).toBe(1);

    const current = fakeIo({}, '1.3.3');
    expect((await refreshMcp({ apply: true, io: current.io, homeDir: HOME, fetchImpl: registry('1.3.3') })).global)
      .toEqual({ installed: '1.3.3', action: 'none' });
    expect(current.upgrades()).toBe(0);
  });

  it('skips clients without Solid# and never rewrites a file it cannot parse', async () => {
    const { io, writes } = fakeIo({
      [claude]: '{ not json',
      [cursor]: JSON.stringify({ mcpServers: { github: { command: 'npx', args: ['@github/mcp'] } } }),
    });
    const report = await refreshMcp({ apply: true, io, homeDir: HOME, fetchImpl: registry('1.3.3') });
    expect(report.clients).toEqual([{ client: 'claude', path: claude, status: 'unreadable', findings: [] }]);
    expect(writes).toEqual({});
  });

  it('a failed write is reported, not thrown', async () => {
    const { io } = fakeIo({
      [claude]: JSON.stringify({ mcpServers: { solid: { command: 'npx', args: ['@solidnumber/mcp'] } } }),
    });
    io.writeFile = () => {
      throw new Error('EACCES');
    };
    const report = await refreshMcp({ apply: true, io, homeDir: HOME, fetchImpl: registry('1.3.3') });
    expect(report.clients[0]).toMatchObject({ status: 'write_failed', error: 'EACCES' });
  });
});
