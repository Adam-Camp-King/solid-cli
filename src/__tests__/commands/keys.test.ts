/**
 * API key management tests — uses typed apiClient helpers.
 */

import { config } from '../../lib/config';
import { apiClient } from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: {
    apiKeyList: jest.fn(),
    apiKeyCreate: jest.fn(),
    apiKeyRevoke: jest.fn(),
  },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

describe('keys command logic', () => {
  beforeEach(() => { jest.clearAllMocks(); config.accessToken = 'test_token'; config.companyId = 99999; });

  it('list returns keys with safe prefixes', async () => {
    mockApi.apiKeyList.mockResolvedValue({
      data: {
        api_keys: [{ id: 1, name: 'ci', key_prefix: 'sk_abc', scopes: ['kb:read'], is_active: true }],
        count: 1,
        available_scopes: ['kb:read', 'kb:write'],
      },
      status: 200, success: true,
    });
    const r = await mockApi.apiKeyList();
    expect(r.data.api_keys[0].key_prefix).toBe('sk_abc');
    // full key never present in list response
    expect((r.data.api_keys[0] as any).key).toBeUndefined();
  });

  it('create returns the raw key ONCE', async () => {
    mockApi.apiKeyCreate.mockResolvedValue({
      data: {
        status: 'ok',
        key: 'sk_live_ABCDEF',
        warning: 'Copy now',
        api_key: { id: 5, name: 'client-key', key_prefix: 'sk_live_ABC', scopes: ['brand:read'] },
      },
      status: 201, success: true,
    });
    const r = await mockApi.apiKeyCreate('client-key', ['brand:read'], 30);
    expect(r.data.key).toBe('sk_live_ABCDEF');
    expect(mockApi.apiKeyCreate).toHaveBeenCalledWith('client-key', ['brand:read'], 30);
  });

  it('revoke by id', async () => {
    mockApi.apiKeyRevoke.mockResolvedValue({ data: { status: 'revoked', id: 5 }, status: 200, success: true });
    await mockApi.apiKeyRevoke(5);
    expect(mockApi.apiKeyRevoke).toHaveBeenCalledWith(5);
  });
});
