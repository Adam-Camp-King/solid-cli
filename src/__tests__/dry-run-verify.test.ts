/**
 * Unit tests for T1.2 dry-run existence verification.
 *
 * Pure-function tests for deriveExistenceGet + documentation of the
 * interceptor contract. The full axios-interceptor path requires a real
 * HTTP server to mock and is out of scope for a unit test — it's tested
 * via the end-to-end harness.
 */
import { deriveExistenceGet } from '../lib/dry-run';

describe('deriveExistenceGet', () => {
  describe('returns null for non-mutating methods', () => {
    it.each(['GET', 'HEAD', 'OPTIONS', 'TRACE'])('%s → null', (method) => {
      expect(deriveExistenceGet(method, '/api/v1/cms/pages/42')).toBeNull();
    });
  });

  describe('returns null for POST (creating, nothing to verify)', () => {
    it.each([
      '/api/v1/cms/pages',
      '/api/v1/leads',
      '/api/v1/cms/pages/42',
    ])('POST %s → null', (url) => {
      expect(deriveExistenceGet('POST', url)).toBeNull();
    });
  });

  describe('returns null for undefined / empty inputs', () => {
    it.each([
      [undefined, '/api/v1/cms/pages/42'],
      ['', '/api/v1/cms/pages/42'],
      ['PATCH', undefined],
      ['PATCH', ''],
    ])('%s %s → null', (method, url) => {
      expect(deriveExistenceGet(method, url)).toBeNull();
    });
  });

  describe('derives existence URL for resource-targeted mutations', () => {
    it.each([
      ['PATCH', '/api/v1/cms/pages/42', '/api/v1/cms/pages/42'],
      ['PUT', '/api/v1/cms/pages/42', '/api/v1/cms/pages/42'],
      ['DELETE', '/api/v1/cms/pages/42', '/api/v1/cms/pages/42'],
      ['patch', '/api/v1/kb/abc-123', '/api/v1/kb/abc-123'],
      // UUID-ish
      ['DELETE', '/api/v1/sites/550e8400-e29b-41d4-a716-446655440000', '/api/v1/sites/550e8400-e29b-41d4-a716-446655440000'],
      // slug
      ['PATCH', '/api/v1/cli/agents/sarah.v2', '/api/v1/cli/agents/sarah.v2'],
      // numeric ID at deeper path
      ['PATCH', '/api/v1/companies/7/domains/12', '/api/v1/companies/7/domains/12'],
    ])('%s %s → %s', (method, url, expected) => {
      expect(deriveExistenceGet(method, url)).toBe(expected);
    });
  });

  describe('preserves query string on derived URL', () => {
    it('PATCH /foo/42?include=meta → /foo/42?include=meta', () => {
      expect(deriveExistenceGet('PATCH', '/foo/42?include=meta')).toBe(
        '/foo/42?include=meta',
      );
    });
  });

  describe('returns null for collection endpoints (no ID segment)', () => {
    it.each([
      ['PATCH', '/api/v1/leads'],
      ['DELETE', '/api/v1/cms/pages'],
      ['PUT', '/api/v1/kb'],
      ['DELETE', '/foo'],
      ['PATCH', '/'],
      // Too shallow to have an ID
      ['DELETE', '/something'],
    ])('%s %s → null', (method, url) => {
      expect(deriveExistenceGet(method, url)).toBeNull();
    });
  });

  describe('returns null for action-endpoint suffixes', () => {
    it.each([
      ['POST', '/api/v1/cms/pages/42/publish'],  // POST anyway, but double-safe
      ['PATCH', '/api/v1/cms/pages/42/publish'],
      ['PATCH', '/api/v1/invoices/7/send'],
      ['DELETE', '/api/v1/approvals/3/cancel'],
      ['PATCH', '/api/v1/keys/1/rotate'],
      ['PATCH', '/api/v1/domains/5/verify'],
      ['DELETE', '/api/v1/modules/5/deploy'],
    ])('%s %s → null', (method, url) => {
      expect(deriveExistenceGet(method, url)).toBeNull();
    });
  });

  describe('returns null for URLs that look like collections (alpha-only tail)', () => {
    it.each([
      ['PATCH', '/api/v1/leads/active'],       // "active" is alpha-only, short → collection-ish
      ['DELETE', '/api/v1/pages/draft'],       // same — "draft" looks like a view, not a resource
      ['PATCH', '/api/v1/inbox/unread'],
    ])('%s %s → null', (method, url) => {
      expect(deriveExistenceGet(method, url)).toBeNull();
    });
  });

  describe('accepts slug-like IDs (dot/dash/underscore) and long tokens', () => {
    it.each([
      ['PATCH', '/api/v1/kb/contractor-hvac'],           // dash → slug
      ['PATCH', '/api/v1/agents/ada_v2'],                // underscore → slug
      ['PATCH', '/api/v1/webhooks/stripe.payment.webhook'],  // dots
      // Long UUID-ish token (>24 chars) accepted even if all alpha
      ['DELETE', '/api/v1/tokens/abcdefghijklmnopqrstuvwxy'],
    ])('%s %s → non-null', (method, url) => {
      expect(deriveExistenceGet(method, url)).not.toBeNull();
    });
  });
});
