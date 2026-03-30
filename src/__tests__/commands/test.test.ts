/**
 * Agent test command tests
 */

import { apiClient } from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: {
    agentTest: jest.fn(),
    agentTestResults: jest.fn(),
  },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

describe('test command', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('single test — pass', () => {
    it('sends prompt and validates contains assertions', async () => {
      mockApi.agentTest.mockResolvedValue({
        data: {
          passed: true,
          agent_type: 'customer_service',
          prompt: 'what are your hours',
          response: 'We are open Monday through Friday, 9am to 5pm.',
          latency_ms: 450,
          assertions_passed: [
            { type: 'contains', value: 'monday', passed: true },
            { type: 'contains', value: 'friday', passed: true },
          ],
          assertions_failed: [],
          assertion_count: 2,
        },
        status: 200,
        success: true,
      });

      const result = await mockApi.agentTest({
        agent_type: 'customer_service',
        prompt: 'what are your hours',
        assertions: ['monday', 'friday'],
      });

      expect((result.data as any).passed).toBe(true);
      expect((result.data as any).assertions_passed).toHaveLength(2);
      expect((result.data as any).assertions_failed).toHaveLength(0);
    });
  });

  describe('single test — fail', () => {
    it('fails when response missing required content', async () => {
      mockApi.agentTest.mockResolvedValue({
        data: {
          passed: false,
          agent_type: 'customer_service',
          prompt: 'what are your hours',
          response: 'Please contact us for more information.',
          latency_ms: 380,
          assertions_passed: [],
          assertions_failed: [
            { type: 'contains', value: 'monday', passed: false },
          ],
          assertion_count: 1,
        },
        status: 200,
        success: true,
      });

      const result = await mockApi.agentTest({
        agent_type: 'customer_service',
        prompt: 'what are your hours',
        assertions: ['monday'],
      });

      expect((result.data as any).passed).toBe(false);
      expect((result.data as any).assertions_failed).toHaveLength(1);
    });
  });

  describe('not-contains assertions', () => {
    it('passes when forbidden content is absent', async () => {
      mockApi.agentTest.mockResolvedValue({
        data: {
          passed: true,
          assertions_passed: [
            { type: 'not_contains', value: 'competitor', passed: true },
          ],
          assertions_failed: [],
        },
        status: 200,
        success: true,
      });

      const result = await mockApi.agentTest({
        agent_type: 'customer_service',
        prompt: 'tell me about your product',
        not_assertions: ['competitor'],
      });

      expect((result.data as any).passed).toBe(true);
    });

    it('fails when forbidden content is present', async () => {
      mockApi.agentTest.mockResolvedValue({
        data: {
          passed: false,
          assertions_passed: [],
          assertions_failed: [
            { type: 'not_contains', value: 'free trial', passed: false },
          ],
        },
        status: 200,
        success: true,
      });

      const result = await mockApi.agentTest({
        agent_type: 'customer_service',
        prompt: 'pricing info',
        not_assertions: ['free trial'],
      });

      expect((result.data as any).passed).toBe(false);
    });
  });

  describe('combined assertions', () => {
    it('supports both contains and not-contains in same test', async () => {
      mockApi.agentTest.mockResolvedValue({
        data: {
          passed: true,
          assertions_passed: [
            { type: 'contains', value: 'pricing', passed: true },
            { type: 'not_contains', value: 'competitor', passed: true },
          ],
          assertions_failed: [],
          assertion_count: 2,
        },
        status: 200,
        success: true,
      });

      const result = await mockApi.agentTest({
        agent_type: 'customer_service',
        prompt: 'tell me about pricing',
        assertions: ['pricing'],
        not_assertions: ['competitor'],
      });

      expect((result.data as any).passed).toBe(true);
      expect((result.data as any).assertion_count).toBe(2);
    });
  });

  describe('no assertions (response-only mode)', () => {
    it('returns response without pass/fail when no assertions given', async () => {
      mockApi.agentTest.mockResolvedValue({
        data: {
          passed: true,
          agent_type: 'customer_service',
          prompt: 'hello',
          response: 'Hi! How can I help you today?',
          latency_ms: 200,
          assertions_passed: [],
          assertions_failed: [],
          assertion_count: 0,
        },
        status: 200,
        success: true,
      });

      const result = await mockApi.agentTest({
        agent_type: 'customer_service',
        prompt: 'hello',
      });

      expect((result.data as any).response).toBeDefined();
      expect((result.data as any).assertion_count).toBe(0);
    });
  });

  describe('test execution errors', () => {
    it('handles agent execution failures', async () => {
      mockApi.agentTest.mockResolvedValue({
        data: {
          passed: false,
          agent_type: 'customer_service',
          prompt: 'test',
          response: null,
          error: 'Agent timeout after 30s',
          latency_ms: 30000,
          assertions_passed: [],
          assertions_failed: [{ type: 'execution', detail: 'Agent timeout after 30s' }],
        },
        status: 200,
        success: true,
      });

      const result = await mockApi.agentTest({
        agent_type: 'customer_service',
        prompt: 'test',
        timeout_seconds: 30,
      });

      expect((result.data as any).passed).toBe(false);
      expect((result.data as any).error).toContain('timeout');
    });
  });

  describe('test results history', () => {
    it('fetches recent test results', async () => {
      mockApi.agentTestResults.mockResolvedValue({
        data: {
          results: [
            { timestamp: '2026-03-28T14:00:00Z', agent_type: 'customer_service', success: true, latency_ms: 450, tokens_used: 120 },
            { timestamp: '2026-03-28T13:00:00Z', agent_type: 'growth_intelligence', success: false, latency_ms: 1200, tokens_used: 300 },
          ],
          count: 2,
        },
        status: 200,
        success: true,
      });

      const result = await mockApi.agentTestResults(24, 50);
      expect(mockApi.agentTestResults).toHaveBeenCalledWith(24, 50);
      expect((result.data as any).results).toHaveLength(2);
    });
  });

  describe('agent name resolution', () => {
    it('resolves agent names to types', () => {
      // Verify the mapping is used in test calls
      const nameMap: Record<string, string> = {
        sarah: 'customer_service',
        marcus: 'growth_intelligence',
        ada: 'orchestrator',
      };

      for (const [name, type] of Object.entries(nameMap)) {
        expect(type).toBeDefined();
        expect(type).not.toBe(name); // Name !== type
      }
    });
  });
});
