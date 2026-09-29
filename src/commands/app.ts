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
      });
    } catch (error) {
      return fail(json, handleApiError(error).message);
    }
    done(json, out, () => {
      console.log(chalk.green(`✓ Live: ${out.url}`));
      console.log(chalk.dim(`  version ${out.published_version ?? out.live_version} · link it from a site page with a button`));
      for (const w of out.warnings || []) console.log(chalk.yellow(`  ⚠ ${w}`));
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
          console.log(`  v${v.n}${v.n === out.live_version ? ' (live)' : ''}  ${v.published_at}  ${v.files} files  ${v.source}`);
        }
        for (const w of out.warnings || []) console.log(chalk.yellow(`  ⚠ ${w}`));
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

/**
 * The workflow `solid app github` writes. Pure — the tests read it back.
 *
 * ⛔ The build runs in the designer's OWN GitHub Actions, never on our servers,
 * and their code never leaves their repo except as the built files they publish.
 * That is why a PRIVATE repo needs nothing from us: no GitHub app, no access to
 * their account — one key with only `apps:write`, held as a repo secret.
 */
export function workflowYaml(o: { slug: string; folder: string; build: string | null; branch: string }): string {
  const build = o.build
    ? `      - uses: actions/setup-node@v4\n        with:\n          node-version: 20\n      - run: ${o.build}\n`
    : '';
  return `# Publishes ${o.folder}/ to Solid# as the app "${o.slug}" on every push to ${o.branch}.
# Written by \`solid app github\`. The key (secret SOLID_API_KEY) can only publish apps.
name: Publish ${o.slug} to Solid#
on:
  push:
    branches: [${o.branch}]
  workflow_dispatch:
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
${build}      - run: npx -y @solidnumber/cli@latest app publish ${o.folder} --slug ${o.slug} --confirm
        env:
          SOLID_API_KEY: \${{ secrets.SOLID_API_KEY }}
          NO_UPDATE_NOTIFIER: '1'
`;
}

/** The build command a repo needs, or null when its build output is committed. */
export function detectBuild(repoRoot: string, folder: string): string | null {
  if (fs.existsSync(path.join(repoRoot, folder, 'index.html'))) return null; // built output is committed
  const pkgPath = path.join(repoRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (!pkg.scripts?.build) return null;
  } catch {
    return null;
  }
  const lock = fs.existsSync(path.join(repoRoot, 'package-lock.json'));
  return `${lock ? 'npm ci' : 'npm install'} && npm run build`;
}

appCommand
  .command('github')
  .description('Publish this repo\'s app on every push — private repos too. Run once, in the repo.')
  .requiredOption('--slug <slug>', "The app's name in its address, e.g. sell")
  .requiredOption('--folder <folder>', 'The BUILT folder, relative to the repo root (dist, build, docs)')
  .option('--build <command>', 'Build command (default: npm run build when package.json has one; none when the folder is committed)')
  .option('--branch <branch>', 'Branch to publish from', 'main')
  .option('--json', 'Output JSON')
  .action(async (opts) => {
    const json = isJsonOutput(opts);
    const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
    if (top.status !== 0) return fail(json, 'Run this inside the app\'s git repository.');
    const repoRoot = top.stdout.trim();
    const build = opts.build ?? detectBuild(repoRoot, opts.folder);
    const file = path.join(repoRoot, '.github', 'workflows', `solid-app-${opts.slug}.yml`);

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
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, workflowYaml({ slug: opts.slug, folder: opts.folder, build, branch: opts.branch }));

    const rel = path.relative(repoRoot, file);
    const out = {
      ok: true, workflow: rel, build, key_id: keyId, key_scope: 'apps:write', secret_set: secretSet,
      next: secretSet
        ? `Commit and push ${rel}. Every push to ${opts.branch} then publishes the app.`
        : `Add the key as a repository secret named SOLID_API_KEY (Settings → Secrets and variables → Actions), then commit and push ${rel}.`,
      ...(secretSet ? {} : { key }),
    };
    if (json) return printJson(out);
    console.log(chalk.green(`✓ Wrote ${rel}`) + chalk.dim(build ? `  (builds with: ${build})` : '  (publishes the committed folder)'));
    console.log(chalk.green(`✓ Created key ${keyId} — it can only publish apps`));
    if (secretSet) console.log(chalk.green('✓ Saved it as the repo secret SOLID_API_KEY'));
    else {
      console.log(chalk.yellow('  GitHub CLI not available — add this as the repo secret SOLID_API_KEY (shown once):'));
      console.log(`  ${key}`);
    }
    console.log(out.next);
  });
