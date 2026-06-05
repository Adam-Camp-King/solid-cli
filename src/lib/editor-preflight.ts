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
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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

/**
 * Find the VS Code CLI even when `code` is NOT on PATH.
 *
 * A fresh VS Code install does NOT add `code` to the shell — the user has
 * to run "Shell Command: Install 'code' command in PATH" from inside
 * VS Code, which a normal user never does. So we check PATH first, then
 * the standard install locations per OS. Returns the launchable path, or
 * null when VS Code genuinely isn't installed.
 */
export function resolveVsCodeBinary(
  opts: { platform?: NodeJS.Platform; homeDir?: string; pathEnv?: string; systemRoot?: string } = {},
): string | null {
  const platform = opts.platform ?? process.platform;
  const home = opts.homeDir ?? os.homedir();
  const pathEnv = opts.pathEnv ?? process.env.PATH ?? '';
  // Injectable so tests stay hermetic on machines that have a real
  // /Applications/Visual Studio Code.app.
  const root = opts.systemRoot ?? path.sep;

  // 1. PATH — the happy case.
  for (const entry of pathEnv.split(path.delimiter)) {
    if (!entry) continue;
    const candidate = path.join(entry, platform === 'win32' ? 'code.cmd' : 'code');
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch { /* keep looking */ }
  }

  // 2. Standard install locations.
  const candidates: string[] =
    platform === 'darwin'
      ? [
          path.join(root, 'Applications', 'Visual Studio Code.app', 'Contents', 'Resources', 'app', 'bin', 'code'),
          path.join(home, 'Applications', 'Visual Studio Code.app', 'Contents', 'Resources', 'app', 'bin', 'code'),
        ]
      : platform === 'win32'
        ? [
            path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
            path.join(root, 'Program Files', 'Microsoft VS Code', 'bin', 'code.cmd'),
          ]
        : [
            path.join(root, 'usr', 'share', 'code', 'bin', 'code'),
            path.join(root, 'usr', 'bin', 'code'),
            path.join(root, 'snap', 'bin', 'code'),
            path.join(home, '.local', 'share', 'code', 'bin', 'code'),
          ];
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch { /* keep looking */ }
  }
  return null;
}

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
  codeBin?: string,
): EnsureExtensionResult {
  const bin = codeBin ?? resolveVsCodeBinary() ?? 'code';
  let listed: ReturnType<PreflightRunner>;
  try {
    listed = runner(bin, ['--list-extensions']);
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
    install = runner(bin, ['--install-extension', CLAUDE_VSCODE_EXTENSION], { timeoutMs: 120_000 });
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
  // `binary` may be a bare name (claude) or a resolved full path (the
  // VS Code app-bundle case). Messages and the alternatives lookup use
  // the short name either way.
  const name = path.basename(binary).replace(/\.(cmd|exe|bat)$/i, '');

  let r: ReturnType<PreflightRunner>;
  try {
    r = runner(binary, ['--version']);
  } catch (e) {
    return {
      ok: false,
      reason: `${name} failed to launch: ${(e as Error).message}`,
      hint: `Reinstall ${name}, then re-run this command.`,
    };
  }

  if (r.error) {
    return {
      ok: false,
      reason: `${name} failed to launch: ${r.error.message}`,
      hint: `Reinstall ${name}, then re-run this command.`,
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
      reason: `${name} is installed but cannot run on this Mac — its binary requires ${needs}.`,
      hint: `Update macOS${built ? ` to ${built[1]} or later` : ''}, or: ${ALTERNATIVES[name] || 'use another editor.'}`,
    };
  }

  if (r.signal) {
    return {
      ok: false,
      reason: `${name} is installed but crashed on launch (signal ${r.signal}).`,
      hint: `Reinstall ${name}. If it keeps crashing: ${ALTERNATIVES[name] || 'use another editor.'}`,
    };
  }

  const firstLine = output.trim().split('\n')[0]?.slice(0, 160) || `exit code ${r.status}`;
  return {
    ok: false,
    reason: `${name} is installed but exited with an error on launch: ${firstLine}`,
    hint: `Reinstall ${name}, then re-run this command.`,
  };
}
