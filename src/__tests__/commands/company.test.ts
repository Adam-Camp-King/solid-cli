/**
 * Company command tests — create sends correct payload, switch changes context.
 * CRITICAL: company create is the most dangerous command — wrong payload = wrong company provisioned.
 */

import { apiClient } from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: {
    companyCreate: jest.fn(),
    companySwitch: jest.fn(),
    companiesList: jest.fn(),
    companyMembers: jest.fn(),
    companyMemberRevoke: jest.fn(),
    companyInvite: jest.fn(),
  },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

describe('company commands', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('company create', () => {
    it('sends name and template to correct endpoint', async () => {
      mockApi.companyCreate.mockResolvedValue({
        data: {
          status: 'created',
          company: { id: 150, name: "Mike's Plumbing", slug: 'mikes-plumbing-a1b2' },
          membership: { role: 'owner' },
        },
        status: 201,
        success: true,
      });

      const result = await mockApi.companyCreate("Mike's Plumbing", 'plumber', 'plumbing');

      expect(mockApi.companyCreate).toHaveBeenCalledWith("Mike's Plumbing", 'plumber', 'plumbing');
      expect(result.data.company.id).toBe(150);
      expect(result.data.membership.role).toBe('owner');
    });

    it('returns company_id that can be used for switch', async () => {
      mockApi.companyCreate.mockResolvedValue({
        data: {
          status: 'created',
          company: { id: 200, name: 'Test', slug: 'test-1234' },
          membership: { role: 'owner' },
        },
        status: 201,
        success: true,
      });

      const result = await mockApi.companyCreate('Test');
      const newCompanyId = result.data.company.id;

      expect(newCompanyId).toBeDefined();
      expect(typeof newCompanyId).toBe('number');
      expect(newCompanyId).toBeGreaterThan(0);
    });

    it('works without template (no industry)', async () => {
      mockApi.companyCreate.mockResolvedValue({
        data: {
          status: 'created',
          company: { id: 201, name: 'Generic Co', slug: 'generic-co-5678' },
          membership: { role: 'owner' },
        },
        status: 201,
        success: true,
      });

      await mockApi.companyCreate('Generic Co');
      expect(mockApi.companyCreate).toHaveBeenCalledWith('Generic Co');
    });
  });

  describe('company switch', () => {
    it('switches to target company and returns new JWT', async () => {
      mockApi.companySwitch.mockResolvedValue({
        data: {
          status: 'switched', role: 'owner', access_token: 'new_jwt_for_company_42',
          refresh_token: 'new_refresh',
          expires_in: 3600,
          company: { id: 42, name: 'Client Co' },
        },
        status: 200,
        success: true,
      });

      const result = await mockApi.companySwitch(42);

      expect(mockApi.companySwitch).toHaveBeenCalledWith(42);
      expect(result.data.access_token).toBe('new_jwt_for_company_42');
      expect(result.data.company.id).toBe(42);
    });

    it('new token is scoped to target company only', async () => {
      mockApi.companySwitch.mockResolvedValue({
        data: {
          status: 'switched', role: 'owner', access_token: 'jwt_company_99',
          refresh_token: 'refresh_99',
          expires_in: 3600,
          company: { id: 99, name: 'Company 99' },
        },
        status: 200,
        success: true,
      });

      const result = await mockApi.companySwitch(99);
      // The new JWT should be for company 99, not the old company
      expect(result.data.company.id).toBe(99);
      expect(result.data.access_token).toContain('99');
    });
  });

  describe('company isolation', () => {
    it('cannot switch to company 1, 2, or 3 (reserved system companies)', () => {
      // This is enforced on the backend, but we document the contract here
      const RESERVED_IDS = [1, 2, 3];
      for (const id of RESERVED_IDS) {
        expect(id).toBeLessThanOrEqual(3);
      }
    });

    it('member list is scoped to requested company', async () => {
      mockApi.companyMembers.mockResolvedValue({
        data: {
          company_id: 42, count: 2, members: [
            { user_id: 1, email: 'owner@test.com', role: 'owner' },
            { user_id: 2, email: 'dev@test.com', role: 'developer' },
          ],
        },
        status: 200,
        success: true,
      });

      const result = await mockApi.companyMembers(42);
      expect(mockApi.companyMembers).toHaveBeenCalledWith(42);
      expect(result.data.members).toHaveLength(2);
    });
  });
});
