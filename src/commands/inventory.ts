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
import { isJsonOutput } from '../lib/json-output';

function requireAuth() {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
}

export const inventoryCommand = new Command('inventory')
  .description('Inventory & stock management');

// List inventory items — full scripting contract
{
  const { withListFlags } = require('../lib/command-kit') as typeof import('../lib/command-kit');
  const listCmd = inventoryCommand.command('list').description('List inventory items');
  withListFlags(listCmd);
  listCmd.action(async (opts: import('../lib/command-kit').ListFlags) => {
    const { runListCommand } = await import('../lib/command-kit');
    await runListCommand(opts, {
      spinnerText: 'Loading inventory...',
      errorText: 'Failed to load inventory',
      fetch: async (offset, limit) =>
        (await apiClient.get('/api/v1/Inventory/list', { params: { limit, offset } })).data,
      extract: (page) => {
        const d = page as Record<string, unknown>;
        return ((d.items || d.inventory || []) as Array<Record<string, unknown>>);
      },
      render: (items) => {
        if (!items.length) { console.log(chalk.dim('  No inventory items found.')); return; }
        console.log('');
        for (const it of items) {
          const qty = (it.on_hand ?? it.quantity ?? 0) as number;
          const qtyColor = qty <= 0 ? chalk.red : qty < 10 ? chalk.yellow : chalk.green;
          const price = it.price !== undefined ? chalk.green(`$${Number(it.price).toFixed(2)}`) : '';
          console.log(`  ${chalk.bold(String(it.sku || it.id))}  ${it.name || it.title}  ${qtyColor(`qty: ${qty}`)}  ${price}`);
        }
      },
    });
  });
}

// Get item by SKU
inventoryCommand
  .command('get <sku>')
  .description('Get inventory item by SKU')
  .option('--json', 'Output as JSON')
  .action(async (sku, options) => {
    requireAuth();
    const spinner = ora(`Loading item ${sku}...`).start();

    try {
      const response = await apiClient.get(`/api/v1/Inventory/get`, { params: { sku } });
      const item = response.data as Record<string, any>;

      if (isJsonOutput(options)) {
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

      const response = await apiClient.post('/api/v1/Inventory/create', body);
      const item = response.data as Record<string, any>;

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
      await apiClient.post('/api/v1/Inventory/update', { ...body, sku });
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

      await apiClient.post('/api/v1/Inventory/adjust', body);
      const direction = parseInt(options.quantity) >= 0 ? '+' : '';
      spinner.succeed(chalk.green(`Stock adjusted: ${sku} (${direction}${options.quantity})`));
    } catch (error) {
      spinner.fail(chalk.red(`Failed to adjust stock for ${sku}`));
      console.error(chalk.red(`  ${handleApiError(error).message}`));
    }
  });

// Archive (soft-delete) inventory item. `delete` is kept as an alias but
// archive is the actual semantic — data is retained, the item is hidden.
// Use `unarchive` to restore. There is no hard-delete path in the API.
inventoryCommand
  .command('archive <sku>')
  .alias('delete')
  .description('Archive (soft-delete) an inventory item — data is retained, restore with unarchive')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (sku: string, opts: { yes?: boolean }) => {
    requireAuth();
    const { confirm } = await import('../lib/command-kit');
    const ok = await confirm(
      `Archive inventory item "${sku}"? (restore with: solid inventory unarchive ${sku})`,
      { autoConfirm: Boolean(opts.yes) },
    );
    if (!ok) { console.error(chalk.dim('  Cancelled.')); process.exit(1); }
    const spinner = ora({ text: `Archiving ${sku}...`, stream: process.stderr }).start();
    try {
      await apiClient.post('/api/v1/Inventory/archive', { sku });
      spinner.succeed(chalk.green(`Item ${sku} archived`));
    } catch (error) {
      spinner.fail(chalk.red(`Failed to archive ${sku}`));
      console.error(chalk.red(`  ${handleApiError(error).message}`));
      process.exit(1);
    }
  });

// Restore an archived item. Mirror of `archive`.
inventoryCommand
  .command('unarchive <sku>')
  .alias('restore')
  .description('Restore a previously archived inventory item')
  .action(async (sku: string) => {
    requireAuth();
    const spinner = ora({ text: `Restoring ${sku}...`, stream: process.stderr }).start();
    try {
      await apiClient.post('/api/v1/Inventory/unarchive', { sku });
      spinner.succeed(chalk.green(`Item ${sku} restored`));
    } catch (error) {
      spinner.fail(chalk.red(`Failed to restore ${sku}`));
      console.error(chalk.red(`  ${handleApiError(error).message}`));
      process.exit(1);
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
      const data = response.data as Record<string, any>;

      if (options.dryRun) {
        spinner.succeed(chalk.green('Dry run complete'));
        console.log('');
        if (data.total !== undefined) console.log(`  ${chalk.bold('Rows:')}      ${data.total}`);
        if (data.valid !== undefined) console.log(`  ${chalk.bold('Valid:')}     ${chalk.green(data.valid)}`);
        if (data.errors !== undefined) console.log(`  ${chalk.bold('Errors:')}    ${data.errors > 0 ? chalk.red(data.errors) : chalk.green('0')}`);
        if (data.preview) {
          console.log('');
          console.log(chalk.dim('  Preview:'));
          for (const row of (data.preview as Record<string, string>[]).slice(0, 5)) {
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
