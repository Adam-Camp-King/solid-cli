/**
 * Rewards a customer earns, redeemed once (Adam, 2026-11-11: "leave me a review and get $50 ...
 * BUT gate this too. like an admin can control these things").
 *
 *   solid promotions rewards list [--status pending|issued|used|declined]   promotion.reward_list
 *   solid promotions rewards offer --name … --trigger referral --value 50 --confirm
 *                                                                          promotion.reward_offer_create
 *   solid promotions rewards offer-update <offer_id> [--active no] … --confirm
 *                                                                          promotion.reward_offer_update
 *   solid promotions rewards issue <offer_id> <contact_id> --proof "…" --confirm
 *                                                                          promotion.reward_issue
 *   solid promotions rewards decide <grant_id> approve|decline|restore --confirm
 *                                                                          promotion.reward_decide
 *
 * ⛔ A reward is money: every change runs only with --confirm. The server holds the gates
 * (offers and decisions are owner/admin only; a teammate's reward waits for approval; never for a
 * review on Google, Yelp or another review site). Nothing here decides any of that.
 */
import { Command } from 'commander';
import chalk from 'chalk';

import { run } from './promotions';

export const TRIGGERS = ['referral', 'own_site_review', 'photo_post', 'social_follow', 'repeat_visit', 'other'];
export const DECISIONS = ['approve', 'decline', 'restore'];

const yes = (v: unknown) => !['false', 'off', 'no', '0'].includes(String(v).toLowerCase());

/** The flags that are set, as the offer verbs' own argument names. */
export function offerFields(o: Record<string, any>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (o.name !== undefined) out.name = o.name;
  if (o.trigger !== undefined) out.trigger = o.trigger;
  if (o.kind !== undefined) out.kind = o.kind;
  if (o.value !== undefined) out.value = Number(o.value);
  if (o.days !== undefined) out.valid_days = Number(o.days);
  if (o.approval !== undefined) out.needs_approval = yes(o.approval);
  if (o.active !== undefined) out.active = yes(o.active);
  return out;
}

const needConfirm = (what: string) => {
  console.error(chalk.yellow(`${what} is worth money. Nothing was changed.`));
  console.error(chalk.yellow('Read it back, then run the same command with --confirm.'));
  process.exit(2);
};

const done = (r: any) => {
  if (!r) return;
  if (r.status && !['ok', 'created', 'updated'].includes(r.status)) {
    console.error(chalk.red(r.summary || r.message || r.status)); process.exit(1);
  }
  console.log(chalk.green(r.summary || `${r.name || 'Done'}${r.worth ? `: ${r.worth}` : ''}.`));
};

export const rewardsCommand = new Command('rewards')
  .description('Rewards a customer earns (referral, own-site review, photo, follow, repeat visit): a one-time code, owner/admin gated');

rewardsCommand
  .command('list')
  .description('The reward offers, and rewards waiting, issued, used or declined')
  .option('--status <status>', 'Only pending, issued, used or declined')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const r = await run('promotion.reward_list', opts.status ? { status: opts.status } : {}, opts, 'Reading rewards...');
    if (!r) return;
    for (const o of r.offers || []) {
      console.log(`${(o.state === 'on' ? chalk.green : chalk.yellow)(o.state.padEnd(4))} offer #${String(o.offer_id).padEnd(5)} ${chalk.bold(o.name)}  ${chalk.dim(`${o.worth}, ${o.earned_by}, ${o.valid_days} days${o.needs_approval ? ', needs approval' : ''}`)}`);
    }
    for (const g of r.rewards || []) {
      const tag = { pending: chalk.cyan, issued: chalk.green, used: chalk.dim, declined: chalk.yellow }[g.status as string] || chalk.white;
      console.log(`${tag(g.status.padEnd(9))} #${String(g.grant_id).padEnd(5)} ${g.customer || `contact ${g.contact_id}`}  ${chalk.dim(`${g.offer || ''}${g.code ? `  ${g.code}` : ''}`)}`);
    }
    console.log(chalk.dim(`\n${r.summary}`));
  });

rewardsCommand
  .command('offer')
  .description('Set up a reward offer (owner/admin; runs only with --confirm)')
  .requiredOption('--name <name>', "What the business calls it, e.g. 'Refer a friend: $50 off'")
  .requiredOption('--trigger <trigger>', `What earns it: ${TRIGGERS.join(', ')}`)
  .option('--kind <kind>', 'fixed ($ off) or percent', 'fixed')
  .requiredOption('--value <n>', 'Amount or percent off')
  .option('--days <n>', 'How many days the code lasts', '60')
  .option('--approval <yes|no>', 'Each reward waits for an owner or admin', 'yes')
  .option('--confirm', 'Make it (without this nothing changes)')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    if (!TRIGGERS.includes(opts.trigger)) { console.error(chalk.red(`--trigger is one of ${TRIGGERS.join(', ')}`)); process.exit(2); }
    if (!opts.confirm) needConfirm('A reward offer');
    done(await run('promotion.reward_offer_create', offerFields(opts), opts, 'Setting up the reward...'));
  });

rewardsCommand
  .command('offer-update <offer_id>')
  .description('Change a reward offer or switch it off (owner/admin; runs only with --confirm)')
  .option('--name <name>')
  .option('--value <n>')
  .option('--days <n>')
  .option('--approval <yes|no>')
  .option('--active <yes|no>', 'Switch it on (yes) or off (no)')
  .option('--confirm', 'Change it (without this nothing changes)')
  .option('--json', 'Output as JSON')
  .action(async (id: string, opts) => {
    if (!opts.confirm) needConfirm('Changing a reward offer');
    done(await run('promotion.reward_offer_update', { offer_id: Number(id), ...offerFields(opts) }, opts, 'Changing the reward...'));
  });

rewardsCommand
  .command('issue <offer_id> <contact_id>')
  .description("Give one customer their reward, with what was seen (a teammate's waits for approval; runs only with --confirm)")
  .requiredOption('--proof <words>', "What was seen: who, what, when, e.g. 'Ana Ruiz booked 11/9 and named Maria'")
  .option('--where <where>', "Where it was seen, e.g. 'in person' or 'text screenshot'")
  .option('--file <file_id>', 'A photo or screenshot already uploaded')
  .option('--confirm', 'Issue it (without this nothing changes)')
  .option('--json', 'Output as JSON')
  .action(async (offer: string, contact: string, opts) => {
    if (!opts.confirm) needConfirm('A reward');
    const args: Record<string, unknown> = { offer_id: Number(offer), contact_id: Number(contact), proof: opts.proof };
    if (opts.where) args.where = opts.where;
    if (opts.file) args.file_id = Number(opts.file);
    done(await run('promotion.reward_issue', args, opts, 'Issuing the reward...'));
  });

rewardsCommand
  .command('decide <grant_id> <decision>')
  .description('Approve or decline a waiting reward, or restore a used code whose sale failed (owner/admin; --confirm)')
  .option('--confirm', 'Decide (without this nothing changes)')
  .option('--json', 'Output as JSON')
  .action(async (grant: string, decision: string, opts) => {
    if (!DECISIONS.includes(decision)) { console.error(chalk.red(`decision is one of ${DECISIONS.join(', ')}`)); process.exit(2); }
    if (!opts.confirm) needConfirm('A reward decision');
    done(await run('promotion.reward_decide', { grant_id: Number(grant), decision }, opts, 'Deciding...'));
  });
