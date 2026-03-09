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

blogCommand
  .command('list')
  .description('List blog posts')
  .option('--status <status>', 'Filter by status (published, draft)')
  .option('-l, --limit <limit>', 'Max results', '20')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireAuth();
    const spinner = ora('Loading blog posts...').start();

    try {
      const params: Record<string, unknown> = {
        page: 1,
        page_size: parseInt(options.limit),
      };
      if (options.status) params.status = options.status;

      const response = await apiClient.get('/api/v1/cms/blog/posts', { params });

      if (options.json) {
        spinner.stop();
        console.log(JSON.stringify(response.data, null, 2));
        return;
      }

      const data = response.data as any;
      const posts = data.posts || data.items || [];
      spinner.succeed(chalk.green(`${posts.length} blog posts`));

      if (posts.length === 0) {
        console.log(chalk.dim('  No blog posts yet. Use `solid blog create` to write one.'));
        return;
      }

      console.log('');
      for (const post of posts) {
        const status = post.published
          ? chalk.green('published')
          : chalk.yellow('draft');
        const category = post.category ? chalk.cyan(`[${post.category}]`) : '';
        console.log(`  ${chalk.bold(post.title)} ${category} ${status}`);
        const meta: string[] = [];
        if (post.id) meta.push(`ID: ${post.id}`);
        if (post.tags?.length) meta.push(`tags: ${post.tags.join(', ')}`);
        if (meta.length) console.log(chalk.dim(`    ${meta.join('  ')}`));
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to load blog posts'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

blogCommand
  .command('get <id>')
  .description('Get a blog post by ID')
  .option('--json', 'Output as JSON')
  .action(async (id, options) => {
    requireAuth();
    const spinner = ora(`Loading post #${id}...`).start();

    try {
      const response = await apiClient.get(`/api/v1/cms/blog/posts/${id}`);
      const post = response.data as any;

      if (options.json) {
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
      const post = response.data as any;
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
  .description('Delete a blog post')
  .action(async (id) => {
    requireAuth();

    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: `Delete blog post #${id}? This cannot be undone.`,
      default: false,
    }]);

    if (!confirm) {
      console.log(chalk.dim('Cancelled.'));
      return;
    }

    const spinner = ora(`Deleting post #${id}...`).start();

    try {
      await apiClient.delete(`/api/v1/cms/blog/posts/${id}`);
      spinner.succeed(chalk.green(`Blog post #${id} deleted`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to delete blog post'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
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
      const response = await apiClient.post('/local-seo/audit');
      const data = response.data as any;

      if (options.json) {
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
      const response = await apiClient.get('/local-seo/profile');
      const data = response.data as any;

      if (options.json) {
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
      const response = await apiClient.get('/local-seo/gaps');
      const data = response.data as any;

      if (options.json) {
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
      const response = await apiClient.get('/local-seo/citations');
      const data = response.data as any;

      if (options.json) {
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
