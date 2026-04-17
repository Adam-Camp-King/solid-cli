/**
 * Storage command tests — verify endpoints under /api/v1/storage/*.
 */

import { config } from '../../lib/config';
import { apiClient } from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

describe('storage command logic', () => {
  beforeEach(() => { jest.clearAllMocks(); config.accessToken = 'test_token'; config.companyId = 99999; });

  it('usage endpoint', async () => {
    mockApi.get.mockResolvedValue({ data: { used_mb: 12, quota_mb: 1024 }, status: 200, success: true });
    await mockApi.get('/api/v1/storage/usage');
    expect(mockApi.get).toHaveBeenCalledWith('/api/v1/storage/usage');
  });

  it('list documents with optional folder filter', async () => {
    mockApi.get.mockResolvedValue({ data: [], status: 200, success: true });
    await mockApi.get('/api/v1/storage/documents', { params: { limit: 100, folder_id: 3 } });
    expect(mockApi.get).toHaveBeenCalledWith('/api/v1/storage/documents', expect.objectContaining({ params: expect.objectContaining({ folder_id: 3 }) }));
  });

  it('download returns signed URL', async () => {
    mockApi.get.mockResolvedValue({ data: { url: 'https://bucket/...' }, status: 200, success: true });
    const r = await mockApi.get('/api/v1/storage/documents/9/download');
    expect((r.data as any).url).toContain('https://');
  });

  it('delete doc', async () => {
    mockApi.delete.mockResolvedValue({ data: {}, status: 200, success: true });
    await mockApi.delete('/api/v1/storage/documents/9');
    expect(mockApi.delete).toHaveBeenCalledWith('/api/v1/storage/documents/9');
  });

  it('create folder POSTs /folders', async () => {
    mockApi.post.mockResolvedValue({ data: { id: 11 }, status: 200, success: true });
    await mockApi.post('/api/v1/storage/folders', { name: 'Contracts' });
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/storage/folders', expect.objectContaining({ name: 'Contracts' }));
  });

  it('star uses /files/{id}/star', async () => {
    mockApi.post.mockResolvedValue({ data: {}, status: 200, success: true });
    await mockApi.post('/api/v1/storage/files/22/star');
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/storage/files/22/star');
  });

  it('pack activate', async () => {
    mockApi.post.mockResolvedValue({ data: {}, status: 200, success: true });
    await mockApi.post('/api/v1/storage/packs/activate', { pack_id: 'starter' });
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/storage/packs/activate', expect.objectContaining({ pack_id: 'starter' }));
  });
});
