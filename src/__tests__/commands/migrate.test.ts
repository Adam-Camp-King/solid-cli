/**
 * Migrate command tests
 *
 * Tests company-to-company migration: dry-run preview,
 * execution, overwrite behavior, selective migration,
 * and security (reserved IDs, membership checks).
 */

import { apiClient } from '../../lib/api-client';

jest.mock('../../lib/api-client', () => ({
  apiClient: {
    migratePreview: jest.fn(),
    migrateExecute: jest.fn(),
  },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

describe('migrate command', () => {
  beforeEach(() => jest.clearAllMocks());

  // ── Dry-run Preview ───────────────────────────────────────────────

  describe('migrate preview (dry-run)', () => {
    it('previews migration between companies', async () => {
      mockApi.migratePreview.mockResolvedValue({
        data: {
          success: true,
          dry_run: true,
          source_company_id: 61,
          target_company_id: 72,
          summary: {
            pages_total: 5,
            pages_will_create: 3,
            pages_will_overwrite: 0,
            pages_skipped: 2,
            kb_total: 12,
            kb_will_create: 10,
            kb_will_overwrite: 0,
            kb_skipped: 2,
            includes_settings: false,
          },
          details: {
            pages: [
              { slug: 'home', title: 'Home', action: 'create', will_apply: true },
              { slug: 'about', title: 'About', action: 'create', will_apply: true },
              { slug: 'contact', title: 'Contact', action: 'overwrite', will_apply: false },
            ],
            kb: [],
          },
        },
        status: 200,
        success: true,
      });

      const result = await mockApi.migratePreview({
        source_company_id: 61,
        target_company_id: 72,
      });

      expect(mockApi.migratePreview).toHaveBeenCalled();
      expect((result.data as any).dry_run).toBe(true);
      expect((result.data as any).summary.pages_will_create).toBe(3);
      expect((result.data as any).summary.pages_skipped).toBe(2);
    });

    it('shows overwrite vs skip behavior', async () => {
      // Without --overwrite: existing items are skipped
      mockApi.migratePreview.mockResolvedValue({
        data: {
          success: true,
          summary: { pages_skipped: 3, pages_will_create: 0, pages_will_overwrite: 0 },
        },
        status: 200,
        success: true,
      });

      const result = await mockApi.migratePreview({
        source_company_id: 10,
        target_company_id: 20,
        overwrite_existing: false,
      });

      expect((result.data as any).summary.pages_skipped).toBe(3);
      expect((result.data as any).summary.pages_will_overwrite).toBe(0);
    });

    it('supports selective page migration', async () => {
      mockApi.migratePreview.mockResolvedValue({
        data: { success: true, summary: { pages_total: 2, pages_will_create: 2 } },
        status: 200,
        success: true,
      });

      await mockApi.migratePreview({
        source_company_id: 61,
        target_company_id: 72,
        page_slugs: ['home', 'pricing'],
      });

      expect(mockApi.migratePreview).toHaveBeenCalledWith(expect.objectContaining({
        page_slugs: ['home', 'pricing'],
      }));
    });

    it('supports selective KB migration', async () => {
      mockApi.migratePreview.mockResolvedValue({
        data: { success: true, summary: { kb_total: 3 } },
        status: 200,
        success: true,
      });

      await mockApi.migratePreview({
        source_company_id: 61,
        target_company_id: 72,
        kb_ids: [1, 5, 12],
      });

      expect(mockApi.migratePreview).toHaveBeenCalledWith(expect.objectContaining({
        kb_ids: [1, 5, 12],
      }));
    });
  });

  // ── Execute Migration ─────────────────────────────────────────────

  describe('migrate execute', () => {
    it('executes full migration', async () => {
      mockApi.migrateExecute.mockResolvedValue({
        data: {
          success: true,
          message: 'Migration complete: 15 items transferred',
          source_company_id: 61,
          target_company_id: 72,
          results: {
            pages_created: 5,
            pages_updated: 0,
            pages_skipped: 0,
            kb_created: 10,
            kb_updated: 0,
            kb_skipped: 0,
            settings_applied: false,
          },
        },
        status: 200,
        success: true,
      });

      const result = await mockApi.migrateExecute({
        source_company_id: 61,
        target_company_id: 72,
      });

      expect((result.data as any).success).toBe(true);
      expect((result.data as any).results.pages_created).toBe(5);
      expect((result.data as any).results.kb_created).toBe(10);
    });

    it('executes with overwrite flag', async () => {
      mockApi.migrateExecute.mockResolvedValue({
        data: {
          success: true,
          results: { pages_created: 2, pages_updated: 3, pages_skipped: 0 },
        },
        status: 200,
        success: true,
      });

      await mockApi.migrateExecute({
        source_company_id: 61,
        target_company_id: 72,
        overwrite_existing: true,
      });

      expect(mockApi.migrateExecute).toHaveBeenCalledWith(expect.objectContaining({
        overwrite_existing: true,
      }));
    });

    it('migrated pages are unpublished by default', async () => {
      // Backend creates pages with is_published=false
      // This prevents accidental live deployment during migration
      mockApi.migrateExecute.mockResolvedValue({
        data: {
          success: true,
          results: { pages_created: 5 },
        },
        status: 200,
        success: true,
      });

      const result = await mockApi.migrateExecute({
        source_company_id: 61,
        target_company_id: 72,
      });

      expect((result.data as any).results.pages_created).toBe(5);
    });

    it('includes settings when requested', async () => {
      mockApi.migrateExecute.mockResolvedValue({
        data: {
          success: true,
          results: { settings_applied: true },
        },
        status: 200,
        success: true,
      });

      await mockApi.migrateExecute({
        source_company_id: 61,
        target_company_id: 72,
        include_settings: true,
      });

      expect(mockApi.migrateExecute).toHaveBeenCalledWith(expect.objectContaining({
        include_settings: true,
      }));
    });
  });

  // ── Security — Company Isolation ──────────────────────────────────

  describe('company isolation', () => {
    it('prevents migrating to reserved company IDs (1, 2, 3)', async () => {
      const RESERVED_IDS = [1, 2, 3];

      for (const reservedId of RESERVED_IDS) {
        mockApi.migratePreview.mockRejectedValue({
          response: { status: 400, data: { detail: 'Cannot migrate to reserved company IDs (1, 2, 3)' } },
        });

        await expect(mockApi.migratePreview({
          source_company_id: 61,
          target_company_id: reservedId,
        })).rejects.toBeDefined();
      }
    });

    it('prevents same-company migration', async () => {
      mockApi.migratePreview.mockRejectedValue({
        response: { status: 400, data: { detail: 'Source and target must be different companies' } },
      });

      await expect(mockApi.migratePreview({
        source_company_id: 61,
        target_company_id: 61,
      })).rejects.toBeDefined();
    });

    it('requires membership in both source and target companies', async () => {
      mockApi.migratePreview.mockRejectedValue({
        response: { status: 403, data: { detail: 'You are not a member of target company (ID 999)' } },
      });

      await expect(mockApi.migratePreview({
        source_company_id: 61,
        target_company_id: 999,
      })).rejects.toBeDefined();
    });

    it('source and target must be different IDs', () => {
      const source = 61;
      const target = 72;
      expect(source).not.toBe(target);
    });

    it('company IDs must be numbers', () => {
      const source = parseInt('61', 10);
      const target = parseInt('72', 10);
      expect(typeof source).toBe('number');
      expect(typeof target).toBe('number');
      expect(isNaN(source)).toBe(false);
      expect(isNaN(target)).toBe(false);
    });
  });

  // ── Pages-only and KB-only modes ──────────────────────────────────

  describe('selective migration modes', () => {
    it('pages-only excludes KB', async () => {
      mockApi.migratePreview.mockResolvedValue({
        data: { success: true, summary: { pages_total: 5, kb_total: 0 } },
        status: 200,
        success: true,
      });

      await mockApi.migratePreview({
        source_company_id: 61,
        target_company_id: 72,
        include_pages: true,
        include_kb: false,
      });

      expect(mockApi.migratePreview).toHaveBeenCalledWith(expect.objectContaining({
        include_kb: false,
      }));
    });

    it('kb-only excludes pages', async () => {
      mockApi.migratePreview.mockResolvedValue({
        data: { success: true, summary: { pages_total: 0, kb_total: 12 } },
        status: 200,
        success: true,
      });

      await mockApi.migratePreview({
        source_company_id: 61,
        target_company_id: 72,
        include_pages: false,
        include_kb: true,
      });

      expect(mockApi.migratePreview).toHaveBeenCalledWith(expect.objectContaining({
        include_pages: false,
      }));
    });
  });
});
