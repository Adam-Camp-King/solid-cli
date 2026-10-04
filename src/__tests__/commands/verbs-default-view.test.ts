/**
 * What `solid verbs list` shows by default: one name per operation, working verbs only,
 * and a page rather than the whole catalog.
 */
import { DEFAULT_PAGE, defaultView } from '../../commands/verbs';

const verbs = [
  { name: 'deal.update' },
  { name: 'deals_update', same_as: 'deal.update' },
  { name: 'billing.checkout_link', status: 'stub' },
  { name: 'gdpr.delete_data', status: 'disabled' },
  { name: 'voice.thing', status: 'degraded' },
];

describe('defaultView', () => {
  it('hides aliases and verbs that cannot work, and says how many', () => {
    const v = defaultView(verbs);
    expect(v.verbs.map((x) => x.name)).toEqual(['deal.update', 'voice.thing']);
    expect(v.hidden).toEqual({ aliases: 1, inactive: 2 });
  });

  it('a degraded verb still works and is shown', () => {
    expect(defaultView(verbs).verbs.some((x) => x.name === 'voice.thing')).toBe(true);
  });

  it('each flag brings its own back', () => {
    expect(defaultView(verbs, { aliases: true }).verbs).toHaveLength(3);
    expect(defaultView(verbs, { includeInactive: true }).verbs).toHaveLength(4);
    expect(defaultView(verbs, { aliases: true, includeInactive: true }).verbs).toHaveLength(5);
  });

  it('the first page is a page', () => {
    expect(DEFAULT_PAGE).toBe(100);
  });
});
