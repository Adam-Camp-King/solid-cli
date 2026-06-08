import { importESM } from '../../lib/esm-import';

/**
 * importESM exists so the CommonJS bundle can load ESM-only packages
 * (lighthouse, update-notifier) without tsc lowering the dynamic import to
 * require() — which throws ERR_REQUIRE_ESM on Node < 20.19. These tests pin the
 * contract: it performs a *real* dynamic import (resolves a module namespace)
 * and surfaces failures as a rejected promise rather than throwing inline.
 */
describe('importESM', () => {
  it('returns a promise (never throws synchronously, even for a bad specifier)', () => {
    const p = importESM('this-module-does-not-exist-x9');
    expect(p).toBeInstanceOf(Promise);
    return expect(p).rejects.toBeDefined();
  });

  it('uses a real dynamic import(), not a require() (the whole point)', async () => {
    // In jest's CommonJS sandbox a *require()* of a core module resolves fine,
    // but a native dynamic import() is rejected with the experimental-vm-modules
    // marker. So this rejection is positive proof importESM did NOT degrade to
    // require() — exactly the property that keeps ESM-only deps loadable on
    // Node < 20.19. Outside jest (real node) the same call resolves; that path
    // is covered by the runtime smoke check in the release flow.
    await expect(importESM('node:path')).rejects.toThrow(/vm-modules|dynamic import/i);
  });

  it('rejects for a missing module instead of crashing the caller', async () => {
    await expect(importESM('@solidnumber/definitely-not-real')).rejects.toBeTruthy();
  });
});
