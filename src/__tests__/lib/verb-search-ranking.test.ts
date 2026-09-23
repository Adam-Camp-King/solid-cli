/**
 * The three things that took `find` from 8/20 to 13/20 on real prompts.
 *
 * Measured 2026-09-13 against the live 845-verb manifest, using 20 queries
 * lifted verbatim from the eval suite's 50 tasks:
 *
 *   baseline                      top-1  8/20   top-3 11/20
 *   + synonyms                    top-1 11/20   top-3 16/20
 *   + uncapped IDF                top-1 12/20   top-3 13/20   ← top-3 got WORSE
 *   + capped IDF, values dropped  top-1 13/20   top-3 16/20
 *
 * The middle row is why the cap exists and why it is not a magic number.
 * `scripts/rank-bench.mjs` re-runs the measurement.
 *
 * These are unit tests over a fixture, not the live manifest: the behaviours
 * below must hold regardless of what the registry happens to contain.
 */
import { rankVerbs, terms } from '../../lib/verb-search';

const V = (name: string, description = '') => ({ name, description, side_effects: 'read' });

describe('owner vocabulary reaches platform vocabulary', () => {
  // The failure that started it: the owner says "customer", the verb says
  // "contact"; the owner says "add", the verb says "create". Neither query
  // term appeared anywhere in contact.create, so it scored ZERO while a verb
  // literally named *_add won on a whole-segment match.
  const corpus = [
    V('contact.create', 'Create a contact. Email or phone required.'),
    V('phone.external_add', 'Add an external phone number to the switchboard.'),
    V('page.create', 'Create a page.'),
  ];

  it('"add a new customer" reaches contact.create, not phone.external_add', () => {
    expect(rankVerbs('Add a new customer', corpus, 3)[0].name).toBe('contact.create');
  });

  it('still prefers the literal word over the synonym', () => {
    // A synonym is weaker evidence than what the caller actually typed, or
    // "create" would beat "add" on a verb named *_add.
    const r = rankVerbs('add an external phone number', corpus, 3);
    expect(r[0].name).toBe('phone.external_add');
  });

  it('leaves a query with no synonyms untouched', () => {
    expect(rankVerbs('create a page', corpus, 3)[0].name).toBe('page.create');
  });
});

describe('a sentence ranks like a keyword', () => {
  const corpus = [
    V('payment.refund', 'Refund a captured payment, full or partial.'),
    V('payment.full_history', 'Every payment event for a customer, how it was taken and what happened next.'),
    V('order.refund', 'Refund an order and restock its items.'),
  ];

  // ⛔ NOT FIXED, AND THIS TEST SAYS SO RATHER THAN PRETENDING.
  //
  // IDF weighting improved this a lot but did not close it. A long prompt that
  // happens to share vocabulary with a NEIGHBOURING verb's description can
  // still outrank the right one: "A customer wants a refund on a payment they
  // made" matches payment.full_history on {customer, payment} exactly as
  // strongly as payment.refund on {refund, payment}, and prose is where the
  // extra word comes from.
  //
  // The honest state is: the right verb is reliably in the TOP THREE, and
  // usually but not always first. Asserting top-1 here would be asserting a
  // fix that does not exist; asserting nothing would hide a real gap. So this
  // pins top-3 as the guarantee and names top-1 as the target.
  //
  // Closing it properly means going past lexical matching — the module
  // docstring always said this was the honest baseline and that we would know
  // when it ran out. It has run out here, and now there is a number:
  // scripts/rank-bench.mjs, 13/20 top-1 and 16/20 top-3.
  it('a long prompt keeps the right verb in the top three', () => {
    const long = rankVerbs(
      'A customer wants a refund on a payment they made. Work out how to do that.',
      corpus, 3,
    );
    expect(long.map((m) => m.name)).toContain('payment.refund');
  });

  it('the short form is still exactly right', () => {
    expect(rankVerbs('refund a payment', corpus, 3)[0].name).toBe('payment.refund');
  });

  it('a term matching nothing does not drag the ranking', () => {
    // Proper nouns and values are the RAREST terms in any real query, so
    // uncapped rarity hands them the loudest voice. They are excluded.
    const withName = rankVerbs('refund a payment for Dana Whitfield 4471', corpus, 3);
    expect(withName[0].name).toBe('payment.refund');
  });

  it('never ranks on nothing when every term is unknown', () => {
    // If we dropped ALL terms the query would score everything equally; the
    // fallback keeps the original terms so the result is empty, not arbitrary.
    expect(rankVerbs('Whitfield 4471 zzzz', corpus, 3)).toEqual([]);
  });
});

describe('rarity is capped, not unbounded', () => {
  it('a common word still counts for something', () => {
    // The floor: a term in most verbs is weak evidence, not zero evidence.
    // If it were zero, a query of only common words would return nothing.
    const corpus = [V('payment.refund', 'refund a payment'), V('page.create', 'create a page')];
    expect(rankVerbs('payment', corpus, 3).length).toBeGreaterThan(0);
  });

  it('scores stay inside 0..1', () => {
    const corpus = [V('payment.refund', 'refund a payment refund refund')];
    const r = rankVerbs('refund a payment', corpus, 3);
    expect(r[0].score).toBeGreaterThan(0);
    expect(r[0].score).toBeLessThanOrEqual(1);
  });
});

describe('terms()', () => {
  it('drops stopwords and single characters', () => {
    expect(terms('a refund on the payment')).toEqual(['refund', 'payment']);
  });
});

