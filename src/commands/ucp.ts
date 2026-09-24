/**
 * `solid ucp ...` — manage the Universal Commerce Protocol (UCP) surface
 * from terminal. Closes the parallel CLI gap that SPRINT-WEBMCP-MATCH-
 * PATTERN Phase 8 surfaced: the CLI had zero UCP commands despite the
 * backend shipping the protocol months earlier.
 *
 *   solid ucp manifest                        → tenant's signed UCP profile
 *   solid ucp capabilities                    → list exposed UCP capabilities
 *   solid ucp consent list                    → list active UCP consent grants
 *   solid ucp consent grant <cap>             → grant consent for one capability
 *   solid ucp consent revoke <id>             → revoke a grant
 *
 * UCP is intentionally symmetric with `solid webmcp` so an operator
 * uses the same mental model for both protocols.
 *
 * Reference: Owners-Manual/72-UCP-Integration/ + 73-WebMCP-Integration/CLI-SURFACE.md.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from '../lib/spinner';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { isJsonOutput, printJson } from '../lib/json-output';


// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Path for a capability id. Ids contain slashes (`core/availability`) and the
 * backend route is `{capability_id:path}`, so encode each segment, not the
 * whole id.
 */
export function capabilityPath(id: string): string {
  return id.split('/').map(encodeURIComponent).join('/');
}

/** capabilities[] from a business profile, wherever the envelope carries it. */
export function capabilitiesOf(profile: unknown): Array<Record<string, unknown>> {
  const p = (profile && typeof profile === 'object' ? profile : {}) as Record<string, any>;
  const caps = p.ucp?.capabilities ?? p.capabilities;
  return Array.isArray(caps) ? caps : [];
}

function statusOf(e: unknown): number | undefined {
  return (e as { response?: { status?: number } })?.response?.status;
}

function detailOf(e: unknown): any {
  return (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
}

function requireLogin(): void {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
}

function getCompanyId(): number | null {
  // ConfigManager exposes companyId as a typed getter; default-safe fallback.
  const cfg = config as unknown as { companyId?: number };
  const cid = typeof cfg.companyId === 'number' ? cfg.companyId : 0;
  return Number.isFinite(cid) && cid > 0 ? cid : null;
}


// ── Root command ───────────────────────────────────────────────────────────

export const ucpCommand = new Command('ucp')
  .description('Universal Commerce Protocol — manifest, capabilities, and consent for buyer-agents');


// ── solid ucp manifest ─────────────────────────────────────────────────────

ucpCommand
  .command('manifest')
  .description('Dump the tenant\'s signed UCP profile from /co/{id}/.well-known/ucp')
  .option('--company <id>', 'Override company_id (default: current session\'s tenant)', (v) => parseInt(v, 10))
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireLogin();
    const companyId = options.company ?? getCompanyId();
    if (!companyId) {
      console.error(chalk.red('No company_id resolved. Use --company <id> or `solid auth login`.'));
      process.exit(2);
    }
    const wantJson = isJsonOutput(options);
    const spinner = wantJson ? null : ora('Fetching UCP manifest…').start();
    try {
      const { data } = await apiClient.get(`/co/${companyId}/.well-known/ucp`);
      if (spinner) spinner.stop();
      if (wantJson) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      console.log('');
      console.log(chalk.bold(`UCP profile — company ${chalk.cyan(String(companyId))}`));
      console.log(JSON.stringify(data, null, 2));
      console.log('');
    } catch (e) {
      if (spinner) spinner.stop();
      { const apiErr = handleApiError(e); console.error(chalk.red(apiErr.message)); process.exit(1); }
    }
  });


// ── solid ucp capabilities ─────────────────────────────────────────────────

ucpCommand
  .command('capabilities')
  .description('List capabilities exposed by the current tenant (signed envelope from backend)')
  .option('--company <id>', 'Override company_id', (v) => parseInt(v, 10))
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireLogin();
    const companyId = options.company ?? getCompanyId();
    if (!companyId) {
      console.error(chalk.red('No company_id resolved. Use --company <id> or `solid auth login`.'));
      process.exit(2);
    }
    const wantJson = isJsonOutput(options);
    const spinner = wantJson ? null : ora('Fetching UCP capabilities…').start();
    try {
      // ⛔ There is no GET /co/{id}/ucp/capabilities (it 404'd). The tenant's
      // capabilities[] is published in its signed business profile.
      const { data } = await apiClient.get(`/co/${companyId}/.well-known/ucp`);
      if (spinner) spinner.stop();
      const caps = capabilitiesOf(data);
      if (wantJson) {
        console.log(JSON.stringify({ company_id: companyId, capabilities: caps }, null, 2));
        return;
      }
      console.log('');
      console.log(chalk.bold(`UCP capabilities — company ${chalk.cyan(String(companyId))}`));
      if (!caps.length) {
        console.log(chalk.dim('  UCP is enabled, but no capabilities are granted yet. Grant one: solid ucp consent grant <capability>'));
      }
      for (const c of caps) {
        const ep = Array.isArray(c.endpoint) ? chalk.dim(`  ${(c.endpoint as string[]).join(' · ')}`) : '';
        console.log(`  ${chalk.cyan(String(c.id))}  ${chalk.dim(String(c.role ?? ''))}${ep}`);
      }
      console.log('');
    } catch (e) {
      if (spinner) spinner.stop();
      if (statusOf(e) === 404) {
        const msg = `UCP is not enabled for company ${companyId}. The business owner turns it on (rung 1 of the consent ladder) — see: solid ucp consent list`;
        if (wantJson) printJson({ error: { code: 'UCP_NOT_ENABLED', status: 404, message: msg, fix: 'solid ucp consent list' } });
        else console.error(chalk.yellow(msg));
        process.exit(1);
      }
      { const apiErr = handleApiError(e); console.error(chalk.red(apiErr.message)); process.exit(1); }
    }
  });


