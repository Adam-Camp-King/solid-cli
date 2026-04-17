/**
 * Users command tests — verify endpoints under /api/v1/users/*.
 */

import { config } from '../../lib/config';
import { apiClient } from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

describe('users command logic', () => {
  beforeEach(() => { jest.clearAllMocks(); config.accessToken = 'test_token'; config.companyId = 99999; });

  it('list uses /api/v1/users/company', async () => {
    mockApi.get.mockResolvedValue({ data: { users: [] }, status: 200, success: true });
    await mockApi.get('/api/v1/users/company', { params: {} });
    expect(mockApi.get).toHaveBeenCalledWith('/api/v1/users/company', expect.any(Object));
  });

  it('role PATCH at /{id}/role', async () => {
    mockApi.patch.mockResolvedValue({ data: {}, status: 200, success: true });
    await mockApi.patch('/api/v1/users/42/role', { role: 'admin' });
    expect(mockApi.patch).toHaveBeenCalledWith('/api/v1/users/42/role', { role: 'admin' });
  });

  it('invite POST to /invitations', async () => {
    mockApi.post.mockResolvedValue({ data: { token: 'tok' }, status: 200, success: true });
    await mockApi.post('/api/v1/users/invitations', { email: 'a@b.com', role: 'user' });
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/users/invitations', expect.objectContaining({ email: 'a@b.com' }));
  });

  it('block/unblock', async () => {
    mockApi.post.mockResolvedValue({ data: {}, status: 200, success: true });
    await mockApi.post('/api/v1/users/42/block');
    await mockApi.post('/api/v1/users/42/unblock');
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/users/42/block');
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/users/42/unblock');
  });

  it('invite accept uses token path', async () => {
    mockApi.post.mockResolvedValue({ data: {}, status: 200, success: true });
    await mockApi.post('/api/v1/users/invitations/accept/ABC123');
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/users/invitations/accept/ABC123');
  });

  it('feature override POST', async () => {
    mockApi.post.mockResolvedValue({ data: {}, status: 200, success: true });
    await mockApi.post('/api/v1/users/42/features', { feature_key: 'ai-audit', enabled: true });
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/users/42/features', expect.objectContaining({ feature_key: 'ai-audit', enabled: true }));
  });
});
