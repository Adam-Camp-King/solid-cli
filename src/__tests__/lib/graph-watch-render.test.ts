/**
 * Renderer for `solid graph --watch-actions`. Pure module; covers
 * formatTime, payloadLabel, payloadId, classifyEvent, renderWatchEvent.
 */

import {
  classifyEvent,
  formatTime,
  payloadId,
  payloadLabel,
  renderWatchEvent,
} from '../../lib/graph-watch-render';


describe('formatTime', () => {
  it('extracts HH:MM:SS from ISO timestamp', () => {
    const out = formatTime('2026-04-29T12:34:56.000Z');
    // Local time depends on TZ; assert only the shape
    expect(out).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('falls back to ?? on undefined', () => {
    expect(formatTime(undefined)).toBe('??:??:??');
  });

  it('falls back to ?? on garbage input', () => {
    expect(formatTime('not-a-date')).toBe('??:??:??');
  });
});


describe('payloadLabel', () => {
  it('prefers name over title', () => {
    expect(payloadLabel({ name: 'Acme', title: 'Whatever' })).toBe('Acme');
  });

  it('falls through to title when no name', () => {
    expect(payloadLabel({ title: 'Drain cleaning' })).toBe('Drain cleaning');
  });

  it('falls through to email when no name/title', () => {
    expect(payloadLabel({ email: 'ada@example.com' })).toBe('ada@example.com');
  });

  it('returns <unknown> when nothing matches', () => {
    expect(payloadLabel({ foo: 'bar' })).toBe('<unknown>');
  });

  it('returns <unknown> for undefined payload', () => {
    expect(payloadLabel(undefined)).toBe('<unknown>');
  });

  it('skips empty strings', () => {
    expect(payloadLabel({ name: '', title: 'Real title' })).toBe('Real title');
  });
});


describe('payloadId', () => {
  it('prefers entity-prefixed id when hint matches', () => {
    expect(payloadId({ order_id: 99, id: 7 }, 'order')).toBe(99);
  });

  it('falls back to plain id', () => {
    expect(payloadId({ id: 42 })).toBe(42);
  });

  it('finds any *_id field as last resort', () => {
    expect(payloadId({ chain_id: 5 })).toBe(5);
  });

  it('returns null when nothing id-like is present', () => {
    expect(payloadId({ name: 'X' })).toBeNull();
  });

  it('handles undefined payload', () => {
    expect(payloadId(undefined)).toBeNull();
  });
});


describe('classifyEvent', () => {
  it.each([
    ['order.created', 'order', 'create'],
    ['contact.created', 'contact', 'create'],
    ['service.updated', 'service', 'update'],
    ['kb.changed', 'kb', 'update'],
    ['contact.deleted', 'contact', 'delete'],
    ['inventory.removed', 'inventory', 'delete'],
    ['chain.fired', 'chain', 'fire'],
    ['chain.triggered', 'chain', 'fire'],
  ])('%s → entity=%s op=%s', (eventType, entity, op) => {
    const out = classifyEvent(eventType);
    expect(out.entity).toBe(entity);
    expect(out.op).toBe(op);
  });

  it('unknown verb maps to other', () => {
    expect(classifyEvent('order.frobnicated')).toEqual({ entity: 'order', op: 'other' });
  });

  it('non-dotted event type maps to other', () => {
    expect(classifyEvent('weird-event')).toEqual({ entity: 'weird-event', op: 'other' });
  });
});


describe('renderWatchEvent', () => {
  it('renders a created Contact line with name', () => {
    const out = renderWatchEvent({
      type: 'contact.created',
      payload: { id: 42, name: 'Ada Lovelace', agent: 'Sarah' },
      ts: '2026-04-29T12:34:56Z',
    });
    expect(out.op).toBe('create');
    expect(out.plain).toMatch(/Contact #42 \(Ada Lovelace\)/);
    expect(out.plain).toMatch(/by Sarah \(agent\)/);
    expect(out.plain).toContain('+');
  });

  it('renders an updated Service with price diff when both prev + new present', () => {
    const out = renderWatchEvent({
      type: 'service.updated',
      payload: { id: 3, name: 'Drain cleaning', price: 119, prev_price: 99 },
      ts: '2026-04-29T12:34:58Z',
    });
    expect(out.op).toBe('update');
    expect(out.plain).toMatch(/Service #3 \(Drain cleaning\)/);
    expect(out.plain).toMatch(/price: 99 → 119/);
    expect(out.plain).toContain('~');
  });

  it('renders a chain.fired line', () => {
    const out = renderWatchEvent({
      type: 'chain.fired',
      payload: { id: 1, name: 'New lead followup' },
      ts: '2026-04-29T12:35:01Z',
    });
    expect(out.op).toBe('fire');
    expect(out.plain).toMatch(/Chain #1 \(New lead followup\)/);
  });

  it('renders an order with order_number as label', () => {
    const out = renderWatchEvent({
      type: 'order.created',
      payload: { id: 99, order_number: 'ORD-2026-099', chain_name: 'New lead followup' },
      ts: '2026-04-29T12:35:01Z',
    });
    expect(out.op).toBe('create');
    expect(out.plain).toMatch(/Order #99 \(ORD-2026-099\)/);
    expect(out.plain).toMatch(/fired by chain "New lead followup"/);
  });

  it('renders deleted with red - sigil', () => {
    const out = renderWatchEvent({
      type: 'contact.deleted',
      payload: { id: 7, name: 'Bob' },
    });
    expect(out.op).toBe('delete');
    expect(out.plain).toContain('-');
  });

  it('handles missing payload gracefully', () => {
    const out = renderWatchEvent({ type: 'contact.created' });
    // Should not throw, op still create
    expect(out.op).toBe('create');
    expect(out.plain).toContain('Contact');
  });

  it('handles unknown event type without crashing', () => {
    const out = renderWatchEvent({ type: 'mysterious.thing' });
    expect(out.op).toBe('other');
  });
});
