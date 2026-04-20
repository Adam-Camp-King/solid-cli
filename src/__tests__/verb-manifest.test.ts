/**
 * Unit tests for src/lib/verb-manifest.ts (Sprint 1 — T1.3).
 * Uses a synthetic Commander tree — no index.ts import, no I/O.
 */
import { Command, Argument } from 'commander';

import { buildVerbManifest, walkVerbs } from '../lib/verb-manifest';

function makeTree(): Command {
  const root = new Command('solid');
  // Top-level: solid pages
  const pages = root.command('pages').description('Manage pages');
  pages.command('list').description('List all pages').option('-l, --limit <n>', 'max results', '50');
  pages
    .command('update <id>')
    .description('Update a page')
    .option('--title <t>', 'New title')
    .option('--publish', 'Publish immediately');
  // Top-level: solid kb
  const kb = root.command('kb').description('Knowledge base');
  kb.command('search <query>').description('Search KB');
  // Hidden: solid internal
  const hidden = root.command('internal').description('Dev-only').addHelpText('before', '');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (hidden as any)._hidden = true;
  return root;
}

describe('walkVerbs', () => {
  it('returns every verb in the tree, skipRoot by default', () => {
    const tree = makeTree();
    const verbs = walkVerbs(tree);
    const paths = verbs.map((v) => v.path);
    expect(paths).toContain('solid pages');
    expect(paths).toContain('solid pages list');
    expect(paths).toContain('solid pages update');
    expect(paths).toContain('solid kb');
    expect(paths).toContain('solid kb search');
    // Root itself ("solid") is NOT emitted with skipRoot=true (default).
    expect(paths).not.toContain('solid solid');
    expect(paths).not.toContain('solid');
  });

  it('skips hidden commands unless includeHidden is set', () => {
    const tree = makeTree();
    expect(walkVerbs(tree).map((v) => v.verb)).not.toContain('internal');
    expect(walkVerbs(tree, { includeHidden: true }).map((v) => v.verb)).toContain('internal');
  });

  it('tracks depth correctly', () => {
    const tree = makeTree();
    const verbs = walkVerbs(tree);
    const pages = verbs.find((v) => v.path === 'solid pages');
    const pagesList = verbs.find((v) => v.path === 'solid pages list');
    expect(pages?.depth).toBe(0);
    expect(pagesList?.depth).toBe(1);
  });

  it('marks leaves correctly', () => {
    const tree = makeTree();
    const verbs = walkVerbs(tree);
    expect(verbs.find((v) => v.path === 'solid pages')?.is_leaf).toBe(false);
    expect(verbs.find((v) => v.path === 'solid pages list')?.is_leaf).toBe(true);
  });

  it('captures options with flags + description', () => {
    const tree = makeTree();
    const verbs = walkVerbs(tree);
    const pagesList = verbs.find((v) => v.path === 'solid pages list')!;
    expect(pagesList.options).toHaveLength(1);
    expect(pagesList.options[0].flags).toBe('-l, --limit <n>');
    expect(pagesList.options[0].description).toBe('max results');
    expect(pagesList.options[0].default).toBe('50');
  });

  it('captures positional args', () => {
    const tree = makeTree();
    const verbs = walkVerbs(tree);
    const update = verbs.find((v) => v.path === 'solid pages update')!;
    expect(update.args.length).toBeGreaterThan(0);
    expect(update.args[0].name).toBe('id');
    expect(update.args[0].required).toBe(true);
  });

  it('captures variadic args when declared via Argument', () => {
    const root = new Command('solid');
    const cmd = root.command('run').description('Run a script');
    cmd.addArgument(new Argument('<script>', 'Script path'));
    cmd.addArgument(new Argument('[args...]', 'Forwarded args'));
    const verbs = walkVerbs(root);
    const run = verbs.find((v) => v.path === 'solid run')!;
    const variadic = run.args.find((a) => a.variadic);
    expect(variadic).toBeDefined();
    expect(variadic?.name).toBe('args');
  });

  it('custom prefix is respected', () => {
    const tree = makeTree();
    const verbs = walkVerbs(tree, { prefix: 'mycli' });
    expect(verbs.map((v) => v.path)).toContain('mycli pages list');
  });

  it('skipRoot=false emits the root too', () => {
    const tree = makeTree();
    const verbs = walkVerbs(tree, { skipRoot: false });
    expect(verbs[0].verb).toBe('solid');
    expect(verbs[0].depth).toBe(0);
  });

  it('is stable across repeated calls (no mutation)', () => {
    const tree = makeTree();
    const first = walkVerbs(tree);
    const second = walkVerbs(tree);
    expect(first).toEqual(second);
  });

  it('handles an empty tree', () => {
    const empty = new Command('solid');
    expect(walkVerbs(empty)).toEqual([]);
  });
});

describe('buildVerbManifest', () => {
  it('wraps walkVerbs output in the wire shape', () => {
    const tree = makeTree();
    const manifest = buildVerbManifest(tree, '1.10.0-test');
    expect(manifest.version).toBe('1.0');
    expect(manifest.cli_version).toBe('1.10.0-test');
    expect(manifest.count).toBe(manifest.verbs.length);
    expect(manifest.count).toBeGreaterThan(0);
  });

  it('count matches verbs.length exactly', () => {
    const tree = makeTree();
    const m = buildVerbManifest(tree, '1.0.0');
    expect(m.count).toBe(m.verbs.length);
  });
});
