/**
 * Counting the CLI's top-level commands — used by scripts/sync-counts.ts, which
 * stamps the count onto every public surface.
 */
import { execSync } from 'child_process';

/**
 * The number of top-level commands, read from the command index — bare
 * `solid` on a non-TTY prints `solid:command-index/v1`, built from
 * `program.commands` in src/index.ts. The public count and the index an agent
 * reads are then the same number by construction.
 *
 * ⛔ This used to count `--help` lines matching /^ {2}[a-z]/ after
 * 'Commands:'. The root help ends in an after-help tour whose example rows
 * ('  solid inbox   Unified inbox …') match that pattern too, so every example
 * was counted as a command: 172 against 135 real ones on 2026-09-24 (2.24.5).
 */
export function countCommands(dist: string, env: NodeJS.ProcessEnv): number {
  // execSync pipes stdout, so the CLI sees a non-TTY and prints the index.
  const raw = execSync(`node "${dist}"`, { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
  return commandsFromIndex(raw);
}

/** Pure: the command count from the index payload. Refuses a payload that disagrees with itself. */
export function commandsFromIndex(raw: string): number {
  const index = JSON.parse(raw) as { schema?: string; commands?: unknown; names?: unknown };
  if (index.schema !== 'solid:command-index/v1' || !Array.isArray(index.names)) {
    throw new Error('bare `solid` did not print the command index — cannot count commands');
  }
  if (index.commands !== index.names.length) {
    throw new Error(`command index disagrees with itself: commands=${String(index.commands)}, names=${index.names.length}`);
  }
  return index.names.length;
}
