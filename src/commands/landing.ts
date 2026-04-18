/**
 * Landing pages — CRUD + templates + analytics.
 * Wraps controllers/landing_pages.py.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { isJsonOutput } from '../lib/json-output';

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

{
  const { withListFlags } = require('../lib/command-kit') as typeof import('../lib/command-kit');
  const listCmd = landingCommand.command('list').description('List landing pages');
  withListFlags(listCmd);
  listCmd.action(async (opts: import('../lib/command-kit').ListFlags) => {
    const { runListCommand } = await import('../lib/command-kit');
    await runListCommand(opts, {
      spinnerText: 'Loading landing pages...',
      errorText: 'Failed to load landing pages',
      fetch: async (offset, limit) =>
        (await apiClient.get('/api/v1/landing-pages/', { params: { limit, offset } })).data,
      extract: (page) => (Array.isArray(page) ? page : []) as Array<Record<string, unknown>>,
      render: (items) => {
        if (!items.length) { console.log(chalk.dim('  No landing pages.')); return; }
        for (const p of items) {
          const dot = p.is_published ? chalk.green('●') : chalk.dim('○');
          console.log(`  ${dot} ${chalk.bold(String(p.id))}  ${p.title}  ${chalk.dim('/' + (p.slug || ''))}`);
        }
      },
    });
  });
}

landingCommand
  .command('get <id>')
  .description('Get a landing page')
  .option('--json', 'Output as JSON')
  .action(async (id, opts) => {
    requireAuth();
    const s = ora('Loading...').start();
    try {
      const res = await apiClient.get(`/api/v1/landing-pages/${id}`);
      if (isJsonOutput(opts)) { s.stop(); console.log(JSON.stringify(res.data, null, 2)); return; }
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
  .description('Delete a landing page (prompts by default)')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (id: string, opts: { yes?: boolean }) => {
    requireAuth();
    const { confirm } = await import('../lib/command-kit');
    const ok = await confirm(`Delete landing page ${id}?`, { autoConfirm: Boolean(opts.yes) });
    if (!ok) { console.error(chalk.dim('  Cancelled.')); process.exit(1); }
    const s = ora({ text: 'Deleting...', stream: process.stderr }).start();
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
      if (isJsonOutput(opts)) { s.stop(); console.log(JSON.stringify(res.data, null, 2)); return; }
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
      if (isJsonOutput(opts)) { s.stop(); console.log(JSON.stringify(filtered, null, 2)); return; }
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
