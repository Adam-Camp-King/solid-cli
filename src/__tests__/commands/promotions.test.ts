import { parseItem, promotionFields, promotionsCommand } from '../../commands/promotions';

/**
 * `solid promotions` (Adam, 2026-11-10): the business's promotions reachable from --help, with the
 * verbs' own argument names, and the two that change a price runnable only with --confirm.
 */
const subs = promotionsCommand.commands.map((c) => c.name());
const flags = (name: string) => promotionsCommand.commands.find((c) => c.name() === name)!.options.map((o) => o.long);

describe('solid promotions', () => {
  it('has list, create, update, check and design', () => {
    expect(subs).toEqual(expect.arrayContaining(['list', 'create', 'update', 'check', 'design']));
  });

  it('create and update carry --confirm, because a promotion is a price', () => {
    expect(flags('create')).toContain('--confirm');
    expect(flags('update')).toContain('--confirm');
    expect(flags('list')).not.toContain('--confirm');
    expect(flags('design')).not.toContain('--confirm');
  });

  it('sends the verb its own argument names, only the ones set', () => {
    expect(promotionFields({ name: 'Spring', kind: 'percent', value: '15', code: 'SPRING15', min: '30', maxOff: '20' }))
      .toEqual({ name: 'Spring', kind: 'percent', value: 15, code: 'SPRING15', min_subtotal: 30, max_discount: 20 });
    expect(promotionFields({ active: 'no' })).toEqual({ active: false });
    expect(promotionFields({ active: 'yes' })).toEqual({ active: true });
    expect(promotionFields({})).toEqual({});
  });

  it('reads an item as product_id or product_id:quantity', () => {
    expect(parseItem('12')).toEqual({ product_id: 12, quantity: 1 });
    expect(parseItem('12:3')).toEqual({ product_id: 12, quantity: 3 });
    expect(() => parseItem('x:1')).toThrow();
    expect(() => parseItem('12:0')).toThrow();
  });

  it('design takes a shape', () => {
    expect(flags('design')).toEqual(expect.arrayContaining(['--shape', '--style']));
  });
});
