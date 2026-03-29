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
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../lib/config';
import { ui } from '../lib/ui';

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
  .action(async (options) => {
    const dir = options.dir;
    const metaPath = path.join(dir, SANDBOX_META);

    if (!fs.existsSync(metaPath)) {
      console.log(chalk.dim('No active sandbox. Run `solid sandbox create` to start one.'));
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
  });

// ── Diff ────────────────────────────────────────────────────────────

sandboxCommand
  .command('diff')
  .description('Compare sandbox files to original (pre-fork) state')
  .option('--dir <path>', 'Working directory', process.cwd())
  .action(async (options) => {
    const dir = options.dir;
    const sandboxPath = path.join(dir, SANDBOX_DIR);

    if (!fs.existsSync(path.join(sandboxPath, 'meta.json'))) {
      console.error(chalk.red('No active sandbox.'));
      process.exit(1);
    }

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
