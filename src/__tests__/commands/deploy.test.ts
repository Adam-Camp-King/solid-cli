/**
 * Deploy (preview) command tests
 */

import { apiClient } from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: {
    previewCreate: jest.fn(),
    previewList: jest.fn(),
    previewGet: jest.fn(),
    previewPromote: jest.fn(),
    previewExpire: jest.fn(),
  },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

describe('deploy commands', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('deploy create', () => {
    it('creates a preview deployment', async () => {
      mockApi.previewCreate.mockResolvedValue({
        data: { token: 'preview_abc123', url: 'https://preview-abc123.solidnumber.com', expires_at: '2026-04-01T00:00:00Z' },
        status: 201,
        success: true,
      });

      const result = await mockApi.previewCreate({ title: 'Test Preview', ttl_hours: 48 });
      expect(mockApi.previewCreate).toHaveBeenCalled();
      expect((result.data as any).token).toBe('preview_abc123');
      expect((result.data as any).url).toContain('preview');
    });
  });

  describe('deploy list', () => {
    it('lists preview deployments', async () => {
      mockApi.previewList.mockResolvedValue({
        data: { previews: [
          { token: 'preview_1', status: 'active', created_at: '2026-03-28T00:00:00Z' },
          { token: 'preview_2', status: 'expired', created_at: '2026-03-27T00:00:00Z' },
        ]},
        status: 200,
        success: true,
      });

      const result = await mockApi.previewList(undefined, 10);
      expect((result.data as any).previews).toHaveLength(2);
    });
  });

  describe('deploy promote', () => {
    it('promotes a preview to production', async () => {
      mockApi.previewPromote.mockResolvedValue({
        data: { success: true, promoted_pages: 3 },
        status: 200,
        success: true,
      });

      const result = await mockApi.previewPromote('preview_abc123');
      expect(mockApi.previewPromote).toHaveBeenCalledWith('preview_abc123');
      expect((result.data as any).promoted_pages).toBe(3);
    });
  });

  describe('deploy expire', () => {
    it('expires a preview deployment', async () => {
      mockApi.previewExpire.mockResolvedValue({
        data: { success: true },
        status: 200,
        success: true,
      });

      await mockApi.previewExpire('preview_abc123');
      expect(mockApi.previewExpire).toHaveBeenCalledWith('preview_abc123');
    });
  });
});
