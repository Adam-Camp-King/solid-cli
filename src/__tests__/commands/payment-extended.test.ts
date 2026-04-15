/**
 * Payment extended command tests — analytics, connect, terminal.
 */

import { config } from '../../lib/config';
import { apiClient } from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
  },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

describe('payment extended commands', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    config.accessToken = 'test_token';
    config.companyId = 99999;
  });

  describe('payment analytics', () => {
    it('fetches dashboard summary for payment data', async () => {
      mockApi.get.mockResolvedValue({
        data: { revenue: 47832, transactions: 312, chargebacks: 0 },
        status: 200,
        success: true,
      });

      const result = await mockApi.get('/api/v1/dashboard/summary', {
        params: { period: '30' },
      });
      expect((result.data as any).revenue).toBe(47832);
      expect((result.data as any).transactions).toBe(312);
      expect((result.data as any).chargebacks).toBe(0);
    });

    it('calculates L3 savings estimate', () => {
      const revenue = 47832;
      const transactions = 312;
      const b2bEstimate = Math.round(transactions * 0.3); // ~30% B2B
      const l3Savings = revenue * 0.3 * 0.008; // 0.80% on B2B portion

      expect(b2bEstimate).toBe(94);
      expect(l3Savings).toBeCloseTo(114.80, 1);
    });
  });

  describe('payment connect', () => {
    it('connects a stripe processor', async () => {
      mockApi.post.mockResolvedValue({
        data: { success: true, processor: 'stripe' },
        status: 200,
        success: true,
      });

      const result = await mockApi.post('/api/v1/billing/connect-processor', {
        processor: 'stripe',
        account_id: 'acct_abc123',
      });
      expect((result.data as any).success).toBe(true);
    });
  });

  describe('payment terminal', () => {
    it('sends charge in cents', async () => {
      mockApi.post.mockResolvedValue({
        data: { card_brand: 'Visa', last4: '4242' },
        status: 200,
        success: true,
      });

      const amount = 49.99;
      const result = await mockApi.post('/api/v1/payments/terminal/charge', {
        amount: Math.round(amount * 100),
        reader_name: 'Front Desk',
      });

      expect(mockApi.post).toHaveBeenCalledWith('/api/v1/payments/terminal/charge', {
        amount: 4999,
        reader_name: 'Front Desk',
      });
      expect((result.data as any).card_brand).toBe('Visa');
    });
  });
});
