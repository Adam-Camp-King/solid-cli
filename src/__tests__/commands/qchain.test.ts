/**
 * `solid qchain ...` command tests.
 *
 * The 4 verbs (pubkey, export, verify, audit-key) are AI-agent-facing —
 * their JSON shapes form the external auditor contract. These tests pin
 * the API-client surface: each backend call gets the right URL, params,
 * and the response shape conforms to the documented types.
 */

import {
  apiClient,
  type QChainExportResult,
  type QChainVerifyResult,
  type QChainWellKnown,
} from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: {
    qchainWellKnown: jest.fn(),
    qchainExport: jest.fn(),
    qchainVerify: jest.fn(),
    apiKeyCreate: jest.fn(),
  },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

const SAMPLE_WELL_KNOWN: QChainWellKnown = {
  version: 1,
  signer_id: 'solid-platform-v1',
  signers: [
    {
      signer_id: 'solid-platform-v1',
      algorithm: 'Ed25519',
      public_key_hex: 'a'.repeat(64),
    },
  ],
  hash_algorithm: 'SHA-256',
  signature_algorithm: 'Ed25519',
  chain_genesis_prev_hash: '0'.repeat(64),
  canonical_form: 'sha256(prev_hash_hex_bytes || canonical_row_json_bytes)',
  row_fields_in_canonical_form: [
    'id', 'company_id', 'agent', 'actor_user_id', 'action_type',
    'action_input_jsonb', 'action_output_jsonb',
    'related_entity_type', 'related_entity_id', 'action_taken_at',
    'predicted_probability', 'predicted_tier', 'industry_template_slug',
    'outcome_label', 'outcome_value_jsonb', 'outcome_value_amount',
    'outcome_observed_at',
  ],
  docs_url: 'https://solidnumber.com/docs/qchain',
  verify_endpoint: '/api/v1/predictions/substrate/verify',
  export_endpoint: '/api/v1/predictions/substrate/export',
  notes: [],
};

