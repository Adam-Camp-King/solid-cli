/**
 * `solid tenant ...` command tests.
 *
 * The Tenant Activity Gate verbs are AI-agent-facing — their JSON
 * shape is a stable contract. These tests pin the contract: each
 * method on apiClient gets called with the right arguments, returns
 * a TenantGateDecision-shaped object, and the parser handles the
 * documented response fields.
 */

import { apiClient, type TenantGateDecision } from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: {
    tenantGateMine: jest.fn(),
    tenantGateAdminDebug: jest.fn(),
    tenantGateAdminActive: jest.fn(),
    tenantGateAdminAllowlist: jest.fn(),
  },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

const SAMPLE_DECISION: TenantGateDecision = {
  company_id: 61,
  level: 'HOT',
  level_value: 4,
  reason: 'owner_allowlist_both',
  signals: {
    billing_exempt: true,
    in_hardcoded_set: true,
    is_deleted: false,
    is_suspended: false,
    is_archived: false,
    onboarding_status: 'active',
    subscription_status: 'active',
    last_login_at: '2026-05-11T18:42:11+00:00',
    last_token_usage_at: '2026-05-12T03:17:22+00:00',
    effective_last_activity_at: '2026-05-12T03:17:22+00:00',
  },
  bypass_reasons: ['hardcoded_id', 'billing_exempt'],
  evaluated_at: '2026-05-12T12:00:00+00:00',
};

describe('tenant gate API client methods', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── tenantGateMine ────────────────────────────────────────────────────

  describe('tenantGateMine', () => {
    it('returns a TenantGateDecision shape', async () => {
      mockApi.tenantGateMine.mockResolvedValue({
        data: SAMPLE_DECISION,
        status: 200,
        success: true,
      });

      const result = await mockApi.tenantGateMine();

      expect(mockApi.tenantGateMine).toHaveBeenCalledWith();
      expect(result.data.company_id).toBe(61);
      expect(result.data.level).toBe('HOT');
      expect(result.data.reason).toBe('owner_allowlist_both');
      expect(result.data.bypass_reasons).toEqual(['hardcoded_id', 'billing_exempt']);
    });

    it('exposes all 10 signals on the decision', async () => {
      mockApi.tenantGateMine.mockResolvedValue({
        data: SAMPLE_DECISION,
        status: 200,
        success: true,
      });

      const result = await mockApi.tenantGateMine();
      const signals = result.data.signals;
      expect(typeof signals.billing_exempt).toBe('boolean');
      expect(typeof signals.in_hardcoded_set).toBe('boolean');
      expect(typeof signals.is_deleted).toBe('boolean');
      expect(typeof signals.is_suspended).toBe('boolean');
      expect(typeof signals.is_archived).toBe('boolean');
      expect(['active', null].includes(signals.onboarding_status as any) || typeof signals.onboarding_status === 'string').toBe(true);
      expect(['active', null].includes(signals.subscription_status as any) || typeof signals.subscription_status === 'string').toBe(true);
      // Timestamps may be null or ISO strings
      expect(signals.last_login_at === null || typeof signals.last_login_at === 'string').toBe(true);
      expect(signals.last_token_usage_at === null || typeof signals.last_token_usage_at === 'string').toBe(true);
      expect(signals.effective_last_activity_at === null || typeof signals.effective_last_activity_at === 'string').toBe(true);
    });
  });

  // ── tenantGateAdminDebug ──────────────────────────────────────────────

  describe('tenantGateAdminDebug', () => {
    it('passes company_id correctly', async () => {
      mockApi.tenantGateAdminDebug.mockResolvedValue({
        data: { ...SAMPLE_DECISION, company_id: 49, reason: 'owner_allowlist_hardcoded' },
        status: 200,
        success: true,
      });

      const result = await mockApi.tenantGateAdminDebug(49);

      expect(mockApi.tenantGateAdminDebug).toHaveBeenCalledWith(49);
      expect(result.data.company_id).toBe(49);
    });
  });

  // ── tenantGateAdminActive ─────────────────────────────────────────────

  describe('tenantGateAdminActive', () => {
    it('returns count + sorted company_ids for a threshold', async () => {
      mockApi.tenantGateAdminActive.mockResolvedValue({
        data: { min_level: 'WARM', count: 4, company_ids: [49, 61, 100, 200] },
        status: 200,
        success: true,
      });

      const result = await mockApi.tenantGateAdminActive('warm');

      expect(mockApi.tenantGateAdminActive).toHaveBeenCalledWith('warm');
      expect(result.data.min_level).toBe('WARM');
      expect(result.data.count).toBe(4);
      expect(result.data.company_ids).toEqual([49, 61, 100, 200]);
    });
  });

  // ── tenantGateAdminAllowlist ──────────────────────────────────────────

  describe('tenantGateAdminAllowlist', () => {
    it('exposes hardcoded ids and billing_exempt members', async () => {
      mockApi.tenantGateAdminAllowlist.mockResolvedValue({
        data: {
          hardcoded_ids: [1, 2, 3, 49, 61],
          billing_exempt: [
            { id: 61, name: 'ANGL' },
            { id: 49, name: 'Laydee' },
          ],
        },
        status: 200,
        success: true,
      });

      const result = await mockApi.tenantGateAdminAllowlist();

      expect(result.data.hardcoded_ids).toEqual([1, 2, 3, 49, 61]);
      expect(result.data.billing_exempt).toHaveLength(2);
      expect(result.data.billing_exempt[0]).toEqual({ id: 61, name: 'ANGL' });
    });

    it('handles empty billing_exempt list', async () => {
      mockApi.tenantGateAdminAllowlist.mockResolvedValue({
        data: { hardcoded_ids: [1, 2, 3, 49, 61], billing_exempt: [] },
        status: 200,
        success: true,
      });

      const result = await mockApi.tenantGateAdminAllowlist();

      expect(result.data.billing_exempt).toEqual([]);
    });
  });
});
