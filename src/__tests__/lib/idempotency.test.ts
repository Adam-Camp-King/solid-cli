import { nextIdempotencyKey } from '../../lib/api-client';

/**
 * Idempotency keys on online mutations. The CLI attaches an Idempotency-Key to
 * every POST/PUT/PATCH/DELETE so an internal retry (401 refresh, network blip)
 * or an offline-queue replay can't double-execute a write. nextIdempotencyKey
 * is the pure decision the request interceptor uses.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('nextIdempotencyKey', () => {
  const noEnv = {} as NodeJS.ProcessEnv;

  it.each(['post', 'put', 'patch', 'delete', 'POST', 'Delete'])(
    'mints a UUID for mutating method %s',
    (method) => {
      const key = nextIdempotencyKey(method, false, noEnv);
      expect(key).toMatch(UUID_RE);
    },
  );

  it.each(['get', 'head', 'GET', undefined])('returns null for non-mutating method %s', (method) => {
    expect(nextIdempotencyKey(method, false, noEnv)).toBeNull();
  });

  it('never overwrites a caller-pinned key (offline-queue replay / apply)', () => {
    expect(nextIdempotencyKey('post', true, noEnv)).toBeNull();
  });

  it('honors the SOLID_NO_IDEMPOTENCY opt-out', () => {
    expect(nextIdempotencyKey('post', false, { SOLID_NO_IDEMPOTENCY: '1' } as NodeJS.ProcessEnv)).toBeNull();
  });

  it('mints a DISTINCT key per logical call (so two writes are two operations)', () => {
    const a = nextIdempotencyKey('post', false, noEnv);
    const b = nextIdempotencyKey('post', false, noEnv);
    expect(a).not.toEqual(b);
  });
});
