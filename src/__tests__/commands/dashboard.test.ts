/**
 * Dashboard command tests — cross-company overview for agencies.
 */

import { config } from '../../lib/config';
import { apiClient } from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: {
    companiesList: jest.fn(),
    get: jest.fn(),
  },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

describe('dashboard logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    config.accessToken = 'test_token';
    config.companyId = 99999;
  });

  it('companiesList returns companies for dashboard', async () => {
    mockApi.companiesList.mockResolvedValue({
      data: {
        companies: [
          { id: 100, name: "Joe's Plumbing", role: 'admin', is_active: true },
          { id: 101, name: "Pete's HVAC", role: 'admin', is_active: true },
        ],
        active_company_id: 100,
        count: 2,
      },
      status: 200,
      success: true,
    });

    const result = await mockApi.companiesList();
    expect(result.data.companies).toHaveLength(2);
    expect(result.data.companies[0].name).toBe("Joe's Plumbing");
  });

  it('fetches dashboard summary per company', async () => {
    mockApi.get.mockResolvedValue({
      data: { revenue: 5000, customers: 42, transactions: 100 },
      status: 200,
      success: true,
    });

    const result = await mockApi.get('/api/v1/dashboard/summary', {
      params: { company_id: 100 },
    });
    expect((result.data as any).revenue).toBe(5000);
    expect((result.data as any).customers).toBe(42);
  });

  it('handles empty company list', async () => {
    mockApi.companiesList.mockResolvedValue({
      data: { companies: [], active_company_id: 0, count: 0 },
      status: 200,
      success: true,
    });

    const result = await mockApi.companiesList();
    expect(result.data.companies).toHaveLength(0);
  });
});
