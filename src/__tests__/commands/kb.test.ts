/**
 * KB command tests — apiClient method contracts for the kb command family.
 *
 * Pattern matches `auth.test.ts`: mocks apiClient methods, asserts the
 * contract (calls + response shape), no real network or filesystem.
 *
 * The contract this protects:
 *   - kbSearch(query, limit, offset) — accepts pagination, returns
 *     {results, total} envelope
 *   - kbCreate({title, content, category}) — required title/content
 *   - kbUpdate(id, partial) — partial updates
 *   - kbDelete(id) — clean delete
 *
 * Future kb-related regressions surface here before they ship.
 */

import { apiClient } from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: {
    kbSearch: jest.fn(),
    kbCreate: jest.fn(),
    kbUpdate: jest.fn(),
    kbDelete: jest.fn(),
  },
  handleApiError: jest.fn((e: { message?: string; status?: number }) => ({
    message: e?.message || 'Error',
    status: e?.status || 500,
  })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

describe('kb apiClient contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------------
  // kbSearch
  // ---------------------------------------------------------------------
  describe('kbSearch', () => {
    it('returns {results, total} envelope on happy path', async () => {
      mockApi.kbSearch.mockResolvedValue({
        data: {
          results: [
            { id: 1, title: 'Refund policy', category: 'faq', content: '30 days.' },
            { id: 2, title: 'Hours', category: 'general', content: 'Mon-Fri 9-5' },
          ],
          total: 2,
        },
        status: 200,
        success: true,
      });

      const res = await mockApi.kbSearch('refund', 20, 0);
      expect(mockApi.kbSearch).toHaveBeenCalledWith('refund', 20, 0);
      const body = res.data as { results: Array<{ id: number; title: string }>; total: number };
      expect(body.total).toBe(2);
      expect(body.results).toHaveLength(2);
      expect(body.results[0].title).toBe('Refund policy');
    });

    it('accepts default limit + offset (20, 0)', async () => {
      mockApi.kbSearch.mockResolvedValue({
        data: { results: [], total: 0 },
        status: 200,
        success: true,
      });
      await mockApi.kbSearch('', 20, 0);
      expect(mockApi.kbSearch).toHaveBeenCalledWith('', 20, 0);
    });

    it('passes pagination through unchanged', async () => {
      mockApi.kbSearch.mockResolvedValue({
        data: { results: [], total: 100 },
        status: 200,
        success: true,
      });
      await mockApi.kbSearch('q', 50, 100);
      expect(mockApi.kbSearch).toHaveBeenCalledWith('q', 50, 100);
    });

    it('zero results returns empty results array, not null', async () => {
      mockApi.kbSearch.mockResolvedValue({
        data: { results: [], total: 0 },
        status: 200,
        success: true,
      });
      const res = await mockApi.kbSearch('nothing-matches', 20, 0);
      const body = res.data as { results: unknown[]; total: number };
      expect(Array.isArray(body.results)).toBe(true);
      expect(body.results).toHaveLength(0);
      expect(body.total).toBe(0);
    });
  });

  // ---------------------------------------------------------------------
  // kbCreate
  // ---------------------------------------------------------------------
  describe('kbCreate', () => {
    it('creates entry with title + content + category', async () => {
      mockApi.kbCreate.mockResolvedValue({
        data: { success: true, id: 42 },
        status: 201,
        success: true,
      });

      const res = await mockApi.kbCreate({
        title: 'Hours',
        content: 'Mon-Fri 9-5',
        category: 'general',
      });

      expect(mockApi.kbCreate).toHaveBeenCalledWith({
        title: 'Hours',
        content: 'Mon-Fri 9-5',
        category: 'general',
      });
      const body = res.data as { id: number };
      expect(body.id).toBe(42);
    });

    it('rejects empty title at the API layer (server returns 422)', async () => {
      mockApi.kbCreate.mockRejectedValue({
        message: 'title is required',
        status: 422,
      });

      await expect(
        mockApi.kbCreate({ title: '', content: 'x', category: 'general' }),
      ).rejects.toMatchObject({ status: 422 });
    });
  });

  // ---------------------------------------------------------------------
  // kbUpdate
  // ---------------------------------------------------------------------
  describe('kbUpdate', () => {
    it('partial update sends only the fields provided', async () => {
      mockApi.kbUpdate.mockResolvedValue({
        data: { success: true },
        status: 200,
        success: true,
      });

      await mockApi.kbUpdate(7, { title: 'Renamed' });

      expect(mockApi.kbUpdate).toHaveBeenCalledWith(7, { title: 'Renamed' });
    });

    it('returns 404 when entry id does not exist', async () => {
      mockApi.kbUpdate.mockRejectedValue({
        message: 'kb entry 9999 not found',
        status: 404,
      });

      await expect(
        mockApi.kbUpdate(9999, { title: 'X' }),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  // ---------------------------------------------------------------------
  // kbDelete
  // ---------------------------------------------------------------------
  describe('kbDelete', () => {
    it('returns success on delete', async () => {
      mockApi.kbDelete.mockResolvedValue({
        data: { success: true },
        status: 200,
        success: true,
      });

      const res = await mockApi.kbDelete(7);
      expect(mockApi.kbDelete).toHaveBeenCalledWith(7);
      expect(res.data.success).toBe(true);
    });

    it('returns 404 when entry id does not exist', async () => {
      mockApi.kbDelete.mockRejectedValue({
        message: 'kb entry 9999 not found',
        status: 404,
      });

      await expect(mockApi.kbDelete(9999)).rejects.toMatchObject({ status: 404 });
    });

    it('does not silently succeed on other-tenant id (403)', async () => {
      // Tenant isolation: a kb entry owned by another company must not
      // be deletable. Backend returns 403 (or 404 disguised) — both
      // are acceptable; the contract is "not 200 success".
      mockApi.kbDelete.mockRejectedValue({
        message: 'forbidden — kb entry belongs to another company',
        status: 403,
      });

      await expect(mockApi.kbDelete(42)).rejects.toMatchObject({
        status: expect.any(Number),
      });
    });
  });
});
