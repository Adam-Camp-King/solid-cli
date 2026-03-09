/**
 * Inventory management commands for Solid CLI
 *
 * All operations are scoped to the authenticated company.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';

function requireAuth() {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
}

export const inventoryCommand = new Command('inventory')
  .description('Inventory & stock management');

// List inventory items
inventoryCommand
  .command('list')
  .description('List inventory items')
  .option('--limit <n>', 'Max results', '50')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireAuth();
    const spinner = ora('Loading inventory...').start();

    try {
      const params = { limit: parseInt(options.limit), offset: 0 };
      const response = await apiClient.get('/Inventory/', { params });
      const data = response.data as any;
      const items = data.items || data.inventory || [];

      if (options.json) {
        spinner.stop();
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      spinner.succeed(chalk.green(`${items.length} item(s)`));

      if (items.length === 0) {
        console.log(chalk.dim('  No inventory items found.'));
        return;
      }

      console.log('');
      for (const item of items) {
        const qty = item.on_hand ?? item.quantity ?? 0;
        const qtyColor = qty <= 0 ? chalk.red : qty < 10 ? chalk.yellow : chalk.green;
        const price = item.price !== undefined ? chalk.green(`$${Number(item.price).toFixed(2)}`) : '';
        console.log(`  ${chalk.bold(item.sku || item.id)}  ${item.name || item.title}  ${qtyColor(`qty: ${qty}`)}  ${price}`);
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to load inventory'));
      console.error(chalk.red(`  ${handleApiError(error).message}`));
    }
  });

// Get item by SKU
inventoryCommand
  .command('get <sku>')
  .description('Get inventory item by SKU')
  .option('--json', 'Output as JSON')
  .action(async (sku, options) => {
    requireAuth();
    const spinner = ora(`Loading item ${sku}...`).start();

    try {
      const response = await apiClient.get(`/Inventory/${encodeURIComponent(sku)}`);
      const item = response.data as any;

      if (options.json) {
        spinner.stop();
        console.log(JSON.stringify(item, null, 2));
        return;
      }

      spinner.succeed(chalk.green(`Item: ${sku}`));
      console.log('');
      console.log(`  ${chalk.bold('SKU:')}       ${item.sku || sku}`);
      console.log(`  ${chalk.bold('Name:')}      ${item.name || item.title || ''}`);
      console.log(`  ${chalk.bold('On Hand:')}   ${item.on_hand ?? item.quantity ?? 'N/A'}`);
      if (item.price !== undefined) console.log(`  ${chalk.bold('Price:')}     $${Number(item.price).toFixed(2)}`);
      if (item.cost !== undefined) console.log(`  ${chalk.bold('Cost:')}      $${Number(item.cost).toFixed(2)}`);
      if (item.category) console.log(`  ${chalk.bold('Category:')}  ${item.category}`);
      if (item.updated_at) console.log(`  ${chalk.bold('Updated:')}   ${item.updated_at}`);
    } catch (error) {
      spinner.fail(chalk.red(`Failed to load item ${sku}`));
      console.error(chalk.red(`  ${handleApiError(error).message}`));
    }
  });

// Create inventory item
inventoryCommand
  .command('create')
  .description('Create a new inventory item')
  .requiredOption('--sku <sku>', 'Item SKU')
  .requiredOption('--name <name>', 'Item name')
  .option('--quantity <n>', 'Initial quantity', '0')
  .option('--price <amount>', 'Price')
  .action(async (options) => {
    requireAuth();
    const spinner = ora('Creating inventory item...').start();

    try {
      const body: Record<string, unknown> = {
        sku: options.sku,
        name: options.name,
        on_hand: parseInt(options.quantity),
      };
      if (options.price) body.price = parseFloat(options.price);

      const response = await apiClient.post('/Inventory/', body);
      const item = response.data as any;

      spinner.succeed(chalk.green(`Item created: ${options.sku}`));
      console.log(chalk.dim(`  ${options.name} — qty: ${options.quantity}`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to create item'));
      console.error(chalk.red(`  ${handleApiError(error).message}`));
    }
  });

// Update inventory item
inventoryCommand
  .command('update <sku>')
  .description('Update an inventory item')
  .option('--name <name>', 'New name')
  .option('--price <amount>', 'New price')
  .action(async (sku, options) => {
    requireAuth();
    const body: Record<string, unknown> = {};
    if (options.name) body.name = options.name;
    if (options.price) body.price = parseFloat(options.price);

    if (Object.keys(body).length === 0) {
      console.error(chalk.red('Provide at least one field to update (--name, --price).'));
      process.exit(1);
    }

    const spinner = ora(`Updating item ${sku}...`).start();

    try {
      await apiClient.patch(`/Inventory/${encodeURIComponent(sku)}`, body);
      spinner.succeed(chalk.green(`Item ${sku} updated`));
    } catch (error) {
      spinner.fail(chalk.red(`Failed to update item ${sku}`));
      console.error(chalk.red(`  ${handleApiError(error).message}`));
    }
  });

// Adjust stock
inventoryCommand
  .command('adjust <sku>')
  .description('Adjust stock quantity')
  .requiredOption('--quantity <n>', 'Adjustment amount (positive or negative)')
  .option('--reason <text>', 'Reason for adjustment')
  .action(async (sku, options) => {
    requireAuth();
    const spinner = ora(`Adjusting stock for ${sku}...`).start();

    try {
      const body = {
        sku,
        quantity: parseInt(options.quantity),
        reason: options.reason || '',
      };

      await apiClient.post('/Inventory/adjust', body);
      const direction = parseInt(options.quantity) >= 0 ? '+' : '';
      spinner.succeed(chalk.green(`Stock adjusted: ${sku} (${direction}${options.quantity})`));
    } catch (error) {
      spinner.fail(chalk.red(`Failed to adjust stock for ${sku}`));
      console.error(chalk.red(`  ${handleApiError(error).message}`));
    }
  });

// CSV import
inventoryCommand
  .command('import <file>')
  .description('Bulk import from CSV file')
  .option('--dry-run', 'Preview changes without applying')
  .action(async (file, options) => {
    requireAuth();

    const fs = await import('fs');
    const path = await import('path');

    const filePath = path.resolve(file);
    if (!fs.existsSync(filePath)) {
      console.error(chalk.red(`File not found: ${filePath}`));
      process.exit(1);
    }

    const spinner = ora(options.dryRun ? 'Validating CSV...' : 'Importing CSV...').start();

    try {
      const FormData = (await import('form-data')).default;
      const form = new FormData();
      form.append('file', fs.createReadStream(filePath));
      if (options.dryRun) form.append('dry_run', 'true');

      const response = await apiClient.post('/api/v1/Inventory/uploadCsv', form);
      const data = response.data as any;

      if (options.dryRun) {
        spinner.succeed(chalk.green('Dry run complete'));
        console.log('');
        if (data.total !== undefined) console.log(`  ${chalk.bold('Rows:')}      ${data.total}`);
        if (data.valid !== undefined) console.log(`  ${chalk.bold('Valid:')}     ${chalk.green(data.valid)}`);
        if (data.errors !== undefined) console.log(`  ${chalk.bold('Errors:')}    ${data.errors > 0 ? chalk.red(data.errors) : chalk.green('0')}`);
        if (data.preview) {
          console.log('');
          console.log(chalk.dim('  Preview:'));
          for (const row of (data.preview as any[]).slice(0, 5)) {
            console.log(`    ${row.sku || row.id} — ${row.name || ''} qty: ${row.on_hand ?? row.quantity ?? '?'}`);
          }
        }
      } else {
        const imported = data.imported || data.created || data.total || 0;
        spinner.succeed(chalk.green(`Imported ${imported} item(s)`));
        if (data.errors && data.errors > 0) {
          console.log(chalk.yellow(`  ${data.errors} row(s) had errors`));
        }
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to import CSV'));
      console.error(chalk.red(`  ${handleApiError(error).message}`));
    }
  });
