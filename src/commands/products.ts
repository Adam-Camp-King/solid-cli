/**
 * Product catalog commands.
 * Wraps controllers/products.py at /api/v1/products/*.
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

export const productsCommand = new Command('products')
  .description('Product catalog (CRUD, pricing, components)');

{
  const { withListFlags } = require('../lib/command-kit') as typeof import('../lib/command-kit');
  const listCmd = productsCommand.command('list').alias('ls').description('List products');
  withListFlags(listCmd);
  listCmd.option('--type <type>', 'Filter by product_type');
  listCmd.action(async (opts: { type?: string } & import('../lib/command-kit').ListFlags) => {
    const { runListCommand } = await import('../lib/command-kit');
    await runListCommand(opts, {
      spinnerText: 'Loading products...',
      errorText: 'Failed to load products',
      fetch: async (offset, limit) => {
        const params: Record<string, unknown> = { limit, offset };
        if (opts.type) params.product_type = opts.type;
        return (await apiClient.get('/api/v1/products/', { params })).data;
      },
      extract: (page) => (Array.isArray(page) ? page : []) as Array<Record<string, unknown>>,
      render: (items) => {
        if (!items.length) { console.log(chalk.dim('  No products found.')); return; }
        console.log('');
        for (const p of items) {
          const price = p.price !== undefined ? chalk.green(`$${Number(p.price).toFixed(2)}`) : chalk.dim('—');
          console.log(`  ${chalk.bold(String(p.id))}  ${p.name || p.title || '—'}  ${price}  ${chalk.dim(String(p.product_type || ''))}`);
        }
      },
    });
  });
}

productsCommand
  .command('get <id>')
  .description('Get a product by ID')
  .option('--json', 'Output as JSON')
  .action(async (id, opts) => {
    requireAuth();
    const spinner = ora(`Loading product ${id}...`).start();
    try {
      const res = await apiClient.get(`/api/v1/products/${id}`);
      const p = res.data as Record<string, any>;
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(p, null, 2)); return; }
      spinner.succeed(chalk.green(`Product ${id}`));
      console.log('');
      console.log(`  ${chalk.bold('Name:')}    ${p.name || p.title}`);
      console.log(`  ${chalk.bold('Type:')}    ${p.product_type || '—'}`);
      console.log(`  ${chalk.bold('Price:')}   $${p.price ?? '—'}`);
      console.log(`  ${chalk.bold('Cost:')}    $${p.cost ?? '—'}`);
      console.log(`  ${chalk.bold('SKU:')}     ${p.sku || '—'}`);
      console.log(`  ${chalk.bold('Active:')}  ${p.is_active ?? true}`);
      if (p.description) {
        console.log('');
        console.log(chalk.dim(`  ${p.description}`));
      }
    } catch (e) { fail(spinner, 'Failed to load product', e); }
  });

productsCommand
  .command('create')
  .description('Create a new product')
  .requiredOption('--name <name>', 'Product name')
  .option('--type <type>', 'Product type', 'physical')
  .option('--price <amount>', 'Price')
  .option('--cost <amount>', 'Cost')
  .option('--sku <sku>', 'SKU')
  .option('--description <text>', 'Description')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora(`Creating "${opts.name}"...`).start();
    try {
      const body: Record<string, unknown> = { name: opts.name, product_type: opts.type };
      if (opts.price) body.price = parseFloat(opts.price);
      if (opts.cost) body.cost = parseFloat(opts.cost);
      if (opts.sku) body.sku = opts.sku;
      if (opts.description) body.description = opts.description;
      const res = await apiClient.post('/api/v1/products/', body);
      const p = res.data as Record<string, any>;
      spinner.succeed(chalk.green(`Product created: ${p.id}`));
    } catch (e) { fail(spinner, 'Failed to create product', e); }
  });

productsCommand
  .command('update <id>')
  .description('Update product fields (name, description, sku, etc.)')
  .option('--name <name>')
  .option('--description <text>')
  .option('--sku <sku>')
  .option('--active <bool>', 'true|false')
  .action(async (id, opts) => {
    requireAuth();
    const body: Record<string, unknown> = {};
    if (opts.name) body.name = opts.name;
    if (opts.description) body.description = opts.description;
    if (opts.sku) body.sku = opts.sku;
    if (opts.active !== undefined) body.is_active = opts.active === 'true';
    if (Object.keys(body).length === 0) {
      console.error(chalk.red('Provide at least one field to update.'));
      process.exit(1);
    }
    const spinner = ora(`Updating ${id}...`).start();
    try {
      await apiClient.patch(`/api/v1/products/${id}`, body);
      spinner.succeed(chalk.green(`Product ${id} updated`));
    } catch (e) { fail(spinner, 'Failed to update product', e); }
  });

productsCommand
  .command('pricing <id>')
  .description('Update product pricing only')
  .option('--price <amount>')
  .option('--cost <amount>')
  .action(async (id, opts) => {
    requireAuth();
    const body: Record<string, unknown> = {};
    if (opts.price) body.price = parseFloat(opts.price);
    if (opts.cost) body.cost = parseFloat(opts.cost);
    if (Object.keys(body).length === 0) {
      console.error(chalk.red('Provide --price and/or --cost.'));
      process.exit(1);
    }
    const spinner = ora(`Updating pricing for ${id}...`).start();
    try {
      await apiClient.patch(`/api/v1/products/${id}/pricing`, body);
      spinner.succeed(chalk.green(`Pricing updated for ${id}`));
    } catch (e) { fail(spinner, 'Failed to update pricing', e); }
  });

productsCommand
  .command('components <id>')
  .description('List components/variants of a product')
  .option('--json', 'Output as JSON')
  .action(async (id, opts) => {
    requireAuth();
    const spinner = ora(`Loading components for ${id}...`).start();
    try {
      const res = await apiClient.get(`/api/v1/products/${id}/components`);
      const data = res.data as Record<string, any>;
      const items = data.components || data.items || [];
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(data, null, 2)); return; }
      spinner.succeed(chalk.green(`${items.length} component(s)`));
      console.log('');
      for (const c of items as Record<string, any>[]) {
        console.log(`  ${chalk.bold(c.id)}  ${c.name || '—'}  qty:${c.quantity ?? 1}`);
      }
    } catch (e) { fail(spinner, 'Failed to load components', e); }
  });

productsCommand
  .command('catalog')
  .description('Full product catalog snapshot (used by storefront)')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading catalog...').start();
    try {
      const res = await apiClient.get('/api/v1/products/catalog');
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(res.data, null, 2)); return; }
      spinner.succeed(chalk.green('Catalog loaded'));
      const items = (res.data as Record<string, any>).items || (res.data as Record<string, any>).products || [];
      console.log(`  ${items.length} item(s)`);
    } catch (e) { fail(spinner, 'Failed to load catalog', e); }
  });

productsCommand
  .command('delete <id>')
  .description('Delete a product')
  .action(async (id) => {
    requireAuth();
    const spinner = ora(`Deleting ${id}...`).start();
    try {
      await apiClient.delete(`/api/v1/products/${id}`);
      spinner.succeed(chalk.green(`Product ${id} deleted`));
    } catch (e) { fail(spinner, 'Failed to delete product', e); }
  });

import { appendExamples as __appendExamplesProducts } from '../lib/command-kit';
__appendExamplesProducts(productsCommand, [
  { cmd: 'solid products list --all --format csv > catalog.csv', why: 'Export full catalog' },
  { cmd: 'solid products create -t "Widget" -p 19.99 --sku WID-001', why: 'Add a product' },
  { cmd: 'solid products update <id> -p 24.99', why: 'Price change' },
  { cmd: 'solid products delete <id> --yes', why: 'Retire (skips confirm)' },
  { cmd: 'solid products get <id> --json | jq .components', why: 'Inspect bundle parts' },
]);
