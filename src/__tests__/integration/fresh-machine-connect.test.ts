/**
 * Phase 3 — the fresh machine. Prove the dead end is gone by reproducing it.
 *
 * The bug: install.sh claimed to "wire Claude Code", which runs `claude mcp
 * add` and no-ops SILENTLY when `claude` is absent. The user typed `claude`,
 * got `command not found`, and stopped — while the hosted connector would have
 * worked for them with nothing installed at all.
 *
 * A unit test over the tool table cannot catch a regression here, because the
 * failure was never in the data — it was in what the user SAW. So these spawn
 * the built CLI with `claude` stripped from PATH and read the actual output.
 *
 * Nothing here touches the network.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..');
const CLI_PATH = path.join(ROOT, 'dist', 'index.js');

/** PATH with no `claude` on it — a machine that has never installed Claude Code. */
const BARE_PATH = ['/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(path.delimiter);

function runBare(args: string[]): string {
  try {
    return execFileSync(process.execPath, [CLI_PATH, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: BARE_PATH,
        // Force the human-readable branch: the CLI emits JSON when stdout is
        // not a TTY, and a captured pipe is never a TTY.
        SOLID_NO_JSON: '1',
        NO_COLOR: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err: any) {
    // Some paths exit non-zero on purpose (unknown tool). We want the output.
    return `${err.stdout || ''}${err.stderr || ''}`;
  }
}

beforeAll(() => {
  if (!fs.existsSync(CLI_PATH)) {
    throw new Error(`dist/index.js missing — run \`npm run build\` first (${CLI_PATH})`);
  }
});

describe('a machine with no claude binary', () => {
  it('says claude is missing instead of silently doing nothing', () => {
    const out = runBare(['mcp', 'connect', 'claude-code']);
    expect(out).toMatch(/claude is not installed/i);
  });

  it('gives the exact line that installs it', () => {
    const out = runBare(['mcp', 'connect', 'claude-code']);
    expect(out).toContain('npm install -g @anthropic-ai/claude-code');
  });

  it('offers the path that needs nothing installed', () => {
    // The actual fix for most people. Without this the user is told to install
    // a second program to use a product that never required one.
    const out = runBare(['mcp', 'connect', 'claude-code']);
    expect(out).toContain('solid mcp connect claude-web');
  });

  it('does not claim "nothing to install" for a tool that needs a binary', () => {
    const out = runBare(['mcp', 'connect', 'claude-code']);
    expect(out).not.toMatch(/nothing to install/i);
    expect(out).toMatch(/requires claude/i);
  });

  it('marks it as not installed in the list too', () => {
    const out = runBare(['mcp', 'connect']);
    expect(out).toMatch(/claude-code.*not installed/is);
  });
});

describe('the no-install path leads', () => {
  it('lists browser tools before anything that must be installed', () => {
    const out = runBare(['mcp', 'connect']);
    const noInstall = out.indexOf('Nothing to install');
    const needsInstall = out.indexOf('Needs the tool installed');
    expect(noInstall).toBeGreaterThan(-1);
    expect(needsInstall).toBeGreaterThan(-1);
    // Order is the product: a new user reads the first block and stops.
    expect(noInstall).toBeLessThan(needsInstall);
  });

  it('puts the one URL above the fold', () => {
    const out = runBare(['mcp', 'connect']);
    expect(out).toContain('https://api.solidnumber.com/mcp/connector');
  });

  it('covers the tools that had no documented path at all', () => {
    const out = runBare(['mcp', 'connect']);
    for (const id of ['chatgpt', 'grok', 'genspark', 'manus']) {
      expect(out).toContain(id);
    }
  });
});

describe('a wrong guess costs one line, not a support ticket', () => {
  it('"gpt" is not an unknown tool', () => {
    const out = runBare(['mcp', 'connect', 'gpt']);
    expect(out).toMatch(/Connect ChatGPT/i);
    expect(out).not.toMatch(/No recipe/i);
  });

  it('a genuinely unknown tool still gets an answer, not just an error', () => {
    const out = runBare(['mcp', 'connect', 'some-agent-invented-tomorrow']);
    expect(out).toMatch(/No recipe/i);
    // The fallback must still be usable — for anything speaking MCP that URL
    // IS the integration.
    expect(out).toContain('https://api.solidnumber.com/mcp/connector');
  });

  it('`solid connect` points at the command people actually wanted', () => {
    // `connect` reads as "connect my AI" and means "import my data". The help
    // hands them the right one rather than renaming a shipped command.
    const out = runBare(['connect', '--help']);
    expect(out).toMatch(/connect an AI/i);
    expect(out).toContain('solid mcp connect');
  });
});

describe('the tenant-pinning trap is stated where it is acted on', () => {
  it('warns that the local server does not follow solid switch', () => {
    const out = runBare(['mcp', 'connect', 'cursor']);
    expect(out).toMatch(/does NOT move it|switch/i);
  });
});
