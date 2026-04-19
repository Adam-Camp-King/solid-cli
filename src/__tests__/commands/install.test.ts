/**
 * `solid install` — SessionStart hook upsert/remove behavior.
 *
 * The merge must preserve every unrelated key the user already set
 * (attribution, enabledPlugins, voiceEnabled, other SessionStart hooks, etc).
 * We test through mocked fs so there's zero risk of writing to real
 * ~/.claude/settings.json.
 *
 * The fs mock is scoped: only the settings.json path is intercepted. Any
 * other fs read (ui.ts reading package.json at import time, for example)
 * falls through to the real filesystem.
 */

jest.mock('fs', () => {
  const actualFs = jest.requireActual('fs') as typeof import('fs');
  return {
    ...actualFs,
    existsSync: jest.fn(actualFs.existsSync),
    readFileSync: jest.fn(actualFs.readFileSync),
    writeFileSync: jest.fn(),
    mkdirSync: jest.fn(),
  };
});

import * as fs from 'fs';
import * as installModule from '../../commands/install';

const mockedFs = fs as jest.Mocked<typeof fs>;
const actualFs = jest.requireActual('fs') as typeof import('fs');

function stubSettings(json: string): void {
  mockedFs.readFileSync.mockImplementation(((p: any, opts: any) =>
    typeof p === 'string' && p.includes('.claude/settings.json')
      ? json
      : actualFs.readFileSync(p, opts)) as any);
}

describe('solid install — SessionStart hook', () => {
  let written: string | null;

  beforeEach(() => {
    written = null;
    mockedFs.existsSync.mockImplementation(((p: any) =>
      typeof p === 'string' && p.includes('.claude/settings.json')
        ? true
        : actualFs.existsSync(p)) as any);
    mockedFs.writeFileSync.mockImplementation(((_p: any, contents: any) => {
      written = typeof contents === 'string' ? contents : contents.toString();
    }) as any);
  });

  afterEach(() => jest.clearAllMocks());

  function runInstall(argv: string[]): { exitCode: number | null } {
    let exitCode: number | null = null;
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exitCode = code ?? 0;
      throw new Error(`process.exit(${code})`);
    }) as never);
    try {
      installModule.installCommand.parse(['node', 'solid', ...argv], { from: 'user' });
    } catch {
      // process.exit throws; swallow and rely on exitCode
    }
    exitSpy.mockRestore();
    return { exitCode };
  }

  it('adds the Solid hook when settings.json has no hooks block', () => {
    stubSettings(JSON.stringify({ attribution: { commit: '', pr: '' }, voiceEnabled: true }));

    runInstall(['install']);

    expect(mockedFs.writeFileSync).toHaveBeenCalled();
    const saved = JSON.parse(written!);
    expect(saved.attribution).toEqual({ commit: '', pr: '' }); // preserved
    expect(saved.voiceEnabled).toBe(true); // preserved
    expect(saved.hooks.SessionStart).toHaveLength(1);
    expect(saved.hooks.SessionStart[0].hooks[0].command).toBe('solid context --claude --raw');
  });

  it('is idempotent — running twice does not duplicate the hook', () => {
    stubSettings(JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'solid context --claude --raw' }] }],
      },
    }));

    runInstall(['install']);

    expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
  });

  it('migrates a legacy --quiet hook to the new --raw command', () => {
    stubSettings(JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'solid context --claude --quiet' }] }],
      },
    }));

    runInstall(['install']);

    const saved = JSON.parse(written!);
    expect(saved.hooks.SessionStart).toHaveLength(1);
    expect(saved.hooks.SessionStart[0].hooks).toHaveLength(1);
    expect(saved.hooks.SessionStart[0].hooks[0].command).toBe('solid context --claude --raw');
  });

  it('preserves other SessionStart hooks when adding ours', () => {
    stubSettings(JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'echo "hello"' }] }],
      },
    }));

    runInstall(['install']);

    const saved = JSON.parse(written!);
    expect(saved.hooks.SessionStart).toHaveLength(2);
    expect(saved.hooks.SessionStart[0].hooks[0].command).toBe('echo "hello"');
    expect(saved.hooks.SessionStart[1].hooks[0].command).toBe('solid context --claude --raw');
  });

  it('--uninstall removes only the Solid hook', () => {
    stubSettings(JSON.stringify({
      voiceEnabled: true,
      hooks: {
        SessionStart: [
          { hooks: [{ type: 'command', command: 'echo "hello"' }] },
          { hooks: [{ type: 'command', command: 'solid context --claude --raw' }] },
        ],
      },
    }));

    runInstall(['install', '--uninstall']);

    const saved = JSON.parse(written!);
    expect(saved.voiceEnabled).toBe(true);
    expect(saved.hooks.SessionStart).toHaveLength(1);
    expect(saved.hooks.SessionStart[0].hooks[0].command).toBe('echo "hello"');
  });

  it('--uninstall with no Solid hook is a clean no-op', () => {
    stubSettings(JSON.stringify({ voiceEnabled: true }));
    runInstall(['install', '--uninstall']);
    expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
  });

  it('--preview never writes, even when changes are pending', () => {
    stubSettings(JSON.stringify({ voiceEnabled: true }));
    runInstall(['install', '--preview']);
    expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
  });

  it('corrupt settings.json exits non-zero instead of clobbering', () => {
    stubSettings('{ not valid json');
    const { exitCode } = runInstall(['install']);
    expect(exitCode).toBe(1);
    expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
  });
});
