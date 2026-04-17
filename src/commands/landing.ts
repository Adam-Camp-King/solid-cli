/**
 * Landing pages — CRUD + templates + analytics.
 * Wraps controllers/landing_pages.py.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';

function requireAuth() {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
}
function fail(s: ReturnType<typeof ora>, m: string, e: unknown) { s.fail(chalk.red(m)); console.error(chalk.red(`  ${handleApiError(e).message}`)); }

export const landingCommand = new Command('landing')
  .alias('landing-pages')
  .description('Landing pages — CRUD, templates, publish, analytics');

landingCommand
  .command('list')
  .description('List landing pages')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const s = ora('Loading...').start();
    try {
      const res = await apiClient.get('/api/v1/landing-pages/');
      const items = (res.data as Record<string, any>[]) ?? [];
      if (opts.json) { s.stop(); console.log(JSON.stringify(items, null, 2)); return; }
      s.succeed(chalk.green(`${items.length} landing page(s)`));
      for (const p of items) {
        const dot = p.is_published ? chalk.green('●') : chalk.dim('○');
        console.log(`  ${dot} ${chalk.bold(p.id)}  ${p.title}  ${chalk.dim('/' + (p.slug || ''))}`);
      }
    } catch (e) { fail(s, 'Failed', e); }
  });

landingCommand
  .command('get <id>')
  .description('Get a landing page')
  .option('--json', 'Output as JSON')
  .action(async (id, opts) => {
    requireAuth();
    const s = ora('Loading...').start();
    try {
      const res = await apiClient.get(`/api/v1/landing-pages/${id}`);
      if (opts.json) { s.stop(); console.log(JSON.stringify(res.data, null, 2)); return; }
      s.succeed(chalk.green(`Landing page ${id}`));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { fail(s, 'Failed', e); }
  });

landingCommand
  .command('create')
  .description('Create a landing page')
  .requiredOption('--title <title>', 'Title')
  .requiredOption('--slug <slug>', 'Slug')
  .option('--template <id>', 'Template ID')
  .option('--file <path>', 'JSON file with full definition')
  .action(async (opts) => {
    requireAuth();
    const body: Record<string, unknown> = opts.file
      ? JSON.parse((await import('fs')).readFileSync(opts.file, 'utf-8'))
      : { title: opts.title, slug: opts.slug };
    if (opts.template) body.template_id = opts.template;
    const s = ora('Creating...').start();
    try {
      const res = await apiClient.post('/api/v1/landing-pages/', body);
      s.succeed(chalk.green(`Landing page created: ${(res.data as any).id}`));
    } catch (e) { fail(s, 'Failed', e); }
  });

landingCommand
  .command('update <id>')
  .description('Update a landing page')
  .requiredOption('--file <path>', 'JSON file with update')
  .action(async (id, opts) => {
    requireAuth();
    const body = JSON.parse((await import('fs')).readFileSync(opts.file, 'utf-8'));
    const s = ora('Updating...').start();
    try {
      await apiClient.put(`/api/v1/landing-pages/${id}`, body);
      s.succeed(chalk.green('Updated'));
    } catch (e) { fail(s, 'Failed', e); }
  });

landingCommand
  .command('delete <id>')
  .description('Delete a landing page')
  .action(async (id) => {
    requireAuth();
    const s = ora('Deleting...').start();
    try {
      await apiClient.delete(`/api/v1/landing-pages/${id}`);
      s.succeed(chalk.green('Deleted'));
    } catch (e) { fail(s, 'Failed', e); }
  });

landingCommand
  .command('publish <id>')
  .description('Publish a landing page')
  .action(async (id) => {
    requireAuth();
    const s = ora('Publishing...').start();
    try {
      await apiClient.post(`/api/v1/landing-pages/${id}/publish`);
      s.succeed(chalk.green('Published'));
    } catch (e) { fail(s, 'Failed', e); }
  });

landingCommand
  .command('analytics <id>')
  .description('Analytics for a landing page')
  .option('--json', 'Output as JSON')
  .action(async (id, opts) => {
    requireAuth();
    const s = ora('Loading analytics...').start();
    try {
      const res = await apiClient.get(`/api/v1/landing-pages/${id}/analytics`);
      if (opts.json) { s.stop(); console.log(JSON.stringify(res.data, null, 2)); return; }
      s.succeed(chalk.green('Analytics'));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { fail(s, 'Failed', e); }
  });

landingCommand
  .command('templates')
  .description('List landing page templates')
  .option('--category <cat>', 'Filter by category')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const s = ora('Loading templates...').start();
    try {
      const res = await apiClient.get('/api/v1/landing-pages/templates');
      const items = (res.data as Record<string, any>[]) ?? [];
      const filtered = opts.category ? items.filter((t) => t.category === opts.category) : items;
      if (opts.json) { s.stop(); console.log(JSON.stringify(filtered, null, 2)); return; }
      s.succeed(chalk.green(`${filtered.length} template(s)`));
      for (const t of filtered) console.log(`  ${chalk.bold(t.id)}  ${t.name}  ${chalk.dim(t.category || '')}`);
    } catch (e) { fail(s, 'Failed', e); }
  });

landingCommand
  .command('template-categories')
  .description('List template categories')
  .action(async () => {
    requireAuth();
    const s = ora('Loading...').start();
    try {
      const res = await apiClient.get('/api/v1/landing-pages/templates/categories');
      s.succeed(chalk.green('Categories'));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { fail(s, 'Failed', e); }
  });
