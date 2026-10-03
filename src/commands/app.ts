/**
 * solid app — put a designer's interactive app live for this company.
 *
 *   solid app publish ./dist --slug sell --confirm   the BUILT folder (with index.html)
 *   solid app list                                   what this company has published
 *   solid app get sell                               url, live version, kept versions
 *   solid app rollback sell 2 --confirm              put an earlier version live
 *   solid app unpublish sell --confirm               take it offline (versions kept)
 *   solid app github --slug sell --folder dist       publish on every push (private repos too)
 *
 * The verbs are app.publish / app.list / app.get / app.rollback / app.unpublish
 * (backend services/hosted_apps.py); this command only reads the folder and
 * calls them. The app runs WITH its JavaScript at its own address — never a
 * solidnumber.com host — so a site page links to the url it returns.
 * Owners-Manual/26-Public-Site/HOSTED-APPS.md.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import chalk from 'chalk';
import { Command } from 'commander';
import { zipSync } from 'fflate';

import { apiClient, handleApiError } from '../lib/api-client';
import { isJsonOutput, printJson } from '../lib/json-output';
import { readFolder } from './nest-helpers';

async function call(verb: string, body: Record<string, unknown>): Promise<Record<string, any>> {
  const res = await apiClient.post(`/api/v1/agent/app/${verb}`, body);
  return res.data as Record<string, any>;
}

/** The folder as one zip, paths kept. Pure — the tests read it back. */
export function zipFolder(files: Array<{ path: string; content: string; encoding?: 'base64' }>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) {
    entries[f.path] = f.encoding === 'base64'
      ? new Uint8Array(Buffer.from(f.content, 'base64'))
      : new Uint8Array(Buffer.from(f.content, 'utf8'));
  }
  return zipSync(entries, { level: 6 });
}

/** Which commit of which repository a folder is, when it can be known. Pure but for git. */
export function buildSource(cwd: string, env: NodeJS.ProcessEnv = process.env): { commit?: string; repo?: string } {
  // In GitHub Actions both are given; they name the commit the workflow checked out.
  let commit = env.GITHUB_SHA;
  let repo = env.GITHUB_REPOSITORY;
  if (!commit) {
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });
    // Only when the folder's tree is clean: a commit that is not what was built would be a lie.
    const dirty = spawnSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' });
    if (head.status === 0 && dirty.status === 0 && !dirty.stdout.trim()) commit = head.stdout.trim();
  }
  if (!repo) {
    const url = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf8' });
    const m = url.status === 0 ? url.stdout.trim().match(/[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/) : null;
    if (m) repo = m[1];
  }
  return {
    ...(commit && /^[0-9a-f]{7,40}$/i.test(commit) ? { commit: commit.toLowerCase() } : {}),
    ...(repo && /^[\w.-]+\/[\w.-]+$/.test(repo) ? { repo } : {}),
  };
}

function done(json: boolean, out: Record<string, any>, render: () => void): void {
  if (out && out.ok === false) {
    if (json) printJson(out);
    else {
      console.error(chalk.red(`✗ ${out.error || out.reason || 'refused'}`));
      if (out.next) console.error(chalk.dim(`  ${out.next}`));
    }
    process.exitCode = 1;
    return;
  }
  if (json) printJson(out);
  else render();
}

function fail(json: boolean, message: string, extra: Record<string, unknown> = {}): void {
  if (json) printJson({ ok: false, error: message, ...extra });
  else console.error(chalk.red(`✗ ${message}`));
  process.exitCode = 1;
}

export const appCommand = new Command('app')
  .description("Put an interactive app (Figma Make, Lovable, v0, Bolt, React…) live for this company");

