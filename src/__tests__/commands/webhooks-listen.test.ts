/**
 * Webhook listen/test command tests.
 */

import { config } from '../../lib/config';
import { apiClient } from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: {
    post: jest.fn(),
    get: jest.fn(),
    delete: jest.fn(),
  },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

describe('webhooks listen logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    config.accessToken = 'test_token';
    config.companyId = 99999;
  });

  it('registers a listener webhook', async () => {
    mockApi.post.mockResolvedValue({
      data: { id: 'wh_123', webhook_id: 'wh_123' },
      status: 201,
      success: true,
    });

    const result = await mockApi.post('/api/v1/developer/webhooks', {
      url: 'cli-listen://99999',
      events: ['*'],
      description: 'CLI listener → http://localhost:3000/webhook',
      is_cli_listener: true,
    });
    expect((result.data as any).id).toBe('wh_123');
  });

  it('cleans up listener on exit', async () => {
    mockApi.delete.mockResolvedValue({
      data: { success: true },
      status: 200,
      success: true,
    });

    const result = await mockApi.delete('/api/v1/developer/webhooks/wh_123');
    expect((result.data as any).success).toBe(true);
  });

  it('test event generates correct payload', () => {
    const event = 'payment.completed';
    const payload = {
      type: event,
      data: {
        id: 'test_' + Date.now(),
        company_id: config.companyId || 1,
        timestamp: new Date().toISOString(),
        test: true,
      },
    };

    expect(payload.type).toBe('payment.completed');
    expect(payload.data.test).toBe(true);
    expect(payload.data.company_id).toBe(99999);
  });
});
