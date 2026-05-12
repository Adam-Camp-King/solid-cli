/**
 * `solid tenant ...` — Tenant Activity Gate introspection.
 *
 *   solid tenant level                       → your own company's gate level (JSON-ready)
 *   solid tenant active --min warm           → admin: every tenant at or above level
 *   solid tenant allowlist                   → admin: who bypasses the gate
 *   solid tenant gate-debug <company_id>     → admin: full decision breakdown
 *
 * Designed for AI agents: every verb supports `--json` and emits
 * stable, machine-readable shapes.
 *
 * See Owners-Manual/06-Operations/TENANT-ACTIVITY-GATE/ for the spec.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { config } from '../lib/config';
import { apiClient, handleApiError, type TenantGateDecision } from '../lib/api-client';
import { isJsonOutput } from '../lib/json-output';

export const tenantCommand = new Command('tenant')
  .description('Tenant Activity Gate — compute-budget introspection for sweeps');

// ── solid tenant level ──────────────────────────────────────────────────
// Tenant-self. Any logged-in caller sees their OWN company's gate state.
tenantCommand
  .command('level')
  .description("Show this tenant's current activity level (HOT/WARM/COLD/DORMANT/BLOCKED)")
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }
    const spinner = isJsonOutput(options) ? null : ora('Checking gate…').start();
    try {
      const { data } = await apiClient.tenantGateMine();
      if (spinner) spinner.stop();
      if (isJsonOutput(options)) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      printDecision(data);
    } catch (e) {
      if (spinner) spinner.stop();
      handleApiError(e);
    }
  });

// ── solid tenant gate-debug <id> ────────────────────────────────────────
// Admin only. Cross-tenant decision lookup with full signal breakdown.
tenantCommand
  .command('gate-debug <company_id>')
  .description('Full gate decision for any company (super-admin only)')
  .option('--json', 'Output as JSON')
  .action(async (companyIdStr: string, options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }
    const companyId = parseInt(companyIdStr, 10);
    if (!Number.isFinite(companyId) || companyId < 1) {
      console.error(chalk.red(`Invalid company_id: ${companyIdStr}`));
      process.exit(1);
    }
    const spinner = isJsonOutput(options) ? null : ora(`Inspecting company ${companyId}…`).start();
    try {
      const { data } = await apiClient.tenantGateAdminDebug(companyId);
      if (spinner) spinner.stop();
      if (isJsonOutput(options)) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      printDecision(data);
    } catch (e) {
      if (spinner) spinner.stop();
      handleApiError(e);
    }
  });

// ── solid tenant active --min warm ──────────────────────────────────────
// Admin only. Returns the set of company_ids that would pass the gate
// at the given threshold — exactly what a Celery fan-out would enqueue.
tenantCommand
  .command('active')
  .description('List company_ids at or above an activity level (super-admin only)')
  .option('--min <level>', 'Minimum level: hot, warm, cold, dormant (default: warm)', 'warm')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }
    const spinner = isJsonOutput(options) ? null : ora(`Listing tenants ≥ ${options.min}…`).start();
    try {
      const { data } = await apiClient.tenantGateAdminActive(options.min);
      if (spinner) spinner.stop();
      if (isJsonOutput(options)) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      console.log('');
      console.log(chalk.bold(`${data.count} companies at level ≥ ${chalk.cyan(data.min_level)}`));
      console.log('');
      for (const cid of data.company_ids) {
        console.log(`  ${cid}`);
      }
      console.log('');
    } catch (e) {
      if (spinner) spinner.stop();
      handleApiError(e);
    }
  });

// ── solid tenant allowlist ──────────────────────────────────────────────
// Admin only. The owner allowlist — hardcoded IDs + billing_exempt members.
tenantCommand
  .command('allowlist')
  .description('Show the owner allowlist (hardcoded + billing_exempt). Super-admin only.')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }
    const spinner = isJsonOutput(options) ? null : ora('Fetching allowlist…').start();
    try {
      const { data } = await apiClient.tenantGateAdminAllowlist();
      if (spinner) spinner.stop();
      if (isJsonOutput(options)) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      console.log('');
      console.log(chalk.bold('Owner Allowlist'));
      console.log(chalk.dim('  Always passes the gate regardless of activity.'));
      console.log('');
      console.log(chalk.cyan('  Hardcoded IDs:'));
      for (const id of data.hardcoded_ids) {
        console.log(`    ${id}`);
      }
      console.log('');
      console.log(chalk.cyan('  billing_exempt = true:'));
      if (data.billing_exempt.length === 0) {
        console.log(chalk.dim('    (none)'));
      } else {
        for (const c of data.billing_exempt) {
          console.log(`    ${c.id}  ${c.name}`);
        }
      }
      console.log('');
    } catch (e) {
      if (spinner) spinner.stop();
      handleApiError(e);
    }
  });

// ── helpers ─────────────────────────────────────────────────────────────

function printDecision(d: TenantGateDecision): void {
  const colorFor = {
    HOT: chalk.green.bold,
    WARM: chalk.yellow.bold,
    COLD: chalk.cyan.bold,
    DORMANT: chalk.gray.bold,
    BLOCKED: chalk.red.bold,
  }[d.level];

  console.log('');
  console.log(`  ${chalk.bold('Company')}      ${d.company_id}`);
  console.log(`  ${chalk.bold('Level')}        ${colorFor(d.level)}  ${chalk.dim(`(value ${d.level_value})`)}`);
  console.log(`  ${chalk.bold('Reason')}       ${chalk.dim(d.reason)}`);
  if (d.bypass_reasons.length > 0) {
    console.log(`  ${chalk.bold('Bypass')}       ${chalk.dim(d.bypass_reasons.join(', '))}`);
  }
  console.log('');
  console.log(chalk.bold('  Signals'));
  console.log(`    billing_exempt              ${d.signals.billing_exempt}`);
  console.log(`    in_hardcoded_set            ${d.signals.in_hardcoded_set}`);
  console.log(`    is_deleted / suspended / archived   ${d.signals.is_deleted} / ${d.signals.is_suspended} / ${d.signals.is_archived}`);
  console.log(`    onboarding_status           ${d.signals.onboarding_status ?? '(null)'}`);
  console.log(`    subscription_status         ${d.signals.subscription_status ?? '(null)'}`);
  console.log(`    last_login_at               ${d.signals.last_login_at ?? '(never)'}`);
  console.log(`    last_token_usage_at         ${d.signals.last_token_usage_at ?? '(never)'}`);
  console.log(`    effective_last_activity_at  ${d.signals.effective_last_activity_at ?? '(never)'}`);
  console.log('');
  console.log(chalk.dim(`  Evaluated at ${d.evaluated_at}`));
  console.log('');
}
