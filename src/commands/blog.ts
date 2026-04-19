/**
 * Blog & Local SEO commands for Solid CLI
 *
 * All operations are scoped to the authenticated company_id.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';
import { isJsonOutput } from '../lib/json-output';

function requireAuth(): boolean {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
  return true;
}

export const blogCommand = new Command('blog')
  .description('Blog posts & local SEO');

// ── Blog Post Commands ──────────────────────────────────────────────

// List blog posts — full scripting contract
{
  const { withListFlags } = require('../lib/command-kit') as typeof import('../lib/command-kit');
  const listCmd = blogCommand.command('list').alias('ls').description('List blog posts');
  withListFlags(listCmd, '20');
  listCmd.option('--status <status>', 'Filter by status (published, draft)');
  listCmd.action(async (opts: { status?: string } & import('../lib/command-kit').ListFlags) => {
    const { runListCommand } = await import('../lib/command-kit');
    await runListCommand(opts, {
      spinnerText: 'Loading blog posts...',
      errorText: 'Failed to load blog posts',
      fetch: async (offset, limit) => {
        const params: Record<string, unknown> = { page_size: limit, page: Math.floor(offset / limit) + 1 };
        if (opts.status) params.status = opts.status;
        return (await apiClient.get('/api/v1/cms/blog/posts', { params })).data;
      },
      extract: (page) => {
        const d = page as Record<string, unknown>;
        return ((d.posts || d.items || []) as Array<Record<string, unknown>>);
      },
      render: (items) => {
        if (!items.length) { console.log(chalk.dim('  No blog posts yet. Use `solid blog create` to write one.')); return; }
        console.log('');
        for (const post of items) {
          const status = post.published ? chalk.green('published') : chalk.yellow('draft');
          const category = post.category ? chalk.cyan(`[${post.category}]`) : '';
          console.log(`  ${chalk.bold(String(post.title))} ${category} ${status}`);
          const meta: string[] = [];
          if (post.id) meta.push(`ID: ${post.id}`);
          if (Array.isArray(post.tags) && post.tags.length) meta.push(`tags: ${(post.tags as string[]).join(', ')}`);
          if (meta.length) console.log(chalk.dim(`    ${meta.join('  ')}`));
        }
      },
    });
  });
}

blogCommand
  .command('get <id>')
  .description('Get a blog post by ID')
  .option('--json', 'Output as JSON')
  .action(async (id, options) => {
    requireAuth();
    const spinner = ora(`Loading post #${id}...`).start();

    try {
      const response = await apiClient.get(`/api/v1/cms/blog/posts/${id}`);
      const post = response.data as Record<string, any>;

      if (isJsonOutput(options)) {
        spinner.stop();
        console.log(JSON.stringify(post, null, 2));
        return;
      }

      spinner.stop();
      const status = post.published ? chalk.green('published') : chalk.yellow('draft');
      console.log(ui.header(post.title || `Post #${id}`));
      console.log(ui.label('Status', status));
      if (post.category) console.log(ui.label('Category', post.category));
      if (post.tags?.length) console.log(ui.label('Tags', post.tags.join(', ')));
      if (post.created_at) console.log(ui.label('Created', post.created_at));
      if (post.updated_at) console.log(ui.label('Updated', post.updated_at));
      if (post.content) {
        console.log('');
        console.log(ui.divider('Content'));
        console.log(`  ${post.content.substring(0, 500)}${post.content.length > 500 ? '...' : ''}`);
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to load blog post'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

blogCommand
  .command('create')
  .description('Create a new blog post')
  .option('-t, --title <title>', 'Post title')
  .option('-c, --content <content>', 'Post content')
  .option('--category <category>', 'Category')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('--published', 'Publish immediately')
  .action(async (options) => {
    requireAuth();

    let { title, content, category, tags } = options;

    if (!title || !content) {
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'title',
          message: 'Post title:',
          when: !title,
          validate: (input: string) => input.length > 0 || 'Title is required',
        },
        {
          type: 'editor',
          name: 'content',
          message: 'Post content (opens editor):',
          when: !content,
        },
        {
          type: 'input',
          name: 'category',
          message: 'Category (optional):',
          when: !category,
        },
        {
          type: 'input',
          name: 'tags',
          message: 'Tags (comma-separated, optional):',
          when: !tags,
        },
      ]);
      title = title || answers.title;
      content = content || answers.content;
      category = category || answers.category;
      tags = tags || answers.tags;
    }

    const tagList = tags ? tags.split(',').map((t: string) => t.trim()).filter(Boolean) : [];

    const spinner = ora('Creating blog post...').start();

    try {
      const body: Record<string, unknown> = {
        title,
        content,
        published: !!options.published,
      };
      if (category) body.category = category;
      if (tagList.length) body.tags = tagList;

      const response = await apiClient.post('/api/v1/cms/blog/posts', body);
      const post = response.data as Record<string, any>;
      spinner.succeed(chalk.green(`Blog post created: "${title}"`));
      if (post.id) console.log(chalk.dim(`  ID: ${post.id}`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to create blog post'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

blogCommand
  .command('update <id>')
  .description('Update a blog post')
  .option('-t, --title <title>', 'New title')
  .option('-c, --content <content>', 'New content')
  .option('--published', 'Set as published')
  .option('--draft', 'Set as draft')
  .action(async (id, options) => {
    requireAuth();

    const body: Record<string, unknown> = {};
    if (options.title) body.title = options.title;
    if (options.content) body.content = options.content;
    if (options.published) body.published = true;
    if (options.draft) body.published = false;

    if (Object.keys(body).length === 0) {
      console.error(chalk.red('Nothing to update. Use --title, --content, --published, or --draft.'));
      process.exit(1);
    }

    const spinner = ora(`Updating post #${id}...`).start();

    try {
      await apiClient.patch(`/api/v1/cms/blog/posts/${id}`, body);
      spinner.succeed(chalk.green(`Post #${id} updated`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to update blog post'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

blogCommand
  .command('delete <id>')
  .description('Delete a blog post (prompts by default)')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (id: string, opts: { yes?: boolean }) => {
    requireAuth();

    const { confirm } = await import('../lib/command-kit');
    const ok = await confirm(
      `Delete blog post #${id}? This cannot be undone.`,
      { autoConfirm: Boolean(opts.yes) },
    );
    if (!ok) { console.error(chalk.dim('  Cancelled.')); process.exit(1); }

    const spinner = ora({ text: `Deleting post #${id}...`, stream: process.stderr }).start();

    try {
      await apiClient.delete(`/api/v1/cms/blog/posts/${id}`);
      spinner.succeed(chalk.green(`Blog post #${id} deleted`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to delete blog post'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
      process.exit(1);
    }
  });

// ── SEO Subcommands ─────────────────────────────────────────────────

const seoCommand = blogCommand
  .command('seo')
  .description('Local SEO tools');

seoCommand
  .command('audit')
  .description('Run a local SEO audit')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireAuth();
    const spinner = ora('Running SEO audit...').start();

    try {
      const response = await apiClient.post('/api/v1/local-seo/audit');
      const data = response.data as Record<string, any>;

      if (isJsonOutput(options)) {
        spinner.stop();
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      spinner.succeed(chalk.green('SEO audit complete'));
      if (data.score != null) console.log(ui.label('Score', `${data.score}/100`));
      if (data.issues?.length) {
        console.log('');
        console.log(ui.divider('Issues'));
        for (const issue of data.issues) {
          const sev = issue.severity === 'high' ? chalk.red('HIGH') :
            issue.severity === 'medium' ? chalk.yellow('MED') : chalk.dim('LOW');
          console.log(`  ${sev}  ${issue.message || issue.description || issue}`);
        }
      }
      if (data.recommendations?.length) {
        console.log('');
        console.log(ui.divider('Recommendations'));
        for (const rec of data.recommendations) {
          console.log(`  ${chalk.cyan('-')} ${rec}`);
        }
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to run SEO audit'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

seoCommand
  .command('profile')
  .description('View your local SEO profile')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireAuth();
    const spinner = ora('Loading SEO profile...').start();

    try {
      const response = await apiClient.get('/api/v1/local-seo/profile');
      const data = response.data as Record<string, any>;

      if (isJsonOutput(options)) {
        spinner.stop();
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      spinner.succeed(chalk.green('SEO profile loaded'));
      if (data.business_name) console.log(ui.label('Business', data.business_name));
      if (data.address) console.log(ui.label('Address', data.address));
      if (data.phone) console.log(ui.label('Phone', data.phone));
      if (data.categories?.length) console.log(ui.label('Categories', data.categories.join(', ')));
    } catch (error) {
      spinner.fail(chalk.red('Failed to load SEO profile'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

seoCommand
  .command('gaps')
  .description('View identified SEO gaps')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireAuth();
    const spinner = ora('Loading SEO gaps...').start();

    try {
      const response = await apiClient.get('/api/v1/local-seo/gaps');
      const data = response.data as Record<string, any>;

      if (isJsonOutput(options)) {
        spinner.stop();
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      const gaps = data.gaps || data.items || [];
      spinner.succeed(chalk.green(`${gaps.length} SEO gaps identified`));

      if (gaps.length === 0) {
        console.log(chalk.dim('  No gaps found. Your SEO looks good!'));
        return;
      }

      console.log('');
      for (const gap of gaps) {
        const priority = gap.priority === 'high' ? chalk.red('HIGH') :
          gap.priority === 'medium' ? chalk.yellow('MED') : chalk.dim('LOW');
        console.log(`  ${priority}  ${chalk.bold(gap.title || gap.name || gap)}`);
        if (gap.description) console.log(chalk.dim(`         ${gap.description}`));
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to load SEO gaps'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

seoCommand
  .command('citations')
  .description('View citation report')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireAuth();
    const spinner = ora('Loading citations...').start();

    try {
      const response = await apiClient.get('/api/v1/local-seo/citations');
      const data = response.data as Record<string, any>;

      if (isJsonOutput(options)) {
        spinner.stop();
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      const citations = data.citations || data.items || [];
      spinner.succeed(chalk.green(`${citations.length} citations found`));

      if (citations.length === 0) {
        console.log(chalk.dim('  No citations found yet.'));
        return;
      }

      console.log('');
      for (const c of citations) {
        const status = c.verified ? chalk.green('verified') : chalk.yellow('unverified');
        console.log(`  ${chalk.bold(c.source || c.name)}  ${status}`);
        if (c.url) console.log(chalk.dim(`    ${c.url}`));
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to load citations'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });
