/**
 * `solid mcp connect` — the command that exists so a new user never dead-ends.
 *
 * The bug it replaces: install.sh claimed to "wire Claude Code", which runs
 * `claude mcp add` and no-ops SILENTLY when `claude` is absent. The user typed
 * `claude`, got `command not found`, and had nothing to go on — while the
 * hosted connector would have worked with nothing installed at all.
 *
 * So these tests are mostly about the unhappy paths, because the happy path was
 * never the problem.
 */
import {
  AI_TOOLS,
  ALIASES,
  CONNECTOR_URL,
  findTool,
  toolIds,
} from '../lib/ai-tool-connect';

describe('the connector URL is the one integration', () => {
  it('is the hosted OAuth endpoint, not the stdio package', () => {
    expect(CONNECTOR_URL).toBe('https://api.solidnumber.com/mcp/connector');
  });

  it('every browser-based tool points at exactly that URL', () => {
    const browserTools = AI_TOOLS.filter((t) => t.transport === 'connector' && !t.requiresBinary);
    expect(browserTools.length).toBeGreaterThan(3);
    for (const tool of browserTools) {
      expect(tool.steps.join(' ')).toContain(CONNECTOR_URL);
    }
  });
});

describe('no user input dead-ends', () => {
  it.each(Object.keys(ALIASES))('alias %s resolves to a real tool', (alias) => {
    const tool = findTool(alias);
    expect(tool).toBeDefined();
    expect(toolIds()).toContain(tool!.id);
  });

  it('"gpt" resolves — it must never print "unknown tool"', () => {
    expect(findTool('gpt')?.id).toBe('chatgpt');
  });

  it('is case- and whitespace-forgiving', () => {
    expect(findTool('  GPT ')?.id).toBe('chatgpt');
  });

  it('there is a catch-all for tools we have never heard of', () => {
    const other = findTool('other');
    expect(other).toBeDefined();
    expect(other!.steps.join(' ')).toContain(CONNECTOR_URL);
  });

  it('an unknown name is still resolvable to the generic recipe by the caller', () => {
    // findTool returns undefined so the command can say "no recipe for X" —
    // but the command is required to print CONNECTOR_URL anyway, so the
    // fallback stays an answer rather than an error.
    expect(findTool('some-tool-invented-tomorrow')).toBeUndefined();
    expect(findTool('other')).toBeDefined();
  });
});

describe('the prerequisite is stated, never assumed', () => {
  it('claude-code declares the binary it needs and how to get it', () => {
    const tool = findTool('claude-code')!;
    expect(tool.requiresBinary).toBe('claude');
    expect(tool.installHint).toContain('@anthropic-ai/claude-code');
  });

  it('claude-code says out loud that the installer does not install it', () => {
    const tool = findTool('claude-code')!;
    expect(tool.notes?.join(' ')).toMatch(/does NOT install it/i);
  });

  it('no browser tool claims a prerequisite it does not have', () => {
    for (const tool of AI_TOOLS.filter((t) => t.method === 'manual' && t.id !== 'claude-code')) {
      expect(tool.requiresBinary).toBeUndefined();
    }
  });
});

describe('the no-install path leads', () => {
  it('the first tool in the list needs nothing installed', () => {
    // Order is the product: a new user reads the first entry and stops.
    // Leading with a tool that must be installed is what produces the
    // `command not found` this command exists to prevent.
    expect(AI_TOOLS[0].requiresBinary).toBeUndefined();
    expect(AI_TOOLS[0].transport).toBe('connector');
  });
});

describe('every recipe is actually followable', () => {
  it.each(AI_TOOLS.map((t) => [t.id, t] as const))('%s has a label and ordered steps', (_id, tool) => {
    expect(tool.label.length).toBeGreaterThan(0);
    expect(tool.steps.length).toBeGreaterThan(0);
    for (const step of tool.steps) expect(step.trim().length).toBeGreaterThan(0);
  });

  it('config-based tools name the client file they write', () => {
    for (const tool of AI_TOOLS.filter((t) => t.method === 'config')) {
      expect(tool.client).toBeDefined();
      expect(tool.transport).toBe('stdio');
    }
  });

  it('ids are unique and alias targets all exist', () => {
    expect(new Set(toolIds()).size).toBe(toolIds().length);
    for (const target of Object.values(ALIASES)) {
      expect(toolIds()).toContain(target);
    }
  });
});
