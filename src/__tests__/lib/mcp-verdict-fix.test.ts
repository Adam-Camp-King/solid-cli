/**
 * `solid mcp doctor` must show, for a wrong-company or duplicated connection,
 * which company each entry serves and the exact command that repairs it.
 */
import { assessProviders, renderProviderVerdict, verdictFixCommands, repointCommand, type SolidProvider } from '../../lib/mcp-providers';

const plain = (lines: string[]) => lines.join('\n').replace(/\x1b\[[0-9;]*m/g, '');
const p = (o: Partial<SolidProvider>): SolidProvider => ({
  name: 'solid', scope: 'user', transport: 'stdio', target: 'npx -y @solidnumber/mcp@latest',
  active: true, companyId: null, cliCanRepoint: true, ...o,
} as SolidProvider);

test('Claude Code entry on another company: mismatch names both companies and the install command', () => {
  const a = assessProviders([p({ client: 'vscode', configPath: '/h/.claude.json', companyId: 1, companyName: 'SolidNumber' })], 61);
  expect(a.verdict).toBe('mismatch');
  const text = plain(renderProviderVerdict(a));
  expect(text).toMatch(/This session:\s+company 61/);
  expect(text).toMatch(/company 1 \(SolidNumber\)/);
  expect(text).toContain('Fix: solid mcp install vscode');
  expect(verdictFixCommands(a)).toEqual(['solid mcp install vscode']);
});

test('conflict: session company, each entry\'s company, and the exact commands', () => {
  const a = assessProviders([
    p({ client: 'vscode', configPath: '/h/.claude.json', companyId: 1 }),
    p({ client: 'claude', configPath: '/h/desktop.json', companyId: 61 }),
  ], 61);
  expect(a.verdict).toBe('conflict');
  const text = plain(renderProviderVerdict(a));
  expect(text).toContain('This CLI session: company 61');
  expect(text).toMatch(/company 1\s+≠ this session \(company 61\)/);
  expect(text).toContain('solid mcp doctor --fix');
  expect(text).toContain('solid mcp install vscode');
  expect(text).not.toContain('solid mcp install claude');
  expect(verdictFixCommands(a)).toEqual(['solid mcp doctor --fix', 'solid mcp install vscode']);
});

test('an account connector has no CLI repoint command', () => {
  expect(repointCommand(p({ scope: 'account', cliCanRepoint: false }))).toBeNull();
});
