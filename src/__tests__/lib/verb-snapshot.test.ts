/**
 * "What changed since I last looked?" — lib/verb-snapshot.ts. Pure.
 */
import { diffSnapshot, fingerprint, isSnapshot, takeSnapshot } from '../../lib/verb-snapshot';

const base = [
  { name: 'page.publish', description: 'Publish a page.', input_schema: { properties: { page_id: {}, confirm: {} } }, side_effects: 'write' },
  { name: 'page.get', description: 'Read a page.', input_schema: {}, side_effects: 'read' },
  { name: 'old.verb', description: 'Going away.', side_effects: 'read' },
];

describe('fingerprint', () => {
  it('does not depend on key order', () => {
    expect(fingerprint({ name: 'a', input_schema: { x: 1, y: { b: 2, a: 1 } } }))
      .toBe(fingerprint({ name: 'a', input_schema: { y: { a: 1, b: 2 }, x: 1 } }));
  });

  it('changes when anything an agent decides on changes', () => {
    const v = { name: 'a', description: 'd', input_schema: {}, side_effects: 'write' };
    const fp = fingerprint(v);
    expect(fingerprint({ ...v, description: 'd2' })).not.toBe(fp);
    expect(fingerprint({ ...v, input_schema: { required: ['x'] } })).not.toBe(fp);
    expect(fingerprint({ ...v, status: 'stub' })).not.toBe(fp);
    expect(fingerprint({ ...v, undone_by: 'a.revert' })).not.toBe(fp);
    expect(fingerprint({ ...v, status: 'active' })).toBe(fp);      // the default, said or unsaid
  });
});

describe('diffSnapshot', () => {
  const snap = takeSnapshot(base, 'etag-1', new Date('2026-10-01T00:00:00Z'));

  it('is a snapshot, and nothing else is', () => {
    expect(isSnapshot(snap)).toBe(true);
    expect(snap.etag).toBe('etag-1');
    expect(isSnapshot({ verbs: {} })).toBe(false);
    expect(isSnapshot(null)).toBe(false);
  });

  it('nothing changed', () => {
    expect(diffSnapshot(snap, base)).toEqual({ since: '2026-10-01T00:00:00.000Z', added: [], removed: [], changed: [], unchanged: 3 });
  });

  it('names what was added, removed and changed', () => {
    const now = [
      { ...base[0], description: 'Publish a page. Refused while the design is locked.' },
      base[1],
      { name: 'page.slot_update', description: 'Change one slot.', side_effects: 'write' },
    ];
    const d = diffSnapshot(snap, now);
    expect(d.added).toEqual(['page.slot_update']);
    expect(d.changed).toEqual(['page.publish']);
    expect(d.removed).toEqual(['old.verb']);
    expect(d.unchanged).toBe(1);
  });
});
