/**
 * History + Rollback command tests
 */

import { apiClient } from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: {
    historyPages: jest.fn(),
    historyKB: jest.fn(),
    historyPageVersion: jest.fn(),
    rollbackPage: jest.fn(),
    rollbackKB: jest.fn(),
  },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

describe('history commands', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('history pages', () => {
    it('fetches page version history', async () => {
      mockApi.historyPages.mockResolvedValue({
        data: { versions: [
          { version: 3, title: 'Home v3', updated_at: '2026-03-28T00:00:00Z', updated_by: 'admin' },
          { version: 2, title: 'Home v2', updated_at: '2026-03-27T00:00:00Z', updated_by: 'admin' },
        ]},
        status: 200,
        success: true,
      });

      const result = await mockApi.historyPages('home', 10);
      expect(mockApi.historyPages).toHaveBeenCalledWith('home', 10);
      expect((result.data as any).versions).toHaveLength(2);
    });
  });

  describe('history KB', () => {
    it('fetches KB entry history', async () => {
      mockApi.historyKB.mockResolvedValue({
        data: { versions: [{ version: 1, title: 'FAQ', updated_at: '2026-03-28T00:00:00Z' }] },
        status: 200,
        success: true,
      });

      const result = await mockApi.historyKB(42, 10);
      expect(mockApi.historyKB).toHaveBeenCalledWith(42, 10);
      expect((result.data as any).versions).toHaveLength(1);
    });
  });

  describe('rollback', () => {
    it('rolls back a page to a specific version', async () => {
      mockApi.rollbackPage.mockResolvedValue({
        data: { success: true, restored_version: 2 },
        status: 200,
        success: true,
      });

      const result = await mockApi.rollbackPage('home', 2);
      expect(mockApi.rollbackPage).toHaveBeenCalledWith('home', 2);
      expect((result.data as any).restored_version).toBe(2);
    });

    it('rolls back a KB entry to a specific version', async () => {
      mockApi.rollbackKB.mockResolvedValue({
        data: { success: true, restored_version: 1 },
        status: 200,
        success: true,
      });

      const result = await mockApi.rollbackKB(42, 1);
      expect(mockApi.rollbackKB).toHaveBeenCalledWith(42, 1);
      expect((result.data as any).restored_version).toBe(1);
    });
  });
});
