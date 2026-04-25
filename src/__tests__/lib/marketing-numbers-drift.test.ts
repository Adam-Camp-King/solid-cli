/**
 * marketing-numbers-drift — Phase 0.9 of SPRINT-JSONLD-GRAPH-MOAT.md.
 *
 * The README banner advertises CLI surface size (top-level commands +
 * subcommands). The actual surface is the program registry walked by
 * `solid schema verbs`. These two MUST agree, or our marketing copy is
 * lying about the product.
 *
 * Earlier this drifted to 86 / 200+ when reality was 96 / 691.
 * This test catches future drift before npm publish.
 *
 * Implementation: shell out to the built CLI's `schema verbs --json`
 * since reconstructing the program tree in-process pulls in command
 * modules with side effects (env reads, version-skew checks, etc.).
 * If `dist/` is missing the test is skipped — CI builds before testing,
 * and prepublishOnly builds before publishing, so drift can never ship.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

const root = path.join(__dirname, '..', '..', '..');
const distEntry = path.join(root, 'dist', 'index.js');
const readmePath = path.join(root, 'README.md');

const distExists = fs.existsSync(distEntry);
const describeOrSkip = distExists ? describe : describe.skip;

describeOrSkip('marketing-numbers-drift', () => {
  const readme = fs.readFileSync(readmePath, 'utf-8');

  // Run schema verbs against the built CLI so we see the real surface.
  // Use `node` directly with the bin entry; pass an env that prevents
  // the version-skew check from making a network call.
  const out = execFileSync(
    'node',
    [distEntry, 'schema', 'verbs', '--json'],
    {
      env: { ...process.env, SOLID_SKIP_VERSION_CHECK: '1', SOLID_JSON: '1' },
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );
  const manifest: { verbs: Array<{ depth: number }> } = JSON.parse(out);

  const topLevel = manifest.verbs.filter((v) => v.depth === 0).length;
  const subcommandCount = manifest.verbs.filter((v) => v.depth >= 1).length;

  it('README banner advertises actual top-level command count', () => {
    const match = readme.match(/(\d+)\s+top-level commands/);
    expect(match).not.toBeNull();
    const claimed = parseInt(match![1], 10);
    expect(claimed).toBe(topLevel);
  });

  it('README banner subcommand count is within bounds of actual surface', () => {
    // Format: "<N>+ subcommands". The N must be:
    //   - <= actual subcommand count (no overstating)
    //   - >= floor(actual / 100) * 100 (within 100 of reality)
    const match = readme.match(/(\d+)\+?\s+subcommands/);
    expect(match).not.toBeNull();
    const claimed = parseInt(match![1], 10);
    expect(claimed).toBeLessThanOrEqual(subcommandCount);
    expect(claimed).toBeGreaterThanOrEqual(Math.floor(subcommandCount / 100) * 100);
  });
});
