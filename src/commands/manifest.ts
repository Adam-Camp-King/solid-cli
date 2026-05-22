/**
 * solid manifest — JSON-LD manifest the tenant publishes for AI agents.
 *
 * Single canonical retrieval that gives an agent the full discoverability
 * picture: @context vocab, entity IRI templates, tier + role, and the
 * capability graph (verbs visible to this principal).
 *
 * Phase 2.5 of the agent-attraction roadmap.
 * See: Owners-Manual/73-WebMCP-Integration/NEW-VERBS-PROPOSAL.md (Shape 5)
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { config } from '../lib/config';
import { apiClient, handleApiError, failApi } from '../lib/api-client';
import { isJsonOutput } from '../lib/json-output';

export const manifestCommand = new Command('manifest')
  .description('Print the tenant JSON-LD manifest (@context, IRIs, capability graph)')
  .option('--role <role>', 'Filter capability graph to a single role')
  .option('--no-json', 'Print human-readable summary instead of raw JSON-LD')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const spinner = options.json === false ? ora('Fetching manifest...').start() : null;
    try {
      const params: Record<string, string> = {};
      if (options.role) params.role = options.role;
      const res = await apiClient.get('/api/v1/agent/manifest', { params });
      spinner?.stop();
      const data: any = res.data;

      // Default is JSON-LD output (the primary user is an agent).
      if (options.json !== false || isJsonOutput()) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      // Human summary
      console.log(chalk.cyan(`Manifest for company ${data.company_id} (tier=${data.tier})`));
      if (data.role) console.log(`Role: ${data.role}`);
      console.log(`Capability graph: ${data['capability_graph']?.verb_count ?? 0} verbs`);
      console.log(`Entity IRI templates:`);
      const tmpl = data.entity_iri_templates || {};
      Object.keys(tmpl).forEach((k) => {
        console.log(`  ${chalk.gray(k.padEnd(10))} → ${tmpl[k]}`);
      });
      if (data.notes?.verb_introspection) {
        console.log(chalk.dim(`note: ${data.notes.verb_introspection}`));
      }
    } catch (e) {
      spinner?.stop();
      failApi(e);
    }
  });
