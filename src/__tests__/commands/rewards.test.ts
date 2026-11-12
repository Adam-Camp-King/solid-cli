import { DECISIONS, offerFields, rewardsCommand, TRIGGERS } from '../../commands/rewards';

/** `solid promotions rewards` (Adam, 2026-11-11): every change carries --confirm; the verbs' own names. */
const flags = (name: string) => rewardsCommand.commands.find((c) => c.name() === name)!.options.map((o) => o.long);

describe('solid promotions rewards', () => {
  it('has list, offer, offer-update, issue and decide', () => {
    expect(rewardsCommand.commands.map((c) => c.name())).toEqual(['list', 'offer', 'offer-update', 'issue', 'decide']);
  });

  it('every change carries --confirm, because a reward is money', () => {
    for (const c of ['offer', 'offer-update', 'issue', 'decide']) expect(flags(c)).toContain('--confirm');
    expect(flags('list')).not.toContain('--confirm');
  });

  it('no trigger is a review on another site', () => {
    expect(TRIGGERS.join(' ')).not.toMatch(/google|yelp|facebook/i);
    expect(DECISIONS).toEqual(['approve', 'decline', 'restore']);
  });

  it('sends the verb its own argument names, only the ones set', () => {
    expect(offerFields({ name: 'Refer a friend', trigger: 'referral', kind: 'fixed', value: '50', days: '30', approval: 'no' }))
      .toEqual({ name: 'Refer a friend', trigger: 'referral', kind: 'fixed', value: 50, valid_days: 30, needs_approval: false });
    expect(offerFields({ active: 'off' })).toEqual({ active: false });
    expect(offerFields({})).toEqual({});
  });
});
