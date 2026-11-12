/**
 * Promotions — the business's own discounts and codes (Adam, 2026-11-10: "is the a promo page
 * they can build thier promos and verbs for cli"; "if I am on mobile I could tell ada to build a
 * design for my promo").
 *
 *   solid promotions list [--state live|scheduled|ended|off]   promotion.list
 *   solid promotions create --name … --value … [--code …] --confirm   promotion.create
 *   solid promotions update <id> [--active false] … --confirm         promotion.update
 *   solid promotions check <code> [--amount 50 | --item 12:2 …]       promotion.check_code
 *   solid promotions design <id|code> [--shape flyer] [--style …]     promotion.design_brief
 *
 * ⛔ A promotion is a PRICE. create and update change what customers pay, so they run only
 * with --confirm (the same as `solid agent dispatch … --confirm`); without it nothing changes.
 * The server checks every code again at the sale; nothing here works a price out.
 *
 * Every subcommand posts to /api/v1/ada/cli-dispatch: the same role gates and audit as the
 * dashboard and ADA.
 */
import { Command } from 'commander';
import chalk from 'chalk';
import ora from '../lib/spinner';

import { apiClient, failApi } from '../lib/api-client';
import { isJsonOutput } from '../lib/json-output';
import { requireAuth } from '../lib/command-kit';

type Opts = { json?: boolean; confirm?: boolean };

export async function run(verb: string, args: Record<string, unknown>, opts: Opts, label: string): Promise<any> {
  requireAuth();
  const spinner = ora(label).start();
  try {
    const res = await apiClient.post('/api/v1/ada/cli-dispatch', { verb, args, confirm: Boolean(opts.confirm) });
    const data = (res.data as any) || {};
    if (isJsonOutput(opts)) {
      spinner.stop();
      console.log(JSON.stringify(data, null, 2));
      return null;
    }
    if (data.ok === false || data.error) {
      spinner.fail(chalk.red(`${verb}: ${data?.error?.reason || 'refused'}`));
      console.error(chalk.red(`  ${data?.error?.message || 'Denied or failed.'}`));
      process.exit(1);
    }
    spinner.stop();
    return data.result ?? data;
  } catch (error) {
    spinner.stop();
    failApi(error);
  }
}

/** "12:2" -> {product_id: 12, quantity: 2}; "12" -> quantity 1. */
export function parseItem(text: string): { product_id: number; quantity: number } {
  const [id, qty] = text.split(':');
  const product_id = Number(id);
  const quantity = qty === undefined ? 1 : Number(qty);
  if (!Number.isInteger(product_id) || product_id <= 0 || !Number.isInteger(quantity) || quantity <= 0) {
    throw new Error(`--item takes product_id or product_id:quantity, not "${text}"`);
  }
  return { product_id, quantity };
}

/** The flags that are set, as the verb's own argument names. */
export function promotionFields(o: Record<string, any>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const num = (v: unknown) => (v === undefined ? undefined : Number(v));
  const pairs: [string, unknown][] = [
    ['name', o.name], ['kind', o.kind], ['value', num(o.value)], ['code', o.code],
    ['min_subtotal', num(o.min)], ['max_discount', num(o.maxOff)], ['starts_at', o.starts],
    ['ends_at', o.ends], ['scope', o.scope],
    ['active', o.active === undefined ? undefined : !['false', 'off', 'no', '0'].includes(String(o.active).toLowerCase())],
  ];
  for (const [k, v] of pairs) if (v !== undefined) out[k] = v;
  return out;
}

const needConfirm = (what: string) => {
  console.error(chalk.yellow(`${what} changes what customers pay. Nothing was changed.`));
  console.error(chalk.yellow('Read it back, then run the same command with --confirm.'));
  process.exit(2);
};

export const promotionsCommand = new Command('promotions')
  .alias('promos')
  .description("The business's own promotions and codes: list, create, update, check a code, design");

promotionsCommand
  .command('list')
  .description('Every promotion in words: live, scheduled, ended or off, the offer, the code and the dates')
  .option('--state <state>', 'Only live, scheduled, ended or off')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const r = await run('promotion.list', opts.state ? { state: opts.state } : {}, opts, 'Reading promotions...');
    if (!r) return;
    if (!r.promotions?.length) { console.log(r.summary || 'No promotions.'); return; }
    for (const p of r.promotions) {
      const tag = { live: chalk.green, scheduled: chalk.cyan, ended: chalk.dim, off: chalk.yellow }[p.state as string] || chalk.white;
      console.log(`${tag(p.state.padEnd(9))} #${String(p.promotion_id).padEnd(5)} ${chalk.bold(p.name)}  ${chalk.dim(p.summary)}`);
    }
    console.log(chalk.dim(`\n${r.summary}`));
  });

