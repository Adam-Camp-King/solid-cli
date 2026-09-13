/**
 * `solid map` is L0 — the question an agent opens with.
 *
 * Sprint VNP 3.2. "What can I do here?" used to cost 486,986 tokens because
 * `verbs list` was the only thing that answered it. This folds the manifest
 * into one row per noun, with the Atlas address on every row so the follow-up
 * ("show me those") is arithmetic the agent does locally rather than another
 * lookup.
 */
import { buildMap } from '../../commands/map';

const VERBS = [
  { name: 'payment.refund', side_effects: 'write', coordinate: '52', noun: 'payment' },
  { name: 'payment.charge', side_effects: 'write', coordinate: '52', noun: 'payment' },
  { name: 'payment.full_history', side_effects: 'read', coordinate: '52', noun: 'payment' },
  { name: 'invoice.get', side_effects: 'read', coordinate: '53', noun: 'invoice' },
  { name: 'contact.create', side_effects: 'write', coordinate: '35', noun: 'contact' },
];

describe('buildMap', () => {
  it('gives one row per noun with verb and write counts', () => {
    const rows = buildMap(VERBS);
    const payment = rows.find((r) => r.noun === 'payment');
    expect(payment).toEqual({ coordinate: '52', noun: 'payment', verbs: 3, writes: 2 });
  });

  it('counts a read as not-a-write', () => {
    expect(buildMap(VERBS).find((r) => r.noun === 'invoice')).toEqual({
      coordinate: '53', noun: 'invoice', verbs: 1, writes: 0,
    });
  });

  it('treats mixed as a write, because it can mutate', () => {
    const rows = buildMap([{ name: 'x.y', side_effects: 'mixed', coordinate: '00', noun: 'x' }]);
    expect(rows[0].writes).toBe(1);
  });

  it('orders by coordinate so classes group together', () => {
    expect(buildMap(VERBS).map((r) => r.coordinate)).toEqual(['35', '52', '53']);
  });

  it('keeps an unplaced noun visible instead of merging it away', () => {
    // An unplaced verb is a countable defect. Folding it into a placed noun
    // would hide the one thing the map should surface.
    const rows = buildMap([
      ...VERBS,
      { name: 'zzz.qqq', side_effects: 'read', coordinate: null, noun: null },
    ]);
    const orphan = rows.find((r) => !r.coordinate);
    expect(orphan).toBeDefined();
    expect(orphan!.noun).toBe('(unplaced)');
  });

  it('does not merge two nouns that share a coordinate', () => {
    // Division digits can collide on overflow (the eleventh noun onward shares
    // digit 9), so the key has to be coordinate AND noun.
    const rows = buildMap([
      { name: 'a.one', side_effects: 'read', coordinate: '59', noun: 'a' },
      { name: 'b.one', side_effects: 'read', coordinate: '59', noun: 'b' },
    ]);
    expect(rows).toHaveLength(2);
  });

  it('is empty for an empty manifest rather than throwing', () => {
    expect(buildMap([])).toEqual([]);
  });
});
