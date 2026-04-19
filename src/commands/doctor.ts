/**
 * solid doctor — read-only smoke battery against the authenticated company.
 *
 * Runs a battery of harmless GETs to catch broken endpoints, rotten tokens,
 * or backend drift before they bite a real workflow. Usable as a CI probe
 * (exit 1 on any failure). Everything is scoped by the authenticated
 * company_id — no other tenant is touched.
 *
 *   solid doctor                 # pretty table
 *   solid doctor --json          # machine-readable
 *   solid doctor --endpoints     # include an optional extended battery
 *
 * Exit codes (hard contract — do not change without bumping docs):
 *   0   all probes passed
 *   1   at least one probe failed
 *   2   not authenticated (cannot run probes)
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { apiClient, handleApiError } from '../lib/api-client';
import { config } from '../lib/config';
import { isJsonOutput } from '../lib/json-output';
import { appendExamples } from '../lib/command-kit';

interface ProbeResult {
  name: string;
  path: string;
  ok: boolean;
  status: number;
  ms: number;
  detail?: string;
}

export interface Probe {
  name: string;
  path: string;
  params?: Record<string, unknown>;
  // Some endpoints gate on tier. We don't want a 403 to fail the whole
  // battery; mark `tolerate403=true` and it reports as SKIP instead.
  tolerate403?: boolean;
  // Some endpoints 404 when the tenant isn't provisioned (e.g. no
  // subdomain yet). Treat as SKIP when marked.
  tolerate404?: boolean;
}

// Paths verified by greppping what the rest of the CLI actually hits.
// These are the real backend routes, not stubs — if the backend renames
// one of them the doctor will legitimately fail and tell us.
const CORE_BATTERY: Probe[] = [
  { name: 'auth',         path: '/api/v1/auth/me' },
  { name: 'kb',           path: '/api/v1/kb/company', params: { limit: 1 } },
  { name: 'pages',        path: '/api/v1/cms/pages' },
  { name: 'sites',        path: '/api/v1/sites', params: { limit: 1 } },
  { name: 'services',     path: '/api/v1/services/catalog', params: { limit: 1 } },
  { name: 'orders',       path: '/api/v1/orders/', params: { limit: 1 } },
  { name: 'crm contacts', path: '/api/v1/crm/contacts', params: { limit: 1 } },
  { name: 'leads',        path: '/api/v1/crm/leads/stats' },
  { name: 'billing',      path: '/api/v1/billing/overview' },
];

const EXTENDED_BATTERY: Probe[] = [
  { name: 'voice calls',   path: '/api/v1/voice/calls', params: { limit: 1 }, tolerate403: true },
  { name: 'inbox',         path: '/api/v1/communications/inbox', params: { limit: 1 }, tolerate403: true },
  { name: 'schedule',      path: '/api/v1/schedule', params: { limit: 1 }, tolerate403: true },
  { name: 'inventory',     path: '/api/v1/Inventory/list', params: { limit: 1 }, tolerate403: true },
  { name: 'blog',          path: '/api/v1/cms/blog/posts', params: { limit: 1 }, tolerate403: true },
  { name: 'products',      path: '/api/v1/products', params: { limit: 1 }, tolerate403: true },
  { name: 'mcp traffic',   path: '/api/v1/analytics/mcp/traffic', tolerate403: true },
  { name: 'domains (sub)', path: '/api/v1/domains/subdomain', tolerate403: true, tolerate404: true },
  { name: 'payment links', path: '/api/v1/payment-links/', params: { limit: 1 }, tolerate403: true },
  { name: 'subscriptions', path: '/api/v1/subscriptions', params: { limit: 1 }, tolerate403: true, tolerate404: true },
];

// Exported so tests can exercise the probe logic without touching commander.
export async function runProbe(probe: Probe): Promise<ProbeResult> {
  const t0 = Date.now();
  try {
    const res = await apiClient.get(probe.path, probe.params ? { params: probe.params } : undefined);
    return {
      name: probe.name,
      path: probe.path,
      ok: true,
      status: res.status,
      ms: Date.now() - t0,
    };
  } catch (e) {
    const err = handleApiError(e);
    const ms = Date.now() - t0;
    // Tier-gated endpoints return 403; that's expected, not a failure.
    if (probe.tolerate403 && err.status === 403) {
      return { name: probe.name, path: probe.path, ok: true, status: 403, ms, detail: 'tier-skipped' };
    }
    // Tenant-specific 404s (e.g. no subdomain provisioned yet).
    if (probe.tolerate404 && err.status === 404) {
      return { name: probe.name, path: probe.path, ok: true, status: 404, ms, detail: 'tenant-skipped' };
    }
    return { name: probe.name, path: probe.path, ok: false, status: err.status, ms, detail: err.message };
  }
}

function renderTable(results: ProbeResult[]): void {
  const maxName = Math.max(...results.map((r) => r.name.length));
  console.log('');
  console.log(chalk.bold('  Solid# CLI Doctor'));
  console.log(chalk.dim('  ' + '─'.repeat(maxName + 40)));
  for (const r of results) {
    const dot =
      r.detail === 'tier-skipped' || r.detail === 'tenant-skipped'
        ? chalk.dim('○')
        : r.ok
          ? chalk.green('●')
          : chalk.red('●');
    const status =
      r.detail === 'tier-skipped' || r.detail === 'tenant-skipped'
        ? chalk.dim('SKIP')
        : r.ok ? chalk.green('PASS') : chalk.red('FAIL');
    const ms = chalk.dim(`${r.ms}ms`.padStart(6));
    const code = chalk.dim(String(r.status).padStart(3));
    const name = r.name.padEnd(maxName);
    console.log(`  ${dot} ${status}  ${name}  ${code}  ${ms}  ${chalk.dim(r.path)}`);
    if (!r.ok && r.detail) {
      console.log(chalk.red(`      → ${r.detail}`));
    }
  }
  console.log('');
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  const skipped = results.filter((r) => r.detail === 'tier-skipped' || r.detail === 'tenant-skipped').length;
  const totalMs = results.reduce((a, r) => a + r.ms, 0);
  const line = [
    failed === 0 ? chalk.green(`  ✓ ${passed} passed`) : chalk.red(`  ✗ ${failed} failed`),
    skipped > 0 ? chalk.dim(`${skipped} skipped`) : '',
    chalk.dim(`${totalMs}ms total`),
  ].filter(Boolean).join('  ');
  console.log(line);
  console.log('');
}

export const doctorCommand = new Command('doctor')
  .description('Smoke-test the backend against the authenticated company (safe, read-only)')
  .option('--json', 'Emit JSON result object to stdout')
  .option('--endpoints', 'Include extended endpoint battery (feature-gated tolerated)')
  .option('--core-only', 'Run only the core battery (default)')
  .action(async (opts: { json?: boolean; endpoints?: boolean; coreOnly?: boolean }) => {
    if (!config.isLoggedIn()) {
      if (isJsonOutput(opts)) {
        console.log(JSON.stringify({ ok: false, error: 'not_authenticated' }, null, 2));
      } else {
        console.error(chalk.red('Not authenticated. Run: solid auth login'));
      }
      process.exit(2);
    }

    const battery = opts.endpoints ? [...CORE_BATTERY, ...EXTENDED_BATTERY] : CORE_BATTERY;
    // Run probes with bounded concurrency so one slow endpoint doesn't
    // serialize the whole battery, but we don't thundering-herd the backend.
    const concurrency = 4;
    const results: ProbeResult[] = new Array(battery.length);
    let cursor = 0;
    // Progress bar on TTY only; JSON output suppresses it (would corrupt stdout).
    const { progressBar } = await import('../lib/tui');
    const bar = !isJsonOutput(opts)
      ? await progressBar(battery.length, { label: 'Probing' })
      : { update: () => undefined, increment: () => undefined, stop: () => undefined };
    let done = 0;
    async function worker() {
      while (true) {
        const i = cursor++;
        if (i >= battery.length) return;
        results[i] = await runProbe(battery[i]);
        done++;
        bar.update(done);
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));
    bar.stop();

    const failed = results.filter((r) => !r.ok).length;

    if (isJsonOutput(opts)) {
      console.log(
        JSON.stringify(
          {
            ok: failed === 0,
            passed: results.filter((r) => r.ok).length,
            failed,
            skipped: results.filter((r) => r.detail === 'tier-skipped' || r.detail === 'tenant-skipped').length,
            total_ms: results.reduce((a, r) => a + r.ms, 0),
            results,
          },
          null,
          2,
        ),
      );
    } else {
      renderTable(results);
    }

    process.exit(failed === 0 ? 0 : 1);
  });

appendExamples(doctorCommand, [
  { cmd: 'solid doctor',             why: 'Core battery — 10 probes, ~1-2s' },
  { cmd: 'solid doctor --endpoints', why: 'Full battery — includes tier-gated endpoints' },
  { cmd: 'solid doctor --json',      why: 'Machine-readable (CI pipelines)' },
]);
