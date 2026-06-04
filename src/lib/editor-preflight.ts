/**
 * Editor preflight — "on PATH" is not the same as "can actually run."
 *
 * Real-world failure this exists for (2026-06-04, Adam's older iMac):
 * Claude Code was installed via npm, so `command -v claude` succeeded —
 * setup reported ✓ green for the MCP wiring and the SessionStart hook —
 * but the `claude` native binary requires macOS 13+ and the machine was
 * older, so every launch aborted with:
 *
 *   dyld: Symbol not found: _ubrk_clone
 *     Referenced from: .../bin/claude (which was built for Mac OS X 13.0)
 *     Expected in: /usr/lib/libicucore.A.dylib
 *
 * A new user reads that as "Solid is broken." This module runs
 * `<binary> --version` once and translates launch failures into a plain
 * reason + remediation hint, so `solid setup` / `solid ai` can say what
 * is actually wrong and what to do about it.
 */
import { spawnSync } from 'child_process';

export interface PreflightResult {
  ok: boolean;
  /** One-line, human-readable reason when ok=false. */
  reason?: string;
  /** Actionable remediation — what to do on THIS machine. */
  hint?: string;
}

export interface PreflightRunner {
  (binary: string, args: string[]): {
    status: number | null;
    signal: string | null;
    stdout: string;
    stderr: string;
    error?: Error;
  };
}

const defaultRunner: PreflightRunner = (binary, args) => {
  const r = spawnSync(binary, args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15_000,
    env: { ...process.env, SOLID_SKIP_VERSION_CHECK: '1' },
  });
  return {
    status: r.status,
    signal: r.signal,
    stdout: (r.stdout || '').toString(),
    stderr: (r.stderr || '').toString(),
    error: r.error,
  };
};

// Per-editor alternatives shown when the binary can't run on this machine.
const ALTERNATIVES: Record<string, string> = {
  claude: 'Use claude.ai/code in the browser, or Cursor on this machine.',
  cursor: 'Use claude.ai/code in the browser, or Claude Code on this machine.',
  codex: 'Use another editor on this machine.',
};

/**
 * Run `<binary> --version` and translate any launch failure into a
 * human-readable reason + hint. ok=true means the binary genuinely
 * starts on this machine.
 */
export function preflightEditor(
  binary: string,
  runner: PreflightRunner = defaultRunner,
): PreflightResult {
  let r: ReturnType<PreflightRunner>;
  try {
    r = runner(binary, ['--version']);
  } catch (e) {
    return {
      ok: false,
      reason: `${binary} failed to launch: ${(e as Error).message}`,
      hint: `Reinstall ${binary}, then re-run this command.`,
    };
  }

  if (r.error) {
    return {
      ok: false,
      reason: `${binary} failed to launch: ${r.error.message}`,
      hint: `Reinstall ${binary}, then re-run this command.`,
    };
  }

  if (r.status === 0) return { ok: true };

  const output = `${r.stderr}\n${r.stdout}`;

  // dyld symbol/link errors = the binary was built for a newer macOS than
  // this machine runs. Extract the "built for Mac OS X 13.0" version when
  // present so the message names the real requirement.
  if (/dyld|Symbol not found|Library not loaded/i.test(output)) {
    const built = output.match(/built for (?:Mac OS X|macOS) (\d+(?:\.\d+)?)/i);
    const needs = built ? `macOS ${built[1]}+` : 'a newer macOS than this machine is running';
    return {
      ok: false,
      reason: `${binary} is installed but cannot run on this Mac — its binary requires ${needs}.`,
      hint: `Update macOS${built ? ` to ${built[1]} or later` : ''}, or: ${ALTERNATIVES[binary] || 'use another editor.'}`,
    };
  }

  if (r.signal) {
    return {
      ok: false,
      reason: `${binary} is installed but crashed on launch (signal ${r.signal}).`,
      hint: `Reinstall ${binary}. If it keeps crashing: ${ALTERNATIVES[binary] || 'use another editor.'}`,
    };
  }

  const firstLine = output.trim().split('\n')[0]?.slice(0, 160) || `exit code ${r.status}`;
  return {
    ok: false,
    reason: `${binary} is installed but exited with an error on launch: ${firstLine}`,
    hint: `Reinstall ${binary}, then re-run this command.`,
  };
}
