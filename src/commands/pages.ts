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
import ora from '../lib/spinner';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { isJsonOutput } from '../lib/json-output';
import { fail } from '../lib/command-kit';
import { fetchSites, primarySite, publicUrlForPage, resolvePublicUrl, resolveSiteRef } from '../lib/page-url';

export const pagesCommand = new Command('pages')
  .description('Website page management');

// List pages — full scripting contract via withListFlags + runListCommand
{
  const { withListFlags } = require('../lib/command-kit') as typeof import('../lib/command-kit');
  const listCmd = pagesCommand.command('list').alias('ls').description('List CMS pages');
  withListFlags(listCmd);
  listCmd.option('--type <type>', 'Filter by page type (website, landing, blog, booking)');
  listCmd.action(async (opts: { type?: string } & import('../lib/command-kit').ListFlags) => {
    const { runListCommand } = await import('../lib/command-kit');
    await runListCommand(opts, {
      spinnerText: 'Loading pages...',
      errorText: 'Failed to load pages',
      fetch: async (offset, limit) => {
        const params: Record<string, unknown> = { limit, offset };
        if (opts.type) params.page_type = opts.type;
        return (await apiClient.pagesList(params)).data;
      },
      extract: (page) => {
        const d = page as Record<string, unknown>;
        return ((d.pages || d.items || []) as Array<Record<string, unknown>>);
      },
      render: (items) => {
        if (!items.length) { console.log(chalk.dim('  No pages yet. Use the website builder to create pages.')); return; }
        console.log('');
        for (const p of items) {
          const status = p.is_published ? chalk.green('published') : chalk.yellow('draft');
          const type = p.page_type ? chalk.cyan(`[${p.page_type}]`) : '';
          console.log(`  ${chalk.bold(String(p.title))} ${type} ${status}`);
          console.log(chalk.dim(`    /${p.slug}  ID: ${p.id}`));
        }
      },
    });
  });
}

