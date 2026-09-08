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
 *   solid apply infra.yaml --strict         # refuse if production moved since the last apply
 *   solid apply infra.yaml --prune --yes    # also delete unmanaged resources
 *   solid apply --kinds                      # list supported kinds
 *
 *   solid apply drift infra.yaml             # three-way: manifest vs lock vs production
 *   solid apply rollback infra.yaml          # revert the last run from its recorded pre-images
 *   solid apply history infra.yaml           # the runs the lock remembers
 *   solid apply export business.yaml         # write the live tenant as a manifest
 *
 * Every non-dry-run apply writes `<manifest>.lock.json` beside the manifest:
 * server ids, the managed fields as applied, and a pre-image for every write.
 * Commit it with the manifest — it is what drift and rollback read.
 */
import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import { apiClient, handleApiError } from '../lib/api-client';
import { config } from '../lib/config';
import { isJsonOutput, emitJson } from '../lib/json-output';
import { requireCompanyContext, confirm } from '../lib/command-kit';
import { isDryRun } from '../lib/dry-run';
import { isProtectedRoot, refuseProtectedRoot } from '../lib/tenant-guard';
import {
  parseManifest, extractList, planKind, executePlan, tallyResults,
  DesiredResource, PlannedAction, ExecResult,
} from '../lib/apply/engine';
import { reconcilerFor, knownKinds, Reconciler } from '../lib/apply/registry';
import {
  ApplyLock, LockRun, DriftEntry, readLock, writeLock, lockPathFor, emptyLock, mergeRun,
  classifyDrift, isProductionDrift, buildRollbackPlan, shapeForExport, toManifestYaml,
} from '../lib/apply/lock';

interface ApplyOptions {
  dryRun?: boolean; prune?: boolean; yes?: boolean; json?: boolean; kinds?: boolean;
  strict?: boolean; lock?: boolean;
}

const ICON: Record<string, string> = {
  create: chalk.green('+ create'),
  update: chalk.yellow('~ update'),
  noop: chalk.dim('= unchanged'),
  prune: chalk.red('- prune'),
  unsupported: chalk.magenta('! unsupported'),
};

const DRIFT_ICON: Record<DriftEntry['state'], string> = {
  in_sync: chalk.dim('= in sync'),
  manifest_changed: chalk.yellow('~ manifest changed'),
  live_changed: chalk.red('! production changed'),
  conflict: chalk.red('!! conflict'),
  missing: chalk.magenta('? missing on server'),
  never_applied: chalk.dim('· never applied'),
  removed_from_manifest: chalk.yellow('- removed from manifest'),
};

function cliVersion(): string {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')).version as string;
  } catch { return 'unknown'; }
}

function readManifest(file: string): DesiredResource[] {
  let text: string;
  try {
    text = file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(file, 'utf8');
  } catch (e) {
    console.error(chalk.red(`Cannot read manifest: ${e instanceof Error ? e.message : String(e)}`));
    process.exit(2);
  }
  try {
    return parseManifest(text);
  } catch (e) {
    console.error(chalk.red(`Invalid manifest: ${e instanceof Error ? e.message : String(e)}`));
    process.exit(2);
  }
}

function groupByKind(resources: DesiredResource[]): Map<string, DesiredResource[]> {
  const byKind = new Map<string, DesiredResource[]>();
  for (const r of resources) {
    const arr = byKind.get(r.kind) ?? [];
    arr.push(r);
    byKind.set(r.kind, arr);
  }
  return byKind;
}

type Live = Map<string, { recon: Reconciler; items: Array<Record<string, unknown>> }>;

async function fetchLive(kinds: Iterable<string>, json: boolean): Promise<Live> {
  const live: Live = new Map();
  try {
    for (const kind of kinds) {
      const recon = reconcilerFor(kind)!;
      const resp = await apiClient.get(recon.list);
      live.set(kind, { recon, items: extractList(resp.data, recon) });
    }
  } catch (e) {
    const err = handleApiError(e);
    if (json) { emitJson({ error: err.message }); process.exit(1); }
    console.error(chalk.red(`Failed to read current state: ${err.message}`));
    process.exit(1);
  }
  return live;
}

