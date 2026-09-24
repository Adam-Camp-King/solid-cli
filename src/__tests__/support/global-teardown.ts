/** Fails the run if the suite changed anything in the real ~/.solid. See global-home.ts. */
import * as fs from 'fs';
import { fingerprint } from './global-home';

export default async function globalTeardown(): Promise<void> {
  const realHome = process.env.SOLID_TEST_REAL_HOME;
  const before = process.env.SOLID_TEST_REAL_SOLID_FP;
  const tmpHome = process.env.SOLID_TEST_TMP_HOME;
  if (tmpHome && tmpHome.includes('solid-cli-test-home-')) {
    try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  if (!realHome || !before) return;
  const after = JSON.stringify(fingerprint(realHome));
  if (after !== before) {
    throw new Error(
      `The test suite modified the real ${realHome}/.solid ` +
      `(before ${before}, after ${after}). A test resolved the real home instead of the ` +
      `temp one set in src/__tests__/support/global-home.ts. (Running the real \`solid\` ` +
      `CLI yourself during the run also trips this.)`,
    );
  }
}
