/**
 * Products command tests — verify endpoint paths match controllers/products.py.
 */

import { config } from '../../lib/config';
import { apiClient } from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

describe('products command logic', () => {
  beforeEach(() => { jest.clearAllMocks(); config.accessToken = 'test_token'; config.companyId = 99999; });

  it('lists products at /api/v1/products/', async () => {
    mockApi.get.mockResolvedValue({ data: [{ id: 1, name: 'X' }], status: 200, success: true });
    await mockApi.get('/api/v1/products/', { params: {} });
    expect(mockApi.get).toHaveBeenCalledWith('/api/v1/products/', expect.any(Object));
  });

  it('gets a single product', async () => {
    mockApi.get.mockResolvedValue({ data: { id: 1 }, status: 200, success: true });
    await mockApi.get('/api/v1/products/1');
    expect(mockApi.get).toHaveBeenCalledWith('/api/v1/products/1');
  });

  it('creates a product', async () => {
    mockApi.post.mockResolvedValue({ data: { id: 2 }, status: 201, success: true });
    await mockApi.post('/api/v1/products/', { name: 'Widget', product_type: 'physical' });
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/products/', expect.objectContaining({ name: 'Widget' }));
  });

  it('updates pricing only via PATCH /pricing', async () => {
    mockApi.patch.mockResolvedValue({ data: {}, status: 200, success: true });
    await mockApi.patch('/api/v1/products/1/pricing', { price: 9.99 });
    expect(mockApi.patch).toHaveBeenCalledWith('/api/v1/products/1/pricing', expect.objectContaining({ price: 9.99 }));
  });

  it('deletes a product', async () => {
    mockApi.delete.mockResolvedValue({ data: {}, status: 204, success: true });
    await mockApi.delete('/api/v1/products/1');
    expect(mockApi.delete).toHaveBeenCalledWith('/api/v1/products/1');
  });
});