/** Lock handling for a manifest path: null when the manifest is stdin or --no-lock. */
function lockFor(file: string, useLock: boolean, json: boolean): { path: string; lock: ApplyLock | null } | null {
  if (!useLock || file === '-') return null;
  const lockPath = lockPathFor(path.resolve(file));
  if (isProtectedRoot(path.dirname(lockPath))) {
    // Never write tenant state into $HOME or the platform monorepo.
    if (!json) refuseProtectedRoot(path.dirname(lockPath));
    emitJson({ error: 'refusing to write a lockfile in a protected directory; use --no-lock or move the manifest' });
    process.exit(1);
  }
  try {
    return { path: lockPath, lock: readLock(lockPath) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (json) { emitJson({ error: msg }); process.exit(1); }
    console.error(chalk.red(msg));
    process.exit(1);
  }
}

function printResults(results: ExecResult[]): void {
  for (const r of results) {
    const tag = ICON[r.action] ?? r.action;
    const suffix = r.status === 'failed' ? chalk.red(`  FAILED: ${r.error}`)
      : r.reason ? chalk.dim(`  (${r.reason})`) : '';
    console.log(`  ${tag}  ${chalk.cyan(r.kind)}/${r.identity}${suffix}`);
  }
}

function printDrift(entries: DriftEntry[]): void {
  for (const e of entries) {
    console.log(`  ${DRIFT_ICON[e.state]}  ${chalk.cyan(e.kind)}/${e.identity}`);
    for (const d of e.live_diff ?? []) {
      console.log(chalk.dim(`      ${d.field}: applied ${JSON.stringify(d.lock)} → production ${JSON.stringify(d.live)}`));
    }
    for (const d of e.manifest_diff ?? []) {
      console.log(chalk.dim(`      ${d.field}: applied ${JSON.stringify(d.lock)} → manifest ${JSON.stringify(d.manifest)}`));
    }
  }
}

// ── solid apply <file> ───────────────────────────────────────────────────────

export const applyCommand = new Command('apply')
  .description('Reconcile the company to a declarative manifest (create/update/prune); drift, rollback, history, export')
  // Parent flags (--json, --yes, --dry-run, --kinds) must not swallow the
  // subcommands' own flags: `solid apply drift site.yaml --json` is drift's --json.
  .enablePositionalOptions()
  .argument('[file]', 'Manifest file (YAML or JSON). Use "-" for stdin.')
  .option('--dry-run', 'Show the plan without making any changes')
  .option('--prune', 'Delete managed resources that are absent from the manifest')
  .option('--yes', 'Skip the prune confirmation')
  .option('--strict', 'Refuse to write if production changed since the last apply (what `solid apply drift` reports)')
  .option('--no-lock', 'Do not read or write <manifest>.lock.json')
  .option('--json', 'Machine-readable plan/result')
  .option('--kinds', 'List the resource kinds apply supports, then exit')
  .action(async (file: string | undefined, options: ApplyOptions) => {
    const json = isJsonOutput(options);
    if (options.kinds) {
      const kinds = knownKinds();
      if (json) return void emitJson({ kinds });
      console.log(chalk.bold('Supported kinds:'));
      for (const k of kinds) console.log(`  ${k}`);
      return;
    }

    requireCompanyContext();

    if (!file) {
      console.error(chalk.red('Missing manifest file. Usage: solid apply <file> (or "-" for stdin).'));
      process.exit(2);
    }
    const resources = readManifest(file);
    if (resources.length === 0) {
      console.error(chalk.yellow('Manifest declares no resources.'));
      process.exit(0);
    }

    const dryRun = !!options.dryRun || isDryRun();
    const lockState = lockFor(file, options.lock !== false, json);
    const byKind = groupByKind(resources);
    const live = await fetchLive(byKind.keys(), json);

    // --strict: production must be where the last apply left it, or we do nothing.
    let drift: DriftEntry[] | undefined;
    if (options.strict) {
      if (!lockState) {
        const msg = '--strict needs a lockfile (manifest from a file, without --no-lock)';
        if (json) { emitJson({ error: msg }); process.exit(2); }
        console.error(chalk.red(msg)); process.exit(2);
      }
      drift = classifyDrift(resources, lockState.lock, live);
      const moved = drift.filter(isProductionDrift);
      if (moved.length > 0 && !dryRun) {
        if (json) { emitJson({ error: 'production changed since the last apply', drift: moved }); process.exit(3); }
        console.error(chalk.red(`Refusing to apply: ${moved.length} resource(s) changed in production since the last apply.`));
        printDrift(moved);
        console.error(chalk.dim('Re-apply without --strict to overwrite production, or update the manifest to match it.'));
        process.exit(3);
      }
    }

    const allActions: PlannedAction[] = [];
    const planByKind: Array<{ kind: string; actions: PlannedAction[] }> = [];
    for (const [kind, desired] of byKind) {
      const { recon, items } = live.get(kind)!;
      const actions = planKind(recon, desired, items, { prune: options.prune });
      planByKind.push({ kind, actions });
      allActions.push(...actions);
    }

    const changes = allActions.filter((a) => a.action === 'create' || a.action === 'update' || a.action === 'prune');
    const prunes = allActions.filter((a) => a.action === 'prune');

    // Confirm destructive prunes before any write (unless --yes / --dry-run / --json).
    if (!dryRun && prunes.length > 0 && !options.yes && !json) {
      const ok = await confirm(`Prune ${prunes.length} resource(s)? This deletes them.`);
      if (!ok) { console.error(chalk.yellow('Aborted.')); process.exit(1); }
    }
    if (!dryRun && prunes.length > 0 && !options.yes && json) {
      emitJson({ error: 'Refusing to prune without --yes in non-interactive/json mode', prunes: prunes.length });
      process.exit(1);
    }

    const results: ExecResult[] = [];
    for (const { kind, actions } of planByKind) {
      const recon = reconcilerFor(kind)!;
      results.push(...(await executePlan(apiClient, recon, actions, dryRun)));
    }

    const counts = tallyResults(results);
    let lockWritten: string | undefined;
    let runId: string | undefined;
    if (!dryRun && lockState) {
      const base = lockState.lock ?? emptyLock(config.companyId!, file, cliVersion());
      const merged = mergeRun(base, results, { cliVersion: cliVersion() });
      writeLock(lockState.path, merged.lock);
      lockWritten = lockState.path;
      runId = merged.run.run_id;
    }

    if (json) {
      return void emitJson({ dryRun, counts, actions: results, lock: lockWritten ?? null, run_id: runId ?? null, drift: drift ?? undefined });
    }

    printResults(results);
    const verb = dryRun ? 'Plan' : 'Applied';
    console.log(
      `\n${chalk.bold(verb)}: ${counts.create} to create, ${counts.update} to update, ` +
      `${counts.noop} unchanged, ${counts.prune} to prune` +
      (counts.failed ? chalk.red(`, ${counts.failed} failed`) : '') +
      (counts.unsupported ? chalk.magenta(`, ${counts.unsupported} unsupported`) : ''),
    );
    if (dryRun && changes.length > 0) console.log(chalk.dim('Run without --dry-run to apply.'));
    if (lockWritten) console.log(chalk.dim(`Lock: ${path.relative(process.cwd(), lockWritten)}  run ${runId}`));
    if (counts.failed > 0) process.exit(1);
  });

// ── solid apply drift <file> ─────────────────────────────────────────────────

applyCommand
  .command('drift')
  .description('Three-way comparison: manifest (git) vs lock (last apply) vs production. Exit 1 when production moved.')
  .argument('<file>', 'Manifest file')
  .option('--fail-on-any', 'Also exit 1 for manifest changes, missing and never-applied resources')
  .option('--json', 'Machine-readable report')
  .action(async (file: string, options: { failOnAny?: boolean; json?: boolean }) => {
    const json = isJsonOutput(options);
    requireCompanyContext();
    const resources = readManifest(file);
    const lockPath = lockPathFor(path.resolve(file));
    let lock: ApplyLock | null = null;
    try { lock = readLock(lockPath); } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (json) { emitJson({ error: msg }); process.exit(1); }
      console.error(chalk.red(msg)); process.exit(1);
    }
    const live = await fetchLive(groupByKind(resources).keys(), json);
    const entries = classifyDrift(resources, lock, live);
    const production = entries.filter(isProductionDrift);
    const pending = entries.filter((e) => !isProductionDrift(e) && e.state !== 'in_sync');
    const code = production.length > 0 ? 1 : (options.failOnAny && pending.length > 0 ? 1 : 0);

    if (json) {
      emitJson({
        lock: lock ? path.relative(process.cwd(), lockPath) : null,
        last_applied: lock?.applied_at ?? null,
        production_drift: production.length, pending: pending.length,
        entries,
      });
      process.exit(code);
    }
    if (!lock) console.log(chalk.yellow(`No lockfile at ${path.relative(process.cwd(), lockPath)} — nothing has been applied from this manifest yet, so there is no baseline.`));
    else console.log(chalk.dim(`Baseline: ${path.relative(process.cwd(), lockPath)} (applied ${lock.applied_at})`));
    printDrift(entries);
    console.log(
      `\n${chalk.bold('Drift')}: ${production.length} changed in production, ${pending.length} pending from git, ` +
      `${entries.filter((e) => e.state === 'in_sync').length} in sync`,
    );
    if (production.length) console.log(chalk.dim('Production moved since the last apply. `solid apply <file>` overwrites it; update the manifest to keep it.'));
    process.exit(code);
  });

