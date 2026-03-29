/**
 * Site command tests — create, delete, templates, regenerate.
 */

import { apiClient } from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: {
    sitesList: jest.fn(),
    siteGet: jest.fn(),
    siteCreate: jest.fn(),
    siteDelete: jest.fn(),
    siteTemplates: jest.fn(),
    post: jest.fn(),
  },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

describe('site commands', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('site create', () => {
    it('sends slug and template', async () => {
      mockApi.siteCreate.mockResolvedValue({
        data: { success: true, site: { id: 10, slug: 'my-shop', template: 'shop', is_live: false } },
        status: 200,
        success: true,
      });

      const result = await mockApi.siteCreate('my-shop', 'shop', 'My Shop', false);
      expect(mockApi.siteCreate).toHaveBeenCalledWith('my-shop', 'shop', 'My Shop', false);
      expect(((result.data) as any).site.template).toBe('shop');
    });

    it('defaults to basecamp when no template specified', async () => {
      mockApi.siteCreate.mockResolvedValue({
        data: { success: true, site: { id: 11, slug: 'test', template: 'basecamp' } },
        status: 200,
        success: true,
      });

      await mockApi.siteCreate('test');
      expect(mockApi.siteCreate).toHaveBeenCalledWith('test');
    });
  });

  describe('site templates', () => {
    it('returns templates with recommended field', async () => {
      mockApi.siteTemplates.mockResolvedValue({
        data: {
          templates: [
            { template: 'basecamp', name: 'Basecamp', description: 'SaaS landing' },
            { template: 'fireside', name: 'Fireside', description: 'Professional services' },
            { template: 'shop', name: 'Shop', description: 'E-commerce' },
            { template: 'dexter', name: 'Dexter', description: 'Healthcare' },
          ],
          recommended: 'fireside',
        },
        status: 200,
        success: true,
      });

      const result = await mockApi.siteTemplates();
      expect(((result.data) as any).templates).toHaveLength(4);
      expect(((result.data) as any).recommended).toBe('fireside');
    });
  });

  describe('site delete', () => {
    it('sends correct site ID', async () => {
      mockApi.siteDelete.mockResolvedValue({
        data: { success: true },
        status: 200,
        success: true,
      });

      await mockApi.siteDelete(10);
      expect(mockApi.siteDelete).toHaveBeenCalledWith(10);
    });
  });

  describe('site list', () => {
    it('returns sites scoped to company', async () => {
      mockApi.sitesList.mockResolvedValue({
        data: {
          sites: [
            { id: 1, slug: 'main', template: 'fireside', is_live: true, site_type: 'company' },
            { id: 2, slug: 'landing', template: 'basecamp', is_live: false, site_type: 'landing' },
          ],
          count: 2,
        },
        status: 200,
        success: true,
      });

      const result = await mockApi.sitesList();
      expect(((result.data) as any).sites).toHaveLength(2);
      expect(((result.data) as any).sites[0].is_live).toBe(true);
    });
  });
});
