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
  .option('-l, --limit <limit>', 'Max results', '20')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const spinner = ora('Loading KB entries...').start();

    try {
      const response = await apiClient.kbSearch(options.query, parseInt(options.limit));

      if (options.json) {
        spinner.stop();
        console.log(JSON.stringify(response.data, null, 2));
        return;
      }

      const results = response.data.results || [];
      spinner.succeed(chalk.green(`${results.length} entries found`));

      if (results.length === 0) {
        console.log(chalk.dim('  No KB entries yet. Run `solid kb add` to create one.'));
        return;
      }

      console.log('');
      for (const entry of results as any[]) {
        const category = entry.category ? chalk.cyan(`[${entry.category}]`) : '';
        console.log(`  ${chalk.bold(entry.title || 'Untitled')} ${category}`);
        if (entry.content) {
          const preview = entry.content.substring(0, 80).replace(/\n/g, ' ');
          console.log(chalk.dim(`    ${preview}${entry.content.length > 80 ? '...' : ''}`));
        }
        if (entry.id) {
          console.log(chalk.dim(`    ID: ${entry.id}`));
        }
        console.log('');
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to load KB entries'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
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
      if ((response.data as any).id) {
        console.log(chalk.dim(`  ID: ${(response.data as any).id}`));
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to create KB entry'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Delete KB entry
kbCommand
  .command('delete <id>')
  .description('Delete a knowledge base entry by ID')
  .action(async (id) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: `Delete KB entry #${id}? This cannot be undone.`,
      default: false,
    }]);

    if (!confirm) {
      console.log(chalk.dim('Cancelled.'));
      return;
    }

    const spinner = ora('Deleting KB entry...').start();

    try {
      await apiClient.kbDelete(parseInt(id));
      spinner.succeed(chalk.green(`KB entry #${id} deleted`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to delete KB entry'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });
