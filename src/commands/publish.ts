/**
 * solid publish — Promote CMS page draft(s) to live (T12).
 *
 *   solid publish <page_id>     Promote the pending draft on one page + flip is_published
 *   solid publish --all         Promote every pending draft in this company
 *
 * Pairs with `solid drafts list` + `solid pages update <id>`.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
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

export const publishCommand = new Command('publish')
  .description('Promote pending CMS page drafts to live (T12)')
  .argument('[page_id]', 'Page ID to publish (omit with --all)')
  .option('--all', 'Publish every pending draft in this company')
  .action(async (pageId: string | undefined, opts) => {
    requireAuth();

    if (opts.all && pageId) {
      console.error(chalk.red('Pass EITHER a <page_id> OR --all, not both.'));
      process.exit(1);
    }
    if (!opts.all && !pageId) {
      console.error(chalk.red('Pass a <page_id> or use --all.'));
      process.exit(1);
    }

    if (opts.all) {
      const spinner = ora('Publishing all pending drafts...').start();
      try {
        const res = await apiClient.post('/api/v1/cms/pages/drafts/publish-all');
        const r = res.data as Record<string, any>;
        if (r.promoted === 0) {
          spinner.info(chalk.yellow('No pending drafts to promote'));
          return;
        }
        spinner.succeed(chalk.green(`Promoted ${r.promoted} draft(s) → live`));
        for (const id of (r.page_ids as number[]) || []) {
          console.log(chalk.dim(`  ✓ page ${id}`));
        }
      } catch (error) { fail(spinner, 'publish-all failed', error); }
      return;
    }

    const id = parseInt(pageId!, 10);
    if (isNaN(id)) {
      console.error(chalk.red('Invalid page ID.'));
      process.exit(1);
    }
    const spinner = ora(`Publishing page ${id}...`).start();
    try {
      await apiClient.post(`/api/v1/cms/pages/${id}/publish`, {});
      spinner.succeed(chalk.green(`Page ${id} published`));
      console.log(chalk.dim(`  Pending draft (if any) was promoted to live.`));
    } catch (error) { fail(spinner, 'Publish failed', error); }
  });
