/**
 * solid dev — Custom module development lifecycle (T3)
 *
 * Wraps /api/v1/modules/* — the company-scoped dev loop:
 *   solid dev module create <name>             scaffold + register
 *   solid dev module list                       what your company has
 *   solid dev module pull <folder> [--out dir]  download files
 *   solid dev module push <folder> [--from dir] upload files
 *   solid dev module deploy <folder>            validate + reload + enable
 *   solid dev module validate <folder>          lint without deploy
 *   solid dev module disable <folder>           keep on disk, take offline
 *   solid dev module delete <folder>            permanent
 *   solid dev module routes <folder>            list mounted routes
 *
 * Predecessor: hit fictional /api/v1/sandbox/* endpoints. Now real.
 * See: Owners-Manual/15-AI-Sandbox-Engine/05-SOLID-DEV-CLI.md
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';

function requireAuth(): void {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
}

function fail(spinner: ReturnType<typeof ora>, msg: string, error: unknown): void {
  spinner.fail(chalk.red(msg));
  console.error(chalk.red(`  ${handleApiError(error).message}`));
}

export const devCommand = new Command('dev')
  .description('Custom module development — scaffold, push, deploy code that runs in Solid# scoped to your company');

// All subcommands hang off `solid dev module <verb>` to match the sprint
// doc and make the namespace clear.
const moduleCmd = new Command('module').description('Module lifecycle (scaffold/push/deploy/...)');

// ─── create ──────────────────────────────────────────────────────────

moduleCmd
  .command('create <name>')
  .description('Scaffold a new module — creates folder + manifest + skeleton routes.py + tests')
  .option('--description <text>', 'One-line description')
  .option('--author <name>', 'Author / agency name')
  .option('--out <dir>', 'Local directory to also pull files into', '.')
  .option('--json', 'Output as JSON')
  .action(async (name, opts) => {
    requireAuth();
    const spinner = ora(`Scaffolding module "${name}"...`).start();
    try {
      const body: Record<string, unknown> = { module_name: name };
      if (opts.description) body.description = opts.description;
      if (opts.author) body.author = opts.author;
      const res = await apiClient.post('/api/v1/modules/scaffold', body);
      const r = res.data as Record<string, any>;
      if (opts.json) { spinner.stop(); console.log(JSON.stringify(r, null, 2)); return; }
      spinner.succeed(chalk.green(`Scaffolded ${r.folder_name}`));
      console.log('');
      console.log(`  ${chalk.bold('Folder:')}     ${r.folder_name}`);
      console.log(`  ${chalk.bold('Module:')}     ${r.module_name}`);
      console.log(`  ${chalk.bold('Company:')}    ${r.company_id}`);
      console.log(`  ${chalk.bold('Files:')}      ${(r.files || []).length}`);
      console.log('');
      for (const step of (r.next_steps || []) as string[]) {
        console.log(chalk.dim(`  ${step}`));
      }
      // Also pull immediately if --out given
      if (opts.out) {
        console.log('');
        await pullModuleToDisk(r.folder_name, opts.out);
      }
    } catch (error) { fail(spinner, 'Scaffold failed', error); }
  });

// ─── list ────────────────────────────────────────────────────────────

moduleCmd
  .command('list')
  .description('List custom modules for the authenticated company')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading modules...').start();
    try {
      const res = await apiClient.get('/api/v1/modules');
      const items = (res.data as Record<string, any>[]) ?? [];
      if (opts.json) { spinner.stop(); console.log(JSON.stringify(items, null, 2)); return; }
      spinner.succeed(chalk.green(`${items.length} module(s)`));
      if (!items.length) {
        console.log('');
        console.log(chalk.dim('  No modules yet. Try: solid dev module create <name>'));
        return;
      }
      console.log('');
      for (const m of items) {
        const dot = m.enabled ? chalk.green('●') : chalk.dim('○');
        console.log(`  ${dot} ${chalk.bold(m.folder_name)}  v${m.version}  ${chalk.dim(`${m.route_count} routes @ ${m.route_prefix}`)}`);
        if (m.description) console.log(`      ${chalk.dim(m.description)}`);
      }
    } catch (error) { fail(spinner, 'List failed', error); }
  });

// ─── routes ──────────────────────────────────────────────────────────

moduleCmd
  .command('routes <module_name>')
  .description('List mounted routes for one of your modules')
  .option('--json', 'Output as JSON')
  .action(async (moduleName, opts) => {
    requireAuth();
    const spinner = ora('Loading routes...').start();
    try {
      const res = await apiClient.get(`/api/v1/modules/${moduleName}/routes`);
      const r = res.data as Record<string, any>;
      if (opts.json) { spinner.stop(); console.log(JSON.stringify(r, null, 2)); return; }
      spinner.succeed(chalk.green(`${r.count ?? 0} route(s)`));
      for (const route of r.routes || []) {
        const methods = (route.methods || []).join(',');
        console.log(`  ${chalk.cyan(methods.padEnd(8))}  ${route.path}`);
      }
    } catch (error) { fail(spinner, 'Failed to load routes', error); }
  });

// ─── pull ────────────────────────────────────────────────────────────

async function pullModuleToDisk(folderName: string, outDir: string): Promise<void> {
  const spinner = ora(`Pulling ${folderName}...`).start();
  try {
    const listRes = await apiClient.get(`/api/v1/modules/${folderName}/source`);
    const data = listRes.data as Record<string, any>;
    const files = (data.files || []) as Array<{ path: string }>;
    const target = path.resolve(outDir, folderName);
    fs.mkdirSync(target, { recursive: true });
    for (const f of files) {
      const fileRes = await apiClient.get(`/api/v1/modules/${folderName}/source/${f.path}`);
      const fr = fileRes.data as Record<string, any>;
      const localPath = path.join(target, f.path);
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(localPath, fr.content ?? '');
    }
    spinner.succeed(chalk.green(`Pulled ${files.length} file(s) → ${target}`));
  } catch (error) {
    spinner.fail(chalk.red(`Pull failed`));
    console.error(chalk.red(`  ${handleApiError(error).message}`));
  }
}

moduleCmd
  .command('pull <folder>')
  .description('Download module source files to disk')
  .option('--out <dir>', 'Parent directory (folder created inside)', '.')
  .action(async (folder, opts) => {
    requireAuth();
    await pullModuleToDisk(folder, opts.out);
  });

// ─── push ────────────────────────────────────────────────────────────

const PUSH_ALLOWED_EXT = new Set([
  '.py', '.json', '.md', '.txt', '.yaml', '.yml',
  '.ts', '.tsx', '.js', '.jsx', '.css', '.scss', '.html',
]);

function walkFiles(root: string, base: string = ''): Array<{ rel: string; abs: string }> {
  const out: Array<{ rel: string; abs: string }> = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === '__pycache__' || entry.name === 'node_modules') continue;
    const abs = path.join(root, entry.name);
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...walkFiles(abs, rel));
    } else if (entry.isFile()) {
      if (PUSH_ALLOWED_EXT.has(path.extname(entry.name))) {
        out.push({ rel, abs });
      }
    }
  }
  return out;
}

moduleCmd
  .command('push <folder>')
  .description('Upload local files for a module to the server (mirrors source tree)')
  .option('--from <dir>', 'Local source directory (defaults to ./<folder>)')
  .action(async (folder, opts) => {
    requireAuth();
    const fromDir = path.resolve(opts.from || `./${folder}`);
    if (!fs.existsSync(fromDir) || !fs.statSync(fromDir).isDirectory()) {
      console.error(chalk.red(`Local directory not found: ${fromDir}`));
      process.exit(1);
    }
    const files = walkFiles(fromDir);
    if (files.length === 0) {
      console.error(chalk.red('No pushable files found (allowed: .py .json .md .ts .tsx .js .jsx .css .html .yaml).'));
      process.exit(1);
    }
    const spinner = ora(`Pushing ${files.length} file(s) to ${folder}...`).start();
    let pushed = 0;
    let failed = 0;
    for (const f of files) {
      try {
        const content = fs.readFileSync(f.abs, 'utf-8');
        await apiClient.put(`/api/v1/modules/${folder}/source/${f.rel}`, { content });
        pushed += 1;
        spinner.text = `Pushing... ${pushed}/${files.length} (${f.rel})`;
      } catch (error) {
        failed += 1;
        spinner.text = `${f.rel}: ${handleApiError(error).message}`;
      }
    }
    if (failed === 0) {
      spinner.succeed(chalk.green(`Pushed ${pushed} file(s)`));
    } else {
      spinner.warn(chalk.yellow(`Pushed ${pushed}, ${failed} failed`));
    }
  });

// ─── validate ────────────────────────────────────────────────────────

moduleCmd
  .command('validate <folder>')
  .description('Validate module without deploying — surfaces errors + warnings')
  .option('--json', 'Output as JSON')
  .action(async (folder, opts) => {
    requireAuth();
    const spinner = ora('Validating...').start();
    try {
      const res = await apiClient.get(`/api/v1/modules/admin/validate/${folder}`);
      const r = res.data as Record<string, any>;
      if (opts.json) { spinner.stop(); console.log(JSON.stringify(r, null, 2)); return; }
      if (r.valid) {
        spinner.succeed(chalk.green('Valid'));
      } else {
        spinner.fail(chalk.red(`${r.error_count} error(s)`));
      }
      for (const e of r.errors || []) console.log(`  ${chalk.red('✖')} ${chalk.dim(e.checkpoint)}: ${e.message}`);
      for (const w of r.warnings || []) console.log(`  ${chalk.yellow('⚠')} ${chalk.dim(w.checkpoint)}: ${w.message}`);
    } catch (error) { fail(spinner, 'Validate failed', error); }
  });

// ─── deploy ──────────────────────────────────────────────────────────

moduleCmd
  .command('deploy <folder>')
  .description('Validate + set enabled=true + hot-reload — module goes live at /api/v1/custom/<name>/*')
  .option('--json', 'Output as JSON')
  .action(async (folder, opts) => {
    requireAuth();
    const spinner = ora(`Deploying ${folder}...`).start();
    try {
      const res = await apiClient.post(`/api/v1/modules/${folder}/deploy`);
      const r = res.data as Record<string, any>;
      if (opts.json) { spinner.stop(); console.log(JSON.stringify(r, null, 2)); return; }
      if (!r.deployed) {
        spinner.fail(chalk.red(`Deploy blocked — ${(r.errors || []).length} validation error(s)`));
        for (const e of r.errors || []) console.log(`  ${chalk.red('✖')} ${chalk.dim(e.checkpoint)}: ${e.message}`);
        process.exit(1);
      }
      spinner.succeed(chalk.green(`Deployed ${r.module_name} v${r.version}`));
      console.log('');
      console.log(`  ${chalk.bold('Mounted at:')} ${chalk.cyan(r.route_prefix + '/*')}`);
      console.log(`  ${chalk.bold('Routes:')}     ${r.route_count}`);
      for (const w of r.warnings || []) console.log(`  ${chalk.yellow('⚠')} ${w.checkpoint}: ${w.message}`);
    } catch (error) { fail(spinner, 'Deploy failed', error); }
  });

// ─── disable ─────────────────────────────────────────────────────────

moduleCmd
  .command('disable <folder>')
  .description('Take a module offline without deleting (manifest enabled=false)')
  .action(async (folder) => {
    requireAuth();
    const spinner = ora(`Disabling ${folder}...`).start();
    try {
      await apiClient.post(`/api/v1/modules/admin/${folder}/disable`);
      spinner.succeed(chalk.green(`${folder} disabled`));
    } catch (error) { fail(spinner, 'Disable failed', error); }
  });

// ─── delete ──────────────────────────────────────────────────────────

moduleCmd
  .command('delete <folder>')
  .description('Permanently delete a module from disk and unload it. Cannot be undone.')
  .action(async (folder) => {
    requireAuth();
    const spinner = ora(`Deleting ${folder}...`).start();
    try {
      await apiClient.delete(`/api/v1/modules/${folder}`);
      spinner.succeed(chalk.green(`${folder} deleted`));
    } catch (error) { fail(spinner, 'Delete failed', error); }
  });

devCommand.addCommand(moduleCmd);