promotionsCommand
  .command('create')
  .description('Make a promotion (a price: runs only with --confirm)')
  .requiredOption('--name <name>', 'What the business calls it')
  .option('--kind <kind>', 'percent, fixed, bogo or threshold', 'percent')
  .option('--value <n>', 'Percent off, amount off, or (bogo) percent off the second')
  .option('--code <code>', 'The code customers type; leave out for an automatic promotion')
  .option('--min <amount>', 'Minimum order')
  .option('--max-off <amount>', 'The most it takes off')
  .option('--starts <iso>', 'Start date-time (ISO)')
  .option('--ends <iso>', 'End date-time (ISO)')
  .option('--scope <scope>', 'Which items: category:<name> or sku:<sku>, | for either; blank = everything')
  .option('--confirm', 'Make it (without this nothing changes)')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    if (!opts.confirm) needConfirm('A promotion');
    const r = await run('promotion.create', promotionFields(opts), opts, 'Making the promotion...');
    if (!r) return;
    if (r.status !== 'created') { console.error(chalk.red(r.summary || r.reason || 'Refused.')); process.exit(1); }
    console.log(chalk.green(`Made promotion #${r.promotion_id}${r.code ? ` (code ${r.code})` : ''}.`));
  });

promotionsCommand
  .command('update <promotion_id>')
  .description('Change a promotion: switch it on or off, its value, code, end date or items (runs only with --confirm)')
  .option('--name <name>')
  .option('--value <n>')
  .option('--code <code>')
  .option('--active <yes|no>', 'Switch it on (yes) or off (no)')
  .option('--max-off <amount>')
  .option('--ends <iso>')
  .option('--scope <scope>', 'Which items; "" = everything')
  .option('--confirm', 'Change it (without this nothing changes)')
  .option('--json', 'Output as JSON')
  .action(async (id: string, opts) => {
    if (!opts.confirm) needConfirm('Changing a promotion');
    const r = await run('promotion.update', { promotion_id: Number(id), ...promotionFields(opts) }, opts, 'Changing the promotion...');
    if (!r) return;
    if (r.status !== 'updated') { console.error(chalk.red(r.summary || r.status || 'Refused.')); process.exit(1); }
    console.log(chalk.green(`Promotion #${id} changed: ${(r.updated_fields || []).join(', ') || 'nothing'}.`));
  });

promotionsCommand
  .command('check <code>')
  .description('What a code takes off an amount or items, changing nothing')
  .option('--amount <amount>', 'The sale amount')
  .option('--item <product_id[:qty]>', 'An item from the catalogue (repeat for more)', (v: string, all: string[] = []) => [...all, v])
  .option('--json', 'Output as JSON')
  .action(async (code: string, opts) => {
    const args: Record<string, unknown> = { code };
    try {
      if (opts.item?.length) args.items = opts.item.map(parseItem);
    } catch (e) { console.error(chalk.red((e as Error).message)); process.exit(2); }
    if (opts.amount !== undefined) args.amount = Number(opts.amount);
    const r = await run('promotion.check_code', args, opts, 'Checking the code...');
    if (!r) return;
    console.log(r.status === 'applies' ? chalk.green(r.summary) : chalk.yellow(r.summary));
  });

promotionsCommand
  .command('design <promotion>')
  .description('The words, brand and image prompt for a design of one promotion (id or code); makes and spends nothing')
  .option('--shape <shape>', 'social, story, flyer or banner', 'social')
  .option('--style <words>', "The look, e.g. 'warm, hand-drawn'")
  .option('--json', 'Output as JSON')
  .action(async (which: string, opts) => {
    const args: Record<string, unknown> = /^\d+$/.test(which) ? { promotion_id: Number(which) } : { code: which };
    args.shape = opts.shape;
    if (opts.style) args.style = opts.style;
    const r = await run('promotion.design_brief', args, opts, 'Reading the promotion...');
    if (!r) return;
    if (r.status !== 'ok') { console.error(chalk.red(r.summary || r.reason)); process.exit(1); }
    if (r.warning) console.log(chalk.yellow(r.warning));
    console.log(chalk.bold(r.words.headline));
    for (const w of [r.words.code_line, r.words.terms_line, r.words.dates_line, r.words.business]) if (w) console.log(`  ${w}`);
    console.log(chalk.dim('\nImage prompt:'));
    console.log(`  ${r.image_prompt}`);
    const prompt = JSON.stringify({ prompt: r.image_prompt, kind: 'image' }).replace(/'/g, "'\\''");
    console.log(chalk.dim('\nThe image is paid. Price it first, then make it:'));
    console.log(`  solid agent dispatch asset.quote --args '${prompt}'`);
    console.log(`  solid agent dispatch asset.generate --args '${prompt}' --confirm`);
    console.log(chalk.dim('Image makers can misspell: check the code and dates on the image before sharing it.'));
  });

