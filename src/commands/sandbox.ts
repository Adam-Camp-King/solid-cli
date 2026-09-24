/**
 * Sandbox command for Solid CLI
 *
 * Isolated testing environment — fork the live site, make changes safely,
 * preview, diff, and promote to production when ready.
 *
 * solid sandbox create              → Fork current site into sandbox
 * solid sandbox status              → Show sandbox state and changes
 * solid sandbox diff                → Compare sandbox vs production
 * solid sandbox push                → Promote sandbox → production
 * solid sandbox reset               → Discard sandbox, back to production state
 *
 * Server-side (sandbox.* verbs — shared with HTTP-verb and MCP agents):
 * solid sandbox fork                → Stage page/asset changes on the server
 * solid sandbox preview             → Preview links for staged pages
 * solid sandbox promote             → Staged changes go live
 * solid sandbox exit                → Discard staged changes
 * `status` and `diff` report the server sandbox too.
 */

import { Command } from 'commander';
import ora from '../lib/spinner';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';
import { isJsonOutput, printJson } from '../lib/json-output';
import { getResolvedApiUrl } from '../lib/api-client';
import {
  VerbClient, SandboxStatus, sandboxStatus, sandboxFork, sandboxDiff, sandboxPromote, sandboxExit,
  scopeFromFlag, pageChanges, diffLines, absoluteUrl, NO_SANDBOX_MESSAGE,
} from '../lib/sandbox-verbs';

/** The company's server-side sandbox, or null when it cannot be read. */
async function serverSandbox(): Promise<(SandboxStatus & { changes?: number; lines?: string[] }) | null> {
  if (!config.isLoggedIn()) return null;
  try {
    const client = apiClient as unknown as VerbClient;
    const st = await sandboxStatus(client);
    if (!st.active) return st;
    const d = await sandboxDiff(client);
    return { ...st, changes: d.changes.length, lines: diffLines(d) };
  } catch {
    return null;
  }
}

const SANDBOX_DIR = '.sandbox';
const SANDBOX_META = '.sandbox/meta.json';

interface SandboxMeta {
  created_at: string;
  forked_from: string;         // directory that was forked
  company_id: number;
  company_name: string;
  original_manifest: any;      // manifest at fork time
}

export const sandboxCommand = new Command('sandbox')
  .description('Isolated sandbox for safe site editing');

// ── Create ──────────────────────────────────────────────────────────

