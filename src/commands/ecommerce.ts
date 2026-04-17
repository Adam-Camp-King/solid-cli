/**
 * E-commerce commands.
 *
 * Wraps controllers/ecommerce_api.py at /api/v1/crm/ecommerce/* — carts, orders,
 * shipping, reviews, abandoned-carts. This is separate from `solid orders` which
 * targets the classic /api/v1/orders/* surface; the ecommerce API is the
 * customer-facing storefront flow.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';

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

export const ecommerceCommand = new Command('ecommerce')
  .alias('ec')
  .description('Storefront flow — carts, orders, shipping, reviews, abandoned carts');

// ── Carts ────────────────────────────────────────────────────────────

const cartsCmd = new Command('cart').description('Cart management');

cartsCmd
  .command('active')
  .description('Get or create the active cart for the company')
  .option('--customer <id>', 'Customer ID')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const cid = config.companyId;
    const spinner = ora('Loading active cart...').start();
    try {
      const params: Record<string, unknown> = { company_id: cid };
      if (opts.customer) params.customer_id = parseInt(opts.customer, 10);
      const res = await apiClient.get('/api/v1/crm/ecommerce/carts/active', { params });
      const c = res.data as Record<string, any>;
      if (opts.json) { spinner.stop(); console.log(JSON.stringify(c, null, 2)); return; }
      spinner.succeed(chalk.green(`Cart ${c.id}`));
      console.log('');
      console.log(`  ${chalk.bold('Items:')}     ${c.items?.length ?? 0}`);
      console.log(`  ${chalk.bold('Subtotal:')}  $${c.subtotal ?? 0}`);
      console.log(`  ${chalk.bold('Total:')}     $${c.total ?? 0}`);
    } catch (e) { fail(spinner, 'Failed to load cart', e); }
  });

cartsCmd
  .command('get <cart_id>')
  .description('Get a cart by ID')
  .option('--json', 'Output as JSON')
  .action(async (cartId, opts) => {
    requireAuth();
    const cid = config.companyId;
    const spinner = ora(`Loading cart ${cartId}...`).start();
    try {
      const res = await apiClient.get(`/api/v1/crm/ecommerce/cart/${cartId}`, { params: { company_id: cid } });
      const c = res.data as Record<string, any>;
      if (opts.json) { spinner.stop(); console.log(JSON.stringify(c, null, 2)); return; }
      spinner.succeed(chalk.green(`Cart ${cartId}`));
      console.log('');
      const items = c.items || [];
      for (const i of items as Record<string, any>[]) {
        console.log(`  ${chalk.bold(i.product_name || i.product_id)}  x${i.quantity}  $${i.price}`);
      }
      console.log('');
      console.log(`  ${chalk.bold('Subtotal:')} $${c.subtotal ?? 0}`);
      console.log(`  ${chalk.bold('Total:')}    $${c.total ?? 0}`);
    } catch (e) { fail(spinner, 'Failed to load cart', e); }
  });

cartsCmd
  .command('create')
  .description('Create a new cart')
  .option('--customer <id>', 'Customer ID')
  .action(async (opts) => {
    requireAuth();
    const body: Record<string, unknown> = { company_id: config.companyId };
    if (opts.customer) body.customer_id = parseInt(opts.customer, 10);
    const spinner = ora('Creating cart...').start();
    try {
      const res = await apiClient.post('/api/v1/crm/ecommerce/cart', body);
      const c = res.data as Record<string, any>;
      spinner.succeed(chalk.green(`Cart created: ${c.id}`));
    } catch (e) { fail(spinner, 'Failed to create cart', e); }
  });

cartsCmd
  .command('add <cart_id>')
  .description('Add an item to a cart')
  .requiredOption('--product <id>', 'Product ID')
  .requiredOption('--quantity <n>', 'Quantity')
  .action(async (cartId, opts) => {
    requireAuth();
    const body = {
      company_id: config.companyId,
      product_id: parseInt(opts.product, 10),
      quantity: parseInt(opts.quantity, 10),
    };
    const spinner = ora(`Adding to cart ${cartId}...`).start();
    try {
      await apiClient.post(`/api/v1/crm/ecommerce/cart/${cartId}/items`, body);
      spinner.succeed(chalk.green('Item added'));
    } catch (e) { fail(spinner, 'Failed to add item', e); }
  });

cartsCmd
  .command('update-item <cart_id> <item_id>')
  .description('Update cart item quantity')
  .requiredOption('--quantity <n>', 'New quantity')
  .action(async (cartId, itemId, opts) => {
    requireAuth();
    const spinner = ora('Updating item...').start();
    try {
      await apiClient.put(`/api/v1/crm/ecommerce/cart/${cartId}/items/${itemId}`, {
        company_id: config.companyId,
        quantity: parseInt(opts.quantity, 10),
      });
      spinner.succeed(chalk.green('Item updated'));
    } catch (e) { fail(spinner, 'Failed to update item', e); }
  });

cartsCmd
  .command('remove <cart_id> <item_id>')
  .description('Remove an item from a cart')
  .action(async (cartId, itemId) => {
    requireAuth();
    const spinner = ora('Removing item...').start();
    try {
      await apiClient.delete(`/api/v1/crm/ecommerce/cart/${cartId}/items/${itemId}`, { params: { company_id: config.companyId } });
      spinner.succeed(chalk.green('Item removed'));
    } catch (e) { fail(spinner, 'Failed to remove item', e); }
  });

cartsCmd
  .command('promo <cart_id>')
  .description('Apply a promo code to a cart')
  .requiredOption('--code <code>', 'Promo code')
  .action(async (cartId, opts) => {
    requireAuth();
    const spinner = ora('Applying promo...').start();
    try {
      await apiClient.post(`/api/v1/crm/ecommerce/cart/${cartId}/promo`, {
        company_id: config.companyId,
        code: opts.code,
      });
      spinner.succeed(chalk.green('Promo applied'));
    } catch (e) { fail(spinner, 'Failed to apply promo', e); }
  });

cartsCmd
  .command('promo-remove <cart_id>')
  .description('Remove the promo from a cart')
  .action(async (cartId) => {
    requireAuth();
    const spinner = ora('Removing promo...').start();
    try {
      await apiClient.delete(`/api/v1/crm/ecommerce/cart/${cartId}/promo`, { params: { company_id: config.companyId } });
      spinner.succeed(chalk.green('Promo removed'));
    } catch (e) { fail(spinner, 'Failed to remove promo', e); }
  });

ecommerceCommand.addCommand(cartsCmd);

// ── Orders (storefront) ──────────────────────────────────────────────

const ordersCmd = new Command('orders').description('Storefront orders');

ordersCmd
  .command('list')
  .description('List storefront orders')
  .option('-l, --limit <n>', 'Limit', '50')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading orders...').start();
    try {
      const res = await apiClient.get('/api/v1/crm/ecommerce/orders', {
        params: { limit: parseInt(opts.limit, 10) },
      });
      const data = res.data as Record<string, any>;
      const items = data.orders || data.items || [];
      if (opts.json) { spinner.stop(); console.log(JSON.stringify(data, null, 2)); return; }
      spinner.succeed(chalk.green(`${items.length} order(s)`));
      console.log('');
      for (const o of items as Record<string, any>[]) {
        console.log(`  ${chalk.bold(o.id)}  ${o.customer_email || '—'}  $${o.total ?? 0}  ${chalk.dim(o.status || '')}`);
      }
    } catch (e) { fail(spinner, 'Failed to load orders', e); }
  });

ordersCmd
  .command('get <id>')
  .description('Get a storefront order')
  .option('--json', 'Output as JSON')
  .action(async (id, opts) => {
    requireAuth();
    const spinner = ora(`Loading order ${id}...`).start();
    try {
      const res = await apiClient.get(`/api/v1/crm/ecommerce/orders/${id}`);
      const o = res.data as Record<string, any>;
      if (opts.json) { spinner.stop(); console.log(JSON.stringify(o, null, 2)); return; }
      spinner.succeed(chalk.green(`Order ${id}`));
      console.log('');
      console.log(`  ${chalk.bold('Customer:')}  ${o.customer_email || '—'}`);
      console.log(`  ${chalk.bold('Status:')}    ${o.status || '—'}`);
      console.log(`  ${chalk.bold('Payment:')}   ${o.payment_status || '—'}`);
      console.log(`  ${chalk.bold('Total:')}     $${o.total ?? '—'}`);
    } catch (e) { fail(spinner, 'Failed to load order', e); }
  });

ordersCmd
  .command('create')
  .description('Create a storefront order from a cart')
  .requiredOption('--cart <id>', 'Cart ID')
  .requiredOption('--customer-email <email>', 'Customer email')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Creating order...').start();
    try {
      const res = await apiClient.post('/api/v1/crm/ecommerce/orders', {
        cart_id: parseInt(opts.cart, 10),
        customer_email: opts.customerEmail,
      });
      const o = res.data as Record<string, any>;
      spinner.succeed(chalk.green(`Order created: ${o.id}`));
    } catch (e) { fail(spinner, 'Failed to create order', e); }
  });

ordersCmd
  .command('status <id>')
  .description('Update order status')
  .requiredOption('--status <status>', 'New status (pending, processing, shipped, delivered, cancelled)')
  .action(async (id, opts) => {
    requireAuth();
    const spinner = ora('Updating status...').start();
    try {
      await apiClient.put(`/api/v1/crm/ecommerce/orders/${id}/status`, { status: opts.status });
      spinner.succeed(chalk.green(`Status set to ${opts.status}`));
    } catch (e) { fail(spinner, 'Failed to update status', e); }
  });

ordersCmd
  .command('payment <id>')
  .description('Update payment status')
  .requiredOption('--status <status>', 'paid | unpaid | refunded | failed')
  .action(async (id, opts) => {
    requireAuth();
    const spinner = ora('Updating payment...').start();
    try {
      await apiClient.put(`/api/v1/crm/ecommerce/orders/${id}/payment`, { payment_status: opts.status });
      spinner.succeed(chalk.green(`Payment status: ${opts.status}`));
    } catch (e) { fail(spinner, 'Failed to update payment', e); }
  });

ordersCmd
  .command('tracking <id>')
  .description('Add shipping tracking')
  .requiredOption('--carrier <name>', 'Carrier (UPS, FedEx, USPS)')
  .requiredOption('--number <tracking>', 'Tracking number')
  .action(async (id, opts) => {
    requireAuth();
    const spinner = ora('Adding tracking...').start();
    try {
      await apiClient.put(`/api/v1/crm/ecommerce/orders/${id}/tracking`, {
        carrier: opts.carrier,
        tracking_number: opts.number,
      });
      spinner.succeed(chalk.green('Tracking added'));
    } catch (e) { fail(spinner, 'Failed to add tracking', e); }
  });

ordersCmd
  .command('cancel <id>')
  .description('Cancel a storefront order')
  .option('--reason <text>', 'Reason')
  .action(async (id, opts) => {
    requireAuth();
    const spinner = ora('Cancelling order...').start();
    try {
      await apiClient.post(`/api/v1/crm/ecommerce/orders/${id}/cancel`, { reason: opts.reason || '' });
      spinner.succeed(chalk.green('Order cancelled'));
    } catch (e) { fail(spinner, 'Failed to cancel order', e); }
  });

ordersCmd
  .command('refund <id>')
  .description('Refund a storefront order')
  .option('--amount <amount>', 'Partial amount')
  .option('--reason <text>', 'Reason')
  .action(async (id, opts) => {
    requireAuth();
    const body: Record<string, unknown> = {};
    if (opts.amount) body.amount = parseFloat(opts.amount);
    if (opts.reason) body.reason = opts.reason;
    const spinner = ora('Refunding order...').start();
    try {
      await apiClient.post(`/api/v1/crm/ecommerce/orders/${id}/refund`, body);
      spinner.succeed(chalk.green('Order refunded'));
    } catch (e) { fail(spinner, 'Failed to refund order', e); }
  });

ordersCmd
  .command('stats')
  .description('Storefront order stats')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading stats...').start();
    try {
      const res = await apiClient.get('/api/v1/crm/ecommerce/orders/stats');
      const s = res.data as Record<string, any>;
      if (opts.json) { spinner.stop(); console.log(JSON.stringify(s, null, 2)); return; }
      spinner.succeed(chalk.green('Storefront stats'));
      console.log('');
      console.log(`  ${chalk.bold('Orders today:')}    ${s.orders_today ?? 'N/A'}`);
      console.log(`  ${chalk.bold('Revenue today:')}   $${s.revenue_today ?? 0}`);
      console.log(`  ${chalk.bold('Avg order:')}       $${s.avg_order_value ?? 0}`);
      console.log(`  ${chalk.bold('Conversion:')}      ${s.conversion_rate ? `${s.conversion_rate}%` : 'N/A'}`);
    } catch (e) { fail(spinner, 'Failed to load stats', e); }
  });

ecommerceCommand.addCommand(ordersCmd);

// ── Shipping ─────────────────────────────────────────────────────────

const shippingCmd = new Command('shipping').description('Shipping addresses, methods, rates');

shippingCmd
  .command('addresses')
  .description('List shipping addresses')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading addresses...').start();
    try {
      const res = await apiClient.get('/api/v1/crm/ecommerce/shipping/addresses');
      const data = res.data as Record<string, any>;
      const items = data.addresses || data.items || [];
      if (opts.json) { spinner.stop(); console.log(JSON.stringify(data, null, 2)); return; }
      spinner.succeed(chalk.green(`${items.length} address(es)`));
      console.log('');
      for (const a of items as Record<string, any>[]) {
        console.log(`  ${chalk.bold(a.id)}  ${a.line1}  ${a.city}, ${a.state}  ${a.postal_code}`);
      }
    } catch (e) { fail(spinner, 'Failed to load addresses', e); }
  });

shippingCmd
  .command('add-address')
  .description('Add a shipping address')
  .requiredOption('--line1 <text>', 'Street line 1')
  .option('--line2 <text>', 'Street line 2')
  .requiredOption('--city <city>', 'City')
  .requiredOption('--state <state>', 'State')
  .requiredOption('--postal <postal>', 'Postal code')
  .option('--country <country>', 'Country', 'US')
  .action(async (opts) => {
    requireAuth();
    const body = {
      line1: opts.line1,
      line2: opts.line2 || null,
      city: opts.city,
      state: opts.state,
      postal_code: opts.postal,
      country: opts.country,
    };
    const spinner = ora('Adding address...').start();
    try {
      const res = await apiClient.post('/api/v1/crm/ecommerce/shipping/addresses', body);
      spinner.succeed(chalk.green(`Address added: ${(res.data as any).id}`));
    } catch (e) { fail(spinner, 'Failed to add address', e); }
  });

shippingCmd
  .command('methods')
  .description('List shipping methods')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading methods...').start();
    try {
      const res = await apiClient.get('/api/v1/crm/ecommerce/shipping/methods');
      const data = res.data as Record<string, any>;
      const items = data.methods || data.items || [];
      if (opts.json) { spinner.stop(); console.log(JSON.stringify(data, null, 2)); return; }
      spinner.succeed(chalk.green(`${items.length} method(s)`));
      console.log('');
      for (const m of items as Record<string, any>[]) {
        console.log(`  ${chalk.bold(m.name)}  $${m.price ?? 0}  ${chalk.dim(m.estimated_days ? `${m.estimated_days}d` : '')}`);
      }
    } catch (e) { fail(spinner, 'Failed to load methods', e); }
  });

shippingCmd
  .command('rates')
  .description('Get shipping rates for a destination')
  .requiredOption('--postal <postal>', 'Destination postal code')
  .option('--country <country>', 'Country', 'US')
  .option('--weight <oz>', 'Weight in ounces')
  .action(async (opts) => {
    requireAuth();
    const body: Record<string, unknown> = { postal_code: opts.postal, country: opts.country };
    if (opts.weight) body.weight_oz = parseFloat(opts.weight);
    const spinner = ora('Calculating rates...').start();
    try {
      const res = await apiClient.post('/api/v1/crm/ecommerce/shipping/rates', body);
      const data = res.data as Record<string, any>;
      const rates = data.rates || [];
      spinner.succeed(chalk.green(`${rates.length} rate(s)`));
      console.log('');
      for (const r of rates as Record<string, any>[]) {
        console.log(`  ${chalk.bold(r.method)}  $${r.price}  ${chalk.dim(r.estimated_days ? `${r.estimated_days}d` : '')}`);
      }
    } catch (e) { fail(spinner, 'Failed to calculate rates', e); }
  });

ecommerceCommand.addCommand(shippingCmd);

// ── Reviews ──────────────────────────────────────────────────────────

const reviewsCmd = new Command('reviews').description('Product reviews');

reviewsCmd
  .command('list')
  .description('List reviews (optionally filtered)')
  .option('--product <id>', 'Filter by product ID')
  .option('--status <status>', 'pending | approved | rejected')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const params: Record<string, unknown> = {};
    if (opts.product) params.product_id = parseInt(opts.product, 10);
    if (opts.status) params.status = opts.status;
    const spinner = ora('Loading reviews...').start();
    try {
      const res = await apiClient.get('/api/v1/crm/ecommerce/reviews', { params });
      const data = res.data as Record<string, any>;
      const items = data.reviews || data.items || [];
      if (opts.json) { spinner.stop(); console.log(JSON.stringify(data, null, 2)); return; }
      spinner.succeed(chalk.green(`${items.length} review(s)`));
      console.log('');
      for (const r of items as Record<string, any>[]) {
        const stars = '★'.repeat(r.rating ?? 0) + '☆'.repeat(5 - (r.rating ?? 0));
        console.log(`  ${chalk.yellow(stars)}  ${chalk.bold(r.title || '—')}  ${chalk.dim(r.author_name || '')}`);
        if (r.body) console.log(chalk.dim(`    ${r.body.substring(0, 80)}`));
      }
    } catch (e) { fail(spinner, 'Failed to load reviews', e); }
  });

reviewsCmd
  .command('create')
  .description('Submit a review')
  .requiredOption('--product <id>', 'Product ID')
  .requiredOption('--rating <n>', '1-5')
  .option('--title <text>', 'Title')
  .option('--body <text>', 'Body')
  .action(async (opts) => {
    requireAuth();
    const body = {
      product_id: parseInt(opts.product, 10),
      rating: parseInt(opts.rating, 10),
      title: opts.title || '',
      body: opts.body || '',
    };
    const spinner = ora('Submitting review...').start();
    try {
      const res = await apiClient.post('/api/v1/crm/ecommerce/reviews', body);
      spinner.succeed(chalk.green(`Review created: ${(res.data as any).id}`));
    } catch (e) { fail(spinner, 'Failed to submit review', e); }
  });

reviewsCmd
  .command('moderate <id>')
  .description('Approve or reject a review')
  .requiredOption('--status <status>', 'approved | rejected')
  .action(async (id, opts) => {
    requireAuth();
    const spinner = ora('Moderating...').start();
    try {
      await apiClient.put(`/api/v1/crm/ecommerce/reviews/${id}/moderate`, { status: opts.status });
      spinner.succeed(chalk.green(`Review ${opts.status}`));
    } catch (e) { fail(spinner, 'Failed to moderate review', e); }
  });

reviewsCmd
  .command('helpful <id>')
  .description('Mark a review as helpful')
  .action(async (id) => {
    requireAuth();
    const spinner = ora('Updating...').start();
    try {
      await apiClient.post(`/api/v1/crm/ecommerce/reviews/${id}/helpful`);
      spinner.succeed(chalk.green('Marked helpful'));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

reviewsCmd
  .command('rating <product_id>')
  .description("Get a product's average rating")
  .option('--json', 'Output as JSON')
  .action(async (productId, opts) => {
    requireAuth();
    const spinner = ora('Loading rating...').start();
    try {
      const res = await apiClient.get(`/api/v1/crm/ecommerce/products/${productId}/rating`);
      const r = res.data as Record<string, any>;
      if (opts.json) { spinner.stop(); console.log(JSON.stringify(r, null, 2)); return; }
      spinner.succeed(chalk.green(`Rating for product ${productId}`));
      console.log('');
      console.log(`  ${chalk.bold('Average:')} ${r.average_rating ?? 'N/A'} (${r.review_count ?? 0} reviews)`);
    } catch (e) { fail(spinner, 'Failed to load rating', e); }
  });

ecommerceCommand.addCommand(reviewsCmd);

// ── Abandoned Carts ──────────────────────────────────────────────────

const abandonedCmd = new Command('abandoned').description('Abandoned carts');

abandonedCmd
  .command('list')
  .description('List abandoned carts')
  .option('-l, --limit <n>', 'Limit', '50')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading abandoned carts...').start();
    try {
      const res = await apiClient.get('/api/v1/crm/ecommerce/abandoned-carts', {
        params: { limit: parseInt(opts.limit, 10) },
      });
      const data = res.data as Record<string, any>;
      const items = data.carts || data.items || [];
      if (opts.json) { spinner.stop(); console.log(JSON.stringify(data, null, 2)); return; }
      spinner.succeed(chalk.green(`${items.length} abandoned cart(s)`));
      console.log('');
      for (const c of items as Record<string, any>[]) {
        console.log(`  ${chalk.bold(c.id)}  ${c.customer_email || '—'}  $${c.total ?? 0}  ${chalk.dim(c.abandoned_at?.split('T')[0] || '')}`);
      }
    } catch (e) { fail(spinner, 'Failed to load abandoned carts', e); }
  });

abandonedCmd
  .command('stats')
  .description('Abandoned cart stats')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading stats...').start();
    try {
      const res = await apiClient.get('/api/v1/crm/ecommerce/abandoned-carts/stats');
      const s = res.data as Record<string, any>;
      if (opts.json) { spinner.stop(); console.log(JSON.stringify(s, null, 2)); return; }
      spinner.succeed(chalk.green('Abandoned-cart stats'));
      console.log('');
      console.log(`  ${chalk.bold('Count:')}      ${s.total_count ?? 'N/A'}`);
      console.log(`  ${chalk.bold('Lost value:')} $${s.total_lost_value ?? 0}`);
      console.log(`  ${chalk.bold('Recovery:')}   ${s.recovery_rate ? `${s.recovery_rate}%` : 'N/A'}`);
    } catch (e) { fail(spinner, 'Failed to load stats', e); }
  });

abandonedCmd
  .command('funnel')
  .description('Abandoned cart funnel breakdown')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading funnel...').start();
    try {
      const res = await apiClient.get('/api/v1/crm/ecommerce/abandoned-carts/funnel');
      if (opts.json) { spinner.stop(); console.log(JSON.stringify(res.data, null, 2)); return; }
      spinner.succeed(chalk.green('Funnel'));
      const f = res.data as Record<string, any>;
      const stages = f.stages || [];
      for (const s of stages as Record<string, any>[]) {
        console.log(`  ${chalk.bold(s.stage)}: ${s.count} (${s.percentage ?? '?'}%)`);
      }
    } catch (e) { fail(spinner, 'Failed to load funnel', e); }
  });

ecommerceCommand.addCommand(abandonedCmd);
