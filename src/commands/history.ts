import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';
import * as readline from 'readline';

interface VersionRecord {
  version: number;
  slug?: string;
  title?: string;
  category?: string | null;
  is_published?: boolean;
  source?: string;
  change_summary?: string | null;
  created_at?: string | null;
  layout_json?: { sections?: unknown[] } | null;
}

interface PageMetadata {
  title?: string;
  slug?: string;
  current_version?: number;
}

interface KBEntryMetadata {
  title?: string;
  category?: string | null;
}

interface PagesHistoryResponse {
  page?: PageMetadata;
  versions: VersionRecord[];
  count: number;
}

interface KBHistoryResponse {
  entry?: KBEntryMetadata;
  versions: VersionRecord[];
  count: number;
}

interface RollbackResponse {
  message: string;
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

function formatDate(iso: string | null): string {
  if (!iso) return chalk.dim('—');
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return chalk.green('just now');
  if (diffMin < 60) return chalk.green(`${diffMin}m ago`);
  if (diffHr < 24) return chalk.yellow(`${diffHr}h ago`);
  if (diffDay < 7) return chalk.dim(`${diffDay}d ago`);
  return chalk.dim(d.toLocaleDateString());
}

function sourceLabel(source: string): string {
  const map: Record<string, string> = {
    cli: chalk.cyan('CLI'),
    dashboard: chalk.blue('Dashboard'),
    vibe: chalk.magenta('Vibe'),
    import: chalk.yellow('Import'),
    api: chalk.dim('API'),
  };
  return map[source] || chalk.dim(source);
}

// ============================================================================
// solid history
// ============================================================================

export const historyCommand = new Command('history')
  .description('View version history for pages and KB entries')
  .argument('[type]', 'Resource type: pages or kb')
  .argument('[identifier]', 'Page slug or KB entry ID')
  .option('-n, --limit <number>', 'Number of versions to show', '20')
  .option('-v, --version <number>', 'Show specific version detail')
  .option('--json', 'Output as JSON')
  .action(async (type, identifier, options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run: solid auth login'));
      return;
    }

    const limit = parseInt(options.limit, 10);

    // Default: show all recent versions
    if (!type) {
      const spinner = ora('Loading version history...').start();
      try {
        const [pagesRes, kbRes] = await Promise.all([
          apiClient.historyPages(undefined, limit),
          apiClient.historyKB(undefined, limit),
        ]);
        spinner.succeed(chalk.green('Version history loaded'));

        const pagesData = pagesRes.data as PagesHistoryResponse;
        const kbData = kbRes.data as KBHistoryResponse;

        if (options.json) {
          console.log(JSON.stringify({ pages: pagesData, kb: kbData }, null, 2));
          return;
        }

        console.log('');

        // Pages
        if (pagesData.versions.length > 0) {
          console.log(chalk.bold('  Pages'));
          console.log(ui.divider());
          const rows = pagesData.versions.map((v) => [
            chalk.dim(`v${v.version}`),
            v.slug || '',
            v.change_summary || chalk.dim('—'),
            sourceLabel(v.source || ''),
            formatDate(v.created_at || null),
          ]);
          console.log(ui.table(['Ver', 'Slug', 'Change', 'Source', 'When'], rows));
        } else {
          console.log(chalk.dim('  No page versions recorded yet.'));
          console.log(chalk.dim('  Versions are created on each solid push.'));
        }

        console.log('');

        // KB
        if (kbData.versions.length > 0) {
          console.log(chalk.bold('  Knowledge Base'));
          console.log(ui.divider());
          const rows = kbData.versions.map((v) => [
            chalk.dim(`v${v.version}`),
            v.title || '',
            v.change_summary || chalk.dim('—'),
            sourceLabel(v.source || ''),
            formatDate(v.created_at || null),
          ]);
          console.log(ui.table(['Ver', 'Title', 'Change', 'Source', 'When'], rows));
        } else {
          console.log(chalk.dim('  No KB versions recorded yet.'));
        }

        console.log('');
        console.log(chalk.dim('  Usage: solid history pages <slug>'));
        console.log(chalk.dim('         solid history kb <entry_id>'));
        console.log('');
      } catch (error) {
        spinner.fail(chalk.red('Failed to load history'));
        const apiError = handleApiError(error);
        console.error(chalk.red(`  ${apiError.message}`));
      }
      return;
    }

    // Pages history
    if (type === 'pages' || type === 'page') {
      if (identifier && options.version) {
        // Specific version detail
        const spinner = ora(`Loading v${options.version} of ${identifier}...`).start();
        try {
          const res = await apiClient.historyPageVersion(identifier, parseInt(options.version, 10));
          spinner.succeed(chalk.green(`Version ${options.version} loaded`));
          const v = res.data as VersionRecord;

          if (options.json) {
            console.log(JSON.stringify(v, null, 2));
            return;
          }

          console.log('');
          console.log(ui.successBox(`Page: ${v.slug} — v${v.version}`, [
            `Title: ${v.title}`,
            `Published: ${v.is_published ? 'Yes' : 'No'}`,
            `Source: ${v.source}`,
            `Change: ${v.change_summary || '—'}`,
            `Created: ${v.created_at}`,
            '',
            `Blocks: ${(v.layout_json?.sections || []).length} sections`,
          ]));
          console.log('');
          console.log(chalk.dim(`  Rollback: solid rollback page ${v.slug} --to ${v.version}`));
          console.log('');
        } catch (error) {
          spinner.fail(chalk.red('Failed to load version'));
          const apiError = handleApiError(error);
          console.error(chalk.red(`  ${apiError.message}`));
        }
        return;
      }

      const spinner = ora(identifier ? `Loading history for ${identifier}...` : 'Loading page history...').start();
      try {
        const res = await apiClient.historyPages(identifier, limit);
        spinner.succeed(chalk.green('History loaded'));
        const data = res.data as PagesHistoryResponse;

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        console.log('');
        if (data.page) {
          console.log(chalk.bold(`  ${data.page.title} (${data.page.slug})`));
          console.log(chalk.dim(`  Current version: ${data.page.current_version}`));
          console.log('');
        }

        if (data.versions.length > 0) {
          const rows = data.versions.map((v) => [
            chalk.bold(`v${v.version}`),
            v.title || '',
            v.is_published ? chalk.green('✓') : chalk.dim('—'),
            v.change_summary || chalk.dim('—'),
            sourceLabel(v.source || ''),
            formatDate(v.created_at || null),
          ]);
          console.log(ui.table(['Ver', 'Title', 'Pub', 'Change', 'Source', 'When'], rows));
        } else {
          console.log(chalk.dim('  No versions found.'));
        }

        console.log('');
        if (identifier) {
          console.log(chalk.dim(`  Detail:   solid history pages ${identifier} -v <number>`));
          console.log(chalk.dim(`  Rollback: solid rollback page ${identifier} --to <version>`));
        }
        console.log('');
      } catch (error) {
        spinner.fail(chalk.red('Failed to load history'));
        const apiError = handleApiError(error);
        console.error(chalk.red(`  ${apiError.message}`));
      }
      return;
    }

    // KB history
    if (type === 'kb') {
      const entryId = identifier ? parseInt(identifier, 10) : undefined;
      const spinner = ora(entryId ? `Loading history for KB #${entryId}...` : 'Loading KB history...').start();
      try {
        const res = await apiClient.historyKB(entryId, limit);
        spinner.succeed(chalk.green('History loaded'));
        const data = res.data as KBHistoryResponse;

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        console.log('');
        if (data.entry) {
          console.log(chalk.bold(`  ${data.entry.title}`));
          console.log(chalk.dim(`  Category: ${data.entry.category || '—'}`));
          console.log('');
        }

        if (data.versions.length > 0) {
          const rows = data.versions.map((v) => [
            chalk.bold(`v${v.version}`),
            v.title || '',
            v.category || chalk.dim('—'),
            v.change_summary || chalk.dim('—'),
            sourceLabel(v.source || ''),
            formatDate(v.created_at || null),
          ]);
          console.log(ui.table(['Ver', 'Title', 'Category', 'Change', 'Source', 'When'], rows));
        } else {
          console.log(chalk.dim('  No versions found.'));
        }

        console.log('');
        if (entryId) {
          console.log(chalk.dim(`  Rollback: solid rollback kb ${entryId} --to <version>`));
        }
        console.log('');
      } catch (error) {
        spinner.fail(chalk.red('Failed to load history'));
        const apiError = handleApiError(error);
        console.error(chalk.red(`  ${apiError.message}`));
      }
      return;
    }

    console.error(chalk.red(`Unknown type: ${type}. Use 'pages' or 'kb'.`));
  });

