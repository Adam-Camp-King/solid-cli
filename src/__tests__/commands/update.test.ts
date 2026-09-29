/**
 * `solid update` — one command, whichever way they installed it.
 *
 * BEHAVIOURAL, not a source read: the real functions run against a mocked
 * registry and filesystem (see forms-verbs.test.ts for why grepping the source
 * is a false green).
 *
 * ⛔ THE CASE THAT MATTERS MOST is the second copy. A machine can carry two
 * `solid` binaries — an npm global under nvm AND a Homebrew formula — and
 * whichever comes first in PATH wins. Upgrading one leaves the other waiting:
 * open a shell before nvm initialises and you are silently running a CLI from
 * weeks ago that disagrees with the backend about which verbs exist. Real, on
 * Adam's machine 2026-09-12: nvm 2.17.0 in front of Homebrew 2.11.13. The
 * update notifier cannot see it — it only ever looks at the copy that is running.
 */

jest.mock('chalk', () => {
  const id = (s: string) => s;
  const proxy: any = new Proxy(id, { get: () => proxy });
  return { __esModule: true, default: proxy };
});
jest.mock('../../lib/api-client', () => ({ CLI_VERSION: '2.17.0' }));
jest.mock('child_process', () => ({ spawnSync: jest.fn() }));
jest.mock('fs', () => ({ existsSync: jest.fn(), realpathSync: jest.fn((p: string) => p) }));
const emptyMcp = { latest: '1.3.3', clients: [], global: { installed: null, action: 'none' }, pinned: [] };
jest.mock('../../lib/mcp-freshness', () => ({
  MCP_LATEST_SPEC: '@solidnumber/mcp@latest',
  refreshMcp: jest.fn(),
}));

jest.mock('../../lib/claude-hook', () => ({ refreshClaudeHook: jest.fn(() => ({ state: 'absent', detail: '' })) }));
jest.mock('../../lib/browser-install', () => ({ refreshCachedChromium: jest.fn(async () => ({ state: 'absent', detail: '' })) }));
jest.mock('../../lib/project-kits', () => ({ refreshAllKits: jest.fn(() => []) }));
jest.mock('../../commands/completion', () => ({ refreshInstalledCompletions: jest.fn(() => ({ state: 'absent', detail: '' })) }));

import { existsSync } from 'fs';
import { refreshClaudeHook } from '../../lib/claude-hook';
import { spawnSync } from 'child_process';
import { refreshMcp } from '../../lib/mcp-freshness';

import {
  detectInstaller,
  isNewer,
  latestVersion,
  otherCopiesOnPath,
  FINISH_SINCE,
  npmPrefixOf,
  PACKAGE_NAME,
  updateRoutes,
  updateCommand,
} from '../../commands/update';

const mockExists = existsSync as unknown as jest.Mock;
const mockSpawn = spawnSync as unknown as jest.Mock;
const mockRefreshMcp = refreshMcp as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockExists.mockReturnValue(false);
  mockSpawn.mockReturnValue({ status: 0, stdout: '' });
  mockRefreshMcp.mockResolvedValue(emptyMcp);
  process.exitCode = undefined;
});

// ── it knows how this copy got here ──────────────────────────────────────

