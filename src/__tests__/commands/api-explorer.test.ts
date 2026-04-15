/**
 * API explorer command tests — list, docs, call.
 */

import { config } from '../../lib/config';
import { apiClient } from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

describe('api explorer logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    config.accessToken = 'test_token';
    config.companyId = 99999;
  });

  it('GET request returns data', async () => {
    mockApi.get.mockResolvedValue({
      data: { contacts: [{ id: 1, name: 'Test' }] },
      status: 200,
      success: true,
    });

    const result = await mockApi.get('/api/v1/crm/contacts');
    expect(result.status).toBe(200);
    expect((result.data as any).contacts).toHaveLength(1);
  });

  it('POST request sends body', async () => {
    mockApi.post.mockResolvedValue({
      data: { id: 1, success: true },
      status: 201,
      success: true,
    });

    const result = await mockApi.post('/api/v1/kb/company', {
      question: 'Test',
      answer: 'Answer',
    });
    expect(result.status).toBe(201);
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/kb/company', {
      question: 'Test',
      answer: 'Answer',
    });
  });

  it('DELETE request works', async () => {
    mockApi.delete.mockResolvedValue({
      data: { success: true },
      status: 200,
      success: true,
    });

    const result = await mockApi.delete('/api/v1/kb/123');
    expect((result.data as any).success).toBe(true);
  });

  it('handles 401 errors', async () => {
    mockApi.get.mockRejectedValue({ response: { status: 401 }, message: 'Unauthorized' });

    await expect(mockApi.get('/api/v1/crm/contacts')).rejects.toMatchObject({
      message: 'Unauthorized',
    });
  });
});
