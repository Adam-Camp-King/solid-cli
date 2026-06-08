import { drainSSE } from '../../commands/signal';

/**
 * drainSSE parses the wire frames from `solid signal stream`. It must:
 *  - emit one object per complete `data:` frame,
 *  - skip the `ready` prelude and `: keepalive` heartbeats (no event id),
 *  - carry a partial trailing frame forward as `rest`,
 *  - never throw on a malformed frame.
 */
describe('drainSSE', () => {
  it('extracts complete event frames and skips heartbeats/prelude', () => {
    const buf =
      ': connected\n\n' +
      'event: ready\ndata: {"topic":"agent.any","cursor":41}\n\n' +
      'data: {"id":42,"action":"deal.won"}\n\n' +
      ': keepalive\n\n' +
      'data: {"id":43,"action":"lead.created"}\n\n';
    const { events, rest } = drainSSE(buf);
    expect(events.map((e) => e.id)).toEqual([42, 43]);
    expect(rest).toBe('');
  });

  it('carries a partial trailing frame into rest', () => {
    const { events, rest } = drainSSE('data: {"id":1,"action":"a"}\n\ndata: {"id":2,"act');
    expect(events.map((e) => e.id)).toEqual([1]);
    expect(rest).toBe('data: {"id":2,"act');
    // ...and completes once the rest of the frame arrives
    const next = drainSSE(rest + 'ion":"b"}\n\n');
    expect(next.events.map((e) => e.id)).toEqual([2]);
  });

  it('tolerates a malformed frame without throwing or emitting it', () => {
    const { events } = drainSSE('data: {not json}\n\ndata: {"id":9,"action":"ok"}\n\n');
    expect(events.map((e) => e.id)).toEqual([9]);
  });

  it('returns nothing when no frame is complete yet', () => {
    const { events, rest } = drainSSE('data: {"id":1');
    expect(events).toEqual([]);
    expect(rest).toBe('data: {"id":1');
  });
});
