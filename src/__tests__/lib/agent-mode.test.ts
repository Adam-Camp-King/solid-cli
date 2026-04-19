/**
 * Agent-mode caps are a security surface: getting them wrong lets an
 * AI agent do things its human operator didn't sanction. These tests
 * lock the allowlist contract so refactors don't widen the surface
 * silently.
 */

import {
  parseAgentMode,
  isModeAllowed,
  requiresHumanConfirmation,
  MODE_ALLOWLIST,
} from '../../lib/agent-mode';

describe('parseAgentMode', () => {
  it.each(['customer', 'developer', 'agency', 'full'])(
    'accepts "%s"',
    (mode) => expect(parseAgentMode(mode)).toBe(mode),
  );

  it('is case-insensitive and trims', () => {
    expect(parseAgentMode(' Customer ')).toBe('customer');
    expect(parseAgentMode('AGENCY')).toBe('agency');
  });

  it('rejects invalid strings and null-ish inputs', () => {
    expect(parseAgentMode('admin')).toBeNull();
    expect(parseAgentMode('')).toBeNull();
    expect(parseAgentMode(null)).toBeNull();
    expect(parseAgentMode(undefined)).toBeNull();
  });
});

describe('isModeAllowed', () => {
  it('full mode allows everything (no cap)', () => {
    expect(isModeAllowed('full', 'orders')).toBe(true);
    expect(isModeAllowed('full', 'switch')).toBe(true);
    expect(isModeAllowed('full', 'anything-goes')).toBe(true);
  });

  it('customer mode blocks developer commands', () => {
    expect(isModeAllowed('customer', 'pages')).toBe(true); // reads OK
    expect(isModeAllowed('customer', 'push')).toBe(false); // write-to-code NO
    expect(isModeAllowed('customer', 'sandbox')).toBe(false);
    expect(isModeAllowed('customer', 'vibe')).toBe(false);
  });

  it('customer mode blocks agency commands', () => {
    expect(isModeAllowed('customer', 'switch')).toBe(false);
    expect(isModeAllowed('customer', 'company')).toBe(false);
    expect(isModeAllowed('customer', 'users')).toBe(false);
    expect(isModeAllowed('customer', 'keys')).toBe(false);
  });

  it('customer mode allows business operations', () => {
    expect(isModeAllowed('customer', 'orders')).toBe(true);
    expect(isModeAllowed('customer', 'crm')).toBe(true);
    expect(isModeAllowed('customer', 'voice')).toBe(true);
    expect(isModeAllowed('customer', 'payment')).toBe(true);
  });

  it('developer mode blocks agency commands', () => {
    expect(isModeAllowed('developer', 'switch')).toBe(false);
    expect(isModeAllowed('developer', 'company')).toBe(false);
    expect(isModeAllowed('developer', 'users')).toBe(false);
    expect(isModeAllowed('developer', 'migrate')).toBe(false);
  });

  it('developer mode blocks payments / customer-financial operations', () => {
    expect(isModeAllowed('developer', 'payment')).toBe(false);
    expect(isModeAllowed('developer', 'billing')).toBe(false);
    expect(isModeAllowed('developer', 'orders')).toBe(false);
  });

  it('agency mode allows switching + managing + training', () => {
    expect(isModeAllowed('agency', 'switch')).toBe(true);
    expect(isModeAllowed('agency', 'company')).toBe(true);
    expect(isModeAllowed('agency', 'users')).toBe(true);
    expect(isModeAllowed('agency', 'train')).toBe(true);
    expect(isModeAllowed('agency', 'migrate')).toBe(true);
  });

  it('common commands (auth / whoami / ai / install) are available in every mode', () => {
    for (const mode of ['customer', 'developer', 'agency'] as const) {
      for (const cmd of ['auth', 'whoami', 'ai', 'install', 'context']) {
        expect(isModeAllowed(mode, cmd)).toBe(true);
      }
    }
  });
});

describe('requiresHumanConfirmation', () => {
  it('flags destructive verbs regardless of command context', () => {
    expect(requiresHumanConfirmation('orders refund 123')).toBe(true);
    expect(requiresHumanConfirmation('crm contacts delete 123')).toBe(true);
    expect(requiresHumanConfirmation('users remove foo@bar.com')).toBe(true);
    expect(requiresHumanConfirmation('subscriptions cancel 1')).toBe(true);
    expect(requiresHumanConfirmation('auth logout --all')).toBe(true);
    expect(requiresHumanConfirmation('rollback page 42')).toBe(true);
  });

  it('leaves safe commands alone', () => {
    expect(requiresHumanConfirmation('pages list')).toBe(false);
    expect(requiresHumanConfirmation('status')).toBe(false);
    expect(requiresHumanConfirmation('crm contacts list')).toBe(false);
    expect(requiresHumanConfirmation('orders list')).toBe(false);
  });

  it('is case-insensitive — REFUND is the same as refund', () => {
    expect(requiresHumanConfirmation('orders REFUND 999')).toBe(true);
  });
});

describe('MODE_ALLOWLIST — structural invariants', () => {
  it('every mode lists the core common commands', () => {
    const coreCommon = ['auth', 'whoami', 'ai', 'install', 'context'];
    for (const mode of ['customer', 'developer', 'agency'] as const) {
      for (const cmd of coreCommon) {
        expect(MODE_ALLOWLIST[mode]).toContain(cmd);
      }
    }
  });

  it('customer mode does NOT include high-blast-radius developer verbs', () => {
    const forbiddenForCustomers = ['push', 'deploy', 'sandbox', 'vibe', 'rollback'];
    for (const cmd of forbiddenForCustomers) {
      expect(MODE_ALLOWLIST.customer).not.toContain(cmd);
    }
  });

  it('developer mode does NOT include payment/financial verbs', () => {
    const forbiddenForDevs = ['payment', 'billing', 'orders', 'subscriptions'];
    for (const cmd of forbiddenForDevs) {
      expect(MODE_ALLOWLIST.developer).not.toContain(cmd);
    }
  });
});
