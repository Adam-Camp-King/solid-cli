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

export const servicesCommand = new Command('services')
  .description('Service catalog management');

// List services
servicesCommand
  .command('list')
  .description('List your services')
  .option('--category <category>', 'Filter by category')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const spinner = ora('Loading services...').start();

    try {
      const response = await apiClient.servicesList();

      if (options.json) {
        spinner.stop();
        console.log(JSON.stringify(response.data, null, 2));
        return;
      }

      let items = (response.data as any).items || [];

      if (options.category) {
        items = items.filter((s: any) =>
          s.category && s.category.toLowerCase() === options.category.toLowerCase()
        );
      }

      spinner.succeed(chalk.green(`${items.length} services`));

      if (items.length === 0) {
        console.log(chalk.dim('  No services in your catalog yet.'));
        return;
      }

      console.log('');
      let currentCategory = '';
      for (const svc of items) {
        if (svc.category && svc.category !== currentCategory) {
          currentCategory = svc.category;
          console.log(chalk.cyan(`  [${currentCategory}]`));
        }
        const price = svc.price ? chalk.green(`$${svc.price}`) : chalk.dim('no price');
        const duration = svc.duration_minutes ? chalk.dim(`${svc.duration_minutes} min`) : '';
        console.log(`    ${chalk.bold(svc.title)} — ${price} ${duration}`);
        if (svc.description) {
          const preview = svc.description.substring(0, 60).replace(/\n/g, ' ');
          console.log(chalk.dim(`      ${preview}${svc.description.length > 60 ? '...' : ''}`));
        }
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to load services'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });
