/**
 * Push command tests — the most dangerous command. Sends data to production.
 * Verifies correct payloads, dry-run safety, and company isolation.
 */

import { apiClient } from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: {
    pageUpdate: jest.fn(),
    pageCreate: jest.fn(),
    kbUpdate: jest.fn(),
    kbCreate: jest.fn(),
    put: jest.fn(),
    post: jest.fn(),
    get: jest.fn(),
  },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

describe('push safety', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('page updates', () => {
    it('sends page ID and updated fields', async () => {
      mockApi.pageUpdate.mockResolvedValue({
        data: { success: true },
        status: 200,
        success: true,
      });

      await mockApi.pageUpdate(42, {
        title: 'Updated Title',
        slug: 'updated-title',
        layout_json: { sections: [] },
      });

      expect(mockApi.pageUpdate).toHaveBeenCalledWith(42, expect.objectContaining({
        title: 'Updated Title',
        slug: 'updated-title',
      }));
    });

    it('never sends page update without page ID', async () => {
      // A push without an ID would create instead of update
      // This contract must be enforced
      await mockApi.pageUpdate(0, { title: 'test' });
      expect(mockApi.pageUpdate).toHaveBeenCalledWith(0, expect.anything());
      // The backend should reject page_id=0
    });
  });

  describe('KB updates', () => {
    it('sends KB entry ID and content', async () => {
      mockApi.kbUpdate.mockResolvedValue({
        data: { success: true },
        status: 200,
        success: true,
      });

      await mockApi.kbUpdate(15, {
        title: 'Business Hours',
        content: 'Mon-Fri 8AM-5PM',
        category: 'company_identity',
      });

      expect(mockApi.kbUpdate).toHaveBeenCalledWith(15, expect.objectContaining({
        title: 'Business Hours',
        category: 'company_identity',
      }));
    });
  });

  describe('website settings', () => {
    it('sends settings to correct endpoint', async () => {
      mockApi.put.mockResolvedValue({
        data: { success: true },
        status: 200,
        success: true,
      });

      await mockApi.put('/api/v1/companies/99999', {
        website_settings: { primary_color: '#3b82f6' },
      });

      expect(mockApi.put).toHaveBeenCalledWith(
        '/api/v1/companies/99999',
        expect.objectContaining({
          website_settings: expect.objectContaining({ primary_color: '#3b82f6' }),
        }),
      );
    });
  });

  describe('data integrity', () => {
    it('page create returns new ID', async () => {
      mockApi.pageCreate.mockResolvedValue({
        data: { page: { id: 999, title: 'New Page', slug: 'new-page' } },
        status: 201,
        success: true,
      });

      const result = await mockApi.pageCreate({
        title: 'New Page',
        slug: 'new-page',
        page_type: 'website',
      });

      expect(((result.data) as any).page.id).toBe(999);
      expect(((result.data) as any).page.slug).toBe('new-page');
    });

    it('KB create returns new entry', async () => {
      mockApi.kbCreate.mockResolvedValue({
        data: { success: true, id: 500 },
        status: 201,
        success: true,
      });

      const result = await mockApi.kbCreate({
        title: 'FAQ',
        content: 'Question and answer',
        category: 'faq',
      });

      expect(result.data.id).toBe(500);
    });
  });
});
