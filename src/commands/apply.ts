/**
 * solid apply — declarative desired-state reconcile (GitOps for a tenant).
 *
 * Reads a YAML/JSON manifest of desired resources and converges the company
 * to it: creates what's missing, updates what drifted, leaves matches alone,
 * and (with --prune) deletes managed resources absent from the manifest.
 * Idempotent: re-applying an unchanged manifest is all no-ops. The whole point
 * is that a SYSTEM can declare its state in a file and reconcile it repeatedly
 * — CI, GitOps, an agent — instead of issuing imperative one-off mutations.
 *
 *   solid apply infra.yaml
 *   solid apply infra.yaml --dry-run        # plan only, no writes
 *   solid apply infra.yaml --prune --yes    # also delete unmanaged resources
 *   solid apply --kinds                      # list supported kinds
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'node:fs';
import { apiClient, handleApiError } from '../lib/api-client';
import { isJsonOutput, emitJson } from '../lib/json-output';
import { requireCompanyContext, confirm } from '../lib/command-kit';
import { isDryRun } from '../lib/dry-run';
import {
  parseManifest, extractList, planKind, executePlan,
  DesiredResource, PlannedAction, ExecResult,
} from '../lib/apply/engine';
import { reconcilerFor, knownKinds } from '../lib/apply/registry';

interface ApplyOptions { dryRun?: boolean; prune?: boolean; yes?: boolean; json?: boolean; kinds?: boolean }

const ICON: Record<string, string> = {
  create: chalk.green('+ create'),
  update: chalk.yellow('~ update'),
  noop: chalk.dim('= unchanged'),
  prune: chalk.red('- prune'),
  unsupported: chalk.magenta('! immutable'),
};

export const applyCommand = new Command('apply')
  .description('Reconcile the company to a declarative manifest (create/update/prune)')
  .argument('[file]', 'Manifest file (YAML or JSON). Use "-" for stdin.')
  .option('--dry-run', 'Show the plan without making any changes')
  .option('--prune', 'Delete managed resources that are absent from the manifest')
  .option('--yes', 'Skip the confirmation prompt (required for --prune in non-interactive use)')
  .option('--json', 'Machine-readable plan/result')
  .option('--kinds', 'List the resource kinds apply supports, then exit')
  .action(async (file: string | undefined, options: ApplyOptions) => {
    if (options.kinds) {
      const kinds = knownKinds();
      if (isJsonOutput(options)) return void emitJson({ kinds });
      console.log(chalk.bold('Supported kinds:'));
      for (const k of kinds) console.log(`  ${k}`);
      return;
    }

    requireCompanyContext();

    if (!file) {
      console.error(chalk.red('Missing manifest file. Usage: solid apply <file> (or "-" for stdin).'));
      process.exit(2);
    }

    let text: string;
    try {
      text = file === '-' ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8');
    } catch (e) {
      console.error(chalk.red(`Cannot read manifest: ${e instanceof Error ? e.message : String(e)}`));
      process.exit(2);
    }

    let resources: DesiredResource[];
    try {
      resources = parseManifest(text);
    } catch (e) {
      console.error(chalk.red(`Invalid manifest: ${e instanceof Error ? e.message : String(e)}`));
      process.exit(2);
    }
    if (resources.length === 0) {
      console.error(chalk.yellow('Manifest declares no resources.'));
      process.exit(0);
    }

    const dryRun = !!options.dryRun || isDryRun();

    // Group by kind so we fetch each collection's current state once.
    const byKind = new Map<string, DesiredResource[]>();
    for (const r of resources) {
      const arr = byKind.get(r.kind) ?? [];
      arr.push(r);
      byKind.set(r.kind, arr);
    }

    const allActions: PlannedAction[] = [];
    const planByKind: Array<{ kind: string; actions: PlannedAction[] }> = [];
    try {
      for (const [kind, desired] of byKind) {
        const recon = reconcilerFor(kind)!; // parseManifest already validated
        const resp = await apiClient.get(recon.list);
        const current = extractList(resp.data, recon);
        const actions = planKind(recon, desired, current, { prune: options.prune });
        planByKind.push({ kind, actions });
        allActions.push(...actions);
      }
    } catch (e) {
      const err = handleApiError(e);
      if (isJsonOutput(options)) { emitJson({ error: err.message }); process.exit(1); }
      console.error(chalk.red(`Failed to read current state: ${err.message}`));
      process.exit(1);
    }

    const changes = allActions.filter((a) => a.action === 'create' || a.action === 'update' || a.action === 'prune');
    const prunes = allActions.filter((a) => a.action === 'prune');

    // Confirm destructive prunes before any write (unless --yes / --dry-run / --json).
    if (!dryRun && prunes.length > 0 && !options.yes && !isJsonOutput(options)) {
      const ok = await confirm(`Prune ${prunes.length} resource(s)? This deletes them.`);
      if (!ok) { console.error(chalk.yellow('Aborted.')); process.exit(1); }
    }
    if (!dryRun && prunes.length > 0 && !options.yes && isJsonOutput(options)) {
      emitJson({ error: 'Refusing to prune without --yes in non-interactive/json mode', prunes: prunes.length });
      process.exit(1);
    }

    const results: ExecResult[] = [];
    for (const { kind, actions } of planByKind) {
      const recon = reconcilerFor(kind)!;
      results.push(...(await executePlan(apiClient, recon, actions, dryRun)));
    }

    const counts = tally(results);
    if (isJsonOutput(options)) {
      return void emitJson({ dryRun, counts, actions: results });
    }

    for (const r of results) {
      const tag = ICON[r.action] ?? r.action;
      const suffix = r.status === 'failed' ? chalk.red(`  FAILED: ${r.error}`)
        : r.reason ? chalk.dim(`  (${r.reason})`) : '';
      console.log(`  ${tag}  ${chalk.cyan(r.kind)}/${r.identity}${suffix}`);
    }
    const verb = dryRun ? 'Plan' : 'Applied';
    console.log(
      `\n${chalk.bold(verb)}: ${counts.create} to create, ${counts.update} to update, ` +
      `${counts.noop} unchanged, ${counts.prune} to prune` +
      (counts.failed ? chalk.red(`, ${counts.failed} failed`) : '') +
      (counts.unsupported ? chalk.magenta(`, ${counts.unsupported} immutable`) : ''),
    );
    if (dryRun && changes.length > 0) console.log(chalk.dim('Run without --dry-run to apply.'));
    if (counts.failed > 0) process.exit(1);
  });

function tally(results: ExecResult[]): Record<string, number> {
  const c = { create: 0, update: 0, noop: 0, prune: 0, unsupported: 0, failed: 0 };
  for (const r of results) {
    if (r.status === 'failed') c.failed++;
    if (r.action in c) (c as Record<string, number>)[r.action]++;
  }
  return c;
}
