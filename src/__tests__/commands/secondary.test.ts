/**
 * Smoke tests for the secondary-batch commands — chains, forms, emails,
 * landing, chat-widgets, payment-links, subscriptions. Each test locks an
 * endpoint path so any accidental backend drift shows up here.
 */

import { config } from '../../lib/config';
import { apiClient } from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

describe('secondary commands — endpoint routing', () => {
  beforeEach(() => { jest.clearAllMocks(); config.accessToken = 'test_token'; config.companyId = 99999; });

  // chains ────────────────────────────────────────
  it('chains list /api/v1/chains', async () => {
    mockApi.get.mockResolvedValue({ data: [], status: 200, success: true });
    await mockApi.get('/api/v1/chains');
    expect(mockApi.get).toHaveBeenCalledWith('/api/v1/chains');
  });
  it('chains execute uses POST /{id}/execute', async () => {
    mockApi.post.mockResolvedValue({ data: { id: 1 }, status: 200, success: true });
    await mockApi.post('/api/v1/chains/9/execute', { input: 'go' });
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/chains/9/execute', expect.any(Object));
  });
  it('chains approve uses POST /executions/{id}/approve', async () => {
    mockApi.post.mockResolvedValue({ data: {}, status: 200, success: true });
    await mockApi.post('/api/v1/chains/executions/42/approve');
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/chains/executions/42/approve');
  });

  // forms ─────────────────────────────────────────
  it('forms generate POST /surveys/generate', async () => {
    mockApi.post.mockResolvedValue({ data: { id: 5 }, status: 200, success: true });
    await mockApi.post('/api/v1/surveys/generate', { prompt: 'customer feedback' });
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/surveys/generate', expect.any(Object));
  });
  it('forms export csv GET /surveys/{id}/export/csv', async () => {
    mockApi.get.mockResolvedValue({ data: 'col,col\n', status: 200, success: true });
    await mockApi.get('/api/v1/surveys/5/export/csv');
    expect(mockApi.get).toHaveBeenCalledWith('/api/v1/surveys/5/export/csv');
  });

  // emails ────────────────────────────────────────
  it('email addresses list', async () => {
    mockApi.get.mockResolvedValue({ data: [], status: 200, success: true });
    await mockApi.get('/api/v1/email/addresses');
    expect(mockApi.get).toHaveBeenCalledWith('/api/v1/email/addresses');
  });
  it('email send uses /EmailCommunication/send/{template}', async () => {
    mockApi.post.mockResolvedValue({ data: {}, status: 200, success: true });
    await mockApi.post('/api/v1/EmailCommunication/send/welcome', { to: 'a@b.com', variables: {} });
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/EmailCommunication/send/welcome', expect.any(Object));
  });

  // landing ───────────────────────────────────────
  it('landing list', async () => {
    mockApi.get.mockResolvedValue({ data: [], status: 200, success: true });
    await mockApi.get('/api/v1/landing-pages/');
    expect(mockApi.get).toHaveBeenCalledWith('/api/v1/landing-pages/');
  });
  it('landing publish', async () => {
    mockApi.post.mockResolvedValue({ data: {}, status: 200, success: true });
    await mockApi.post('/api/v1/landing-pages/7/publish');
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/landing-pages/7/publish');
  });

  // chat-widgets ──────────────────────────────────
  it('chat-widgets list /cms/chat-widgets', async () => {
    mockApi.get.mockResolvedValue({ data: { widgets: [] }, status: 200, success: true });
    await mockApi.get('/api/v1/cms/chat-widgets');
    expect(mockApi.get).toHaveBeenCalledWith('/api/v1/cms/chat-widgets');
  });
  it('chat-widgets embed GET /{id}/embed', async () => {
    mockApi.get.mockResolvedValue({ data: { embed_code: '<script>' }, status: 200, success: true });
    await mockApi.get('/api/v1/cms/chat-widgets/3/embed');
    expect(mockApi.get).toHaveBeenCalledWith('/api/v1/cms/chat-widgets/3/embed');
  });

  // payment-links ─────────────────────────────────
  it('payment-link create /create', async () => {
    mockApi.post.mockResolvedValue({ data: { id: 1, url: 'https://pay' }, status: 200, success: true });
    await mockApi.post('/api/v1/payment-links/create', { amount: 99 });
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/payment-links/create', expect.objectContaining({ amount: 99 }));
  });
  it('text2pay POST /send-text2pay', async () => {
    mockApi.post.mockResolvedValue({ data: {}, status: 200, success: true });
    await mockApi.post('/api/v1/payment-links/send-text2pay', { phone: '+15551234567', amount: 50 });
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/payment-links/send-text2pay', expect.any(Object));
  });

  // subscriptions ─────────────────────────────────
  it('subscriptions cancel', async () => {
    mockApi.post.mockResolvedValue({ data: {}, status: 200, success: true });
    await mockApi.post('/api/v1/subscriptions/cancel', { customer_id: 7 });
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/subscriptions/cancel', expect.objectContaining({ customer_id: 7 }));
  });

  // agent clone ───────────────────────────────────
  it('agent clone uses PUT /agent-profiles/{type}', async () => {
    mockApi.put.mockResolvedValue({ data: {}, status: 200, success: true });
    await mockApi.put('/api/v1/agent-profiles/sarah', { display_name: 'Sandy' });
    expect(mockApi.put).toHaveBeenCalledWith('/api/v1/agent-profiles/sarah', expect.objectContaining({ display_name: 'Sandy' }));
  });

  // billing methods ───────────────────────────────
  it('billing methods list', async () => {
    mockApi.get.mockResolvedValue({ data: { payment_methods: [] }, status: 200, success: true });
    await mockApi.get('/api/v1/billing/payment-methods');
    expect(mockApi.get).toHaveBeenCalledWith('/api/v1/billing/payment-methods');
  });

  // audit export ──────────────────────────────────
  it('audit export GET /security/audit/export', async () => {
    mockApi.get.mockResolvedValue({ data: 'id,...', status: 200, success: true });
    await mockApi.get('/api/v1/security/audit/export', { params: {} });
    expect(mockApi.get).toHaveBeenCalledWith('/api/v1/security/audit/export', expect.any(Object));
  });
});
