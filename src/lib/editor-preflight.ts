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
  (binary: string, args: string[], opts?: { timeoutMs?: number }): {
    status: number | null;
    signal: string | null;
    stdout: string;
    stderr: string;
    error?: Error;
  };
}

const defaultRunner: PreflightRunner = (binary, args, opts) => {
  const r = spawnSync(binary, args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: opts?.timeoutMs ?? 15_000,
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
  claude:
    'Use the Claude Code VS Code extension (runs on older macOS — `solid mcp install vscode`), claude.ai/code in the browser, or Cursor.',
  cursor: 'Use the Claude Code VS Code extension, claude.ai/code in the browser, or Claude Code.',
  code: 'Use claude.ai/code in the browser, or another editor on this machine.',
  codex: 'Use another editor on this machine.',
};

/** Marketplace id of the Claude Code extension for VS Code. */
export const CLAUDE_VSCODE_EXTENSION = 'anthropic.claude-code';

export interface EnsureExtensionResult {
  installed: boolean;
  /** true when this call performed the install (vs already present). */
  justInstalled: boolean;
  detail?: string;
}

/**
 * Make sure the Claude Code extension is installed in VS Code. Normal
 * users shouldn't have to know extensions exist — `solid ai` calls this
 * before opening VS Code so Claude is just THERE when the window opens.
 * Uses `code --list-extensions` / `code --install-extension`, both
 * supported headlessly by VS Code's CLI.
 */
export function ensureVsCodeClaudeExtension(
  runner: PreflightRunner = defaultRunner,
): EnsureExtensionResult {
  let listed: ReturnType<PreflightRunner>;
  try {
    listed = runner('code', ['--list-extensions']);
  } catch (e) {
    return { installed: false, justInstalled: false, detail: (e as Error).message };
  }
  if (listed.error || listed.status !== 0) {
    return {
      installed: false,
      justInstalled: false,
      detail: (listed.error?.message || listed.stderr || `exit ${listed.status}`).trim().slice(0, 160),
    };
  }
  const have = listed.stdout
    .split('\n')
    .map((l) => l.trim().toLowerCase())
    .includes(CLAUDE_VSCODE_EXTENSION);
  if (have) return { installed: true, justInstalled: false };

  let install: ReturnType<PreflightRunner>;
  try {
    // Marketplace download — allow well past the 15s preflight default.
    install = runner('code', ['--install-extension', CLAUDE_VSCODE_EXTENSION], { timeoutMs: 120_000 });
  } catch (e) {
    return { installed: false, justInstalled: false, detail: (e as Error).message };
  }
  if (install.error || install.status !== 0) {
    return {
      installed: false,
      justInstalled: false,
      detail: (install.error?.message || install.stderr || `exit ${install.status}`).trim().slice(0, 160),
    };
  }
  return { installed: true, justInstalled: true };
}

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
