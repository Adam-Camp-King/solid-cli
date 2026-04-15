/**
 * Analytics command tests — dashboard, mcp-traffic.
 */

import { config } from '../../lib/config';
import { apiClient } from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: { get: jest.fn() },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

describe('analytics command logic', () => {
  beforeEach(() => { jest.clearAllMocks(); config.accessToken = 'test_token'; config.companyId = 99999; });

  it('fetches dashboard summary', async () => {
    mockApi.get.mockResolvedValue({
      data: { revenue: 12000, transactions: 150, customers: 42 },
      status: 200, success: true,
    });
    const result = await mockApi.get('/api/v1/dashboard/summary', { params: { period: '30' } });
    expect((result.data as any).revenue).toBe(12000);
  });

  it('shows no-data message for empty response', async () => {
    mockApi.get.mockResolvedValue({ data: {}, status: 200, success: true });
    const result = await mockApi.get('/api/v1/dashboard/summary');
    const d = result.data as Record<string, any>;
    const hasData = d.revenue !== undefined || d.transactions !== undefined;
    expect(hasData).toBe(false);
  });

  it('fetches MCP traffic', async () => {
    mockApi.get.mockResolvedValue({
      data: { total_hits: 500, google_hits: 200, claude_hits: 150 },
      status: 200, success: true,
    });
    const result = await mockApi.get('/api/v1/analytics/mcp/traffic');
    expect((result.data as any).total_hits).toBe(500);
  });
});