// Publish a page
pagesCommand
  .command('publish <id>')
  .description('Publish a page by ID')
  .option('--wait', 'Poll the live URL until the change is actually being served')
  .option('--timeout <seconds>', 'How long --wait polls before giving up', '120')
  .option('--json', 'Output as JSON')
  .action(async (id, options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const spinner = ora(`Publishing page #${id}...`).start();

    try {
      await apiClient.pagesPublish(parseInt(id, 10));

      // "Published" is a database fact, not a visible one. The edge caches, and
      // replicas turn over independently — during one session two of them served
      // different versions of the same page for several minutes, and a change
      // that had worked was diagnosed as broken. Say which of the two happened.
      const where = await resolvePublicUrl(parseInt(id, 10));
      const page = where.page || {};
      const liveUrl = where.url;
      let served: boolean | null = null;

      if (options.wait && liveUrl) {
        spinner.text = `Published. Waiting for ${liveUrl} to serve it...`;
        served = await waitUntilServed(liveUrl, page, Number(options.timeout) || 120);
      }

      if (isJsonOutput(options)) {
        spinner.stop();
        console.log(JSON.stringify({
          page_id: Number(id),
          published: true,
          url: liveUrl,
          ...(where.url_basis ? { url_basis: where.url_basis } : {}),
          ...(where.url_unavailable_reason ? { url_unavailable_reason: where.url_unavailable_reason } : {}),
          site_id: where.site_id ?? page.site_id ?? null,
          // null = not checked (pass --wait to poll the live URL).
          serving: served,
        }, null, 2));
        return;
      }

      spinner.succeed(chalk.green(`Page #${id} published`));
      if (served === true) {
        console.log(chalk.dim(`  Live now: ${liveUrl}`));
      } else if (served === false) {
        console.log(chalk.yellow(`  Not being served yet after ${options.timeout}s — the edge is still turning over.`));
        console.log(chalk.dim(`  ${liveUrl}`));
      } else if (liveUrl) {
        console.log(chalk.dim(`  ${liveUrl} — may take a moment to turn over. Add --wait to block until it does.`));
      } else if (where.url_unavailable_reason) {
        console.log(chalk.yellow(`  No public URL: ${where.url_unavailable_reason}`));
      }
    } catch (error) {
      fail(spinner, 'Failed to publish page', error);
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
      fail(spinner, 'Failed to unpublish page', error);
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

      if (isJsonOutput(options)) {
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
      fail(spinner, 'Failed to load page', error);
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
  .option('--site <id|slug>', "Site to attach the page to (default: the company's primary site). See: solid site list")
  .option('--json', 'Output the created page as JSON')
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

    const json = isJsonOutput(options);
    const spinner = ora(`Creating page "${options.title}"...`).start();

    // ⛔ A PAGE WITH NO SITE IS SERVED NOWHERE BY SLUG. The public renderer
    // looks /<slug> up with the host's site_id, so a page created with
    // site_id null 404s on every host and is only reachable at /p/<slug>.
    // The backend does not default it (POST /cms/pages stores what it is
    // sent), so the CLI resolves --site, or the primary site, and sends it.
    let siteId: number | undefined;
    let siteNote: string | undefined;
    let sites: Array<Record<string, any>> = [];
    try {
      sites = await fetchSites();
    } catch (e) {
      if (options.site && !/^\d+$/.test(String(options.site))) {
        fail(spinner, 'Could not list sites to resolve --site', e);
      }
      siteNote = `site list unavailable: ${(e as Error).message}`;
    }
    if (options.site) {
      if (/^\d+$/.test(String(options.site)) && !sites.length) {
        siteId = parseInt(String(options.site), 10);
      } else {
        const r = resolveSiteRef(String(options.site), sites);
        if (!r.site) {
          spinner.stop();
          const { emitErrorAndExit } = await import('../lib/command-kit');
          emitErrorAndExit(Object.assign(new Error(r.error), {
            isAxiosError: true,
            response: { status: 404, data: { detail: r.error, reason: 'site_not_found' } },
          }));
        }
        siteId = Number(r.site!.id);
      }
    } else if (sites.length) {
      const primary = primarySite(sites);
      if (primary) siteId = Number(primary.id);
      else siteNote = `no single primary site among ${sites.length} sites — pass --site <id|slug>; page left unattached (reachable only at /p/<slug>)`;
    } else if (!siteNote) {
      siteNote = 'company has no sites — page left unattached';
    }

    try {
      const payload: Record<string, unknown> = {
        title: options.title,
        slug: options.slug,
        page_type: options.type,
        is_published: options.publish || false,
      };
      if (siteId !== undefined) payload.site_id = siteId;
      if (layoutJson !== undefined) {
        payload.layout_json = layoutJson;
      }
      const response = await apiClient.pageCreate(payload);

      const data = response.data as Record<string, any>;
      const page = data.page || data;

      // POST /cms/pages always stores is_published=false, whatever it is sent,
      // so --publish silently did nothing. Publish explicitly (paywall and
      // guardrails run there) and report what actually happened.
      let publishError: string | undefined;
      if (options.publish && page.id && !page.is_published) {
        try {
          await apiClient.pagesPublish(Number(page.id));
          page.is_published = true;
        } catch (e) {
          publishError = handleApiError(e).message;
          // Asked to publish and it did not happen: not a success.
          process.exitCode = 1;
        }
      }

      if (json) {
        spinner.stop();
        const where = publicUrlForPage(page, sites);
        console.log(JSON.stringify({
          ...page,
          ...(siteNote ? { site_note: siteNote } : {}),
          ...(publishError ? { publish_error: publishError } : {}),
          // Where it is (or will be, once published) served.
          public_url: where.url,
          ...(where.url_unavailable_reason ? { url_unavailable_reason: where.url_unavailable_reason } : {}),
          next: page.is_published ? undefined : `solid publish ${page.id}`,
        }, null, 2));
        return;
      }

      spinner.succeed(chalk.green(`Page created: ${page.title || options.title}`));
      if (page.site_id) console.log(chalk.dim(`  Site: ${page.site_id}`));
      if (siteNote) console.log(chalk.yellow(`  ${siteNote}`));
      if (publishError) console.log(chalk.red(`  Created, but publish failed: ${publishError}`));

      console.log('');
      console.log(`  ${chalk.dim('ID:')}   ${page.id}`);
      console.log(`  ${chalk.dim('Slug:')} /${page.slug || options.slug}`);
      console.log('');
      if (!page.is_published) {
        console.log(chalk.dim('  Publish: ') + chalk.cyan(`solid pages publish ${page.id}`));
      }
      console.log(chalk.dim('  Edit in browser: ') + chalk.cyan(`/dashboard/cms/builder/${page.id}`));
      console.log('');
    } catch (error) {
      fail(spinner, 'Failed to create page', error);
    }
  });

// Update page
pagesCommand
  .command('update <id>')
  .description('Update page metadata + optional custom <head>/<body> injection (Professional+ tier)')
  .option('--title <title>', 'New title')
  .option('--slug <slug>', 'New slug')
  .option('--type <type>', 'New page type')
  .option('--publish', 'Go instant-live on a published page (opt-out of T12 drafts). Default writes to draft.')
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
    if (options.publish) {
      // T12: --publish on a PATCH means both "mark as published" AND
      // "bypass drafts, write live directly" (for the instant-live flow).
      body.is_published = true;
      body.publish = true;
    }
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
      // BUG-2 fix: emit T1.1 structured envelope (stdout, JSON) when
      // --json + SOLID_JSON_V2=1; prose to stderr otherwise. Previous
      // impl only printed prose — agents reading stdout saw nothing.
      const { emitErrorAndExit } = await import('../lib/command-kit');
      emitErrorAndExit(error);
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
      fail(spinner, 'Failed to delete page', error);
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

    const ora = (await import('../lib/spinner')).default;
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
      fail(spinner, 'Failed to generate page', error);
    }
  });

