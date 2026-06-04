/**
 * editor-preflight — translate "installed but can't run" into a clear
 * reason + remediation instead of a raw dyld dump.
 */
import { preflightEditor, type PreflightRunner } from '../../lib/editor-preflight';

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
