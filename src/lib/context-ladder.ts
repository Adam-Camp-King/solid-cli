/**
 * Pure helpers for the Dewey-classified context library on the CLI side.
 *
 * Lives in `lib/` (not `commands/`) so the helpers can be unit-tested
 * without pulling in the command module's ESM-only deps (`ora`, `chalk`).
 *
 * See: Owners-Manual/99-Active-Sprints/SPRINT-CONTEXT-LIBRARY-DDC.md
 */
import * as fs from 'fs';
import * as path from 'path';

export interface LadderWriteResult {
  spinePath: string;
  spineBytes: number;
  libraryDir: string;
  shelfPaths: string[];
  shelfBytes: number;
  shelfCount: number;
}

const STALE_SHELF_RX = /^(\d{3})-[a-z0-9-]+\.md$/;

/**
 * Derive the slug for a shelf filename from its markdown frontmatter.
 * The backend authoritatively sets `slug:` in the YAML header of every
 * rendered shelf; we extract it so the filename matches what the spine
 * references (`.claude/library/<NNN>-<slug>.md`). Falls back to a
 * hyphenated DDC code if the header is malformed.
 */
export function slugForDdc(ddc: string, shelfMarkdown: string): string {
  const m = shelfMarkdown.match(/^slug:\s*([a-z0-9-]+)\s*$/m);
  return m ? m[1] : `shelf-${ddc}`;
}

/**
 * Write the spine + one file per shelf under baseDir/.claude.
 * The library dir is emptied of prior `NNN-*.md` shelf files before
 * writing — stale shelves (whose category no longer has entries) get
 * cleaned up so the classification table in the spine stays consistent
 * with what's actually on disk.
 *
 * Non-shelf files (anything not matching `NNN-<slug>.md`) are left
 * alone — the user may have hand-authored notes in `.claude/library/`.
 */
export function writeLadder(
  spine: string,
  shelves: Record<string, string>,
  baseDir: string,
): LadderWriteResult {
  const claudeDir = path.resolve(baseDir, '.claude');
  const libraryDir = path.join(claudeDir, 'library');
  if (!fs.existsSync(claudeDir)) fs.mkdirSync(claudeDir, { recursive: true });
  if (!fs.existsSync(libraryDir)) fs.mkdirSync(libraryDir, { recursive: true });

  const fresh = new Set(
    Object.keys(shelves).map((ddc) => `${ddc}-${slugForDdc(ddc, shelves[ddc])}.md`),
  );
  for (const f of fs.readdirSync(libraryDir)) {
    const m = f.match(STALE_SHELF_RX);
    if (m && !fresh.has(f)) {
      try { fs.unlinkSync(path.join(libraryDir, f)); } catch { /* best effort */ }
    }
  }

  const spinePath = path.join(claudeDir, 'CLAUDE.md');
  fs.writeFileSync(spinePath, spine);

  const shelfPaths: string[] = [];
  let shelfBytes = 0;
  for (const [ddc, md] of Object.entries(shelves)) {
    const slug = slugForDdc(ddc, md);
    const p = path.join(libraryDir, `${ddc}-${slug}.md`);
    fs.writeFileSync(p, md);
    shelfPaths.push(p);
    shelfBytes += Buffer.byteLength(md, 'utf-8');
  }

  return {
    spinePath,
    spineBytes: Buffer.byteLength(spine, 'utf-8'),
    libraryDir,
    shelfPaths: shelfPaths.sort(),
    shelfBytes,
    shelfCount: shelfPaths.length,
  };
}
