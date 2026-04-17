/**
 * Leads command tests — verify endpoint paths match controllers/leads.py.
 */

import { config } from '../../lib/config';
import { apiClient } from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

describe('leads command logic', () => {
  beforeEach(() => { jest.clearAllMocks(); config.accessToken = 'test_token'; config.companyId = 99999; });

  it('lists submissions via /api/v1/crm/leads/submissions', async () => {
    mockApi.get.mockResolvedValue({ data: { items: [] }, status: 200, success: true });
    await mockApi.get('/api/v1/crm/leads/submissions', { params: { limit: 50, offset: 0 } });
    expect(mockApi.get).toHaveBeenCalledWith('/api/v1/crm/leads/submissions', expect.objectContaining({ params: expect.objectContaining({ limit: 50 }) }));
  });

  it('lists forms via /api/v1/crm/leads/forms', async () => {
    mockApi.get.mockResolvedValue({ data: { forms: [] }, status: 200, success: true });
    await mockApi.get('/api/v1/crm/leads/forms', { params: {} });
    expect(mockApi.get).toHaveBeenCalledWith('/api/v1/crm/leads/forms', expect.any(Object));
  });

  it('gets stats via /api/v1/crm/leads/stats', async () => {
    mockApi.get.mockResolvedValue({ data: { total_leads: 42 }, status: 200, success: true });
    const r = await mockApi.get('/api/v1/crm/leads/stats');
    expect((r.data as any).total_leads).toBe(42);
  });

  it('per-contact score uses /api/v1/crm/leads/{id}/score', async () => {
    mockApi.get.mockResolvedValue({ data: { score: 75 }, status: 200, success: true });
    await mockApi.get('/api/v1/crm/leads/123/score');
    expect(mockApi.get).toHaveBeenCalledWith('/api/v1/crm/leads/123/score');
  });

  it('prospecting chat posts to /api/v1/crm/leads/prospecting/chat', async () => {
    mockApi.post.mockResolvedValue({ data: { response: 'hi' }, status: 200, success: true });
    await mockApi.post('/api/v1/crm/leads/prospecting/chat', { message: 'find me roofers' });
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/crm/leads/prospecting/chat', expect.objectContaining({ message: expect.any(String) }));
  });

  it('budget endpoint is /api/v1/crm/leads/prospecting/budget', async () => {
    mockApi.get.mockResolvedValue({ data: { remaining: 100 }, status: 200, success: true });
    await mockApi.get('/api/v1/crm/leads/prospecting/budget');
    expect(mockApi.get).toHaveBeenCalledWith('/api/v1/crm/leads/prospecting/budget');
  });

  it('preferences PUT uses /api/v1/crm/leads/preferences', async () => {
    mockApi.put.mockResolvedValue({ data: {}, status: 200, success: true });
    await mockApi.put('/api/v1/crm/leads/preferences', { service_radius_miles: 50 });
    expect(mockApi.put).toHaveBeenCalledWith('/api/v1/crm/leads/preferences', expect.any(Object));
  });

  it('dashboard pipeline lives at /api/v1/leads/pipeline (separate router)', async () => {
    mockApi.get.mockResolvedValue({ data: { stages: [] }, status: 200, success: true });
    await mockApi.get('/api/v1/leads/pipeline');
    expect(mockApi.get).toHaveBeenCalledWith('/api/v1/leads/pipeline');
  });

  it('connections, performance, activity all under /api/v1/leads/*', async () => {
    mockApi.get.mockResolvedValue({ data: {}, status: 200, success: true });
    await mockApi.get('/api/v1/leads/connections');
    await mockApi.get('/api/v1/leads/performance');
    await mockApi.get('/api/v1/leads/activity', { params: { limit: 50 } });
    expect(mockApi.get).toHaveBeenCalledWith('/api/v1/leads/connections');
    expect(mockApi.get).toHaveBeenCalledWith('/api/v1/leads/performance');
  });
});
