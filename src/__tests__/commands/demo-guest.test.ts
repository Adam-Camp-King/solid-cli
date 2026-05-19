/**
 * --guest demo flow tests.
 *
 * Pins the contract that the synthesized email used for guest-mode
 * audit rows matches the analytics filter pattern
 * `*@anonymous.solidnumber.com` and that each invocation produces a
 * different address (so two back-to-back demos don't collide).
 */

import { synthesizeGuestEmail, EMAIL_RE } from '../../commands/demo';

describe('guest demo — synthesizeGuestEmail', () => {
  it('produces an email that passes the standard validator', () => {
    const email = synthesizeGuestEmail();
    expect(EMAIL_RE.test(email)).toBe(true);
  });

  it('routes to the anonymous discard domain (analytics filter contract)', () => {
    const email = synthesizeGuestEmail();
    expect(email.endsWith('@anonymous.solidnumber.com')).toBe(true);
  });

  it('starts with the cli-guest prefix so server-side analytics can attribute', () => {
    const email = synthesizeGuestEmail();
    expect(email.startsWith('cli-guest-')).toBe(true);
  });

  it('generates a different address on each call (no collision risk)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      seen.add(synthesizeGuestEmail());
    }
    // Tolerate one or two collisions in extreme bad-luck (timestamp ms
    // + 10 chars of base36 randomness), but a real bug would collide
    // far more.
    expect(seen.size).toBeGreaterThan(95);
  });

  it('contains a timestamp component so old rows can be aged out', () => {
    const before = Date.now();
    const email = synthesizeGuestEmail();
    const after = Date.now();
    // Extract `<ts>` from `cli-guest-<ts>-<rand>@...`
    const match = email.match(/^cli-guest-([0-9a-z]+)-/);
    expect(match).not.toBeNull();
    const ts = parseInt(match![1], 36);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});
