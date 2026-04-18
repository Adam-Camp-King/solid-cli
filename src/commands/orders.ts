/**
 * Orders commands.
 * Wraps controllers/orders.py at /api/v1/orders/* (list, get, create, confirm,
 * cancel, refund, allocate, fulfill, quick-sale).
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

export const ordersCommand = new Command('orders')
  .description('Order lifecycle (list, create, confirm, fulfill, cancel, refund)');

ordersCommand
  .command('list')
  .description('List orders')
  .option('-l, --limit <n>', 'Max results', '100')
  .option('--offset <n>', 'Offset', '0')
  .option('--status <status>', 'Filter by status')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading orders...').start();
    try {
      const params: Record<string, unknown> = {
        limit: parseInt(opts.limit, 10),
        offset: parseInt(opts.offset, 10),
      };
      if (opts.status) params.status = opts.status;
      const res = await apiClient.get('/api/v1/orders/', { params });
      const data = res.data as Record<string, any>;
      const items = data.items || data.orders || data;
      const list = Array.isArray(items) ? items : (items.items || []);
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(data, null, 2)); return; }
      spinner.succeed(chalk.green(`${list.length} order(s)`));
      console.log('');
      for (const o of list as Record<string, any>[]) {
        const total = o.total !== undefined ? chalk.green(`$${Number(o.total).toFixed(2)}`) : chalk.dim('—');
        console.log(`  ${chalk.bold(o.id)}  ${o.customer_name || o.customer_email || '—'}  ${total}  ${chalk.dim(o.status || '')}  ${chalk.dim(o.created_at?.split('T')[0] || '')}`);
      }
    } catch (e) { fail(spinner, 'Failed to load orders', e); }
  });

ordersCommand
  .command('get <id>')
  .description('Get order details')
  .option('--json', 'Output as JSON')
  .action(async (id, opts) => {
    requireAuth();
    const spinner = ora(`Loading order ${id}...`).start();
    try {
      const res = await apiClient.get(`/api/v1/orders/${id}`);
      const o = res.data as Record<string, any>;
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(o, null, 2)); return; }
      spinner.succeed(chalk.green(`Order ${id}`));
      console.log('');
      console.log(`  ${chalk.bold('Status:')}    ${o.status || '—'}`);
      console.log(`  ${chalk.bold('Customer:')}  ${o.customer_name || o.customer_email || '—'}`);
      console.log(`  ${chalk.bold('Total:')}     $${o.total ?? '—'}`);
      console.log(`  ${chalk.bold('Items:')}     ${o.items?.length ?? o.line_items?.length ?? 0}`);
      console.log(`  ${chalk.bold('Created:')}   ${o.created_at || '—'}`);
    } catch (e) { fail(spinner, 'Failed to load order', e); }
  });

ordersCommand
  .command('create')
  .description('Create an order from a JSON payload (use --file or --items)')
  .option('--file <path>', 'JSON file with order payload')
  .option('--items <json>', 'Inline JSON: [{"product_id":1,"quantity":2}]')
  .option('--customer-email <email>')
  .option('--location <id>', 'Location ID')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Creating order...').start();
    try {
      let payload: Record<string, unknown> = {};
      if (opts.file) {
        const fs = await import('fs');
        payload = JSON.parse(fs.readFileSync(opts.file, 'utf-8'));
      } else if (opts.items) {
        payload.items = JSON.parse(opts.items);
      } else {
        spinner.fail(chalk.red('Provide --file or --items.'));
        process.exit(1);
      }
      if (opts.customerEmail) payload.customer_email = opts.customerEmail;
      const url = opts.location ? `/api/v1/orders/?location_id=${opts.location}` : '/api/v1/orders/';
      const res = await apiClient.post(url, payload);
      const o = res.data as Record<string, any>;
      spinner.succeed(chalk.green(`Order created: ${o.id}`));
    } catch (e) { fail(spinner, 'Failed to create order', e); }
  });

ordersCommand
  .command('confirm <id>')
  .description('Confirm a pending order')
  .action(async (id) => {
    requireAuth();
    const spinner = ora(`Confirming order ${id}...`).start();
    try {
      await apiClient.post(`/api/v1/orders/${id}/confirm`);
      spinner.succeed(chalk.green(`Order ${id} confirmed`));
    } catch (e) { fail(spinner, 'Failed to confirm order', e); }
  });

ordersCommand
  .command('cancel <id>')
  .description('Cancel an order')
  .action(async (id) => {
    requireAuth();
    const spinner = ora(`Cancelling order ${id}...`).start();
    try {
      await apiClient.post(`/api/v1/orders/${id}/cancel`);
      spinner.succeed(chalk.green(`Order ${id} cancelled`));
    } catch (e) { fail(spinner, 'Failed to cancel order', e); }
  });

ordersCommand
  .command('refund <id>')
  .description('Refund an order')
  .option('--amount <amount>', 'Partial refund amount (omit for full)')
  .option('--reason <text>', 'Reason for refund')
  .action(async (id, opts) => {
    requireAuth();
    const body: Record<string, unknown> = {};
    if (opts.amount) body.amount = parseFloat(opts.amount);
    if (opts.reason) body.reason = opts.reason;
    const spinner = ora(`Refunding order ${id}...`).start();
    try {
      await apiClient.post(`/api/v1/orders/${id}/refund`, body);
      spinner.succeed(chalk.green(`Order ${id} refunded`));
    } catch (e) { fail(spinner, 'Failed to refund order', e); }
  });

ordersCommand
  .command('allocate <id>')
  .description('Allocate inventory for an order')
  .option('--location <id>', 'Location to allocate from')
  .action(async (id, opts) => {
    requireAuth();
    const body: Record<string, unknown> = {};
    if (opts.location) body.location_id = parseInt(opts.location, 10);
    const spinner = ora(`Allocating order ${id}...`).start();
    try {
      await apiClient.post(`/api/v1/orders/${id}/allocate`, body);
      spinner.succeed(chalk.green(`Order ${id} allocated`));
    } catch (e) { fail(spinner, 'Failed to allocate order', e); }
  });

ordersCommand
  .command('fulfill <id>')
  .description('Mark an order fulfilled')
  .action(async (id) => {
    requireAuth();
    const spinner = ora(`Fulfilling order ${id}...`).start();
    try {
      await apiClient.post(`/api/v1/orders/${id}/fulfill`);
      spinner.succeed(chalk.green(`Order ${id} fulfilled`));
    } catch (e) { fail(spinner, 'Failed to fulfill order', e); }
  });

ordersCommand
  .command('quick-sale')
  .description('Single-line POS-style sale (one product, one customer)')
  .requiredOption('--product <id>', 'Product ID')
  .requiredOption('--quantity <n>', 'Quantity')
  .option('--customer-email <email>')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Recording quick sale...').start();
    try {
      const body: Record<string, unknown> = {
        product_id: parseInt(opts.product, 10),
        quantity: parseInt(opts.quantity, 10),
      };
      if (opts.customerEmail) body.customer_email = opts.customerEmail;
      const res = await apiClient.post('/api/v1/orders/quick-sale', body);
      const o = res.data as Record<string, any>;
      spinner.succeed(chalk.green(`Sale recorded: order ${o.order_id || o.id}`));
    } catch (e) { fail(spinner, 'Failed to record sale', e); }
  });
