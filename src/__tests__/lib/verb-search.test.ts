/**
 * Ranking is the whole product of `solid find`, so it is tested on its own.
 *
 * Sprint VNP 2.1. These assertions are about behaviour an agent depends on,
 * not about exact scores — the weights will get tuned and that should not
 * break the suite. What must hold: the right verb ranks first, a read is never
 * confused for the write it previews, and duplicate pairs do not eat the
 * result slots.
 */
import { rankVerbs, terms, clip, type SearchableVerb } from '../../lib/verb-search';

const CORPUS: SearchableVerb[] = [
  {
    name: 'payment.refund',
    description: 'Refund a captured payment, full or partial.',
    side_effects: 'write',
  },
  {
    name: 'payments.preview_refund_impact',
    description: 'Project the impact of refunding a transaction WITHOUT executing it.',
    side_effects: 'read',
  },
  {
    name: 'appointment.book',
    description: 'Book an appointment for a service.',
    side_effects: 'write',
  },
  {
    name: 'appointment_book',
    description: "Book an appointment on the company's calendar.",
    side_effects: 'write',
    same_as: 'appointment.book',
  },
  {
    name: 'contact.create',
    description: 'Create a contact. Email or phone required.',
    side_effects: 'write',
  },
  {
    name: 'blog.publish',
    description: 'Publish a blog post.',
    side_effects: 'write',
  },
];

describe('terms', () => {
  it('drops stopwords and single characters', () => {
    expect(terms('refund a payment')).toEqual(['refund', 'payment']);
    expect(terms('how do I book an appointment')).toEqual(['book', 'appointment']);
  });

  it('is empty for a query with no signal', () => {
    expect(terms('the and of')).toEqual([]);
    expect(terms('')).toEqual([]);
  });
});

describe('rankVerbs', () => {
  it('puts the obvious verb first', () => {
    expect(rankVerbs('refund a payment', CORPUS)[0].name).toBe('payment.refund');
    expect(rankVerbs('book an appointment', CORPUS)[0].name).toBe('appointment.book');
    expect(rankVerbs('create a contact', CORPUS)[0].name).toBe('contact.create');
  });

  it('ranks the write above the read that only previews it', () => {
    // Both mention refunds. The one NAMED refund is the one meant.
    const [first, second] = rankVerbs('refund a payment', CORPUS);
    expect(first.name).toBe('payment.refund');
    expect(second.name).toBe('payments.preview_refund_impact');
    expect(first.score).toBeGreaterThan(second.score);
  });

  it('collapses a duplicate pair to its canonical half', () => {
    // appointment.book and appointment_book are one operation on two
    // transports. Returning both spends two slots handing the agent the exact
    // coin-flip that same_as exists to remove.
    const names = rankVerbs('book an appointment', CORPUS).map((m) => m.name);
    expect(names).toContain('appointment.book');
    expect(names).not.toContain('appointment_book');
  });

  it('collapses by name shape even when same_as is absent', () => {
    // Production has not been deployed with same_as yet, so the fallback has
    // to work: dots-to-underscores is how the 71 pairs were counted.
    const noLink = CORPUS.map(({ same_as: _drop, ...rest }) => rest);
    const names = rankVerbs('book an appointment', noLink).map((m) => m.name);
    expect(names.filter((n) => n.replace('.', '_') === 'appointment_book')).toHaveLength(1);
  });

  it('returns nothing rather than noise when nothing matches', () => {
    // A ranked list of things that do not match is worse than an empty one —
    // it invites a confident wrong pick.
    expect(rankVerbs('xyzzy plugh', CORPUS)).toEqual([]);
    expect(rankVerbs('the and of', CORPUS)).toEqual([]);
  });

  it('prefers a verb matching every term over one matching a single term loudly', () => {
    const matches = rankVerbs('refund payment', CORPUS);
    expect(matches[0].name).toBe('payment.refund');
  });

  it('respects the limit', () => {
    expect(rankVerbs('book appointment contact refund publish', CORPUS, 2)).toHaveLength(2);
  });

  it('scores are bounded 0..1', () => {
    for (const m of rankVerbs('refund a payment', CORPUS)) {
      expect(m.score).toBeGreaterThan(0);
      expect(m.score).toBeLessThanOrEqual(1);
    }
  });

  it('carries the read/write signal through, since it gates safety', () => {
    const m = rankVerbs('refund a payment', CORPUS)[0];
    expect(m.side_effects).toBe('write');
  });
});

describe('clip', () => {
  it('leaves short text alone', () => {
    expect(clip('short', 90)).toBe('short');
  });

  it('cuts on a word boundary and marks the cut', () => {
    const out = clip('the quick brown fox jumps over the lazy dog and keeps running onward', 30);
    expect(out.length).toBeLessThanOrEqual(31);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/\s…$/);
  });
});
