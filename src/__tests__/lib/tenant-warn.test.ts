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
        message: 'Operating on implicit current company (id=61). Pass --company to be explicit.',
        company_id: 61,
        hint: 'Add --company <id> to lock the tenant for this call, or set SOLID_COMPANY_ID. Silence with SOLID_NO_TENANT_WARN=1.',
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

  it('does NOT warn when SOLID_COMPANY_ID is set', () => {
    expect(shouldWarnImplicitTenant({ argv: ['node', 'cli', 'pages', 'list'], env: { SOLID_COMPANY_ID: '15' }, hasCurrentCompany: true })).toBe(false);
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
