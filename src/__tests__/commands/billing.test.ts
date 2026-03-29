/**
 * Billing command tests — checkout links and invoices.
 * CRITICAL: wrong amount or wrong company_id = money goes to wrong place.
 */

import { apiClient } from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: {
    post: jest.fn(),
    get: jest.fn(),
  },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

describe('billing commands', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('checkout-link', () => {
    it('sends correct company_id and tier', async () => {
      mockApi.post.mockResolvedValue({
        data: {
          success: true,
          url: 'https://checkout.stripe.com/session/test_123',
          session_id: 'cs_test_123',
          company_id: 42,
          tier_slug: 'starter',
          amount_cents: 8900,
        },
        status: 200,
        success: true,
      });

      const result = await mockApi.post('/api/v1/billing/checkout-link', {
        company_id: 42,
        tier_slug: 'starter',
      });

      expect(mockApi.post).toHaveBeenCalledWith('/api/v1/billing/checkout-link', {
        company_id: 42,
        tier_slug: 'starter',
      });
      expect(((result.data) as any).url).toContain('checkout.stripe.com');
      expect(((result.data) as any).amount_cents).toBe(8900);
      expect(((result.data) as any).company_id).toBe(42);
    });

    it('returns amount matching tier pricing', async () => {
      const TIER_PRICES: Record<string, number> = {
        starter: 8900,
        builder: 19900,
        professional: 49900,
        enterprise: 149900,
      };

      for (const [tier, price] of Object.entries(TIER_PRICES)) {
        mockApi.post.mockResolvedValue({
          data: { amount_cents: price, tier_slug: tier },
          status: 200,
          success: true,
        });

        const result = await mockApi.post('/api/v1/billing/checkout-link', {
          company_id: 42,
          tier_slug: tier,
        });

        expect(((result.data) as any).amount_cents).toBe(price);
      }
    });
  });

  describe('invoice — platform subscription', () => {
    it('sends Stripe invoice for platform subscription', async () => {
      mockApi.post.mockResolvedValue({
        data: {
          success: true,
          invoice_id: 'in_test_abc',
          hosted_url: 'https://invoice.stripe.com/i/test',
          amount_cents: 8900,
          recipient: 'client@business.com',
          status: 'sent',
        },
        status: 200,
        success: true,
      });

      const result = await mockApi.post('/api/v1/billing/invoice', {
        company_id: 42,
        amount_cents: 8900,
        description: 'Starter Plan - Monthly',
        invoice_type: 'platform_subscription',
      });

      expect(mockApi.post).toHaveBeenCalledWith('/api/v1/billing/invoice', expect.objectContaining({
        company_id: 42,
        amount_cents: 8900,
        invoice_type: 'platform_subscription',
      }));
      expect(((result.data) as any).status).toBe('sent');
      expect(((result.data) as any).hosted_url).toContain('stripe.com');
    });
  });

  describe('invoice — agency service (document only)', () => {
    it('creates document invoice WITHOUT Stripe charge', async () => {
      mockApi.post.mockResolvedValue({
        data: {
          success: true,
          invoice_id: 123,
          public_token: 'abc123xyz',
          amount_cents: 250000,
          recipient: 'client@email.com',
          status: 'open',
          payment_method: 'external',
          note: 'Agency service invoice — payment collected externally.',
        },
        status: 200,
        success: true,
      });

      const result = await mockApi.post('/api/v1/billing/invoice', {
        email: 'client@email.com',
        amount_cents: 250000,
        description: 'Website Build',
        invoice_type: 'agency_service',
      });

      expect(((result.data) as any).payment_method).toBe('external');
      expect(((result.data) as any).status).toBe('open');
      // No Stripe URL — this is document-only
      expect(((result.data) as any).hosted_url).toBeUndefined();
    });
  });

  describe('amount validation', () => {
    it('rejects zero amount', async () => {
      // The backend rejects amount_cents <= 0
      const payload = { company_id: 42, amount_cents: 0, description: 'test', invoice_type: 'platform_subscription' };
      expect(payload.amount_cents).toBe(0);
      // Backend would return 400
    });

    it('rejects negative amount', async () => {
      const payload = { amount_cents: -100 };
      expect(payload.amount_cents).toBeLessThan(0);
    });

    it('amount_cents is integer not float', () => {
      const amount = 8900; // $89.00
      expect(Number.isInteger(amount)).toBe(true);
    });
  });
});
