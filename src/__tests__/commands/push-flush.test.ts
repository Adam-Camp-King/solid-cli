/**
 * Integration test for `solid push --flush` — A+.6.
 *
 * The full enqueue → replay path needs (1) `--queue` to arm offline
 * mode, (2) a mutation that goes through the api-client interceptor,
 * (3) a logged-in session to replay against. (3) is out of scope for
 * a unit-test environment.
 *
 * What we test here:
 *   - `solid push --flush` reports an empty queue cleanly when none exists
 *   - `solid push --flush` detects a hand-placed queue file and asks
 *     for login before replaying (proves the empty-vs-non-empty branch
 *     and the auth gate)
 *   - `solid --queue --version` doesn't crash (proves --queue parses
 *     at the program level)
 *
 * The deeper queue mechanics (file format, idempotency, ordering) are
 * exercised in offline-queue.test.ts.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

const root = path.join(__dirname, '..', '..', '..');
const distEntry = path.join(root, 'dist', 'index.js');

const distExists = fs.existsSync(distEntry);
const describeOrSkip = distExists ? describe : describe.skip;

function setupTenant(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'solid-flush-'));
}

describeOrSkip('solid push --flush', () => {
  it('reports empty queue cleanly (exit 0)', () => {
    const tmp = setupTenant();
    const out = execFileSync(
      'node',
      [distEntry, 'push', '--flush'],
      { cwd: tmp, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    expect(out).toMatch(/Queue is empty/);
  });

  it('detects hand-placed queue files and requires auth before replay', () => {
    const tmp = setupTenant();
    const queueDir = path.join(tmp, '.solid', 'queue');
    fs.mkdirSync(queueDir, { recursive: true });
    const ts = new Date().toISOString();
    const filename = `${ts.replace(/[:.]/g, '-')}-uuid1.jsonld`;
    fs.writeFileSync(
      path.join(queueDir, filename),
      JSON.stringify({
        '@id': 'urn:solid:queued:uuid1',
        '@type': ['solid:QueuedMutation'],
        method: 'POST',
        url: '/api/v1/kb',
        body: { title: 'Test', content: 'X' },
        idempotencyKey: 'uuid1',
        queuedAt: ts,
      }),
    );

    // CLI reads ~/.solid/config.json. Override HOME so isLoggedIn()
    // sees a fresh (no-config) environment regardless of the dev's
    // real session.
    let exited = 0;
    let stdout = '';
    let stderr = '';
    try {
      execFileSync(
        'node',
        [distEntry, 'push', '--flush'],
        {
          cwd: tmp,
          encoding: 'utf-8',
          env: { ...process.env, HOME: tmp, USERPROFILE: tmp },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
    } catch (err: unknown) {
      const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
      exited = e.status ?? 0;
      stdout = String(e.stdout ?? '');
      stderr = String(e.stderr ?? '');
    }
    expect(exited).toBe(1);
    const combined = stdout + stderr;
    expect(combined).toMatch(/Not logged in|auth login/);
    // Queue file MUST still exist after a failed-auth flush
    expect(fs.existsSync(path.join(queueDir, filename))).toBe(true);
  });

  it('--queue flag is parseable at the program level (no crash on --version)', () => {
    const tmp = setupTenant();
    const out = execFileSync(
      'node',
      [distEntry, '--queue', '--version'],
      { cwd: tmp, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    // --version prints the package version
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
