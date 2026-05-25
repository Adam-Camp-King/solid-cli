import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';
import * as readline from 'readline';
import { isJsonOutput } from '../lib/json-output';

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

        if (isJsonOutput(options)) {
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

          if (isJsonOutput(options)) {
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

        if (isJsonOutput(options)) {
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

        if (isJsonOutput(options)) {
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

        if (isJsonOutput(options)) {
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

        if (isJsonOutput(options)) {
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

// ── Universal Entity History ─────────────────────────────────────
historyCommand
  .command('entity <type> [id]')
  .description('Version history for any business entity (contacts, products, deals, services, orders, appointments)')
  .option('-l, --limit <n>', 'Max versions', '20')
  .option('--json', 'Output as JSON')
  .action(async (type: string, id: string | undefined, opts: any) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const spinner = ora(`Loading ${type} history...`).start();
    try {
      const params: Record<string, any> = { entity_type: type, limit: parseInt(opts.limit) };
      if (id) params.entity_id = parseInt(id);
      const res = await apiClient.post('/api/v1/agent/history/entity', params);
      const data = res.data as Record<string, any>;
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(data, null, 2)); return; }
      const versions = data.versions || [];
      spinner.succeed(chalk.green(`${versions.length} changes for ${type}${id ? ` #${id}` : ''}`));
      if (versions.length === 0) { console.log(chalk.dim('  No changes recorded.')); return; }
      console.log('');
      for (const v of versions as Record<string, any>[]) {
        const date = v.created_at ? chalk.dim(new Date(v.created_at).toLocaleString()) : '';
        const verb = v.verb_name ? chalk.cyan(v.verb_name) : chalk.dim('unknown');
        const changes = v.field_changes ? Object.keys(v.field_changes).join(', ') : '';
        console.log(`  v${v.version}  ${type} #${v.entity_id}  ${verb}  ${date}`);
        if (changes) console.log(chalk.dim(`    changed: ${changes}`));
      }
    } catch (error) { spinner.fail(chalk.red('Failed')); console.error(chalk.red(`  ${handleApiError(error).message}`)); }
  });

historyCommand
  .command('recent')
  .description('All recent changes across the entire company')
  .option('-l, --limit <n>', 'Max changes', '30')
  .option('--json', 'Output as JSON')
  .action(async (opts: any) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const spinner = ora('Loading recent changes...').start();
    try {
      const res = await apiClient.post('/api/v1/agent/history/recent', { limit: parseInt(opts.limit) });
      const data = res.data as Record<string, any>;
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(data, null, 2)); return; }
      const changes = data.changes || [];
      spinner.succeed(chalk.green(`${changes.length} recent changes`));
      if (changes.length === 0) { console.log(chalk.dim('  No changes recorded.')); return; }
      console.log('');
      for (const c of changes as Record<string, any>[]) {
        const date = c.created_at ? chalk.dim(new Date(c.created_at).toLocaleString()) : '';
        const verb = c.verb_name ? chalk.cyan(c.verb_name) : '';
        console.log(`  ${chalk.bold(c.entity_type)} #${c.entity_id}  v${c.version}  ${verb}  ${date}`);
      }
    } catch (error) { spinner.fail(chalk.red('Failed')); console.error(chalk.red(`  ${handleApiError(error).message}`)); }
  });

// ── Universal Entity Rollback ───────────────────────────────────
rollbackCommand
  .command('entity <type> <id>')
  .description('Rollback any entity to a previous version')
  .requiredOption('--to <version>', 'Version to restore')
  .option('--yes', 'Skip confirmation')
  .option('--json', 'Output as JSON')
  .action(async (type: string, id: string, opts: any) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const version = parseInt(opts.to);
    if (!opts.yes) {
      const inquirer = (await import('inquirer')).default;
      const { confirm } = await inquirer.prompt([{ type: 'confirm', name: 'confirm', message: `Rollback ${type} #${id} to version ${version}?`, default: false }]);
      if (!confirm) { console.log(chalk.dim('Cancelled.')); return; }
    }
    const spinner = ora(`Rolling back ${type} #${id} to v${version}...`).start();
    try {
      const res = await apiClient.post('/api/v1/agent/history/rollback', {
        entity_type: type, entity_id: parseInt(id), version,
      });
      const data = res.data as Record<string, any>;
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(data, null, 2)); return; }
      if (data.status === 'rolled_back') {
        spinner.succeed(chalk.green(`Rolled back ${type} #${id} to v${version} (${(data.restored_fields || []).length} fields restored)`));
      } else {
        spinner.fail(chalk.red(data.summary || 'Rollback failed'));
      }
    } catch (error) { spinner.fail(chalk.red('Failed')); console.error(chalk.red(`  ${handleApiError(error).message}`)); }
  });


import { appendExamples as __ae_history } from '../lib/command-kit';
__ae_history(historyCommand, [
  { cmd: 'solid history pages <slug>',           why: 'Version history for a page' },
  { cmd: 'solid history kb <id>',                why: 'KB entry versions' },
  { cmd: 'solid history entity contacts 42',     why: 'Contact change history' },
  { cmd: 'solid history entity products',        why: 'All product changes' },
  { cmd: 'solid history recent',                 why: 'All recent changes across the company' },
  { cmd: 'solid rollback entity contacts 42 --to 1', why: 'Restore contact to version 1' },
]);