// ── 2026-09-14: idioms, emphasis, and the apostrophe ────────────────────────
//
//   + stopwords (pronouns, contractions, filler)   top-1 14/20  top-3 16/20
//   + PHRASES, consumed not added                  top-1 17/20  top-3 18/20
//   + emphasis on idiom + leading imperative       top-1 18/20  top-3 20/20
//   + idiom maps its own verb ("make a note")      top-1 19/20  top-3 20/20
//   + lead emphasis gated on document frequency    top-1 19/20  top-3 20/20
//   + grounded vocabulary, apostrophes closed up   top-1 19/20  top-3 20/20
//
// Held out on 18 eval prompts never inspected while tuning (rank-bench-holdout):
//   before 6/18 top-1, 10/18 top-3  ->  after 8/18, 11/18. 3 gains, 0 losses.
//
// The tuned set moved a lot and the unseen set moved a little. Both numbers
// are reported because only the second one is an estimate of anything.

import { analyse, leadingAction, normalise } from '../../lib/verb-search';

describe('idioms translate what words alone get wrong', () => {
  const corpus = [
    V('contact.create', 'Create a contact.'),
    V('contact.search', 'Find a contact by name or email.'),
    V('phone.call_queue', 'Who called us and what they wanted.'),
    V('file.search', 'Search uploaded files by name.'),
    V('notes.add', 'Add a work note that persists across sessions.'),
    V('notes.list', 'List work notes.'),
    V('deal.create', 'Create a CRM deal for a quote or opportunity.'),
  ];

  it('"anyone called X on file" is about contacts, not calls or files', () => {
    // Both misleading words are CONSUMED. Leaving either in keeps its verb
    // in the running no matter how the rest is weighted.
    const t = analyse(normalise('Do we have anyone called Whitfield on file?')).translated;
    expect(t).not.toMatch(/\bcalled\b/);
    expect(t).not.toMatch(/\bfile\b/);
    expect(t).toMatch(/\bcontact\b/);
  });

  it('"make a note" carries its own verb, so it reaches add and not list', () => {
    // Mapping to ['notes'] alone lost the create intent with the consumed
    // words, and notes.list outranked notes.add for a phrase that can only
    // mean "write one down".
    const r = rankVerbs('Make a note that she wants a quote', corpus, 3);
    expect(r[0].name).toBe('notes.add');
  });

  it('leaves "who called us yesterday" as a call query', () => {
    // The SYNONYMS entry called -> call is right here; only the naming idiom
    // is overridden, so the general case must not regress.
    expect(rankVerbs('Who called us yesterday?', corpus, 3)[0].name).toBe('phone.call_queue');
  });
});

describe('emphasis: what the caller named beats what they mentioned', () => {
  // ⛔ THE GATE IS PROPORTIONAL, SO THE FIXTURE MUST BE. Emphasis is granted
  // only to a lead appearing in under 5% of the manifest. In a two-verb
  // fixture one mention IS 50%, so nothing is ever rare and the rule cannot
  // fire — the first draft of this test failed for exactly that reason and the
  // rule was right. `pad()` supplies the denominator a real registry has.
  const pad = (n: number) =>
    Array.from({ length: n }, (_, i) => V(`filler.verb_${i}`, `Unrelated capability number ${i}.`));

  it('a leading imperative that discriminates is emphasised', () => {
    const corpus = [
      V('sms.send', 'Send a text through the Switchboard.'),
      V('kb.search', 'Search the knowledge base; say what you are running late for.'),
      ...pad(60),
    ];
    expect(rankVerbs("Text Dana to say we're running twenty minutes late", corpus, 3)[0].name)
      .toBe('sms.send');
  });

  it('a leading imperative that does NOT discriminate is left alone', () => {
    // ⛔ REGRESSION GUARD, FOUND BY THE HELD-OUT SET. Emphasising every lead
    // put `user_change_role` on top of "Change the phone greeting…", because
    // `change` appears in 6.9% of the manifest and the noun that mattered was
    // `phone`. Only a lead rare enough to name a capability is emphasised.
    const corpus = [
      V('user.change_role', 'Change a user role.'),
      V('voice.greeting_set', 'Change the phone greeting callers hear.'),
      ...pad(60),
    ];
    const r = rankVerbs('Change the phone greeting to say we are closed', corpus, 3);
    expect(r[0].name).toBe('voice.greeting_set');
  });

  it('reads the lead from the raw query, not from the translated one', () => {
    expect(leadingAction('Text Dana about the delay')).toBe('text');
    expect(leadingAction('I just got off the phone. Make a note.')).toBeNull();
  });
});

describe('an apostrophe joins a word, it does not split one', () => {
  it('closes contractions up instead of leaving fragments', () => {
    // "we're" used to yield `we` + `re`; `re` is not a word, survived the
    // two-character filter, and diluted every real term in the query.
    expect(normalise("we're running late")).toBe('were running late');
    expect(terms("we're running late")).not.toContain('re');
  });

  it('lets an idiom be written the way it is spoken', () => {
    expect(analyse(normalise("Dana can't make Tuesday")).translated).toMatch(/reschedule/);
  });
});

describe('a declared alias never wins its pair', () => {
  // contact.create is an alias of crm.contacts.create (same_as). Both are
  // dotted, so "keep the dotted one" could not choose — the alias scored higher
  // on "create a contact" and was the name `find` handed the agent.
  const corpus = [
    { ...V('contact.create', 'Create a contact.'), same_as: 'crm.contacts.create' },
    V('crm.contacts.create', 'Create a new contact in the CRM.'),
  ];

  it('returns the canonical half, once', () => {
    const names = rankVerbs('create a contact', corpus).map((m) => m.name);
    expect(names).toEqual(['crm.contacts.create']);
  });
});
