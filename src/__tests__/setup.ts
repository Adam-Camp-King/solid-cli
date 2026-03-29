/**
 * Global test setup — prevents tests from touching real config, real API, or real companies.
 */

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
