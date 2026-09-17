import { planPublishAll } from '../../commands/publish';

describe('planPublishAll', () => {
  it('includes never-published pages, not just pending drafts', () => {
    const plan = planPublishAll(
      [{ page_id: 1, slug: 'home' }],
      [{ id: 2, slug: 'about', is_published: false }],
    );
    expect(plan).toEqual([
      { page_id: 1, slug: 'home', title: undefined, reason: 'pending_draft' },
      { page_id: 2, slug: 'about', title: undefined, reason: 'never_published' },
    ]);
  });

  it('reports a page that is both drafted and unpublished once, as pending_draft', () => {
    const plan = planPublishAll([{ page_id: 5 }], [{ id: 5, is_published: false }]);
    expect(plan).toHaveLength(1);
    expect(plan[0].reason).toBe('pending_draft');
  });

  it('ignores rows without ids and rows that are already published', () => {
    const plan = planPublishAll([{ slug: 'x' }], [{ slug: 'y' }, { id: 9, is_published: true }]);
    expect(plan).toEqual([]);
  });
});
