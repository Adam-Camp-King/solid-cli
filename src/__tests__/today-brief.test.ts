/**
 * `solid today` brief shaping (src/commands/today.ts).
 *
 * ⛔ WHAT THESE LOCK DOWN (2026-09-23). The command used to guess field names
 * against /crm/dashboard/summary — `net_revenue`, `pipeline_value`,
 * `open_deals` — none of which exists at that payload's top level, so revenue
 * and pipeline were null forever with nothing said about why. And it reported
 * the raw pending-task count (785) as "urgent", every sample reading
 * "CALLBACK REQUEST: Chat Visitor".
 *
 * Pure — no network. The payloads below are the shapes
 * `GET /api/v1/dashboard/brief` actually returns.
 */
import { buildBrief } from '../commands/today';

const RICH = {
  date: 'Tuesday, September 23',
  summary: 'Good morning! Revenue is up 12% this week at $37,868.',
  keyMetrics: {
    revenue: { value: 37867.96, change: 12, trend: 'up', available: true, reason: null, period: 'This week' },
    deals: { value: 4, change: 0, trend: 'up', available: true, reason: null },
    pipeline: { value: 220500, openDeals: 16, available: true, reason: null },
    tasks: { value: 785, completed: 3, overdue: 12, available: true, reason: null },
    emails: { sent: 0, opened: 0, replied: 0 },
  },
  priorities: [
    { id: 991, type: 'task', title: '785 website visitors are waiting for a call back', subtitle: 'CALLBACK WANTED', priority: 'medium', action: 'Open task', count: 785 },
    { id: 9, type: 'call', title: 'Call back (801) 555-0199', subtitle: 'CALLBACK WANTED · URGENT', priority: 'high', action: 'Call back', count: null },
  ],
  recommendations: ['Clear the 12 overdue tasks to stay on track'],
};

describe('buildBrief — every number says whether it was measured', () => {
  it('reads revenue and pipeline off the brief the platform actually returns', () => {
    const b = buildBrief({ company: { name: 'Acme Plumbing' }, brief: RICH });
    expect(b.companyName).toBe('Acme Plumbing');
    expect(b.revenue.value).toBe(37867.96);
    expect(b.revenue.available).toBe(true);
    expect(b.revenue.period).toBe('This week');
    expect(b.pipeline.value).toBe(220500);
    expect(b.pipeline.openDeals).toBe(16);
    expect(b.tasks.open.value).toBe(785);
    expect(b.tasks.overdue).toBe(12);
  });

  it('carries the reason when a number was NOT measured, and never shows 0', () => {
    const b = buildBrief({
      brief: {
        keyMetrics: {
          revenue: { value: null, change: 0, trend: 'flat', available: false, reason: 'Paid orders could not be read, so this week’s revenue is unknown.' },
          pipeline: { value: null, openDeals: null, available: false, reason: 'Deals could not be read, so the pipeline total is unknown.' },
          tasks: { value: null, completed: null, overdue: null, available: false, reason: 'crm_tasks could not be read, so the task counts are unknown.' },
        },
      },
    });
    expect(b.revenue.value).toBeNull();
    expect(b.revenue.available).toBe(false);
    expect(b.revenue.reason).toMatch(/could not be read/);
    expect(b.pipeline.reason).toMatch(/could not be read/);
    expect(b.tasks.open.reason).toMatch(/could not be read/);
  });

  it('distinguishes measured-and-empty from not-measured', () => {
    const b = buildBrief({
      brief: {
        keyMetrics: {
          revenue: { value: 0, change: 0, trend: 'flat', available: true, reason: 'No paid orders since this week started.' },
          pipeline: { value: null, openDeals: null, available: false, reason: 'Deals could not be read, so the pipeline total is unknown.' },
        },
      },
    });
    // Measured zero is a fact and keeps its 0, with the reason attached.
    expect(b.revenue.value).toBe(0);
    expect(b.revenue.available).toBe(true);
    expect(b.revenue.reason).toMatch(/No paid orders/);
    // Unknown is null and says so. A false zero here would be the whole bug.
    expect(b.pipeline.value).toBeNull();
    expect(b.pipeline.available).toBe(false);
  });

  it('never turns an unavailable metric into a number, even if one is present', () => {
    const b = buildBrief({
      brief: { keyMetrics: { revenue: { value: 0, available: false, reason: 'stale cache' } } },
    });
    expect(b.revenue.value).toBeNull();
  });

  it('says the brief itself is missing rather than showing four bare nulls', () => {
    const b = buildBrief({});
    expect(b.revenue.value).toBeNull();
    expect(b.revenue.available).toBe(false);
    expect(b.revenue.reason).toMatch(/could not be read from the server/);
    expect(b.pipeline.reason).toMatch(/could not be read from the server/);
    expect(b.tasks.open.reason).toMatch(/could not be read from the server/);
    expect(b.needsYou.items).toEqual([]);
    expect(b.actions).toEqual([]);
  });
});

describe('buildBrief — chat callbacks are one item with a count', () => {
  it('shows the grouped item once and keeps the number it stands for', () => {
    const b = buildBrief({ brief: RICH });
    expect(b.needsYou.items.length).toBe(2);
    const group = b.needsYou.items[0];
    expect(group.title).toBe('785 website visitors are waiting for a call back');
    expect(group.count).toBe(785);
    // Not deleted, not hidden: the rows are still reported.
    expect(b.needsYou.grouped).toBe(785);
  });

  it('does not report a pile of chat callbacks as urgent', () => {
    const b = buildBrief({ brief: RICH });
    expect(b.needsYou.items[0].priority).toBe('medium');
    // The genuinely urgent item is still there and still high.
    expect(b.needsYou.items[1].priority).toBe('high');
  });

  it('an ordinary item carries no count', () => {
    const b = buildBrief({ brief: RICH });
    expect(b.needsYou.items[1].count).toBeNull();
    expect(b.needsYou.grouped).toBe(785);
  });

  it('drops a row with no title rather than rendering a blank bullet', () => {
    const b = buildBrief({ brief: { priorities: [{ id: 1, title: '   ' }, { id: 2, title: 'Real' }] } });
    expect(b.needsYou.items.map((i) => i.title)).toEqual(['Real']);
  });
});

describe('buildBrief — tolerating an older server', () => {
  it('infers availability when the server does not send it', () => {
    const b = buildBrief({ brief: { keyMetrics: { revenue: { value: 100 }, pipeline: {} } } });
    expect(b.revenue.value).toBe(100);
    expect(b.revenue.available).toBe(true);
    expect(b.pipeline.value).toBeNull();
    expect(b.pipeline.available).toBe(false);
    expect(b.pipeline.reason).toBeNull();
  });

  it('passes the server recommendations through as the actions', () => {
    const b = buildBrief({ brief: { recommendations: ['Follow up on your 4 pending deals today', ''] } });
    expect(b.actions).toEqual(['Follow up on your 4 pending deals today']);
  });
});
