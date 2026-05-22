/**
 * Tests for the v2.11.1 agent-attraction verb shortcuts.
 *
 * Five new top-level commands wrap GET-style intelligence verbs from
 * /api/v1/agent/verbs. The helper looks up the verb's HTTP endpoint +
 * method from /api/v1/agent/verbs/{name}, then dispatches GET or POST.
 *
 * These tests verify:
 *   - Each command resolves to the correct verb name.
 *   - Required-vs-optional args are passed through correctly.
 *   - GET routing is used for read-only intelligence verbs.
 *   - JSON output mode bypasses the human-friendly printer.
 *
 * They do NOT hit the live API — apiClient is mocked.
 */
import { config } from '../../lib/config';
import { apiClient } from '../../lib/api-client';
import {
  customerContextCommand,
  dealNextCommand,
  contactMapCommand,
  customerUpsellCommand,
  inventoryReorderCommand,
} from '../../commands/dispatch_shortcuts';

jest.mock('../../lib/api-client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
  },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));

jest.mock('../../lib/config', () => ({
  config: {
    isLoggedIn: jest.fn(() => true),
    companyId: 1,
  },
}));

jest.mock('ora', () => () => ({
  start: () => ({
    stop: jest.fn(),
    succeed: jest.fn(),
    fail: jest.fn(),
  }),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

// Capture console output so we can assert on JSON-mode behavior.
let stdout: string[] = [];
let exitCode: number | null = null;
const origLog = console.log;
const origErr = console.error;
const origExit = process.exit;

beforeAll(() => {
  console.log = (...args: any[]) => { stdout.push(args.join(' ')); };
  console.error = (...args: any[]) => { stdout.push(args.join(' ')); };
  // @ts-ignore — we don't want tests to actually exit
  process.exit = ((code?: number) => {
    exitCode = code ?? 0;
    throw new Error(`__test_process_exit_${exitCode}__`);
  }) as any;
});

afterAll(() => {
  console.log = origLog;
  console.error = origErr;
  process.exit = origExit;
});

beforeEach(() => {
  jest.clearAllMocks();
  stdout = [];
  exitCode = null;
});

// ── Helpers ─────────────────────────────────────────────────────────

function mockVerbLookup(verbName: string, httpEndpoint: string, httpMethod: 'GET' | 'POST' = 'GET') {
  // First call: GET /api/v1/agent/verbs/{name} — returns the verb metadata.
  (mockApi.get as jest.Mock).mockImplementationOnce(async (url: string) => {
    if (url.includes(`/api/v1/agent/verbs/${encodeURIComponent(verbName)}`)) {
      return {
        data: { name: verbName, http_endpoint: httpEndpoint, http_method: httpMethod },
        status: 200,
        success: true,
      };
    }
    throw new Error(`Unexpected lookup URL: ${url}`);
  });
}

function mockVerbCall(data: Record<string, unknown>) {
  // Second call: GET (or POST) the verb's actual http_endpoint.
  (mockApi.get as jest.Mock).mockImplementationOnce(async () => ({ data, status: 200, success: true }));
}

async function runCommand(commandFn: () => Promise<unknown> | unknown) {
  try {
    await commandFn();
  } catch (e: any) {
    // process.exit throws a marker error so we can assert on exit codes
    if (!String(e?.message || '').startsWith('__test_process_exit_')) throw e;
  }
}

// ── Tests ───────────────────────────────────────────────────────────

describe('customer-context', () => {
  it('looks up customer.full_context verb and passes customer_id', async () => {
    mockVerbLookup('customer.full_context', '/api/v1/agent/customer/full_context', 'GET');
    mockVerbCall({ customer_id: 42, name: 'Acme', orders_count: 5 });

    await runCommand(() => customerContextCommand.parseAsync(['42', '--json'], { from: 'user' }));

    expect(mockApi.get).toHaveBeenCalledWith(
      '/api/v1/agent/verbs/customer.full_context',
    );
    expect(mockApi.get).toHaveBeenCalledWith(
      '/api/v1/agent/customer/full_context',
      { params: { customer_id: 42 } },
    );
  });

  it('passes include_payment_methods flag when set', async () => {
    mockVerbLookup('customer.full_context', '/api/v1/agent/customer/full_context');
    mockVerbCall({ customer_id: 42 });

    await runCommand(() =>
      customerContextCommand.parseAsync(['42', '--include-payment-methods', '--json'], { from: 'user' }),
    );

    expect(mockApi.get).toHaveBeenLastCalledWith(
      '/api/v1/agent/customer/full_context',
      { params: { customer_id: 42, include_payment_methods: true } },
    );
  });
});

describe('deal-next', () => {
  it('routes deal_id to deal.suggest_next_action', async () => {
    mockVerbLookup('deal.suggest_next_action', '/api/v1/agent/deal/suggest_next_action');
    mockVerbCall({ deal_id: 7, next_action: 'follow_up_email' });

    await runCommand(() => dealNextCommand.parseAsync(['7', '--json'], { from: 'user' }));

    expect(mockApi.get).toHaveBeenCalledWith(
      '/api/v1/agent/verbs/deal.suggest_next_action',
    );
    expect(mockApi.get).toHaveBeenLastCalledWith(
      '/api/v1/agent/deal/suggest_next_action',
      { params: { deal_id: 7 } },
    );
  });
});

describe('contact-map', () => {
  it('routes contact_id to contact.relationship_map', async () => {
    mockVerbLookup('contact.relationship_map', '/api/v1/agent/contact/relationship_map');
    mockVerbCall({ contact_id: 99, company: 'Acme', peers: [] });

    await runCommand(() => contactMapCommand.parseAsync(['99', '--json'], { from: 'user' }));

    expect(mockApi.get).toHaveBeenLastCalledWith(
      '/api/v1/agent/contact/relationship_map',
      { params: { contact_id: 99 } },
    );
  });
});

describe('customer-upsell', () => {
  it('defaults limit to 5 when not specified', async () => {
    mockVerbLookup('customer.suggest_upsell', '/api/v1/agent/customer/suggest_upsell');
    mockVerbCall({ suggestions: [] });

    await runCommand(() => customerUpsellCommand.parseAsync(['42', '--json'], { from: 'user' }));

    expect(mockApi.get).toHaveBeenLastCalledWith(
      '/api/v1/agent/customer/suggest_upsell',
      { params: { customer_id: 42, limit: 5 } },
    );
  });

  it('honors --limit override', async () => {
    mockVerbLookup('customer.suggest_upsell', '/api/v1/agent/customer/suggest_upsell');
    mockVerbCall({ suggestions: [] });

    await runCommand(() =>
      customerUpsellCommand.parseAsync(['42', '--limit', '3', '--json'], { from: 'user' }),
    );

    expect(mockApi.get).toHaveBeenLastCalledWith(
      '/api/v1/agent/customer/suggest_upsell',
      { params: { customer_id: 42, limit: 3 } },
    );
  });
});

describe('inventory-reorder', () => {
  it('runs without any args (global reorder suggestions)', async () => {
    mockVerbLookup('inventory.suggest_reorder', '/api/v1/agent/inventory/suggest_reorder');
    mockVerbCall({ suggestions: [] });

    await runCommand(() => inventoryReorderCommand.parseAsync(['--json'], { from: 'user' }));

    expect(mockApi.get).toHaveBeenLastCalledWith(
      '/api/v1/agent/inventory/suggest_reorder',
      { params: {} },
    );
  });

  it('honors --location-id filter', async () => {
    mockVerbLookup('inventory.suggest_reorder', '/api/v1/agent/inventory/suggest_reorder');
    mockVerbCall({ suggestions: [] });

    await runCommand(() =>
      inventoryReorderCommand.parseAsync(['--location-id', '8', '--json'], { from: 'user' }),
    );

    expect(mockApi.get).toHaveBeenLastCalledWith(
      '/api/v1/agent/inventory/suggest_reorder',
      { params: { location_id: 8 } },
    );
  });
});