// ── solid apply rollback <file> ──────────────────────────────────────────────

applyCommand
  .command('rollback')
  .description('Revert a recorded run from its pre-images, most recent write first, then verify. Ordered, not atomic.')
  .argument('<file>', 'Manifest file (its lock holds the runs)')
  .option('--run <id>', 'Run to revert (default: the last apply run)')
  .option('--dry-run', 'Show the revert plan without writing')
  .option('--yes', 'Skip confirmation')
  .option('--json', 'Machine-readable result')
  .action(async (file: string, options: { run?: string; dryRun?: boolean; yes?: boolean; json?: boolean }) => {
    const json = isJsonOutput(options);
    requireCompanyContext();
    const lockState = lockFor(file, true, json)!;
    if (!lockState.lock || lockState.lock.runs.length === 0) {
      const msg = `No runs recorded in ${path.relative(process.cwd(), lockState.path)} — nothing to roll back.`;
      if (json) { emitJson({ error: msg }); process.exit(1); }
      console.error(chalk.yellow(msg)); process.exit(1);
    }
    const lock = lockState.lock;
    const run: LockRun | undefined = options.run
      ? lock.runs.find((r) => r.run_id === options.run)
      : [...lock.runs].reverse().find((r) => r.kind === 'apply' && r.actions.length > 0);
    if (!run) {
      const msg = options.run ? `Run ${options.run} not found; see \`solid apply history ${file}\`` : 'No apply run with writes to revert.';
      if (json) { emitJson({ error: msg }); process.exit(1); }
      console.error(chalk.red(msg)); process.exit(1);
    }
    const dryRun = !!options.dryRun || isDryRun();
    const { actions, skipped } = buildRollbackPlan(run, reconcilerFor);
    if (!json) {
      console.log(chalk.bold(`Reverting run ${run.run_id} (${run.at}) — ${actions.length} action(s)` + (skipped.length ? `, ${skipped.length} not revertible` : '')));
      for (const a of actions) console.log(`  ${ICON[a.action]}  ${chalk.cyan(a.kind)}/${a.identity}`);
      for (const s of skipped) console.log(`  ${chalk.magenta('! skip')}  ${chalk.cyan(s.kind)}/${s.identity}  ${chalk.dim(`(${s.reason})`)}`);
    }
    if (actions.length === 0) {
      if (json) return void emitJson({ run_id: run.run_id, dryRun, actions: [], skipped });
      console.log(chalk.yellow('\nNothing revertible in this run.'));
      return;
    }
    if (!dryRun && !options.yes) {
      if (json) { emitJson({ error: 'Refusing to roll back without --yes in json mode', run_id: run.run_id, actions, skipped }); process.exit(1); }
      const ok = await confirm(`Revert ${actions.length} write(s) on production?`);
      if (!ok) { console.error(chalk.yellow('Aborted.')); process.exit(1); }
    }

    // Execute per kind, preserving reverse order within the run.
    const results: ExecResult[] = [];
    for (const a of actions) {
      const recon = reconcilerFor(a.kind)!;
      results.push(...(await executePlan(apiClient, recon, [a], dryRun)));
    }

    // Verification pass: re-read and check each reverted update now matches its target.
    const verified: Array<{ kind: string; identity: string; ok: boolean }> = [];
    if (!dryRun) {
      const live = await fetchLive(new Set(actions.map((a) => a.kind)), json);
      for (const a of actions) {
        if (a.action !== 'update' || !a.spec) continue;
        const { recon, items } = live.get(a.kind)!;
        const item = items.find((i) => String(i[recon.identity]) === a.identity);
        const ok = !!item && Object.keys(a.spec).every((k) => JSON.stringify(item[k] ?? null) === JSON.stringify(a.spec![k] ?? null));
        verified.push({ kind: a.kind, identity: a.identity, ok });
      }
      const merged = mergeRun(lock, results, { cliVersion: cliVersion(), kind: 'rollback', reverts: run.run_id });
      writeLock(lockState.path, merged.lock);
    }
    const counts = tallyResults(results);
    const failedVerify = verified.filter((v) => !v.ok);
    if (json) {
      emitJson({ reverted: run.run_id, dryRun, counts, actions: results, skipped, verified });
      process.exit(counts.failed || failedVerify.length ? 1 : 0);
    }
    console.log();
    printResults(results);
    for (const v of verified) console.log(`  ${v.ok ? chalk.green('✓ verified') : chalk.red('✗ mismatch')}  ${chalk.cyan(v.kind)}/${v.identity}`);
    console.log(`\n${chalk.bold(dryRun ? 'Revert plan' : 'Reverted')}: ${counts.create} recreated, ${counts.update} restored, ${counts.prune} removed` +
      (counts.failed ? chalk.red(`, ${counts.failed} failed`) : '') + (failedVerify.length ? chalk.red(`, ${failedVerify.length} did not verify`) : ''));
    if (!dryRun) console.log(chalk.dim('Rollback is ordered and verified, not atomic: a failure above leaves earlier reverts in place.'));
    if (counts.failed || failedVerify.length) process.exit(1);
  });

