/**
 * Marketplace commands.
 * Wraps controllers/marketplace.py at /api/v1/marketplace/* — publish products
 * and services to the cross-company marketplace, sync, enable/disable.
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

function fail(spinner: ReturnType<typeof ora>, msg: string, err: unknown) {
  spinner.fail(chalk.red(msg));
  console.error(chalk.red(`  ${handleApiError(err).message}`));
}

export const marketplaceCommand = new Command('marketplace')
  .alias('mp')
  .description('Cross-company marketplace — publish products + services');

marketplaceCommand
  .command('status')
  .description('Marketplace participation status for this company')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading status...').start();
    try {
      const res = await apiClient.get('/api/v1/marketplace/status');
      const s = res.data as Record<string, any>;
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(s, null, 2)); return; }
      spinner.succeed(chalk.green('Marketplace status'));
      console.log('');
      console.log(`  ${chalk.bold('Enabled:')}            ${s.enabled ?? false}`);
      console.log(`  ${chalk.bold('Published products:')} ${s.published_products ?? 0}`);
      console.log(`  ${chalk.bold('Published services:')} ${s.published_services ?? 0}`);
    } catch (e) { fail(spinner, 'Failed to load status', e); }
  });

marketplaceCommand
  .command('enable')
  .description('Opt this company into the marketplace')
  .action(async () => {
    requireAuth();
    const spinner = ora('Enabling marketplace...').start();
    try {
      await apiClient.post('/api/v1/marketplace/enable');
      spinner.succeed(chalk.green('Marketplace enabled'));
    } catch (e) { fail(spinner, 'Failed to enable', e); }
  });

marketplaceCommand
  .command('disable')
  .description('Opt this company out of the marketplace')
  .action(async () => {
    requireAuth();
    const spinner = ora('Disabling marketplace...').start();
    try {
      await apiClient.post('/api/v1/marketplace/disable');
      spinner.succeed(chalk.green('Marketplace disabled'));
    } catch (e) { fail(spinner, 'Failed to disable', e); }
  });

marketplaceCommand
  .command('products')
  .description('List published products in the marketplace')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading products...').start();
    try {
      const res = await apiClient.get('/api/v1/marketplace/products');
      const items = (res.data as Record<string, any>[]) ?? [];
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(items, null, 2)); return; }
      spinner.succeed(chalk.green(`${items.length} published product(s)`));
      console.log('');
      for (const p of items) {
        const price = p.price !== undefined ? chalk.green(`$${p.price}`) : chalk.dim('—');
        console.log(`  ${chalk.bold(p.id)}  ${p.name || p.title}  ${price}  ${chalk.dim(p.company_name || '')}`);
      }
    } catch (e) { fail(spinner, 'Failed to load products', e); }
  });

marketplaceCommand
  .command('services')
  .description('List published services in the marketplace')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading services...').start();
    try {
      const res = await apiClient.get('/api/v1/marketplace/services');
      const items = (res.data as Record<string, any>[]) ?? [];
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(items, null, 2)); return; }
      spinner.succeed(chalk.green(`${items.length} published service(s)`));
      console.log('');
      for (const s of items) {
        const price = s.price !== undefined ? chalk.green(`$${s.price}`) : chalk.dim('—');
        console.log(`  ${chalk.bold(s.id)}  ${s.title || s.name}  ${price}  ${chalk.dim(s.company_name || '')}`);
      }
    } catch (e) { fail(spinner, 'Failed to load services', e); }
  });

marketplaceCommand
  .command('publish-product <id>')
  .description('Publish a product to the marketplace')
  .action(async (id) => {
    requireAuth();
    const spinner = ora(`Publishing product ${id}...`).start();
    try {
      await apiClient.put(`/api/v1/marketplace/products/${id}/publish`);
      spinner.succeed(chalk.green(`Product ${id} published`));
    } catch (e) { fail(spinner, 'Failed to publish product', e); }
  });

marketplaceCommand
  .command('unpublish-product <id>')
  .description('Remove a product from the marketplace')
  .action(async (id) => {
    requireAuth();
    const spinner = ora(`Unpublishing product ${id}...`).start();
    try {
      await apiClient.put(`/api/v1/marketplace/products/${id}/unpublish`);
      spinner.succeed(chalk.green(`Product ${id} unpublished`));
    } catch (e) { fail(spinner, 'Failed to unpublish product', e); }
  });

marketplaceCommand
  .command('publish-service <id>')
  .description('Publish a service catalog item to the marketplace')
  .action(async (id) => {
    requireAuth();
    const spinner = ora(`Publishing service ${id}...`).start();
    try {
      await apiClient.put(`/api/v1/marketplace/services/${id}/publish`);
      spinner.succeed(chalk.green(`Service ${id} published`));
    } catch (e) { fail(spinner, 'Failed to publish service', e); }
  });

marketplaceCommand
  .command('unpublish-service <id>')
  .description('Remove a service from the marketplace')
  .action(async (id) => {
    requireAuth();
    const spinner = ora(`Unpublishing service ${id}...`).start();
    try {
      await apiClient.put(`/api/v1/marketplace/services/${id}/unpublish`);
      spinner.succeed(chalk.green(`Service ${id} unpublished`));
    } catch (e) { fail(spinner, 'Failed to unpublish service', e); }
  });

marketplaceCommand
  .command('publish-all')
  .description('Bulk-publish all eligible products and services')
  .action(async () => {
    requireAuth();
    const spinner = ora('Bulk publishing...').start();
    try {
      const res = await apiClient.post('/api/v1/marketplace/publish-all');
      const r = res.data as Record<string, any>;
      spinner.succeed(chalk.green(`Published: ${r.products_published ?? 0} products, ${r.services_published ?? 0} services`));
    } catch (e) { fail(spinner, 'Failed bulk publish', e); }
  });

import { appendExamples as __ae_mp } from '../lib/command-kit';
__ae_mp(marketplaceCommand, [
  { cmd: 'solid mp status',         why: 'Marketplace enrollment + listed items' },
  { cmd: 'solid mp enable',         why: 'Opt in to the marketplace' },
  { cmd: 'solid mp products',       why: 'Your listed products' },
  { cmd: 'solid mp publish-all',    why: 'Publish every product/service' },
]);
