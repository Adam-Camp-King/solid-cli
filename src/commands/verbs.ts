/**
 * solid verbs — Universal agent-attraction verb invoker.
 *
 * Backend ships 169 agent-attraction verbs across 12 shapes (aggregate /
 * explain / preview / suggest / transaction / receipt / revert / subscribe /
 * discovery / trail / reputation / macro / telemetry). Phases 1-5 complete.
 * Most are already callable via dedicated CLI wrappers (solid transaction,
 * solid manifest, solid audit log, etc.). This command is the AI-first
 * universal entry point: every verb is discoverable + invokable without
 * the CLI needing a new release.
 *
 * AI-first design notes:
 * - `list --json` is the default for AI agent consumption. Humans get a
 *   colorized table only when stdout is a TTY without --json.
 * - `describe` returns the input_schema JSON Schema directly — agents
 *   feed it to their validator/planner.
 * - `invoke` auto-routes GET vs POST based on the verb's HTTP endpoint.
 *
 * Phase 5 of the agent-attraction roadmap.
 */
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs';
import { config } from '../lib/config';
import { apiClient, handleApiError, failApi } from '../lib/api-client';
import { isJsonOutput } from '../lib/json-output';
import { parseJsonArg } from '../lib/json-arg';

interface VerbRecord {
  name: string;
  description: string;
  shape: string;
  side_effects: string;
  surfaces: string[];
  requires_consent: boolean;
  tier_floor: string;
  input_schema: Record<string, any>;
  http_endpoint: string;
}

interface VerbManifest {
  schema: string;
  count: number;
  total_registered: number;
  filtered_by: { surface: string | null; shape: string | null };
  verbs: VerbRecord[];
}

// Verbs that go through GET instead of POST. The Phase 5 verb-index
// endpoint doesn't expose method yet (input_schema only); this lookup
// is the small explicit set of GET endpoints in agent_verbs.py.
const GET_VERBS = new Set([
  'agent.manifest',
  'ucp.recommendations',
  'agent.reliability.scoreboard',
  'agent.reliability.needs_attention',
  'agent.telemetry.status',
  'ucp.receipts.get',
  'transaction.get',
  'agent.macros.list',
  'audit.export',
]);

export const verbsCommand = new Command('verbs')
  // ⛔ NO COUNT IN THIS STRING. It said "169 agent-attraction verbs" against a
// real 545 — and `src/commands/verbs.ts` is not in scripts/sync-counts.ts's
// SURFACES list, so nothing caught the drift. `solid verbs list` already
// prints the LIVE total from the backend; a second, frozen copy of the number
// in help text can only ever go stale.
  .description('Discover + invoke any agent-attraction verb (12 shapes, 4 sibling transports)');

verbsCommand
  .command('list')
  .description('List every agent-attraction verb the backend exposes')
  .option('--surface <name>', 'Filter to verbs on this surface (http|mcp_stdio|webmcp|ucp|cli|public)')
  .option('--shape <name>', 'Filter to verbs of this shape (preview|explain|aggregate|suggest|...)')
  .option('--json', 'Output the raw manifest as JSON')
  .action(async (options) => {
    const wantsJson = options.json || isJsonOutput();
    const spinner = wantsJson ? null : ora('Fetching verb manifest...').start();
    try {
      const params: Record<string, string> = {};
      if (options.surface) params.surface = options.surface;
      if (options.shape) params.shape = options.shape;
      const res = await apiClient.get('/api/v1/agent/verbs', { params });
      spinner?.stop();
      const data = res.data as VerbManifest;

      if (wantsJson) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      console.log(chalk.cyan(`${data.count} verbs (of ${data.total_registered} total)`));
      if (data.filtered_by.surface) console.log(chalk.dim(`  surface=${data.filtered_by.surface}`));
      if (data.filtered_by.shape) console.log(chalk.dim(`  shape=${data.filtered_by.shape}`));
      console.log('');
      for (const v of data.verbs) {
        const tag = v.side_effects === 'write' ? chalk.yellow(' write') :
                    v.side_effects === 'mixed' ? chalk.magenta(' mixed') : '';
        console.log(`  ${chalk.gray(v.shape.padEnd(11))} ${v.name}${tag}`);
      }
      console.log('');
      console.log(chalk.dim(`use 'solid verbs describe <name>' for schema details`));
    } catch (e) {
      spinner?.stop();
      failApi(e);
    }
  });

