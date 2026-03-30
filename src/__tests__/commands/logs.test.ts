/**
 * Agent logs command tests
 */

import { apiClient } from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: {
    agentLogs: jest.fn(),
    agentErrors: jest.fn(),
  },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

describe('logs command', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('all agent logs', () => {
    it('fetches unified activity log across all agents', async () => {
      mockApi.agentLogs.mockResolvedValue({
        data: {
          logs: [
            { timestamp: '2026-03-28T14:30:00Z', event_type: 'execution', agent_type: 'customer_service', action: 'chat_response', success: true, latency_ms: 450, tokens_used: 120 },
            { timestamp: '2026-03-28T14:29:00Z', event_type: 'task', agent_type: null, action: 'Process refund request', success: true, latency_ms: 1200 },
            { timestamp: '2026-03-28T14:28:00Z', event_type: 'communication', action: 'delegation', from_agent_id: 12, to_agent_id: 1 },
          ],
          count: 3,
          period_hours: 24,
        },
        status: 200,
        success: true,
      });

      const result = await mockApi.agentLogs(undefined, { hours: 24, limit: 50 });
      expect(mockApi.agentLogs).toHaveBeenCalledWith(undefined, { hours: 24, limit: 50 });
      expect((result.data as any).logs).toHaveLength(3);
      expect((result.data as any).logs[0].event_type).toBe('execution');
    });
  });

  describe('agent-specific logs', () => {
    it('fetches logs for a specific agent with stats', async () => {
      mockApi.agentLogs.mockResolvedValue({
        data: {
          agent_type: 'customer_service',
          logs: [
            { event_type: 'execution', action: 'chat_response', success: true, latency_ms: 300 },
          ],
          count: 1,
          stats: {
            total_executions: 50,
            successes: 48,
            errors: 2,
            success_rate: 0.96,
            avg_latency_ms: 320,
            total_tokens: 15000,
          },
        },
        status: 200,
        success: true,
      });

      const result = await mockApi.agentLogs('customer_service', { hours: 24, limit: 100 });
      expect((result.data as any).stats.success_rate).toBe(0.96);
      expect((result.data as any).stats.total_tokens).toBe(15000);
    });
  });

  describe('agent errors', () => {
    it('fetches errors only for a specific agent', async () => {
      mockApi.agentErrors.mockResolvedValue({
        data: {
          agent_type: 'customer_service',
          errors: [
            { timestamp: '2026-03-28T14:00:00Z', action: 'kb_lookup', error: 'KB entry not found', latency_ms: 50 },
          ],
          count: 1,
        },
        status: 200,
        success: true,
      });

      const result = await mockApi.agentErrors('customer_service', 24, 50);
      expect(mockApi.agentErrors).toHaveBeenCalledWith('customer_service', 24, 50);
      expect((result.data as any).errors).toHaveLength(1);
      expect((result.data as any).errors[0].error).toContain('not found');
    });

    it('returns empty when no errors exist', async () => {
      mockApi.agentErrors.mockResolvedValue({
        data: { agent_type: 'customer_service', errors: [], count: 0 },
        status: 200,
        success: true,
      });

      const result = await mockApi.agentErrors('customer_service', 24, 50);
      expect((result.data as any).errors).toHaveLength(0);
    });
  });

  describe('event type filtering', () => {
    it('filters by execution events', async () => {
      mockApi.agentLogs.mockResolvedValue({
        data: { logs: [{ event_type: 'execution' }], count: 1 },
        status: 200,
        success: true,
      });

      await mockApi.agentLogs(undefined, { event_type: 'execution' });
      expect(mockApi.agentLogs).toHaveBeenCalledWith(undefined, { event_type: 'execution' });
    });

    it('filters by task events', async () => {
      mockApi.agentLogs.mockResolvedValue({
        data: { logs: [{ event_type: 'task' }], count: 1 },
        status: 200,
        success: true,
      });

      await mockApi.agentLogs(undefined, { event_type: 'task' });
      expect(mockApi.agentLogs).toHaveBeenCalledWith(undefined, { event_type: 'task' });
    });
  });

  describe('time range', () => {
    it('supports custom hour range', async () => {
      mockApi.agentLogs.mockResolvedValue({
        data: { logs: [], count: 0, period_hours: 72 },
        status: 200,
        success: true,
      });

      await mockApi.agentLogs(undefined, { hours: 72 });
      expect(mockApi.agentLogs).toHaveBeenCalledWith(undefined, { hours: 72 });
    });
  });
});
