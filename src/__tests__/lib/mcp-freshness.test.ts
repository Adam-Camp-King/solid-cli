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
  judgeRunning,
  MCP_LATEST_SPEC,
  parseRunning,
  refreshConfig,
  refreshMcp,
  RunningProcess,
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


/**
 * What is RUNNING, not only what the config will launch next.
 *
 * ⛔ 2026-10-04: `solid update` printed "already launches the latest" minutes after
 * @solidnumber/mcp 1.3.5 was published, while every AI app open on the machine was
 * still running the 1.3.4 server it had started that morning. The config was right
 * and the sentence was true about the NEXT start only.
 *
 * The `ps` text below is copied from a real machine (macOS, `ps -axo
 * pid=,lstart=,command=`), not written from memory: one launch is two lines, the
 * `npm exec` launcher and the `node …/.bin/solid-mcp` server.
 */
const PS = [
  '50579 Sun Oct  4 20:26:03 2026     npm exec @solidnumber/mcp@latest   ',
  '50610 Sun Oct  4 20:26:04 2026     node /Users/adam/.npm/_npx/6f056bfe1c36e9cc/node_modules/.bin/solid-mcp',
  '90219 Sun Oct  4 11:46:44 2026     claude',
  '  812 Sat Oct  3 09:00:00 2026     /usr/sbin/cfprefsd agent',
].join('\n');
const DIR = '/Users/adam/.npm/_npx/6f056bfe1c36e9cc/node_modules/@solidnumber/mcp';
const STARTED = Date.parse('Sun Oct  4 20:26:04 2026');

describe('parseRunning', () => {
  it('finds the server and not its launcher, with the folder it was started from', () => {
    expect(parseRunning(PS)).toEqual([{ pid: 50610, startedAtMs: STARTED, pkgDir: DIR }]);
  });

  it('reads a server started from inside the package folder', () => {
    const line = `  77 Mon Oct  5 08:00:00 2026     node ${DIR}/dist/index.js`;
    expect(parseRunning(line)).toEqual([{ pid: 77, startedAtMs: Date.parse('Mon Oct  5 08:00:00 2026'), pkgDir: DIR }]);
  });

  it('finds nothing in a process list with no Solid# server', () => {
    expect(parseRunning('90219 Sun Oct  4 11:46:44 2026     claude\n')).toEqual([]);
    expect(parseRunning('')).toEqual([]);
  });
});

describe('judgeRunning', () => {
  const proc = (startedAtMs: number | null): RunningProcess[] => [{ pid: 50610, startedAtMs, pkgDir: DIR }];
  const disk = (version: string, writtenAtMs: number) => () => ({ version, writtenAtMs });

  it('a server started before its package was rewritten is still on the older copy', () => {
    // The folder says 1.3.5; this process loaded 1.3.4 from it an hour earlier.
    const r = judgeRunning(proc(STARTED), '1.3.5', disk('1.3.5', STARTED + 3_600_000));
    expect(r.servers[0].state).toBe('older_in_memory');
    expect(r.servers[0].version_on_disk).toBe('1.3.5');
    expect(r.restart_needed).toBe(true);
  });

  it('a server whose folder still holds the previous version is older on disk', () => {
    const r = judgeRunning(proc(STARTED), '1.3.5', disk('1.3.4', STARTED - 86_400_000));
    expect(r.servers[0].state).toBe('older_on_disk');
    expect(r.restart_needed).toBe(true);
  });

  it('a server started after the latest package landed is current', () => {
    const r = judgeRunning(proc(STARTED), '1.3.5', disk('1.3.5', STARTED - 60_000));
    expect(r.servers[0].state).toBe('current');
    expect(r.restart_needed).toBe(false);
    expect(r.servers[0].started_at).toBe(new Date(STARTED).toISOString());
  });

  it('a launch and the install it triggered a moment later are not called stale', () => {
    // npx starts the process, then the package lands within the same second or two.
    expect(judgeRunning(proc(STARTED), '1.3.5', disk('1.3.5', STARTED + 900)).servers[0].state).toBe('current');
  });

  it('what cannot be dated is unknown, never called current', () => {
    expect(judgeRunning(proc(null), '1.3.5', disk('1.3.5', STARTED)).servers[0].state).toBe('unknown');
    expect(judgeRunning(proc(STARTED), '1.3.5', () => null).servers[0].state).toBe('unknown');
    expect(judgeRunning(proc(null), '1.3.5', () => null).restart_needed).toBe(false);
  });

  it('a process list that could not be read claims nothing', () => {
    expect(judgeRunning(null, '1.3.5', () => null)).toEqual({ checked: false, servers: [], restart_needed: false });
  });

  it('nothing running is checked and needs no restart', () => {
    expect(judgeRunning([], '1.3.5', () => null)).toEqual({ checked: true, servers: [], restart_needed: false });
  });
});

describe('refreshMcp reports what is running', () => {
  const cfgPath = configPathForClient('claude', { homeDir: HOME });
  const current = JSON.stringify({ mcpServers: { solid: { command: 'npx', args: ['-y', MCP_LATEST_SPEC] } } });

  it('a correct config with an older server running says restart is needed', async () => {
    const { io } = fakeIo({ [cfgPath]: current });
    io.runningMcpServers = () => [{ pid: 50610, startedAtMs: STARTED, pkgDir: DIR }];
    io.packageOnDisk = () => ({ version: '1.3.5', writtenAtMs: STARTED + 3_600_000 });
    const report = await refreshMcp({ apply: true, io, homeDir: HOME, fetchImpl: registry('1.3.5') });
    expect(report.clients[0].status).toBe('current');       // the config was right all along
    expect(report.running.restart_needed).toBe(true);       // and that was never the whole answer
    expect(report.running.servers[0].state).toBe('older_in_memory');
  });

  it('an io that cannot look reports "not checked", not "none running"', async () => {
    const { io } = fakeIo({ [cfgPath]: current });
    const report = await refreshMcp({ apply: true, io, homeDir: HOME, fetchImpl: registry('1.3.5') });
    expect(report.running).toEqual({ checked: false, servers: [], restart_needed: false });
  });
});
