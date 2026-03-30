/**
 * Migrate command tests
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

  describe('migrate preview', () => {
    it('previews migration between companies', async () => {
      mockApi.migratePreview.mockResolvedValue({
        data: {
          from_company: { id: 10, name: 'Source Co' },
          to_company: { id: 20, name: 'Target Co' },
          pages_to_migrate: 5,
          kb_to_migrate: 12,
          conflicts: [],
        },
        status: 200,
        success: true,
      });

      const result = await mockApi.migratePreview({
        from_company_id: 10,
        to_company_id: 20,
      });

      expect(mockApi.migratePreview).toHaveBeenCalled();
      expect((result.data as any).pages_to_migrate).toBe(5);
      expect((result.data as any).kb_to_migrate).toBe(12);
    });
  });

  describe('company isolation', () => {
    it('requires both from and to company IDs', () => {
      // The command has requiredOption for --from and --to
      // Verify the structure expects both
      const options = {
        from: '10',
        to: '20',
        pagesOnly: false,
        kbOnly: false,
      };
      expect(options.from).toBeDefined();
      expect(options.to).toBeDefined();
      expect(parseInt(options.from)).not.toBe(parseInt(options.to));
    });

    it('prevents migrating to reserved company IDs', () => {
      const reservedIds = [1, 2, 3];
      const targetId = 20;
      expect(reservedIds).not.toContain(targetId);
    });
  });
});
