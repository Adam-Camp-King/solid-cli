/**
 * --json output control (T11.3).
 *
 * Three sources of truth, checked in order:
 *   1. The subcommand's own --json option (existing behavior, unchanged)
 *   2. The program-level --json option (NEW — set at root)
 *   3. SOLID_JSON=1 env var (for piped/scripted usage)
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

/**
 * True if any of: subcommand --json, program --json, SOLID_JSON env.
 * Pass the local command's options to honor the most specific flag.
 */
export function isJsonOutput(localOptions?: { json?: boolean } | Record<string, unknown>): boolean {
  if (localOptions && (localOptions as any).json === true) return true;
  if (programJson) return true;
  if (process.env.SOLID_JSON && /^(1|true|yes|on)$/i.test(process.env.SOLID_JSON)) return true;
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
