/**
 * CMS Page commands for Solid CLI
 *
 * solid pages list                              → List all pages
 * solid pages get <id>                          → View page details
 * solid pages create --title X --slug y         → Create page (empty shell; backend hydrates starter sections by page_type)
 * solid pages create --title X --slug y --layout-json ./home.json
 *                                               → Create page with inline content from a local JSON file
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
  .option('--layout-json <file>', 'Path to a JSON file containing layout_json (e.g., {"sections": [...]})')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    // Optional: inline layout from a JSON file. Omit to let the backend
    // hydrate an industry-shaped starter for home/about/contact/services
    // (or a hero-only fallback for other page_types).
    let layoutJson: unknown;
    if (options.layoutJson) {
      const fs = await import('fs');
      let raw: string;
      try {
        raw = fs.readFileSync(options.layoutJson, 'utf-8');
      } catch (e) {
        console.error(chalk.red(`Could not read --layout-json file: ${options.layoutJson}`));
        console.error(chalk.red(`  ${(e as Error).message}`));
        process.exit(1);
      }
      try {
        layoutJson = JSON.parse(raw);
      } catch {
        console.error(chalk.red(`Invalid JSON in --layout-json file: ${options.layoutJson}`));
        process.exit(1);
      }
      // Only assert it's a JSON object — the CMS layout envelope is defined
      // by the backend (current: `{"sections": [...]}`). Keeping the CLI-side
      // check loose means schema evolution on the server doesn't require a
      // CLI release. The backend will reject malformed shapes.
      if (typeof layoutJson !== 'object' || layoutJson === null || Array.isArray(layoutJson)) {
        console.error(chalk.red('--layout-json file must contain a JSON object.'));
        console.error(chalk.dim('  See Owners-Manual/71-Agent-Native-CLI/05-BLOCK-SCHEMA.md for the current block schema.'));
        process.exit(1);
      }
    }

    const spinner = ora(`Creating page "${options.title}"...`).start();

    try {
      const payload: Record<string, unknown> = {
        title: options.title,
        slug: options.slug,
        page_type: options.type,
        is_published: options.publish || false,
      };
      if (layoutJson !== undefined) {
        payload.layout_json = layoutJson;
      }
      const response = await apiClient.pageCreate(payload);

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

// Update page
pagesCommand
  .command('update <id>')
  .description('Update page metadata + optional custom <head>/<body> injection (Professional+ tier)')
  .option('--title <title>', 'New title')
  .option('--slug <slug>', 'New slug')
  .option('--type <type>', 'New page type')
  .option('--publish', 'Publish the page')
  .option('--unpublish', 'Unpublish the page')
  // T7 — accept either a file path OR inline HTML string
  .option('--custom-head <file-or-html>', 'Replace page <head> injection (path to .html file or inline string). Professional+.')
  .option('--custom-body-start <file-or-html>', 'Replace start-of-<body> injection. Professional+.')
  .option('--custom-body-end <file-or-html>', 'Replace end-of-<body> injection (late scripts). Professional+.')
  .option('--clear-custom-head', 'Remove existing <head> injection')
  .option('--clear-custom-body-start', 'Remove start-of-<body> injection')
  .option('--clear-custom-body-end', 'Remove end-of-<body> injection')
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

    // Resolve --custom-* value: if the value is an existing file path,
    // read it; otherwise treat it as a literal HTML string.
    const resolveInjection = async (value: string | undefined): Promise<string | undefined> => {
      if (value === undefined) return undefined;
      const fs = await import('fs');
      const path = await import('path');
      const abs = path.resolve(value);
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        return fs.readFileSync(abs, 'utf-8');
      }
      return value; // inline string
    };

    const body: Record<string, unknown> = {};
    if (options.title) body.title = options.title;
    if (options.slug) body.slug = options.slug;
    if (options.type) body.page_type = options.type;
    if (options.publish) body.is_published = true;
    if (options.unpublish) body.is_published = false;

    if (options.customHead !== undefined) body.custom_head = await resolveInjection(options.customHead);
    if (options.customBodyStart !== undefined) body.custom_body_start = await resolveInjection(options.customBodyStart);
    if (options.customBodyEnd !== undefined) body.custom_body_end = await resolveInjection(options.customBodyEnd);
    if (options.clearCustomHead) body.custom_head = '';
    if (options.clearCustomBodyStart) body.custom_body_start = '';
    if (options.clearCustomBodyEnd) body.custom_body_end = '';

    if (Object.keys(body).length === 0) {
      console.error(chalk.red('Provide at least one field (--title/--slug/--type/--publish/--unpublish/--custom-head/...).'));
      process.exit(1);
    }

    const spinner = ora(`Updating page #${pageId}...`).start();
    try {
      await apiClient.pageUpdate(pageId, body);
      spinner.succeed(chalk.green(`Page #${pageId} updated`));
      if (body.custom_head || body.custom_body_start || body.custom_body_end) {
        console.log(chalk.dim('  Custom injection applied — reload the page to see it live.'));
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to update page'));
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

// Lookup by slug
pagesCommand
  .command('slug <slug>')
  .description('Get a page by slug (path)')
  .option('--json', 'Output as JSON')
  .action(async (slug: string, options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }
    const spinner = ora(`Looking up /${slug}...`).start();
    try {
      const res = await apiClient.get(`/api/v1/cms/pages/slug/${slug}`);
      const p = res.data as Record<string, any>;
      if (options.json) { spinner.stop(); console.log(JSON.stringify(p, null, 2)); return; }
      spinner.succeed(chalk.green(`Page: ${p.title}`));
      console.log('');
      console.log(`  ${chalk.dim('ID:')}        ${p.id}`);
      console.log(`  ${chalk.dim('Slug:')}      /${p.slug}`);
      console.log(`  ${chalk.dim('Type:')}      ${p.page_type || '—'}`);
      console.log(`  ${chalk.dim('Published:')} ${p.is_published ?? false}`);
    } catch (error) {
      spinner.fail(chalk.red('Failed to look up page'));
      console.error(chalk.red(`  ${handleApiError(error).message}`));
    }
  });

// Coming soon page
pagesCommand
  .command('coming-soon')
  .description("Bootstrap a 'Coming Soon' placeholder page for the company website")
  .action(async () => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }
    const spinner = ora('Creating coming-soon page...').start();
    try {
      const res = await apiClient.post('/api/v1/cms/pages/coming-soon', {});
      const p = res.data as Record<string, any>;
      spinner.succeed(chalk.green(`Coming-soon page created: ${p.id || ''}`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to create coming-soon page'));
      console.error(chalk.red(`  ${handleApiError(error).message}`));
    }
  });

// Regenerate the entire website
pagesCommand
  .command('regenerate')
  .description('Re-generate the entire website from current company KB + brand')
  .action(async () => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }
    const spinner = ora('Regenerating website (this can take a minute)...').start();
    try {
      const res = await apiClient.post('/api/v1/cms/pages/regenerate-website', {});
      const r = res.data as Record<string, any>;
      spinner.succeed(chalk.green('Website regenerated'));
      if (r.pages_generated !== undefined) console.log(chalk.dim(`  ${r.pages_generated} pages generated`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to regenerate'));
      console.error(chalk.red(`  ${handleApiError(error).message}`));
    }
  });

// Generate a whole website (vs single page)
pagesCommand
  .command('site-generate')
  .description('Generate a complete multi-page website from a prompt')
  .requiredOption('--prompt <text>', 'High-level description of the business and tone')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }
    const spinner = ora('Generating website (1-2 minutes)...').start();
    try {
      const res = await apiClient.post('/api/v1/cms/pages/websites/generate', { prompt: options.prompt });
      const r = res.data as Record<string, any>;
      spinner.succeed(chalk.green(`Website generated: ${r.pages_count ?? r.pages?.length ?? '?'} pages`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to generate website'));
      console.error(chalk.red(`  ${handleApiError(error).message}`));
    }
  });
