/**
 * Tests for `solid doctor` — probe engine.
 *
 * We test the pure runProbe() function in isolation. The commander-level
 * wiring is covered by dog-food runs against production.
 */

jest.mock('../../lib/api-client', () => ({
  apiClient: { get: jest.fn() },
  handleApiError: (e: unknown) => {
    if (e && typeof e === 'object' && 'status' in e) {
      return {
        message: (e as { message?: string }).message || 'fail',
        status: (e as { status: number }).status,
      };
    }
    return { message: 'fail', status: 500 };
  },
}));

import { apiClient } from '../../lib/api-client';
import { runProbe } from '../../commands/doctor';

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;

describe('runProbe', () => {
  beforeEach(() => mockGet.mockReset());

  it('returns PASS when the endpoint responds 200', async () => {
    mockGet.mockResolvedValue({ data: {}, status: 200, success: true });
    const r = await runProbe({ name: 'x', path: '/api/v1/x' });
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(r.detail).toBeUndefined();
  });

  it('returns FAIL when the endpoint throws', async () => {
    const e = new Error('boom') as Error & { status: number };
    e.status = 500;
    mockGet.mockRejectedValue(e);
    const r = await runProbe({ name: 'x', path: '/api/v1/x' });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(500);
    expect(r.detail).toMatch(/boom|fail/);
  });

  it('reports 403 as tier-skipped when tolerate403 is set', async () => {
    const e = new Error('forbidden') as Error & { status: number };
    e.status = 403;
    mockGet.mockRejectedValue(e);
    const r = await runProbe({ name: 'x', path: '/api/v1/x', tolerate403: true });
    expect(r.ok).toBe(true);
    expect(r.detail).toBe('tier-skipped');
  });

  it('reports 404 as tenant-skipped when tolerate404 is set', async () => {
    const e = new Error('missing') as Error & { status: number };
    e.status = 404;
    mockGet.mockRejectedValue(e);
    const r = await runProbe({ name: 'x', path: '/api/v1/x', tolerate404: true });
    expect(r.ok).toBe(true);
    expect(r.detail).toBe('tenant-skipped');
  });

  it('still FAILs 403 when tolerate403 is NOT set', async () => {
    const e = new Error('forbidden') as Error & { status: number };
    e.status = 403;
    mockGet.mockRejectedValue(e);
    const r = await runProbe({ name: 'x', path: '/api/v1/x' });
    expect(r.ok).toBe(false);
  });

  it('records latency', async () => {
    mockGet.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ data: {}, status: 200, success: true }), 30)),
    );
    const r = await runProbe({ name: 'x', path: '/api/v1/x' });
    expect(r.ms).toBeGreaterThanOrEqual(20);
  });
});
