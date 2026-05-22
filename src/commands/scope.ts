/**
 * solid scope — Agent-readable scope contract.
 *
 * Asks the platform "given my auth, what can I actually do right now?"
 * and returns a structured contract: identity, tenant, scopes (read /
 * write / preview / explain / aggregate / trail), forbidden, runtime.
 *
 * Designed for AI agents (Claude Code, Cursor, etc.) to plan before they
 * try — so they don't burn tokens on permission-denied retries.
 *
 * Phase 1.5 of the agent-attraction roadmap.
 * See: Owners-Manual/73-WebMCP-Integration/NEW-VERBS-PROPOSAL.md (Shape 5)
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { config } from '../lib/config';
import { apiClient, handleApiError, failApi } from '../lib/api-client';
import { isJsonOutput } from '../lib/json-output';

export const scopeCommand = new Command('scope')
  .description('Inspect your agent scope (what you can read/write)');

scopeCommand
  .command('whoami')
  .description('Return the effective scope contract for this session (agent-readable JSON)')
  .option('--json', 'Output as JSON (default true for this command)')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const spinner = ora('Fetching scope contract...').start();
    let data: any;
    try {
      const res = await apiClient.get('/api/v1/cli/scope/whoami');
      data = res.data;
      spinner.stop();
    } catch (e) {
      spinner.fail('scope/whoami failed');
      failApi(e);
      process.exit(1);
    }

    // Default to JSON — this command's primary user is an AI agent.
    // Human-readable mode is opt-out via --no-json (commander
    // convention) or omitted in favor of JSON.
    if (isJsonOutput(options) || options.json !== false) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    // Human-readable fallback (--no-json)
    console.log('');
    console.log(chalk.bold.cyan('Scope contract'));
    console.log(chalk.dim(`  schema: ${data.schema}`));
    console.log(chalk.dim(`  ts:     ${data.ts}`));
    console.log('');

    console.log(chalk.bold('Identity'));
    console.log(`  user_id:     ${data.identity.user_id}`);
    console.log(`  email:       ${data.identity.email}`);
    console.log(`  role:        ${data.identity.role || '(none)'}`);
    console.log(`  auth_method: ${data.identity.auth_method}`);
    console.log('');

    console.log(chalk.bold('Tenant'));
    console.log(`  company_id:  ${data.tenant.company_id}`);
    console.log(`  name:        ${data.tenant.company_name || '(unknown)'}`);
    console.log(`  tier:        ${chalk.green(data.tenant.tier)}`);
    console.log('');

    const printList = (label: string, items: string[]) => {
      if (!items?.length) return;
      console.log(chalk.bold(label));
      for (const it of items) console.log(`  - ${it}`);
      console.log('');
    };
    printList('Read',    data.scopes.read);
    printList('Write',   data.scopes.write);
    printList('Preview', data.scopes.preview);
    printList('Explain', data.scopes.explain);
    printList('Aggregate', data.scopes.aggregate);
    printList('Trail',   data.scopes.trail);
    printList('Forbidden', data.forbidden);

    console.log(chalk.dim(`Runtime: ${data.runtime.agent_runtime || 'unknown'} from ${data.runtime.ip || '?'}`));
  });
