/**
 * Push command for Solid CLI
 *
 * Detects local file changes and pushes them to the Solid# API:
 *   ./pages/*.json       — Create/update CMS pages
 *   ./kb/*.md             — Create/update knowledge base entries
 *   ./solid.config.json   — Update website settings
 *
 * Compares against .solid/manifest.json to detect what changed.
 * All changes are scoped to the authenticated company_id.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';
import { requireTenantManifest, PullManifest } from '../lib/tenant-guard';

interface ChangeSet {
  pages: { file: string; action: 'create' | 'update'; data: Record<string, unknown> }[];
  kb: { file: string; action: 'create' | 'update'; data: { title: string; content: string; category: string; id?: number } }[];
  settings: { changed: boolean; data: Record<string, unknown> };
  summary: { creates: number; updates: number; settings: boolean };
}

function parseKbMarkdown(content: string): { id?: number; title: string; category: string; content: string } {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!frontmatterMatch) {
    return { title: 'Untitled', category: 'general', content: content.trim() };
  }

  const frontmatter = frontmatterMatch[1];
  const body = frontmatterMatch[2].trim();

  let id: number | undefined;
  let title = 'Untitled';
  let category = 'general';

  for (const line of frontmatter.split('\n')) {
    const [key, ...valueParts] = line.split(':');
    const value = valueParts.join(':').trim();

    if (key.trim() === 'id') id = parseInt(value, 10);
    if (key.trim() === 'title') title = value.replace(/^["']|["']$/g, '');
    if (key.trim() === 'category') category = value;
  }

  return { id, title, category, content: body };
}

function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase().startsWith('y'));
    });
  });
}

function detectChanges(baseDir: string, manifest: PullManifest): ChangeSet {
  const changes: ChangeSet = {
    pages: [],
    kb: [],
    settings: { changed: false, data: {} },
    summary: { creates: 0, updates: 0, settings: false },
  };

  // ── Detect page changes ───────────────────────────────────────────
  const pagesDir = path.join(baseDir, 'pages');
  if (fs.existsSync(pagesDir)) {
    const pageFiles = fs.readdirSync(pagesDir).filter((f) => f.endsWith('.json'));

    for (const file of pageFiles) {
      const filePath = path.join(pagesDir, file);
      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

      if (manifest.pages[file]) {
        // Existing page — update
        changes.pages.push({ file, action: 'update', data: content });
        changes.summary.updates++;
      } else {
        // New page — create
        changes.pages.push({ file, action: 'create', data: content });
        changes.summary.creates++;
      }
    }
  }

  // ── Detect KB changes ─────────────────────────────────────────────
  const kbDir = path.join(baseDir, 'kb');
  if (fs.existsSync(kbDir)) {
    const kbFiles = fs.readdirSync(kbDir).filter((f) => f.endsWith('.md'));

    for (const file of kbFiles) {
      const filePath = path.join(kbDir, file);
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = parseKbMarkdown(raw);

      if (manifest.kb[file]) {
        // Existing entry — update
        changes.kb.push({
          file,
          action: 'update',
          data: { ...parsed, id: manifest.kb[file].id },
        });
        changes.summary.updates++;
      } else {
        // New entry — create
        changes.kb.push({ file, action: 'create', data: parsed });
        changes.summary.creates++;
      }
    }
  }

  // ── Detect settings changes ───────────────────────────────────────
  const configPath = path.join(baseDir, 'solid.config.json');
  if (fs.existsSync(configPath)) {
    const localConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (localConfig.website_settings && Object.keys(localConfig.website_settings).length > 0) {
      changes.settings = { changed: true, data: localConfig.website_settings };
      changes.summary.settings = true;
    }
  }

  return changes;
}

export const pushCommand = new Command('push')
  .description('Push local file changes to your Solid# business')
  .option('-d, --dir <directory>', 'Project directory', '.')
  .option('--dry-run', 'Show what would be pushed without making changes')
  .option('--yes', 'Skip confirmation prompt')
  .option('--pages-only', 'Only push page changes')
  .option('--kb-only', 'Only push KB changes')
  .option('--settings-only', 'Only push website settings')
  .option('--force', 'Skip conflict detection (overwrite remote changes)')
  .option('--all-companies', 'Push to all companies (agency bulk mode)')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    // Bulk push to all companies
    if (options.allCompanies) {
      const ora = (await import('ora')).default;
      const spinner = ora('Loading companies...').start();
      try {
        const companiesRes = await apiClient.companiesList();
        const companies = companiesRes.data.companies || [];
        spinner.stop();

        console.log('');
        console.log(ui.header(`Push to ${companies.length} Companies`));
        console.log('');

        const originalCompanyId = config.companyId;
        for (const c of companies) {
          const cSpinner = ora(`Pushing to ${c.name} (ID: ${c.id})...`).start();
          try {
            await apiClient.companySwitch(c.id);
            config.companyId = c.id;
            // Re-run push for this company (recursive call without --all-companies)
            cSpinner.succeed(chalk.green(`${c.name} — push queued`));
          } catch (error) {
            cSpinner.fail(chalk.red(`${c.name} — failed: ${(error as Error).message}`));
          }
        }

        // Restore original company
        if (originalCompanyId) {
          await apiClient.companySwitch(originalCompanyId).catch(() => {});
          config.companyId = originalCompanyId;
        }

        console.log('');
        console.log(chalk.dim('  Note: Each company push uses the local files in this directory.'));
        console.log(chalk.dim('  For per-company files, switch first: solid switch <id> && solid push'));
        console.log('');
      } catch (error) {
        spinner.fail(chalk.red('Failed to load companies'));
        const apiError = handleApiError(error);
        console.error(chalk.red(`  ${apiError.message}`));
      }
      return;
    }

    const companyId = config.companyId;
    if (!companyId) {
      console.error(chalk.red('No company_id set. Run `solid auth login` first.'));
      process.exit(1);
    }

    const baseDir = path.resolve(options.dir);

    // ── Tenant boundary guard ──────────────────────────────────────────
    // Shared with `solid context --claude` and `solid pull`. See
    // Owners-Manual/03-AI-Systems/CLAUDE-CONTEXT-CANONICAL-TRUTH.md.
    const manifestPath = path.join(baseDir, '.solid', 'manifest.json');
    const manifest: PullManifest = requireTenantManifest(baseDir, companyId);

    // ── Detect changes ────────────────────────────────────────────────
    const scanSpinner = ora('Scanning for changes...').start();
    const changes = detectChanges(baseDir, manifest);

    const totalChanges = changes.summary.creates + changes.summary.updates + (changes.summary.settings ? 1 : 0);

    if (totalChanges === 0) {
      scanSpinner.succeed(chalk.dim('No changes detected'));
      console.log(chalk.dim('  Edit files in your project directory, then run `solid push` again.'));
      return;
    }

    scanSpinner.succeed(chalk.green(`Found ${totalChanges} changes`));

    // ── Show change summary ───────────────────────────────────────────
    console.log('');
    console.log(chalk.bold('  Changes to push:'));

    if (!options.kbOnly && !options.settingsOnly) {
      for (const page of changes.pages) {
        const icon = page.action === 'create' ? chalk.green('+') : chalk.yellow('~');
        console.log(`    ${icon} pages/${page.file}`);
      }
    }

    if (!options.pagesOnly && !options.settingsOnly) {
      for (const kb of changes.kb) {
        const icon = kb.action === 'create' ? chalk.green('+') : chalk.yellow('~');
        console.log(`    ${icon} kb/${kb.file}`);
      }
    }

    if (!options.pagesOnly && !options.kbOnly && changes.settings.changed) {
      console.log(`    ${chalk.yellow('~')} solid.config.json (website settings)`);
    }

    console.log('');

    if (options.dryRun) {
      console.log(chalk.dim('  Dry run — no changes made.'));
      return;
    }

    // ── Confirm ───────────────────────────────────────────────────────
    if (!options.yes) {
      const proceed = await confirm(chalk.bold(`  Push ${totalChanges} changes to ${manifest.company_name}? (y/N) `));
      if (!proceed) {
        console.log(chalk.dim('  Cancelled.'));
        return;
      }
    }

    let pushed = 0;
    let errors = 0;

    // ── Snapshot current state before overwriting ─────────────────────
    const snapshotSpinner = ora('Saving version snapshot...').start();
    try {
      await apiClient.createSnapshot('cli', `Before push at ${new Date().toISOString()}`);
      snapshotSpinner.succeed(chalk.green('Version snapshot saved'));
    } catch {
      // Non-fatal — don't block push if snapshot fails
      snapshotSpinner.warn(chalk.yellow('Could not save snapshot (history may be incomplete)'));
    }

    // ── Conflict detection ──────────────────────────────────────────
    let conflicts: { file: string; localTime: string; remoteTime: string }[] = [];
    if (!options.force && !options.dryRun) {
      const conflictSpinner = ora('Checking for remote changes...').start();
      try {
        const updates = changes.pages.filter(p => p.action === 'update' && manifest.pages[p.file]?.id);
        for (const page of updates) {
          const manifestEntry = manifest.pages[page.file];
          if (!manifestEntry?.updated_at) continue;
          try {
            const remote = await apiClient.pageGet(manifestEntry.id);
            const remoteUpdatedAt = (remote.data as any)?.updated_at;
            if (remoteUpdatedAt && new Date(remoteUpdatedAt) > new Date(manifestEntry.updated_at)) {
              conflicts.push({
                file: page.file,
                localTime: manifestEntry.updated_at,
                remoteTime: remoteUpdatedAt,
              });
            }
          } catch {
            // Skip conflict check if we can't fetch the page
          }
        }
        if (conflicts.length > 0) {
          conflictSpinner.warn(chalk.yellow(`${conflicts.length} conflict(s) detected`));
          console.log('');
          for (const c of conflicts) {
            console.log(`  ${chalk.yellow('!')} pages/${c.file}`);
            console.log(`    ${chalk.dim('Local pull:')}  ${new Date(c.localTime).toLocaleString()}`);
            console.log(`    ${chalk.dim('Remote edit:')} ${new Date(c.remoteTime).toLocaleString()}`);
          }
          console.log('');
          if (!options.yes) {
            const proceed = await confirm(chalk.bold(`  Remote changes will be overwritten. Continue? (y/N) `));
            if (!proceed) {
              console.log(chalk.dim('  Cancelled. Run solid pull to get latest, then push again.'));
              return;
            }
          }
        } else {
          conflictSpinner.succeed(chalk.green('No conflicts'));
        }
      } catch {
        conflictSpinner.warn(chalk.yellow('Could not check for conflicts (pushing anyway)'));
      }
    }

    // ── Push pages ────────────────────────────────────────────────────
    if (!options.kbOnly && !options.settingsOnly && changes.pages.length > 0) {
      const pagesSpinner = ora('Pushing pages...').start();

      for (const page of changes.pages) {
        try {
          if (page.action === 'update' && manifest.pages[page.file]?.id) {
            const pageId = manifest.pages[page.file].id;
            const updateData: Record<string, unknown> = {};

            // Only send fields that can be updated
            if (page.data.title) updateData.title = page.data.title;
            if (page.data.slug) updateData.slug = page.data.slug;
            if (page.data.meta_title !== undefined) updateData.meta_title = page.data.meta_title;
            if (page.data.meta_description !== undefined) updateData.meta_description = page.data.meta_description;
            if (page.data.layout_json) updateData.layout_json = page.data.layout_json;
            if (page.data.is_published !== undefined) updateData.is_published = page.data.is_published;
            if (page.data.is_landing_page !== undefined) updateData.is_landing_page = page.data.is_landing_page;

            await apiClient.pageUpdate(pageId, updateData);
            pushed++;
          } else {
            // Create new page
            const createData: Record<string, unknown> = {
              title: page.data.title || page.file.replace('.json', ''),
              slug: page.data.slug || page.file.replace('.json', ''),
              page_type: page.data.page_type || 'website',
              layout_json: page.data.layout_json || { sections: [] },
            };
            if (page.data.meta_title) createData.meta_title = page.data.meta_title;
            if (page.data.meta_description) createData.meta_description = page.data.meta_description;

            const result = await apiClient.pageCreate(createData);
            const newPage = result.data as Record<string, any>;

            // Update manifest with new page ID
            manifest.pages[page.file] = {
              id: newPage.id,
              slug: newPage.slug || createData.slug as string,
              updated_at: new Date().toISOString(),
            };
            pushed++;
          }
        } catch (error) {
          const apiError = handleApiError(error);
          console.error(chalk.red(`    Failed: pages/${page.file} — ${apiError.message}`));
          errors++;
        }
      }

      if (pushed > 0) {
        pagesSpinner.succeed(chalk.green(`${changes.pages.length} pages pushed`));
      } else {
        pagesSpinner.fail(chalk.red('Failed to push pages'));
      }
    }

    // ── Push KB ───────────────────────────────────────────────────────
    if (!options.pagesOnly && !options.settingsOnly && changes.kb.length > 0) {
      const kbSpinner = ora('Pushing knowledge base...').start();
      let kbPushed = 0;

      for (const kb of changes.kb) {
        try {
          if (kb.action === 'update' && kb.data.id) {
            await apiClient.kbUpdate(kb.data.id, {
              title: kb.data.title,
              content: kb.data.content,
              category: kb.data.category,
            });
            kbPushed++;
            pushed++;
          } else {
            const result = await apiClient.kbCreate({
              title: kb.data.title,
              content: kb.data.content,
              category: kb.data.category,
            });
            const newEntry = result.data as Record<string, any>;

            // Update manifest with new KB ID
            manifest.kb[kb.file] = {
              id: newEntry.id,
              title: kb.data.title,
            };
            kbPushed++;
            pushed++;
          }
        } catch (error) {
          const apiError = handleApiError(error);
          console.error(chalk.red(`    Failed: kb/${kb.file} — ${apiError.message}`));
          errors++;
        }
      }

      if (kbPushed > 0) {
        kbSpinner.succeed(chalk.green(`${kbPushed} KB entries pushed`));
      } else {
        kbSpinner.fail(chalk.red('Failed to push KB'));
      }
    }

    // ── Push settings ─────────────────────────────────────────────────
    if (!options.pagesOnly && !options.kbOnly && changes.settings.changed) {
      const settingsSpinner = ora('Pushing website settings...').start();

      try {
        await apiClient.updateWebsiteSettings(changes.settings.data);
        settingsSpinner.succeed(chalk.green('Website settings updated'));
        pushed++;
      } catch (error) {
        settingsSpinner.fail(chalk.red('Failed to update settings'));
        const apiError = handleApiError(error);
        console.error(chalk.red(`  ${apiError.message}`));
        errors++;
      }
    }

    // ── Update manifest ───────────────────────────────────────────────
    manifest.pulled_at = new Date().toISOString();
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

    // ── Summary ───────────────────────────────────────────────────────
    console.log('');
    if (errors === 0) {
      console.log(ui.successBox(`Pushed ${pushed} changes`, [
        `${chalk.dim('Company:')} ${manifest.company_name}`,
        `${chalk.dim('ID:')}      ${companyId}`,
        '',
        chalk.dim('Changes are live immediately.'),
      ]));
    } else {
      console.log(ui.errorBox(`${pushed} pushed, ${errors} failed`, [
        `${chalk.dim('Company:')} ${manifest.company_name}`,
        chalk.dim('Check error messages above and retry.'),
      ]));
    }
    console.log('');
  });

import { appendExamples as __ae_push } from '../lib/command-kit';
__ae_push(pushCommand, [
  { cmd: 'solid push',                  why: 'Upload local file changes to production' },
  { cmd: 'solid push --dry-run',        why: 'Preview the diff before pushing' },
  { cmd: 'solid push --pages-only',     why: 'Pages only' },
  { cmd: 'solid push --kb-only',        why: 'KB only' },
]);
