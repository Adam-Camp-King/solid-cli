/**
 * Unit tests for lib/offline-queue.ts — A+.6.
 *
 * Covers:
 *   - enqueue() writes a chronologically-named .jsonld file with the
 *     expected fields (method, url, body, idempotencyKey, queuedAt)
 *   - readQueue() returns files in chronological order
 *   - deleteQueued() removes the file
 *   - readQueue() skips malformed files instead of failing
 *   - queueSize() counts what's pending
 *   - isQueueMode() / setQueueMode() round-trip
 *   - SOLID_OFFLINE_QUEUE env var arms the mode
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  autoFlushQueue,
  deleteQueued,
  enqueue,
  isAutoFlushInProgress,
  isQueueMode,
  queueDir,
  queueSize,
  readQueue,
  setQueueMode,
} from '../../lib/offline-queue';

function tempCwd(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'solid-queue-test-'));
}

afterEach(() => {
  setQueueMode(false);
  delete process.env.SOLID_OFFLINE_QUEUE;
});


describe('mode toggle', () => {
  it('setQueueMode flips the flag', () => {
    expect(isQueueMode()).toBe(false);
    setQueueMode(true);
    expect(isQueueMode()).toBe(true);
    setQueueMode(false);
    expect(isQueueMode()).toBe(false);
  });

  it('SOLID_OFFLINE_QUEUE env var arms the mode', () => {
    process.env.SOLID_OFFLINE_QUEUE = '1';
    expect(isQueueMode()).toBe(true);
  });

  it.each(['1', 'true', 'yes', 'on'])('env var truthy value %s arms the mode', (val) => {
    process.env.SOLID_OFFLINE_QUEUE = val;
    expect(isQueueMode()).toBe(true);
  });

  it('env var falsy values do not arm the mode', () => {
    process.env.SOLID_OFFLINE_QUEUE = '0';
    expect(isQueueMode()).toBe(false);
  });
});


describe('enqueue', () => {
  it('writes a JSON-LD file with the expected fields', () => {
    const cwd = tempCwd();
    const result = enqueue('POST', '/api/v1/kb', { title: 'X', content: 'Y' }, { cwd });

    expect(fs.existsSync(result.path)).toBe(true);
    const written = JSON.parse(fs.readFileSync(result.path, 'utf-8'));
    expect(written.method).toBe('POST');
    expect(written.url).toBe('/api/v1/kb');
    expect(written.body).toEqual({ title: 'X', content: 'Y' });
    expect(written.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(written.queuedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(written['@type']).toContain('solid:QueuedMutation');
    expect(written['@id']).toBe(`urn:solid:queued:${written.idempotencyKey}`);
  });

  it('upper-cases the method', () => {
    const cwd = tempCwd();
    const result = enqueue('patch', '/api/v1/kb/1', {}, { cwd });
    const written = JSON.parse(fs.readFileSync(result.path, 'utf-8'));
    expect(written.method).toBe('PATCH');
  });

  it('creates the queue directory on first write', () => {
    const cwd = tempCwd();
    expect(fs.existsSync(queueDir(cwd))).toBe(false);
    enqueue('POST', '/api/v1/kb', null, { cwd });
    expect(fs.existsSync(queueDir(cwd))).toBe(true);
  });

  it('files sort chronologically by name', async () => {
    const cwd = tempCwd();
    enqueue('POST', '/api/v1/a', null, { cwd });
    // Force at least 1ms gap so timestamps differ
    await new Promise((r) => setTimeout(r, 5));
    enqueue('POST', '/api/v1/b', null, { cwd });
    await new Promise((r) => setTimeout(r, 5));
    enqueue('POST', '/api/v1/c', null, { cwd });
    const files = fs.readdirSync(queueDir(cwd)).sort();
    expect(files).toHaveLength(3);
    // readQueue sorts by queuedAt — order matches insertion
    const queue = readQueue(cwd);
    expect(queue.map((q) => q.mutation.url)).toEqual(['/api/v1/a', '/api/v1/b', '/api/v1/c']);
  });
});


describe('readQueue', () => {
  it('returns empty array when queue dir does not exist', () => {
    const cwd = tempCwd();
    expect(readQueue(cwd)).toEqual([]);
  });

  it('skips malformed files (warns to stderr, does not throw)', () => {
    const cwd = tempCwd();
    enqueue('POST', '/api/v1/good', null, { cwd });
    // Write a malformed file
    fs.writeFileSync(path.join(queueDir(cwd), 'bad.jsonld'), 'not json at all');

    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const items = readQueue(cwd);
    expect(items).toHaveLength(1);
    expect(items[0].mutation.url).toBe('/api/v1/good');
    stderr.mockRestore();
  });

  it('ignores non-.jsonld files', () => {
    const cwd = tempCwd();
    enqueue('POST', '/api/v1/x', null, { cwd });
    // Drop a stray file
    fs.writeFileSync(path.join(queueDir(cwd), 'README.txt'), 'not a queue file');
    const items = readQueue(cwd);
    expect(items).toHaveLength(1);
  });
});


describe('deleteQueued', () => {
  it('removes the file from disk', () => {
    const cwd = tempCwd();
    const r = enqueue('POST', '/api/v1/x', null, { cwd });
    expect(fs.existsSync(r.path)).toBe(true);
    deleteQueued(r.path);
    expect(fs.existsSync(r.path)).toBe(false);
  });

  it('is idempotent — deleting already-removed file does not throw', () => {
    const cwd = tempCwd();
    const r = enqueue('POST', '/api/v1/x', null, { cwd });
    deleteQueued(r.path);
    expect(() => deleteQueued(r.path)).not.toThrow();
  });
});


describe('queueSize', () => {
  it('counts pending mutations', () => {
    const cwd = tempCwd();
    expect(queueSize(cwd)).toBe(0);
    enqueue('POST', '/a', null, { cwd });
    enqueue('PUT', '/b', null, { cwd });
    expect(queueSize(cwd)).toBe(2);
    const items = readQueue(cwd);
    deleteQueued(items[0].path);
    expect(queueSize(cwd)).toBe(1);
  });
});


describe('idempotency keys', () => {
  it('every mutation gets a distinct UUID', () => {
    const cwd = tempCwd();
    const a = enqueue('POST', '/a', null, { cwd });
    const b = enqueue('POST', '/a', null, { cwd });  // same URL/body, different mutation
    expect(a.mutation.idempotencyKey).not.toBe(b.mutation.idempotencyKey);
  });
});


describe('autoFlushQueue (A+.6b)', () => {
  it('drains every queued mutation when dispatcher succeeds', async () => {
    const cwd = tempCwd();
    enqueue('POST', '/api/v1/a', { x: 1 }, { cwd });
    enqueue('PUT', '/api/v1/b/2', { y: 2 }, { cwd });
    enqueue('DELETE', '/api/v1/c/3', null, { cwd });
    expect(queueSize(cwd)).toBe(3);

    const calls: Array<{ method: string; url: string }> = [];
    const dispatch = async (method: string, url: string) => {
      calls.push({ method, url });
    };

    const stats = await autoFlushQueue(dispatch, cwd);
    expect(stats).toEqual({ succeeded: 3, failed: 0, total: 3 });
    expect(queueSize(cwd)).toBe(0);
    expect(calls).toHaveLength(3);
  });

  it('replays in chronological order', async () => {
    const cwd = tempCwd();
    enqueue('POST', '/api/v1/first', null, { cwd });
    await new Promise((r) => setTimeout(r, 5));
    enqueue('POST', '/api/v1/second', null, { cwd });
    await new Promise((r) => setTimeout(r, 5));
    enqueue('POST', '/api/v1/third', null, { cwd });

    const order: string[] = [];
    await autoFlushQueue(async (_m, url) => { order.push(url); }, cwd);
    expect(order).toEqual(['/api/v1/first', '/api/v1/second', '/api/v1/third']);
  });

  it('leaves failed mutations in queue, retries others', async () => {
    const cwd = tempCwd();
    enqueue('POST', '/api/v1/ok', null, { cwd });
    enqueue('POST', '/api/v1/bad', null, { cwd });
    enqueue('POST', '/api/v1/ok2', null, { cwd });

    const dispatch = async (_m: string, url: string) => {
      if (url.endsWith('/bad')) throw new Error('simulated 500');
    };
    const stats = await autoFlushQueue(dispatch, cwd);
    expect(stats.succeeded).toBe(2);
    expect(stats.failed).toBe(1);
    // Bad one stays in queue
    expect(queueSize(cwd)).toBe(1);
  });

  it('returns zero-stats and is a no-op when queue is empty', async () => {
    const cwd = tempCwd();
    const stats = await autoFlushQueue(async () => {}, cwd);
    expect(stats).toEqual({ succeeded: 0, failed: 0, total: 0 });
  });

  it('isAutoFlushInProgress() reflects in-flight state', async () => {
    const cwd = tempCwd();
    enqueue('POST', '/x', null, { cwd });
    expect(isAutoFlushInProgress()).toBe(false);
    let observedDuringDispatch = false;
    await autoFlushQueue(async () => {
      observedDuringDispatch = isAutoFlushInProgress();
    }, cwd);
    expect(observedDuringDispatch).toBe(true);
    expect(isAutoFlushInProgress()).toBe(false);
  });

  it('re-entry is suppressed (the recursion guard)', async () => {
    const cwd = tempCwd();
    enqueue('POST', '/x', null, { cwd });

    // Simulate the auto-flush guard being held by an outer call.
    // A second autoFlushQueue invocation while the first is in-flight
    // must return zero-stats instead of double-dispatching.
    let outerCalls = 0;
    const dispatch = async () => {
      outerCalls++;
      // Mid-dispatch, ask for another flush. The guard should block it.
      const innerStats = await autoFlushQueue(async () => {
        // If reached, the guard failed — assertion below will fire.
        outerCalls += 100;
      }, cwd);
      expect(innerStats).toEqual({ succeeded: 0, failed: 0, total: 0 });
    };
    await autoFlushQueue(dispatch, cwd);
    expect(outerCalls).toBe(1);
  });
});
