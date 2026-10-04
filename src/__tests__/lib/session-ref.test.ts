/**
 * The run's session id — sent as X-Solid-Session so every verb receipt of one
 * run can be read back together. The backend drops anything that is not
 * `cli:` + 8–64 of [A-Za-z0-9_-], so the CLI must never send anything else.
 */
import { resolveSessionRef, CLI_SESSION_REF } from '../../lib/api-client';

const SHAPE = /^cli:[A-Za-z0-9_-]{8,64}$/;

describe('resolveSessionRef', () => {
  it('mints a well-formed id when none is given', () => {
    expect(resolveSessionRef(undefined)).toMatch(SHAPE);
    expect(resolveSessionRef('')).toMatch(SHAPE);
    expect(resolveSessionRef(undefined)).not.toBe(resolveSessionRef(undefined));
  });

  it('keeps a session id the agent set, with or without the prefix', () => {
    expect(resolveSessionRef('my-run-0001')).toBe('cli:my-run-0001');
    expect(resolveSessionRef('cli:my-run-0001')).toBe('cli:my-run-0001');
  });

  it('never sends another kind of session or a malformed id', () => {
    for (const bad of ['voice_call:814', 'conversation:abc12345', 'short', 'has space 1', 'semi;colon-1', 'a'.repeat(65)]) {
      const ref = resolveSessionRef(bad);
      expect(ref).toMatch(SHAPE);
      expect(ref).not.toContain(bad);
    }
  });

  it('is one value for the whole process', () => {
    expect(CLI_SESSION_REF).toMatch(SHAPE);
  });
});