appCommand
  .command('publish <folder>')
  .description('Publish the BUILT app folder (the one with index.html: dist/, build/, docs/)')
  .requiredOption('--slug <slug>', "The app's name in its address, e.g. sell")
  .option('--name <name>', 'Display name')
  .option('--root <folder>', 'Inside <folder>, the sub-folder that holds index.html')
  .option('--confirm', 'Consent to publish (without it, shows what would be published)')
  .option('--hold', 'Keep this build as a version but do NOT make it live — the owner makes it live after a look')
  .option('--json', 'Output JSON')
  .action(async (folder: string, opts) => {
    const json = isJsonOutput(opts);
    const abs = path.resolve(folder);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return fail(json, `Not a folder: ${folder}`);
    const read = readFolder(abs);
    const hasIndex = read.files.some((f) => f.path === 'index.html' || f.path.endsWith('/index.html'));
    if (!hasIndex) {
      return fail(json, 'No index.html in that folder — publish the BUILT app (run its build first; '
        + 'Vite/React write dist/, Create React App writes build/).', { skipped: read.skipped });
    }
    if (!opts.confirm) {
      const bytes = read.files.reduce((n, f) => n + Buffer.byteLength(f.content, f.encoding === 'base64' ? 'base64' : 'utf8'), 0);
      const plan = { would_publish: read.files.length, bytes, slug: opts.slug, skipped: read.skipped,
        next: `solid app publish ${folder} --slug ${opts.slug} --confirm` };
      if (json) return printJson(plan);
      console.log(`Would publish ${read.files.length} file(s), ${(bytes / 1024).toFixed(0)} KB, as '${opts.slug}'.`);
      for (const s of read.skipped.slice(0, 5)) console.log(chalk.dim(`  left out: ${s.path} (${s.why})`));
      console.log(chalk.dim(`Re-run with --confirm to publish.`));
      return;
    }
    // Zip locally, PUT it straight to storage, publish by reference: the bytes never
    // ride inside the API call (a write's arguments are stored on its proposal row and
    // cut off at 10 MB — a big inline publish failed on every door).
    let out: Record<string, any>;
    try {
      const zip = zipFolder(read.files);
      const up = await call('upload_url', {});
      if (up.ok === false) return done(json, up, () => undefined);
      const put = await fetch(up.upload_url, { method: 'PUT', headers: up.headers, body: zip });
      if (!put.ok) return fail(json, `Upload failed (${put.status}). Run it again — the link is good for an hour.`);
      out = await call('publish', {
        slug: opts.slug, upload_id: up.upload_id, confirm: true,
        ...(opts.root ? { root: opts.root } : {}), ...(opts.name ? { name: opts.name } : {}),
        ...(opts.hold ? { hold: true } : {}),
        ...buildSource(abs),
      });
    } catch (error) {
      return fail(json, handleApiError(error).message);
    }
    done(json, out, () => {
      if (out.held) {
        console.log(chalk.green(`✓ Kept as version ${out.held_version} — not live yet`));
        console.log(`  ${out.make_it_live}`);
      } else {
        console.log(chalk.green(`✓ Live: ${out.url}`));
        console.log(chalk.dim(`  version ${out.published_version ?? out.live_version} · link it from a site page with a button`));
      }
      for (const w of out.warnings || []) console.log(chalk.yellow(`  ⚠ ${w}`));
      // What nobody should have to ask us: how a change reaches the live app, and how
      // the app sends a lead. Both come from the server, worded for this app.
      if (out.keep_it_current) console.log(`\n${out.keep_it_current}`);
      if (out.send_a_lead) console.log(`\n${out.send_a_lead}`);
    });
  });

appCommand
  .command('list')
  .description('Apps this company has published')
  .option('--json', 'Output JSON')
  .action(async (opts) => {
    const json = isJsonOutput(opts);
    try {
      const out = await call('list', {});
      done(json, out, () => {
        if (!out.apps?.length) return console.log('No apps published yet — solid app publish <build-folder> --slug <name>');
        for (const a of out.apps) console.log(`${a.slug}  ${a.status}  v${a.live_version}  ${a.url ?? ''}`);
      });
    } catch (error) {
      fail(json, handleApiError(error).message);
    }
  });

appCommand
  .command('get <slug>')
  .description('One app: url, live version, kept versions, build warnings')
  .option('--json', 'Output JSON')
  .action(async (slug: string, opts) => {
    const json = isJsonOutput(opts);
    try {
      const out = await call('get', { slug });
      done(json, out, () => {
        console.log(`${out.slug}  ${out.status}  ${out.url ?? '(offline)'}`);
        for (const v of out.versions || []) {
          const mark = v.n === out.live_version ? ' (live)' : v.held ? ' (held — not live)' : '';
          const from = v.commit ? `  commit ${String(v.commit).slice(0, 12)}${v.repo ? ` of ${v.repo}` : ''}` : '';
          console.log(`  v${v.n}${mark}  ${v.published_at}  ${v.files} files  ${v.source}${from}`);
        }
        for (const w of out.warnings || []) console.log(chalk.yellow(`  ⚠ ${w}`));
        for (const h of out.outside_hosts || []) {
          if (h.kind !== 'solid') console.log(chalk.dim(`  depends on ${h.host} (${h.kind}, ${h.times}×)`));
        }
        if (out.how_updates_work) console.log(`\n${out.how_updates_work}`);
        if (out.send_a_lead) console.log(`\n${out.send_a_lead}`);
      });
    } catch (error) {
      fail(json, handleApiError(error).message);
    }
  });

