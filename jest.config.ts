export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testTimeout: 20000,
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/__tests__/**'],
  coverageDirectory: 'coverage',
  setupFiles: ['<rootDir>/src/__tests__/setup.ts'],
  // Redirect HOME for the whole run (workers + spawned CLIs) and fail if the
  // real ~/.solid changes. See src/__tests__/support/global-home.ts.
  globalSetup: '<rootDir>/src/__tests__/support/global-home.ts',
  globalTeardown: '<rootDir>/src/__tests__/support/global-teardown.ts',
  // @puppeteer/browsers is ESM-only from 3.x and jest does not transform
  // node_modules, so any suite that transitively imports browser-install.ts
  // died on "Unexpected token 'export'" — including tests of pure helpers that
  // never launch a browser. Downloading Chromium is integration-level
  // behaviour, so unit tests get a stub.
  moduleNameMapper: {
    '^@puppeteer/browsers$':
      '<rootDir>/src/__tests__/__mocks__/puppeteer-browsers.ts',
  },
};
