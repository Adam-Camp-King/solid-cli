/**
 * Offer — read the deal before agreeing to pay it.
 *
 * Wraps the `offer.get` verb through the registry-driven verb route at
 * /api/v1/agent/offer/get.
 *
 * ⛔ WHY A FIRST-CLASS COMMAND. The verb was reachable via
 * `solid verbs invoke offer.get -p '{"cart_id":12}'` — reachable is not the
 * same as discoverable. This CLI is written to be driven by an AI, and an AI
 * reading `solid --help` has no way to learn that the incantation exists. A
 * buyer agent needs to READ a deal; that deserves a name.
 *
 * ⛔ Universal. No processor is named here. The offer describes the deal;
 * whichever adapter the merchant connected does the charging.
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

function fail(s: ReturnType<typeof ora>, m: string, e: unknown) {
  s.fail(chalk.red(m));
  console.error(chalk.red(`  ${handleApiError(e).message}`));
}

const money = (cents: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format((cents || 0) / 100);

export const offerCommand = new Command('offer')
  .description('Read a deal — line items, tax, fees, disclosure, total (cart, order or link)');

offerCommand
  .command('get')
  .description('The full offer: what is in the deal and what it will actually cost')
  .option('--cart <id>', 'Read a cart')
  .option('--order <id>', 'Read an order')
  .option('--link <linkId>', 'Read a payment link')
  .option('--channel <name>', 'Price for this channel (online|in_person|phone|invoice)', 'online')
  .option('--tender <name>', 'Price for this tender (card|cash|...)', 'card')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();

    const given = [opts.cart, opts.order, opts.link].filter(Boolean);
    if (given.length !== 1) {
      console.error(chalk.red('Pass exactly one of --cart, --order or --link.'));
      process.exit(1);
    }

    const body: Record<string, unknown> = { channel: opts.channel, tender: opts.tender };
    if (opts.cart) body.cart_id = parseInt(opts.cart, 10);
    if (opts.order) body.order_id = parseInt(opts.order, 10);
    if (opts.link) body.link_id = opts.link;

    const wantsJson = isJsonOutput(opts);
    const s = ora('Reading the offer...').start();
    try {
      const res = await apiClient.post('/api/v1/agent/offer/get', body);
      const data = res.data as Record<string, any>;
      const offer = data.offer ?? data.result?.offer ?? data.result ?? data;

      if (wantsJson) { s.stop(); console.log(JSON.stringify(data, null, 2)); return; }

      if (!offer || offer.found === false || !offer.line_items) {
        s.fail(chalk.red('Not found.'));
        return;
      }
      s.stop();

      const cur = offer.currency || 'USD';
      console.log(chalk.cyan(`${offer.merchant?.name ?? 'Merchant'}  ${chalk.dim(offer.source?.reference ?? '')}`));
      console.log('');
      for (const li of offer.line_items) {
        const sku = li.sku ? chalk.dim(` ${li.sku}`) : '';
        console.log(`  ${String(li.quantity).padStart(3)} × ${li.name}${sku}`);
        console.log(chalk.dim(`      ${money(li.unit_price_cents, cur)} each → ${money(li.line_total_cents, cur)}`));
      }
      console.log('');
      const t = offer.totals ?? {};
      const row = (label: string, cents: number) =>
        cents ? console.log(`  ${label.padEnd(18)}${money(cents, cur).padStart(12)}`) : undefined;
      row('Subtotal', t.subtotal_cents);
      row('Service charge', t.service_charge_cents);
      row('Tax', t.tax_cents);
      row('Fee', t.fee_cents);
      row('Tip', t.tip_cents);
      console.log(chalk.bold(`  ${'Total'.padEnd(18)}${money(t.total_cents, cur).padStart(12)}`));

      // ⛔ The disclosure is what the merchant is legally required to show
      // before payment. It prints here for the same reason it travels in the
      // manifest: whoever is paying has to see it, agent or person.
      if (offer.disclosure) {
        console.log('');
        console.log(chalk.yellow(`  ${offer.disclosure}`));
      }
      console.log('');
      // The quote's assumptions. Change the channel and the total can change,
      // so a quote printed without its basis is not a quote.
      const p = offer.priced_for ?? {};
      console.log(chalk.dim(`  priced for ${p.channel}/${p.tender} · fee program ${p.fee_program ?? 'none'}`));
      console.log(chalk.dim(`  quote expires ${offer.expires_at}`));
      if (offer.payment?.url) console.log(chalk.cyan(`  ${offer.payment.url}`));
    } catch (e) { fail(s, 'Failed to read the offer', e); }
  });
