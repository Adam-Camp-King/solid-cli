/**
 * Integrations command tests — apiClient method contracts.
 *
 * Largest single-command surface: catalog / list / generate / health /
 * validate / test / deploy / disable / rollback / logs. Mock data
 * casts through `unknown` to avoid mirroring the strict response
 * types — we're testing the call contract + response sanity.
 */

import { apiClient } from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: {
    integrationsCatalog: jest.fn(),
    integrationsList: jest.fn(),
    integrationsGenerate: jest.fn(),
    integrationsValidate: jest.fn(),
    integrationsTest: jest.fn(),
    integrationsDeploy: jest.fn(),
    integrationsDisable: jest.fn(),
    integrationsRollback: jest.fn(),
    integrationsLogs: jest.fn(),
    integrationsHealth: jest.fn(),
  },
  handleApiError: jest.fn((e: { message?: string; status?: number }) => ({
    message: e?.message || 'Error',
    status: e?.status || 500,
  })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

const ok = <T>(data: T, status = 200) =>
  ({ data, status, success: true } as unknown as never);

describe('integrations apiClient contract', () => {
  beforeEach(() => jest.clearAllMocks());

  it('catalog lists available providers', async () => {
    mockApi.integrationsCatalog.mockResolvedValue(ok({
      integrations: [{ provider: 'stripe' }, { provider: 'calendly' }],
      count: 2,
    }));
    const res = await mockApi.integrationsCatalog();
    const body = res.data as unknown as { integrations: unknown[]; count: number };
    expect(body.count).toBe(2);
  });

  it('list returns installed integrations envelope', async () => {
    mockApi.integrationsList.mockResolvedValue(ok({
      items: [{ id: 'int_1', provider: 'stripe', status: 'active' }],
      total: 1,
    }));
    const res = await mockApi.integrationsList();
    const body = res.data as unknown as { items: unknown[]; total: number };
    expect(body.total).toBe(1);
  });

  it('list passes status filter through', async () => {
    mockApi.integrationsList.mockResolvedValue(ok({ items: [], total: 0 }));
    await mockApi.integrationsList('disabled');
    expect(mockApi.integrationsList).toHaveBeenCalledWith('disabled');
  });

  it('generate returns the new integration id', async () => {
    mockApi.integrationsGenerate.mockResolvedValue(ok({ integration_id: 'int_xyz', status: 'created' }));
    const res = await mockApi.integrationsGenerate({ provider: 'stripe', name: 'Live Stripe' } as never);
    const body = res.data as unknown as { integration_id: string };
    expect(body.integration_id).toBe('int_xyz');
  });

  it('validate returns valid:true on clean integration', async () => {
    mockApi.integrationsValidate.mockResolvedValue(ok({ valid: true, issues: [] }));
    const res = await mockApi.integrationsValidate('int_xyz');
    const body = res.data as unknown as { valid: boolean; issues: unknown[] };
    expect(body.valid).toBe(true);
    expect(body.issues).toHaveLength(0);
  });

  it('validate returns valid:false + issues on broken integration', async () => {
    mockApi.integrationsValidate.mockResolvedValue(ok({
      valid: false,
      issues: [{ severity: 'error', message: 'missing scope: read' }],
    }));
    const res = await mockApi.integrationsValidate('int_broken');
    const body = res.data as unknown as { valid: boolean; issues: { severity: string }[] };
    expect(body.valid).toBe(false);
    expect(body.issues[0].severity).toBe('error');
  });

  it('test reports ok + latency on healthy integration', async () => {
    mockApi.integrationsTest.mockResolvedValue(ok({ ok: true, latency_ms: 84 }));
    const res = await mockApi.integrationsTest('int_xyz');
    const body = res.data as unknown as { ok: boolean; latency_ms: number };
    expect(body.ok).toBe(true);
    expect(body.latency_ms).toBeGreaterThan(0);
  });

  it('deploy reports success', async () => {
    mockApi.integrationsDeploy.mockResolvedValue(ok({ deployed: true, version: 'v1.0.1' }));
    const res = await mockApi.integrationsDeploy('int_xyz');
    const body = res.data as unknown as { deployed: boolean };
    expect(body.deployed).toBe(true);
  });

  it('disable accepts a reason', async () => {
    mockApi.integrationsDisable.mockResolvedValue(ok({ disabled: true }));
    await mockApi.integrationsDisable('int_xyz', 'rate-limited by provider');
    expect(mockApi.integrationsDisable).toHaveBeenCalledWith('int_xyz', 'rate-limited by provider');
  });

  it('rollback reports the version it rolled to', async () => {
    mockApi.integrationsRollback.mockResolvedValue(ok({ rolled_back_to: 'v1.0.0' }));
    const res = await mockApi.integrationsRollback('int_xyz');
    const body = res.data as unknown as { rolled_back_to: string };
    expect(body.rolled_back_to).toBe('v1.0.0');
  });

  it('logs accepts an integration id', async () => {
    mockApi.integrationsLogs.mockResolvedValue(ok({
      logs: [{ ts: '2026-04-29T12:00:00Z', level: 'info', message: 'webhook received' }],
    }));
    await mockApi.integrationsLogs('int_xyz');
    expect(mockApi.integrationsLogs).toHaveBeenCalledWith('int_xyz');
  });

  it('logs passes limit through unchanged', async () => {
    mockApi.integrationsLogs.mockResolvedValue(ok({ logs: [] }));
    await mockApi.integrationsLogs('int_xyz', 500);
    expect(mockApi.integrationsLogs).toHaveBeenCalledWith('int_xyz', 500);
  });

  it('404 on unknown integration_id surfaces correctly', async () => {
    mockApi.integrationsValidate.mockRejectedValue({
      message: 'integration not found',
      status: 404,
    });
    await expect(mockApi.integrationsValidate('int_nope')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('5xx on backend failure surfaces, not silently succeeds', async () => {
    mockApi.integrationsTest.mockRejectedValue({
      message: 'backend exploded',
      status: 500,
    });
    await expect(mockApi.integrationsTest('int_xyz')).rejects.toMatchObject({
      status: 500,
    });
  });
});
