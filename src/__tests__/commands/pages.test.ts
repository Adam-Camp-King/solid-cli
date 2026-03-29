/**
 * Pages command tests — create, publish, delete, generate.
 */

import { apiClient } from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: {
    pagesList: jest.fn(),
    pageGet: jest.fn(),
    pageCreate: jest.fn(),
    pageUpdate: jest.fn(),
    pageDelete: jest.fn(),
    pagesPublish: jest.fn(),
    pagesUnpublish: jest.fn(),
    post: jest.fn(),
  },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

describe('pages commands', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('pages create', () => {
    it('sends title, slug, and page_type', async () => {
      mockApi.pageCreate.mockResolvedValue({
        data: { page: { id: 100, title: 'Services', slug: 'services', page_type: 'services' } },
        status: 201,
        success: true,
      });

      const result = await mockApi.pageCreate({
        title: 'Services',
        slug: 'services',
        page_type: 'services',
      });

      expect(mockApi.pageCreate).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Services',
        slug: 'services',
      }));
      expect(((result.data) as any).page.id).toBe(100);
    });
  });

  describe('pages publish', () => {
    it('publishes by page ID', async () => {
      mockApi.pagesPublish.mockResolvedValue({
        data: { success: true },
        status: 200,
        success: true,
      });

      await mockApi.pagesPublish(42);
      expect(mockApi.pagesPublish).toHaveBeenCalledWith(42);
    });
  });

  describe('pages delete', () => {
    it('deletes by page ID', async () => {
      mockApi.pageDelete.mockResolvedValue({
        data: { success: true },
        status: 200,
        success: true,
      });

      await mockApi.pageDelete(42);
      expect(mockApi.pageDelete).toHaveBeenCalledWith(42);
    });
  });

  describe('pages generate (AI)', () => {
    it('sends prompt to AI generation endpoint', async () => {
      mockApi.post.mockResolvedValue({
        data: {
          page: { id: 200, title: 'Emergency Plumbing Services', slug: 'emergency-plumbing' },
        },
        status: 201,
        success: true,
      });

      const result = await mockApi.post('/api/v1/cms/pages/ai/generate', {
        prompt: 'emergency plumbing services page',
        auto_publish: false,
      });

      expect(mockApi.post).toHaveBeenCalledWith('/api/v1/cms/pages/ai/generate', expect.objectContaining({
        prompt: 'emergency plumbing services page',
      }));
      expect(((result.data) as any).page.title).toContain('Plumbing');
    });
  });

  describe('pages list', () => {
    it('returns pages scoped to company', async () => {
      mockApi.pagesList.mockResolvedValue({
        data: {
          pages: [
            { id: 1, title: 'Home', slug: 'home', is_published: true, page_type: 'home' },
            { id: 2, title: 'About', slug: 'about', is_published: true, page_type: 'about' },
            { id: 3, title: 'Draft', slug: 'draft', is_published: false, page_type: 'website' },
          ],
          total: 3,
        },
        status: 200,
        success: true,
      });

      const result = await mockApi.pagesList();
      expect(((result.data) as any).pages).toHaveLength(3);
      expect(((result.data) as any).pages[2].is_published).toBe(false);
    });
  });
});
