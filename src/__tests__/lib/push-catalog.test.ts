/**
 * solid push for services/ and products/ — only what differs, and never a price.
 */
import { diffCatalog, mergeDiffs } from '../../lib/push-catalog';

const remote = [
  { id: 7, title: 'Drain cleaning', description: 'Old words', category: 'plumbing', price: 120 },
  { id: 8, title: 'Water heater', description: 'Same', category: 'plumbing', price: 900 },
];

describe('diffCatalog', () => {
  it('sends only the fields that differ, through the update verb with the id', () => {
    const d = diffCatalog('services', [
      { file: 'drain.json', data: { _id: 7, title: 'Drain cleaning', description: 'New words', category: 'plumbing', price: 120 } },
    ], remote);
    expect(d.changes).toEqual([{ kind: 'services', file: 'drain.json', id: 7, verb: 'service.update',
      args: { service_id: 7, description: 'New words' }, changed: ['description'] }]);
    expect(d.price_not_pushed).toEqual([]);
  });

  it('an unchanged file is not a change', () => {
    const d = diffCatalog('services', [
      { file: 'heater.json', data: { _id: 8, title: ' Water heater ', description: 'Same', category: 'plumbing', price: 900 } },
    ], remote);
    expect(d.changes).toEqual([]);
  });

  it('never pushes a price, and says which verb changes one', () => {
    const d = diffCatalog('products', [{ file: 'p.json', data: { _id: 7, name: 'Drain cleaning', price: 99 } }],
      [{ id: 7, name: 'Drain cleaning', price: 120 }]);
    expect(d.changes).toEqual([]);
    expect(d.price_not_pushed).toEqual([{ kind: 'products', file: 'p.json', id: 7, local: 99, remote: 120,
      use: 'product.update_pricing' }]);
  });

  it('a changed name and a changed price: the name goes, the price does not', () => {
    const d = diffCatalog('products', [{ file: 'p.json', data: { _id: 7, name: 'Drain clearing', price: 99 } }],
      [{ id: 7, name: 'Drain cleaning', price: 120 }]);
    expect(d.changes[0].args).toEqual({ product_id: 7, name: 'Drain clearing' });
    expect('price' in d.changes[0].args).toBe(false);
    expect(d.price_not_pushed).toHaveLength(1);
  });

  it('a file with no _id, or whose record is gone, is not created', () => {
    const d = diffCatalog('services', [
      { file: 'new.json', data: { title: 'New thing' } },
      { file: 'gone.json', data: { _id: 99, title: 'Gone' } },
    ], remote);
    expect(d.changes).toEqual([]);
    expect(d.not_pushed.map((n) => n.file)).toEqual(['new.json', 'gone.json']);
    expect(d.not_pushed[0].why).toContain('service.create');
  });

  it('a field cleared in the file does not blank the record', () => {
    const d = diffCatalog('services', [{ file: 'drain.json', data: { _id: 7, title: 'Drain cleaning', description: null } }], remote);
    expect(d.changes).toEqual([]);
  });

  it('merges', () => {
    const a = diffCatalog('services', [{ file: 'new.json', data: {} }], []);
    expect(mergeDiffs(a, a).not_pushed).toHaveLength(2);
  });
});
