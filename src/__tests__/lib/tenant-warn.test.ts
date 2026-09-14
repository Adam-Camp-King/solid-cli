/**
 * tenant-warn — soft warning contract.
 *
 * Locks: an agent (non-TTY) operating without --company on a CLI that
 * has a "current company" gets a structured warning it can branch on.
 * Humans on a TTY do not get the warning. Existing scripts can opt out.
 */
import {
  buildImplicitTenantWarning,
  shouldWarnImplicitTenant,
} from '../../lib/tenant-warn';

const ORIGINAL_TTY = process.stdout.isTTY;

function setTTY(value: boolean): void {
  Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true });
}

afterAll(() => {
  Object.defineProperty(process.stdout, 'isTTY', { value: ORIGINAL_TTY, configurable: true });
});

describe('buildImplicitTenantWarning', () => {
  it('produces the agent-discoverable shape with code IMPLICIT_TENANT', () => {
    expect(buildImplicitTenantWarning(61)).toEqual({
      warning: {
        code: 'IMPLICIT_TENANT',
        message: 'Operating on implicit current company (id=61). Confirm this is the tenant you mean.',
        company_id: 61,
        // The hint must only name things that work. It used to say "--company
        // <id>" (present on 4 of 171 commands) and SOLID_COMPANY_ID (scopes
        // nothing). `solid switch` is what actually changes tenant.
        hint: 'Currently authenticated as company 61. To act on a different tenant, run `solid switch` (or `solid auth login` as a user of that company) — the tenant comes from your session, not from a flag. Silence with SOLID_NO_TENANT_WARN=1.',
      },
    });
  });
});

describe('shouldWarnImplicitTenant', () => {
  beforeEach(() => setTTY(false)); // default to agent context

  it('warns when non-TTY + currentCompany + no explicit flag/env', () => {
    expect(shouldWarnImplicitTenant({ argv: ['node', 'cli', 'pages', 'list'], env: {}, hasCurrentCompany: true })).toBe(true);
  });

  it('does NOT warn on a human TTY', () => {
    setTTY(true);
    expect(shouldWarnImplicitTenant({ argv: ['node', 'cli', 'pages', 'list'], env: {}, hasCurrentCompany: true })).toBe(false);
  });

  it('does NOT warn when --company is passed', () => {
    expect(shouldWarnImplicitTenant({ argv: ['node', 'cli', '--company', '15', 'pages', 'list'], env: {}, hasCurrentCompany: true })).toBe(false);
    expect(shouldWarnImplicitTenant({ argv: ['node', 'cli', '--company=15', 'pages', 'list'], env: {}, hasCurrentCompany: true })).toBe(false);
  });

  it('STILL warns when SOLID_COMPANY_ID is set — it scopes nothing', () => {
    // The tenant comes from the JWT, so this variable cannot redirect a call.
    // Silencing on it produced a quiet session that operated on whichever
    // company the JWT actually named, which is the failure the warning exists
    // to prevent. A mismatch is refused outright at boot; a match is not a
    // reason to go quiet.
    expect(shouldWarnImplicitTenant({ argv: ['node', 'cli', 'pages', 'list'], env: { SOLID_COMPANY_ID: '15' }, hasCurrentCompany: true })).toBe(true);
  });

  it('does NOT warn when SOLID_NO_TENANT_WARN=1', () => {
    expect(shouldWarnImplicitTenant({ argv: ['node', 'cli', 'pages', 'list'], env: { SOLID_NO_TENANT_WARN: '1' }, hasCurrentCompany: true })).toBe(false);
  });

  it('does NOT warn when there is no current company (e.g. fresh login)', () => {
    expect(shouldWarnImplicitTenant({ argv: ['node', 'cli', 'pages', 'list'], env: {}, hasCurrentCompany: false })).toBe(false);
  });

  it('honors -c short flag', () => {
    expect(shouldWarnImplicitTenant({ argv: ['node', 'cli', '-c', '15', 'pages', 'list'], env: {}, hasCurrentCompany: true })).toBe(false);
  });
});
