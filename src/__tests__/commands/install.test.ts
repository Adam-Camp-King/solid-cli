/**
 * `solid install` — SessionStart hook upsert / migrate / remove.
 *
 * Approach: point the command at a REAL tmp file via SOLID_CLAUDE_SETTINGS_PATH
 * and assert on its contents. No fs mock, no ordering sensitivity, no leakage
 * between tests — each test owns its own tmp path. An earlier mock-based
 * version of these tests flaked intermittently under `npm publish`'s
 * `prepublishOnly` prepublish hook; this rewrite fixes that for good.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { installCommand } from '../../commands/install';

const HOOK_CURRENT = 'solid context --claude --raw';
const HOOK_LEGACY = 'solid context --claude --quiet';

describe('solid install — SessionStart hook (tmp-file backed)', () => {
  let settingsPath: string;

  beforeEach(() => {
    // Fresh tmp file per test — no reset ceremony, no cross-test leakage.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solid-install-test-'));
    settingsPath = path.join(dir, 'settings.json');
    process.env.SOLID_CLAUDE_SETTINGS_PATH = settingsPath;
  });

  afterEach(() => {
    // Best-effort cleanup. If it fails, the OS will clean /tmp eventually.
    try {
      const dir = path.dirname(settingsPath);
      if (fs.existsSync(settingsPath)) fs.unlinkSync(settingsPath);
      if (fs.existsSync(dir)) fs.rmdirSync(dir);
    } catch { /* ignore */ }
    delete process.env.SOLID_CLAUDE_SETTINGS_PATH;
  });

  function writeSettings(obj: unknown): void {
    fs.writeFileSync(settingsPath, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
  }

  function readSettings(): any {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  }

  function run(argv: string[]): { exitCode: number | null } {
    let exitCode: number | null = null;
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exitCode = code ?? 0;
      throw new Error(`process.exit(${code})`);
    }) as never);
    try {
      installCommand.parse(['node', 'solid', ...argv], { from: 'user' });
    } catch { /* process.exit throws; swallow */ }
    exitSpy.mockRestore();
    return { exitCode };
  }

  it('adds the Solid hook when settings.json has no hooks block', () => {
    writeSettings({ attribution: { commit: '', pr: '' }, voiceEnabled: true });

    run(['install']);

    const saved = readSettings();
    expect(saved.attribution).toEqual({ commit: '', pr: '' });
    expect(saved.voiceEnabled).toBe(true);
    expect(saved.hooks.SessionStart).toHaveLength(1);
    expect(saved.hooks.SessionStart[0].hooks[0].command).toBe(HOOK_CURRENT);
  });

  it('is idempotent — running twice does not duplicate the hook', () => {
    writeSettings({
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: HOOK_CURRENT }] }] },
    });

    run(['install']);

    // File contents unchanged — still exactly one Solid hook entry.
    const saved = readSettings();
    expect(saved.hooks.SessionStart).toHaveLength(1);
    expect(saved.hooks.SessionStart[0].hooks).toHaveLength(1);
  });

  it('migrates a legacy --quiet hook to the new --raw command', () => {
    writeSettings({
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: HOOK_LEGACY }] }] },
    });

    run(['install']);

    const saved = readSettings();
    expect(saved.hooks.SessionStart).toHaveLength(1);
    expect(saved.hooks.SessionStart[0].hooks[0].command).toBe(HOOK_CURRENT);
  });

  it('preserves other SessionStart hooks when adding ours', () => {
    writeSettings({
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo "hello"' }] }] },
    });

    run(['install']);

    const saved = readSettings();
    expect(saved.hooks.SessionStart).toHaveLength(2);
    expect(saved.hooks.SessionStart[0].hooks[0].command).toBe('echo "hello"');
    expect(saved.hooks.SessionStart[1].hooks[0].command).toBe(HOOK_CURRENT);
  });

  it('--uninstall removes only the Solid hook', () => {
    writeSettings({
      voiceEnabled: true,
      hooks: {
        SessionStart: [
          { hooks: [{ type: 'command', command: 'echo "hello"' }] },
          { hooks: [{ type: 'command', command: HOOK_CURRENT }] },
        ],
      },
    });

    run(['install', '--uninstall']);

    const saved = readSettings();
    expect(saved.voiceEnabled).toBe(true);
    expect(saved.hooks.SessionStart).toHaveLength(1);
    expect(saved.hooks.SessionStart[0].hooks[0].command).toBe('echo "hello"');
  });

  it('--uninstall with no Solid hook is a clean no-op', () => {
    const original = { voiceEnabled: true };
    writeSettings(original);

    run(['install', '--uninstall']);

    // File unchanged.
    expect(readSettings()).toEqual(original);
  });

  it('--preview never writes, even when changes are pending', () => {
    const original = { voiceEnabled: true };
    writeSettings(original);

    run(['install', '--preview']);

    expect(readSettings()).toEqual(original);
  });

  it('corrupt settings.json exits non-zero instead of clobbering', () => {
    writeSettings('{ not valid json');

    const { exitCode } = run(['install']);

    expect(exitCode).toBe(1);
    // Original corrupt content is untouched.
    expect(fs.readFileSync(settingsPath, 'utf-8')).toBe('{ not valid json');
  });
});
