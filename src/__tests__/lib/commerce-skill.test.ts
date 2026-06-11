import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  installCommerceSkill,
  COMMERCE_SKILL_CONTENT,
  COMMERCE_SKILL_DIRNAME,
} from '../../lib/commerce-skill';

describe('commerce skill', () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'solid-skill-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('installs SKILL.md under .claude/skills/solid-commerce/', () => {
    const written = installCommerceSkill(tmp);
    expect(written).toBe(path.join(tmp, '.claude', 'skills', COMMERCE_SKILL_DIRNAME, 'SKILL.md'));
    expect(fs.readFileSync(written, 'utf-8')).toBe(COMMERCE_SKILL_CONTENT);
  });

  it('is idempotent — re-install overwrites cleanly', () => {
    installCommerceSkill(tmp);
    const written = installCommerceSkill(tmp);
    expect(fs.readFileSync(written, 'utf-8')).toBe(COMMERCE_SKILL_CONTENT);
  });

  it('has valid skill frontmatter and teaches the three embeds + apply', () => {
    expect(COMMERCE_SKILL_CONTENT.startsWith('---\nname: solid-commerce\n')).toBe(true);
    expect(COMMERCE_SKILL_CONTENT).toContain('description:');
    for (const cmd of ['solid embed form', 'solid embed chat', 'solid embed paylink',
                       'solid apply', 'solid publish --all',
                       '/api/v1/public/forms/<id>/submit']) {
      expect(COMMERCE_SKILL_CONTENT).toContain(cmd);
    }
    // financial human-in-loop is stated, never delegated to the model
    expect(COMMERCE_SKILL_CONTENT).toContain('Never compose that phrase yourself');
  });
});
