/**
 * `solid mcp doctor --fix` leaves exactly one Solid# connection — and says so
 * plainly when it cannot, because the other one lives in the claude.ai account.
 */
import { applyDoctorFix, assessProviders, planDoctorFix, type SolidProvider } from '../../lib/mcp-providers';

function local(name: string, configPath: string, companyId: number | null, client = 'vscode'): SolidProvider {
  return { name, scope: 'user', transport: 'stdio', target: 'npx -y @solidnumber/mcp', active: true,
    configPath, client: client as any, companyId, cliCanRepoint: true };
}
function account(companyId: number): SolidProvider {
  return { name: 'claude.ai Solid#', scope: 'account', transport: 'remote',
    target: 'https://api.solidnumber.com/mcp/connector', active: true, companyId, cliCanRepoint: false };
}

describe('planDoctorFix', () => {
  it('keeps the local entry already on this session and removes the other locals', () => {
    const a = assessProviders([
      local('solid', '/h/.claude.json', 1),
      local('solid', '/h/Library/Claude/claude_desktop_config.json', 61, 'claude'),
    ], 61);
    const plan = planDoctorFix(a);
    expect(plan.keep?.configPath).toBe('/h/Library/Claude/claude_desktop_config.json');
    expect(plan.remove.map((r) => r.configPath)).toEqual(['/h/.claude.json']);
    expect(plan.needsConnect).toBe(false);
    expect(plan.conflictRemains).toBe(false);
  });

  it('never touches the account connector — it is a manual step, and the conflict is said to remain', () => {
    const a = assessProviders([account(1), local('solid', '/h/.claude.json', null)], 61);
    const plan = planDoctorFix(a);
    expect(plan.remove).toEqual([]);
    expect(plan.manual[0].step).toMatch(/claude\.ai → Settings → Connectors/);
    expect(plan.conflictRemains).toBe(true);
    expect(plan.needsConnect).toBe(true);   // the kept local has no key yet
  });
});

describe('applyDoctorFix', () => {
  it('backs each file up ONCE, before its first change, and removes only the duplicate', () => {
    const files: Record<string, string> = {
      '/h/.cursor/mcp.json': JSON.stringify({ mcpServers: {
        solid: { command: 'npx' }, 'solid-2': { command: 'npx' }, github: { command: 'gh' } } }),
    };
    const writes: string[] = [];
    const deps = {
      readFileSync: (p: string) => files[p],
      writeFileSync: (p: string, d: string) => { files[p] = d; writes.push(p); },
      now: () => new Date('2026-09-24T12:00:00Z'),
    };
    const plan = {
      keep: null, manual: [], needsConnect: false, conflictRemains: false,
      remove: [local('solid', '/h/.cursor/mcp.json', 1), local('solid-2', '/h/.cursor/mcp.json', 2)],
    };
    const done = applyDoctorFix(plan, deps);

    const backup = '/h/.cursor/mcp.json.bak-2026-09-24T12-00-00-000Z';
    expect(writes.filter((w) => w === backup)).toHaveLength(1);
    expect(Object.keys(JSON.parse(files[backup]).mcpServers)).toEqual(['solid', 'solid-2', 'github']);
    expect(Object.keys(JSON.parse(files['/h/.cursor/mcp.json']).mcpServers)).toEqual(['github']);
    expect(done.map((d) => d.name)).toEqual(['solid', 'solid-2']);
  });
});
