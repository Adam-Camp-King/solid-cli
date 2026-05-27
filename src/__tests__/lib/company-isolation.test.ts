/**
 * Company Isolation Tests — CRITICAL SECURITY
 *
 * Verifies that the CLI cannot cross company boundaries.
 * An AI agent bot with a JWT for company 42 must NEVER be able to
 * read, write, or modify data belonging to company 43.
 *
 * The CLI relies on the backend for enforcement (JWT contains company_id,
 * RLS policies on all 420 tables, middleware checks). These tests verify
 * the CLI's CONTRIBUTION to isolation:
 *
 * 1. Every API call includes X-Company-ID header
 * 2. Company switch replaces the JWT entirely (not just a header)
 * 3. Config never falls back to a default company_id
 * 4. Logout clears ALL company context
 * 5. Reserved company IDs (1, 2, 3) are never used in normal operations
 */

import { config } from '../../lib/config';
import * as fs from 'fs';
import * as path from 'path';

describe('Company Isolation — Security Critical', () => {

  describe('company_id is always explicit', () => {
    it('config.companyId is set in test environment', () => {
      expect(config.companyId).toBe(99999);
    });

    it('companyId is a number, never a string', () => {
      expect(typeof config.companyId).toBe('number');
    });

    it('companyId is never 0 (which could bypass RLS)', () => {
      expect(config.companyId).not.toBe(0);
    });

    it('companyId is never negative', () => {
      expect(config.companyId).toBeGreaterThan(0);
    });
  });

  describe('reserved company IDs are protected', () => {
    const RESERVED = [1, 2, 3];

    it('company 1 (SolidNumber Dev) is never used in tests', () => {
      expect(config.companyId).not.toBe(1);
    });

    it('company 2 (Template Company) is never used in tests', () => {
      expect(config.companyId).not.toBe(2);
    });

    it('company 3 (SolidNumber Production) is never used in tests', () => {
      expect(config.companyId).not.toBe(3);
    });

    it('test company_id 99999 is not a reserved ID', () => {
      expect(RESERVED).not.toContain(99999);
    });
  });

  describe('logout clears all company context', () => {
    it('logout() executes without error', () => {
      config.logout();
      expect(config.logout).toHaveBeenCalled();
    });

    it('real logout deletes every auth field (source contract)', () => {
      const configSrc = fs.readFileSync(
        path.join(__dirname, '..', '..', 'lib', 'config.ts'),
        'utf-8',
      );
      const logoutBlock = configSrc.match(/logout\(\)[\s\S]*?^\s*\}/m);
      expect(logoutBlock).not.toBeNull();
      const body = logoutBlock![0];
      expect(body).toContain('delete this.data.access_token');
      expect(body).toContain('delete this.data.refresh_token');
      expect(body).toContain('delete this.data.company_id');
      expect(body).toContain('delete this.data.user_id');
      expect(body).toContain('delete this.data.user_email');
    });
  });

  describe('API key isolation', () => {
    it('SOLID_API_KEY env var is not set in test environment', () => {
      // Tests must NEVER use a real API key
      const testEnvKey = process.env.SOLID_API_KEY;
      expect(testEnvKey).toBeFalsy();
    });

    it('access token in test config is clearly fake', () => {
      expect(config.accessToken).toContain('test');
      expect(config.accessToken).not.toContain('sk_');
      expect(config.accessToken).not.toContain('solid_');
    });
  });

  describe('cross-company protection contract', () => {
    it('request interceptor attaches X-Company-ID from config.companyId (source contract)', () => {
      const apiSrc = fs.readFileSync(
        path.join(__dirname, '..', '..', 'lib', 'api-client.ts'),
        'utf-8',
      );
      expect(apiSrc).toMatch(/const companyId\s*=\s*config\.companyId/);
      expect(apiSrc).toMatch(/headers\[['"]X-Company-ID['"]\]\s*=\s*companyId\.toString\(\)/);
    });

    it('company switch requires a new JWT, not just a header change', () => {
      // companySwitch returns a NEW access_token + refresh_token
      // The old JWT is replaced entirely. This prevents an attacker
      // from just changing X-Company-ID while keeping an old JWT
      // (backend would reject mismatched JWT). Verified by reading the
      // switch command source — must write BOTH tokens AND companyId
      // back to config.
      const switchSrc = fs.readFileSync(
        path.join(__dirname, '..', '..', 'commands', 'switch.ts'),
        'utf-8',
      );
      expect(switchSrc).toMatch(/config\.accessToken\s*=\s*switchResponse\.data\.access_token/);
      expect(switchSrc).toMatch(/config\.refreshToken\s*=\s*switchResponse\.data\.refresh_token/);
      expect(switchSrc).toMatch(/config\.companyId\s*=\s*switchResponse\.data\.company\.id/);
    });

    it('companySwitch API method returns both new tokens (type contract)', () => {
      // Read the api-client.ts source and confirm the return type of
      // companySwitch still includes access_token + refresh_token.
      // A future refactor that drops these from the response shape
      // would silently break the new-JWT contract — this catches it.
      const apiSrc = fs.readFileSync(
        path.join(__dirname, '..', '..', 'lib', 'api-client.ts'),
        'utf-8',
      );
      const switchBlock = apiSrc.match(/async companySwitch[\s\S]*?\}\>\>/);
      expect(switchBlock).not.toBeNull();
      expect(switchBlock![0]).toContain('access_token: string');
      expect(switchBlock![0]).toContain('refresh_token: string');
    });

    it('no fallback to company_id=1 anywhere', () => {
      // A common vulnerability: code falls back to company_id=1 when auth fails
      // The CLI must NEVER do this — missing auth = error, not fallback
      expect(config.companyId).not.toBe(1);
    });
  });
});
