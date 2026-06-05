/**
 * editor-preflight — translate "installed but can't run" into a clear
 * reason + remediation instead of a raw dyld dump.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  preflightEditor,
  ensureVsCodeClaudeExtension,
  resolveVsCodeBinary,
  CLAUDE_VSCODE_EXTENSION,
  type PreflightRunner,
} from '../../lib/editor-preflight';

function runnerWith(result: Partial<ReturnType<PreflightRunner>>): PreflightRunner {
  return () => ({
    status: 0,
    signal: null,
    stdout: '',
    stderr: '',
    ...result,
  });
}

describe('preflightEditor', () => {
  it('passes when the binary exits 0', () => {
    const r = preflightEditor('claude', runnerWith({ status: 0, stdout: '2.0.0' }));
    expect(r.ok).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  it('translates the real-world dyld abort into a macOS requirement message', () => {
    // Exact failure from Adam's iMac, 2026-06-04.
    const stderr = [
      'dyld: Symbol not found: _ubrk_clone',
      '  Referenced from: /Users/x/.nvm/versions/node/v22.20.0/bin/claude (which was built for Mac OS X 13.0)',
      '  Expected in: /usr/lib/libicucore.A.dylib',
    ].join('\n');
    const r = preflightEditor('claude', runnerWith({ status: null, signal: 'SIGABRT', stderr }));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('cannot run on this Mac');
    expect(r.reason).toContain('macOS 13.0+');
    expect(r.hint).toContain('Update macOS to 13.0 or later');
    expect(r.hint).toContain('claude.ai/code');
    // The raw dyld noise must NOT leak into the user-facing reason.
    expect(r.reason).not.toContain('_ubrk_clone');
  });

  it('handles dyld errors without a parseable version', () => {
    const r = preflightEditor(
      'claude',
      runnerWith({ status: 1, stderr: 'dyld: Library not loaded: @rpath/libfoo.dylib' }),
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('newer macOS');
    expect(r.hint).toBeTruthy();
  });

  it('reports crash signals without dyld markers', () => {
    const r = preflightEditor('cursor', runnerWith({ status: null, signal: 'SIGSEGV' }));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('crashed on launch (signal SIGSEGV)');
  });

  it('reports plain non-zero exits with the first output line', () => {
    const r = preflightEditor(
      'codex',
      runnerWith({ status: 2, stderr: 'Error: config missing\nstack line' }),
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('Error: config missing');
    expect(r.reason).not.toContain('stack line');
  });

  it('reports spawn-level errors (ENOENT etc.)', () => {
    const r = preflightEditor(
      'claude',
      runnerWith({ status: null, error: new Error('spawn claude ENOENT') }),
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('failed to launch');
  });
});

describe('ensureVsCodeClaudeExtension', () => {
  // A normal user never learns what an extension is — `solid ai` installs
  // it for them before opening VS Code.

  it('no-ops when the extension is already installed', () => {
    const calls: string[][] = [];
    const runner: PreflightRunner = (_bin, args) => {
      calls.push(args);
      return { status: 0, signal: null, stdout: `ms-python.python\n${CLAUDE_VSCODE_EXTENSION}\n`, stderr: '' };
    };
    const r = ensureVsCodeClaudeExtension(runner);
    expect(r).toEqual({ installed: true, justInstalled: false });
    expect(calls).toEqual([['--list-extensions']]); // never tried to install
  });

  it('detects the extension case-insensitively', () => {
    const runner: PreflightRunner = () => ({
      status: 0, signal: null, stdout: 'Anthropic.Claude-Code\n', stderr: '',
    });
    expect(ensureVsCodeClaudeExtension(runner).installed).toBe(true);
  });

  it('installs the extension when missing', () => {
    const calls: string[][] = [];
    const runner: PreflightRunner = (_bin, args) => {
      calls.push(args);
      if (args[0] === '--list-extensions') {
        return { status: 0, signal: null, stdout: 'ms-python.python\n', stderr: '' };
      }
      return { status: 0, signal: null, stdout: `Extension '${CLAUDE_VSCODE_EXTENSION}' was successfully installed.`, stderr: '' };
    };
    const r = ensureVsCodeClaudeExtension(runner);
    expect(r.installed).toBe(true);
    expect(r.justInstalled).toBe(true);
    expect(calls[1]).toEqual(['--install-extension', CLAUDE_VSCODE_EXTENSION]);
  });

  it('reports failure detail when the marketplace install fails', () => {
    const runner: PreflightRunner = (_bin, args) =>
      args[0] === '--list-extensions'
        ? { status: 0, signal: null, stdout: '', stderr: '' }
        : { status: 1, signal: null, stdout: '', stderr: 'Failed: ETIMEDOUT marketplace.visualstudio.com' };
    const r = ensureVsCodeClaudeExtension(runner);
    expect(r.installed).toBe(false);
    expect(r.justInstalled).toBe(false);
    expect(r.detail).toContain('ETIMEDOUT');
  });

  it('reports failure when even --list-extensions fails', () => {
    const runner: PreflightRunner = () => ({ status: 1, signal: null, stdout: '', stderr: 'broken code CLI' });
    const r = ensureVsCodeClaudeExtension(runner, 'code');
    expect(r.installed).toBe(false);
    expect(r.detail).toContain('broken code CLI');
  });
});

describe('resolveVsCodeBinary', () => {
  // A fresh VS Code install does NOT put `code` on PATH — a normal user
  // never runs "Shell Command: Install 'code' command in PATH". So the
  // resolver must find the app bundle too.
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'solid-vscode-resolve-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function makeExecutable(p: string): void {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  }

  it('prefers `code` on PATH', () => {
    const binDir = path.join(tmp, 'bin');
    makeExecutable(path.join(binDir, 'code'));
    const r = resolveVsCodeBinary({ platform: 'darwin', homeDir: tmp, pathEnv: binDir });
    expect(r).toBe(path.join(binDir, 'code'));
  });

  it('falls back to the user-Applications app bundle on macOS', () => {
    const bundleBin = path.join(
      tmp, 'Applications', 'Visual Studio Code.app', 'Contents', 'Resources', 'app', 'bin', 'code',
    );
    makeExecutable(bundleBin);
    const r = resolveVsCodeBinary({
      platform: 'darwin',
      homeDir: tmp,
      pathEnv: path.join(tmp, 'empty'),
      systemRoot: path.join(tmp, 'sysroot'),
    });
    expect(r).toBe(bundleBin);
  });

  it('finds the system /Applications bundle on macOS', () => {
    const sysroot = path.join(tmp, 'sysroot');
    const bundleBin = path.join(
      sysroot, 'Applications', 'Visual Studio Code.app', 'Contents', 'Resources', 'app', 'bin', 'code',
    );
    makeExecutable(bundleBin);
    const r = resolveVsCodeBinary({
      platform: 'darwin',
      homeDir: path.join(tmp, 'home'),
      pathEnv: path.join(tmp, 'empty'),
      systemRoot: sysroot,
    });
    expect(r).toBe(bundleBin);
  });

  it('returns null when VS Code is genuinely not installed', () => {
    const r = resolveVsCodeBinary({
      platform: 'darwin',
      homeDir: tmp,
      pathEnv: path.join(tmp, 'empty'),
      systemRoot: path.join(tmp, 'sysroot'),
    });
    expect(r).toBeNull();
  });
});
