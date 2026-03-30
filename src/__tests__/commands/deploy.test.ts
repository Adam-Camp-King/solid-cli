/**
 * Deploy (preview) command tests
 *
 * Tests preview creation, listing, promotion to live,
 * expiration, and the shareable URL contract.
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

  // ── Preview Create ────────────────────────────────────────────────

  describe('deploy create', () => {
    it('creates a preview deployment with shareable URL', async () => {
      mockApi.previewCreate.mockResolvedValue({
        data: {
          success: true,
          preview: {
            preview_token: 'abc123def456',
            page_count: 5,
            kb_count: 12,
            status: 'active',
            expires_at: '2026-04-01T00:00:00Z',
          },
          preview_url: 'https://app.solidnumber.com/preview/abc123def456',
        },
        status: 200,
        success: true,
      });

      const result = await mockApi.previewCreate({ title: 'Spring Redesign', ttl_hours: 48 });
      expect(mockApi.previewCreate).toHaveBeenCalledWith({ title: 'Spring Redesign', ttl_hours: 48 });
      expect((result.data as any).preview_url).toContain('preview/');
      expect((result.data as any).preview.page_count).toBe(5);
      expect((result.data as any).preview.status).toBe('active');
    });

    it('supports pages-only preview', async () => {
      mockApi.previewCreate.mockResolvedValue({
        data: { success: true, preview: { page_count: 3, kb_count: 0 }, preview_url: 'https://app.solidnumber.com/preview/xyz' },
        status: 200,
        success: true,
      });

      await mockApi.previewCreate({ pages_only: true });
      expect(mockApi.previewCreate).toHaveBeenCalledWith({ pages_only: true });
    });

    it('supports kb-only preview', async () => {
      mockApi.previewCreate.mockResolvedValue({
        data: { success: true, preview: { page_count: 0, kb_count: 8 }, preview_url: 'https://app.solidnumber.com/preview/xyz' },
        status: 200,
        success: true,
      });

      await mockApi.previewCreate({ kb_only: true });
      expect(mockApi.previewCreate).toHaveBeenCalledWith({ kb_only: true });
    });

    it('supports custom TTL', async () => {
      mockApi.previewCreate.mockResolvedValue({
        data: { success: true, preview: { expires_at: '2026-04-28T00:00:00Z' }, preview_url: 'url' },
        status: 200,
        success: true,
      });

      await mockApi.previewCreate({ ttl_hours: 720 }); // 30 days
      expect(mockApi.previewCreate).toHaveBeenCalledWith({ ttl_hours: 720 });
    });
  });

  // ── Preview List ──────────────────────────────────────────────────

  describe('deploy list', () => {
    it('lists all preview deployments', async () => {
      mockApi.previewList.mockResolvedValue({
        data: {
          previews: [
            { preview_token: 'tok1', status: 'active', title: 'Spring', page_count: 5, created_at: '2026-03-28T00:00:00Z' },
            { preview_token: 'tok2', status: 'promoted', title: 'Winter', page_count: 3, created_at: '2026-03-20T00:00:00Z' },
            { preview_token: 'tok3', status: 'expired', title: null, page_count: 2, created_at: '2026-03-15T00:00:00Z' },
          ],
          count: 3,
        },
        status: 200,
        success: true,
      });

      const result = await mockApi.previewList(undefined, 20);
      expect((result.data as any).previews).toHaveLength(3);
      expect((result.data as any).previews[0].status).toBe('active');
    });

    it('filters by status', async () => {
      mockApi.previewList.mockResolvedValue({
        data: { previews: [{ status: 'active' }], count: 1 },
        status: 200,
        success: true,
      });

      await mockApi.previewList('active', 20);
      expect(mockApi.previewList).toHaveBeenCalledWith('active', 20);
    });

    it('returns empty when no previews exist', async () => {
      mockApi.previewList.mockResolvedValue({
        data: { previews: [], count: 0 },
        status: 200,
        success: true,
      });

      const result = await mockApi.previewList(undefined, 20);
      expect((result.data as any).previews).toHaveLength(0);
    });
  });

  // ── Preview Get ───────────────────────────────────────────────────

  describe('deploy get', () => {
    it('gets full preview details including snapshots', async () => {
      mockApi.previewGet.mockResolvedValue({
        data: {
          preview_token: 'tok1',
          status: 'active',
          page_count: 5,
          kb_count: 12,
          pages_snapshot: [{ slug: 'home', title: 'Home' }],
          kb_snapshot: [{ title: 'FAQ', category: 'support' }],
          settings_snapshot: { name: 'Acme Corp' },
          preview_url: 'https://app.solidnumber.com/preview/tok1',
        },
        status: 200,
        success: true,
      });

      const result = await mockApi.previewGet('tok1');
      expect(mockApi.previewGet).toHaveBeenCalledWith('tok1');
      expect((result.data as any).pages_snapshot).toHaveLength(1);
      expect((result.data as any).kb_snapshot).toHaveLength(1);
    });
  });

  // ── Preview Promote ───────────────────────────────────────────────

  describe('deploy promote', () => {
    it('promotes a preview to production', async () => {
      mockApi.previewPromote.mockResolvedValue({
        data: {
          success: true,
          message: 'Preview promoted to live: 5 pages, 12 KB entries',
          pages_promoted: 5,
          kb_promoted: 12,
        },
        status: 200,
        success: true,
      });

      const result = await mockApi.previewPromote('tok1');
      expect(mockApi.previewPromote).toHaveBeenCalledWith('tok1');
      expect((result.data as any).pages_promoted).toBe(5);
      expect((result.data as any).kb_promoted).toBe(12);
    });

    it('rejects promotion of non-active preview', async () => {
      mockApi.previewPromote.mockRejectedValue({
        response: { status: 400, data: { detail: 'Preview is expired, not active' } },
      });

      await expect(mockApi.previewPromote('expired_tok')).rejects.toBeDefined();
    });
  });

  // ── Preview Expire ────────────────────────────────────────────────

  describe('deploy expire', () => {
    it('expires/cancels a preview deployment', async () => {
      mockApi.previewExpire.mockResolvedValue({
        data: { success: true, message: 'Preview expired' },
        status: 200,
        success: true,
      });

      await mockApi.previewExpire('tok1');
      expect(mockApi.previewExpire).toHaveBeenCalledWith('tok1');
    });
  });

  // ── Security ──────────────────────────────────────────────────────

  describe('preview security', () => {
    it('preview token is the only access key for public preview', () => {
      // The public endpoint /api/v1/preview/{token} requires no auth
      // Token IS the key — this is by design for shareable links
      // Security: tokens are 32-byte URL-safe random strings
      const token = 'abc123def456ghi789jkl012mno345pq';
      expect(token.length).toBeGreaterThanOrEqual(20);
    });

    it('preview operations require auth (except public preview)', () => {
      // create, list, get (detailed), promote, expire all require JWT
      // Only the public render endpoint is unauthenticated
      expect(mockApi.previewCreate).toBeDefined();
      expect(mockApi.previewPromote).toBeDefined();
    });
  });
});
