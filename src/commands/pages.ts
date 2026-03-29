/**
 * CMS Page commands for Solid CLI
 *
 * solid pages list                              → List all pages
 * solid pages get <id>                          → View page details
 * solid pages create --title "Services" --slug services  → Create page
 * solid pages publish <id>                      → Publish page
 * solid pages unpublish <id>                    → Unpublish page
 * solid pages delete <id>                       → Delete page
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

      const pages = (response.data as Record<string, any>).pages || [];
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

// Get page details
pagesCommand
  .command('get <id>')
  .description('View page details')
  .option('--json', 'Output as JSON')
  .action(async (id: string, options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const pageId = parseInt(id, 10);
    if (isNaN(pageId)) {
      console.error(chalk.red('Invalid page ID.'));
      process.exit(1);
    }

    const spinner = ora(`Loading page #${pageId}...`).start();

    try {
      const response = await apiClient.pageGet(pageId);

      if (options.json) {
        spinner.stop();
        console.log(JSON.stringify(response.data, null, 2));
        return;
      }

      const page = (response.data as Record<string, any>).page || response.data;
      spinner.succeed(chalk.green(page.title || `Page #${pageId}`));

      console.log('');
      console.log(`  ${chalk.bold('ID:')}        ${page.id}`);
      console.log(`  ${chalk.bold('Title:')}     ${page.title || chalk.dim('(none)')}`);
      console.log(`  ${chalk.bold('Slug:')}      /${page.slug}`);
      console.log(`  ${chalk.bold('Type:')}      ${page.page_type || 'website'}`);
      console.log(`  ${chalk.bold('Published:')} ${page.is_published ? chalk.green('Yes') : chalk.yellow('No')}`);
      if (page.meta_description) {
        console.log(`  ${chalk.bold('Meta:')}      ${page.meta_description.substring(0, 80)}...`);
      }
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red('Failed to load page'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Create page
pagesCommand
  .command('create')
  .description('Create a new page')
  .requiredOption('--title <title>', 'Page title')
  .requiredOption('--slug <slug>', 'URL slug (e.g., services)')
  .option('--type <type>', 'Page type (home, about, services, contact, blog, landing)', 'website')
  .option('--publish', 'Publish immediately')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const spinner = ora(`Creating page "${options.title}"...`).start();

    try {
      const response = await apiClient.pageCreate({
        title: options.title,
        slug: options.slug,
        page_type: options.type,
        is_published: options.publish || false,
      });

      const data = response.data as Record<string, any>;
      const page = data.page || data;
      spinner.succeed(chalk.green(`Page created: ${page.title || options.title}`));

      console.log('');
      console.log(`  ${chalk.dim('ID:')}   ${page.id}`);
      console.log(`  ${chalk.dim('Slug:')} /${page.slug || options.slug}`);
      console.log('');
      if (!options.publish) {
        console.log(chalk.dim('  Publish: ') + chalk.cyan(`solid pages publish ${page.id}`));
      }
      console.log(chalk.dim('  Edit in browser: ') + chalk.cyan(`/dashboard/cms/builder/${page.id}`));
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red('Failed to create page'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Delete page
pagesCommand
  .command('delete <id>')
  .description('Delete a page by ID')
  .action(async (id: string) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const pageId = parseInt(id, 10);
    if (isNaN(pageId)) {
      console.error(chalk.red('Invalid page ID.'));
      process.exit(1);
    }

    const spinner = ora(`Deleting page #${pageId}...`).start();

    try {
      await apiClient.pageDelete(pageId);
      spinner.succeed(chalk.green(`Page #${pageId} deleted`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to delete page'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Generate page with AI
pagesCommand
  .command('generate <prompt>')
  .description('Generate a page with AI (e.g., "pricing page for plumbing services")')
  .option('--publish', 'Publish immediately')
  .action(async (prompt: string, options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const ora = (await import('ora')).default;
    const spinner = ora('Generating page with AI...').start();

    try {
      const response = await apiClient.post('/api/v1/cms/pages/ai/generate', {
        prompt,
        auto_publish: options.publish || false,
      });

      const data = response.data as Record<string, any>;
      const page = data.page || data;
      spinner.succeed(chalk.green(`Page generated: ${page.title || 'New Page'}`));

      console.log('');
      console.log(`  ${chalk.dim('ID:')}    ${page.id}`);
      console.log(`  ${chalk.dim('Title:')} ${page.title}`);
      console.log(`  ${chalk.dim('Slug:')}  /${page.slug}`);
      console.log('');
      if (!options.publish) {
        console.log(chalk.dim('  Publish: ') + chalk.cyan(`solid pages publish ${page.id}`));
      }
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red('Failed to generate page'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });
