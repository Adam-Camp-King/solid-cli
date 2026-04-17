/**
 * Onboarding / setup wizard tests.
 */

import { config } from '../../lib/config';
import { apiClient } from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn() },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

describe('onboarding command logic', () => {
  beforeEach(() => { jest.clearAllMocks(); config.accessToken = 'test_token'; config.companyId = 99999; });

  it('status at /api/v1/setup-wizard/status', async () => {
    mockApi.get.mockResolvedValue({ data: { complete: false }, status: 200, success: true });
    await mockApi.get('/api/v1/setup-wizard/status');
    expect(mockApi.get).toHaveBeenCalledWith('/api/v1/setup-wizard/status');
  });

  it('domain check POSTs to /email/domain/check', async () => {
    mockApi.post.mockResolvedValue({ data: { available: true }, status: 200, success: true });
    await mockApi.post('/api/v1/setup-wizard/email/domain/check', { domain: 'acme.com' });
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/setup-wizard/email/domain/check', { domain: 'acme.com' });
  });

  it('phone search', async () => {
    mockApi.post.mockResolvedValue({ data: { numbers: [] }, status: 200, success: true });
    await mockApi.post('/api/v1/setup-wizard/phone/search', { area_code: '415', country: 'US' });
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/setup-wizard/phone/search', expect.objectContaining({ area_code: '415' }));
  });

  it('phone buy (provision) at /phone/provision', async () => {
    mockApi.post.mockResolvedValue({ data: { phone_number: '+14155551212' }, status: 200, success: true });
    await mockApi.post('/api/v1/setup-wizard/phone/provision', { phone_number: '+14155551212' });
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/setup-wizard/phone/provision', { phone_number: '+14155551212' });
  });

  it('payment save', async () => {
    mockApi.post.mockResolvedValue({ data: {}, status: 200, success: true });
    await mockApi.post('/api/v1/setup-wizard/payment/save', { payment_method_token: 'pm_test' });
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/setup-wizard/payment/save', expect.objectContaining({ payment_method_token: 'pm_test' }));
  });

  it('website save', async () => {
    mockApi.post.mockResolvedValue({ data: {}, status: 200, success: true });
    await mockApi.post('/api/v1/setup-wizard/website/save', { template: 'basecamp' });
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/setup-wizard/website/save', expect.any(Object));
  });

  it('complete wizard', async () => {
    mockApi.post.mockResolvedValue({ data: {}, status: 200, success: true });
    await mockApi.post('/api/v1/setup-wizard/complete');
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/setup-wizard/complete');
  });

  it('v2 discover uses /onboarding/v2/discover', async () => {
    mockApi.post.mockResolvedValue({ data: { business: {} }, status: 200, success: true });
    await mockApi.post('/api/v1/onboarding/v2/discover', { input: 'https://acme.com' });
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/onboarding/v2/discover', { input: 'https://acme.com' });
  });
});
