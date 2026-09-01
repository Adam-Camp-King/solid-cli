import { offerCommand } from '../../commands/offer';
import { ordersCommand } from '../../commands/orders';
import { paymentLinksCommand } from '../../commands/payment_links';
import { verbsCommand } from '../../commands/verbs';

/**
 * The deal and the progress on it have to be REACHABLE FROM `--help`.
 *
 * All four backend verbs were already invokable as
 * `solid verbs invoke offer.get -p '{"cart_id":12}'` — the registry-driven
 * catch-all route makes any registered verb reachable the moment it exists.
 * But reachable is not discoverable. This CLI is written to be driven by an
 * AI, and an AI reading `solid --help` has no way to learn an incantation
 * that appears nowhere in the command tree.
 */

const subs = (cmd: { commands: readonly { name(): string }[] }) =>
  cmd.commands.map((c) => c.name());

describe('reading a deal', () => {
  it('offer get exists', () => {
    expect(subs(offerCommand)).toContain('get');
  });

  it('accepts a cart, an order or a link — the three things that are one offer', () => {
    const get = offerCommand.commands.find((c) => c.name() === 'get')!;
    const flags = get.options.map((o) => o.long);
    expect(flags).toEqual(expect.arrayContaining(['--cart', '--order', '--link']));
  });

  it('lets the caller state the channel, because the channel changes the total', () => {
    // A surcharge program is legal on some channels and not others. A quote
    // priced for the wrong channel is a number the customer will not be charged.
    const get = offerCommand.commands.find((c) => c.name() === 'get')!;
    expect(get.options.map((o) => o.long)).toContain('--channel');
  });
});

describe('order progress', () => {
  it('exposes progress, milestone and milestones', () => {
    expect(subs(ordersCommand)).toEqual(
      expect.arrayContaining(['progress', 'milestone', 'milestones']),
    );
  });

  it('keeps fulfill — the new commands add detail, they do not replace the lifecycle', () => {
    expect(subs(ordersCommand)).toContain('fulfill');
  });

  it('milestone takes a --detail payload for the facts that belong to the event', () => {
    // Tracking number, carrier, ticket id, bin locations, weight.
    const m = ordersCommand.commands.find((c) => c.name() === 'milestone')!;
    expect(m.options.map((o) => o.long)).toContain('--detail');
  });
});

describe('capture methods', () => {
  it('is asked, not assumed', () => {
    // Offering tap-to-pay to a merchant with no reader wastes the customer's
    // time at the worst possible moment.
    expect(subs(paymentLinksCommand)).toContain('capture-methods');
  });
});

describe('help text carries no frozen counts', () => {
  it('the verbs command does not hardcode a verb count', () => {
    // It said "169 agent-attraction verbs" against a real 545, and
    // src/commands/verbs.ts is not in scripts/sync-counts.ts's SURFACES list,
    // so nothing caught the drift. `solid verbs list` prints the live total.
    expect(verbsCommand.description()).not.toMatch(/\d{2,4}\s+(agent-attraction\s+)?verbs/);
  });
});
