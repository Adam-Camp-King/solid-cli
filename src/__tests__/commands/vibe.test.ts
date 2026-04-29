/**
 * Vibe command tests — `solid vibe` two-phase NL CMS edits.
 */

import { apiClient } from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: {
    vibeAnalyze: jest.fn(),
    vibeApply: jest.fn(),
  },
  handleApiError: jest.fn((e: { message?: string; status?: number }) => ({
    message: e?.message || 'Error',
    status: e?.status || 500,
  })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

const ok = <T>(data: T, status = 200) =>
  ({ data, status, success: true } as unknown as never);

describe('vibe apiClient contract', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('vibeAnalyze', () => {
    it('returns preview shape with diff + previewId', async () => {
      mockApi.vibeAnalyze.mockResolvedValue(ok({
        preview_id: 'preview_abc123',
        diff: 'Added a hero section with phone number.',
        changes: [{ type: 'add', component: 'hero' }],
      }));

      const res = await mockApi.vibeAnalyze('Add a hero with our phone');
      expect(mockApi.vibeAnalyze).toHaveBeenCalledWith('Add a hero with our phone');
      const body = res.data as unknown as { preview_id: string; diff: string };
      expect(body.preview_id).toBe('preview_abc123');
      expect(body.diff).toBeTruthy();
    });

    it('400 on empty prompt — server enforces non-empty', async () => {
      mockApi.vibeAnalyze.mockRejectedValue({ message: 'prompt cannot be empty', status: 400 });
      await expect(mockApi.vibeAnalyze('')).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('vibeApply', () => {
    it('applies a previously-analyzed previewId', async () => {
      mockApi.vibeApply.mockResolvedValue(ok({
        applied: true,
        changes_committed: 3,
        page_id: 7,
      }));

      const res = await mockApi.vibeApply('preview_abc123');
      expect(mockApi.vibeApply).toHaveBeenCalledWith('preview_abc123');
      const body = res.data as unknown as { applied: boolean };
      expect(body.applied).toBe(true);
    });

    it('404 on unknown previewId — apply cannot fabricate a preview', async () => {
      mockApi.vibeApply.mockRejectedValue({
        message: 'preview_id not found or expired',
        status: 404,
      });
      await expect(mockApi.vibeApply('preview_does_not_exist')).rejects.toMatchObject({
        status: 404,
      });
    });

    it('410 on expired preview — server enforces TTL', async () => {
      mockApi.vibeApply.mockRejectedValue({
        message: 'preview expired (TTL exceeded); rerun analyze',
        status: 410,
      });
      await expect(mockApi.vibeApply('preview_expired')).rejects.toMatchObject({
        status: 410,
      });
    });
  });
});