// ── solid apply history <file> ───────────────────────────────────────────────

applyCommand
  .command('history')
  .description('Runs recorded in the lockfile (what each apply or rollback wrote)')
  .argument('<file>', 'Manifest file')
  .option('--json', 'Machine-readable list')
  .action((file: string, options: { json?: boolean }) => {
    const json = isJsonOutput(options);
    const lockPath = lockPathFor(path.resolve(file));
    let lock: ApplyLock | null = null;
    try { lock = readLock(lockPath); } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (json) { emitJson({ error: msg }); process.exit(1); }
      console.error(chalk.red(msg)); process.exit(1);
    }
    if (json) return void emitJson({ lock: lock ? path.relative(process.cwd(), lockPath) : null, runs: lock?.runs ?? [], resources: Object.keys(lock?.resources ?? {}).length });
    if (!lock) { console.log(chalk.yellow(`No lockfile at ${path.relative(process.cwd(), lockPath)}.`)); return; }
    console.log(chalk.dim(`${path.relative(process.cwd(), lockPath)} — ${Object.keys(lock.resources).length} resource(s) tracked, company ${lock.company_id}`));
    for (const r of lock.runs) {
      const c = { create: 0, update: 0, prune: 0 };
      for (const a of r.actions) c[a.action]++;
      const tag = r.kind === 'rollback' ? chalk.yellow(`rollback of ${r.reverts}`) : chalk.green('apply');
      console.log(`  ${r.run_id}  ${r.at}  ${tag}  +${c.create} ~${c.update} -${c.prune}  ${chalk.dim(`cli ${r.cli_version}`)}`);
    }
  });