// ── solid ucp consent ──────────────────────────────────────────────────────

const ucpConsentCommand = ucpCommand
  .command('consent')
  .description('Manage UCP consent grants (the 4-rung ladder for buyer-agent commerce)');

ucpConsentCommand
  .command('list')
  .description('List active UCP consent grants for the current tenant')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireLogin();
    const wantJson = isJsonOutput(options);
    const spinner = wantJson ? null : ora('Fetching UCP consent ladder…').start();
    try {
      const { data } = await apiClient.get('/api/v1/ucp/consent/ladder');
      if (spinner) spinner.stop();
      if (wantJson) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      console.log('');
      console.log(chalk.bold('UCP consent ladder'));
      console.log(JSON.stringify(data, null, 2));
      console.log('');
    } catch (e) {
      if (spinner) spinner.stop();
      { const apiErr = handleApiError(e); console.error(chalk.red(apiErr.message)); process.exit(1); }
    }
  });

ucpConsentCommand
  .command('grant <capability>')
  .description('Grant consent for one UCP capability (owner-only). UCP must be on for the business and the capability\'s role enabled first.')
  .option('--scope <scope>', 'DEPRECATED — ignored. The capability grant has no scope; the backend picks the role.')
  .option('--json', 'Output as JSON')
  .action(async (capability: string, options) => {
    requireLogin();
    if (options.scope !== undefined) {
      process.stderr.write(chalk.yellow('  ⚠ --scope is deprecated and ignored: a capability grant takes no scope.\n'));
    }
    const wantJson = isJsonOutput(options);
    const spinner = wantJson ? null : ora('Granting UCP consent…').start();
    try {
      // ⛔ Was POST /api/v1/ucp/consent/grant with {capability, scope}. That
      // route's body is {scope_type, role, capability_id, ...}, so every call
      // 422'd. This is the one-capability route the dashboard uses.
      const { data } = await apiClient.post(`/api/v1/ucp/consent/capability/${capabilityPath(capability)}`, {});
      if (spinner) spinner.stop();
      if (wantJson) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      console.log('');
      console.log(chalk.green(`✓ Granted ${chalk.cyan(capability)}`));
      console.log(chalk.dim(JSON.stringify(data, null, 2)));
      console.log('');
    } catch (e) {
      if (spinner) spinner.stop();
      const d = detailOf(e);
      if (statusOf(e) === 409 && d && d.error === 'ladder_prerequisite') {
        const msg = String(d.message || 'A consent-ladder prerequisite is off.');
        if (wantJson) printJson({ error: { code: 'LADDER_PREREQUISITE', status: 409, message: msg, needs: d.needs, role: d.role, fix: 'solid ucp consent list' } });
        else console.error(chalk.yellow(`  ${msg}  (ladder: solid ucp consent list)`));
        process.exit(1);
      }
      if (statusOf(e) === 404 && d && d.error === 'unknown_capability') {
        const msg = `Unknown UCP capability: ${capability}`;
        if (wantJson) printJson({ error: { code: 'NOT_FOUND', status: 404, message: msg } });
        else console.error(chalk.red(msg));
        process.exit(1);
      }
      { const apiErr = handleApiError(e); console.error(chalk.red(apiErr.message)); process.exit(1); }
    }
  });

ucpConsentCommand
  .command('revoke <grant_id>')
  .description('Revoke a UCP consent grant by its id (owner-only)')
  .option('--json', 'Output as JSON')
  .action(async (grantId: string, options) => {
    requireLogin();
    const wantJson = isJsonOutput(options);
    const spinner = wantJson ? null : ora('Revoking…').start();
    try {
      // Empty JSON body: older backends 422'd a DELETE with no body.
      await apiClient.delete(`/api/v1/ucp/consent/grant/${encodeURIComponent(grantId)}`, { data: {} });
      if (spinner) spinner.stop();
      if (wantJson) {
        printJson({ revoked: grantId });
        return;
      }
      console.log('');
      console.log(chalk.green(`✓ Revoked ${grantId}`));
      console.log('');
    } catch (e) {
      if (spinner) spinner.stop();
      { const apiErr = handleApiError(e); console.error(chalk.red(apiErr.message)); process.exit(1); }
    }
  });
