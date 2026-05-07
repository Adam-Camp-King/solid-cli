/**
 * --json output control.
 *
 * Sources of truth, checked in order:
 *   1. Local subcommand --json option (existing behavior)
 *   2. Local subcommand --no-json (explicit human override)
 *   3. Program-level --json option
 *   4. SOLID_JSON=1 env var
 *   5. SOLID_NO_JSON=1 env var (explicit human override)
 *   6. **NEW:** auto-detect — when stdout is NOT a TTY (piped, redirected,
 *      called by an agent over MCP, run inside CI), default to JSON.
 *      Agents read structured output; humans read prose. The TTY signal
 *      is the cleanest discriminator and matches the convention modern
 *      AI-first CLIs (gh, terraform JSON output, etc.) lean on.
 *
 * Commands that already check `options.json` keep working — the new
 * helpers are for (a) unifying detection across sources and (b) a
 * convenience emitter that prints once-and-exits.
 */
import { Command } from 'commander';

let programJson = false;

export function setProgramJson(on: boolean): void {
  programJson = Boolean(on);
}

/** True when the user has explicitly opted out of JSON. */
function explicitHumanOptOut(localOptions?: { json?: boolean } | Record<string, unknown>): boolean {
  if (localOptions && (localOptions as any).json === false) return true;
  if (process.env.SOLID_NO_JSON && /^(1|true|yes|on)$/i.test(process.env.SOLID_NO_JSON)) return true;
  return false;
}

/** True when stdout is not a TTY (pipe, redirect, agent, CI). */
export function isNonTty(): boolean {
  // process.stdout.isTTY is undefined when not a TTY, true when it is.
  return process.stdout.isTTY !== true;
}

/**
 * True if any signal asks for JSON, including the auto-detect (non-TTY).
 * Pass the local command's options to honor the most specific flag.
 */
export function isJsonOutput(localOptions?: { json?: boolean } | Record<string, unknown>): boolean {
  if (localOptions && (localOptions as any).json === true) return true;
  if (explicitHumanOptOut(localOptions)) return false;
  if (programJson) return true;
  if (process.env.SOLID_JSON && /^(1|true|yes|on)$/i.test(process.env.SOLID_JSON)) return true;
  // Auto-detect: agents and scripts pipe; humans use TTYs.
  if (isNonTty()) return true;
  return false;
}

/** Emit JSON to stdout (pretty-printed) and return true so caller can early-return. */
export function emitJson(data: unknown): true {
  process.stdout.write(JSON.stringify(data, null, 2));
  if (!String(JSON.stringify(data)).endsWith('\n')) process.stdout.write('\n');
  return true;
}

/**
 * Scan argv for the top-level --json flag at boot so the flag is set
 * before any command's action runs. Idempotent.
 */
export function activateProgramJsonIfRequested(argv: string[]): void {
  if (argv.includes('--json')) {
    setProgramJson(true);
  }
}

/**
 * Helper for action handlers: merge the program-level flag into the
 * local options so existing `options.json` checks pick it up for free.
 * Pass the Commander `this` context (or just the options object).
 */
export function mergeGlobalJson<T extends { json?: boolean }>(localOptions: T, cmd?: Command): T {
  if ((localOptions as any).json) return localOptions;
  const parentJson = cmd?.parent?.opts?.().json === true;
  if (programJson || parentJson || isJsonOutput()) {
    return { ...localOptions, json: true };
  }
  return localOptions;
}
