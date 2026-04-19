import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';
import * as readline from 'readline';
import { isJsonOutput } from '../lib/json-output';

function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase().startsWith('y'));
    });
  });
}

export const migrateCommand = new Command('migrate')
  .description('Migrate pages, KB, and settings from one company to another')
  .requiredOption('--from <id>', 'Source company ID')
  .requiredOption('--to <id>', 'Target company ID')
  .option('--pages-only', 'Only migrate pages')
  .option('--kb-only', 'Only migrate KB entries')
  .option('--include-settings', 'Also migrate website settings')
  .option('--pages <slugs>', 'Specific page slugs (comma-separated)')
  .option('--kb-ids <ids>', 'Specific KB entry IDs (comma-separated)')
  .option('--overwrite', 'Overwrite existing items on target (default: skip)')
  .option('--replace <pairs>', 'Find/replace in migrated content (e.g. "Acme:Beta Inc,old.com:new.com")')
  .option('-y, --yes', 'Skip confirmation')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run: solid auth login'));
      return;
    }

    const sourceId = parseInt(options.from, 10);
    const targetId = parseInt(options.to, 10);

    if (isNaN(sourceId) || isNaN(targetId)) {
      console.error(chalk.red('Company IDs must be numbers.'));
      return;
    }

    const migrateOptions: {
      source_company_id: number;
      target_company_id: number;
      include_pages?: boolean;
      include_kb?: boolean;
      include_settings?: boolean;
      page_slugs?: string[];
      kb_ids?: number[];
      overwrite_existing?: boolean;
    } = {
      source_company_id: sourceId,
      target_company_id: targetId,
      include_pages: !options.kbOnly,
      include_kb: !options.pagesOnly,
      include_settings: options.includeSettings || false,
      overwrite_existing: options.overwrite || false,
    };

    if (options.pages) {
      migrateOptions.page_slugs = options.pages.split(',').map((s: string) => s.trim());
    }
    if (options.kbIds) {
      migrateOptions.kb_ids = options.kbIds.split(',').map((s: string) => parseInt(s.trim(), 10));
    }

    // Always preview first
    const spinner = ora(`Analyzing migration: Company ${sourceId} → ${targetId}...`).start();
    try {
      const previewRes = await apiClient.migratePreview(migrateOptions);
      spinner.succeed(chalk.green('Migration analyzed'));
      const data = previewRes.data as Record<string, any>;
      const summary = data.summary;

      if (options.json && options.yes) {
        // JSON + auto-confirm = just execute
        const execRes = await apiClient.migrateExecute(migrateOptions);
        console.log(JSON.stringify(execRes.data, null, 2));
        return;
      }

      console.log('');
      const lines = [
        `Source: Company ${sourceId}`,
        `Target: Company ${targetId}`,
        '',
      ];

      if (migrateOptions.include_pages) {
        lines.push(chalk.bold('Pages:'));
        if (summary.pages_will_create > 0)
          lines.push(`  ${chalk.green('+')} ${summary.pages_will_create} new pages`);
        if (summary.pages_will_overwrite > 0)
          lines.push(`  ${chalk.yellow('~')} ${summary.pages_will_overwrite} overwrites`);
        if (summary.pages_skipped > 0)
          lines.push(`  ${chalk.dim('○')} ${summary.pages_skipped} skipped (already exist, use --overwrite)`);
        if (summary.pages_total === 0)
          lines.push(chalk.dim('  No pages to migrate'));
        lines.push('');
      }

      if (migrateOptions.include_kb) {
        lines.push(chalk.bold('Knowledge Base:'));
        if (summary.kb_will_create > 0)
          lines.push(`  ${chalk.green('+')} ${summary.kb_will_create} new entries`);
        if (summary.kb_will_overwrite > 0)
          lines.push(`  ${chalk.yellow('~')} ${summary.kb_will_overwrite} overwrites`);
        if (summary.kb_skipped > 0)
          lines.push(`  ${chalk.dim('○')} ${summary.kb_skipped} skipped (already exist, use --overwrite)`);
        if (summary.kb_total === 0)
          lines.push(chalk.dim('  No KB entries to migrate'));
        lines.push('');
      }

      if (migrateOptions.include_settings) {
        lines.push(`Settings: ${chalk.cyan('will copy')}`);
        lines.push('');
      }

      // Show detail table for pages
      if (data.details?.pages?.length > 0) {
        lines.push(chalk.dim('Page Details:'));
        for (const p of data.details.pages) {
          const icon = !p.will_apply ? chalk.dim('○') :
                       p.action === 'create' ? chalk.green('+') : chalk.yellow('~');
          lines.push(`  ${icon} ${p.slug} (${p.title}) — ${p.action}${!p.will_apply ? ' [skipped]' : ''}`);
        }
        lines.push('');
      }

      // Show detail table for KB
      if (data.details?.kb?.length > 0) {
        lines.push(chalk.dim('KB Details:'));
        for (const k of data.details.kb) {
          const icon = !k.will_apply ? chalk.dim('○') :
                       k.action === 'create' ? chalk.green('+') : chalk.yellow('~');
          lines.push(`  ${icon} ${k.title} (${k.category || '—'}) — ${k.action}${!k.will_apply ? ' [skipped]' : ''}`);
        }
        lines.push('');
      }

      console.log(ui.infoBox('Migration Preview', lines));
      console.log('');

      const totalChanges =
        summary.pages_will_create + summary.pages_will_overwrite +
        summary.kb_will_create + summary.kb_will_overwrite;

      if (totalChanges === 0) {
        console.log(chalk.yellow('  Nothing to migrate. All items already exist on target.'));
        console.log(chalk.dim('  Use --overwrite to update existing items.'));
        console.log('');
        return;
      }

      if (!options.yes) {
        const proceed = await confirm(chalk.bold(`  Execute migration? (${totalChanges} changes) (y/N) `));
        if (!proceed) {
          console.log(chalk.dim('  Cancelled.'));
          return;
        }
      }

      // Execute
      const execSpinner = ora('Executing migration...').start();
      const execRes = await apiClient.migrateExecute(migrateOptions);
      execSpinner.succeed(chalk.green('Migration complete'));
      const results = (execRes.data as Record<string, any>).results;

      if (isJsonOutput(options)) {
        console.log(JSON.stringify(execRes.data, null, 2));
        return;
      }

      console.log('');
      console.log(ui.successBox(`Migration: ${sourceId} → ${targetId}`, [
        `Pages created: ${results.pages_created}`,
        `Pages updated: ${results.pages_updated}`,
        `Pages skipped: ${results.pages_skipped}`,
        `KB created: ${results.kb_created}`,
        `KB updated: ${results.kb_updated}`,
        `KB skipped: ${results.kb_skipped}`,
        results.settings_applied ? 'Settings: applied' : '',
        '',
        chalk.dim('Migrated pages are unpublished by default.'),
        chalk.dim(`Switch to target: solid switch ${targetId}`),
      ].filter(Boolean)));
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red('Migration failed'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

import { appendExamples as __ae_migrate } from '../lib/command-kit';
__ae_migrate(migrateCommand, [
  { cmd: 'solid migrate --from 2 --to 61 --pages',              why: 'Copy pages between companies' },
  { cmd: 'solid migrate --from 2 --to 61 --kb --overwrite',     why: 'Copy KB + overwrite conflicts' },
  { cmd: 'solid migrate --from 2 --to 61 --settings',           why: 'Copy company settings only' },
]);
