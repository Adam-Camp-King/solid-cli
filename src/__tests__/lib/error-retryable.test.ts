/**
 * `retryable` is a promise to an agent: retrying this identical call could work.
 *
 * Sprint VNP 1.2. Every 4xx that was not explicitly listed — 400, 405, 410,
 * 415 — fell through to a `default` returning SERVER_ERROR, which isRetryable()
 * reports as true. So `solid verbs list --surface bogusXYZ` answered 400 /
 * SERVER_ERROR / retryable:true, and an agent honouring the field re-sent the
 * same bad request forever. A typo was an infinite loop.
 *
 * The rule: false for every 4xx except 408 and 429, which are the only two a
 * plain retry can genuinely fix.
 */
import { classifyError, isRetryable } from '../../lib/error-codes';

const classify = (status: number, data: unknown = {}) =>
  classifyError({ status, data });

describe('4xx classification', () => {
  it.each([400, 402, 405, 410, 415, 418, 451])(
    '%i is BAD_REQUEST and not retryable',
    (status) => {
      const c = classify(status);
      expect(c.code).toBe('BAD_REQUEST');
      expect(isRetryable(c.code)).toBe(false);
    },
  );

  it.each([
    [401, 'AUTH_REQUIRED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [409, 'CONFLICT'],
    [422, 'VALIDATION_FAILED'],
  ])('%i keeps its specific code (%s), still not retryable', (status, code) => {
    const c = classify(status as number);
    expect(c.code).toBe(code);
    expect(isRetryable(c.code)).toBe(false);
  });

  it('408 is the timeout exception — retryable', () => {
    const c = classify(408);
    expect(c.code).toBe('TIMEOUT');
    expect(isRetryable(c.code)).toBe(true);
  });

  it('429 is the rate-limit exception — retryable', () => {
    const c = classify(429);
    expect(c.code).toBe('RATE_LIMITED');
    expect(isRetryable(c.code)).toBe(true);
  });

  it('5xx stays retryable — the server may recover', () => {
    for (const status of [500, 502, 503]) {
      const c = classify(status);
      expect(c.code).toBe('SERVER_ERROR');
      expect(isRetryable(c.code)).toBe(true);
    }
  });

  it('no 4xx is ever reported as retryable except 408 and 429', () => {
    const loopers: number[] = [];
    for (let status = 400; status < 500; status++) {
      if (status === 408 || status === 429) continue;
      if (isRetryable(classify(status).code)) loopers.push(status);
    }
    expect(loopers).toEqual([]);
  });

  it('the 422 hint points at something that exists and applies', () => {
    // It used to say "Run with --help to see required flags". The verb path
    // takes JSON via -p, so --help shows nothing relevant — and pointing at an
    // unbuilt command would be the same bug in a new place.
    const c = classify(422, { detail: 'contact_id: Field required' });
    expect(c.hint).toContain('solid verbs describe');
    expect(c.hint).not.toContain('--help');
  });
});
