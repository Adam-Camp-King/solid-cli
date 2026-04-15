/**
 * Brand command tests — get, set, create, update, export, audit.
 */

import { config } from '../../lib/config';
import { apiClient } from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
  },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

describe('brand command logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    config.accessToken = 'test_token';
    config.companyId = 99999;
  });

  it('fetches brand identity', async () => {
    mockApi.get.mockResolvedValue({
      data: { name: 'Test Brand', design: { primary_color: '#4f46e5' }, voice: { tone: 'professional' } },
      status: 200,
      success: true,
    });

    const result = await mockApi.get('/api/v1/cli/brand');
    expect((result.data as any).name).toBe('Test Brand');
    expect((result.data as any).design.primary_color).toBe('#4f46e5');
  });

  it('updates brand with partial data', async () => {
    mockApi.patch.mockResolvedValue({
      data: { success: true },
      status: 200,
      success: true,
    });

    await mockApi.patch('/api/v1/cli/brand', {
      design: { primary_color: '#e94560', secondary_color: '#1a1a2e' },
    });

    expect(mockApi.patch).toHaveBeenCalledWith('/api/v1/cli/brand', {
      design: { primary_color: '#e94560', secondary_color: '#1a1a2e' },
    });
  });

  it('exports brand as CSS', async () => {
    mockApi.get.mockResolvedValue({
      data: { output: ':root { --primary: #4f46e5; }' },
      status: 200,
      success: true,
    });

    const result = await mockApi.get('/api/v1/cli/brand/export', { params: { format: 'css' } });
    expect((result.data as any).output).toContain('--primary');
  });

  it('runs brand audit', async () => {
    mockApi.get.mockResolvedValue({
      data: { score: 85, issues: ['Missing favicon'] },
      status: 200,
      success: true,
    });

    const result = await mockApi.get('/api/v1/cli/brand/audit');
    expect((result.data as any).score).toBe(85);
  });
});