appCommand
  .command('rollback <slug> <version>')
  .description('Put an earlier version live again (also brings an unpublished app back)')
  .option('--confirm', 'Consent to change what is live')
  .option('--json', 'Output JSON')
  .action(async (slug: string, version: string, opts) => {
    const json = isJsonOutput(opts);
    if (!opts.confirm) return fail(json, `Re-run with --confirm: solid app rollback ${slug} ${version} --confirm`);
    try {
      const out = await call('rollback', { slug, version: Number(version), confirm: true });
      done(json, out, () => console.log(chalk.green(`✓ ${slug} v${out.live_version} is live: ${out.url}`)));
    } catch (error) {
      fail(json, handleApiError(error).message);
    }
  });

appCommand
  .command('unpublish <slug>')
  .description('Take an app offline — every version is kept')
  .option('--confirm', 'Consent to take it offline')
  .option('--json', 'Output JSON')
  .action(async (slug: string, opts) => {
    const json = isJsonOutput(opts);
    if (!opts.confirm) return fail(json, `Re-run with --confirm: solid app unpublish ${slug} --confirm`);
    try {
      const out = await call('unpublish', { slug, confirm: true });
      done(json, out, () => console.log(chalk.green(`✓ ${slug} is offline. solid app rollback ${slug} <version> --confirm brings it back.`)));
    } catch (error) {
      fail(json, handleApiError(error).message);
    }
  });

/* ───────────────────────── solid app github ─────────────────────────
 *
 * ⛔ The build runs in the designer's OWN GitHub Actions, never on our servers,
 * and their code never leaves their repo except as the built files they publish.
 * That is why a PRIVATE repo needs nothing from us: no GitHub app, no access to
 * their account — one key with only `apps:write`, held as a repo secret.
 *
 * ⛔ WE NEVER PULL. Nothing on our side watches a repository; a push publishes.
 * So the one thing this command must get right is WHEN its workflow runs, and
 * that depends on the repo's shape. `inspectRepo` reads the shape; nobody is
 * asked for it. Trade Now's repo (2026-10-03) is why: the app lives in `app/`,
 * builds with pnpm, and its own workflow rebuilds `docs/` and commits it back.
 * A workflow that published `docs/` on push would have run BEFORE that rebuild
 * landed — always one version behind — and the bot's commit never triggers a
 * second push run (GitHub does not fire `push` for a GITHUB_TOKEN commit).
 */

export type Manager = 'npm' | 'pnpm' | 'yarn' | 'bun';
export type Mode = 'after_workflow' | 'committed' | 'build';

export interface RepoPlan {
  /** after_workflow: their workflow rebuilds the folder — publish when it finishes.
   *  committed: the built folder is in git and nothing rebuilds it — publish when it changes.
   *  build: build in the workflow, then publish. */
  mode: Mode;
  /** The BUILT folder, relative to the repo root. '' when none could be found. */
  folder: string;
  /** Where package.json lives, relative to the repo root ('' = the root). */
  appDir: string;
  manager: Manager | null;
  /** package.json names its package manager (`packageManager`), so the version comes from there. */
  managerPinned: boolean;
  /** Commands run in appDir, or null when nothing is built here. */
  install: string | null;
  build: string | null;
  /** A --build the caller gave: run as written, at the repo root. */
  customBuild: string | null;
  /** The workflow that rebuilds the folder (after_workflow only). */
  after: { name: string; file: string } | null;
  /** What was read, in plain words — shown to the person and to an agent. */
  found: string[];
  /** What stops this from working. Empty = ready. */
  problems: string[];
}

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'docs', 'public', 'coverage']);
const LIKELY_APP_DIRS = ['app', 'web', 'frontend', 'client', 'site', 'www'];