describe('detectInstaller', () => {
  it('recognises an npm global', () => {
    const out = detectInstaller('/Users/x/.nvm/versions/node/v22.19.0/lib/node_modules/@solidnumber/cli/dist/index.js');
    expect(out.installer).toBe('npm');
    expect(out.command).toEqual(['npm', 'install', '-g', `${PACKAGE_NAME}@latest`, '--prefer-online']);
  });

  it('recognises Homebrew', () => {
    const out = detectInstaller('/opt/homebrew/Cellar/cli/2.11.13/bin/solid');
    expect(out.installer).toBe('brew');
    expect(out.command).toEqual(['brew', 'upgrade', 'solidnumber/tap/cli']);
  });

  it('⛔ brew upgrade does not auto-tap, so brew carries a tap preflight', () => {
    // `brew upgrade user/repo/formula` fails outright on a machine that has not
    // tapped — "This command requires the tap solidnumber/tap". Only `brew
    // install` auto-taps. Without this the update command dead-ends there.
    const out = detectInstaller('/opt/homebrew/Cellar/cli/2.24.0/libexec/dist/index.js');
    expect(out.preflight).toEqual(['brew', 'tap', 'solidnumber/tap']);
  });

  it('recognises the brew formula payload inside the keg (libexec/node_modules)', () => {
    const out = detectInstaller(
      '/opt/homebrew/Cellar/cli/2.24.0/libexec/lib/node_modules/@solidnumber/cli/dist/index.js',
    );
    expect(out.installer).toBe('brew');
  });

  it('recognises scoop', () => {
    const out = detectInstaller('C:\\Users\\x\\scoop\\apps\\solid\\current\\solid.exe');
    expect(out.installer).toBe('scoop');
    expect(out.command).toEqual(['scoop', 'update', 'solid']);
  });

  it('⛔ a Homebrew PREFIX is not a Homebrew INSTALL — npm-under-brew-node is npm', () => {
    // Real failure, Adam's iMac 2026-09-17. `npm i -g` under a brew-installed
    // node lands in /opt/homebrew/lib/node_modules — no Cellar anywhere. Calling
    // that brew printed `brew upgrade solidnumber/tap/cli` to a machine that had
    // never tapped, and the update dead-ended on "requires the tap". The real
    // formula payload lives under Cellar/<ver>/libexec, which /cellar/ catches.
    const out = detectInstaller('/opt/homebrew/lib/node_modules/@solidnumber/cli/dist/index.js');
    expect(out.installer).toBe('npm');
    expect(out.command).toEqual(['npm', 'install', '-g', `${PACKAGE_NAME}@latest`, '--prefer-online']);
  });

  it('a linuxbrew keg is still brew', () => {
    const out = detectInstaller('/home/linuxbrew/.linuxbrew/Cellar/cli/2.24.0/libexec/dist/index.js');
    expect(out.installer).toBe('brew');
  });

  it('says so rather than guessing when it cannot tell', () => {
    expect(detectInstaller('/somewhere/odd/solid')).toEqual({ installer: 'unknown', command: null });
    expect(detectInstaller(null).installer).toBe('unknown');
  });
});

// ── is there actually something newer ────────────────────────────────────

describe('isNewer', () => {
  it.each([
    ['2.17.0', '2.18.0', true],
    ['2.11.13', '2.18.0', true],
    ['2.18.0', '2.18.0', false],
    ['2.18.0', '2.17.0', false],
    ['2.9.0', '2.10.0', true], // not a string compare
  ])('%s → %s is newer: %s', (current, candidate, expected) => {
    expect(isNewer(current, candidate)).toBe(expected);
  });
});

describe('latestVersion', () => {
  it('reads the version off the registry', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ version: '2.18.0' }) });
    await expect(latestVersion(fetchImpl as never)).resolves.toBe('2.18.0');
  });

  it('being offline is not an error — it returns null', async () => {
    const boom = jest.fn().mockRejectedValue(new Error('ENOTFOUND'));
    await expect(latestVersion(boom as never)).resolves.toBeNull();
    const notOk = jest.fn().mockResolvedValue({ ok: false });
    await expect(latestVersion(notOk as never)).resolves.toBeNull();
  });
});

// ── the second copy ──────────────────────────────────────────────────────

describe('otherCopiesOnPath', () => {
  it('finds the copy the notifier can never see', () => {
    const self = '/Users/x/.nvm/versions/node/v22.19.0/bin/solid';
    mockExists.mockImplementation((p: string) => p === self || p === '/opt/homebrew/bin/solid');
    mockSpawn.mockReturnValue({ status: 0, stdout: '2.11.13\n' });

    const found = otherCopiesOnPath(self, {
      PATH: '/Users/x/.nvm/versions/node/v22.19.0/bin:/opt/homebrew/bin',
    } as NodeJS.ProcessEnv);

    expect(found).toEqual([{ path: '/opt/homebrew/bin/solid', version: '2.11.13' }]);
  });

  it('does not report the running copy as a stranger', () => {
    const self = '/Users/x/.nvm/bin/solid';
    mockExists.mockImplementation((p: string) => p === self);
    expect(otherCopiesOnPath(self, { PATH: '/Users/x/.nvm/bin' } as NodeJS.ProcessEnv)).toEqual([]);
  });

  it('a version it cannot read is still reported as a copy', () => {
    mockExists.mockImplementation((p: string) => p === '/usr/local/bin/solid');
    mockSpawn.mockReturnValue({ status: 1, stdout: '' });
    const found = otherCopiesOnPath(null, { PATH: '/usr/local/bin' } as NodeJS.ProcessEnv);
    expect(found).toEqual([{ path: '/usr/local/bin/solid', version: null }]);
  });
});

