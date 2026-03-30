import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';
import * as readline from 'readline';

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
  return d.toLocaleString();
}

function statusBadge(status: string): string {
  switch (status) {
    case 'active': return chalk.green('● active');
    case 'promoted': return chalk.cyan('▲ promoted');
    case 'expired': return chalk.dim('○ expired');
    default: return chalk.dim(status);
  }
}

export const deployCommand = new Command('deploy')
  .description('Create preview deployments with shareable URLs for client approval')
  .argument('[action]', 'Action: preview, list, promote, expire, get')
  .argument('[token]', 'Preview token (for promote/expire/get)')
  .option('-t, --title <title>', 'Name for this preview')
  .option('--ttl <hours>', 'Hours until preview expires (default: 72)', '72')
  .option('--pages-only', 'Only include pages in preview')
  .option('--kb-only', 'Only include KB in preview')
  .option('-s, --status <status>', 'Filter list by status: active, promoted, expired')
  .option('-n, --limit <number>', 'Number of results', '20')
  .option('-y, --yes', 'Skip confirmation')
  .option('--json', 'Output as JSON')
  .action(async (action, token, options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run: solid auth login'));
      return;
    }

    // Default action = preview (create a new one)
    if (!action || action === 'preview' || action === 'create') {
      const spinner = ora('Creating preview deployment...').start();
      try {
        const res = await apiClient.previewCreate({
          title: options.title,
          ttl_hours: parseInt(options.ttl, 10),
          pages_only: options.pagesOnly || false,
          kb_only: options.kbOnly || false,
        });
        spinner.succeed(chalk.green('Preview deployment created'));
        const data = res.data as any;

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        const preview = data.preview;
        console.log('');
        console.log(ui.successBox('Preview Ready', [
          `URL: ${chalk.bold.underline(data.preview_url)}`,
          '',
          `Pages: ${preview.page_count}`,
          `KB Entries: ${preview.kb_count}`,
          `Expires: ${formatDate(preview.expires_at)}`,
          preview.title ? `Title: ${preview.title}` : '',
          '',
          chalk.dim('Share this URL with your client for approval.'),
          chalk.dim('No login required — the link IS the access.'),
        ].filter(Boolean)));
        console.log('');
        console.log(chalk.dim('  Promote to live:  solid deploy promote ' + preview.preview_token));
        console.log(chalk.dim('  Cancel:           solid deploy expire ' + preview.preview_token));
        console.log(chalk.dim('  List all:         solid deploy list'));
        console.log('');
      } catch (error) {
        spinner.fail(chalk.red('Failed to create preview'));
        const apiError = handleApiError(error);
        console.error(chalk.red(`  ${apiError.message}`));
      }
      return;
    }

    // List previews
    if (action === 'list' || action === 'ls') {
      const spinner = ora('Loading previews...').start();
      try {
        const res = await apiClient.previewList(options.status, parseInt(options.limit, 10));
        spinner.succeed(chalk.green('Previews loaded'));
        const data = res.data as any;

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        console.log('');
        if (data.previews.length === 0) {
          console.log(chalk.dim('  No preview deployments found.'));
          console.log(chalk.dim('  Create one: solid deploy preview'));
        } else {
          const rows = data.previews.map((p: any) => [
            statusBadge(p.status),
            p.title || chalk.dim('untitled'),
            `${p.page_count}p / ${p.kb_count}kb`,
            p.preview_token.substring(0, 12) + '...',
            formatDate(p.created_at),
            formatDate(p.expires_at),
          ]);
          console.log(ui.table(['Status', 'Title', 'Content', 'Token', 'Created', 'Expires'], rows));
        }
        console.log('');
      } catch (error) {
        spinner.fail(chalk.red('Failed to list previews'));
        const apiError = handleApiError(error);
        console.error(chalk.red(`  ${apiError.message}`));
      }
      return;
    }

    // Promote preview to live
    if (action === 'promote') {
      if (!token) {
        console.error(chalk.red('Token required. Usage: solid deploy promote <token>'));
        return;
      }

      // Show preview details first
      const infoSpinner = ora('Loading preview...').start();
      try {
        const infoRes = await apiClient.previewGet(token);
        infoSpinner.succeed(chalk.green('Preview found'));
        const preview = infoRes.data as any;

        console.log('');
        console.log(ui.infoBox('Promote to Live', [
          `Title: ${preview.title || 'untitled'}`,
          `Pages: ${preview.page_count}`,
          `KB Entries: ${preview.kb_count}`,
          `Created: ${formatDate(preview.created_at)}`,
          '',
          chalk.yellow('This will overwrite your current live site with this preview.'),
        ]));
        console.log('');

        if (!options.yes) {
          const proceed = await confirm(chalk.bold('  Promote this preview to live? (y/N) '));
          if (!proceed) {
            console.log(chalk.dim('  Cancelled.'));
            return;
          }
        }

        const promoteSpinner = ora('Promoting to live...').start();
        const res = await apiClient.previewPromote(token);
        promoteSpinner.succeed(chalk.green('Preview promoted to live'));
        const data = res.data as any;

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        console.log('');
        console.log(ui.successBox('Live!', [
          data.message,
          '',
          `Pages updated: ${data.pages_promoted}`,
          `KB entries updated: ${data.kb_promoted}`,
        ]));
        console.log('');
      } catch (error) {
        infoSpinner.fail(chalk.red('Promote failed'));
        const apiError = handleApiError(error);
        console.error(chalk.red(`  ${apiError.message}`));
      }
      return;
    }

    // Expire/cancel preview
    if (action === 'expire' || action === 'cancel' || action === 'delete') {
      if (!token) {
        console.error(chalk.red('Token required. Usage: solid deploy expire <token>'));
        return;
      }

      const spinner = ora('Expiring preview...').start();
      try {
        await apiClient.previewExpire(token);
        spinner.succeed(chalk.green('Preview expired'));
        console.log('');
        console.log(chalk.dim('  The preview URL is no longer accessible.'));
        console.log('');
      } catch (error) {
        spinner.fail(chalk.red('Failed to expire preview'));
        const apiError = handleApiError(error);
        console.error(chalk.red(`  ${apiError.message}`));
      }
      return;
    }

    // Get preview detail
    if (action === 'get' || action === 'info') {
      if (!token) {
        console.error(chalk.red('Token required. Usage: solid deploy get <token>'));
        return;
      }

      const spinner = ora('Loading preview...').start();
      try {
        const res = await apiClient.previewGet(token);
        spinner.succeed(chalk.green('Preview loaded'));
        const data = res.data as any;

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        console.log('');
        console.log(ui.infoBox(`Preview: ${data.title || 'untitled'}`, [
          `Status: ${statusBadge(data.status)}`,
          `Token: ${data.preview_token}`,
          `URL: ${data.preview_url}`,
          `Pages: ${data.page_count}`,
          `KB Entries: ${data.kb_count}`,
          `Created: ${formatDate(data.created_at)}`,
          `Expires: ${formatDate(data.expires_at)}`,
          data.promoted_at ? `Promoted: ${formatDate(data.promoted_at)}` : '',
        ].filter(Boolean)));
        console.log('');
      } catch (error) {
        spinner.fail(chalk.red('Failed to load preview'));
        const apiError = handleApiError(error);
        console.error(chalk.red(`  ${apiError.message}`));
      }
      return;
    }

    console.error(chalk.red(`Unknown action: ${action}. Use: preview, list, promote, expire, get`));
  });
