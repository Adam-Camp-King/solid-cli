/**
 * E-commerce command tests — verify endpoints under /api/v1/crm/ecommerce/*.
 */

import { config } from '../../lib/config';
import { apiClient } from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

describe('ecommerce command logic', () => {
  beforeEach(() => { jest.clearAllMocks(); config.accessToken = 'test_token'; config.companyId = 99999; });

  it('cart active GET passes company_id', async () => {
    mockApi.get.mockResolvedValue({ data: {}, status: 200, success: true });
    await mockApi.get('/api/v1/crm/ecommerce/carts/active', { params: { company_id: 99999 } });
    expect(mockApi.get).toHaveBeenCalledWith('/api/v1/crm/ecommerce/carts/active', expect.objectContaining({ params: expect.objectContaining({ company_id: 99999 }) }));
  });

  it('add to cart POSTs to /cart/{id}/items', async () => {
    mockApi.post.mockResolvedValue({ data: {}, status: 200, success: true });
    await mockApi.post('/api/v1/crm/ecommerce/cart/5/items', { company_id: 99999, product_id: 1, quantity: 2 });
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/crm/ecommerce/cart/5/items', expect.objectContaining({ product_id: 1 }));
  });

  it('order status PUT', async () => {
    mockApi.put.mockResolvedValue({ data: {}, status: 200, success: true });
    await mockApi.put('/api/v1/crm/ecommerce/orders/9/status', { status: 'shipped' });
    expect(mockApi.put).toHaveBeenCalledWith('/api/v1/crm/ecommerce/orders/9/status', { status: 'shipped' });
  });

  it('reviews moderate via PUT /reviews/{id}/moderate', async () => {
    mockApi.put.mockResolvedValue({ data: {}, status: 200, success: true });
    await mockApi.put('/api/v1/crm/ecommerce/reviews/7/moderate', { status: 'approved' });
    expect(mockApi.put).toHaveBeenCalledWith('/api/v1/crm/ecommerce/reviews/7/moderate', { status: 'approved' });
  });

  it('abandoned-carts stats', async () => {
    mockApi.get.mockResolvedValue({ data: { total_count: 0 }, status: 200, success: true });
    await mockApi.get('/api/v1/crm/ecommerce/abandoned-carts/stats');
    expect(mockApi.get).toHaveBeenCalledWith('/api/v1/crm/ecommerce/abandoned-carts/stats');
  });

  it('shipping rates POST with destination', async () => {
    mockApi.post.mockResolvedValue({ data: { rates: [] }, status: 200, success: true });
    await mockApi.post('/api/v1/crm/ecommerce/shipping/rates', { postal_code: '94105', country: 'US' });
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/crm/ecommerce/shipping/rates', expect.objectContaining({ postal_code: '94105' }));
  });
});
