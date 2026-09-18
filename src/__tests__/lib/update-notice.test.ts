/**
 * The update notice must actually fire.
 *
 * ⛔ WHAT BROKE — measured 2026-09-17.
 *
 * index.ts used update-notifier v7 and printed nothing, ever. Four runs of
 * 2.23.0 on a fresh machine under a real TTY, with 2.24.0 on npm, produced no
 * notice. Its cache said why:
 *
 *     { "optOut": false, "lastUpdateCheck": 1789690217519 }
 *
 * No `update` key. It stores the ATTEMPT in the parent process and leaves the
 * registry lookup to a detached child that does not outlive a short CLI run, so
 * the answer is never persisted while the timestamp is — and the timestamp then
 * suppresses retries for four hours. Permanently "recently checked", permanently
 * empty.
 *
 * Every client on 2.23.0 was therefore never told a newer CLI existed. 2.23.0 is
 * the build whose login banner claims "any AI agent running in this shell
 * inherits it — type claude and go", which is false, so their agent could not
 * reach their company and nothing pointed them at the fix.
 *
 * The regression test that matters is the last one: a check that learns nothing
 * must write nothing, or it silences the next run exactly as before.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  FETCH_TIMEOUT_MS,
  REFRESH_AFTER_MS,
  cachePath,
  isStale,
  noticeFor,
  readCache,
  refreshCache,
  writeCache,
} from '../../lib/update-notice';

function tmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solid-update-notice-'));
  return path.join(dir, 'update_check.json');
}

describe('cachePath', () => {
  it('lives under ~/.solid, beside the rest of the CLI state', () => {
    expect(cachePath('/home/someone')).toBe('/home/someone/.solid/update_check.json');
  });
});

describe('noticeFor', () => {
  it('tells the operator when a newer version is known', () => {
    const notice = noticeFor('2.23.0', { latest: '2.24.0', checkedAt: Date.now() });
    expect(notice).toContain('2.23.0');
    expect(notice).toContain('2.24.0');
    // `solid update` — NOT `npm i -g`, which installs a second copy for anyone
    // who came from the Homebrew tap or scoop.
    expect(notice).toContain('solid update');
    expect(notice).not.toContain('npm i -g');
  });

  it('says nothing when up to date or ahead', () => {
    expect(noticeFor('2.24.0', { latest: '2.24.0', checkedAt: Date.now() })).toBeNull();
    expect(noticeFor('2.25.0', { latest: '2.24.0', checkedAt: Date.now() })).toBeNull();
  });

  it('says nothing when there is no cache yet', () => {
    expect(noticeFor('2.23.0', null)).toBeNull();
  });
});

describe('the cache stores the ANSWER, not the attempt', () => {
  it('round-trips a result', () => {
    const f = tmpFile();
    writeCache({ latest: '2.24.0', checkedAt: 1234 }, f);
    expect(readCache(f)).toEqual({ latest: '2.24.0', checkedAt: 1234 });
  });

  it('a file without a version is not a usable cache', () => {
    const f = tmpFile();
    // This is update-notifier's file, verbatim. It must never read as "checked".
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ optOut: false, lastUpdateCheck: 1789690217519 }));
    expect(readCache(f)).toBeNull();
    expect(isStale(readCache(f))).toBe(true);
  });

  it('a missing or corrupt cache is stale, never an error', () => {
    expect(readCache(path.join(os.tmpdir(), 'does-not-exist-at-all.json'))).toBeNull();
    const f = tmpFile();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, 'not json');
    expect(readCache(f)).toBeNull();
  });
});

describe('isStale', () => {
  it('trusts a fresh result and re-checks an old one', () => {
    const now = 1_000_000_000;
    expect(isStale({ latest: '2.24.0', checkedAt: now - 1000 }, now)).toBe(false);
    expect(isStale({ latest: '2.24.0', checkedAt: now - REFRESH_AFTER_MS - 1 }, now)).toBe(true);
    expect(isStale(null, now)).toBe(true);
  });
});

describe('refreshCache', () => {
  it('stores what the registry said', async () => {
    const f = tmpFile();
    const fake = (async () => ({ ok: true, json: async () => ({ version: '2.24.0' }) })) as unknown as typeof fetch;
    await refreshCache(f, fake, () => 4242);
    expect(readCache(f)).toEqual({ latest: '2.24.0', checkedAt: 4242 });
  });

  it('⛔ writes NOTHING when the check fails — a failed check must not silence the next run', async () => {
    const f = tmpFile();
    const boom = (async () => {
      throw new Error('ETIMEDOUT');
    }) as unknown as typeof fetch;
    await refreshCache(f, boom, () => 4242);
    expect(readCache(f)).toBeNull();
    expect(isStale(readCache(f))).toBe(true);
  });

  it('does not overwrite a good result with a failure', async () => {
    const f = tmpFile();
    writeCache({ latest: '2.24.0', checkedAt: 1 }, f);
    const boom = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await refreshCache(f, boom, () => 9999);
    expect(readCache(f)).toEqual({ latest: '2.24.0', checkedAt: 1 });
  });

  it('bounds the lookup so it can never hold up a command', async () => {
    let sawSignal = false;
    const fake = (async (_u: unknown, init?: RequestInit) => {
      sawSignal = init?.signal instanceof AbortSignal;
      return { ok: true, json: async () => ({ version: '2.24.0' }) };
    }) as unknown as typeof fetch;
    await refreshCache(tmpFile(), fake, () => 1);
    expect(sawSignal).toBe(true);
    expect(FETCH_TIMEOUT_MS).toBeLessThanOrEqual(3000);
  });
});
