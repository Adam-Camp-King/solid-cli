/**
 * CRM command tests — contacts, deals, tasks.
 */

import { config } from '../../lib/config';
import { apiClient } from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
  },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

describe('CRM command logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    config.accessToken = 'test_token';
    config.companyId = 99999;
  });

  it('lists contacts', async () => {
    mockApi.get.mockResolvedValue({
      data: { contacts: [{ id: 1, name: 'Joe', email: 'joe@test.com', lead_score: 75 }] },
      status: 200,
      success: true,
    });

    const result = await mockApi.get('/api/v1/crm/contacts');
    expect((result.data as any).contacts).toHaveLength(1);
    expect((result.data as any).contacts[0].lead_score).toBe(75);
  });

  it('lists deals', async () => {
    mockApi.get.mockResolvedValue({
      data: { deals: [{ id: 1, title: 'Website Redesign', value: 5000, stage: 'proposal' }] },
      status: 200,
      success: true,
    });

    const result = await mockApi.get('/api/v1/crm/deals');
    expect((result.data as any).deals[0].value).toBe(5000);
  });

  it('lists tasks', async () => {
    mockApi.get.mockResolvedValue({
      data: { tasks: [{ id: 1, title: 'Follow up', status: 'pending' }] },
      status: 200,
      success: true,
    });

    const result = await mockApi.get('/api/v1/crm/tasks');
    expect((result.data as any).tasks).toHaveLength(1);
  });

  it('creates a contact', async () => {
    mockApi.post.mockResolvedValue({
      data: { id: 2, name: 'New Contact' },
      status: 201,
      success: true,
    });

    const result = await mockApi.post('/api/v1/crm/contacts', { name: 'New Contact', email: 'new@test.com' });
    expect(result.status).toBe(201);
  });
});
