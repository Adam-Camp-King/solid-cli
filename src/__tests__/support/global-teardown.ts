/** Fails the run if the suite changed anything in the real ~/.solid. See global-home.ts. */
import * as fs from 'fs';
import { HOOK_COMMAND } from '../../lib/claude-hook';
import { addedEntries, fingerprint, readHistory, type Fingerprint, type HistoryEntry } from './global-home';

// What the session hook leaves in the history: its command without the binary name.
const HOOK_INVOCATION = HOOK_COMMAND.replace(/^solid\s+/, '');

/** Null when the real ~/.solid is as the suite found it; otherwise why the run fails. */
export function realHomeViolation(
  before: Fingerprint,
  after: Fingerprint,
  historyBefore: HistoryEntry[],
  historyAfter: HistoryEntry[],
): string | null {
  const changed = Object.keys({ ...before, ...after }).filter((f) => before[f] !== after[f]);
  if (changed.length === 0) return null;
  const others = changed.filter((f) => f !== 'cli_history.json');
  if (others.length > 0) {
    return `changed ${others.join(', ')} (before ${JSON.stringify(before)}, after ${JSON.stringify(after)})`;
  }
  const added = addedEntries(historyBefore, historyAfter);
  const foreign = added.filter((e) => e.command !== HOOK_INVOCATION);
  if (added.length > 0 && foreign.length === 0) return null;
  if (foreign.length === 0) {
    return `rewrote cli_history.json without adding a command (before ${before['cli_history.json']}, after ${after['cli_history.json']})`;
  }
  return `added to cli_history.json: ${foreign.map((e) => `\`${e.command}\` at ${e.ts}`).join(', ')}`;
}

export default async function globalTeardown(): Promise<void> {
  const realHome = process.env.SOLID_TEST_REAL_HOME;
  const before = process.env.SOLID_TEST_REAL_SOLID_FP;
  const tmpHome = process.env.SOLID_TEST_TMP_HOME;
  if (tmpHome && tmpHome.includes('solid-cli-test-home-')) {
    try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  if (!realHome || !before) return;
  const violation = realHomeViolation(
    JSON.parse(before),
    fingerprint(realHome),
    JSON.parse(process.env.SOLID_TEST_REAL_HISTORY || '[]'),
    readHistory(realHome),
  );
  if (violation) {
    throw new Error(
      `The real ${realHome}/.solid was modified during the test run: ${violation}. ` +
      `A test resolved the real home instead of the temp one set in ` +
      `src/__tests__/support/global-home.ts. (Running the real \`solid\` CLI yourself ` +
      `during the run also trips this; a Claude session opening does not.)`,
    );
  }
}
