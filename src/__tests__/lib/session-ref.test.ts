/**
 * The run's session id — sent as X-Solid-Session so every verb receipt of one
 * run can be read back together. The backend drops anything that is not
 * `cli:` + 8–64 of [A-Za-z0-9_-], so the CLI must never send anything else.
 */
import { clientAppFromEnv, resolveSessionRef, CLI_SESSION_REF } from '../../lib/api-client';

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

describe('clientAppFromEnv', () => {
  it('names the AI app from its own shell, so a run reads back with the AI named', () => {
    expect(clientAppFromEnv({ AI_AGENT: 'claude-code_2-1-301_agent' })).toBe('claude-code');
    expect(clientAppFromEnv({ CLAUDECODE: '1' })).toBe('claude-code');
  });

  it('lets SOLID_CLIENT_APP say it, and cleans what becomes a header', () => {
    expect(clientAppFromEnv({ SOLID_CLIENT_APP: 'cursor', CLAUDECODE: '1' })).toBe('cursor');
    expect(clientAppFromEnv({ SOLID_CLIENT_APP: 'cur<sor>\r\nX-Evil: 1' })).toBe('cursorX-Evil 1');
    expect((clientAppFromEnv({ SOLID_CLIENT_APP: 'a'.repeat(200) }) || '').length).toBeLessThanOrEqual(40);
  });

  it('is null for a person at a terminal', () => {
    expect(clientAppFromEnv({})).toBeNull();
    expect(clientAppFromEnv({ CLAUDECODE: '0' })).toBeNull();
  });
});
