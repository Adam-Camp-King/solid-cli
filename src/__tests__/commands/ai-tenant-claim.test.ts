/**
 * `solid ai` must not claim a company it cannot see.
 *
 * WHAT HAPPENED, 2026-09-15. Signed in as adam@anglebuild.com — ANGL,
 * company 61 — and typed `claude`. The agent reported Solid-dev, company 1,
 * as adam@solidnumber.com: 60 contacts, 25 deals, and an offer to act on them.
 * `solid ai` had printed "Launching Claude Code with Company 61 context" on the
 * way in.
 *
 * Reproduced on a second machine with no source files, and in a third
 * independent session. The binding is an ACCOUNT-LEVEL MCP connector whose
 * token is pinned to the (user, company_id) captured on the consent screen
 * (solid-backend/controllers/mcp_connector.py:26, :785, :861). It lives on the
 * server. `solid switch`, re-login and deleting ~/.solid/mcp-key all changed
 * nothing, because none of them are in that path.
 *
 * WHY THIS FILE WAS REWRITTEN — and it is the same lesson twice.
 *
 * The first version asserted on the TEXT of ai.ts: expect(AI_SRC).toMatch(
 * /else if \(!status\)/), and so on. Those passed while the bug was live,
 * because a string in a file is not a behaviour. When the guard was replaced
 * with one that actually enumerates every provider, the tests failed — not
 * because the code got worse, but because it stopped containing the characters
 * they looked for. A test that breaks on a refactor and holds during an outage
 * is measuring the wrong thing.
 *
 * These now drive the real decision and rendering functions. The single
 * surviving source assertion is a NEGATIVE one — a specific sentence that must
 * never reappear — which is the one thing a grep is genuinely good for.
 */
import fs from 'fs';
import path from 'path';

import { assessProviders, renderProviderVerdict, type SolidProvider } from '../../lib/mcp-providers';

const AI_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'commands', 'ai.ts'), 'utf8');

const provider = (over: Partial<SolidProvider>): SolidProvider => ({
  name: 'solid', scope: 'user', transport: 'stdio', target: '', active: true,
  companyId: null, cliCanRepoint: true, ...over,
});

const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');
const plain = (lines: string[]) => lines.join('\n').replace(ANSI, '');

describe('solid ai does not overclaim the tenant', () => {
  it('never prints the old "with Company N context" phrasing', () => {
    // The exact sentence that made the mismatch invisible: it answered "which
    // company is the AI on" before the user could ask, and answered it wrong.
    expect(AI_SRC).not.toMatch(/with Company \$\{[^}]*\} context/);
  });

  it('launches verified ONLY on a proven, matching, single connection', () => {
    expect(assessProviders([provider({ companyId: 61, companyName: 'ANGL LLC' })], 61).verdict).toBe('ok');
  });

  it('does NOT report ok for the setup that shipped the bug', () => {
    // ~/.claude.json holding the server with no SOLID_API_KEY. The old guard
    // returned null here and took no branch at all.
    const a = assessProviders([provider({ unresolved: 'no SOLID_API_KEY in this entry' })], 61);
    expect(a.verdict).toBe('unverified');
    expect(a.verdict).not.toBe('ok');
  });

  it('refuses rather than choosing when an account connector sits beside a local server', () => {
    const a = assessProviders([
      provider({ name: 'claude.ai Solid#', scope: 'account', transport: 'remote', cliCanRepoint: false }),
      provider({ companyId: 61 }),
    ], 61);
    // Not "prefer the local one" — refuse. Nothing in MCP guarantees which the
    // agent picks, and on the reporting machine it picked the other one.
    expect(a.verdict).toBe('conflict');
  });

  it('tells the user how to check from INSIDE the AI, since the CLI cannot', () => {
    const a = assessProviders([
      provider({ name: 'claude.ai Solid#', scope: 'account', transport: 'remote', cliCanRepoint: false,
                 unresolved: 'account-level connector' }),
    ], 61);
    expect(plain(renderProviderVerdict(a))).toMatch(/what company do you see/);
  });

  it('names the connector, and says plainly that this CLI cannot move it', () => {
    const a = assessProviders([
      provider({ name: 'claude.ai Solid#', scope: 'account', transport: 'remote', cliCanRepoint: false,
                 unresolved: 'account-level connector' }),
    ], 61);
    const text = plain(renderProviderVerdict(a));
    expect(text).toMatch(/connector/i);
    expect(text).toMatch(/Settings/);
  });

  it('gives a runnable command for every blocking verdict — never just a diagnosis', () => {
    for (const a of [
      assessProviders([provider({ companyId: 1, companyName: 'Solid-dev' })], 61),
      assessProviders([provider({ name: 'a', scope: 'account', cliCanRepoint: false }),
                       provider({ name: 'b', companyId: 61 })], 61),
      assessProviders([], 61),
    ]) {
      expect(plain(renderProviderVerdict(a))).toMatch(/solid mcp connect|Settings/);
    }
  });
});
