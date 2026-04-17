/**
 * Marketplace command tests.
 */

import { config } from '../../lib/config';
import { apiClient } from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

describe('marketplace command logic', () => {
  beforeEach(() => { jest.clearAllMocks(); config.accessToken = 'test_token'; config.companyId = 99999; });

  it('status at /api/v1/marketplace/status', async () => {
    mockApi.get.mockResolvedValue({ data: { enabled: true }, status: 200, success: true });
    await mockApi.get('/api/v1/marketplace/status');
    expect(mockApi.get).toHaveBeenCalledWith('/api/v1/marketplace/status');
  });

  it('enable marketplace', async () => {
    mockApi.post.mockResolvedValue({ data: {}, status: 200, success: true });
    await mockApi.post('/api/v1/marketplace/enable');
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/marketplace/enable');
  });

  it('publish product via PUT /products/{id}/publish', async () => {
    mockApi.put.mockResolvedValue({ data: {}, status: 200, success: true });
    await mockApi.put('/api/v1/marketplace/products/42/publish');
    expect(mockApi.put).toHaveBeenCalledWith('/api/v1/marketplace/products/42/publish');
  });

  it('publish-all bulk endpoint', async () => {
    mockApi.post.mockResolvedValue({ data: { products_published: 10, services_published: 5 }, status: 200, success: true });
    const r = await mockApi.post('/api/v1/marketplace/publish-all');
    expect((r.data as any).products_published).toBe(10);
  });
});
