/**
 * GET /api/v1/subscriptions declares no query parameters and returns ONE
 * object (this company's Solid# plan). `subs list` must send exactly that
 * request — no page_size/offset/customer_id/status the route drops — and
 * render the object it gets back.
 */
jest.mock('ora', () => ({
  __esModule: true,
  default: () => ({
    start: jest.fn().mockReturnThis(), stop: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(), fail: jest.fn().mockReturnThis(),
  }),
}));
jest.mock('../../lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn() },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));

import { apiClient } from '../../lib/api-client';
const mockGet = apiClient.get as jest.Mock;

async function run(argv: string[]) {
  let cmd: any;
  jest.isolateModules(() => { cmd = require('../../commands/subscriptions').subscriptionsCommand; });
  const out: string[] = [];
  const log = jest.spyOn(console, 'log').mockImplementation((...a: any[]) => { out.push(a.join(' ')); });
  try { await cmd.parseAsync(['node', 'subscriptions', ...argv]); } finally { log.mockRestore(); }
  return out.join('\n');
}

test('sends GET /api/v1/subscriptions with no query at all', async () => {
  mockGet.mockResolvedValue({ data: { company_id: 3, tier: 'growth', status: 'active', billing_account: true,
    current_period_end: '2026-10-01', cancel_at_period_end: false } });
  const out = await run(['list']);
  expect(mockGet).toHaveBeenCalledTimes(1);
  expect(mockGet.mock.calls[0]).toEqual(['/api/v1/subscriptions']);
  expect(out).toContain('growth');
  expect(out).not.toContain('No subscriptions found');
});

test('the dropped filter flags are no longer accepted', async () => {
  let cmd: any;
  jest.isolateModules(() => { cmd = require('../../commands/subscriptions').subscriptionsCommand; });
  const list = cmd.commands.find((c: any) => c.name() === 'list');
  const flags = list.options.map((o: any) => o.long);
  for (const f of ['--customer', '--status', '--limit', '--offset', '--page-size']) expect(flags).not.toContain(f);
});