// ── solid apply export [file] ────────────────────────────────────────────────

applyCommand
  .command('export')
  .description('Write the live tenant as an apply manifest (all kinds, or --kinds a,b)')
  .argument('[file]', 'Output file (default: stdout)')
  .option('--kinds <list>', 'Comma-separated kinds to export (default: all)')
  .option('--json', 'Emit JSON instead of YAML')
  .action(async (file: string | undefined, options: { kinds?: string; json?: boolean }) => {
    const json = isJsonOutput(options);
    requireCompanyContext();
    const kinds = options.kinds ? options.kinds.split(',').map((k) => k.trim()).filter(Boolean) : knownKinds();
    const unknown = kinds.filter((k) => !reconcilerFor(k));
    if (unknown.length) {
      console.error(chalk.red(`Unknown kind(s): ${unknown.join(', ')} — see \`solid apply --kinds\``));
      process.exit(2);
    }
    if (file) refuseProtectedRoot(path.dirname(path.resolve(file)));
    const live = await fetchLive(kinds, json);
    const docs: Array<{ kind: string; spec: Record<string, unknown> }> = [];
    for (const kind of kinds) {
      const { recon, items } = live.get(kind)!;
      for (const item of items) docs.push({ kind, spec: shapeForExport(recon, item) });
    }
    const text = json
      ? JSON.stringify({ resources: docs.map((d) => ({ kind: d.kind, ...d.spec })) }, null, 2) + '\n'
      : toManifestYaml(docs, (o) => yaml.dump(o, { lineWidth: 120, noRefs: true }));
    if (file) {
      fs.writeFileSync(file, text);
      if (json) return void emitJson({ file, resources: docs.length, kinds });
      console.log(chalk.green(`Wrote ${docs.length} resource(s) across ${kinds.length} kind(s) to ${file}`));
      console.log(chalk.dim('Review before applying elsewhere: per-company ids (agent_id, site_id) do not travel between tenants.'));
      return;
    }
    process.stdout.write(text);
  });