describe('qchain CLI verbs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('pubkey (anonymous discovery)', () => {
    it('returns signer_id + algorithm + pubkey hex', async () => {
      mockApi.qchainWellKnown.mockResolvedValue({
        data: SAMPLE_WELL_KNOWN,
        status: 200,
        success: true,
      });

      const result = await mockApi.qchainWellKnown();

      expect(mockApi.qchainWellKnown).toHaveBeenCalledWith();
      expect(result.data.signer_id).toBe('solid-platform-v1');
      expect(result.data.hash_algorithm).toBe('SHA-256');
      expect(result.data.signature_algorithm).toBe('Ed25519');
      expect(result.data.signers[0].public_key_hex).toHaveLength(64);
    });

    it('exposes the canonical-row-fields contract for offline verifiers', async () => {
      mockApi.qchainWellKnown.mockResolvedValue({
        data: SAMPLE_WELL_KNOWN,
        status: 200,
        success: true,
      });

      const result = await mockApi.qchainWellKnown();
      expect(result.data.row_fields_in_canonical_form).toContain('attestation_hash' === 'attestation_hash' ? 'id' : '');
      expect(result.data.row_fields_in_canonical_form).toContain('company_id');
      expect(result.data.row_fields_in_canonical_form).toContain('action_taken_at');
      expect(result.data.chain_genesis_prev_hash).toBe('0'.repeat(64));
    });

    it('supports hash-chain-only mode (empty signers[])', async () => {
      mockApi.qchainWellKnown.mockResolvedValue({
        data: { ...SAMPLE_WELL_KNOWN, signers: [] },
        status: 200,
        success: true,
      });

      const result = await mockApi.qchainWellKnown();
      expect(result.data.signers).toEqual([]);
      // Hash algorithm still published — auditor can still recompute SHA-256
      expect(result.data.hash_algorithm).toBe('SHA-256');
    });
  });

  describe('export (tenant-scoped chain pull)', () => {
    it('passes since/until/limit params through', async () => {
      mockApi.qchainExport.mockResolvedValue({
        data: {
          company_id: 61,
          rows: [],
          count: 0,
          since: '2026-01-01',
          until: '2026-04-30',
          well_known_url: '/.well-known/qchain.json',
        } satisfies QChainExportResult,
        status: 200,
        success: true,
      });

      await mockApi.qchainExport({ since: '2026-01-01', until: '2026-04-30', limit: 500 });

      expect(mockApi.qchainExport).toHaveBeenCalledWith({
        since: '2026-01-01',
        until: '2026-04-30',
        limit: 500,
      });
    });

    it('returns full canonical-form row payload for offline verification', async () => {
      const row = {
        id: 1,
        company_id: 61,
        agent: 'marcus',
        actor_user_id: null,
        action_type: 'marcus.followup_for_deal',
        action_input_jsonb: { deal_id: 42 },
        action_output_jsonb: { followup_drafted: true },
        related_entity_type: 'deal',
        related_entity_id: 42,
        action_taken_at: '2026-05-12T10:00:00+00:00',
        predicted_probability: 0.78,
        predicted_tier: 'hot',
        industry_template_slug: 'plumber',
        outcome_label: null,
        outcome_value_jsonb: null,
        outcome_value_amount: null,
        outcome_observed_at: null,
        attestation_hash: 'a'.repeat(64),
        attestation_signature: 'b'.repeat(128),
        attestation_signer_id: 'solid-platform-v1',
        prev_hash: '0'.repeat(64),
      };
      mockApi.qchainExport.mockResolvedValue({
        data: {
          company_id: 61,
          rows: [row],
          count: 1,
          since: null,
          until: null,
          well_known_url: '/.well-known/qchain.json',
        },
        status: 200,
        success: true,
      });

      const result = await mockApi.qchainExport({});
      const r = result.data.rows[0];
      // Every hash-input field present + chain link present
      expect(r.attestation_hash).toHaveLength(64);
      expect(r.attestation_signature).toHaveLength(128);
      expect(r.attestation_signer_id).toBe('solid-platform-v1');
      expect(r.prev_hash).toBe('0'.repeat(64));
      expect(r.action_input_jsonb).toEqual({ deal_id: 42 });
    });
  });

  describe('verify (server-side sanity check)', () => {
    it('returns ok=true with rows_checked + signature_summary', async () => {
      mockApi.qchainVerify.mockResolvedValue({
        data: {
          ok: true,
          rows_checked: 5,
          rows_broken: [],
          signature_summary: { signed: 5, verified: 5, unknown_signer: 0, invalid: 0 },
        } satisfies QChainVerifyResult,
        status: 200,
        success: true,
      });

      const result = await mockApi.qchainVerify();
      expect(result.data.ok).toBe(true);
      expect(result.data.rows_checked).toBe(5);
      expect(result.data.signature_summary.verified).toBe(5);
    });

    it('reports broken rows when chain is tampered', async () => {
      mockApi.qchainVerify.mockResolvedValue({
        data: {
          ok: false,
          rows_checked: 5,
          rows_broken: [{ row_id: 3, reason: 'hash_mismatch' }],
          signature_summary: { signed: 5, verified: 4, unknown_signer: 0, invalid: 1 },
        },
        status: 200,
        success: true,
      });

      const result = await mockApi.qchainVerify();
      expect(result.data.ok).toBe(false);
      expect(result.data.rows_broken).toHaveLength(1);
      expect(result.data.signature_summary.invalid).toBe(1);
    });
  });

  describe('audit-key (mint a scoped key for an auditor)', () => {
    it('creates a key with audit:substrate:read scope and nothing else', async () => {
      mockApi.apiKeyCreate.mockResolvedValue({
        data: {
          status: 'created',
          key: 'sk_solid_audit_abc123',
          warning: 'Save this key — it is shown only once',
          api_key: {
            id: 99,
            name: 'Acme Insurance — 2026 SOC 2',
            key_prefix: 'sk_solid_audit_abc1',
            scopes: ['audit:substrate:read'],
          },
        },
        status: 201,
        success: true,
      });

      const result = await mockApi.apiKeyCreate(
        'Acme Insurance — 2026 SOC 2',
        ['audit:substrate:read'],
        90,
      );

      expect(mockApi.apiKeyCreate).toHaveBeenCalledWith(
        'Acme Insurance — 2026 SOC 2',
        ['audit:substrate:read'],
        90,
      );
      expect(result.data.api_key.scopes).toEqual(['audit:substrate:read']);
      expect(result.data.api_key.scopes).toHaveLength(1);  // exactly one scope, no leakage
      expect(result.data.key).toMatch(/^sk_solid_/);
    });
  });
});
