/**
 * Chromium installer for `solid render` and `solid audit` (A.1 + A.5).
 *
 * Sprint: SPRINT-CLI-AGENT-CAN-SHIP.md § A.1
 *
 * Strategy
 * --------
 * `puppeteer-core` ships ~9 MB; the actual Chromium binary is ~150 MB.
 * We don't ship Chromium with every CLI install — most users never
 * touch the screenshot/audit commands. Instead, on first `solid render`
 * or `solid audit` invocation:
 *
 *   1. Look for an already-cached Chromium at `~/.solid/chromium/`.
 *   2. Look for a system Chrome (macOS bundle, Linux PATH).
 *   3. If neither, prompt + download via `@puppeteer/browsers`. In
 *      non-interactive contexts (no TTY, CI, agent) we honor
 *      `SOLID_AUTO_INSTALL=1` for unattended download; otherwise
 *      print the explicit `solid render --install` recovery command.
 *
 * Cache layout: `~/.solid/chromium/chrome/<platform>-<buildId>/...`
 * (whatever `@puppeteer/browsers` decides). We never write outside
 * `~/.solid/`.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  Browser,
  computeExecutablePath,
  computeSystemExecutablePath,
  detectBrowserPlatform,
  getInstalledBrowsers,
  install,
  resolveBuildId,
} from '@puppeteer/browsers';


/** Where we cache downloaded browsers. Lives under ~/.solid/ so it
 *  inherits the existing tenant-scoped directory and tracks with the
 *  CLI install. */
export function browserCacheDir(): string {
  return path.join(os.homedir(), '.solid', 'chromium');
}

/**
 * Resolve a Chromium executable path the renderer can launch.
 *
 *   Order of preference (highest → lowest):
 *     1. SOLID_CHROMIUM_PATH env (operator override)
 *     2. Cached download under ~/.solid/chromium/
 *     3. System Chrome (macOS bundle, Linux PATH)
 *
 * Returns `null` when nothing is available — caller decides whether
 * to prompt for install or fail with a hint.
 */
export async function findChromiumExecutable(): Promise<string | null> {
  const envPath = process.env.SOLID_CHROMIUM_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

  // 2. Cached download from a previous install
  try {
    const cacheDir = browserCacheDir();
    if (fs.existsSync(cacheDir)) {
      const installed = await getInstalledBrowsers({ cacheDir });
      const chrome = installed.find((b) => b.browser === Browser.CHROME);
      if (chrome) {
        const exe = computeExecutablePath({
          browser: Browser.CHROME,
          buildId: chrome.buildId,
          cacheDir,
        });
        if (fs.existsSync(exe)) return exe;
      }
    }
  } catch {
    // fall through to system check
  }

  // 3. System Chrome — macOS bundle, Linux PATH, Windows registry
  try {
    const platform = detectBrowserPlatform();
    if (platform) {
      const sys = computeSystemExecutablePath({ browser: Browser.CHROME, channel: 'stable' as never, platform });
      if (sys && fs.existsSync(sys)) return sys;
    }
  } catch {
    // computeSystemExecutablePath throws when no system Chrome —
    // expected on Linux servers. Fall through.
  }

  return null;
}


export interface InstallResult {
  /** Absolute path to the launchable Chromium executable. */
  executablePath: string;
  /** Build ID (Chrome version) we installed. */
  buildId: string;
  /** Whether we downloaded (true) or found an existing install (false). */
  downloaded: boolean;
}

/**
 * Ensure a Chromium binary is available, downloading if necessary.
 *
 * Behavior:
 *   - If a Chromium is already findable (env override / cache /
 *     system), return it without touching the network.
 *   - Otherwise download the latest Chrome stable into the cache dir.
 *
 * Args:
 *   onProgress — invoked with bytes (downloaded, total). Caller renders
 *     the progress bar; we don't lock that to ora/cli-progress here so
 *     the lib stays UI-free and unit-testable.
 */
export async function ensureChromium(
  onProgress?: (downloadedBytes: number, totalBytes: number) => void,
): Promise<InstallResult> {
  const existing = await findChromiumExecutable();
  if (existing) {
    return { executablePath: existing, buildId: 'system-or-cached', downloaded: false };
  }

  const platform = detectBrowserPlatform();
  if (!platform) {
    throw new Error(
      'Could not detect platform — @puppeteer/browsers does not support this OS/arch combination. ' +
      'Set SOLID_CHROMIUM_PATH to point at an existing Chromium binary.',
    );
  }

  const cacheDir = browserCacheDir();
  fs.mkdirSync(cacheDir, { recursive: true });

  // Resolve the latest Chrome stable build ID for this platform.
  const buildId = await resolveBuildId(Browser.CHROME, platform, 'stable');

  await install({
    browser: Browser.CHROME,
    buildId,
    cacheDir,
    // @puppeteer/browsers 3.x removed makeProgressCallback. When the caller
    // supplies no reporter we simply omit the option — the download still
    // runs, just silently, which is what a non-interactive agent wants.
    ...(onProgress
      ? {
          downloadProgressCallback: (downloaded: number, total: number) =>
            onProgress(downloaded, total),
        }
      : {}),
  });

  const executablePath = computeExecutablePath({
    browser: Browser.CHROME,
    buildId,
    cacheDir,
  });

  if (!fs.existsSync(executablePath)) {
    throw new Error(
      `@puppeteer/browsers reported success but the executable is missing at ${executablePath}. ` +
      'Try removing ~/.solid/chromium/ and rerunning.',
    );
  }

  return { executablePath, buildId, downloaded: true };
}


/** Best-effort uninstall — used by `solid render --install --force`
 *  to nuke a corrupted cache. Pure rm-rf of the cache dir; system
 *  Chrome and any SOLID_CHROMIUM_PATH override are untouched. */
export function uninstallCachedBrowsers(): void {
  const cacheDir = browserCacheDir();
  if (fs.existsSync(cacheDir)) {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
}
