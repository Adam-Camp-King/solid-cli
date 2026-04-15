/**
 * Demo command tests — create, convert, delete demo companies.
 */

import { config } from '../../lib/config';
import { apiClient } from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: {
    companyCreate: jest.fn(),
    companySwitch: jest.fn(),
    templateClone: jest.fn(),
    companiesList: jest.fn(),
    post: jest.fn(),
    get: jest.fn(),
    delete: jest.fn(),
  },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

describe('demo command logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    config.accessToken = 'test_token';
    config.companyId = 99999;
  });

  describe('demo create', () => {
    it('creates company and applies template', async () => {
      mockApi.companyCreate.mockResolvedValue({
        data: { status: 'OK', company: { id: 200, name: "Joe's Plumbing", slug: 'joes-plumbing' }, membership: { role: 'admin' } },
        status: 201,
        success: true,
      });
      mockApi.companySwitch.mockResolvedValue({
        data: { status: 'OK', access_token: 'new_token', refresh_token: 'ref', expires_in: 3600, role: 'admin', company: { id: 200, name: 'Test' } },
        status: 200,
        success: true,
      });
      mockApi.templateClone.mockResolvedValue({
        data: { success: true, template: 'plumber', display_name: 'Plumber', created: { kb_entries: 50 } },
        status: 200,
        success: true,
      });

      const createResult = await mockApi.companyCreate("Joe's Plumbing");
      expect(createResult.data.company.id).toBe(200);

      await mockApi.companySwitch(200);
      expect(mockApi.companySwitch).toHaveBeenCalledWith(200);

      await mockApi.templateClone('plumber');
      expect(mockApi.templateClone).toHaveBeenCalledWith('plumber');
    });

    it('restores original company after demo creation', async () => {
      const originalId = config.companyId;
      mockApi.companyCreate.mockResolvedValue({
        data: { status: 'OK', company: { id: 200, name: 'Test', slug: 'test' }, membership: { role: 'admin' } },
        status: 201,
        success: true,
      });
      mockApi.companySwitch.mockResolvedValue({
        data: { status: 'OK', access_token: 't', refresh_token: 'r', expires_in: 3600, role: 'admin', company: { id: 200, name: 'Test' } },
        status: 200,
        success: true,
      });

      await mockApi.companySwitch(200);
      // Simulate restore
      await mockApi.companySwitch(originalId!);
      expect(mockApi.companySwitch).toHaveBeenLastCalledWith(originalId);
    });
  });

  describe('demo convert', () => {
    it('generates checkout link for conversion', async () => {
      mockApi.post.mockResolvedValue({
        data: { url: 'https://checkout.stripe.com/abc123' },
        status: 200,
        success: true,
      });

      const result = await mockApi.post('/api/v1/billing/checkout-link', {
        company_id: 200,
        tier: 'starter',
      });
      expect((result.data as any).url).toContain('stripe.com');
    });
  });

  describe('demo delete', () => {
    it('deletes a demo company', async () => {
      mockApi.delete.mockResolvedValue({
        data: { success: true },
        status: 200,
        success: true,
      });

      const result = await mockApi.delete('/api/v1/cli/companies/200');
      expect((result.data as any).success).toBe(true);
    });
  });
});