// ── the command itself ───────────────────────────────────────────────────

describe('solid update', () => {
  const run = async (args: string[]) => {
    // ⛔ `updateCommand` is a module-level singleton, so commander KEEPS the
    // option values from the previous parseAsync — a run after `--json` would
    // silently still be in JSON mode and the assertion below would be testing
    // the wrong branch. Harmless in real use (one parse per process), fatal to
    // test isolation.
    updateCommand.setOptionValue('json', undefined);
    updateCommand.setOptionValue('check', undefined);
    updateCommand.setOptionValue('finish', undefined);

    const out: string[] = [];
    const write = jest.spyOn(process.stdout, 'write').mockImplementation((s: any) => (out.push(String(s)), true));
    const log = jest.spyOn(console, 'log').mockImplementation((...a) => out.push(a.join(' ')));
    try {
      await updateCommand.parseAsync(args, { from: 'user' });
    } finally {
      write.mockRestore();
      log.mockRestore();
    }
    return out.join('\n');
  };

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ version: '2.18.0' }) }) as never;
  });

  it('--check never runs anything', async () => {
    const text = await run(['--check']);
    expect(text).toContain('2.17.0');
    expect(text).toContain('2.18.0');
    // spawnSync may be called to read another copy's --version, never to install
    const installs = mockSpawn.mock.calls.filter(([bin]) => bin === 'npm' || bin === 'brew' || bin === 'scoop');
    expect(installs).toHaveLength(0);
  });

  it('--check --json gives an agent the whole picture and changes nothing', async () => {
    const text = await run(['--check', '--json']);
    const body = JSON.parse(text);
    expect(body).toMatchObject({ current: '2.17.0', latest: '2.18.0', up_to_date: false, ran: false });
    // under jest argv[1] is jest itself, so the installer is honestly unknown —
    // and unknown is no longer a dead end: the ladder still has somewhere to go.
    expect(body.installer).toBe('unknown');
    expect(body.cli).toEqual({ action: 'would_update' });
    expect(body).toHaveProperty('installer');
    expect(body).toHaveProperty('other_copies');
    expect(mockRefreshMcp).toHaveBeenCalledWith({ apply: false });
  });

  it('--check never touches the MCP configs either', async () => {
    await run(['--check']);
    expect(mockRefreshMcp).toHaveBeenCalledWith({ apply: false });
  });

  it('--json on its own DOES the update, so an agent can call it', async () => {
    const text = await run(['--json']);
    const body = JSON.parse(text);
    expect(body.ran).toBe(true);
    expect(mockRefreshMcp).toHaveBeenCalledWith({ apply: true });
    expect(body.mcp).toEqual(emptyMcp);
  });

  it('keeps the MCP server current even when the CLI already is', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ version: '2.17.0' }) }) as never;
    mockRefreshMcp.mockResolvedValue({
      latest: '1.3.3',
      clients: [{ client: 'claude', path: '/x/claude.json', status: 'rewritten', findings: [] }],
      global: { installed: null, action: 'none' },
      pinned: [],
    });
    const text = await run([]);
    expect(mockRefreshMcp).toHaveBeenCalledWith({ apply: true });
    expect(text).toContain('Already on the latest');
    expect(text).toContain('now launches @solidnumber/mcp@latest');
    expect(text).toContain('Restart the AI app');
  });

  it('a failed MCP write makes the command fail', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ version: '2.17.0' }) }) as never;
    mockRefreshMcp.mockResolvedValue({
      latest: '1.3.3',
      clients: [{ client: 'cursor', path: '/x/mcp.json', status: 'write_failed', findings: [], error: 'EACCES' }],
      global: { installed: null, action: 'none' },
      pinned: [],
    });
    await run([]);
    expect(process.exitCode).toBe(1);
  });

  it('says so plainly when there is nothing to do', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ version: '2.17.0' }) }) as never;
    const text = await run([]);
    expect(text).toContain('Already on the latest');
  });

  it('an unreachable registry tells them the command instead of failing', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as never;
    const text = await run([]);
    expect(text.toLowerCase()).toContain('registry');
    expect(text).toContain(PACKAGE_NAME);
  });

  describe('⛔ a wrong guess never strands the customer (iMac, 2026-09-29)', () => {
    const argv1 = process.argv[1];
    const path = process.env.PATH;
    const mockSpawn = spawnSync as unknown as jest.Mock;
    const mockExists = existsSync as unknown as jest.Mock;

    // `answers` maps the first word of a command to its exit code; `solid --version` reads `onPath`.
    const machine = (answers: Record<string, number>, onPath: () => string) => {
      process.env.PATH = '/bin-dir';
      mockExists.mockImplementation((p: string) => p === '/bin-dir/solid');
      mockSpawn.mockImplementation((cmd: string, args: string[]) => {
        if (args[0] === '--version') return { status: 0, stdout: onPath() };
        if (args[0] === 'tap') return { status: 0 };
        if (args[0] === 'update') return { status: 0, stdout: '' }; // the new binary finishing
        return { status: answers[cmd] ?? 1 };
      });
    };

    beforeEach(() => {
      mockSpawn.mockReset();
      mockRefreshMcp.mockResolvedValue(emptyMcp as never);
    });
    afterEach(() => {
      process.argv[1] = argv1;
      process.env.PATH = path;
      process.exitCode = 0;
    });

    it('the brew guess fails → it falls through to npm and proves the new version runs', async () => {
      process.argv[1] = '/opt/homebrew/Cellar/cli/2.17.0/libexec/lib/node_modules/@solidnumber/cli/dist/index.js';
      let version = '2.17.0';
      machine({ brew: 1, npm: 0 }, () => version);
      mockSpawn.mockImplementationOnce(() => ({ status: 0 })); // brew tap
      const npmRan = jest.fn(() => (version = '2.18.0'));
      const base = mockSpawn.getMockImplementation()!;
      mockSpawn.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'npm') npmRan();
        return base(cmd, args);
      });

      const text = await run([]);
      expect(npmRan).toHaveBeenCalled();
      expect(text).toContain('Updated to 2.18.0');
      expect(text).not.toContain('Run it yourself');
      expect(process.exitCode).not.toBe(1);
    });

    it('a zero exit is not success — only the version the shell runs is', async () => {
      process.argv[1] = '/usr/local/lib/node_modules/@solidnumber/cli/dist/index.js';
      machine({ npm: 0, brew: 1 }, () => '2.17.0');
      const text = await run([]);
      expect(text).not.toContain('Updated to');
      expect(text).toContain('first on your PATH is still 2.17.0');
    });

    it('Homebrew behind npm is said plainly, and no npm copy is piled on top', async () => {
      process.argv[1] = '/opt/homebrew/Cellar/cli/2.17.0/libexec/lib/node_modules/@solidnumber/cli/dist/index.js';
      machine({ brew: 0, npm: 0 }, () => '2.17.0');
      const text = await run([]);
      expect(mockSpawn.mock.calls.some(([cmd]) => cmd === 'npm')).toBe(false);
      expect(text).toContain('Homebrew does not have 2.18.0 yet');
    });

    it('when every way fails it says what it tried and the one command that works', async () => {
      process.argv[1] = '/usr/local/lib/node_modules/@solidnumber/cli/dist/index.js';
      machine({}, () => '2.17.0');
      const text = await run([]);
      expect(text).toContain('Tried:');
      expect(text).toContain(`npm install -g ${PACKAGE_NAME}@latest --prefer-online`);
      expect(process.exitCode).toBe(1);
    });
  });
});