verbsCommand
  .command('describe <verbName>')
  .description('Print one verb\'s schema + surface coverage')
  .option('--json', 'Output as raw JSON (default for AI consumption)')
  .action(async (verbName, options) => {
    const wantsJson = options.json || isJsonOutput();
    const spinner = wantsJson ? null : ora('Fetching verb...').start();
    try {
      const res = await apiClient.get(`/api/v1/agent/verbs/${encodeURIComponent(verbName)}`);
      spinner?.stop();
      const v = res.data as VerbRecord;

      if (wantsJson) {
        console.log(JSON.stringify(v, null, 2));
        return;
      }

      console.log(chalk.cyan(v.name));
      console.log(`  ${v.description}`);
      console.log(`  shape:            ${v.shape}`);
      console.log(`  side_effects:     ${v.side_effects}`);
      console.log(`  surfaces:         ${v.surfaces.join(', ')}`);
      console.log(`  requires_consent: ${v.requires_consent}`);
      console.log(`  tier_floor:       ${v.tier_floor}`);
      console.log(`  http_endpoint:    ${v.http_endpoint}`);
      console.log('');
      console.log(chalk.dim('input_schema:'));
      console.log(JSON.stringify(v.input_schema, null, 2)
        .split('\n').map((l) => '  ' + l).join('\n'));
    } catch (e) {
      spinner?.stop();
      failApi(e);
    }
  });

verbsCommand
  .command('invoke <verbName>')
  .description('Invoke any agent-attraction verb by name (auth required)')
  .option('-p, --payload <json>', 'JSON payload (string or @file.json)')
  .option('--confirm', 'Consent for a verb that writes. Required by the backend for any side_effects=write verb')
  .action(async (verbName, options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    // Look up the verb to know its HTTP endpoint.
    let verb: VerbRecord;
    try {
      const r = await apiClient.get(`/api/v1/agent/verbs/${encodeURIComponent(verbName)}`);
      verb = r.data as VerbRecord;
    } catch (e) {
      failApi(e);
      return;
    }

    const payload = parseJsonArg('payload', options.payload) ?? {};

    // ⛔ WRITES NEED CONSENT, AND IT HAS TO TRAVEL. The backend refuses any
    // side_effects=write verb without `confirm: true` — and its refusal reads
    // "CLI: use the --confirm flag", a flag that did not exist until now. So
    // every write verb was uninvokable from the CLI and the error told you to
    // use something imaginary (found 2026-08-20). The flag is deliberately NOT
    // implicit: consent is the user's act, not a default we assume for them.
    const isWrite = verb.side_effects !== 'read';
    if (isWrite && !options.confirm) {
      console.error(chalk.red(`${verb.name} writes (side_effects=${verb.side_effects}).`));
      console.error(chalk.dim(`  Re-run with --confirm to consent:`));
      console.error(chalk.dim(`    solid verbs invoke ${verb.name} --confirm${options.payload ? ` -p '${typeof options.payload === 'string' ? options.payload : ''}'` : ''}`));
      process.exit(1);
    }

    try {
      const method = GET_VERBS.has(verb.name) ? 'GET' : 'POST';
      const body = isWrite ? { ...payload, confirm: true } : payload;
      const res = method === 'GET'
        ? await apiClient.get(verb.http_endpoint, { params: body })
        : await apiClient.post(verb.http_endpoint, body);
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) {
      failApi(e);
    }
  });
