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

import { existsSync } from 'fs';
import { spawnSync } from 'child_process';

import {
  detectInstaller,
  isNewer,
  latestVersion,
  otherCopiesOnPath,
  PACKAGE_NAME,
  updateCommand,
} from '../../commands/update';

const mockExists = existsSync as unknown as jest.Mock;
const mockSpawn = spawnSync as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockExists.mockReturnValue(false);
  mockSpawn.mockReturnValue({ status: 0, stdout: '' });
});

// ── it knows how this copy got here ──────────────────────────────────────

describe('detectInstaller', () => {
  it('recognises an npm global', () => {
    const out = detectInstaller('/Users/x/.nvm/versions/node/v22.19.0/lib/node_modules/@solidnumber/cli/dist/index.js');
    expect(out.installer).toBe('npm');
    expect(out.command).toEqual(['npm', 'install', '-g', `${PACKAGE_NAME}@latest`]);
  });

  it('recognises Homebrew', () => {
    const out = detectInstaller('/opt/homebrew/Cellar/cli/2.11.13/bin/solid');
    expect(out.installer).toBe('brew');
    expect(out.command).toEqual(['brew', 'upgrade', 'solidnumber/tap/cli']);
  });

  it('recognises scoop', () => {
    const out = detectInstaller('C:\\Users\\x\\scoop\\apps\\solid\\current\\solid.exe');
    expect(out.installer).toBe('scoop');
    expect(out.command).toEqual(['scoop', 'update', 'solid']);
  });

  it('⛔ a brew payload also lives in node_modules — brew must still win', () => {
    // Getting this backwards prints `npm install -g` to a Homebrew user, which
    // quietly installs a SECOND copy instead of upgrading the one they have.
    const out = detectInstaller('/opt/homebrew/lib/node_modules/@solidnumber/cli/dist/index.js');
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

  it('--json gives an agent the whole picture and changes nothing', async () => {
    const text = await run(['--json']);
    const body = JSON.parse(text);
    expect(body).toMatchObject({ current: '2.17.0', latest: '2.18.0', up_to_date: false, ran: false });
    expect(body).toHaveProperty('installer');
    expect(body).toHaveProperty('other_copies');
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
});