describe('updateRoutes', () => {
  it('an npm global under a Homebrew prefix tries npm first, brew only as a fallback', () => {
    const r = updateRoutes(detectInstaller('/opt/homebrew/lib/node_modules/@solidnumber/cli/dist/index.js'), 'darwin');
    expect(r.map((x) => x.installer)).toEqual(['npm', 'brew']);
  });
  it('a copy it cannot place still gets every route, never a list to choose from', () => {
    expect(updateRoutes(detectInstaller(null), 'darwin').map((x) => x.installer)).toEqual(['npm', 'brew']);
    expect(updateRoutes(detectInstaller(null), 'win32').map((x) => x.installer)).toEqual(['npm', 'scoop']);
  });
  it('brew always taps first — brew upgrade never auto-taps', () => {
    const [brew] = updateRoutes(detectInstaller('/opt/homebrew/Cellar/cli/2.24.0/bin/solid'), 'darwin');
    expect(brew.preflight).toEqual(['brew', 'tap', 'solidnumber/tap']);
  });
});

describe('solid update — the whole machine, finished by the new binary', () => {
  const argv1 = process.argv[1];
  const path = process.env.PATH;
  const mockSpawn = spawnSync as unknown as jest.Mock;
  const mockExists = existsSync as unknown as jest.Mock;
  const mockHook = refreshClaudeHook as unknown as jest.Mock;

  const run = async (args: string[]) => {
    for (const k of ['json', 'check', 'finish']) updateCommand.setOptionValue(k, undefined);
    const out: string[] = [];
    const write = jest.spyOn(process.stdout, 'write').mockImplementation((s: any) => (out.push(String(s)), true));
    const log = jest.spyOn(console, 'log').mockImplementation((...a) => out.push(a.join(' ')));
    try {
      await updateCommand.parseAsync(args, { from: 'user' });
    } finally {
      write.mockRestore();
      log.mockRestore();
    }
    return out.join('\n');
  };

  beforeEach(() => {
    mockSpawn.mockReset();
    mockRefreshMcp.mockReset().mockResolvedValue(emptyMcp as never);
    mockHook.mockReturnValue({ state: 'absent', detail: '' });
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ version: '2.25.0' }) }) as never;
    process.argv[1] = '/usr/local/lib/node_modules/@solidnumber/cli/dist/index.js';
    process.env.PATH = '/bin-dir';
    mockExists.mockImplementation((p: string) => p === '/bin-dir/solid');
  });
  afterEach(() => {
    process.argv[1] = argv1;
    process.env.PATH = path;
    process.exitCode = 0;
  });

  it('⛔ after the CLI moves, the NEW binary refreshes the rest — the old one never writes old files', async () => {
    let version = '2.17.0';
    mockSpawn.mockImplementation((cmd: string, args: string[]) => {
      if (args[0] === '--version') return { status: 0, stdout: version };
      if (cmd === 'npm') return (version = '2.25.0'), { status: 0 };
      if (args[0] === 'update') return { status: 0, stdout: '' };
      return { status: 1 };
    });
    await run([]);
    expect(mockSpawn).toHaveBeenCalledWith('/bin-dir/solid', ['update', '--finish'], expect.anything());
    expect(mockRefreshMcp).not.toHaveBeenCalled();
    expect(mockHook).not.toHaveBeenCalled();
  });

  it('--json carries the new binary\'s report through', async () => {
    let version = '2.17.0';
    const report = { finished_by: '2.25.0', mcp: emptyMcp, machine: [{ id: 'claude_hook', state: 'updated' }] };
    mockSpawn.mockImplementation((cmd: string, args: string[]) => {
      if (args[0] === '--version') return { status: 0, stdout: version };
      if (cmd === 'npm') return (version = '2.25.0'), { status: 0 };
      if (args[0] === 'update') return { status: 0, stdout: JSON.stringify(report) };
      return { status: 1 };
    });
    const body = JSON.parse(await run(['--json']));
    expect(body.finished_by).toBe('2.25.0');
    expect(body.machine).toEqual(report.machine);
  });

  it('if the new binary cannot be started, this one still refreshes everything', async () => {
    let version = '2.17.0';
    mockSpawn.mockImplementation((cmd: string, args: string[]) => {
      if (args[0] === '--version') return { status: 0, stdout: version };
      if (cmd === 'npm') return (version = '2.25.0'), { status: 0 };
      if (args[0] === 'update') return { status: null, error: new Error('ENOENT') };
      return { status: 1 };
    });
    await run([]);
    expect(mockRefreshMcp).toHaveBeenCalledWith({ apply: true });
    expect(mockHook).toHaveBeenCalledWith(true);
  });

  it('--finish refreshes MCP and every machine part, and never touches the CLI', async () => {
    const text = await run(['--finish']);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(mockRefreshMcp).toHaveBeenCalledWith({ apply: true });
    expect(mockHook).toHaveBeenCalledWith(true);
    expect(text).toContain('On this machine');
  });

  it('an already-current CLI still refreshes the whole machine', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ version: '2.17.0' }) }) as never;
    await run([]);
    expect(mockHook).toHaveBeenCalledWith(true);
  });

  it('--check reports every part and changes none', async () => {
    const body = JSON.parse(await run(['--check', '--json']));
    expect(mockHook).toHaveBeenCalledWith(false);
    expect(body.machine.map((p: { id: string }) => p.id)).toEqual(['claude_hook', 'completion', 'project_kits', 'browser']);
  });

  it('a part that fails makes the command fail', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ version: '2.17.0' }) }) as never;
    mockHook.mockReturnValue({ state: 'failed', detail: 'settings.json is not valid JSON' });
    const text = await run([]);
    expect(text).toContain('not valid JSON');
    expect(process.exitCode).toBe(1);
  });

  it('⛔ never hands off to a release older than --finish — this process finishes instead', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ version: '2.24.11' }) }) as never;
    let version = '2.17.0';
    mockSpawn.mockImplementation((cmd: string, args: string[]) => {
      if (args[0] === '--version') return { status: 0, stdout: version };
      if (cmd === 'npm') return (version = '2.24.11'), { status: 0 };
      return { status: 1 };
    });
    await run([]);
    expect(FINISH_SINCE).toBe('2.24.12');
    expect(mockSpawn.mock.calls.some(([, args]) => args[0] === 'update')).toBe(false);
    expect(mockHook).toHaveBeenCalledWith(true);
    expect(process.exitCode).not.toBe(1);
  });

  it('a second npm copy first on PATH (another nvm Node) is updated where it lives', async () => {
    const other = '/Users/x/.nvm/versions/node/v20/lib/node_modules/@solidnumber/cli/dist/index.js';
    mockExists.mockImplementation((p: string) => p === '/bin-dir/solid');
    const fsMock = jest.requireMock('fs') as { realpathSync: jest.Mock };
    fsMock.realpathSync.mockImplementation((p: string) => (p === '/bin-dir/solid' ? other : p));
    let shadowVersion = '2.17.0';
    mockSpawn.mockImplementation((cmd: string, args: string[]) => {
      if (args[0] === '--version') return { status: 0, stdout: shadowVersion };
      if (cmd === 'npm' && args.includes('--prefix')) {
        expect(args[args.indexOf('--prefix') + 1]).toBe('/Users/x/.nvm/versions/node/v20');
        return (shadowVersion = '2.25.0'), { status: 0 };
      }
      if (cmd === 'npm') return { status: 0 }; // updates THIS copy; the shadow still wins
      if (args[0] === 'update') return { status: 0, stdout: '' };
      return { status: 1 };
    });
    const text = await run([]);
    fsMock.realpathSync.mockImplementation((p: string) => p);
    expect(text).toContain('Updated to 2.25.0');
  });
});

describe('npmPrefixOf', () => {
  it('finds the prefix of a unix npm global', () => {
    expect(npmPrefixOf('/opt/homebrew/lib/node_modules/@solidnumber/cli/dist/index.js')).toBe('/opt/homebrew');
  });
  it('is null for a Homebrew keg — brew owns that one', () => {
    expect(npmPrefixOf('/opt/homebrew/Cellar/cli/2.24.0/libexec/lib/node_modules/@solidnumber/cli/dist/index.js')).toBeNull();
  });
});
