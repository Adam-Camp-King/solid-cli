/**
 * Version-skew handshake.
 *
 * Every CLI request sends `X-Solid-CLI-Version: <pkg.version>` so the backend
 * can log or compare. The server is free to respond with either:
 *
 *   X-Solid-Min-CLI-Version: 1.9.0     → hard minimum; we warn loudly if we're below
 *   X-Solid-Latest-CLI-Version: 1.9.19 → latest published; gentle nudge if we're minor-behind
 *   X-Solid-Deprecated-CLI: true       → explicit "please upgrade"
 *
 * No backend coordination is required — this plumbs the client side. Once the
 * server opts in, warnings start appearing with no CLI change needed.
 *
 * Warnings are printed to stderr exactly once per process invocation and are
 * suppressed by --json, --raw, --no-color=0 (no effect), or
 * `SOLID_SKEW_SILENT=1`.
 */

import chalk from 'chalk';

let warned = false;

function parseSemver(v: string): [number, number, number] | null {
  const m = v.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function cmp(a: [number, number, number], b: [number, number, number]): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] - b[2];
}

function shouldSuppress(): boolean {
  if (process.env.SOLID_SKEW_SILENT === '1') return true;
  // JSON pipelines must stay clean on stderr-free consumers. We still print
  // to stderr (not stdout), so JSON on stdout is safe. But if the user asked
  // for --raw we honor that intent and stay silent.
  if (process.argv.includes('--raw')) return true;
  return false;
}

export function checkSkewFromHeaders(
  cliVersion: string,
  headers: Record<string, unknown> | undefined,
): void {
  if (warned || !headers || shouldSuppress()) return;
  const h = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v ?? '')]),
  );

  const minV = h['x-solid-min-cli-version'];
  const latestV = h['x-solid-latest-cli-version'];
  const deprecated = h['x-solid-deprecated-cli'];

  const cur = parseSemver(cliVersion);
  if (!cur) return;

  // Hard floor: refuse silently? No — warn loudly but keep working. A
  // hard-block would strand users mid-session; the server can enforce with
  // a 4xx if it really wants to reject.
  if (minV) {
    const min = parseSemver(minV);
    if (min && cmp(cur, min) < 0) {
      warned = true;
      process.stderr.write(
        chalk.red(`\n! Solid CLI ${cliVersion} is below the supported minimum (${minV}).\n`) +
          chalk.dim(`  Upgrade: npm i -g @solidnumber/cli@latest\n\n`),
      );
      return;
    }
  }

  if (deprecated && deprecated !== 'false' && deprecated !== '0') {
    warned = true;
    process.stderr.write(
      chalk.yellow(`\n! Solid CLI ${cliVersion} is deprecated.\n`) +
        chalk.dim(`  Upgrade: npm i -g @solidnumber/cli@latest\n\n`),
    );
    return;
  }

  if (latestV) {
    const latest = parseSemver(latestV);
    // Only nudge when we're MINOR or MAJOR behind. Patch skew is noise.
    if (latest && (latest[0] > cur[0] || latest[1] > cur[1])) {
      warned = true;
      process.stderr.write(
        chalk.dim(`\n  A newer Solid CLI is available: ${cliVersion} → ${latestV}\n`) +
          chalk.dim(`  Upgrade: npm i -g @solidnumber/cli@latest\n\n`),
      );
    }
  }
}

// Test-only: reset the once-per-process guard.
export function _resetSkewWarnedForTest(): void {
  warned = false;
}
