/**
 * llms-txt-drift — guard test for stale numbers in llms.txt.
 *
 * llms.txt is the canonical entry point for AI agents discovering the
 * platform. If it advertises stale verb/command counts, LLMs form
 * wrong recommendations. This test catches drift before it ships.
 *
 * Checks solid-public/public/llms.txt against the built CLI's
 * schema verbs surface. If solid-public isn't checked out (CI where
 * only solid-cli is present), the test is skipped.
 *
 * See also: marketing-numbers-drift.test.ts (guards README.md).
 * Structural fix: scripts/sync-discovery-numbers.py auto-patches.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

const root = path.join(__dirname, '..', '..', '..');
const distEntry = path.join(root, 'dist', 'index.js');
const llmsTxt = path.join(root, '..', 'solid-public', 'public', 'llms.txt');

const distExists = fs.existsSync(distEntry);
const llmsExists = fs.existsSync(llmsTxt);
const describeOrSkip = distExists && llmsExists ? describe : describe.skip;

describeOrSkip('llms-txt-drift', () => {
  const content = fs.readFileSync(llmsTxt, 'utf-8');

  const out = execFileSync(
    'node',
    [distEntry, 'schema', 'verbs', '--json'],
    {
      env: { ...process.env, SOLID_SKIP_VERSION_CHECK: '1', SOLID_NO_TENANT_WARN: '1' },
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );
  const manifest: { verbs: Array<{ depth: number }> } = JSON.parse(out);
  const topLevel = manifest.verbs.filter((v) => v.depth === 0).length;

  it('CLI top-level command count matches llms.txt banner', () => {
    const match = content.match(/\*\*(\d+) top-level commands/);
    expect(match).not.toBeNull();
    const claimed = parseInt(match![1], 10);
    expect(claimed).toBe(topLevel);
  });

  it('CLI verb count in llms.txt is within bounds', () => {
    const match = content.match(/\*\*\d+ top-level commands, (\d+) verbs/);
    expect(match).not.toBeNull();
    const claimed = parseInt(match![1], 10);
    const actual = manifest.verbs.length;
    expect(claimed).toBeLessThanOrEqual(actual);
    expect(claimed).toBeGreaterThanOrEqual(actual - 50);
  });
});
