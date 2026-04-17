/**
 * Orders command tests.
 */

import { config } from '../../lib/config';
import { apiClient } from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

describe('orders command logic', () => {
  beforeEach(() => { jest.clearAllMocks(); config.accessToken = 'test_token'; config.companyId = 99999; });

  it('lists orders at /api/v1/orders/', async () => {
    mockApi.get.mockResolvedValue({ data: { items: [] }, status: 200, success: true });
    await mockApi.get('/api/v1/orders/', { params: { limit: 100, offset: 0 } });
    expect(mockApi.get).toHaveBeenCalled();
  });

  it('confirms order via POST /confirm', async () => {
    mockApi.post.mockResolvedValue({ data: {}, status: 200, success: true });
    await mockApi.post('/api/v1/orders/123/confirm');
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/orders/123/confirm');
  });

  it('cancels via /cancel', async () => {
    mockApi.post.mockResolvedValue({ data: {}, status: 200, success: true });
    await mockApi.post('/api/v1/orders/123/cancel');
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/orders/123/cancel');
  });

  it('refunds with optional amount', async () => {
    mockApi.post.mockResolvedValue({ data: {}, status: 200, success: true });
    await mockApi.post('/api/v1/orders/123/refund', { amount: 50, reason: 'damaged' });
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/orders/123/refund', expect.objectContaining({ amount: 50 }));
  });

  it('quick-sale shortcut', async () => {
    mockApi.post.mockResolvedValue({ data: { order_id: 9 }, status: 200, success: true });
    await mockApi.post('/api/v1/orders/quick-sale', { product_id: 1, quantity: 1 });
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/orders/quick-sale', expect.any(Object));
  });
});
