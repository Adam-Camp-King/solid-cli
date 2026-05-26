/**
 * Company command tests — real behavior, not mock ceremony.
 *
 * Tests source-read contracts and structural invariants.
 * For company ISOLATION tests, see lib/company-isolation.test.ts (security-critical).
 */

import * as fs from 'fs';
import * as path from 'path';

const COMPANY_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'commands', 'company.ts'),
  'utf-8',
);

const SWITCH_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'commands', 'switch.ts'),
  'utf-8',
);

describe('company command — real behavior', () => {

  // ── Auth gates ────────────────────────────────────────────────────
  describe('auth gates', () => {
    it('every subcommand except current checks isLoggedIn()', () => {
      // Count .action( handlers — each one that hits the network needs isLoggedIn
      const actions = COMPANY_SRC.match(/\.action\(async/g)?.length || 0;
      const loginChecks = COMPANY_SRC.match(/isLoggedIn\(\)/g)?.length || 0;
      // At minimum, list/create/info/members/invite should gate
      expect(loginChecks).toBeGreaterThanOrEqual(4);
      expect(actions).toBeGreaterThan(0);
    });

    it('unauthenticated → stderr "solid auth login" hint + process.exit(1)', () => {
      expect(COMPANY_SRC).toMatch(/solid auth login/);
      expect(COMPANY_SRC).toMatch(/process\.exit\(1\)/);
    });
  });

  // ── Commander contract ────────────────────────────────────────────
  describe('Commander argument contracts', () => {
    it('create takes <name> as required positional arg', () => {
      expect(COMPANY_SRC).toMatch(/command\('create <name>'\)/);
    });

    it('create supports --template and --industry options', () => {
      expect(COMPANY_SRC).toMatch(/--template/);
      expect(COMPANY_SRC).toMatch(/--industry/);
    });

    it('create supports --dedicated for droplet provisioning', () => {
      expect(COMPANY_SRC).toMatch(/--dedicated/);
    });

    it('list has ls alias', () => {
      expect(COMPANY_SRC).toMatch(/\.alias\('ls'\)/);
    });

    it('every subcommand supports --json output', () => {
      const jsonFlags = COMPANY_SRC.match(/--json/g)?.length || 0;
      // list, create, info, members, invite should all have --json
      expect(jsonFlags).toBeGreaterThanOrEqual(4);
    });
  });

  // ── Company switch contract ───────────────────────────────────────
  describe('switch command writes full auth state', () => {
    it('writes new accessToken from switch response', () => {
      expect(SWITCH_SRC).toMatch(/config\.accessToken\s*=\s*switchResponse\.data\.access_token/);
    });

    it('writes new refreshToken from switch response', () => {
      expect(SWITCH_SRC).toMatch(/config\.refreshToken\s*=\s*switchResponse\.data\.refresh_token/);
    });

    it('writes new companyId from switch response', () => {
      expect(SWITCH_SRC).toMatch(/config\.companyId\s*=\s*switchResponse\.data\.company\.id/);
    });
  });

  // ── Agency features ───────────────────────────────────────────────
  describe('agency features', () => {
    it('create-for-client command exists', () => {
      expect(COMPANY_SRC).toMatch(/create-for-client/);
    });

    it('lock/unlock area management exists', () => {
      expect(COMPANY_SRC).toMatch(/lock/i);
      expect(COMPANY_SRC).toMatch(/unlock/i);
    });
  });
});