// ============================================================================
// solid rollback
// ============================================================================

export const rollbackCommand = new Command('rollback')
  .description('Rollback a page or KB entry to a previous version')
  .argument('<type>', 'Resource type: page or kb')
  .argument('<identifier>', 'Page slug or KB entry ID')
  .requiredOption('--to <version>', 'Version number to rollback to')
  .option('-y, --yes', 'Skip confirmation')
  .option('--json', 'Output as JSON')
  .action(async (type, identifier, options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run: solid auth login'));
      return;
    }

    const targetVersion = parseInt(options.to, 10);
    if (isNaN(targetVersion) || targetVersion < 1) {
      console.error(chalk.red('Invalid version number. Must be a positive integer.'));
      return;
    }

    if (type === 'page' || type === 'pages') {
      // Show what we're rolling back to
      const spinner = ora(`Loading v${targetVersion} of ${identifier}...`).start();
      try {
        const versionRes = await apiClient.historyPageVersion(identifier, targetVersion);
        spinner.succeed(chalk.green(`Found v${targetVersion}`));
        const v = versionRes.data as VersionRecord;

        console.log('');
        console.log(ui.infoBox(`Rollback Preview — ${identifier}`, [
          `Rolling back to: v${v.version}`,
          `Title: ${v.title}`,
          `Blocks: ${(v.layout_json?.sections || []).length} sections`,
          `Created: ${v.created_at}`,
          `Source: ${v.source}`,
          `Change: ${v.change_summary || '—'}`,
        ]));
        console.log('');

        if (!options.yes) {
          const proceed = await confirm(chalk.bold('  Rollback this page? Current state will be saved first. (y/N) '));
          if (!proceed) {
            console.log(chalk.dim('  Cancelled.'));
            return;
          }
        }

        const rollbackSpinner = ora('Rolling back...').start();
        const res = await apiClient.rollbackPage(identifier, targetVersion);
        rollbackSpinner.succeed(chalk.green('Rollback complete'));
        const data = res.data as RollbackResponse;

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        console.log('');
        console.log(ui.successBox('Page Rolled Back', [
          data.message,
          '',
          'Your previous state was auto-saved before rollback.',
          `Run: solid history pages ${identifier}`,
        ]));
        console.log('');
      } catch (error) {
        spinner.fail(chalk.red('Rollback failed'));
        const apiError = handleApiError(error);
        console.error(chalk.red(`  ${apiError.message}`));
      }
      return;
    }

    if (type === 'kb') {
      const entryId = parseInt(identifier, 10);
      if (isNaN(entryId)) {
        console.error(chalk.red('KB identifier must be a numeric entry ID.'));
        return;
      }

      if (!options.yes) {
        const proceed = await confirm(chalk.bold(`  Rollback KB #${entryId} to v${targetVersion}? Current state will be saved first. (y/N) `));
        if (!proceed) {
          console.log(chalk.dim('  Cancelled.'));
          return;
        }
      }

      const spinner = ora('Rolling back...').start();
      try {
        const res = await apiClient.rollbackKB(entryId, targetVersion);
        spinner.succeed(chalk.green('Rollback complete'));
        const data = res.data as RollbackResponse;

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        console.log('');
        console.log(ui.successBox('KB Entry Rolled Back', [
          data.message,
          '',
          'Your previous state was auto-saved before rollback.',
          `Run: solid history kb ${entryId}`,
        ]));
        console.log('');
      } catch (error) {
        spinner.fail(chalk.red('Rollback failed'));
        const apiError = handleApiError(error);
        console.error(chalk.red(`  ${apiError.message}`));
      }
      return;
    }

    console.error(chalk.red(`Unknown type: ${type}. Use 'page' or 'kb'.`));
  });
