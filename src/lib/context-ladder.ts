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

/** The spine fields that locate the owner's pinned-notes block. */
export interface SpinePinnedFields {
  content?: string;
  /** Exact heading line of the block inside `content` (backend ≥ 2026-09-23 late). */
  pinned_notes_heading?: string;
  /** Tag wrapping the notes, e.g. "business-pinned-notes". */
  pinned_notes_tag?: string;
  /** Older backends also sent the block on its own. Fallback only. */
  pinned_notes_markdown?: string;
}

const DEFAULT_PINNED_TAG = 'business-pinned-notes';

/**
 * The pinned-notes block, taken ONCE — from `content` when it is there.
 *
 * The backend puts the block inside the spine `content`. An older backend also
 * sent it separately as `pinned_notes_markdown`; printing both put the largest
 * thing in the spine into the session twice. So: slice it out of `content`
 * (heading line → closing tag, plus the overflow title list up to the next
 * `## ` heading) and use `pinned_notes_markdown` only when `content` does not
 * carry it. Empty string when there are no pinned notes.
 */
export function pinnedNotesFromSpine(spine: SpinePinnedFields | null | undefined): string {
  if (!spine) return '';
  const tag = spine.pinned_notes_tag || DEFAULT_PINNED_TAG;
  const content = spine.content || '';
  const lines = content.split('\n');
  const heading = spine.pinned_notes_heading?.trim();
  let start = heading ? lines.findIndex((l) => l.trim() === heading) : -1;
  if (start < 0) {
    // No heading field (or it moved): find the heading above the opening tag.
    const open = lines.findIndex((l) => l.trim().startsWith(`<${tag}`));
    if (open >= 0) {
      start = open;
      for (let i = open - 1; i >= 0; i--) {
        if (lines[i].startsWith('## ')) { start = i; break; }
      }
    }
  }
  if (start >= 0) {
    const hasClose = lines.slice(start).some((l) => l.trim() === `</${tag}>`);
    let closed = !hasClose;
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (!closed) {
        if (lines[i].trim() === `</${tag}>`) closed = true;
        continue; // a "## " inside a note body is not the end of the block
      }
      if (lines[i].startsWith('## ') || lines[i].startsWith('# ')) { end = i; break; }
    }
    const block = lines.slice(start, end).join('\n').trim();
    if (block) return block;
  }
  return (spine.pinned_notes_markdown || '').trim();
}

/**
 * What the Claude Code SessionStart hook (`solid install` →
 * `solid context --claude --raw --if-tenant`) prints. Hook stdout is handed to
 * the model as session context, so it carries the business's pinned notes
 * directly — they arrive even if Claude Code read CLAUDE.md before the hook
 * rewrote it — and nothing decorative (no boxes, no colour).
 */
export function hookSessionText(pinnedMarkdown: string | null | undefined, spinePath: string): string {
  const out: string[] = [];
  if (pinnedMarkdown && pinnedMarkdown.trim()) out.push(pinnedMarkdown.trim(), '');
  out.push(`Solid# context refreshed: ${spinePath} — run \`solid notes context\` for all work notes.`);
  return out.join('\n') + '\n';
}
