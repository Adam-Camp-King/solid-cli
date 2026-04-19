/**
 * solid drafts — Manage pending CMS page drafts (T12).
 *
 * Today's default: PATCHing a published page writes to a DRAFT, not live.
 * The live page shows the old version to visitors until the agency runs
 * `solid publish <id>` (or `solid publish --all`) to promote.
 *
 * Subcommands:
 *   solid drafts list                       List pages with pending drafts
 *   solid drafts preview <page_id>          Get a shareable preview URL (HMAC-signed token, 24h default)
 *   solid drafts discard <page_id>          Throw away the pending draft, keep live unchanged
 *
 * See also:
 *   solid publish <page_id> | --all         Promote draft(s) to live
 *   solid pages update <id> --publish       Opt-out of drafts for this one update (instant-live)
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { isJsonOutput } from '../lib/json-output';

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

export const draftsCommand = new Command('drafts')
  .description('Pending CMS page drafts — list, preview, discard (pair with `solid publish`)');

{
  const { withListFlags } = require('../lib/command-kit') as typeof import('../lib/command-kit');
  const listCmd = draftsCommand.command('list').alias('ls').description('List pages with a pending draft awaiting publish');
  withListFlags(listCmd);
  listCmd.action(async (opts: import('../lib/command-kit').ListFlags) => {
    requireAuth();
    const { runListCommand } = await import('../lib/command-kit');
    await runListCommand(opts, {
      spinnerText: 'Loading pending drafts...',
      errorText: 'Failed to load drafts',
      fetch: async () => (await apiClient.get('/api/v1/cms/pages/drafts/list')).data,
      extract: (page) => {
        const d = page as Record<string, unknown>;
        return ((d.drafts || d.items || []) as Array<Record<string, unknown>>);
      },
      render: (items) => {
        if (!items.length) {
          console.log(chalk.dim('  Nothing to publish. Run `solid pages update <id> --title ...` to create a draft.'));
          return;
        }
        console.log('');
        for (const d of items) {
          const parts: string[] = [];
          if (d.has_layout_draft) parts.push('layout');
          if (d.has_meta_draft) parts.push('meta');
          const fields = parts.join('+');
          const when = d.draft_updated_at ? chalk.dim(String(d.draft_updated_at).split('.')[0].replace('T', ' ')) : '';
          const who = d.draft_updated_by_user_id ? chalk.dim(`by user ${d.draft_updated_by_user_id}`) : '';
          const live = d.is_published ? chalk.green('live') : chalk.yellow('unpublished');
          console.log(`  ${chalk.bold(String(d.page_id))}  ${d.title || chalk.dim('(untitled)')}  /${d.slug || ''}  [${fields}]  ${live}  ${when} ${who}`);
        }
        console.log('');
        console.log(chalk.dim(`  Publish one:  solid publish <page_id>`));
        console.log(chalk.dim(`  Publish all:  solid publish --all`));
      },
    });
  });
}

draftsCommand
  .command('preview <page_id>')
  .description('Generate a shareable, HMAC-signed preview URL for the current draft')
  .option('--hours <n>', 'URL validity window in hours (1-168)', '24')
  .option('--json', 'Output as JSON')
  .action(async (pageId, opts) => {
    requireAuth();
    const ttl = parseInt(opts.hours, 10) || 24;
    const spinner = ora(`Minting preview link for page ${pageId}...`).start();
    try {
      const res = await apiClient.post(`/api/v1/cms/pages/${pageId}/preview-link?ttl_hours=${ttl}`);
      const r = res.data as Record<string, any>;
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(r, null, 2)); return; }
      spinner.succeed(chalk.green('Preview link'));
      console.log('');
      console.log(`  ${chalk.bold('URL:')}        ${chalk.cyan(r.preview_url)}`);
      console.log(`  ${chalk.bold('Expires:')}    ${r.expires_at}`);
      console.log(`  ${chalk.bold('Has draft:')}  ${r.has_draft ? 'yes' : chalk.dim('no — preview shows live')}`);
      console.log('');
      console.log(chalk.dim('  Share this URL with clients for review before publishing.'));
    } catch (error) { fail(spinner, 'Preview link failed', error); }
  });

draftsCommand
  .command('discard <page_id>')
  .description('Discard the pending draft on a page. Live version is untouched.')
  .action(async (pageId) => {
    requireAuth();
    const spinner = ora(`Discarding draft on page ${pageId}...`).start();
    try {
      await apiClient.post(`/api/v1/cms/pages/${pageId}/discard-draft`);
      spinner.succeed(chalk.green(`Draft discarded on page ${pageId}`));
    } catch (error) { fail(spinner, 'Discard failed', error); }
  });

import { appendExamples as __ae_drafts } from '../lib/command-kit';
__ae_drafts(draftsCommand, [
  { cmd: 'solid drafts list',          why: 'Pages awaiting publish' },
  { cmd: 'solid drafts preview <id>',  why: 'Shareable preview URL' },
  { cmd: 'solid drafts discard <id>',  why: 'Throw away a draft' },
  { cmd: 'solid publish <id>',         why: 'Promote draft → live (separate command)' },
]);
