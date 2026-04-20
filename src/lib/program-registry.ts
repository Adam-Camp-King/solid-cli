/**
 * program-registry — lazy handle on the root Commander program so any
 * command module can introspect the full verb tree without creating an
 * import cycle with index.ts.
 *
 * Sprint 1 T1.3: `solid schema verbs --json` needs to walk every
 * subcommand. Without this registry, schema.ts would have to import
 * program from index.ts, which already imports schemaCommand from
 * schema.ts — cycle.
 *
 * Pure module state: one writer (index.ts) + many readers (schema,
 * doctor, etc.). No async, no I/O.
 */
import type { Command } from 'commander';

let _program: Command | null = null;

export function setProgram(p: Command): void {
  _program = p;
}

export function getProgram(): Command | null {
  return _program;
}

/** Reset for tests. */
export function resetProgramForTest(): void {
  _program = null;
}