sandboxCommand
  .command('create')
  .description('Fork current site into a sandbox')
  .option('--dir <path>', 'Working directory', process.cwd())
  .action(async (options) => {
    const dir = options.dir;
    const sandboxPath = path.join(dir, SANDBOX_DIR);
    const manifestPath = path.join(dir, '.solid', 'manifest.json');

    if (!fs.existsSync(manifestPath)) {
      console.error(chalk.red('No pulled site found. Run `solid pull` first.'));
      process.exit(1);
    }

    if (fs.existsSync(path.join(sandboxPath, 'meta.json'))) {
      console.error(chalk.red('Sandbox already exists. Run `solid sandbox reset` to discard it first.'));
      process.exit(1);
    }

    const spinner = ora('Creating sandbox...').start();
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    // Create sandbox directory
    fs.mkdirSync(sandboxPath, { recursive: true });

    // Copy pages/
    const pagesDir = path.join(dir, 'pages');
    const sandboxPages = path.join(sandboxPath, 'pages');
    if (fs.existsSync(pagesDir)) {
      fs.mkdirSync(sandboxPages, { recursive: true });
      for (const f of fs.readdirSync(pagesDir)) {
        fs.copyFileSync(path.join(pagesDir, f), path.join(sandboxPages, f));
      }
    }

    // Copy kb/
    const kbDir = path.join(dir, 'kb');
    const sandboxKb = path.join(sandboxPath, 'kb');
    if (fs.existsSync(kbDir)) {
      fs.mkdirSync(sandboxKb, { recursive: true });
      for (const f of fs.readdirSync(kbDir)) {
        fs.copyFileSync(path.join(kbDir, f), path.join(sandboxKb, f));
      }
    }

    // Copy config
    const configPath = path.join(dir, 'solid.config.json');
    if (fs.existsSync(configPath)) {
      fs.copyFileSync(configPath, path.join(sandboxPath, 'solid.config.json'));
    }

    // Save sandbox metadata
    const meta: SandboxMeta = {
      created_at: new Date().toISOString(),
      forked_from: dir,
      company_id: manifest.company_id,
      company_name: manifest.company_name,
      original_manifest: manifest,
    };
    fs.writeFileSync(path.join(sandboxPath, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');

    // Copy manifest
    fs.mkdirSync(path.join(sandboxPath, '.solid'), { recursive: true });
    fs.copyFileSync(manifestPath, path.join(sandboxPath, '.solid', 'manifest.json'));

    const pageCount = fs.existsSync(sandboxPages) ? fs.readdirSync(sandboxPages).filter(f => f.endsWith('.json')).length : 0;
    const kbCount = fs.existsSync(sandboxKb) ? fs.readdirSync(sandboxKb).filter(f => f.endsWith('.md')).length : 0;

    spinner.succeed('Sandbox created');
    console.log('');
    console.log(`  ${chalk.bold('Sandbox')} — ${manifest.company_name}`);
    console.log(`  ${chalk.dim('Pages:')} ${pageCount}  ${chalk.dim('KB:')} ${kbCount}`);
    console.log('');
    console.log(chalk.dim('  Edit files in .sandbox/ — your main files are untouched.'));
    console.log(chalk.dim('  solid sandbox status     See changes'));
    console.log(chalk.dim('  solid sandbox diff       Compare to production'));
    console.log(chalk.dim('  solid serve --dir .sandbox    Preview sandbox'));
    console.log(chalk.dim('  solid sandbox push       Promote to production'));
    console.log(chalk.dim('  solid sandbox reset      Discard sandbox'));
  });

// ── Status ──────────────────────────────────────────────────────────

sandboxCommand
  .command('status')
  .description('Show sandbox state and what changed')
  .option('--dir <path>', 'Working directory', process.cwd())
  .option('--json', 'Machine-readable output')
  .action(async (options) => {
    const dir = options.dir;
    const metaPath = path.join(dir, SANDBOX_META);

    const server = await serverSandbox();
    const serverLine = (): void => {
      if (!server?.active) return;
      console.log(`  ${chalk.bold('Server sandbox active')} ${chalk.dim(`since ${server.created_at || '?'}`)} — ${server.changes ?? 0} staged change(s)`);
      for (const l of (server.lines || []).slice(0, 20)) console.log(`    ${l}`);
      console.log(chalk.dim('  solid sandbox promote | solid sandbox exit'));
      console.log('');
    };

    if (!fs.existsSync(metaPath)) {
      // An agent needs "no sandbox" as a value, not as prose it has to parse.
      if (isJsonOutput(options)) { printJson({ active: Boolean(server?.active), changes: null, local: null, server }); return; }
      if (server?.active) { console.log(''); serverLine(); return; }
      console.log(chalk.dim('No active sandbox. `solid sandbox fork` stages server changes; `solid sandbox create` forks local files.'));
      return;
    }

    const meta: SandboxMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const sandboxPath = path.join(dir, SANDBOX_DIR);

    // Count changes
    let pagesChanged = 0;
    let pagesNew = 0;
    let kbChanged = 0;
    let kbNew = 0;

    // Compare sandbox pages vs original
    const sandboxPages = path.join(sandboxPath, 'pages');
    const origPages = path.join(dir, 'pages');
    if (fs.existsSync(sandboxPages)) {
      for (const f of fs.readdirSync(sandboxPages).filter(f => f.endsWith('.json'))) {
        const origFile = path.join(origPages, f);
        const sandboxFile = path.join(sandboxPages, f);
        if (!fs.existsSync(origFile)) {
          pagesNew++;
        } else if (fs.readFileSync(origFile, 'utf-8') !== fs.readFileSync(sandboxFile, 'utf-8')) {
          pagesChanged++;
        }
      }
    }

    // Compare sandbox kb vs original
    const sandboxKb = path.join(sandboxPath, 'kb');
    const origKb = path.join(dir, 'kb');
    if (fs.existsSync(sandboxKb)) {
      for (const f of fs.readdirSync(sandboxKb).filter(f => f.endsWith('.md'))) {
        const origFile = path.join(origKb, f);
        const sandboxFile = path.join(sandboxKb, f);
        if (!fs.existsSync(origFile)) {
          kbNew++;
        } else if (fs.readFileSync(origFile, 'utf-8') !== fs.readFileSync(sandboxFile, 'utf-8')) {
          kbChanged++;
        }
      }
    }

    const total = pagesChanged + pagesNew + kbChanged + kbNew;
    const age = Math.round((Date.now() - new Date(meta.created_at).getTime()) / 60000);

    if (isJsonOutput(options)) {
      printJson({
        active: true,
        company_name: meta.company_name,
        created_at: meta.created_at,
        age_minutes: age,
        changes: {
          pages_modified: pagesChanged,
          pages_added: pagesNew,
          kb_modified: kbChanged,
          kb_added: kbNew,
          total: pagesChanged + pagesNew + kbChanged + kbNew,
        },
        server,
      });
      return;
    }

    console.log('');
    console.log(`  ${chalk.bold('Sandbox Active')} — ${meta.company_name}`);
    console.log(`  ${chalk.dim('Created:')} ${age < 60 ? `${age}m ago` : `${Math.round(age / 60)}h ago`}`);
    console.log('');
    if (total === 0) {
      console.log(chalk.dim('  No changes yet. Edit files in .sandbox/ to get started.'));
    } else {
      if (pagesChanged) console.log(`  ${chalk.yellow(`${pagesChanged} page(s) modified`)}`);
      if (pagesNew) console.log(`  ${chalk.green(`${pagesNew} page(s) added`)}`);
      if (kbChanged) console.log(`  ${chalk.yellow(`${kbChanged} KB entry(ies) modified`)}`);
      if (kbNew) console.log(`  ${chalk.green(`${kbNew} KB entry(ies) added`)}`);
      console.log('');
      console.log(chalk.dim('  solid sandbox push   Promote these changes to production'));
    }
    console.log('');
    serverLine();
  });

// ── Diff ────────────────────────────────────────────────────────────

sandboxCommand
  .command('diff')
  .description('Show what the sandbox changed: server-side staged pages/assets, and local .sandbox/ files')
  .option('--dir <path>', 'Working directory', process.cwd())
  .option('--json', 'Machine-readable output (server-side sandbox)')
  .action(async (options) => {
    const dir = options.dir;
    const sandboxPath = path.join(dir, SANDBOX_DIR);
    const hasLocal = fs.existsSync(path.join(sandboxPath, 'meta.json'));

    // Server-side sandbox first — it is what fork/promote/exit act on.
    let serverDiff: Awaited<ReturnType<typeof sandboxDiff>> | null = null;
    if (config.isLoggedIn()) {
      try {
        serverDiff = await sandboxDiff(apiClient as unknown as VerbClient);
      } catch (error) {
        if (!hasLocal) {
          if (isJsonOutput(options)) printJson({ ok: false, error: handleApiError(error).message });
          else console.error(chalk.red(handleApiError(error).message));
          process.exit(1);
        }
      }
    }
    const serverActive = Boolean(serverDiff && serverDiff.status !== 'no_sandbox');
    if (isJsonOutput(options)) {
      printJson({ active: serverActive || hasLocal, server: serverActive ? serverDiff : null, local_sandbox: hasLocal });
      return;
    }
    if (serverActive && serverDiff) {
      const lines = diffLines(serverDiff);
      console.log(chalk.bold(`Server sandbox — ${lines.length} staged change(s)`));
      for (const l of lines) console.log(l.startsWith('+') ? chalk.green(l) : chalk.yellow(l));
      if (hasLocal) console.log('');
    }
    if (!hasLocal) {
      if (!serverActive) {
        console.error(chalk.red('No active sandbox.'));
        process.exit(1);
      }
      return;
    }
    console.log(chalk.bold('Local .sandbox/ files'));

    // Compare sandbox pages to original pages
    const sandboxPages = path.join(sandboxPath, 'pages');
    const origPages = path.join(dir, 'pages');

    if (fs.existsSync(sandboxPages)) {
      for (const f of fs.readdirSync(sandboxPages).filter(f => f.endsWith('.json'))) {
        const origFile = path.join(origPages, f);
        const sandboxFile = path.join(sandboxPages, f);

        if (!fs.existsSync(origFile)) {
          console.log(chalk.green(`+ pages/${f}`) + chalk.dim(' (new)'));
          continue;
        }

        const orig = fs.readFileSync(origFile, 'utf-8');
        const sandbox = fs.readFileSync(sandboxFile, 'utf-8');

        if (orig !== sandbox) {
          try {
            const origJson = JSON.parse(orig);
            const sandboxJson = JSON.parse(sandbox);
            const changes: string[] = [];

            for (const key of Object.keys(sandboxJson)) {
              if (['_id', 'id', 'updated_at', 'created_at'].includes(key)) continue;
              if (JSON.stringify(origJson[key]) !== JSON.stringify(sandboxJson[key])) {
                changes.push(key);
              }
            }

            console.log(chalk.yellow(`~ pages/${f}`) + chalk.dim(` (${changes.length} fields: ${changes.join(', ')})`));
          } catch {
            console.log(chalk.yellow(`~ pages/${f}`) + chalk.dim(' (content changed)'));
          }
        }
      }
    }

    // Compare sandbox KB
    const sandboxKb = path.join(sandboxPath, 'kb');
    const origKb = path.join(dir, 'kb');

    if (fs.existsSync(sandboxKb)) {
      for (const f of fs.readdirSync(sandboxKb).filter(f => f.endsWith('.md'))) {
        const origFile = path.join(origKb, f);
        const sandboxFile = path.join(sandboxKb, f);

        if (!fs.existsSync(origFile)) {
          console.log(chalk.green(`+ kb/${f}`) + chalk.dim(' (new)'));
        } else if (fs.readFileSync(origFile, 'utf-8') !== fs.readFileSync(sandboxFile, 'utf-8')) {
          console.log(chalk.yellow(`~ kb/${f}`) + chalk.dim(' (content changed)'));
        }
      }
    }
  });

// ── Push (promote sandbox → production) ─────────────────────────────

sandboxCommand
  .command('push')
  .description('Promote sandbox changes to production (copies sandbox → main, then pushes)')
  .option('--dir <path>', 'Working directory', process.cwd())
  .action(async (options) => {
    const dir = options.dir;
    const sandboxPath = path.join(dir, SANDBOX_DIR);

    if (!fs.existsSync(path.join(sandboxPath, 'meta.json'))) {
      console.error(chalk.red('No active sandbox.'));
      process.exit(1);
    }

    const spinner = ora('Promoting sandbox to main files...').start();

    // Copy sandbox files back to main
    const sandboxPages = path.join(sandboxPath, 'pages');
    const mainPages = path.join(dir, 'pages');
    if (fs.existsSync(sandboxPages)) {
      if (!fs.existsSync(mainPages)) fs.mkdirSync(mainPages, { recursive: true });
      for (const f of fs.readdirSync(sandboxPages)) {
        fs.copyFileSync(path.join(sandboxPages, f), path.join(mainPages, f));
      }
    }

    const sandboxKb = path.join(sandboxPath, 'kb');
    const mainKb = path.join(dir, 'kb');
    if (fs.existsSync(sandboxKb)) {
      if (!fs.existsSync(mainKb)) fs.mkdirSync(mainKb, { recursive: true });
      for (const f of fs.readdirSync(sandboxKb)) {
        fs.copyFileSync(path.join(sandboxKb, f), path.join(mainKb, f));
      }
    }

    const sandboxConfig = path.join(sandboxPath, 'solid.config.json');
    if (fs.existsSync(sandboxConfig)) {
      fs.copyFileSync(sandboxConfig, path.join(dir, 'solid.config.json'));
    }

    spinner.succeed('Sandbox promoted to main files');
    console.log('');
    console.log(chalk.dim('  Run `solid push` to deploy to production.'));
    console.log(chalk.dim('  Run `solid sandbox reset` to clean up the sandbox.'));
  });

// ── Reset ───────────────────────────────────────────────────────────

sandboxCommand
  .command('reset')
  .description('Discard sandbox and all changes')
  .option('--dir <path>', 'Working directory', process.cwd())
  .action(async (options) => {
    const dir = options.dir;
    const sandboxPath = path.join(dir, SANDBOX_DIR);

    if (!fs.existsSync(sandboxPath)) {
      console.log(chalk.dim('No sandbox to reset.'));
      return;
    }

    // Recursively delete sandbox directory
    fs.rmSync(sandboxPath, { recursive: true, force: true });

    console.log(chalk.green('Sandbox discarded. Main files unchanged.'));
  });

// ── Server-side sandbox (fork / preview / promote / exit) ──────────────
//
// ⛔ These used to call /api/v1/sandbox/{status,enabled,publish,exit}, which
// resolve the tenant from the Host header and 404 "No tenant found for this
// domain" through api.solidnumber.com — for every company. They now use the
// sandbox.* agent verbs (src/lib/sandbox-verbs.ts), the same sandbox HTTP-verb
// and MCP agents use. While it is active, page and asset writes from ANY
// transport are staged in it: new pages stay unpublished, edits to existing
// pages land as drafts, publishes wait for promote.

function requireLogin(): void {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
}

function serverFail(spinner: { fail: (m: string) => void } | null, label: string, error: unknown, json: boolean): never {
  const msg = handleApiError(error).message;
  if (json) {
    printJson({ ok: false, error: msg });
  } else {
    spinner?.fail(chalk.red(label));
    console.error(msg);
  }
  process.exit(1);
}

sandboxCommand
  .command('fork')
  .description('Start a server-side sandbox: page/asset changes from any tool are staged until promote or exit')
  .option('--scope <scope>', 'Sandbox scope: pages, data, or all (default: all)', 'all')
  .option('--json', 'Machine-readable output')
  .action(async (opts: any) => {
    requireLogin();
    const json = isJsonOutput(opts);
    let scope: Record<string, boolean> | null;
    try {
      scope = scopeFromFlag(opts.scope);
    } catch (e) {
      if (json) printJson({ ok: false, error: (e as Error).message });
      else console.error(chalk.red((e as Error).message));
      process.exit(1);
    }
    const spinner = json ? null : ora('Forking company into sandbox...').start();
    try {
      const res = await sandboxFork(apiClient as unknown as VerbClient, scope) as Record<string, any>;
      if (json) { printJson({ ok: true, ...res }); return; }
      if (res.status === 'already_active') {
        spinner?.warn(chalk.yellow('Sandbox already active'));
        console.log(chalk.dim('  Run `solid sandbox promote` to push changes, or `solid sandbox exit` to discard.'));
        return;
      }
      spinner?.succeed(chalk.green('Sandbox forked'));
      console.log('');
      console.log(chalk.dim('  Page and asset changes are now staged. The live site is untouched.'));
      console.log(chalk.dim('  solid sandbox diff       See what changed'));
      console.log(chalk.dim('  solid sandbox preview    Preview links for changed pages'));
      console.log(chalk.dim('  solid sandbox promote    Push to production'));
      console.log(chalk.dim('  solid sandbox exit       Discard all changes'));
      console.log('');
    } catch (error) {
      serverFail(spinner, 'Failed to fork', error, json);
    }
  });

sandboxCommand
  .command('preview')
  .description('Preview links for the pages changed in the active server-side sandbox')
  .option('--ttl <hours>', 'Link lifetime in hours (1-168)', '24')
  .option('--json', 'Machine-readable output')
  .action(async (opts: any) => {
    requireLogin();
    const json = isJsonOutput(opts);
    const spinner = json ? null : ora('Generating preview...').start();
    try {
      const client = apiClient as unknown as VerbClient;
      const status = await sandboxStatus(client);
      if (!status.active) {
        // ⛔ This used to print a URL anyway. No sandbox = nothing to preview.
        if (json) printJson({ ok: false, active: false, error: NO_SANDBOX_MESSAGE });
        else { spinner?.fail(chalk.red('No active sandbox')); console.error(NO_SANDBOX_MESSAGE); }
        process.exit(1);
      }
      const pages = pageChanges(await sandboxDiff(client));
      const ttl = Math.min(168, Math.max(1, parseInt(opts.ttl, 10) || 24));
      const base = getResolvedApiUrl();
      const links: Array<Record<string, unknown>> = [];
      for (const p of pages) {
        const r = (await apiClient.post(`/api/v1/cms/pages/${p.entity_id}/preview-link?ttl_hours=${ttl}`)).data as Record<string, any>;
        links.push({
          page_id: p.entity_id, slug: p.slug ?? null, change: p.change ?? null,
          url: absoluteUrl(base, String(r.preview_url || '')), expires_at: r.expires_at ?? null,
        });
      }
      if (json) { printJson({ ok: true, active: true, previews: links }); return; }
      if (!links.length) {
        spinner?.warn(chalk.yellow('Sandbox active, but no page changes yet'));
        return;
      }
      spinner?.succeed(chalk.green(`${links.length} preview link(s)`));
      console.log('');
      for (const l of links) {
        console.log(`  ${chalk.bold(`#${l.page_id}`)} ${l.slug ? `/${l.slug}` : ''} ${chalk.dim(`(${l.change})`)}`);
        console.log(`    ${chalk.cyan(String(l.url))}`);
      }
      console.log('');
    } catch (error) {
      serverFail(spinner, 'Failed to create preview', error, json);
    }
  });

sandboxCommand
  .command('promote')
  .description('Push the server-side sandbox to production')
  .option('--json', 'Machine-readable output')
  .action(async (opts: any) => {
    requireLogin();
    const json = isJsonOutput(opts);
    const spinner = json ? null : ora('Promoting sandbox to production...').start();
    try {
      const res = await sandboxPromote(apiClient as unknown as VerbClient) as Record<string, any>;
      if (res.status === 'no_sandbox') {
        if (json) printJson({ ok: false, ...res, error: 'No active sandbox to promote.' });
        else { spinner?.fail(chalk.red('No active sandbox to promote')); }
        process.exit(1);
      }
      if (json) { printJson({ ok: true, ...res }); return; }
      spinner?.succeed(chalk.green('Sandbox promoted to production'));
      if (res.summary) console.log(chalk.dim(`  ${res.summary}`));
      for (const f of res.pages_failed || []) {
        console.log(chalk.yellow(`  page #${f.page_id} not published: ${typeof f.error === 'string' ? f.error : JSON.stringify(f.error)}`));
      }
      console.log('');
    } catch (error) {
      serverFail(spinner, 'Failed to promote', error, json);
    }
  });

sandboxCommand
  .command('exit')
  .description('Discard the server-side sandbox (delete sandbox-only pages/assets, revert staged edits)')
  .option('--json', 'Machine-readable output')
  .action(async (opts: any) => {
    requireLogin();
    const json = isJsonOutput(opts);
    const spinner = json ? null : ora('Exiting sandbox...').start();
    try {
      const res = await sandboxExit(apiClient as unknown as VerbClient) as Record<string, any>;
      if (res.status === 'no_sandbox') {
        if (json) printJson({ ok: false, ...res, error: 'No active sandbox to exit.' });
        else { spinner?.fail(chalk.red('No active sandbox to exit')); }
        process.exit(1);
      }
      if (json) { printJson({ ok: true, ...res }); return; }
      spinner?.succeed(chalk.green('Sandbox discarded. Back to production.'));
      if (res.summary) console.log(chalk.dim(`  ${res.summary}`));
    } catch (error) {
      serverFail(spinner, 'Failed', error, json);
    }
  });


import { appendExamples as __ae_sandbox } from '../lib/command-kit';
__ae_sandbox(sandboxCommand, [
  { cmd: 'solid sandbox create',               why: 'Isolated copy of your site for safe edits' },
  { cmd: 'solid sandbox diff',                 why: 'What differs between sandbox and live' },
  { cmd: 'solid sandbox push',                 why: 'Sync local changes into the sandbox' },
  { cmd: 'solid sandbox promote --yes',        why: 'Merge sandbox → production (prompts by default)' },
  { cmd: 'solid sandbox reset',                why: 'Throw away sandbox changes' },
]);
