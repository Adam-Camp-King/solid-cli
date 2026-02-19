/**
 * CMS Page commands for Solid CLI
 *
 * All operations are scoped to the authenticated company_id.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';

export const pagesCommand = new Command('pages')
  .description('Website page management');

// List pages
pagesCommand
  .command('list')
  .description('List CMS pages')
  .option('--type <type>', 'Filter by page type (website, landing, blog, booking)')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const spinner = ora('Loading pages...').start();

    try {
      const params: any = {};
      if (options.type) params.page_type = options.type;

      const response = await apiClient.pagesList(params);

      if (options.json) {
        spinner.stop();
        console.log(JSON.stringify(response.data, null, 2));
        return;
      }

      const pages = (response.data as any).pages || [];
      spinner.succeed(chalk.green(`${pages.length} pages`));

      if (pages.length === 0) {
        console.log(chalk.dim('  No pages yet. Use the website builder to create pages.'));
        return;
      }

      console.log('');
      for (const page of pages) {
        const status = page.is_published
          ? chalk.green('published')
          : chalk.yellow('draft');
        const type = page.page_type ? chalk.cyan(`[${page.page_type}]`) : '';
        console.log(`  ${chalk.bold(page.title)} ${type} ${status}`);
        console.log(chalk.dim(`    /${page.slug}  ID: ${page.id}`));
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to load pages'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Publish a page
pagesCommand
  .command('publish <id>')
  .description('Publish a page by ID')
  .action(async (id) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const spinner = ora(`Publishing page #${id}...`).start();

    try {
      await apiClient.pagesPublish(parseInt(id));
      spinner.succeed(chalk.green(`Page #${id} published`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to publish page'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Unpublish a page
pagesCommand
  .command('unpublish <id>')
  .description('Unpublish a page by ID')
  .action(async (id) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const spinner = ora(`Unpublishing page #${id}...`).start();

    try {
      await apiClient.pagesUnpublish(parseInt(id));
      spinner.succeed(chalk.green(`Page #${id} unpublished`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to unpublish page'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });
