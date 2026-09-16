/**
 * The two-connection failure, reproduced.
 *
 * ⛔ THE FIXTURE IS ADAM'S ACTUAL MACHINE, 2026-09-15, not an invented shape:
 * `claude mcp list` showed an account connector and a local stdio server both
 * Connected, ~/.claude.json held the stdio entry with SOLID_API_URL and no
 * SOLID_API_KEY, and the CLI session was company 61. Every assertion below
 * failed against the shipped code.
 */

import { configPathForClient } from '../../lib/mcp-client-config';
import {
  enumerateSolidProviders,
  parseClaudeMcpList,
  parseScope,
  isSolidProvider,
  isActiveHealth,
  providersFromClaudeCli,
  assessProviders,
  type SolidProvider,
} from '../../lib/mcp-providers';

// Verbatim from the terminal that reported the bug.
const REAL_LIST = `Checking MCP server health…

claude.ai Solid#: https://api.solidnumber.com/mcp/connector - ✔ Connected
claude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✔ Connected
claude.ai Google Drive: https://drivemcp.googleapis.com/mcp/v1 - ✔ Connected
claude.ai Google Calendar: https://calendarmcp.googleapis.com/mcp/v1 - ✔ Connected
solid: npx -y @solidnumber/mcp - ✔ Connected
`;

describe('parseClaudeMcpList', () => {
  it('splits name/target/health when the target contains both separators', () => {
    const rows = parseClaudeMcpList(REAL_LIST);
    expect(rows).toHaveLength(5);
    const connector = rows.find((r) => r.name === 'claude.ai Solid#');
    // The URL holds "://" and the line holds " - ": a naive split mangles both.
    expect(connector?.target).toBe('https://api.solidnumber.com/mcp/connector');
    expect(connector?.health).toBe('✔ Connected');
  });

  it('drops the health-check header', () => {
    expect(parseClaudeMcpList(REAL_LIST).some((r) => /Checking MCP/.test(r.name))).toBe(false);
  });
});

describe('isSolidProvider', () => {
  it('claims both of ours', () => {
    expect(isSolidProvider('claude.ai Solid#', 'https://api.solidnumber.com/mcp/connector')).toBe(true);
    expect(isSolidProvider('solid', 'npx -y @solidnumber/mcp')).toBe(true);
  });

  it('does not claim the Google connectors sitting beside them', () => {
    expect(isSolidProvider('claude.ai Gmail', 'https://gmailmcp.googleapis.com/mcp/v1')).toBe(false);
    expect(isSolidProvider('claude.ai Google Drive', 'https://drivemcp.googleapis.com/mcp/v1')).toBe(false);
  });

  it('does not claim an unrelated server whose name merely contains the letters', () => {
    // A false refusal teaches people to pass --allow-tenant-mismatch by reflex,
    // which disables the real check. Narrowness is the point.
    expect(isSolidProvider('solidworks-cad', 'npx solidworks-mcp')).toBe(false);
  });
});

describe('parseScope', () => {
  it('reads the account connector scope — the whole discriminator', () => {
    expect(parseScope('claude.ai Solid#:\n  Scope: claude.ai config\n  Status: ✔ Connected')).toBe('account');
  });
  it('reads a user-scoped local server', () => {
    expect(parseScope('solid:\n  Scope: User config (available in all your projects)\n')).toBe('user');
  });
  it('returns unknown rather than guessing', () => {
    expect(parseScope('solid:\n  Status: ✔ Connected')).toBe('unknown');
  });
});

describe('isActiveHealth', () => {
  it('treats pending-approval as not serving', () => {
    expect(isActiveHealth('⏸ Pending approval')).toBe(false);
  });
  it('treats a failed connection as not serving', () => {
    expect(isActiveHealth('✗ Failed to connect')).toBe(false);
  });
  it('treats connected as serving', () => {
    expect(isActiveHealth('✔ Connected')).toBe(true);
  });
});

describe('providersFromClaudeCli', () => {
  const runClaude = async (args: string[]) => {
    if (args[1] === 'list') return REAL_LIST;
    if (args[2] === 'claude.ai Solid#') return 'claude.ai Solid#:\n  Scope: claude.ai config\n  Status: ✔ Connected\n';
    if (args[2] === 'solid') return 'solid:\n  Scope: User config (available in all your projects)\n';
    throw new Error('unexpected');
  };

  it('SEES THE ACCOUNT CONNECTOR — the one no local file check could find', async () => {
    const found = await providersFromClaudeCli({ apiUrl: 'https://api.solidnumber.com', runClaude });
    const names = found.map((p) => p.name).sort();
    expect(names).toEqual(['claude.ai Solid#', 'solid']);

    const connector = found.find((p) => p.name === 'claude.ai Solid#')!;
    expect(connector.scope).toBe('account');
    expect(connector.transport).toBe('remote');
    // Its company is NOT readable from this machine, and we must say so rather
    // than infer. Guessing here is the exact move that hid the bug.
    expect(connector.companyId).toBeNull();
    expect(connector.cliCanRepoint).toBe(false);
  });

  it('returns nothing, quietly, when the claude binary is absent', async () => {
    const found = await providersFromClaudeCli({
      apiUrl: 'x',
      runClaude: async () => { throw new Error('ENOENT'); },
    });
    expect(found).toEqual([]);
  });
});

const provider = (over: Partial<SolidProvider>): SolidProvider => ({
  name: 'p', scope: 'user', transport: 'stdio', target: '', active: true,
  companyId: null, cliCanRepoint: true, ...over,
});

describe('assessProviders', () => {
  it('REFUSES when two connections are live, even if one matches the session', () => {
    // ⛔ The regression that matters. Nothing in MCP says which provider an
    // agent picks; on the reported machine it picked the one that did NOT
    // match. A matching sibling is not evidence.
    const a = assessProviders([
      provider({ name: 'claude.ai Solid#', scope: 'account', transport: 'remote', cliCanRepoint: false }),
      provider({ name: 'solid', companyId: 61 }),
    ], 61);
    expect(a.verdict).toBe('conflict');
  });

  it('flags a proven mismatch', () => {
    const a = assessProviders([provider({ name: 'solid', companyId: 1, companyName: 'Solid-dev' })], 61);
    expect(a.verdict).toBe('mismatch');
    expect(a.headline).toContain('61');
    expect(a.headline).toContain('1');
  });

  it('reports "unverified" — never "ok" — for a company it could not resolve', () => {
    const a = assessProviders([
      provider({ name: 'claude.ai Solid#', scope: 'account', companyId: null, unresolved: 'account-level' }),
    ], 61);
    expect(a.verdict).toBe('unverified');
  });

  it('ignores an inactive provider when deciding conflict', () => {
    const a = assessProviders([
      provider({ name: 'solid', companyId: 61 }),
      provider({ name: 'claude.ai Solid#', scope: 'account', active: false }),
    ], 61);
    expect(a.verdict).toBe('ok');
  });

  it('passes only on exactly one active, proven, matching connection', () => {
    const a = assessProviders([provider({ name: 'solid', companyId: 61, companyName: 'ANGL LLC' })], 61);
    expect(a.verdict).toBe('ok');
    expect(a.headline).toContain('ANGL LLC');
  });

  it('says so when there is no connection at all', () => {
    expect(assessProviders([], 61).verdict).toBe('none');
  });
});

describe('enumerateSolidProviders — cross-client name collisions', () => {
  /**
   * ⛔ FOUND BY RUNNING THE TOOL ON THE REPORTING MACHINE, not by reading it.
   *
   * Every client calls its server "solid". Adam had TWO, in different files,
   * with different credentials:
   *
   *   Claude Desktop  claude_desktop_config.json   key → company 1
   *   Claude Code     ~/.claude.json               NO key at all
   *
   * `claude mcp list` reports only the second. The first version of the merge
   * matched on name alone, so it stamped Desktop's company 1 onto the entry
   * that has no credential — inventing a company for a server that cannot
   * authenticate, in the tool built to stop exactly that.
   */
  const runClaude = async (args: string[]) => {
    if (args[1] === 'list') return 'solid: npx -y @solidnumber/mcp - ✔ Connected\n';
    return 'solid:\n  Scope: User config (available in all your projects)\n';
  };

  // ⛔ DERIVE THE PATHS, NEVER SPELL THEM. The first cut hard-coded
  // '/home/u/Library/Application Support/Claude/...' — the macOS location. It
  // passed locally and failed on Linux CI, where configPathForClient('claude')
  // returns ~/.config/Claude/..., so the Desktop entry was never found and the
  // collision this test exists to catch could not occur. A test that only holds
  // on the author's OS is the same defect as one that only holds on the
  // author's dotfiles.
  const DESKTOP = configPathForClient('claude', { homeDir: '/home/u' });
  const CLAUDE_CODE = configPathForClient('vscode', { homeDir: '/home/u' });

  const FILES: Record<string, string> = {
    [DESKTOP]: JSON.stringify({
      mcpServers: { solid: { command: 'npx', args: ['@solidnumber/mcp'], env: { SOLID_API_KEY: 'sk_desktop' } } },
    }),
    [CLAUDE_CODE]: JSON.stringify({
      mcpServers: { solid: { command: 'npx', args: ['-y', '@solidnumber/mcp'], env: { SOLID_API_URL: 'https://api.solidnumber.com' } } },
    }),
  };

  const deps = {
    apiUrl: 'https://api.solidnumber.com',
    runClaude,
    existsSync: (p: string) => p in FILES,
    readFileSync: (p: string) => FILES[p],
  };

  beforeEach(() => {
    jest.spyOn(require('os'), 'homedir').mockReturnValue('/home/u');
    // The Desktop key resolves to company 1; the keyless entry never asks.
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ user: { company_id: 1, company_name: 'Solid-dev' } }),
    })) as any;
  });
  afterEach(() => jest.restoreAllMocks());

  it('keeps the two "solid" servers apart and never invents a company for the keyless one', async () => {
    const found = await enumerateSolidProviders(deps as any);
    expect(found).toHaveLength(2);

    const claudeCode = found.find((p) => p.configPath === CLAUDE_CODE)!;
    expect(claudeCode.companyId).toBeNull();
    expect(claudeCode.unresolved).toMatch(/NO SOLID_API_KEY|no SOLID_API_KEY/i);

    const desktop = found.find((p) => p.client === 'claude')!;
    expect(desktop.companyId).toBe(1);
  });

  it('assesses that machine as a conflict, not as company 1', async () => {
    const found = await enumerateSolidProviders(deps as any);
    expect(assessProviders(found, 61).verdict).toBe('conflict');
  });
});
