/**
 * What `solid push --dry-run` would change, field by field.
 *
 * ⛔ WHY. The dry run named FILES. Every file the manifest knows is listed as an update
 * whether or not a byte differs, so "~ pages/home.json" told nobody what would happen to
 * the page. This compares each file with the record it would overwrite and says
 * before → after per field — and says so when a file would change nothing.
 *
 * Pure: the remote record is an argument.
 */
export interface FieldChange { field: string; before: string; after: string }

const CLIP = 70;
export function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '(empty)';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > CLIP ? `${one.slice(0, CLIP - 1)}…` : one;
}

const eq = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function sectionSummary(layout: any): string {
  const sections = Array.isArray(layout?.sections) ? layout.sections : [];
  if (!sections.length) return '(no sections)';
  return `${sections.length} section${sections.length === 1 ? '' : 's'}: ${sections.map((s: any) => s?.type || '?').join(', ')}`;
}

const PAGE_FIELDS = ['title', 'slug', 'meta_title', 'meta_description', 'is_published', 'is_landing_page', 'page_type'];

export function pageDiff(local: Record<string, any>, remote: Record<string, any> | null): FieldChange[] {
  if (!remote) return [{ field: '(new page)', before: '(none)', after: show(local.title || local.slug) }];
  const out: FieldChange[] = [];
  for (const f of PAGE_FIELDS) {
    if (f in local && !eq(local[f], remote[f])) out.push({ field: f, before: show(remote[f]), after: show(local[f]) });
  }
  if ('layout_json' in local && !eq(local.layout_json, remote.layout_json)) {
    const before = sectionSummary(remote.layout_json);
    const after = sectionSummary(local.layout_json);
    out.push({ field: 'layout_json', before, after: before === after ? `${after} (content changed)` : after });
  }
  return out;
}

export function kbDiff(local: { title?: string; content?: string; category?: string },
  remote: Record<string, any> | null): FieldChange[] {
  if (!remote) return [{ field: '(new entry)', before: '(none)', after: show(local.title) }];
  const out: FieldChange[] = [];
  for (const f of ['title', 'category'] as const) {
    if (local[f] != null && (local[f] || '').trim() !== String(remote[f] ?? '').trim()) {
      out.push({ field: f, before: show(remote[f]), after: show(local[f]) });
    }
  }
  const a = (local.content || '').trim();
  const b = String(remote.content ?? '').trim();
  if (a !== b) out.push({ field: 'content', before: `${b.length} chars: ${show(b)}`, after: `${a.length} chars: ${show(a)}` });
  return out;
}

export function lines(changes: FieldChange[], indent = '        '): string[] {
  if (!changes.length) return [`${indent}(no differences — pushing it changes nothing)`];
  return changes.map((c) => `${indent}${c.field}: ${c.before}  →  ${c.after}`);
}
