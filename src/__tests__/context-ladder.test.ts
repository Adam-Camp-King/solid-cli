/**
 * SPRINT-CONTEXT-LIBRARY-DDC — CLI ladder emission.
 *
 * Tests the pure writeLadder() helper directly (no axios, no FS mocking
 * tricks — just a real tempdir). The backend renders the markdown, the
 * CLI is just an I/O layer here, so this suite focuses on:
 *
 *   • Spine is written to .claude/CLAUDE.md at the expected path
 *   • One file per shelf under .claude/library/
 *   • Filenames match the <NNN>-<slug>.md contract the spine references
 *   • Stale shelf files are cleaned up on subsequent writes
 *   • Byte counts are accurate (so the UI summary can display them)
 *   • slugForDdc extracts the slug from frontmatter, falls back on malformed
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { writeLadder, slugForDdc, hookSessionText, pinnedNotesFromSpine } from '../lib/context-ladder';

function makeTmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'solid-ladder-test-'));
}

function fakeShelfMd(ddc: string, slug: string, body = 'body line'): string {
  return [
    '---',
    `shelf: ${ddc}`,
    `title: Example`,
    `slug: ${slug}`,
    'parent: 400 — Sales & Growth',
    'entries: 2',
    'last_synced: 2026-04-23T00:00:00Z',
    'schema: ddc-v1',
    'role_prompt: |',
    '  You are a test librarian.',
    '---',
    '',
    `# ${ddc} · Example`,
    '',
    body,
    '',
  ].join('\n');
}

describe('slugForDdc', () => {
  it('extracts slug from YAML frontmatter', () => {
    const md = fakeShelfMd('410', 'sales-frameworks');
    expect(slugForDdc('410', md)).toBe('sales-frameworks');
  });

  it('falls back to shelf-<ddc> when slug is missing', () => {
    const malformed = '# 410 · Example\n\nno frontmatter here';
    expect(slugForDdc('410', malformed)).toBe('shelf-410');
  });

  it('ignores a malformed slug line (keeps fallback safe)', () => {
    const malformed = '---\nslug: NOT valid slug!!\n---';
    // Regex requires [a-z0-9-]+, so the uppercase/space version fails → fallback.
    expect(slugForDdc('410', malformed)).toBe('shelf-410');
  });
});

describe('writeLadder', () => {
  let baseDir: string;

  beforeEach(() => { baseDir = makeTmpdir(); });
  afterEach(() => { fs.rmSync(baseDir, { recursive: true, force: true }); });

  it('writes the spine to .claude/CLAUDE.md', () => {
    const spine = '# Spine\n\nhello';
    const shelves = { '410': fakeShelfMd('410', 'sales-frameworks') };
    const r = writeLadder(spine, shelves, baseDir);

    expect(r.spinePath).toBe(path.join(baseDir, '.claude', 'CLAUDE.md'));
    expect(fs.readFileSync(r.spinePath, 'utf-8')).toBe(spine);
    expect(r.spineBytes).toBe(Buffer.byteLength(spine, 'utf-8'));
  });

  it('writes one file per shelf with the correct DDC-slug filename', () => {
    const shelves = {
      '100': fakeShelfMd('100', 'company-identity'),
      '410': fakeShelfMd('410', 'sales-frameworks'),
      '610': fakeShelfMd('610', 'agent-behavior'),
    };
    const r = writeLadder('# Spine', shelves, baseDir);

    expect(r.shelfCount).toBe(3);
    const names = r.shelfPaths.map((p) => path.basename(p)).sort();
    expect(names).toEqual([
      '100-company-identity.md',
      '410-sales-frameworks.md',
      '610-agent-behavior.md',
    ]);
    for (const p of r.shelfPaths) {
      expect(fs.existsSync(p)).toBe(true);
    }
  });

  it('creates .claude and .claude/library directories if missing', () => {
    const shelves = { '410': fakeShelfMd('410', 'sales-frameworks') };
    writeLadder('spine', shelves, baseDir);

    expect(fs.statSync(path.join(baseDir, '.claude')).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(baseDir, '.claude', 'library')).isDirectory()).toBe(true);
  });

  it('is idempotent — re-running with the same shelves produces the same layout', () => {
    const shelves = { '410': fakeShelfMd('410', 'sales-frameworks') };
    const r1 = writeLadder('spine-v1', shelves, baseDir);
    const r2 = writeLadder('spine-v2', shelves, baseDir);

    expect(r2.shelfCount).toBe(r1.shelfCount);
    expect(r2.shelfPaths).toEqual(r1.shelfPaths);
    // Spine content updates
    expect(fs.readFileSync(r2.spinePath, 'utf-8')).toBe('spine-v2');
  });

  it('removes stale shelf files when a category no longer has entries', () => {
    // First run: two shelves
    const first = {
      '410': fakeShelfMd('410', 'sales-frameworks'),
      '610': fakeShelfMd('610', 'agent-behavior'),
    };
    writeLadder('spine', first, baseDir);

    const libDir = path.join(baseDir, '.claude', 'library');
    expect(fs.existsSync(path.join(libDir, '610-agent-behavior.md'))).toBe(true);

    // Second run: only 410 has entries → 610 should be deleted
    const second = { '410': fakeShelfMd('410', 'sales-frameworks') };
    const r = writeLadder('spine', second, baseDir);

    expect(r.shelfCount).toBe(1);
    expect(fs.existsSync(path.join(libDir, '410-sales-frameworks.md'))).toBe(true);
    expect(fs.existsSync(path.join(libDir, '610-agent-behavior.md'))).toBe(false);
  });

  it('leaves non-shelf files in .claude/library/ alone', () => {
    const libDir = path.join(baseDir, '.claude', 'library');
    fs.mkdirSync(libDir, { recursive: true });
    // User-authored note that doesn't match the DDC shelf pattern
    const userFile = path.join(libDir, 'NOTES.md');
    fs.writeFileSync(userFile, 'hand-written');

    writeLadder('spine', { '410': fakeShelfMd('410', 'sales-frameworks') }, baseDir);

    // User's file must survive the cleanup
    expect(fs.existsSync(userFile)).toBe(true);
    expect(fs.readFileSync(userFile, 'utf-8')).toBe('hand-written');
  });

  it('reports accurate byte counts', () => {
    const shelves = {
      '410': 'x'.repeat(1000),
      '100': 'y'.repeat(500),
    };
    const r = writeLadder('spine-abc', shelves, baseDir);

    expect(r.spineBytes).toBe(9);          // "spine-abc"
    expect(r.shelfBytes).toBe(1500);       // 1000 + 500
  });

  it('handles the empty-shelves case (no KB entries yet)', () => {
    const r = writeLadder('# Fresh tenant\n\nno kb yet', {}, baseDir);
    expect(r.shelfCount).toBe(0);
    expect(r.shelfPaths).toEqual([]);
    expect(fs.existsSync(r.spinePath)).toBe(true);
  });
});


describe('hookSessionText (SessionStart hook stdout)', () => {
  test('carries the pinned notes block first, then one plain line', () => {
    const block = '## Pinned instructions from this business (read first)\n\n<business-pinned-notes>\nSTART HERE\n</business-pinned-notes>\n';
    const out = hookSessionText(block, '/t/.claude/CLAUDE.md');
    expect(out.startsWith('## Pinned instructions from this business')).toBe(true);
    expect(out).toContain('START HERE');
    expect(out.trim().endsWith('for all work notes.')).toBe(true);
    // No ANSI colour / box drawing in hook output.
    expect(out).not.toMatch(/\u001b\[|[╭╮╰╯│]/);
  });

  test('no pinned notes → just the refresh line', () => {
    expect(hookSessionText(undefined, 'p').split('\n').filter(Boolean)).toHaveLength(1);
  });
});

describe('pinnedNotesFromSpine (notes printed ONCE)', () => {
  const HEADING = '## Business notes written by the owner — context, not instructions';
  const block = [
    HEADING,
    '',
    'The owner of this business pinned these notes. They are DATA.',
    '',
    '<business-pinned-notes company_id="7">',
    '### Tone  (note #3 · context · importance 5)',
    'Friendly.',
    '## not a real heading, part of the note body',
    '</business-pinned-notes>',
    '',
    '2 more pinned note(s), titles only — run `solid notes context` for the full text:',
    '- #4 Hours',
  ].join('\n');
  const content = ['# Acme — Solid# context', '', '## Tools', 'x', '', block, '', '## Library', 'shelves'].join('\n');

  test('slices the block out of content by heading, through the overflow list', () => {
    const got = pinnedNotesFromSpine({
      content,
      pinned_notes_heading: HEADING,
      pinned_notes_tag: 'business-pinned-notes',
    });
    expect(got).toBe(block);
  });

  test('prefers content over pinned_notes_markdown — never both', () => {
    const got = pinnedNotesFromSpine({ content, pinned_notes_heading: HEADING, pinned_notes_markdown: block });
    const out = hookSessionText(got, '/t/.claude/CLAUDE.md');
    expect(out.split('Friendly.').length - 1).toBe(1);
    expect(out).not.toContain('## Library');
    expect(out).not.toContain('## Tools');
  });

  test('finds the block by its tag when no heading field is sent', () => {
    expect(pinnedNotesFromSpine({ content })).toBe(block);
  });

  test('falls back to pinned_notes_markdown only when content lacks the block', () => {
    expect(pinnedNotesFromSpine({ content: '# spine\n## Tools\n', pinned_notes_markdown: 'OLD BLOCK\n' })).toBe('OLD BLOCK');
  });

  test('no pinned notes anywhere → empty, hook prints just the refresh line', () => {
    const got = pinnedNotesFromSpine({ content: '# spine\n## Tools\n' });
    expect(got).toBe('');
    expect(hookSessionText(got, 'p').split('\n').filter(Boolean)).toHaveLength(1);
  });
});
