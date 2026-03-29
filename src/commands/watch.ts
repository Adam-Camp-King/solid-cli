/**
 * Watch command for Solid CLI
 *
 * Watches local files for changes and auto-pushes to production.
 * Like `solid push` on every save.
 *
 * solid watch                → Watch and auto-push all changes
 * solid watch --pages-only   → Only watch pages/
 * solid watch --kb-only      → Only watch kb/
 * solid watch --delay 3000   → Debounce delay in ms (default 2000)
 * solid watch --dry-run      → Show what would push, don't push
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';

interface PushResult {
  file: string;
  action: 'created' | 'updated' | 'skipped';
  error?: string;
}

export const watchCommand = new Command('watch')
  .description('Watch local files and auto-push changes to production')
  .option('--dir <path>', 'Working directory', process.cwd())
  .option('--pages-only', 'Only watch pages/')
  .option('--kb-only', 'Only watch kb/')
  .option('--delay <ms>', 'Debounce delay in milliseconds', '2000')
  .option('--dry-run', 'Show what would be pushed without pushing')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const dir = options.dir;
    const delay = parseInt(options.delay);
    const manifestPath = path.join(dir, '.solid', 'manifest.json');

    if (!fs.existsSync(manifestPath)) {
      console.error(chalk.red('No .solid/manifest.json found. Run `solid pull` first.'));
      process.exit(1);
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const companyId = manifest.company_id;

    console.log('');
    console.log(chalk.bold('  Solid# File Watcher'));
    console.log(chalk.dim(`  Company: ${manifest.company_name} (ID ${companyId})`));
    console.log(chalk.dim(`  Debounce: ${delay}ms`));
    if (options.dryRun) console.log(chalk.yellow('  DRY RUN — no changes will be pushed'));
    console.log('');

    // Track pending changes with debounce
    let pendingFiles = new Set<string>();
    let debounceTimer: NodeJS.Timeout | null = null;

    async function processPendingChanges() {
      const files = Array.from(pendingFiles);
      pendingFiles.clear();

      for (const filePath of files) {
        if (!fs.existsSync(filePath)) {
          console.log(chalk.red(`  [deleted] ${path.relative(dir, filePath)}`));
          continue;
        }

        const relative = path.relative(dir, filePath);
        const isPage = relative.startsWith('pages/') && relative.endsWith('.json');
        const isKb = relative.startsWith('kb/') && relative.endsWith('.md');
        const isConfig = relative === 'solid.config.json';

        try {
          if (isPage) {
            await pushPage(filePath, relative, manifest, options.dryRun);
          } else if (isKb) {
            await pushKb(filePath, relative, manifest, options.dryRun);
          } else if (isConfig) {
            await pushSettings(filePath, options.dryRun);
          }
        } catch (error) {
          const err = handleApiError(error);
          console.log(chalk.red(`  [error] ${relative}: ${err.message}`));
        }
      }
    }

    function scheduleProcess(filePath: string) {
      pendingFiles.add(filePath);
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(processPendingChanges, delay);
    }

    // Watch directories
    const watchDirs: string[] = [];
    if (!options.kbOnly) {
      const pagesDir = path.join(dir, 'pages');
      if (fs.existsSync(pagesDir)) watchDirs.push(pagesDir);
    }
    if (!options.pagesOnly) {
      const kbDir = path.join(dir, 'kb');
      if (fs.existsSync(kbDir)) watchDirs.push(kbDir);
    }

    // Always watch config
    const configPath = path.join(dir, 'solid.config.json');

    for (const watchDir of watchDirs) {
      const type = path.basename(watchDir);
      console.log(`  ${chalk.green('\u25CF')} Watching ${type}/`);

      fs.watch(watchDir, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const fullPath = path.join(watchDir, filename);
        if (filename.endsWith('.json') || filename.endsWith('.md')) {
          const time = new Date().toLocaleTimeString();
          console.log(chalk.dim(`  [${time}] Change detected: ${type}/${filename}`));
          scheduleProcess(fullPath);
        }
      });
    }

    if (fs.existsSync(configPath)) {
      console.log(`  ${chalk.green('\u25CF')} Watching solid.config.json`);
      fs.watchFile(configPath, { interval: 1000 }, () => {
        const time = new Date().toLocaleTimeString();
        console.log(chalk.dim(`  [${time}] Change detected: solid.config.json`));
        scheduleProcess(configPath);
      });
    }

    console.log('');
    console.log(chalk.dim('  Waiting for changes... (Ctrl+C to stop)'));
    console.log('');

    // Keep process alive
    process.on('SIGINT', () => {
      console.log('');
      console.log(chalk.dim('  Watcher stopped.'));
      process.exit(0);
    });
  });

// ─── Push helpers ───────────────────────────────────────────────────

async function pushPage(filePath: string, relative: string, manifest: any, dryRun: boolean) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const fileName = path.basename(filePath);
  const existing = manifest.pages?.[fileName];

  if (dryRun) {
    console.log(chalk.yellow(`  [dry-run] Would ${existing ? 'update' : 'create'} ${relative}`));
    return;
  }

  if (existing) {
    // Update existing page
    await apiClient.pageUpdate(existing.id, {
      title: data.title,
      slug: data.slug,
      meta_title: data.meta_title,
      meta_description: data.meta_description,
      layout_json: data.layout_json,
      is_published: data.is_published,
      is_landing_page: data.is_landing_page,
    });
    console.log(chalk.green(`  [updated] ${relative}`));
  } else {
    // Create new page
    const response = await apiClient.pageCreate({
      title: data.title || fileName.replace('.json', ''),
      slug: data.slug || fileName.replace('.json', ''),
      page_type: data.page_type || 'website',
      layout_json: data.layout_json || { sections: [] },
    });
    // Update manifest with new ID
    const newPage = (response.data as any)?.page;
    if (newPage?.id) {
      manifest.pages = manifest.pages || {};
      manifest.pages[fileName] = { id: newPage.id, slug: data.slug, updated_at: new Date().toISOString() };
      const manifestPath = path.join(path.dirname(filePath), '..', '.solid', 'manifest.json');
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
    }
    console.log(chalk.green(`  [created] ${relative}`));
  }
}

async function pushKb(filePath: string, relative: string, manifest: any, dryRun: boolean) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) {
    console.log(chalk.yellow(`  [skipped] ${relative} — no frontmatter`));
    return;
  }

  const frontmatter = fmMatch[1];
  const body = fmMatch[2].trim();
  const titleMatch = frontmatter.match(/title:\s*(.+)/);
  const categoryMatch = frontmatter.match(/category:\s*(.+)/);
  const idMatch = frontmatter.match(/id:\s*(\d+)/);
  const title = titleMatch ? titleMatch[1].trim() : path.basename(filePath, '.md');
  const category = categoryMatch ? categoryMatch[1].trim() : 'general';
  const id = idMatch ? parseInt(idMatch[1]) : null;

  if (dryRun) {
    console.log(chalk.yellow(`  [dry-run] Would ${id ? 'update' : 'create'} ${relative}`));
    return;
  }

  if (id) {
    await apiClient.kbUpdate(id, { title, category, content: body });
    console.log(chalk.green(`  [updated] ${relative}`));
  } else {
    await apiClient.kbCreate({ title, category, content: body });
    console.log(chalk.green(`  [created] ${relative}`));
  }
}

async function pushSettings(filePath: string, dryRun: boolean) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  if (!data.website_settings) {
    console.log(chalk.dim(`  [skipped] solid.config.json — no website_settings`));
    return;
  }

  if (dryRun) {
    console.log(chalk.yellow(`  [dry-run] Would update website settings`));
    return;
  }

  const companyId = config.companyId;
  if (!companyId) return;
  await apiClient.updateWebsiteSettings(companyId, data.website_settings);
  console.log(chalk.green(`  [updated] website settings`));
}
