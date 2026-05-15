/**
 * `solid ucp ...` — manage the Universal Commerce Protocol (UCP) surface
 * from terminal. Closes the parallel CLI gap that SPRINT-WEBMCP-MATCH-
 * PATTERN Phase 8 surfaced: the CLI had zero UCP commands despite the
 * backend shipping the protocol months earlier.
 *
 *   solid ucp manifest                        → tenant's signed UCP profile
 *   solid ucp capabilities                    → list exposed UCP capabilities
 *   solid ucp consent list                    → list active UCP consent grants
 *   solid ucp consent grant <cap> --scope X   → grant consent for a capability
 *   solid ucp consent revoke <id>             → revoke a grant
 *
 * UCP is intentionally symmetric with `solid webmcp` so an operator
 * uses the same mental model for both protocols.
 *
 * Reference: Owners-Manual/72-UCP-Integration/ + 73-WebMCP-Integration/CLI-SURFACE.md.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { isJsonOutput } from '../lib/json-output';


// ── Helpers ────────────────────────────────────────────────────────────────

const UCP_SCOPES = ['once', 'session', 'permanent'] as const;

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
      handleApiError(e);
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
      const { data } = await apiClient.get(`/co/${companyId}/ucp/capabilities`);
      if (spinner) spinner.stop();
      if (wantJson) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      console.log('');
      console.log(chalk.bold(`UCP capabilities — company ${chalk.cyan(String(companyId))}`));
      console.log(JSON.stringify(data, null, 2));
      console.log('');
    } catch (e) {
      if (spinner) spinner.stop();
      handleApiError(e);
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
      handleApiError(e);
    }
  });

ucpConsentCommand
  .command('grant <capability>')
  .description('Grant consent for a UCP capability (owner-only)')
  .requiredOption('--scope <scope>', `One of: ${UCP_SCOPES.join(', ')}`)
  .option('--json', 'Output as JSON')
  .action(async (capability: string, options) => {
    requireLogin();
    if (!(UCP_SCOPES as readonly string[]).includes(options.scope)) {
      console.error(chalk.red(`Unknown --scope: ${options.scope}. Expected: ${UCP_SCOPES.join(', ')}`));
      process.exit(2);
    }
    const wantJson = isJsonOutput(options);
    const spinner = wantJson ? null : ora('Granting UCP consent…').start();
    try {
      const { data } = await apiClient.post('/api/v1/ucp/consent/grant', {
        capability,
        scope: options.scope,
      });
      if (spinner) spinner.stop();
      if (wantJson) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      console.log('');
      console.log(chalk.green(`✓ Granted ${chalk.cyan(capability)} (${options.scope})`));
      console.log(chalk.dim(JSON.stringify(data, null, 2)));
      console.log('');
    } catch (e) {
      if (spinner) spinner.stop();
      handleApiError(e);
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
      await apiClient.delete(`/api/v1/ucp/consent/grant/${encodeURIComponent(grantId)}`);
      if (spinner) spinner.stop();
      if (wantJson) {
        console.log(JSON.stringify({ revoked: grantId }, null, 2));
        return;
      }
      console.log('');
      console.log(chalk.green(`✓ Revoked ${grantId}`));
      console.log('');
    } catch (e) {
      if (spinner) spinner.stop();
      handleApiError(e);
    }
  });
