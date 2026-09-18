/**
 * "You are N versions behind" — a notice that actually fires.
 *
 * ⛔ WHY THIS REPLACES update-notifier — measured 2026-09-17.
 *
 * index.ts called update-notifier v7 and it never printed a single notice. On a
 * fresh machine, four runs of 2.23.0 under a real TTY while 2.24.0 was on npm:
 * nothing. The cache it left behind says why:
 *
 *     { "optOut": false, "lastUpdateCheck": 1789690217519 }
 *
 * There is no `update` key. update-notifier writes `lastUpdateCheck` in the
 * PARENT process and delegates the registry lookup to a detached child that is
 * supposed to persist the result. The child does not survive a short-lived CLI,
 * so no result is ever stored — and because `lastUpdateCheck` IS stored, the
 * update interval then suppresses every retry for four hours. The steady state
 * is a check that is permanently "recently done" and permanently empty.
 *
 * What that cost: a client on 2.23.0 is never told a newer CLI exists, on any
 * run, indefinitely. 2.23.0 is the version whose login banner promises "any AI
 * agent running in this shell inherits it — type claude and go", which is not
 * true; nothing inherits that token, so their agent cannot reach their company
 * and they have no way to learn that the fix already shipped. Meanwhile
 * `solid update --json` on that same copy correctly reports
 * {"current":"2.23.0","latest":"2.24.0","up_to_date":false} — the detection was
 * never the problem, only the telling.
 *
 * Two rules this follows that update-notifier did not:
 *
 *  1. PERSIST THE RESULT, NOT THE ATTEMPT. The cache stores the version we
 *     found. A run that learns nothing writes nothing, so a failed or truncated
 *     check can never suppress the next one.
 *  2. READING IS SYNCHRONOUS AND FREE. The notice comes off disk before any
 *     command runs, so it costs no latency and cannot be lost to process exit.
 *     The network refresh is fire-and-forget and only ever affects LATER runs.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { isNewer, latestVersion } from '../commands/update';

/** How long a stored result is trusted before we look again. */
export const REFRESH_AFTER_MS = 1000 * 60 * 60 * 4;

/** Bound on the registry lookup. It must never hold up a command. */
export const FETCH_TIMEOUT_MS = 2000;

export interface UpdateCache {
  /** The version npm had when we last got an answer. */
  latest: string;
  /** When we got it. Only ever written alongside a real answer. */
  checkedAt: number;
}

export function cachePath(home: string = os.homedir()): string {
  return path.join(home, '.solid', 'update_check.json');
}

export function readCache(file: string = cachePath()): UpdateCache | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (typeof raw?.latest === 'string' && typeof raw?.checkedAt === 'number') {
      return { latest: raw.latest, checkedAt: raw.checkedAt };
    }
  } catch {
    // No cache yet, or unreadable. Either way there is nothing to report.
  }
  return null;
}

export function writeCache(entry: UpdateCache, file: string = cachePath()): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(entry, null, 2) + '\n', { mode: 0o600 });
  } catch {
    // A cache we cannot write is a notice one run later, not an error.
  }
}

export function isStale(cache: UpdateCache | null, now: number = Date.now()): boolean {
  return !cache || now - cache.checkedAt > REFRESH_AFTER_MS;
}

/**
 * The notice text, or null when there is nothing to say.
 *
 * Deliberately NOT update-notifier's message: its {updateCommand} token
 * hardcodes `npm i -g @solidnumber/cli`, which for anyone who installed from
 * the Homebrew tap or scoop installs a SECOND copy instead of upgrading the one
 * they have — two `solid` binaries on PATH at different versions. `solid update`
 * detects the install method and upgrades in place.
 */
export function noticeFor(current: string, cache: UpdateCache | null): string | null {
  if (!cache || !isNewer(current, cache.latest)) return null;
  return `Update available: ${current} → ${cache.latest}. Run \`solid update\``;
}

/**
 * Refresh the stored result. Never awaited by a command; never blocks exit.
 * Writes ONLY on a real answer, so a timeout does not silence the next run.
 */
export async function refreshCache(
  file: string = cachePath(),
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<void> {
  try {
    const bounded: typeof fetch = (input, init) =>
      fetchImpl(input, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const latest = await latestVersion(bounded);
    if (latest) writeCache({ latest, checkedAt: now() }, file);
  } catch {
    // Offline, slow, or blocked. Write nothing — the next run tries again.
  }
}
