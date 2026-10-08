/**
 * `solid map` is L0 — the question an agent opens with.
 *
 * Sprint VNP 3.2. "What can I do here?" used to cost 486,986 tokens because
 * `verbs list` was the only thing that answered it. This folds the manifest
 * into one row per noun, with the Atlas address on every row so the follow-up
 * ("show me those") is arithmetic the agent does locally rather than another
 * lookup.
 */
import { buildMap, rowsFromLibraryMap } from '../../commands/map';

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

describe('buildMap counts one name per operation', () => {
  const verbs = [
    { name: 'deal.update', side_effects: 'write', coordinate: '31', noun: 'deal' },
    { name: 'deals_update', side_effects: 'write', coordinate: '31', noun: 'deal', same_as: 'deal.update' },
    { name: 'deal.get', side_effects: 'read', coordinate: '31', noun: 'deal' },
  ];

  it('an alias is not counted, so a noun is its real size', () => {
    expect(buildMap(verbs)).toEqual([{ coordinate: '31', noun: 'deal', verbs: 2, writes: 1 }]);
  });

  it('--aliases counts them', () => {
    expect(buildMap(verbs, { aliases: true })[0].verbs).toBe(3);
  });
});

describe('rowsFromLibraryMap', () => {
  // GET /api/v1/agent/verbs/map — the fold done once, on the server.
  const BODY = {
    schema: 'solid:verb-library-map/v1',
    total: 6,
    classes: [
      { class: 5, title: 'Money & books', actions: 4,
        domains: [{ address: '51', title: 'Receivables',
                    nouns: [['510', 'invoice', 3, 1], ['511', 'invoice_payment', 1, 1]] }] },
      { class: 1, title: 'Agents & AI', actions: 2, nouns: [['10', 'agent', 2, 0]] },
    ],
  };

  it('reads the same four fields the fold produced, in coordinate order', () => {
    expect(rowsFromLibraryMap(BODY as never)).toEqual([
      { coordinate: '10', noun: 'agent', verbs: 2, writes: 0 },
      { coordinate: '510', noun: 'invoice', verbs: 3, writes: 1 },
      { coordinate: '511', noun: 'invoice_payment', verbs: 1, writes: 1 },
    ]);
  });

  it('counts every action the server counted', () => {
    const rows = rowsFromLibraryMap(BODY as never)!;
    expect(rows.reduce((n, r) => n + r.verbs, 0)).toBe(BODY.total);
  });

  it('is null for anything that is not a library map, so the caller falls back', () => {
    // An older backend answers /map with a verb record or a 404 body.
    expect(rowsFromLibraryMap({ name: 'map' } as never)).toBeNull();
    expect(rowsFromLibraryMap({ schema: 'solid:agent-verb-manifest/v1' } as never)).toBeNull();
    expect(rowsFromLibraryMap(null)).toBeNull();
    expect(rowsFromLibraryMap({ schema: 'solid:verb-library-map/v1' } as never)).toBeNull();
  });

  it('keeps a noun with no address visible', () => {
    const rows = rowsFromLibraryMap({
      schema: 'solid:verb-library-map/v1', classes: [{ nouns: [[null, 'zzz', 1, 0]] }],
    } as never)!;
    expect(rows).toEqual([{ coordinate: '', noun: 'zzz', verbs: 1, writes: 0 }]);
  });
});
