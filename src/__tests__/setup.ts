/**
 * Global test setup — prevents tests from touching real config, real API, or real companies.
 *
 * Jest detection in lib/json-output.ts (typeof jest !== 'undefined') keeps
 * in-process tests in human-output mode without setting an env var that
 * would leak into spawned subprocesses. Smoke tests that exec `node
 * dist/index.js --json` therefore still get JSON exactly as designed.
 *
 * SOLID_NO_TENANT_WARN=1 is fine to leak into subprocesses — it just
 * silences the implicit-tenant warning that would otherwise show up on
 * stderr and confuse tests asserting specific error messages (e.g.
 * graph-diff expecting /baseline not found/).
 */
process.env.SOLID_NO_TENANT_WARN = process.env.SOLID_NO_TENANT_WARN ?? '1';


// Mock config — prevents filesystem access to ~/.solid/
jest.mock('../lib/config', () => ({
  config: {
    apiUrl: 'https://test-api.solidnumber.com',
    companyId: 99999,
    accessToken: 'test_token_do_not_use_in_production',
    refreshToken: 'test_refresh_token',
    tokenExpiresAt: new Date(Date.now() + 3600000),
    userId: 1,
    userEmail: 'test@solidnumber.com',
    environment: 'development',
    companies: [],
    isLoggedIn: jest.fn(() => true),
    logout: jest.fn(),
  },
}));

// Mock process.exit so it throws instead of killing the test runner
jest.spyOn(process, 'exit').mockImplementation((() => {
  throw new Error('process.exit called');
}) as any);
