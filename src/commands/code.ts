/**
 * Unified code surface for Solid CLI
 *
 * One entry point for all code/content mutation systems:
 *   solid code status   — unified view across pages, modules, chains, sandbox
 *   solid code history  — interleaved history from all systems
 *   solid code diff     — pending changes across all surfaces
 *   solid code rollback — routes to the right rollback system
 *
 * All operations scoped to the authenticated company_id.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { isJsonOutput } from '../lib/json-output';

function requireAuth() {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
}

export const codeCommand = new Command('code')
  .description('Unified code surface — status, history, diff, rollback across all systems');

// ── Status ──────────────────────────────────────────────────────────

codeCommand
  .command('status')
  .description('Unified status across all code systems')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading code status...').start();
    try {
      const res = await apiClient.post('/api/v1/agent/code/status', {});
      const data = res.data as Record<string, any>;
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(data, null, 2)); return; }
      spinner.succeed(chalk.green('Code Status'));
      console.log('');
      const systems = data.systems || {};
      for (const [name, info] of Object.entries(systems) as [string, any][]) {
        const status = info.active === false ? chalk.dim('inactive') : chalk.green('active');
        const details = Object.entries(info)
          .filter(([k]) => k !== 'active' && k !== 'status')
          .map(([k, v]) => `${k}=${v}`)
          .join(', ');
        console.log(`  ${chalk.bold(name)}: ${status}${details ? `  ${chalk.dim(details)}` : ''}`);
      }
    } catch (error) { spinner.fail(chalk.red('Failed')); console.error(chalk.red(`  ${handleApiError(error).message}`)); }
  });

// ── History ─────────────────────────────────────────────────────────

codeCommand
  .command('history')
  .description('Interleaved history from all code systems')
  .option('-l, --limit <n>', 'Max entries', '30')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading code history...').start();
    try {
      const res = await apiClient.post('/api/v1/agent/code/history', { limit: parseInt(opts.limit) });
      const data = res.data as Record<string, any>;
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(data, null, 2)); return; }
      const history = data.history || [];
      spinner.succeed(chalk.green(`${history.length} changes`));
      if (history.length === 0) { console.log(chalk.dim('  No changes recorded.')); return; }
      console.log('');
      for (const h of history as Record<string, any>[]) {
        const sys = chalk.cyan(`[${h.system}]`);
        const entity = chalk.bold(`${h.type} #${h.id}`);
        const verb = h.verb ? chalk.dim(h.verb) : '';
        const date = h.at ? chalk.dim(new Date(h.at).toLocaleString()) : '';
        console.log(`  ${sys} ${entity}  v${h.version}  ${verb}  ${date}`);
      }
    } catch (error) { spinner.fail(chalk.red('Failed')); console.error(chalk.red(`  ${handleApiError(error).message}`)); }
  });

// ── Diff ────────────────────────────────────────────────────────────

codeCommand
  .command('diff')
  .description('Show all pending changes — sandbox, unpublished pages, uncommitted modules')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading diffs...').start();
    try {
      const res = await apiClient.post('/api/v1/agent/code/diff', {});
      const data = res.data as Record<string, any>;
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(data, null, 2)); return; }
      if (!data.has_changes) {
        spinner.succeed(chalk.green('No pending changes'));
        return;
      }
      spinner.succeed(chalk.green('Pending changes'));
      console.log('');
      const diffs = data.diffs || {};
      for (const [system, info] of Object.entries(diffs) as [string, any][]) {
        console.log(`  ${chalk.bold(system)}:`);
        if (system === 'sandbox' && info.changes) {
          console.log(`    ${info.changes.length} sandbox change(s)`);
          for (const c of info.changes.slice(0, 5)) {
            console.log(chalk.dim(`      ${c.entity_type} #${c.entity_id} — ${c.verb_name || 'modified'}`));
          }
        } else if (system === 'unpublished_pages') {
          console.log(`    ${info.count} unpublished draft(s)`);
        } else {
          console.log(chalk.dim(`    ${JSON.stringify(info)}`));
        }
      }
    } catch (error) { spinner.fail(chalk.red('Failed')); console.error(chalk.red(`  ${handleApiError(error).message}`)); }
  });

// ── Rollback ────────────────────────────────────────────────────────

codeCommand
  .command('rollback <type> <id>')
  .description('Unified rollback — routes to the right system based on entity type')
  .requiredOption('--to <version>', 'Version to restore')
  .option('--yes', 'Skip confirmation')
  .option('--json', 'Output as JSON')
  .action(async (type: string, id: string, opts: any) => {
    requireAuth();
    const version = parseInt(opts.to);
    if (!opts.yes) {
      const inquirer = (await import('inquirer')).default;
      const { confirm } = await inquirer.prompt([{ type: 'confirm', name: 'confirm', message: `Rollback ${type} #${id} to version ${version}?`, default: false }]);
      if (!confirm) { console.log(chalk.dim('Cancelled.')); return; }
    }
    const spinner = ora(`Rolling back ${type} #${id} to v${version}...`).start();
    try {
      const res = await apiClient.post('/api/v1/agent/code/rollback', {
        entity_type: type, entity_id: parseInt(id), version,
      });
      const data = res.data as Record<string, any>;
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(data, null, 2)); return; }
      if (data.status === 'rolled_back') {
        spinner.succeed(chalk.green(`Rolled back ${type} #${id} to v${version}`));
      } else {
        spinner.fail(chalk.red(data.summary || 'Rollback failed'));
      }
    } catch (error) { spinner.fail(chalk.red('Failed')); console.error(chalk.red(`  ${handleApiError(error).message}`)); }
  });

import { appendExamples as __ae_code } from '../lib/command-kit';
__ae_code(codeCommand, [
  { cmd: 'solid code status',                        why: 'Unified view of all code systems' },
  { cmd: 'solid code history',                        why: 'Recent changes across pages, entities, modules' },
  { cmd: 'solid code diff',                           why: 'What\'s pending (sandbox, drafts, uncommitted)' },
  { cmd: 'solid code rollback product 42 --to 1',    why: 'Restore product #42 to version 1' },
]);
