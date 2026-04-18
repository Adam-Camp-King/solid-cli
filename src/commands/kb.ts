/**
 * Knowledge Base commands for Solid CLI
 *
 * All operations are scoped to the authenticated company_id.
 * Users can only see/modify their own company's KB entries.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';

export const kbCommand = new Command('kb')
  .description('Knowledge base management');

// List KB entries
kbCommand
  .command('list')
  .description('List knowledge base entries')
  .option('-q, --query <query>', 'Search query', '*')
  .option('-l, --limit <limit>', 'Page size', '20')
  .option('--offset <n>', 'Pagination offset', '0')
  .option('--all', 'Auto-paginate every page')
  .option('--quiet', 'Suppress spinner and success chrome')
  .option('--json', 'Output as JSON')
  .action(async (options: { query: string; limit: string; offset: string; all?: boolean; quiet?: boolean; json?: boolean }) => {
    const { run, applyListSort, renderDelimited, getListFormat, fetchAllPages } = await import('../lib/command-kit');
    const { isJsonOutput } = await import('../lib/json-output');

    await run<{ results: Record<string, unknown>[] }>(
      async () => {
        if (options.all) {
          const items = await fetchAllPages<Record<string, unknown>, unknown>(
            async (offset, limit) => (await apiClient.kbSearch(options.query, limit, offset)).data as unknown,
            (page) => (page as { results?: Record<string, unknown>[] }).results || [],
            { limit: 100 },
          );
          return { results: items };
        }
        const res = await apiClient.kbSearch(
          options.query,
          parseInt(options.limit, 10),
          parseInt(options.offset, 10),
        );
        return { results: (res.data.results || []) as Record<string, unknown>[] };
      },
      {
        spinner: 'Loading KB entries...',
        errorText: 'Failed to load KB entries',
        quiet: options.quiet,
        json: isJsonOutput(options),
        render: (data) => {
          const fmt = getListFormat();
          const items = data.results;
          applyListSort(items);
          if (fmt === 'csv' || fmt === 'tsv') {
            process.stdout.write(renderDelimited(items, fmt));
            return;
          }
          if (!items.length) {
            console.log(chalk.dim('  No KB entries yet. Run `solid kb add` to create one.'));
            return;
          }
          console.log('');
          for (const entry of items) {
            const category = entry.category ? chalk.cyan(`[${entry.category}]`) : '';
            console.log(`  ${chalk.bold((entry.title as string) || 'Untitled')} ${category}`);
            if (entry.content) {
              const content = String(entry.content);
              const preview = content.substring(0, 80).replace(/\n/g, ' ');
              console.log(chalk.dim(`    ${preview}${content.length > 80 ? '...' : ''}`));
            }
            if (entry.id !== undefined) console.log(chalk.dim(`    ID: ${entry.id}`));
            console.log('');
          }
        },
      },
    );
  });

// Add KB entry
kbCommand
  .command('add')
  .description('Add a knowledge base entry')
  .option('-t, --title <title>', 'Entry title')
  .option('-c, --content <content>', 'Entry content')
  .option('--category <category>', 'Category (general, services, faq, about, products)')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    let { title, content, category } = options;

    if (!title || !content) {
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'title',
          message: 'Title:',
          when: !title,
          validate: (input) => input.length > 0 || 'Title is required',
        },
        {
          type: 'editor',
          name: 'content',
          message: 'Content (opens editor):',
          when: !content,
        },
        {
          type: 'list',
          name: 'category',
          message: 'Category:',
          choices: ['general', 'services', 'faq', 'about', 'products', 'billing', 'support'],
          when: !category,
        },
      ]);
      title = title || answers.title;
      content = content || answers.content;
      category = category || answers.category;
    }

    const spinner = ora('Creating KB entry...').start();

    try {
      const response = await apiClient.kbCreate({ title, content, category });
      spinner.succeed(chalk.green(`KB entry created: "${title}"`));
      if ((response.data as Record<string, any>).id) {
        console.log(chalk.dim(`  ID: ${(response.data as Record<string, any>).id}`));
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to create KB entry'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Update KB entry
kbCommand
  .command('update <id>')
  .description('Update a knowledge base entry')
  .option('--title <title>', 'New title')
  .option('--content <text>', 'New content')
  .option('--category <category>', 'New category')
  .action(async (id: string, options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }
    const entryId = parseInt(id, 10);
    if (isNaN(entryId)) {
      console.error(chalk.red('Invalid entry ID.'));
      process.exit(1);
    }
    const body: { title?: string; content?: string; category?: string } = {};
    if (options.title) body.title = options.title;
    if (options.content) body.content = options.content;
    if (options.category) body.category = options.category;
    if (Object.keys(body).length === 0) {
      console.error(chalk.red('Provide at least one field to update (--title, --content, --category).'));
      process.exit(1);
    }
    const spinner = ora(`Updating KB entry #${entryId}...`).start();
    try {
      await apiClient.kbUpdate(entryId, body);
      spinner.succeed(chalk.green(`KB entry #${entryId} updated`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to update KB entry'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Delete KB entry
kbCommand
  .command('delete <id>')
  .description('Delete a knowledge base entry by ID (prompts by default)')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (id: string, opts: { yes?: boolean }) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const { confirm } = await import('../lib/command-kit');
    const ok = await confirm(
      `Delete KB entry #${id}? This cannot be undone.`,
      { autoConfirm: Boolean(opts.yes) },
    );
    if (!ok) { console.error(chalk.dim('  Cancelled.')); process.exit(1); }

    const spinner = ora({ text: 'Deleting KB entry...', stream: process.stderr }).start();

    try {
      await apiClient.kbDelete(parseInt(id, 10));
      spinner.succeed(chalk.green(`KB entry #${id} deleted`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to delete KB entry'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
      process.exit(1);
    }
  });
