/**
 * Stub for `@puppeteer/browsers` in unit tests.
 *
 * The package is ESM-only from 3.x, and jest does not transform node_modules,
 * so any suite that transitively imports `lib/browser-install.ts` died with
 * "SyntaxError: Unexpected token 'export'" — including tests of pure helpers
 * that never touch a browser (lighthouse-runner's extractIssues, for one).
 *
 * Downloading and launching Chromium is system-level behaviour and belongs to
 * the integration suite, so unit tests get this stub. Anything that genuinely
 * needs the real module should be an integration test.
 */
export const Browser = { CHROME: 'chrome' } as const;
export const BrowserPlatform = {} as Record<string, string>;

export function computeExecutablePath(): string {
  return '/stub/chrome';
}
export function computeSystemExecutablePath(): string {
  return '/stub/system-chrome';
}
export function detectBrowserPlatform(): string {
  return 'mac_arm';
}
export async function getInstalledBrowsers(): Promise<unknown[]> {
  return [];
}
export async function install(): Promise<{ executablePath: string }> {
  return { executablePath: '/stub/chrome' };
}
export async function resolveBuildId(): Promise<string> {
  return 'stub-build';
}
