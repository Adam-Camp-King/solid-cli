/**
 * What a verb hands back — lib/output-contract.ts. Pure.
 */
import { frontPageOrder, receiptRefOf, returnsOf, revealHiddenKeys } from '../../lib/output-contract';
import { applyListEnvelope } from '../../lib/list-envelope';

const proven = {
  type: 'object',
  properties: { success: { type: 'boolean' }, page: {}, published_url: {}, error: {}, win: {} },
  required: ['success'],
  anyOf: [
    { title: 'worked', required: ['page', 'published_url', 'success'] },
    { title: 'did not', required: ['error', 'success'] },
  ],
  'x-solid-derivation': 'proven-from-return-paths',
};

describe('returnsOf', () => {
  it('a proven schema names what a result that worked carries', () => {
    expect(returnsOf(proven)).toEqual({
      basis: 'proven',
      always: ['success'],
      when_it_worked: ['page', 'published_url', 'success'],
      when_it_did_not: ['error', 'success'],
      may_include: ['win'],
      types: { success: 'boolean' },
    });
  });

  it('with no failure return, what worked is what is always there', () => {
    const r = returnsOf({ properties: { ok: {}, count: { type: 'integer' } }, required: ['count', 'ok'],
      'x-solid-derivation': 'proven-from-return-paths' });
    expect(r?.when_it_worked).toEqual(['count', 'ok']);
    expect(r?.when_it_did_not).toBeUndefined();
  });

  it('an inferred schema promises nothing', () => {
    const r = returnsOf({ properties: { deal_id: {}, stage: {} }, 'x-solid-derivation': 'inferred-from-return-literals' });
    expect(r).toMatchObject({ basis: 'hint', always: [], when_it_worked: [], may_include: ['deal_id', 'stage'] });
  });

  it('an observed schema says what real results carried and promises nothing', () => {
    const r = returnsOf({ properties: { id: { type: 'integer', 'x-solid-observed': 4 }, note: {} },
      'x-solid-derivation': 'observed-in-receipts' });
    expect(r).toMatchObject({ basis: 'observed', always: [], when_it_worked: [], may_include: ['id', 'note'],
      types: { id: 'integer' } });
  });

  it('a schema with no marker was declared by its author', () => {
    expect(returnsOf({ properties: { id: { type: 'integer' } }, required: ['id'] })?.basis).toBe('declared');
  });

  it('nothing published is null, never an empty promise', () => {
    expect(returnsOf(undefined)).toBeNull();
    expect(returnsOf({ type: 'object' })).toBeNull();
  });
});

describe('revealHiddenKeys', () => {
  it("prints the server's own list key beside items, which is the key the schema names", () => {
    const body = { journeys: [{ name: 'a' }], count: 1 };
    applyListEnvelope(body, {}, { hideSourceKey: true });
    expect(Object.keys(JSON.parse(JSON.stringify(body)))).not.toContain('journeys');
    const shown = JSON.parse(JSON.stringify(revealHiddenKeys(body)));
    expect(shown.journeys).toEqual([{ name: 'a' }]);
    expect(shown.items).toEqual([{ name: 'a' }]);
  });

  it('leaves anything that is not a plain object alone', () => {
    expect(revealHiddenKeys(null)).toBeNull();
    expect(revealHiddenKeys([1, 2])).toEqual([1, 2]);
    expect(revealHiddenKeys('x')).toBe('x');
  });
});

describe('receiptRefOf', () => {
  it('reads the handle from plain headers and from an axios header object', () => {
    expect(receiptRefOf({ 'x-solid-receipt': 'rcp_0123456789abcdef01234567' })).toBe('rcp_0123456789abcdef01234567');
    expect(receiptRefOf({ get: (k: string) => (k === 'x-solid-receipt' ? 'rcp_0123456789abcdef01234567' : undefined) }))
      .toBe('rcp_0123456789abcdef01234567');
  });

  it('ignores anything that is not a well-formed handle', () => {
    expect(receiptRefOf({ 'x-solid-receipt': 'rcp_<script>' })).toBeNull();
    expect(receiptRefOf({ 'x-solid-receipt': '42' })).toBeNull();
    expect(receiptRefOf({})).toBeNull();
    expect(receiptRefOf(undefined)).toBeNull();
  });
});

describe('frontPageOrder', () => {
  const verbs = [
    { name: 'accounting.x' }, { name: 'contact.update', first_page: 'core' },
    { name: 'deal.create', first_page: 'curated' }, { name: 'page.create', first_page: 'core' },
    { name: 'zeta.y' },
  ];

  it('leads with core, then curated, and keeps name order inside each group', () => {
    expect(frontPageOrder(verbs).map((v) => v.name))
      .toEqual(['contact.update', 'page.create', 'deal.create', 'accounting.x', 'zeta.y']);
  });

  it('changes nothing when the backend publishes no marker', () => {
    const plain = [{ name: 'b' }, { name: 'a' }, { name: 'c' }];
    expect(frontPageOrder(plain).map((v) => v.name)).toEqual(['b', 'a', 'c']);
  });
});
