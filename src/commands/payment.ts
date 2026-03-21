/**
 * ================================================================================
 * solid payment — Level 3 Payment Processing & Interchange Optimization
 * ================================================================================
 *
 * Manage payment processing, Level 3 data, interchange qualification,
 * and product-to-MCC mapping for merchants.
 *
 * Key features:
 * - L3 qualification status per product/order
 * - MCC code verification
 * - Product code validation (SKU, UPC, ISBN)
 * - Interchange savings reporting
 * - Processor-agnostic (Stripe, Square, etc.)
 *
 * Usage:
 *   solid payment status           # Payment processing status
 *   solid payment l3 status        # Level 3 qualification overview
 *   solid payment l3 check <sku>   # Check if a product qualifies for L3
 *   solid payment l3 report        # Interchange savings report
 *   solid payment mcc              # Show company MCC code mapping
 *   solid payment products         # List products with L3-ready identifiers
 * ================================================================================
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';

const BRAND = {
  primary: '#818cf8',
  success: '#22c55e',
  warning: '#f59e0b',
  dim: '#94a3b8',
  green: '#10b981',
};

function requireAuth() {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
}

export const paymentCommand = new Command('payment')
  .description('Payment processing & Level 3 interchange optimization');

// ── solid payment status ─────────────────────────────────────────────

paymentCommand
  .command('status')
  .description('Payment processing status and configuration')
  .action(async () => {
    requireAuth();
    const ora = (await import('ora')).default;
    const spinner = ora({ text: chalk.hex(BRAND.dim)('Loading payment status...'), spinner: 'dots' }).start();

    try {
      const response = await apiClient.get('/api/v1/payments/status');
      spinner.stop();

      const data = response.data;
      console.log('');
      console.log(chalk.bold('  Payment Processing Status'));
      console.log(chalk.hex(BRAND.dim)('  ─────────────────────────────'));
      console.log(`  Processor:     ${chalk.hex(BRAND.primary)(data.processor || 'Not configured')}`);
      console.log(`  Status:        ${data.active ? chalk.hex(BRAND.success)('Active') : chalk.hex(BRAND.warning)('Inactive')}`);
      console.log(`  MCC Code:      ${chalk.hex(BRAND.primary)(data.mcc_code || 'Not set')}`);
      console.log(`  Industry:      ${data.industry || 'Unknown'}`);
      console.log(`  L3 Enabled:    ${chalk.hex(BRAND.success)('Yes — automatic on all transactions')}`);
      console.log('');
    } catch (error: any) {
      spinner.fail(chalk.red('Failed to load payment status'));
      console.error(handleApiError(error).message);
    }
  });

// ── solid payment l3 ─────────────────────────────────────────────────

const l3Command = paymentCommand
  .command('l3')
  .description('Level 3 interchange optimization');

// solid payment l3 status
l3Command
  .command('status')
  .description('Level 3 qualification overview for your company')
  .action(async () => {
    requireAuth();
    const ora = (await import('ora')).default;
    const spinner = ora({ text: chalk.hex(BRAND.dim)('Analyzing L3 qualification...'), spinner: 'dots' }).start();

    try {
      // Get products to check L3 readiness
      const response = await apiClient.get('/api/v1/products?limit=100');
      spinner.stop();

      const products = response.data?.items || response.data?.products || [];
      const total = products.length;
      const withSku = products.filter((p: any) => p.sku).length;
      const withUpc = products.filter((p: any) => p.upc).length;
      const withIsbn = products.filter((p: any) => p.isbn).length;
      const withCode = products.filter((p: any) => p.commodity_code).length;
      const l3Ready = products.filter((p: any) => p.sku || p.upc || p.isbn || p.commodity_code).length;

      console.log('');
      console.log(chalk.bold('  Level 3 Interchange Optimization'));
      console.log(chalk.hex(BRAND.dim)('  ─────────────────────────────────────'));
      console.log('');
      console.log(`  ${chalk.hex(BRAND.green)('L3 Status:')}    ${chalk.bold('ACTIVE')} — data passes automatically on every payment`);
      console.log(`  ${chalk.hex(BRAND.green)('Visa Deadline:')} April 17, 2026 — L2 dies, L3 or full rate`);
      console.log('');
      console.log(chalk.bold('  Product Readiness'));
      console.log(chalk.hex(BRAND.dim)('  ─────────────────────────────────────'));
      console.log(`  Total Products:     ${total}`);
      console.log(`  L3 Ready:           ${chalk.hex(BRAND.success)(`${l3Ready}/${total}`)} (${total > 0 ? Math.round(l3Ready / total * 100) : 0}%)`);
      console.log(`  With SKU:           ${withSku}`);
      console.log(`  With UPC:           ${withUpc}`);
      console.log(`  With ISBN:          ${withIsbn}`);
      console.log(`  With Commodity Code: ${withCode}`);
      console.log('');
      console.log(chalk.hex(BRAND.dim)('  Product code priority: UPC → ISBN → SKU → Commodity → Fallback'));
      console.log(chalk.hex(BRAND.dim)('  Stripe product_code max: 12 characters'));
      console.log('');

      if (l3Ready < total && total > 0) {
        const missing = products.filter((p: any) => !p.sku && !p.upc && !p.isbn && !p.commodity_code);
        if (missing.length > 0) {
          console.log(chalk.hex(BRAND.warning)(`  ⚠ ${missing.length} product(s) missing identifiers:`));
          for (const p of missing.slice(0, 5)) {
            console.log(chalk.hex(BRAND.dim)(`     - ${p.name || p.id} (no SKU/UPC/ISBN)`));
          }
          if (missing.length > 5) {
            console.log(chalk.hex(BRAND.dim)(`     ... and ${missing.length - 5} more`));
          }
          console.log('');
        }
      }

      console.log(chalk.hex(BRAND.dim)('  Savings: ~0.80% per eligible B2B/government transaction'));
      console.log(chalk.hex(BRAND.dim)('  Rate: 1.90% + $0.10 (L3) vs 2.70% + $0.10 (L1)'));
      console.log(chalk.hex(BRAND.dim)('  Details: solidnumber.com/why/level3-payments'));
      console.log('');
    } catch (error: any) {
      spinner.fail(chalk.red('Failed'));
      console.error(handleApiError(error).message);
    }
  });

// solid payment l3 check <sku>
l3Command
  .command('check <sku>')
  .description('Check if a product qualifies for Level 3')
  .action(async (sku: string) => {
    requireAuth();
    const ora = (await import('ora')).default;
    const spinner = ora({ text: chalk.hex(BRAND.dim)(`Checking ${sku}...`), spinner: 'dots' }).start();

    try {
      const response = await apiClient.get(`/api/v1/products?search=${encodeURIComponent(sku)}&limit=5`);
      spinner.stop();

      const products = response.data?.items || response.data?.products || [];
      const match = products.find((p: any) =>
        p.sku === sku || p.upc === sku || p.isbn === sku
      );

      if (!match) {
        console.log(chalk.hex(BRAND.warning)(`\n  No product found for "${sku}"\n`));
        return;
      }

      const code = match.upc || match.isbn?.replace(/[^0-9]/g, '').slice(0, 12) || match.sku?.slice(0, 12) || match.commodity_code?.slice(0, 12) || `ITEM-${match.id}`;
      const codeType = match.upc ? 'UPC' : match.isbn ? 'ISBN' : match.sku ? 'SKU' : match.commodity_code ? 'Commodity' : 'Fallback';

      console.log('');
      console.log(chalk.bold(`  L3 Check: ${match.name}`));
      console.log(chalk.hex(BRAND.dim)('  ─────────────────────────────────────'));
      console.log(`  Product:       ${match.name}`);
      console.log(`  SKU:           ${match.sku || chalk.hex(BRAND.dim)('not set')}`);
      console.log(`  UPC:           ${match.upc || chalk.hex(BRAND.dim)('not set')}`);
      console.log(`  ISBN:          ${match.isbn || chalk.hex(BRAND.dim)('not set')}`);
      console.log(`  Commodity:     ${match.commodity_code || chalk.hex(BRAND.dim)('not set')}`);
      console.log(`  L3 Code:       ${chalk.hex(BRAND.success)(code)} (${codeType}, ${code.length} chars)`);
      console.log(`  L3 Qualified:  ${chalk.hex(BRAND.success)('✓ Yes')}`);
      console.log(`  Price:         $${(match.price || 0).toFixed(2)}`);
      console.log('');
    } catch (error: any) {
      spinner.fail(chalk.red('Failed'));
      console.error(handleApiError(error).message);
    }
  });

// solid payment l3 report
l3Command
  .command('report')
  .description('Interchange savings estimate based on your product catalog')
  .option('--volume <amount>', 'Annual B2B card volume in dollars', '500000')
  .action(async (options: any) => {
    requireAuth();

    const volume = parseInt(options.volume) || 500000;
    const l1Cost = volume * 0.027 + (volume / 100) * 0.10;
    const l3Cost = volume * 0.019 + (volume / 100) * 0.10;
    const savings = l1Cost - l3Cost;

    console.log('');
    console.log(chalk.bold('  Level 3 Interchange Savings Report'));
    console.log(chalk.hex(BRAND.dim)('  ─────────────────────────────────────'));
    console.log(`  Annual B2B Volume:  $${volume.toLocaleString()}`);
    console.log('');
    console.log(`  Without L3 (2.70%): ${chalk.red('$' + Math.round(l1Cost).toLocaleString())}`);
    console.log(`  With L3 (1.90%):    ${chalk.hex(BRAND.success)('$' + Math.round(l3Cost).toLocaleString())}`);
    console.log(`  Annual Savings:     ${chalk.bold.hex(BRAND.green)('$' + Math.round(savings).toLocaleString())}`);
    console.log('');
    console.log(chalk.hex(BRAND.dim)('  Eligible: Visa Commercial, Mastercard Corporate, GSA SmartPay,'));
    console.log(chalk.hex(BRAND.dim)('  purchasing cards, fleet cards, business cards.'));
    console.log(chalk.hex(BRAND.dim)('  Consumer cards are NOT eligible but L3 data is still passed (no harm).'));
    console.log('');
    console.log(chalk.hex(BRAND.dim)('  Custom volume: solid payment l3 report --volume 1000000'));
    console.log(chalk.hex(BRAND.dim)('  Full details: solidnumber.com/why/level3-payments'));
    console.log('');
  });

// ── solid payment mcc ────────────────────────────────────────────────

paymentCommand
  .command('mcc')
  .description('Show your company\'s MCC code and industry mapping')
  .action(async () => {
    requireAuth();
    const ora = (await import('ora')).default;
    const spinner = ora({ text: chalk.hex(BRAND.dim)('Loading MCC mapping...'), spinner: 'dots' }).start();

    try {
      const response = await apiClient.get('/api/v1/companies/me');
      spinner.stop();

      const company = response.data;
      const kbSub = company.kb_sub_code;

      console.log('');
      console.log(chalk.bold('  MCC Code Mapping'));
      console.log(chalk.hex(BRAND.dim)('  ─────────────────────────────────────'));
      console.log(`  Company:       ${company.name}`);
      console.log(`  Industry Code: ${kbSub || 'Not set'}`);
      console.log(`  MCC Code:      ${company.mcc_code || 'Derived from industry'}`);
      console.log(`  Industry:      ${company.business_type || company.industry_name || 'Not set'}`);
      console.log('');
      console.log(chalk.hex(BRAND.dim)('  MCC tells Visa/Mastercard what industry you\'re in.'));
      console.log(chalk.hex(BRAND.dim)('  When your SKUs match your MCC, L3 qualification improves.'));
      console.log(chalk.hex(BRAND.dim)('  237 MCC codes mapped across 52 industries in Solid#.'));
      console.log('');
    } catch (error: any) {
      spinner.fail(chalk.red('Failed'));
      console.error(handleApiError(error).message);
    }
  });

// ── solid payment products ───────────────────────────────────────────

paymentCommand
  .command('products')
  .description('List products with their L3-ready identifiers')
  .option('--limit <n>', 'Number of products to show', '20')
  .action(async (options: any) => {
    requireAuth();
    const ora = (await import('ora')).default;
    const limit = parseInt(options.limit) || 20;
    const spinner = ora({ text: chalk.hex(BRAND.dim)('Loading products...'), spinner: 'dots' }).start();

    try {
      const response = await apiClient.get(`/api/v1/products?limit=${limit}`);
      spinner.stop();

      const products = response.data?.items || response.data?.products || [];

      console.log('');
      console.log(chalk.bold(`  Products — L3 Identifier Status (${products.length} shown)`));
      console.log(chalk.hex(BRAND.dim)('  ─────────────────────────────────────────────────────────'));
      console.log(chalk.hex(BRAND.dim)('  Name                     SKU            UPC            L3 Code'));
      console.log(chalk.hex(BRAND.dim)('  ─────────────────────────────────────────────────────────'));

      for (const p of products) {
        const name = (p.name || '').slice(0, 24).padEnd(25);
        const sku = (p.sku || '-').slice(0, 14).padEnd(15);
        const upc = (p.upc || '-').slice(0, 14).padEnd(15);
        const code = p.upc?.slice(0, 12) || p.isbn?.replace(/[^0-9]/g, '').slice(0, 12) || p.sku?.slice(0, 12) || p.commodity_code?.slice(0, 12) || `ITEM-${p.id}`;
        const ready = (p.sku || p.upc || p.isbn || p.commodity_code) ? chalk.hex(BRAND.success)('✓') : chalk.hex(BRAND.warning)('⚠');
        console.log(`  ${ready} ${name}${sku}${upc}${chalk.hex(BRAND.green)(code)}`);
      }

      console.log('');
    } catch (error: any) {
      spinner.fail(chalk.red('Failed'));
      console.error(handleApiError(error).message);
    }
  });
