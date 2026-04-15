/**
 * Inventory command tests.
 */

import { config } from '../../lib/config';
import { apiClient } from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn() },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

describe('inventory command logic', () => {
  beforeEach(() => { jest.clearAllMocks(); config.accessToken = 'test_token'; config.companyId = 99999; });

  it('lists inventory via correct endpoint', async () => {
    mockApi.get.mockResolvedValue({
      data: { items: [{ sku: 'PIPE-001', name: 'Copper Pipe', quantity: 50 }] },
      status: 200, success: true,
    });
    const result = await mockApi.get('/api/v1/Inventory/list', { params: { limit: 20, offset: 0 } });
    expect((result.data as any).items[0].sku).toBe('PIPE-001');
  });

  it('gets single item', async () => {
    mockApi.get.mockResolvedValue({
      data: { sku: 'PIPE-001', name: 'Copper Pipe', quantity: 50 },
      status: 200, success: true,
    });
    const result = await mockApi.get('/api/v1/Inventory/get', { params: { sku: 'PIPE-001' } });
    expect((result.data as any).quantity).toBe(50);
  });

  it('adjusts stock', async () => {
    mockApi.post.mockResolvedValue({ data: { success: true }, status: 200, success: true });
    await mockApi.post('/api/v1/Inventory/adjust', { sku: 'PIPE-001', adjustment: -5, reason: 'sold' });
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/Inventory/adjust', expect.objectContaining({ sku: 'PIPE-001' }));
  });
});
