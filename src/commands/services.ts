/**
 * Service catalog commands for Solid CLI
 *
 * All operations are scoped to the authenticated company_id.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { isJsonOutput } from '../lib/json-output';

export const servicesCommand = new Command('services')
  .description('Service catalog management');

{
  const { withListFlags } = require('../lib/command-kit') as typeof import('../lib/command-kit');
  const listCmd = servicesCommand.command('list').alias('ls').description('List your services');
  withListFlags(listCmd);
  listCmd.option('--category <category>', 'Filter by category');
  listCmd.action(async (opts: { category?: string } & import('../lib/command-kit').ListFlags) => {
    const { runListCommand } = await import('../lib/command-kit');
    await runListCommand(opts, {
      spinnerText: 'Loading services...',
      errorText: 'Failed to load services',
      fetch: async () => (await apiClient.servicesList()).data,
      extract: (page) => {
        const d = page as Record<string, unknown>;
        let items = (d.items || d.services || []) as Array<Record<string, unknown>>;
        if (opts.category) {
          items = items.filter((s) =>
            typeof s.category === 'string' && s.category.toLowerCase() === opts.category!.toLowerCase(),
          );
        }
        return items;
      },
      render: (items) => {
        if (!items.length) { console.log(chalk.dim('  No services in your catalog yet.')); return; }
        console.log('');
        let currentCategory = '';
        for (const svc of items) {
          if (svc.category && svc.category !== currentCategory) {
            currentCategory = String(svc.category);
            console.log(chalk.cyan(`  [${currentCategory}]`));
          }
          const price = svc.price ? chalk.green(`$${svc.price}`) : chalk.dim('no price');
          const duration = svc.duration_minutes ? chalk.dim(`${svc.duration_minutes} min`) : '';
          console.log(`    ${chalk.bold(String(svc.title))} — ${price} ${duration}`);
          if (svc.description) {
            const preview = String(svc.description).substring(0, 60).replace(/\n/g, ' ');
            console.log(chalk.dim(`      ${preview}${String(svc.description).length > 60 ? '...' : ''}`));
          }
        }
      },
    });
  });
}

// Create service
servicesCommand
  .command('create')
  .description('Create a new service')
  .requiredOption('-t, --title <title>', 'Service title')
  .option('-p, --price <price>', 'Price (dollars)')
  .option('-d, --duration <minutes>', 'Duration in minutes')
  .option('-c, --category <category>', 'Category')
  .option('--description <text>', 'Description')
  .option('--json', 'JSON output')
  .action(async (options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const spinner = ora(`Creating service "${options.title}"...`).start();
    try {
      const body: Record<string, unknown> = { title: options.title };
      if (options.price) body.price = parseFloat(options.price);
      if (options.duration) body.duration_minutes = parseInt(options.duration, 10);
      if (options.category) body.category = options.category;
      if (options.description) body.description = options.description;

      const res = await apiClient.post('/api/v1/services/catalog', body);
      spinner.succeed(chalk.green('Service created'));
      if (isJsonOutput(options)) { console.log(JSON.stringify(res.data, null, 2)); return; }
      const d = res.data as Record<string, any>;
      console.log(`  ID: ${d.id || d.service?.id || 'created'}`);
      console.log(`  Title: ${options.title}`);
      if (options.price) console.log(`  Price: $${options.price}`);
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });

// Update service
servicesCommand
  .command('update <id>')
  .description('Update a service')
  .option('-t, --title <title>', 'New title')
  .option('-p, --price <price>', 'New price')
  .option('-d, --duration <minutes>', 'New duration')
  .option('-c, --category <category>', 'New category')
  .option('--description <text>', 'New description')
  .action(async (id, options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const body: Record<string, unknown> = {};
    if (options.title) body.title = options.title;
    if (options.price) body.price = parseFloat(options.price);
    if (options.duration) body.duration_minutes = parseInt(options.duration, 10);
    if (options.category) body.category = options.category;
    if (options.description) body.description = options.description;
    if (Object.keys(body).length === 0) {
      console.error(chalk.red('Provide at least one field to update.'));
      process.exit(1);
    }
    const spinner = ora(`Updating service ${id}...`).start();
    try {
      await apiClient.put(`/api/v1/services/catalog/${id}`, body);
      spinner.succeed(chalk.green(`Service ${id} updated`));
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });

// Delete service
servicesCommand
  .command('delete <id>')
  .description('Delete a service by ID')
  .action(async (id) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const spinner = ora(`Deleting service ${id}...`).start();
    try {
      await apiClient.delete(`/api/v1/services/catalog/${id}`);
      spinner.succeed(chalk.green(`Service ${id} deleted`));
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });
