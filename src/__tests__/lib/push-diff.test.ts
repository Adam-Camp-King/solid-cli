/**
 * What `solid push --dry-run` says would change — lib/push-diff.ts. Pure.
 */
import { kbDiff, lines, pageDiff, show } from '../../lib/push-diff';

describe('pageDiff', () => {
  const remote = { title: 'Home', slug: 'home', meta_title: 'Old', is_published: true,
    layout_json: { sections: [{ type: 'hero', title: 'A' }, { type: 'cta', title: 'B' }] } };

  it('names each changed field with before and after', () => {
    const d = pageDiff({ ...remote, meta_title: 'New' }, remote);
    expect(d).toEqual([{ field: 'meta_title', before: 'Old', after: 'New' }]);
  });

  it('a layout with the same blocks but different words says the content changed', () => {
    const d = pageDiff({ layout_json: { sections: [{ type: 'hero', title: 'Z' }, { type: 'cta', title: 'B' }] } }, remote);
    expect(d[0].field).toBe('layout_json');
    expect(d[0].after).toBe('2 sections: hero, cta (content changed)');
  });

  it('a layout with different blocks shows both', () => {
    const d = pageDiff({ layout_json: { sections: [{ type: 'hero' }] } }, remote);
    expect(d[0]).toEqual({ field: 'layout_json', before: '2 sections: hero, cta', after: '1 section: hero' });
  });

  it('an identical file changes nothing, and the dry run says so', () => {
    expect(pageDiff({ ...remote }, remote)).toEqual([]);
    expect(lines([])[0]).toContain('no differences');
  });

  it('a new page is new', () => {
    expect(pageDiff({ title: 'About' }, null)[0].field).toBe('(new page)');
  });
});

describe('kbDiff', () => {
  it('compares title, category and content', () => {
    const d = kbDiff({ title: 'Hours', category: 'faqs', content: 'Open 8 to 6.' },
      { title: 'Hours', category: 'general', content: 'Open 8 to 5.' });
    expect(d.map((c) => c.field)).toEqual(['category', 'content']);
    expect(d[1].before).toBe('12 chars: Open 8 to 5.');
  });

  it('whitespace alone is not a change', () => {
    expect(kbDiff({ title: 'Hours', content: 'Open.\n' }, { title: 'Hours ', content: 'Open.' })).toEqual([]);
  });
});

describe('show', () => {
  it('clips long values to one line and names an empty one', () => {
    expect(show('a\n b')).toBe('a b');
    expect(show('x'.repeat(200)).length).toBe(70);
    expect(show(null)).toBe('(empty)');
    expect(show(true)).toBe('true');
  });
});
