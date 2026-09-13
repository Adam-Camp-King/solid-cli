/**
 * `fix` must be a command you can actually run.
 *
 * Sprint VNP 2.5. `hint` is prose; `fix` is executable. The rule that matters
 * more than coverage is that it must be REAL — a template like
 * `solid verbs describe <verb>` looks like coverage and hands the caller a
 * string that fails.
 *
 * That is not hypothetical: the 403 hint told every feature-gated caller to run
 * `solid upgrade`, which has never existed, and a test pinned it there. Both
 * are corrected. Where no single command repairs an error, there is no `fix`
 * and the message still names the field or the conflict.
 */
import { classifyError, fixForCode, toErrorEnvelope } from '../../lib/error-codes';

describe('fixForCode', () => {
  it.each([
    [401, {}, 'solid auth login'],
    [403, { code: 'FEATURE_GATED', feature: 'x' }, 'solid billing status'],
    [500, {}, 'solid health'],
  ])('status %i -> %s', (status, data, want) => {
    expect(fixForCode(classifyError({ status: status as number, data }))).toBe(want);
  });

  it('names the missing scope in the rotate command', () => {
    const c = classifyError({ status: 403, data: { detail: 'Missing scope: verbs:write' } });
    expect(fixForCode(c)).toBe('solid keys rotate --add-scope verbs:write');
  });

  it('has no fix where no single command repairs it', () => {
    // Better absent than a placeholder that fails when run.
    for (const status of [400, 404, 409, 422, 429]) {
      expect(fixForCode(classifyError({ status }))).toBeUndefined();
    }
  });

  it('never emits a placeholder', () => {
    for (const status of [400, 401, 403, 404, 408, 409, 422, 429, 500, 503]) {
      const fix = fixForCode(classifyError({ status }));
      if (!fix) continue;
      expect(fix).not.toMatch(/[<>]/);       // no <verb> style holes
      expect(fix.startsWith('solid ')).toBe(true);
    }
  });

  it('never suggests a command that does not exist', () => {
    // The specific regression: `solid upgrade` was named for months.
    const all = [400, 401, 403, 404, 408, 409, 422, 429, 500]
      .map((s) => fixForCode(classifyError({ status: s })))
      .filter(Boolean) as string[];
    expect(all).not.toContain('solid upgrade');
  });
});

describe('the envelope carries it', () => {
  it('includes fix when there is one', () => {
    const env = toErrorEnvelope(classifyError({ status: 401 }), 401, 'nope');
    expect(env.error.fix).toBe('solid auth login');
  });

  it('omits the key entirely when there is not', () => {
    const env = toErrorEnvelope(classifyError({ status: 409 }), 409, 'conflict');
    expect('fix' in env.error).toBe(false);
  });
});
