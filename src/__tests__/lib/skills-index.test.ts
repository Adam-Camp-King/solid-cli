/**
 * The skills index — the thing that makes the platform teachable to an agent.
 *
 * ⛔ WHY THESE ASSERTIONS AND NOT "it writes a file". A skill is only useful if
 * a reader that knows nothing about us can pick it up, so the SHAPE is the
 * contract: a directory per skill under `.claude/skills/`, a `SKILL.md`, and
 * YAML frontmatter carrying `name` and `description`. Get any of that wrong and
 * the file is inert — no error, no warning, it is simply never loaded. That is
 * the failure mode worth a test.
 *
 * The second thing pinned here is that no skill teaches a command we do not
 * ship. An agent that runs `solid pin` on our advice, gets "unknown command",
 * and stops trusting the rest of the file is worse off than one we never
 * taught at all.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { SKILLS, installSkills } from '../../lib/skills/index';

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'solid-skills-'));
}

describe('skills index', () => {
  it('ships more than one skill, each with a unique directory', () => {
    expect(SKILLS.length).toBeGreaterThan(1);
    const names = SKILLS.map((s) => s.dirname);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every skill carries frontmatter a standard reader can parse', () => {
    for (const skill of SKILLS) {
      const lines = skill.content.split('\n');
      expect(lines[0]).toBe('---');
      const close = lines.indexOf('---', 1);
      expect(close).toBeGreaterThan(1);
      const fm = lines.slice(1, close).join('\n');
      // `name` must match the directory: a reader keys on the directory, a
      // human reads the frontmatter, and a mismatch makes them disagree.
      expect(fm).toContain(`name: ${skill.dirname}`);
      expect(fm).toMatch(/^description: .+/m);
    }
  });

  it('every description says WHEN to use the skill, not just what it is', () => {
    // A description is the only thing an agent reads before deciding to open
    // the file. "Commerce helpers" earns no opens; "use whenever building a
    // website in this directory" does.
    for (const skill of SKILLS) {
      const m = skill.content.match(/^description: (.+)$/m);
      expect(m).not.toBeNull();
      expect((m as RegExpMatchArray)[1].length).toBeGreaterThan(40);
    }
  });

  it('no skill teaches a command the CLI does not ship', () => {
    // ⛔ Scrape CODE only — fenced blocks and inline backticks — never prose.
    // An earlier version scanned the whole body and flagged "solid command you
    // have not run", which is English, not an instruction. A guard that cries
    // wolf on prose gets muted, and then it is not guarding anything.
    const REAL = new Set([
      'schema', 'scope', 'doctor', 'forms', 'embed', 'chat-widgets',
      'pull', 'switch', 'agent', 'context', 'apply', 'publish', 'domains',
    ]);
    const bad: string[] = [];
    for (const skill of SKILLS) {
      const code: string[] = [];
      for (const m of skill.content.matchAll(/```[a-z]*\n([\s\S]*?)```/g)) code.push(m[1]);
      for (const m of skill.content.matchAll(/`([^`\n]+)`/g)) code.push(m[1]);
      for (const chunk of code) {
        for (const m of chunk.matchAll(/\bsolid\s+([a-z][a-z-]*)/g)) {
          if (!REAL.has(m[1])) bad.push(`${skill.dirname}: "solid ${m[1]}"`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('installSkills', () => {
  it('writes the standard layout: .claude/skills/<name>/SKILL.md', () => {
    const dir = tmpdir();
    const out = installSkills(dir);
    expect(out).toHaveLength(SKILLS.length);
    for (const r of out) {
      expect(r.path).toBe(path.join(dir, '.claude', 'skills', r.dirname, 'SKILL.md'));
      expect(fs.existsSync(r.path)).toBe(true);
      expect(r.state).toBe('written');
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('is idempotent — a second run rewrites nothing', () => {
    const dir = tmpdir();
    installSkills(dir);
    const second = installSkills(dir);
    expect(second.every((r) => r.state === 'unchanged')).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rewrites a file that has drifted', () => {
    const dir = tmpdir();
    const [first] = installSkills(dir);
    fs.writeFileSync(first.path, 'clobbered');
    const again = installSkills(dir);
    expect(again[0].state).toBe('written');
    expect(fs.readFileSync(first.path, 'utf8')).toBe(SKILLS[0].content);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('does not copy the commerce skill — it imports the one source of truth', async () => {
    // Two files claiming to be the same skill is worse than one stale file:
    // whichever wrote last silently wins and nobody can tell which is live.
    const { COMMERCE_SKILL_CONTENT } = await import('../../lib/commerce-skill');
    const commerce = SKILLS.find((s) => s.dirname === 'solid-commerce');
    expect(commerce).toBeDefined();
    expect(commerce!.content).toBe(COMMERCE_SKILL_CONTENT);
  });
});
