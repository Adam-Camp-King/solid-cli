/**
 * Unit tests for src/lib/list-envelope.ts (Sprint 1 T1.4).
 * Pure-function tests — no HTTP.
 */
import {
  KNOWN_LIST_KEYS,
  applyListEnvelope,
  detectListKey,
  legacyListShapesEnabled,
  normalizeListEnvelope,
} from '../lib/list-envelope';

describe('detectListKey', () => {
  it.each(['items', 'pages', 'results', 'leads', 'agents', 'templates', 'companies', 'sites', 'api_keys', 'logs'])(
    'finds %s when present',
    (key) => {
      expect(detectListKey({ [key]: [1, 2] })).toBe(key);
    },
  );

  it('returns null when no array-shaped known key is present', () => {
    expect(detectListKey({ detail: 'not a list', status: 'ok' })).toBeNull();
  });

  it('returns null for null/undefined/array/primitive', () => {
    expect(detectListKey(null)).toBeNull();
    expect(detectListKey(undefined)).toBeNull();
    expect(detectListKey([1, 2])).toBeNull();
    expect(detectListKey('hello')).toBeNull();
    expect(detectListKey(42)).toBeNull();
  });

  it('order matters: items wins over pages if both present', () => {
    // items comes first in KNOWN_LIST_KEYS
    expect(detectListKey({ items: [1], pages: [2] })).toBe('items');
  });

  it('ignores keys whose value is not actually an array', () => {
    // pages is in known list, but value isn't an array here
    expect(detectListKey({ pages: 'not-an-array', results: ['ok'] })).toBe('results');
  });

  it('supports custom key list', () => {
    expect(detectListKey({ foo: [1] }, ['foo', 'bar'])).toBe('foo');
    expect(detectListKey({ foo: [1] }, ['bar'])).toBeNull();
  });
});

describe('normalizeListEnvelope', () => {
  it('aliases the list array to items and fills total from length', () => {
    const out = normalizeListEnvelope({ pages: [1, 2, 3] });
    expect(out).toEqual({
      items: [1, 2, 3],
      total: 3,
      page: null,
      has_more: null,
      _source_key: 'pages',
    });
  });

  it('honors server-supplied total', () => {
    const out = normalizeListEnvelope({ results: [1], total: 42 });
    expect(out?.total).toBe(42);
    expect(out?.items).toEqual([1]);
  });

  it('falls back to `count` when total is missing', () => {
    const out = normalizeListEnvelope({ results: [1, 2], count: 99 });
    expect(out?.total).toBe(99);
  });

  it('accepts numeric strings for total', () => {
    const out = normalizeListEnvelope({ results: [1], total: '7' });
    expect(out?.total).toBe(7);
  });

  it('carries page when present', () => {
    expect(normalizeListEnvelope({ results: [], page: 2 })?.page).toBe(2);
    expect(normalizeListEnvelope({ results: [], cursor: 'abc' })?.page).toBe('abc');
    expect(normalizeListEnvelope({ results: [], next_cursor: 'def' })?.page).toBe('def');
  });

  it('carries has_more (snake or camel)', () => {
    expect(normalizeListEnvelope({ results: [], has_more: true })?.has_more).toBe(true);
    expect(normalizeListEnvelope({ results: [], hasMore: false })?.has_more).toBe(false);
  });

  it('returns null for non-list bodies', () => {
    expect(normalizeListEnvelope(null)).toBeNull();
    expect(normalizeListEnvelope({ detail: 'nope' })).toBeNull();
    expect(normalizeListEnvelope([1, 2])).toBeNull();
  });

  it('is a pure read — does not mutate input', () => {
    const body = { pages: [1], total: 1 };
    const snap = JSON.parse(JSON.stringify(body));
    normalizeListEnvelope(body);
    expect(body).toEqual(snap);
  });
});

describe('legacyListShapesEnabled', () => {
  it('false when env var unset', () => {
    expect(legacyListShapesEnabled({})).toBe(false);
  });

  it.each(['1', 'true', 'TRUE', 'yes', 'On'])('%s → true', (v) => {
    expect(legacyListShapesEnabled({ SOLID_LEGACY_LIST_SHAPES: v })).toBe(true);
  });

  it.each(['0', 'false', '', 'no', 'banana'])('%s → false', (v) => {
    expect(legacyListShapesEnabled({ SOLID_LEGACY_LIST_SHAPES: v })).toBe(false);
  });
});

describe('applyListEnvelope', () => {
  it('adds items/total/page/has_more non-destructively', () => {
    const body = { pages: [1, 2], total: 2 };
    const out = applyListEnvelope(body, {});
    expect(out).toBe(body); // same reference — mutated in place
    expect((body as any).items).toEqual([1, 2]);
    expect((body as any).total).toBe(2);
    expect((body as any).page).toBeNull();
    expect((body as any).has_more).toBeNull();
    // Original key preserved
    expect((body as any).pages).toEqual([1, 2]);
  });

  it('does NOT clobber a caller-supplied items/total/page/has_more', () => {
    const body: Record<string, unknown> = {
      pages: [1, 2],
      items: ['explicit'],
      total: 999,
      page: 'given',
      has_more: true,
    };
    applyListEnvelope(body, {});
    expect(body.items).toEqual(['explicit']);
    expect(body.total).toBe(999);
    expect(body.page).toBe('given');
    expect(body.has_more).toBe(true);
  });

  it('is a no-op when the body is not list-shaped', () => {
    const body = { detail: 'not a list' };
    const snap = JSON.parse(JSON.stringify(body));
    applyListEnvelope(body, {});
    expect(body).toEqual(snap);
  });

  it('is a no-op under SOLID_LEGACY_LIST_SHAPES=1', () => {
    const body = { pages: [1, 2] };
    applyListEnvelope(body, { SOLID_LEGACY_LIST_SHAPES: '1' });
    expect((body as any).items).toBeUndefined();
    expect((body as any).pages).toEqual([1, 2]);
  });

  it('is a no-op for null / primitive bodies', () => {
    expect(applyListEnvelope(null as any, {})).toBeNull();
    expect(applyListEnvelope(42 as any, {})).toBe(42);
    expect(applyListEnvelope('hi' as any, {})).toBe('hi');
  });

  it('handles every known list key', () => {
    for (const key of KNOWN_LIST_KEYS) {
      const body: Record<string, unknown> = { [key]: [1, 2, 3] };
      applyListEnvelope(body, {});
      expect(body.items).toEqual([1, 2, 3]);
      expect(body.total).toBe(3);
    }
  });
});