function readJson(file: string): Record<string, any> | null {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function hasBuildScript(dir: string): boolean {
  return Boolean(readJson(path.join(dir, 'package.json'))?.scripts?.build);
}

/** The folder holding the app's package.json: the root, else one level down. */
export function findAppDir(repoRoot: string): string | null {
  if (hasBuildScript(repoRoot)) return '';
  let names: string[] = [];
  try {
    names = fs.readdirSync(repoRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !SKIP_DIRS.has(d.name))
      .map((d) => d.name).sort();
  } catch { return null; }
  const with_build = names.filter((n) => hasBuildScript(path.join(repoRoot, n)));
  if (!with_build.length) return null;
  return LIKELY_APP_DIRS.find((n) => with_build.includes(n)) ?? with_build[0];
}

export function findManager(repoRoot: string, appDir: string): Manager {
  for (const dir of [path.join(repoRoot, appDir), repoRoot]) {
    if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
    if (fs.existsSync(path.join(dir, 'yarn.lock'))) return 'yarn';
    if (fs.existsSync(path.join(dir, 'bun.lockb')) || fs.existsSync(path.join(dir, 'bun.lock'))) return 'bun';
    if (fs.existsSync(path.join(dir, 'package-lock.json'))) return 'npm';
  }
  return 'npm';
}

function installCommand(m: Manager, repoRoot: string, appDir: string): string {
  if (m === 'pnpm') return 'pnpm install --frozen-lockfile';
  if (m === 'yarn') return 'yarn install --frozen-lockfile';
  if (m === 'bun') return 'bun install --frozen-lockfile';
  return fs.existsSync(path.join(repoRoot, appDir, 'package-lock.json')) ? 'npm ci' : 'npm install';
}

/** Vite's `outDir`, when the config sets one. */
function viteOutDir(dir: string): string | null {
  for (const f of ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs']) {
    try {
      const m = fs.readFileSync(path.join(dir, f), 'utf8').match(/outDir\s*:\s*["'`]([^"'`]+)["'`]/);
      if (m) return m[1];
    } catch { /* no such config */ }
  }
  return null;
}

function gitTracked(repoRoot: string, rel: string): boolean {
  return spawnSync('git', ['ls-files', '--error-unmatch', rel], { cwd: repoRoot, encoding: 'utf8' }).status === 0;
}

/** A workflow of THEIRS that rebuilds `folder` and commits it back. */
function rebuildingWorkflow(repoRoot: string, folder: string): { name: string; file: string } | null {
  const dir = path.join(repoRoot, '.github', 'workflows');
  let files: string[] = [];
  try { files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f) && !f.startsWith('solid-app-')).sort(); } catch { return null; }
  const top = folder.split('/')[0];
  const names = new RegExp(`(^|[\\s"'/])${top.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s"'/]|$)`, 'm');
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    if (!/git\s+push/.test(text) || !names.test(text)) continue;
    const name = text.match(/^name:\s*["']?(.+?)["']?\s*$/m)?.[1];
    // GitHub names an unnamed workflow by its path.
    return { name: name || `.github/workflows/${f}`, file: `.github/workflows/${f}` };
  }
  return null;
}

/** Read the repo's shape. Pure but for the disk and `tracked` (git by default). */
export function inspectRepo(repoRoot: string, opts: {
  folder?: string; build?: string; tracked?: (rel: string) => boolean;
} = {}): RepoPlan {
  const tracked = opts.tracked ?? ((rel: string) => gitTracked(repoRoot, rel));
  const found: string[] = [];
  const problems: string[] = [];

  const appDir = findAppDir(repoRoot);
  const at = appDir === null ? repoRoot : path.join(repoRoot, appDir);
  const pkg = appDir === null ? null : readJson(path.join(at, 'package.json'));
  const manager = appDir === null ? null : findManager(repoRoot, appDir);
  if (appDir !== null) {
    found.push(`the app's package.json is at ${appDir || 'the repo root'} (build script: ${pkg?.scripts?.build})`);
    found.push(`it installs with ${manager}`);
  } else {
    found.push('no package.json with a build script, so nothing is built here');
  }

  // The BUILT folder: given, else the first place an index.html already sits.
  let folder = (opts.folder || '').replace(/^\.\//, '').replace(/\/+$/, '');
  if (!folder) {
    const out = appDir !== null ? viteOutDir(at) : null;
    const rel = (d: string) => (appDir ? path.posix.join(appDir, d) : d);
    const candidates = [
      ...(out ? [path.posix.normalize(rel(out))] : []),
      'docs', rel('dist'), rel('build'), rel('out'), 'dist', 'build', 'out',
    ].filter((c, n, all) => !c.startsWith('..') && all.indexOf(c) === n);
    const built = candidates.filter((c) => fs.existsSync(path.join(repoRoot, c, 'index.html')));
    folder = built.find((c) => tracked(`${c}/index.html`)) ?? built[0] ?? '';
    if (folder) found.push(`the built app (index.html) is in ${folder}/`);
    else if (appDir !== null) {
      folder = out ? path.posix.normalize(rel(out)) : rel('dist');
      found.push(`no built folder on disk yet; the build writes ${folder}/ `
        + `(${out ? 'vite.config outDir' : 'Vite\'s default — pass --folder if yours differs'})`);
    } else {
      problems.push('No built app found: no folder with an index.html (looked in docs, dist, build, out) '
        + 'and no package.json to build one. Pass --folder <the folder with index.html>.');
    }
  }

  const committed = Boolean(folder) && tracked(`${folder}/index.html`);
  const after = committed ? rebuildingWorkflow(repoRoot, folder) : null;
  let mode: Mode = 'build';
  if (opts.build) {
    found.push(`builds with the command you gave: ${opts.build}`);
  } else if (after) {
    mode = 'after_workflow';
    found.push(`${folder}/ is committed, and your workflow "${after.name}" (${after.file}) rebuilds it and pushes it back`);
    found.push('so the publish runs when that workflow finishes — publishing on push would send the previous build');
  } else if (committed) {
    mode = 'committed';
    found.push(`${folder}/ is committed and nothing rebuilds it, so it is published as it is whenever it changes`);
  } else if (appDir === null && folder) {
    mode = 'committed';
    problems.push(`${folder}/ is not committed and there is nothing to build it. Commit it, or pass --build <command>.`);
  }

  const builds = mode === 'build' && !opts.build && appDir !== null && manager !== null;
  return {
    mode, folder, appDir: appDir ?? '', manager,
    managerPinned: Boolean(pkg?.packageManager),
    install: builds ? installCommand(manager!, repoRoot, appDir!) : null,
    build: builds ? `${manager} run build` : null,
    customBuild: opts.build ?? null,
    after, found, problems,
  };
}

/** The workflow `solid app github` writes. Pure — the tests read it back. */
export function workflowYaml(o: { slug: string; branch: string; plan: RepoPlan; review?: boolean }): string {
  const { plan } = o;
  const file = `solid-app-${o.slug}.yml`;
  const trigger = plan.mode === 'after_workflow'
    ? `  workflow_run:\n    workflows: [${JSON.stringify(plan.after!.name)}]\n    types: [completed]\n    branches: [${o.branch}]\n`
    : plan.mode === 'committed'
      ? `  push:\n    branches: [${o.branch}]\n    paths: ["${plan.folder}/**", ".github/workflows/${file}"]\n`
      : `  push:\n    branches: [${o.branch}]\n`;
  const gate = plan.mode === 'after_workflow'
    ? "    if: ${{ github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success' }}\n"
    : '';
  // After their workflow: the branch HEAD, which now holds the rebuilt folder.
  const checkout = plan.mode === 'after_workflow'
    ? `      - uses: actions/checkout@v4\n        with:\n          ref: ${o.branch}\n`
    : '      - uses: actions/checkout@v4\n';
  const node = '      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n';
  let build = '';
  if (plan.customBuild) {
    build = `${node}      - run: ${plan.customBuild}\n`;
  } else if (plan.build) {
    const wd = plan.appDir ? `        working-directory: ${plan.appDir}\n` : '';
    const pm = plan.manager === 'pnpm'
      ? '      - uses: pnpm/action-setup@v4\n        with:\n'
        + (plan.managerPinned
          ? `          package_json_file: ${plan.appDir ? `${plan.appDir}/` : ''}package.json\n`
          : '          version: latest\n')
      : plan.manager === 'bun' ? '      - uses: oven-sh/setup-bun@v2\n' : '';
    build = `${pm}${node}      - run: ${plan.install}\n${wd}      - run: ${plan.build}\n${wd}`;
  }
  const when = plan.mode === 'after_workflow' ? `each time "${plan.after!.name}" finishes on ${o.branch}`
    : plan.mode === 'committed' ? `each time ${plan.folder}/ changes on ${o.branch}`
      : `on every push to ${o.branch}`;
  const held = o.review
    ? '\n# REVIEW MODE: each build is kept as a version and is NOT live until the owner makes it live\n'
      + `# (Apps → Hosted → Make live, or: solid app rollback ${o.slug} <version> --confirm).`
    : '';
  return `# Publishes ${plan.folder}/ to Solid# as the app "${o.slug}" ${when}.${held}
# Written by \`solid app github\`. The key (secret SOLID_API_KEY) can only publish apps.
#
# For whoever (or whichever AI) reads this file later:
#  - Solid# never pulls from this repository. THIS workflow is the only thing that
#    updates the live app. If the live app is behind, check this workflow's last run.
#  - Which build is live, and from which commit:  npx -y @solidnumber/cli@latest app get ${o.slug}
#  - Put an earlier version back:  npx -y @solidnumber/cli@latest app rollback ${o.slug} <version> --confirm
#  - This repository can be private. GitHub Pages is not needed.
#  - Everything else:  npx -y @solidnumber/cli@latest app --help
name: Publish ${o.slug} to Solid#
on:
${trigger}  workflow_dispatch:
concurrency:
  group: solid-app-${o.slug}
  cancel-in-progress: false
jobs:
  publish:
${gate}    runs-on: ubuntu-latest
    steps:
${checkout}${build}      - run: npx -y @solidnumber/cli@latest app publish ${plan.folder} --slug ${o.slug} --confirm${o.review ? ' --hold' : ''}
        env:
          SOLID_API_KEY: \${{ secrets.SOLID_API_KEY }}
          NO_UPDATE_NOTIFIER: '1'
`;
}

appCommand
  .command('github')
  .description('Publish this repo\'s app on every change — private repos too. Run once, in the repo. Reads the repo itself: no flags needed but --slug.')
  .requiredOption('--slug <slug>', "The app's name in its address, e.g. sell")
  .option('--folder <folder>', 'The BUILT folder, relative to the repo root. Found for you when left out (docs, dist, build, out, or <app>/dist)')
  .option('--build <command>', 'Build command to run instead of the one found (run at the repo root)')
  .option('--branch <branch>', 'Branch to publish from', 'main')
  .option('--review', 'Each build waits for the owner: it is kept as a version and goes live only when they make it live')
  .option('--plan', 'Only show what was found and what would be written. Creates no key, writes no file')
  .option('--json', 'Output JSON')
  .action(async (opts) => {
    const json = isJsonOutput(opts);
    const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
    if (top.status !== 0) return fail(json, 'Run this inside the app\'s git repository.');
    const repoRoot = top.stdout.trim();
    const plan = inspectRepo(repoRoot, { folder: opts.folder, build: opts.build });
    const rel = path.posix.join('.github', 'workflows', `solid-app-${opts.slug}.yml`);
    if (plan.problems.length) {
      return fail(json, plan.problems[0], { found: plan.found, problems: plan.problems });
    }
    const yaml = workflowYaml({ slug: opts.slug, branch: opts.branch, plan, review: Boolean(opts.review) });
    const when = plan.mode === 'after_workflow' ? `each time "${plan.after!.name}" finishes`
      : plan.mode === 'committed' ? `each time ${plan.folder}/ changes` : `on every push to ${opts.branch}`;

    if (opts.plan) {
      const out = { ok: true, plan_only: true, mode: plan.mode, folder: plan.folder, app_dir: plan.appDir || '.',
        manager: plan.manager, publishes: when, review: Boolean(opts.review), found: plan.found,
        workflow: rel, workflow_yaml: yaml,
        next: `solid app github --slug ${opts.slug}${opts.folder ? ` --folder ${opts.folder}` : ''}` };
      if (json) return printJson(out);
      for (const f of plan.found) console.log(chalk.dim(`  · ${f}`));
      console.log(`Would write ${rel}: publishes ${plan.folder}/ ${when}.`);
      console.log(chalk.dim(`Run it for real: ${out.next}`));
      return;
    }

    // 1. a key that can only publish apps
    let key: string;
    let keyId: unknown;
    try {
      const repoName = path.basename(repoRoot);
      const res = await apiClient.apiKeyCreate(`github: ${repoName} → app ${opts.slug}`, ['apps:write']);
      key = (res.data as any).key;
      keyId = (res.data as any).api_key?.id;
    } catch (error) {
      return fail(json, `Could not create the publish key: ${handleApiError(error).message}`);
    }

    // 2. the key into the repo's secrets — straight from us to GitHub, never printed
    const gh = spawnSync('gh', ['secret', 'set', 'SOLID_API_KEY', '--body', key], { cwd: repoRoot, encoding: 'utf8' });
    const secretSet = gh.status === 0;

    // 3. the workflow
    const file = path.join(repoRoot, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, yaml);

    // The exact commands, in order. An agent runs them as written; nobody is asked anything.
    const steps = [
      ...(secretSet ? [] : ['gh secret set SOLID_API_KEY   # paste the key below when asked (or: repo Settings → Secrets and variables → Actions)']),
      `git add ${rel} && git commit -m "Publish ${opts.slug} to Solid# automatically" && git push`,
      `gh workflow run solid-app-${opts.slug}.yml   # publish the current build now`,
      `solid app get ${opts.slug}   # the live address, the version, the commit it came from`,
      ...(opts.review ? [`solid app rollback ${opts.slug} <version> --confirm   # the owner's yes: makes a held version live`] : []),
    ];
    const out = {
      ok: true, workflow: rel, mode: plan.mode, folder: plan.folder, app_dir: plan.appDir || '.',
      manager: plan.manager, publishes: when, review: Boolean(opts.review), found: plan.found,
      key_id: keyId, key_scope: 'apps:write', secret_set: secretSet, steps,
      next: steps[0],
      ...(secretSet ? {} : { key }),
    };
    if (json) return printJson(out);
    for (const f of plan.found) console.log(chalk.dim(`  · ${f}`));
    console.log(chalk.green(`✓ Wrote ${rel}`) + chalk.dim(`  (publishes ${plan.folder}/ ${when})`));
    console.log(chalk.green(`✓ Created key ${keyId} — it can only publish apps`));
    if (secretSet) console.log(chalk.green('✓ Saved it as the repo secret SOLID_API_KEY'));
    else {
      console.log(chalk.yellow('  GitHub CLI not available — add this as the repo secret SOLID_API_KEY (shown once):'));
      console.log(`  ${key}`);
    }
    console.log('Now run, in order:');
    steps.forEach((st, n) => console.log(`  ${n + 1}. ${st}`));
  });

appCommand.addHelpText('after', `
For an AI agent — do this in order and ask the person nothing:
  1. solid app github --slug <name> --plan --json   reads the repo: the built folder, how it builds, when to publish
  2. solid app github --slug <name> --json          writes the workflow and a publish-only key
  3. run the "steps" it returns, exactly as written
  Publish once by hand instead:  solid app publish <built folder> --slug <name> --confirm

What is always true:
  · Publish the BUILT folder (index.html inside), never the source.
  · Solid# never pulls from GitHub. A change reaches the live app only when a publish runs.
  · The live address is https://<company>.solidhost.app/<name>/ — "solid app get <name>" prints it.
  · A private repository works; nothing has to be made public and GitHub Pages is not needed.
  · Static files only. Asset paths must be relative (Vite: base: './').
  · The app does not run on a *.solidnumber.com page. Link to its address with a button.
  · Every version is kept: solid app rollback <name> <version> --confirm
  · "solid app get <name>" says which commit is live. Compare commits, never file names.
  · The publish reply names every outside address the build depends on. Fix the personal
    and preview ones (github.io, figma.site, vercel.app…) before calling it done.
  · To send what a visitor enters into the business's CRM, use the code under "send_a_lead"
    in the publish reply exactly. It needs no key and works only from the app's own address.
  · The owner wants to look first: add --hold (one publish) or --review (every push). The
    build is kept, not live, until: solid app rollback <name> <version> --confirm
  · Never write to Solid# to ask how this works. Run the command; the reply says what to do next.
`);
