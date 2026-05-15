/**
 * `solid webmcp ...` — manage the in-browser MCP transport from terminal.
 *
 *   solid webmcp manifest [--surface dashboard|portal|developer|tenant-site]
 *   solid webmcp test <tool_name> [--input @file.json] [--confirm]
 *   solid webmcp invocations [--limit N] [--tool <name>] [--status success|error|denied]
 *   solid webmcp consent list
 *   solid webmcp consent grant <tool_name> --scope once|session|permanent
 *   solid webmcp consent revoke <decision_id>
 *
 * Every subcommand is tenant-scoped via the cached session in
 * ~/.solid/config.json. Refuses to run without `solid auth login` or a
 * supplied `--token`/`SOLID_API_KEY`.
 *
 * SPRINT-WEBMCP-MATCH-PATTERN Phase 8 — closes the gap that the CLI had
 * zero WebMCP surface despite shipping the backend in Phase 1.
 *
 * Reference: Owners-Manual/73-WebMCP-Integration/CLI-SURFACE.md.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { isJsonOutput } from '../lib/json-output';


// ── Types matching the backend envelopes ───────────────────────────────────

interface ManifestEntry {
  name: string;
  iri: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown> | null;
  annotations: { readOnly?: boolean; destructive?: boolean; idempotent?: boolean };
  endpoint: { method: string; path: string };
  requiresConsent: boolean;
  surfaces: string[];
  tierFloor: string;
}

interface ManifestResponse {
  company_id: number;
  surface: string;
  tier: string;
  tools: ManifestEntry[];
  count: number;
}

interface InvocationRow {
  id: string;
  tool_name: string;
  surface: string;
  status: 'success' | 'error' | 'denied';
  latency_ms: number;
  error_code: string | null;
  invoked_at: string | null;
}

interface InvocationsResponse {
  items: InvocationRow[];
  count: number;
}

interface ConsentRow {
  id: string;
  tool_name: string;
  scope: 'once' | 'session' | 'permanent';
  granted_at: string | null;
  expires_at: string | null;
}

interface ConsentListResponse {
  items: ConsentRow[];
  count: number;
}


// ── Helpers ────────────────────────────────────────────────────────────────

const VALID_SURFACES = ['dashboard', 'portal', 'developer', 'tenant-site'] as const;
type Surface = (typeof VALID_SURFACES)[number];

const VALID_SCOPES = ['once', 'session', 'permanent'] as const;
type Scope = (typeof VALID_SCOPES)[number];

function requireLogin(): void {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
}

function readInput(value?: string): Record<string, unknown> {
  if (!value) return {};
  if (value.startsWith('@')) {
    const filePath = path.resolve(process.cwd(), value.slice(1));
    if (!fs.existsSync(filePath)) {
      console.error(chalk.red(`Input file not found: ${filePath}`));
      process.exit(2);
    }
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
    } catch (e) {
      console.error(chalk.red(`Failed to parse JSON in ${filePath}: ${(e as Error).message}`));
      process.exit(2);
    }
  }
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch (e) {
    console.error(chalk.red(`Invalid --input JSON: ${(e as Error).message}`));
    process.exit(2);
  }
}


// ── Root command ───────────────────────────────────────────────────────────

export const webmcpCommand = new Command('webmcp')
  .description('Manage the in-browser MCP transport — manifest, dispatch test, invocations, consent');


// ── solid webmcp manifest ──────────────────────────────────────────────────

webmcpCommand
  .command('manifest')
  .description('Dump the tenant\'s WebMCP tool catalog filtered by surface')
  .option('--surface <surface>', `One of: ${VALID_SURFACES.join(', ')}`, 'dashboard')
  .option('--json', 'Output as JSON')
  .option('--format <format>', 'Output format: json | table (default json for piping)', 'json')
  .action(async (options) => {
    requireLogin();
    if (!VALID_SURFACES.includes(options.surface)) {
      console.error(chalk.red(`Unknown surface: ${options.surface}. Expected: ${VALID_SURFACES.join(', ')}`));
      process.exit(2);
    }
    const wantJson = isJsonOutput(options) || options.format === 'json';
    const spinner = wantJson ? null : ora('Fetching manifest…').start();
    try {
      const { data } = await apiClient.get<ManifestResponse>(
        `/api/v1/webmcp/manifest?surface=${encodeURIComponent(options.surface)}`,
      );
      if (spinner) spinner.stop();
      if (wantJson) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      console.log('');
      console.log(chalk.bold(`WebMCP manifest — surface: ${chalk.cyan(data.surface)}, tier: ${chalk.cyan(data.tier)}`));
      console.log(chalk.dim(`  company_id ${data.company_id} · ${data.count} tool${data.count === 1 ? '' : 's'}`));
      console.log('');
      for (const tool of data.tools) {
        const consent = tool.requiresConsent ? chalk.yellow(' [consent]') : '';
        const tier = chalk.dim(`(${tool.tierFloor}+)`);
        console.log(`  ${chalk.cyan(tool.name)}${consent} ${tier}`);
        console.log(`    ${chalk.dim(tool.description)}`);
        console.log(`    ${chalk.dim('IRI:')} ${tool.iri}`);
      }
      console.log('');
    } catch (e) {
      if (spinner) spinner.stop();
      handleApiError(e);
    }
  });


// ── solid webmcp test <tool_name> ──────────────────────────────────────────

webmcpCommand
  .command('test <tool_name>')
  .description('Dry-run a tool against the backend. Write tools require --confirm.')
  .option('--input <json|@file>', 'Inline JSON or @path/to/file.json (default: {})')
  .option('--surface <surface>', `Invocation surface: ${VALID_SURFACES.join(', ')}`, 'cli')
  .option('--confirm', 'For write tools, auto-grant `once` consent before invoking')
  .option('--json', 'Output as JSON')
  .action(async (toolName: string, options) => {
    requireLogin();
    const input = readInput(options.input);

    // --confirm: pre-grant once-consent so write tools execute. Atomic
    // workaround for the lack of an interactive modal in terminal.
    if (options.confirm) {
      try {
        await apiClient.post('/api/v1/webmcp/consent', { tool_name: toolName, scope: 'once' });
      } catch (e) {
        handleApiError(e);
      }
    }

    const wantJson = isJsonOutput(options);
    const spinner = wantJson ? null : ora(`Dispatching ${toolName}…`).start();
    try {
      const { data } = await apiClient.post(`/api/v1/webmcp/execute/${encodeURIComponent(toolName)}`, {
        input,
        surface: options.surface,
      });
      if (spinner) spinner.stop();
      if (wantJson) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      console.log('');
      console.log(chalk.green(`✓ ${toolName} succeeded`));
      console.log(chalk.dim(`  latency: ${(data as { latency_ms?: number }).latency_ms ?? '?'}ms`));
      console.log('');
      console.log(JSON.stringify((data as { result?: unknown }).result ?? data, null, 2));
      console.log('');
    } catch (e) {
      if (spinner) spinner.stop();
      // Surface a hint for consent_required so the agent / operator
      // knows the workaround flag.
      const status = (e as { response?: { status?: number } }).response?.status;
      const detail = (e as { response?: { data?: { detail?: { error?: string } } } }).response?.data?.detail;
      if (status === 403 && detail?.error === 'consent_required') {
        console.error(chalk.yellow('Consent required for this tool.'));
        console.error(chalk.dim(`  Either: solid webmcp consent grant ${toolName} --scope session`));
        console.error(chalk.dim(`  Or: re-run with --confirm to auto-grant once.`));
        process.exit(3);
      }
      handleApiError(e);
    }
  });


// ── solid webmcp invocations ───────────────────────────────────────────────

webmcpCommand
  .command('invocations')
  .description('Show recent WebMCP tool invocations for the current tenant')
  .option('--limit <n>', 'Max rows (default 50, hard cap 500)', (v) => parseInt(v, 10), 50)
  .option('--tool <name>', 'Filter to a single tool_name')
  .option('--status <status>', 'Filter by status: success | error | denied')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireLogin();
    if (options.status && !['success', 'error', 'denied'].includes(options.status)) {
      console.error(chalk.red(`Unknown --status: ${options.status}`));
      process.exit(2);
    }
    const limit = Math.min(Math.max(parseInt(String(options.limit), 10) || 50, 1), 500);
    const qs = new URLSearchParams();
    qs.set('limit', String(limit));
    if (options.tool) qs.set('tool', String(options.tool));
    if (options.status) qs.set('status', String(options.status));

    const wantJson = isJsonOutput(options);
    const spinner = wantJson ? null : ora('Fetching invocations…').start();
    try {
      const { data } = await apiClient.get<InvocationsResponse>(
        `/api/v1/webmcp/invocations?${qs.toString()}`,
      );
      if (spinner) spinner.stop();
      if (wantJson) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      console.log('');
      console.log(chalk.bold(`Recent invocations — ${data.count} row${data.count === 1 ? '' : 's'}`));
      console.log(chalk.dim('  TIME                  TOOL                       SURFACE     STATUS    LATENCY'));
      for (const r of data.items) {
        const time = (r.invoked_at ?? '').slice(0, 19).replace('T', ' ');
        const tool = r.tool_name.padEnd(26, ' ').slice(0, 26);
        const surface = (r.surface ?? '').padEnd(11, ' ').slice(0, 11);
        const statusColor =
          r.status === 'success' ? chalk.green : r.status === 'denied' ? chalk.yellow : chalk.red;
        const status = statusColor(r.status.padEnd(9, ' '));
        const latency = `${r.latency_ms}ms`;
        const errSuffix = r.error_code ? chalk.dim(`  (${r.error_code})`) : '';
        console.log(`  ${chalk.dim(time)}  ${chalk.cyan(tool)} ${surface} ${status} ${latency}${errSuffix}`);
      }
      console.log('');
    } catch (e) {
      if (spinner) spinner.stop();
      handleApiError(e);
    }
  });


// ── solid webmcp consent ───────────────────────────────────────────────────

const consentCommand = webmcpCommand
  .command('consent')
  .description('Manage WebMCP consent grants for the current user');

consentCommand
  .command('list')
  .description('List active consent grants for the current user')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireLogin();
    const wantJson = isJsonOutput(options);
    const spinner = wantJson ? null : ora('Fetching consent grants…').start();
    try {
      const { data } = await apiClient.get<ConsentListResponse>('/api/v1/webmcp/consent');
      if (spinner) spinner.stop();
      if (wantJson) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      console.log('');
      if (data.count === 0) {
        console.log(chalk.dim('  No active consent grants.'));
        console.log('');
        return;
      }
      console.log(chalk.bold(`Active grants — ${data.count}`));
      console.log(chalk.dim('  ID                                    TOOL                       SCOPE       GRANTED                 EXPIRES'));
      for (const r of data.items) {
        const id = r.id.slice(0, 8) + '…';
        const tool = r.tool_name.padEnd(26, ' ').slice(0, 26);
        const scope = r.scope.padEnd(10, ' ');
        const granted = (r.granted_at ?? '').slice(0, 19).replace('T', ' ').padEnd(20, ' ');
        const expires = r.expires_at ? r.expires_at.slice(0, 19).replace('T', ' ') : chalk.dim('—');
        console.log(`  ${id.padEnd(38, ' ')} ${chalk.cyan(tool)} ${scope} ${chalk.dim(granted)} ${expires}`);
      }
      console.log('');
    } catch (e) {
      if (spinner) spinner.stop();
      handleApiError(e);
    }
  });

consentCommand
  .command('grant <tool_name>')
  .description('Grant consent for a tool')
  .requiredOption('--scope <scope>', `One of: ${VALID_SCOPES.join(', ')}`)
  .option('--json', 'Output as JSON')
  .action(async (toolName: string, options) => {
    requireLogin();
    if (!VALID_SCOPES.includes(options.scope)) {
      console.error(chalk.red(`Unknown --scope: ${options.scope}. Expected: ${VALID_SCOPES.join(', ')}`));
      process.exit(2);
    }
    const wantJson = isJsonOutput(options);
    const spinner = wantJson ? null : ora('Granting consent…').start();
    try {
      const { data } = await apiClient.post<ConsentRow>('/api/v1/webmcp/consent', {
        tool_name: toolName,
        scope: options.scope as Scope,
      });
      if (spinner) spinner.stop();
      if (wantJson) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      console.log('');
      console.log(chalk.green(`✓ Granted ${chalk.cyan(toolName)} (${options.scope})`));
      console.log(chalk.dim(`  decision id: ${data.id}`));
      if (data.expires_at) console.log(chalk.dim(`  expires:     ${data.expires_at}`));
      console.log('');
    } catch (e) {
      if (spinner) spinner.stop();
      handleApiError(e);
    }
  });

consentCommand
  .command('revoke <decision_id>')
  .description('Revoke an existing consent grant by its decision id')
  .option('--json', 'Output as JSON')
  .action(async (decisionId: string, options) => {
    requireLogin();
    const wantJson = isJsonOutput(options);
    const spinner = wantJson ? null : ora('Revoking…').start();
    try {
      await apiClient.delete(`/api/v1/webmcp/consent/${encodeURIComponent(decisionId)}`);
      if (spinner) spinner.stop();
      if (wantJson) {
        console.log(JSON.stringify({ revoked: decisionId }, null, 2));
        return;
      }
      console.log('');
      console.log(chalk.green(`✓ Revoked ${decisionId}`));
      console.log('');
    } catch (e) {
      if (spinner) spinner.stop();
      handleApiError(e);
    }
  });
