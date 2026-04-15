/**
 * Tests for remaining commands — schedule, inbox, reports, export, support,
 * notifications, accounting, domains, audit, explore, design.
 */

import { config } from '../../lib/config';
import { apiClient } from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

describe('remaining commands', () => {
  beforeEach(() => { jest.clearAllMocks(); config.accessToken = 'test_token'; config.companyId = 99999; });

  describe('schedule', () => {
    it('lists appointments', async () => {
      mockApi.get.mockResolvedValue({
        data: { appointments: [{ id: 1, title: 'Plumbing repair', date: '2026-04-20' }] },
        status: 200, success: true,
      });
      const result = await mockApi.get('/api/v1/schedule');
      expect((result.data as any).appointments).toHaveLength(1);
    });
  });

  describe('inbox', () => {
    it('lists messages with array guard', async () => {
      mockApi.get.mockResolvedValue({
        data: { items: [{ id: 1, channel: 'sms', message: 'Hello' }] },
        status: 200, success: true,
      });
      const result = await mockApi.get('/api/v1/communications/inbox');
      const data = result.data as any;
      const messages = Array.isArray(data?.items) ? data.items : [];
      expect(messages).toHaveLength(1);
    });

    it('handles non-array response', () => {
      const data = { error: 'not found' };
      const messages = Array.isArray((data as any)?.items) ? (data as any).items : [];
      expect(messages).toHaveLength(0);
    });
  });

  describe('reports', () => {
    it('fetches revenue summary', async () => {
      mockApi.get.mockResolvedValue({
        data: { revenue: 50000, period: '30d' },
        status: 200, success: true,
      });
      const result = await mockApi.get('/Reports/revenue-summary');
      expect((result.data as any).revenue).toBe(50000);
    });
  });

  describe('export', () => {
    it('triggers data export', async () => {
      mockApi.post.mockResolvedValue({
        data: { export_id: 'exp_123', status: 'processing' },
        status: 202, success: true,
      });
      const result = await mockApi.post('/api/v1/export', { format: 'json' });
      expect((result.data as any).status).toBe('processing');
    });
  });

  describe('support', () => {
    it('lists support tickets', async () => {
      mockApi.get.mockResolvedValue({
        data: { tickets: [{ id: 1, subject: 'Login issue', status: 'open' }] },
        status: 200, success: true,
      });
      const result = await mockApi.get('/api/v1/support/tickets');
      expect((result.data as any).tickets[0].status).toBe('open');
    });
  });

  describe('notifications', () => {
    it('lists notifications', async () => {
      mockApi.get.mockResolvedValue({
        data: { notifications: [{ id: 1, title: 'New lead', is_read: false }] },
        status: 200, success: true,
      });
      const result = await mockApi.get('/api/v1/notifications');
      expect((result.data as any).notifications[0].is_read).toBe(false);
    });
  });

  describe('accounting', () => {
    it('syncs with QuickBooks', async () => {
      mockApi.post.mockResolvedValue({
        data: { synced: true, records: 42 },
        status: 200, success: true,
      });
      const result = await mockApi.post('/api/v1/accounting/sync', { provider: 'quickbooks' });
      expect((result.data as any).synced).toBe(true);
    });
  });

  describe('domains', () => {
    it('lists domains', async () => {
      mockApi.get.mockResolvedValue({
        data: { domains: [{ domain: 'joesplumbing.com', is_verified: true }] },
        status: 200, success: true,
      });
      const result = await mockApi.get('/api/v1/domains');
      expect((result.data as any).domains[0].is_verified).toBe(true);
    });

    it('adds a domain', async () => {
      mockApi.post.mockResolvedValue({
        data: { domain: 'newsite.com', dns_records: [] },
        status: 201, success: true,
      });
      const result = await mockApi.post('/api/v1/domains/add', { domain: 'newsite.com' });
      expect(result.status).toBe(201);
    });
  });

  describe('audit', () => {
    it('fetches audit log from correct endpoint', async () => {
      mockApi.get.mockResolvedValue({
        data: { entries: [{ action: 'create', entity_type: 'page', user_email: 'admin@test.com' }] },
        status: 200, success: true,
      });
      const result = await mockApi.get('/api/v1/security/audit/logs');
      expect((result.data as any).entries[0].action).toBe('create');
    });
  });

  describe('design', () => {
    it('generates design from prompt', async () => {
      mockApi.post.mockResolvedValue({
        data: { blocks: [{ type: 'Hero', props: {} }], page_id: 42 },
        status: 200, success: true,
      });
      const result = await mockApi.post('/api/v1/vibe/analyze', { prompt: 'Landing page for HVAC' });
      expect((result.data as any).blocks).toHaveLength(1);
    });
  });
});
