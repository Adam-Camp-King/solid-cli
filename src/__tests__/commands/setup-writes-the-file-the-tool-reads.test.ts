/**
 * ⛔⛔ THE FILE WE WRITE MUST BE THE FILE THE TOOL OPENS.
 *
 * 2026-09-17, the root cause of an entire evening. `solid setup` detected the
 * `claude` binary (Claude Code), printed "✓ Claude Code", and wrote the server
 * into Claude DESKTOP's claude_desktop_config.json — a file the terminal never
 * reads. The user's company-61 key landed there; his terminal had no Solid door
 * at all, so an account-level claude.ai connector bound to company 1 answered
 * instead, confidently, with write access.
 *
 * Every existing setup test passed through all of it, because they assert what
 * setup PRINTS. This asserts where the bytes go.
 */
import * as os from 'os';
import * as path from 'path';

import { EDITORS } from '../../commands/setup';
import { configPathForClient, isSupportedClient } from '../../lib/mcp-client-config';

const HOME = os.homedir();

function targetFor(binary: string): string {
  const editor = EDITORS.find((e: (typeof EDITORS)[number]) => e.binary === binary);
  if (!editor) throw new Error(`${binary} is not in EDITORS`);
  if (!isSupportedClient(editor.clientFlag)) {
    throw new Error(`${binary} maps to unsupported client '${editor.clientFlag}'`);
  }
  return configPathForClient(editor.clientFlag, { homeDir: HOME });
}

it('⛔ the `claude` binary is Claude Code — its server goes in ~/.claude.json', () => {
  expect(targetFor('claude')).toBe(path.join(HOME, '.claude.json'));
});

it('⛔ and NEVER into Claude Desktop, which the terminal does not read', () => {
  expect(targetFor('claude')).not.toMatch(/claude_desktop_config\.json$/);
});

it('the VS Code extension shares that same user-scope file', () => {
  expect(targetFor('code')).toBe(path.join(HOME, '.claude.json'));
});

it('every editor we claim to wire maps to a real client config path', () => {
  for (const e of EDITORS) {
    expect(isSupportedClient(e.clientFlag)).toBe(true);
    expect(targetFor(e.binary).length).toBeGreaterThan(0);
  }
});
