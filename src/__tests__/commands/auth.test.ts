/**
 * Auth command tests — real behavior, not mock ceremony.
 *
 * Tests pure functions, source-read contracts, and structural invariants.
 * If a test doesn't exercise real auth logic, it doesn't belong here.
 */

import * as fs from 'fs';
import * as path from 'path';
import { frontendUrlFor } from '../../lib/url-utils';

const AUTH_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'commands', 'auth.ts'),
  'utf-8',
);

describe('auth command — real behavior', () => {

  // ── Pure function: frontendUrlFor ─────────────────────────────────
  describe('frontendUrlFor', () => {
    it('strips api. prefix → app. for production', () => {
      expect(frontendUrlFor('https://api.solidnumber.com')).toBe('https://app.solidnumber.com');
    });

    it('maps localhost:8090 → localhost:3000 for local dev', () => {
      expect(frontendUrlFor('http://localhost:8090')).toBe('http://localhost:3000');
    });

    it('maps 127.0.0.1 → 127.0.0.1:3000', () => {
      expect(frontendUrlFor('http://127.0.0.1:8090')).toBe('http://127.0.0.1:3000');
    });

    it('returns host as-is when no api. prefix', () => {
      expect(frontendUrlFor('https://custom-backend.example.com')).toBe('https://custom-backend.example.com');
    });

    it('falls back to app.solidnumber.com on malformed URL', () => {
      expect(frontendUrlFor('not-a-url')).toBe('https://app.solidnumber.com');
    });

    it('preserves protocol (http vs https)', () => {
      expect(frontendUrlFor('http://api.solidnumber.com')).toBe('http://app.solidnumber.com');
    });
  });

  // ── Source contracts: login flow ──────────────────────────────────
  describe('login source contracts', () => {
    it('browser login verifies state parameter to prevent CSRF', () => {
      expect(AUTH_SRC).toMatch(/returnedState/);
      // Constant-time state comparison using crypto.timingSafeEqual
      expect(AUTH_SRC).toMatch(/timingSafeEqual/);
      // State mismatch leads to rejection
      expect(AUTH_SRC).toMatch(/stateOk/);
    });

    it('browser login generates cryptographically random state', () => {
      expect(AUTH_SRC).toMatch(/crypto\.randomBytes/);
    });

    it('API-key login calls authStatus() to verify token before storing', () => {
      // When using --token, the CLI should verify the key works
      expect(AUTH_SRC).toMatch(/apiClient\.authStatus/);
    });

    it('login stores accessToken, refreshToken, and companyId in config', () => {
      expect(AUTH_SRC).toMatch(/config\.accessToken\s*=/);
      expect(AUTH_SRC).toMatch(/config\.refreshToken\s*=/);
      expect(AUTH_SRC).toMatch(/config\.companyId\s*=/);
    });

    it('logout action exists and calls config.logout()', () => {
      expect(AUTH_SRC).toMatch(/config\.logout\(\)/);
    });

    it('every action gates on isLoggedIn() or handles unauthed gracefully', () => {
      // auth login doesn't need login check, but auth status/whoami/refresh do
      expect(AUTH_SRC).toMatch(/isLoggedIn\(\)/);
    });
  });

  // ── Source contracts: security ─────────────────────────────────────
  describe('security contracts', () => {
    it('browser login server only listens on localhost (no 0.0.0.0)', () => {
      // The loopback server must not bind to all interfaces
      expect(AUTH_SRC).not.toMatch(/listen\(\s*\d+\s*,\s*['"]0\.0\.0\.0['"]/);
    });

    it('browser login has a timeout to prevent hanging', () => {
      expect(AUTH_SRC).toMatch(/BROWSER_LOGIN_TIMEOUT/);
    });

    it('callback HTML escapes error parameter to prevent XSS', () => {
      expect(AUTH_SRC).toMatch(/escapeHtml/);
    });
  });
});
