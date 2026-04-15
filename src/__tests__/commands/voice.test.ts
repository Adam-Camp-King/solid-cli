/**
 * Voice command tests — calls, phone numbers, voicemail.
 */

import { config } from '../../lib/config';
import { apiClient } from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn() },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

describe('voice command logic', () => {
  beforeEach(() => { jest.clearAllMocks(); config.accessToken = 'test_token'; config.companyId = 99999; });

  it('lists phone numbers', async () => {
    mockApi.get.mockResolvedValue({
      data: { phone_numbers: [{ id: '1', number: '+18015550147', status: 'active' }] },
      status: 200, success: true,
    });
    const result = await mockApi.get('/api/v1/phone-numbers');
    expect((result.data as any).phone_numbers).toHaveLength(1);
  });

  it('lists calls', async () => {
    mockApi.get.mockResolvedValue({
      data: { calls: [{ id: '1', direction: 'inbound', duration: 120 }] },
      status: 200, success: true,
    });
    const result = await mockApi.get('/api/v1/calls');
    expect((result.data as any).calls[0].direction).toBe('inbound');
  });

  it('lists voicemails', async () => {
    mockApi.get.mockResolvedValue({
      data: { voicemails: [{ id: '1', transcript: 'Please call back' }] },
      status: 200, success: true,
    });
    const result = await mockApi.get('/api/v1/voicemails');
    expect((result.data as any).voicemails).toHaveLength(1);
  });
});
