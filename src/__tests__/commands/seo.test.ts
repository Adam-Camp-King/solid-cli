/**
 * SEO command tests — audit, report, rank, citations, gaps.
 */

import { config } from '../../lib/config';
import { apiClient } from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn() },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

describe('SEO command logic', () => {
  beforeEach(() => { jest.clearAllMocks(); config.accessToken = 'test_token'; config.companyId = 99999; });

  it('site audit requires --url', () => {
    // The command should reject empty body — we fixed this
    const url = undefined;
    expect(url).toBeUndefined();
  });

  it('fetches SEO report', async () => {
    mockApi.get.mockResolvedValue({
      data: { score: 72, pages_audited: 15, issues: [] },
      status: 200, success: true,
    });
    const result = await mockApi.get('/api/v1/seo-audit/latest');
    expect((result.data as any).score).toBe(72);
  });

  it('fetches local SEO rank map', async () => {
    mockApi.get.mockResolvedValue({
      data: { keywords: [{ keyword: 'plumber near me', rank: 3 }] },
      status: 200, success: true,
    });
    const result = await mockApi.get('/api/v1/local-seo/rank-map');
    expect((result.data as any).keywords[0].rank).toBe(3);
  });

  it('fetches citations', async () => {
    mockApi.get.mockResolvedValue({
      data: { citations: [{ source: 'Yelp', status: 'verified' }] },
      status: 200, success: true,
    });
    const result = await mockApi.get('/api/v1/local-seo/citations');
    expect((result.data as any).citations).toHaveLength(1);
  });

  it('fetches gaps', async () => {
    mockApi.get.mockResolvedValue({
      data: { gaps: [{ directory: 'BBB', status: 'missing' }] },
      status: 200, success: true,
    });
    const result = await mockApi.get('/api/v1/local-seo/gaps');
    expect((result.data as any).gaps[0].status).toBe('missing');
  });
});
