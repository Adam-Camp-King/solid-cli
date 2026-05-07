/**
 * Global test setup — prevents tests from touching real config, real API, or real companies.
 *
 * NOTE: jest runs in a non-TTY environment, which would now trigger the
 * auto-JSON detection in lib/json-output.ts. We force human-output mode
 * for all tests by default; individual tests that want JSON should set
 * `localOptions.json = true` or stub `isJsonOutput` directly. Real users
 * piping into a script still get auto-JSON because their env doesn't
 * have SOLID_NO_JSON set.
 */
process.env.SOLID_NO_JSON = process.env.SOLID_NO_JSON ?? '1';


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
