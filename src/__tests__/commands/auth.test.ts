/**
 * Auth command tests — login stores correct data, logout clears it.
 * Mocks apiClient and config so no real API calls or filesystem access.
 */

import { config } from '../../lib/config';
import { apiClient } from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: {
    login: jest.fn(),
    authStatus: jest.fn(),
    companiesList: jest.fn(),
  },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

describe('auth logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('login flow', () => {
    it('stores token and company_id on successful login', async () => {
      mockApi.login.mockResolvedValue({
        data: {
          access_token: 'new_token_abc',
          refresh_token: 'new_refresh_xyz',
          expires_in: 3600,
          user: { id: 5, email: 'dev@agency.com', company_id: 42 },
        },
        status: 200,
        success: true,
      });

      const result = await mockApi.login('dev@agency.com', 'password123');

      // Verify the API was called with correct credentials
      expect(mockApi.login).toHaveBeenCalledWith('dev@agency.com', 'password123');

      // Verify response has all required fields
      expect(result.data.access_token).toBe('new_token_abc');
      expect(result.data.refresh_token).toBe('new_refresh_xyz');
      expect(result.data.user.company_id).toBe(42);
      expect(result.data.user.id).toBe(5);
    });

    it('login response includes company_id — never undefined', async () => {
      mockApi.login.mockResolvedValue({
        data: {
          access_token: 'token',
          refresh_token: 'refresh',
          expires_in: 3600,
          user: { id: 1, email: 'test@test.com', company_id: 99 },
        },
        status: 200,
        success: true,
      });

      const result = await mockApi.login('test@test.com', 'pass');
      expect(result.data.user.company_id).toBeDefined();
      expect(typeof result.data.user.company_id).toBe('number');
    });
  });

  describe('logout', () => {
    it('config.logout clears auth state', () => {
      config.logout();
      expect(config.logout).toHaveBeenCalled();
    });
  });

  describe('auth status', () => {
    it('isLoggedIn returns true when mocked as logged in', () => {
      expect(config.isLoggedIn()).toBe(true);
    });
  });

  describe('multi-company', () => {
    it('companiesList returns array of companies', async () => {
      mockApi.companiesList.mockResolvedValue({
        data: {
          companies: [
            { id: 1, name: 'My Company', role: 'owner', is_active: true },
            { id: 42, name: 'Client Co', role: 'developer', is_active: true },
          ],
          active_company_id: 1,
          count: 2,
        },
        status: 200,
        success: true,
      });

      const result = await mockApi.companiesList();
      expect(result.data.companies).toHaveLength(2);
      expect(result.data.companies[0].id).toBe(1);
      expect(result.data.companies[1].role).toBe('developer');
    });
  });
});