// Lookup by slug
pagesCommand
  .command('preview <id>')
  .description('Signed preview URL for a page, draft included — see it before publishing')
  .option('--ttl <hours>', 'How long the link stays valid (1-168)', '24')
  .option('--open', 'Open the preview in a browser')
  .option('--json', 'Output as JSON')
  .action(async (id: string, options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }
    const spinner = ora(`Creating preview link for page #${id}...`).start();
    try {
      // A READ that mints a signed, expiring token; the page is untouched.
      // This exists so nobody has to publish to a live site to see a change —
      // the draft renders at the URL, and the token IS the auth.
      const res = await apiClient.post(
        `/api/v1/cms/pages/${parseInt(id, 10)}/preview-link?ttl_hours=${parseInt(String(options.ttl), 10) || 24}`,
        {},
      );
      const d = res.data as Record<string, any>;
      const base = (config.apiUrl || process.env.SOLID_API_URL || '').replace(/\/$/, '');
      const url = d.preview_url?.startsWith('http') ? d.preview_url : `${base}${d.preview_url}`;

      if (isJsonOutput(options)) {
        spinner.stop();
        console.log(JSON.stringify({ ...d, preview_url: url }, null, 2));
        return;
      }
      spinner.succeed(chalk.green(`Preview link for page #${id}`));
      console.log('');
      console.log(`  ${chalk.cyan(url)}`);
      console.log('');
      // Whether a draft exists is the question the link is usually asked to
      // answer: no draft means this shows what is already live.
      console.log(
        d.has_draft
          ? chalk.dim('  Shows the pending DRAFT — not what the site serves now.')
          : chalk.dim('  No draft pending, so this shows what is already published.'),
      );
      console.log(chalk.dim(`  Expires ${d.expires_at}`));
      if (options.open) {
        const { execFile } = await import('child_process');
        const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
        execFile(opener, [url], () => undefined);
      }
    } catch (error) {
      fail(spinner, 'Failed to create preview link', error);
    }
  });

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
      if (isJsonOutput(options)) { spinner.stop(); console.log(JSON.stringify(p, null, 2)); return; }
      spinner.succeed(chalk.green(`Page: ${p.title}`));
      console.log('');
      console.log(`  ${chalk.dim('ID:')}        ${p.id}`);
      console.log(`  ${chalk.dim('Slug:')}      /${p.slug}`);
      console.log(`  ${chalk.dim('Type:')}      ${p.page_type || '—'}`);
      console.log(`  ${chalk.dim('Published:')} ${p.is_published ?? false}`);
    } catch (error) {
      fail(spinner, 'Failed to look up page', error);
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
      fail(spinner, 'Failed to create coming-soon page', error);
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
      fail(spinner, 'Failed to regenerate', error);
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
      fail(spinner, 'Failed to generate website', error);
    }
  });

pagesCommand.addHelpText('after', `
Examples:
  $ solid pages list                               # Paginated
  $ solid pages list --all --json                  # Everything as JSON
  $ solid pages get home                           # Detail view by slug
  $ solid pages create --title "About" --slug about
  $ solid pages publish about                      # Publish a draft
  $ solid pages unpublish about
  $ solid pages generate --type website            # AI-generate a full site

Versioning: every publish creates a snapshot. See: solid history pages <slug>
and solid rollback pages <slug> --version <n>.
`);

/**
 * Poll the live URL until it serves this version.
 *
 * The marker is the page title, which changes with the content and is present
 * in the served HTML. Cache-busting each request matters: without it the poll
 * can be answered from the same cached copy every time and report success for
 * a page nobody else can see yet.
 */
async function waitUntilServed(url: string, page: Record<string, any>, timeoutSec: number): Promise<boolean> {
  const marker = String(page.title || '').trim();
  if (!marker) return false;
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}_cb=${Date.now()}`, {
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (res.ok && (await res.text()).includes(marker)) return true;
    } catch {
      // network blips are expected mid-rollout; keep polling until the deadline
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  return false;
}
