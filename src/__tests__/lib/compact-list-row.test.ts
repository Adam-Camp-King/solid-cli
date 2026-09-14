/**
 * A list answers "what exists" — it is not a place to ship documents.
 *
 * Measured on a real tenant: `solid pages list --json` returned 12,108 bytes
 * for six rows. Each row carried 49 fields of which 25 were null, and
 * `layout_json` — every section and every paragraph of body prose — was
 * inlined at 1,668 of one row's 2,893 bytes. A caller asking which pages exist
 * paid to receive, and then to parse, the contents of all of them.
 *
 * Compacted: 3,678 bytes, 24 fields. `--full` returns the original.
 *
 * ⛔ The rule that matters most here is the falsy one. Dropping `null` is safe
 * — absence says the same thing. Dropping anything falsy is NOT: it would
 * remove `is_published: false` and make a draft indistinguishable from a page
 * that never reported its status, which is the exact class of silent wrongness
 * this surface keeps producing.
 */
import { compactListRow } from '../../lib/command-kit';

describe('compactListRow', () => {
  describe('what it drops', () => {
    it('drops nulls — the key\'s absence says the same thing', () => {
      const out = compactListRow({ id: 1, kb_id: null, survey_id: null });
      expect(out).toEqual({ id: 1 });
    });

    it('drops undefined the same way', () => {
      const out = compactListRow({ id: 1, customer_id: undefined });
      expect(out).toEqual({ id: 1 });
    });

    it('drops document bodies and names them', () => {
      const out = compactListRow({
        id: 1,
        title: 'Home',
        layout_json: { sections: [{ type: 'hero', body: 'a very long page' }] },
      });
      expect(out.layout_json).toBeUndefined();
      // ⛔ Named, not silently gone: silence reads as "this page has no
      // layout", which is a different and wrong answer.
      expect(out._omitted).toEqual(['layout_json']);
    });

    it('names every omitted body, not just the first', () => {
      const out = compactListRow({
        id: 1, layout_json: {}, custom_head: '<style>…</style>', content: 'prose',
      });
      expect(out._omitted).toEqual(expect.arrayContaining(['layout_json', 'custom_head', 'content']));
    });
  });

  describe('what it must never drop', () => {
    it('keeps false — a draft is not a page with no status', () => {
      const out = compactListRow({ id: 1, is_published: false });
      expect(out).toHaveProperty('is_published', false);
    });

    it('keeps zero', () => {
      const out = compactListRow({ id: 1, page_views: 0 });
      expect(out).toHaveProperty('page_views', 0);
    });

    it('keeps the empty string', () => {
      // "" is a value someone set; null is nobody setting it.
      const out = compactListRow({ id: 1, description: '' });
      expect(out).toHaveProperty('description', '');
    });

    it('keeps empty arrays and objects', () => {
      const out = compactListRow({ id: 1, tags: [], meta: {} });
      expect(out).toHaveProperty('tags', []);
      expect(out).toHaveProperty('meta', {});
    });
  });

  describe('shape', () => {
    it('adds no _omitted key when nothing was omitted', () => {
      const out = compactListRow({ id: 1, title: 'Home' });
      expect(out).not.toHaveProperty('_omitted');
    });

    it('leaves an already-lean row untouched', () => {
      const row = { id: 1, slug: 'home', is_published: true };
      expect(compactListRow(row)).toEqual(row);
    });

    it('does not mutate its input', () => {
      const row: Record<string, unknown> = { id: 1, kb_id: null };
      compactListRow(row);
      expect(row).toHaveProperty('kb_id', null);
    });
  });
});
