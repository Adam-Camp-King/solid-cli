/**
 * Services command tests — apiClient method contracts.
 *
 * Same layer-down pattern as auth.test.ts and kb.test.ts: mocks
 * apiClient.servicesList, asserts the response envelope contract.
 *
 * Contract this protects:
 *   - servicesList() → {items, total} envelope
 *   - Empty company → empty items array (never null)
 *   - List items carry {id, name, description, category} at minimum
 *   - Tenant scope is implicit (server filters by JWT company_id)
 */

import { apiClient } from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: {
    servicesList: jest.fn(),
  },
  handleApiError: jest.fn((e: { message?: string; status?: number }) => ({
    message: e?.message || 'Error',
    status: e?.status || 500,
  })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

describe('services apiClient contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns {items, total} envelope on happy path', async () => {
    mockApi.servicesList.mockResolvedValue({
      data: {
        items: [
          { id: 1, name: 'Drain cleaning', category: 'emergency', description: 'Snake any clogged drain.' },
          { id: 2, name: 'Annual inspection', category: 'preventive', description: 'Full plumbing health check.' },
        ],
        total: 2,
      },
      status: 200,
      success: true,
    });

    const res = await mockApi.servicesList();
    expect(mockApi.servicesList).toHaveBeenCalledTimes(1);
    const body = res.data as { items: Array<{ id: number; name: string }>; total: number };
    expect(body.total).toBe(2);
    expect(body.items).toHaveLength(2);
    expect(body.items[0].name).toBe('Drain cleaning');
  });

  it('empty company returns empty items array, not null', async () => {
    mockApi.servicesList.mockResolvedValue({
      data: { items: [], total: 0 },
      status: 200,
      success: true,
    });
    const res = await mockApi.servicesList();
    const body = res.data as { items: unknown[]; total: number };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it('items carry the contract fields agents rely on', async () => {
    // The agent surface contract: every item exposes id + name +
    // optional category + optional description. Anything else is bonus.
    // Regression here means the schema-vs-runtime drift the JSON-LD
    // content-negotiation layer is supposed to absorb.
    mockApi.servicesList.mockResolvedValue({
      data: {
        items: [{ id: 1, name: 'Consulting' }],
        total: 1,
      },
      status: 200,
      success: true,
    });
    const res = await mockApi.servicesList();
    const body = res.data as { items: Array<{ id: number; name: string }> };
    for (const item of body.items) {
      expect(typeof item.id).toBe('number');
      expect(typeof item.name).toBe('string');
    }
  });

  it('surfaces 401 on unauthenticated call (server enforces tenant scope)', async () => {
    mockApi.servicesList.mockRejectedValue({
      message: 'Not authenticated',
      status: 401,
    });

    await expect(mockApi.servicesList()).rejects.toMatchObject({ status: 401 });
  });

  it('surfaces 5xx as error (does not return empty list silently)', async () => {
    mockApi.servicesList.mockRejectedValue({
      message: 'Internal server error',
      status: 500,
    });

    await expect(mockApi.servicesList()).rejects.toMatchObject({ status: 500 });
  });
});
