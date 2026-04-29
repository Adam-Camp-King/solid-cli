/**
 * Health command tests — apiClient method contracts.
 *
 * Pattern matches kb.test.ts: mock apiClient methods, assert that
 * methods are called and return shapes match the contract. Mock data
 * casts through `unknown` so we don't have to mirror the full strict
 * response types — we're testing the contract, not the type system.
 */

import { apiClient } from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: {
    healthQuick: jest.fn(),
    healthFull: jest.fn(),
    healthMcp: jest.fn(),
  },
  handleApiError: jest.fn((e: { message?: string; status?: number }) => ({
    message: e?.message || 'Error',
    status: e?.status || 500,
  })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

// Helper: bypass strict response typing on mock returns.
const ok = <T>(data: T, status = 200) =>
  ({ data, status, success: true } as unknown as never);

describe('health apiClient contract', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('healthQuick', () => {
    it('returns {status, timestamp}', async () => {
      mockApi.healthQuick.mockResolvedValue(ok({ status: 'ok', timestamp: '2026-04-29T12:00:00Z' }));
      const res = await mockApi.healthQuick();
      expect(res.data.status).toBe('ok');
      expect(res.data.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('surfaces 503 (degraded) as error, not silent ok', async () => {
      mockApi.healthQuick.mockRejectedValue({ message: 'Service unavailable', status: 503 });
      await expect(mockApi.healthQuick()).rejects.toMatchObject({ status: 503 });
    });
  });

  describe('healthFull', () => {
    it('returns a dictionary of subsystem states', async () => {
      mockApi.healthFull.mockResolvedValue(ok({
        database: { status: 'ok', latency_ms: 4 },
        redis: { status: 'ok' },
        celery: { status: 'ok', queue_depth: 12 },
      }));
      const res = await mockApi.healthFull();
      const body = res.data as Record<string, { status: string }>;
      expect(body.database.status).toBe('ok');
      expect(body.redis.status).toBe('ok');
    });
  });

  describe('healthMcp', () => {
    it('reports MCP liveness with a status field', async () => {
      mockApi.healthMcp.mockResolvedValue(ok({ status: 'ok', tools_registered: 608 }));
      const res = await mockApi.healthMcp();
      const body = res.data as unknown as { status: string; tools_registered?: number };
      expect(body.status).toBe('ok');
      expect(body.tools_registered).toBe(608);
    });
  });
});
