/**
 * Unit tests for `solid today` brief shaping (src/commands/today.ts).
 * Pure — no network. Verifies defensive field extraction + action derivation.
 */
import { buildBrief } from '../commands/today';

describe('buildBrief', () => {
  it('extracts revenue/pipeline from a rich summary', () => {
    const b = buildBrief({
      company: { name: 'Acme Plumbing' },
      summary: {
        net_revenue: 37867.96,
        orders: 53,
        average_order_value: 714.49,
        total_pipeline: 220500,
        open_deals: 16,
      },
      tasks: { total: 10, tasks: [{ title: 'Call David' }, { title: 'Quote Jess' }] },
      targets: [],
    });
    expect(b.companyName).toBe('Acme Plumbing');
    expect(b.revenue.net).toBe(37867.96);
    expect(b.revenue.orders).toBe(53);
    expect(b.pipeline.total).toBe(220500);
    expect(b.pipeline.openDeals).toBe(16);
    expect(b.urgent.taskCount).toBe(10);
    expect(b.urgent.samples).toContain('Call David');
  });

  it('tolerates alternate field names', () => {
    const b = buildBrief({ summary: { revenue: 100, pipeline_value: 500, open_deals_count: 3 } });
    expect(b.revenue.net).toBe(100);
    expect(b.pipeline.total).toBe(500);
    expect(b.pipeline.openDeals).toBe(3);
  });

  it('never throws on empty/missing data and still gives an action', () => {
    const b = buildBrief({});
    expect(b.companyName).toBeNull();
    expect(b.revenue.net).toBeNull();
    expect(b.urgent.taskCount).toBe(0);
    expect(b.actions.length).toBeGreaterThanOrEqual(1); // always actionable
  });

  it('prefers server-suggested targets as recommended actions', () => {
    const b = buildBrief({
      targets: [{ title: 'Re-engage stalled deal #46' }, { recommendation: 'Send invoice to Kowalski' }],
    });
    expect(b.actions[0]).toBe('Re-engage stalled deal #46');
    expect(b.actions[1]).toBe('Send invoice to Kowalski');
  });

  it('derives actions from state when no targets', () => {
    const b = buildBrief({
      summary: { open_deals: 4 },
      tasks: [{ title: 'a' }, { title: 'b' }],
    });
    expect(b.actions.some((a) => a.includes('2 pending task'))).toBe(true);
    expect(b.actions.some((a) => a.includes('4 open deal'))).toBe(true);
  });

  it('counts tasks from a bare array', () => {
    const b = buildBrief({ tasks: [{ title: 'x' }, { title: 'y' }, { title: 'z' }] });
    expect(b.urgent.taskCount).toBe(3);
    expect(b.urgent.samples.length).toBe(3);
  });
});
