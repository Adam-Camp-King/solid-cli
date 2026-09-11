/**
 * The books on the CLI — `solid books | invoices | expenses | accounting`.
 * BEHAVIOURAL, not source-read: the real commander actions run against a mocked
 * api-client and these assert what goes on the wire (see forms-verbs.test.ts
 * for why a grep of the source is a false green).
 *
 * Never: a write that records money without --confirm, an amount that isn't one,
 * a verb name or argument the backend doesn't know, or `solid accounting` calling
 * routes that do not exist (sync with no connection_id → 422, /sync/history → 404
 * — the state it was in until 2026-09-11).
 */

jest.mock('ora', () => ({
  __esModule: true,
  default: () => ({
    start: jest.fn().mockReturnThis(),
    stop: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
  }),
}));
jest.mock('chalk', () => {
  const id = (s: string) => s;
  const proxy: any = new Proxy(id, { get: () => proxy });
  return { __esModule: true, default: proxy };
});
jest.mock('../../lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn() },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));
// The box/label renderer does string work on chalk output; with chalk mocked to
// a proxy it would throw inside the command's try and turn a success into exit 1.
jest.mock('../../lib/ui', () => ({
  ui: {
    header: (text: string) => String(text),
    label: (key: string, value: string) => `${key} ${value}`,
    successBox: (title: string, lines: string[]) => [title, ...lines].join('\n'),
  },
}));
jest.mock('../../lib/config', () => ({
  config: { isLoggedIn: () => true, apiUrl: 'https://api.test', companyId: 3 },
}));

import { apiClient } from '../../lib/api-client';

const mockGet = apiClient.get as jest.Mock;
const mockPost = apiClient.post as jest.Mock;

type Group = 'booksCommand' | 'invoicesCommand' | 'expensesCommand' | 'accountingCommand';

/** A FRESH command instance per run — commander keeps parsed options on the
 *  (module-singleton) Command, so a --confirm would otherwise leak between tests. */
async function run(group: Group, argv: string[]) {
  let cmd: any;
  jest.isolateModules(() => {
    cmd = group === 'accountingCommand'
      ? require('../../commands/accounting').accountingCommand
      : require('../../commands/books')[group];
  });
  const exit = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`__exit_${code ?? 0}__`);
  }) as never);
  try {
    await cmd.parseAsync(['node', 'solid', ...argv]);
  } finally {
    exit.mockRestore();
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('solid invoices — money in', () => {
  it('records a payment through the one door, with consent', async () => {
    mockPost.mockResolvedValue({ data: { ok: true, result: { status: 'partial_paid' } } });
    await run('invoicesCommand', ['pay', '31', '--amount', '500', '--method', 'check', '--reference', '1042', '--confirm']);
    expect(mockPost).toHaveBeenCalledWith('/api/v1/ada/cli-dispatch', {
      verb: 'invoice_record_payment',
      args: { invoice_id: 31, amount: 500, method: 'check', reference: '1042' },
      confirm: true,
    });
  });

  it('⛔ refuses to record money without --confirm and never calls the backend', async () => {
    await expect(run('invoicesCommand', ['pay', '31', '--amount', '500'])).rejects.toThrow('__exit_2__');
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('⛔ refuses an amount that is not one', async () => {
    await expect(run('invoicesCommand', ['pay', '31', '--amount', 'lots', '--confirm'])).rejects.toThrow('__exit_2__');
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('reads aging through the invoice.receivables verb', async () => {
    mockGet
      .mockResolvedValueOnce({ data: { name: 'invoice.receivables', http_endpoint: '/api/v1/agent/invoice/receivables', http_method: 'GET' } })
      .mockResolvedValueOnce({ data: { owed_to_you: 700 } });
    await run('invoicesCommand', ['aging', '--as-of', '2026-10-15']);
    expect(mockGet).toHaveBeenNthCalledWith(1, '/api/v1/agent/verbs/invoice.receivables');
    expect(mockGet).toHaveBeenNthCalledWith(2, '/api/v1/agent/invoice/receivables', { params: { as_of: '2026-10-15' } });
  });
});

describe('solid expenses — money out', () => {
  it('files a bill with the kind, vendor and amount the verb expects', async () => {
    mockPost.mockResolvedValue({ data: { ok: true, result: { status: 'posted' } } });
    await run('expensesCommand', ['file', '--vendor', 'Adobe', '--amount', '$54.99', '--bill', '--category', 'software', '--confirm']);
    expect(mockPost).toHaveBeenCalledWith('/api/v1/ada/cli-dispatch', {
      verb: 'expense_create',
      args: { kind: 'bill', vendor_name: 'Adobe', amount: 54.99, category: 'software' },
      confirm: true,
    });
  });

  it('⛔ refuses to void without --confirm', async () => {
    await expect(run('expensesCommand', ['void', '12', '--reason', 'duplicate'])).rejects.toThrow('__exit_2__');
    expect(mockPost).not.toHaveBeenCalled();
  });
});

describe('solid books summary', () => {
  it('asks the books.summary verb for the period', async () => {
    mockGet
      .mockResolvedValueOnce({ data: { name: 'books.summary', http_endpoint: '/api/v1/agent/books/summary', http_method: 'GET' } })
      .mockResolvedValueOnce({ data: { money_in: {}, money_out: {} } });
    await run('booksCommand', ['summary', '--since', '2026-09-01']);
    expect(mockGet).toHaveBeenNthCalledWith(2, '/api/v1/agent/books/summary', { params: { since: '2026-09-01' } });
  });
});

describe('solid accounting — the optional mirror, against routes that exist', () => {
  it('sync sends the connection it is syncing', async () => {
    mockGet.mockResolvedValueOnce({ data: { connections: [{ id: 9, provider: 'quickbooks', sync_enabled: true }] } });
    mockPost.mockResolvedValue({ data: { status: 'sync_started' } });
    await run('accountingCommand', ['sync']);
    expect(mockPost).toHaveBeenCalledWith('/api/v1/accounting/sync', { connection_id: 9 });
  });

  it('history reads the per-connection route', async () => {
    mockGet
      .mockResolvedValueOnce({ data: { connections: [{ id: 9, provider: 'quickbooks', sync_enabled: true }] } })
      .mockResolvedValueOnce({ data: { items: [] } });
    await run('accountingCommand', ['history', '--limit', '5']);
    expect(mockGet).toHaveBeenNthCalledWith(2, '/api/v1/accounting/sync/history/9', { params: { limit: '5' } });
  });

  it('⛔ with nothing connected, sync says so and sends nothing', async () => {
    mockGet.mockResolvedValueOnce({ data: { connections: [] } });
    await expect(run('accountingCommand', ['sync'])).rejects.toThrow('__exit_1__');
    expect(mockPost).not.toHaveBeenCalled();
  });
});
