/**
 * Diff command for Solid CLI
 *
 * Shows content differences between local files and production.
 * Safety net before `solid push` — see exactly what will change.
 *
 * solid diff                → Show all changes
 * solid diff --pages-only   → Only page changes
 * solid diff --kb-only      → Only KB changes
 * solid diff --summary      → Just file names, no content
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';

// ─── Deep diff helpers ───────────────────────────────────────────────

interface DiffEntry {
  path: string;
  type: 'added' | 'removed' | 'changed';
  local?: string;
  remote?: string;
}

function deepDiff(local: any, remote: any, prefix = ''): DiffEntry[] {
  const diffs: DiffEntry[] = [];

  if (local === remote) return diffs;
  if (local === null || local === undefined) {
    diffs.push({ path: prefix, type: 'added', local: String(local), remote: String(remote) });
    return diffs;
  }
  if (remote === null || remote === undefined) {
    diffs.push({ path: prefix, type: 'removed', local: String(local), remote: String(remote) });
    return diffs;
  }

  if (typeof local !== typeof remote) {
    diffs.push({ path: prefix, type: 'changed', local: truncate(JSON.stringify(local)), remote: truncate(JSON.stringify(remote)) });
    return diffs;
  }

  if (Array.isArray(local) && Array.isArray(remote)) {
    const maxLen = Math.max(local.length, remote.length);
    for (let i = 0; i < maxLen; i++) {
      diffs.push(...deepDiff(local[i], remote[i], `${prefix}[${i}]`));
    }
    return diffs;
  }

  if (typeof local === 'object') {
    const allKeys = new Set([...Object.keys(local), ...Object.keys(remote)]);
    for (const key of allKeys) {
      // Skip internal/meta fields
      if (['updated_at', 'created_at', '_id', 'id', 'company_id'].includes(key)) continue;
      diffs.push(...deepDiff(local[key], remote[key], prefix ? `${prefix}.${key}` : key));
    }
    return diffs;
  }

  if (local !== remote) {
    diffs.push({ path: prefix, type: 'changed', local: truncate(String(local)), remote: truncate(String(remote)) });
  }

  return diffs;
}

function truncate(s: string, len = 80): string {
  if (s.length <= len) return s;
  return s.slice(0, len - 1) + '\u2026';
}

function textDiff(local: string, remote: string): { added: number; removed: number; changed: boolean } {
  const localLines = local.split('\n');
  const remoteLines = remote.split('\n');
  const localSet = new Set(localLines);
  const remoteSet = new Set(remoteLines);

  let added = 0;
  let removed = 0;
  for (const line of localLines) {
    if (!remoteSet.has(line)) added++;
  }
  for (const line of remoteLines) {
    if (!localSet.has(line)) removed++;
  }
  return { added, removed, changed: added > 0 || removed > 0 };
}

// ─── Main command ────────────────────────────────────────────────────

export const diffCommand = new Command('diff')
  .description('Show differences between local files and production')
  .option('--dir <path>', 'Working directory', process.cwd())
  .option('--pages-only', 'Only show page changes')
  .option('--kb-only', 'Only show KB changes')
  .option('--summary', 'Just file names, no content details')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const dir = options.dir;
    const manifestPath = path.join(dir, '.solid', 'manifest.json');

    if (!fs.existsSync(manifestPath)) {
      console.error(chalk.red('No .solid/manifest.json found. Run `solid pull` first.'));
      process.exit(1);
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const spinner = ora('Fetching current production state...').start();

    let totalChanges = 0;

    try {
      // ── Pages diff ──
      if (!options.kbOnly) {
        const pagesDir = path.join(dir, 'pages');
        if (fs.existsSync(pagesDir)) {
          let remotePagesMap: Record<string, any> = {};
          try {
            const response = await apiClient.pagesList();
            const remotePages = (response.data as Record<string, any>)?.pages || [];
            for (const p of remotePages) {
              remotePagesMap[p.slug] = p;
            }
          } catch { /* continue with empty */ }

          const localFiles = fs.readdirSync(pagesDir).filter(f => f.endsWith('.json'));
          let pageChanges = 0;

          for (const file of localFiles) {
            try {
              const local = JSON.parse(fs.readFileSync(path.join(pagesDir, file), 'utf-8'));
              const slug = local.slug || file.replace('.json', '');
              const remote = remotePagesMap[slug];

              if (!remote) {
                // New page (exists locally, not on server)
                console.log(chalk.green(`+ pages/${file}`) + chalk.dim(' (new page)'));
                pageChanges++;
                continue;
              }

              // Fetch full page with layout_json
              let remoteFull: any = null;
              try {
                const pageResponse = await apiClient.pageGet(remote.id);
                remoteFull = (pageResponse.data as Record<string, any>)?.page || pageResponse.data;
              } catch {
                remoteFull = remote;
              }

              const diffs = deepDiff(local, remoteFull);
              if (diffs.length > 0) {
                console.log(chalk.yellow(`~ pages/${file}`) + chalk.dim(` (${diffs.length} changes)`));
                if (!options.summary) {
                  for (const d of diffs.slice(0, 10)) {
                    if (d.type === 'changed') {
                      console.log(chalk.dim(`    ${d.path}:`));
                      console.log(chalk.red(`      - ${d.remote}`));
                      console.log(chalk.green(`      + ${d.local}`));
                    } else if (d.type === 'added') {
                      console.log(chalk.green(`    + ${d.path}: ${d.local}`));
                    } else {
                      console.log(chalk.red(`    - ${d.path}: ${d.remote}`));
                    }
                  }
                  if (diffs.length > 10) {
                    console.log(chalk.dim(`    ... and ${diffs.length - 10} more changes`));
                  }
                }
                pageChanges++;
              }

              // Remove from map (to detect deletions)
              delete remotePagesMap[slug];
            } catch { /* skip unparseable files */ }
          }

          // Pages that exist remotely but not locally
          for (const [slug] of Object.entries(remotePagesMap)) {
            console.log(chalk.red(`- pages/${slug}.json`) + chalk.dim(' (exists on server, not locally)'));
            pageChanges++;
          }

          if (pageChanges === 0 && !options.kbOnly) {
            console.log(chalk.dim('  Pages: no changes'));
          }
          totalChanges += pageChanges;
        }
      }

      // ── KB diff ──
      if (!options.pagesOnly) {
        const kbDir = path.join(dir, 'kb');
        if (fs.existsSync(kbDir)) {
          let remoteKbMap: Record<number, any> = {};
          try {
            const kbResponse = await apiClient.kbSearch('*', 500);
            const entries = (kbResponse.data as Record<string, any>)?.results || (kbResponse.data as Record<string, any>)?.entries || [];
            for (const e of (Array.isArray(entries) ? entries : [])) {
              remoteKbMap[e.id] = e;
            }
          } catch { /* continue with empty */ }

          const localFiles = fs.readdirSync(kbDir).filter(f => f.endsWith('.md'));
          let kbChanges = 0;

          for (const file of localFiles) {
            try {
              const content = fs.readFileSync(path.join(kbDir, file), 'utf-8');

              // Parse frontmatter
              const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
              if (!fmMatch) continue;

              const frontmatter = fmMatch[1];
              const body = fmMatch[2].trim();
              const idMatch = frontmatter.match(/id:\s*(\d+)/);
              const id = idMatch ? parseInt(idMatch[1]) : null;

              if (!id) {
                console.log(chalk.green(`+ kb/${file}`) + chalk.dim(' (new entry)'));
                kbChanges++;
                continue;
              }

              const remote = remoteKbMap[id];
              if (!remote) {
                console.log(chalk.green(`+ kb/${file}`) + chalk.dim(' (new entry, ID not on server)'));
                kbChanges++;
                continue;
              }

              // Compare content
              const remoteContent = remote.content || remote.text || '';
              const diff = textDiff(body, remoteContent);
              if (diff.changed) {
                console.log(chalk.yellow(`~ kb/${file}`) + chalk.dim(` (+${diff.added} -${diff.removed} lines)`));
                kbChanges++;
              }

              delete remoteKbMap[id];
            } catch { /* skip */ }
          }

          if (kbChanges === 0 && !options.pagesOnly) {
            console.log(chalk.dim('  KB: no changes'));
          }
          totalChanges += kbChanges;
        }
      }

      spinner.stop();

      // ── Summary ──
      console.log('');
      if (totalChanges === 0) {
        console.log(chalk.green('No changes. Local files match production.'));
      } else {
        console.log(chalk.bold(`${totalChanges} file(s) changed.`));
        console.log(chalk.dim('Run `solid push --dry-run` to preview the push, or `solid push` to apply.'));
      }

    } catch (error) {
      spinner.stop();
      const err = handleApiError(error);
      console.error(chalk.red(`Failed to diff: ${err.message}`));
      process.exit(1);
    }
  });
