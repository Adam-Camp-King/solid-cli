/**
 * Lexical ranking over the verb manifest.
 *
 * Sprint VNP 2.1. An agent arrives with a sentence, not a location — "refund a
 * payment", not "class 420". Today the only route from intent to a callable
 * name is reading all 845 verbs, which is 315,898 tokens after 1.1 and was
 * 486,986 before. This turns that into one ~120-token answer.
 *
 * Deliberately lexical, not semantic. The descriptions average ~170 characters
 * and are unusually specific, so plain term matching over name + description
 * lands well, and it ships against the manifest exactly as it stands — no
 * embeddings to build, no model to call, no index to keep in sync. It is also
 * the honest baseline: if this is not good enough we will be able to say so
 * with a number instead of a hunch.
 *
 * Pure. No I/O, no env, no clock — the ranking is unit-testable on its own.
 */

/**
 * Words that carry no signal in a capability search.
 *
 * ⛔ PRONOUNS AND CONTRACTION FRAGMENTS ARE NOISE, AND THEY WERE COSTING
 * REAL QUERIES. Measured 2026-09-14: "Text Dana to say we're running twenty
 * minutes late" tokenised to nine terms, of which ONE ("text") named a
 * capability. `sms.send` matched that one term and was scored on coverage
 * — matched-IDF over total-IDF — so eight words of narrative divided its
 * score by nine, while `knowledge_base_search` picked up "say", "running" and
 * "text" from its prose and won at 0.04 to 0.03.
 *
 * Worse, "we're" split into `we` and `re`. `re` is not a word; it is half of
 * an apostrophe, and it survived the length filter because it is two
 * characters long. Every contraction in English was donating a junk term to
 * the denominator.
 *
 * These additions carry no capability signal in ANY query — there is no verb
 * about `she`, `ours` or `ll` — so dropping them cannot lose a match. That is
 * the test for entry here: not "is this word common", but "could this word
 * ever name a thing the platform does".
 */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'for', 'from',
  'how', 'i', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'that', 'the',
  'this', 'to', 'want', 'was', 'what', 'when', 'where', 'which', 'with',
  // Pronouns and possessives.
  'he', 'her', 'hers', 'him', 'his', 'our', 'ours', 'she', 'their', 'theirs',
  'them', 'they', 'us', 'we', 'you', 'your', 'yours',
  // Contractions, closed up by the apostrophe rule in terms() below.
  'cant', 'dont', 'doesnt', 'didnt', 'isnt', 'arent', 'wasnt', 'werent',
  'ive', 'im', 'id', 'ill', 'its', 'lets', 'thats', 'theyre', 'were',
  'whats', 'whos', 'youre', 'youve', 'hes', 'shes', 'weve', 'wont',
  // Narrative filler: common in how an owner phrases a request, never a verb.
  'got', 'just', 'now', 'off', 'out', 'still', 'then', 'there', 'about',
  'been', 'has', 'have', 'had', 'will', 'would', 'should', 'could',
]);


/**
 * Owner vocabulary -> platform vocabulary.
 *
 * ⛔ THIS IS THE BIGGEST SINGLE WIN AND IT IS NOT A SCORING TWEAK. Measured
 * 2026-09-13: "Add a new customer" returned `phone.external_add`, because the
 * owner says *customer* and the verb says *contact*, the owner says *add* and
 * the verb says *create*. `contact.create` matched NEITHER query term, scoring
 * zero, while `external_add` matched "add" as a whole name segment for six
 * points. No weighting fixes that — the words simply never meet.
 *
 * Kept small and one-directional on purpose. Every entry is a word a business
 * owner actually uses for a thing the platform names differently; none is a
 * guess about intent. A synonym that is merely *related* ("money" -> "invoice")
 * would drag every financial query toward whichever verb has the longest
 * description, so relatedness is not enough — it has to be the same thing.
 */
const SYNONYMS: Record<string, readonly string[]> = {
  customer: ['contact', 'client'],
  customers: ['contact', 'contacts'],
  client: ['contact'],
  clients: ['contacts'],
  add: ['create'],
  new: ['create'],
  make: ['create'],
  text: ['sms'],
  texting: ['sms'],
  job: ['order', 'appointment'],
  jobs: ['orders', 'appointments'],
  booking: ['appointment'],
  // ⛔ THE TENSE MATTERS AND `booking` ALONE DID NOT COVER IT. "Who's BOOKED
  // in this week?" left `booked` matching nothing but prose, and four verbs
  // tied on score — `list_recent_calls` then won on being the shorter name.
  // A tie decided by name length is a coin flip wearing a rule.
  booked: ['appointment'],
  books: ['accounting'],
  owed: ['outstanding', 'receivable'],
  owe: ['outstanding', 'receivable'],
  unpaid: ['outstanding', 'overdue'],
  staff: ['team', 'user'],
  apprentice: ['team', 'user'],
  employee: ['team', 'user'],
  website: ['site', 'page'],
  webpage: ['page'],
  post: ['blog'],
  stock: ['inventory'],
  quote: ['proposal', 'deal'],
  called: ['call'],
  ring: ['call'],
  chase: ['followup', 'follow'],
  note: ['notes'],
  refund: ['refund'],
  // A named network IS the social surface; the platform has no per-network verb.
  facebook: ['social'],
  instagram: ['social'],
  twitter: ['social'],
  linkedin: ['social'],
  tiktok: ['social'],
  // "Enquiry" is what an owner calls a lead. Measured: `enquir` and `inquir`
  // appear in ZERO verb names and ZERO descriptions, so without this the word
  // matches nothing at all and the query ranks on its filler.
  enquiry: ['lead'],
  enquiries: ['lead', 'leads'],
  inquiry: ['lead'],
  inquiries: ['lead', 'leads'],
  // What the owner calls visiting, the platform counts as pageviews.
  visited: ['analytics', 'pageviews'],
  visitors: ['analytics', 'pageviews'],
  visits: ['analytics', 'pageviews'],
};

/**
 * Owner IDIOMS -> platform vocabulary. The n-gram sibling of SYNONYMS.
 *
 * ⛔ WHY A SECOND MAP INSTEAD OF MORE SYNONYMS. Some owner phrasings cannot be
 * translated one word at a time, because the individual words mean something
 * ELSE on this platform and actively pull the ranking the wrong way. Measured
 * 2026-09-14, before this existed:
 *
 *   "Do we have anyone CALLED Whitfield ON FILE?"  -> phone.call_queue, file.search
 *   "MAKE A NOTE that she wants a quote"           -> deal.create
 *   "How many of part 4471 do we HAVE LEFT?"       -> notes.context
 *
 * Every one of those is a correct word-level match and a wrong answer.
 * `called` really is the word in `phone.call_queue`; `file` really is the word
 * in `file.search`. The owner did not mean either. No amount of re-weighting
 * fixes it, because the ranker is scoring exactly the word that was typed.
 *
 * ⛔ A PHRASE IS CONSUMED, NOT ADDED. The mapped terms REPLACE the words that
 * matched, which is the whole point: leaving "file" in the query keeps
 * `file.search` in the running no matter how much weight `contact` gets. This
 * is the one behaviour that separates a phrase from a synonym, and it is why
 * a phrase must be a genuine idiom rather than a hint — consuming the words of
 * a phrase that was NOT an idiom would delete real signal.
 *
 * ⛔ SAME ENTRY TEST AS SYNONYMS, ONE NOTCH STRICTER. An entry must be a
 * phrase a business owner actually says, whose meaning IS the platform thing,
 * and whose words individually mislead. "On file" means "in our contact
 * records" — not "in a file". If the words do not mislead, a synonym is the
 * cheaper tool and it does not risk eating signal.
 *
 * Longest phrase wins, so "left in stock" is tried before "in stock".
 */
const PHRASES: Record<string, readonly string[]> = {
  // "called" here is naming, not telephoning — the opposite of `called: [call]`
  // in SYNONYMS above, which is right for "who called us yesterday".
  'anyone called': ['contact'],
  'anybody called': ['contact'],
  'someone called': ['contact'],
  'somebody called': ['contact'],
  // "on file" is where a business keeps people, not documents.
  'on file': ['contact'],
  // The action is the note; whatever follows is the note's CONTENT, and its
  // words ("quote", "invoice", "job") are what drag this to the wrong verb.
  // ⛔ MAP THE WHOLE IDIOM, INCLUDING ITS VERB. The first version translated
  // to ['notes'] alone and the create intent went with the consumed words —
  // `notes.list` and `notes.search` then outranked `notes.add` for a phrase
  // that unambiguously means "write one down". A phrase that consumes its own
  // verb has to put that verb back.
  'make a note': ['notes', 'add'],
  'made a note': ['notes', 'add'],
  'making a note': ['notes', 'add'],
  'take a note': ['notes', 'add'],
  'jot down': ['notes', 'add'],
  // Quantity remaining. "left" alone is a direction and a past tense.
  'have left': ['inventory'],
  'got left': ['inventory'],
  'left in stock': ['inventory'],
  'in stock': ['inventory'],
  'run out of': ['inventory'],
  // Work not yet won. "coming in" has no platform meaning at all on its own.
  'coming in': ['pipeline'],
  'come in': ['pipeline'],
  'in the pipeline': ['pipeline'],
  // Where work originates. "Coming from" has no platform meaning word by word.
  'coming from': ['sources'],
  'come from': ['sources'],
  // Unable to attend. Without this, "can't MAKE Tuesday" reads as an
  // instruction to create something — measured, it returned `expense_create`.
  'cant make': ['reschedule'],
  'cant do': ['reschedule'],
  'cant manage': ['reschedule'],
  // Shipping a draft. "Live" alone is an adjective the platform never uses
  // this way, and "put" is one of the least discriminating words there is.
  'put it live': ['publish'],
  'put this live': ['publish'],
  'make it live': ['publish'],
  'go live': ['publish'],
  'goes live': ['publish'],
};

/** Phrase keys, longest first, so a specific idiom beats a general one. */
const PHRASE_KEYS = Object.keys(PHRASES).sort(
  (a, b) => b.split(' ').length - a.split(' ').length || b.length - a.length,
);

/**
 * Replace every idiom in a normalised query with the platform terms it means.
 * Operates on a space-separated, punctuation-stripped string so that
 * "what's it worth" and "on file?" match their keys.
 */
export function applyPhrases(normalised: string): string {
  return analyse(normalised).translated;
}

/**
 * Translate idioms and report WHICH terms an idiom put there.
 *
 * ⛔ AN IDIOM IS EVIDENCE ABOUT INTENT, NOT VOCABULARY, AND IS WEIGHTED AS
 * SUCH. A word that merely appears in a query is weak evidence — the owner may
 * be describing context ("I just got off the phone with Dana"). A word this
 * map put there is different in kind: it is there because a phrase the owner
 * actually said MEANS that platform thing. Measured 2026-09-14, without the
 * distinction: "Make a note that she wants a quote" translated correctly to
 * `notes` and still lost to `phone.pricing`, because `phone` and `quote` —
 * both incidental narrative — covered two terms to `notes`' one, and coverage
 * decides ties. The translation was right and got outvoted by the noise it
 * was translated out of.
 */
export function analyse(normalised: string): { translated: string; fromIdiom: Set<string> } {
  let out = ` ${normalised} `;
  const fromIdiom = new Set<string>();
  for (const key of PHRASE_KEYS) {
    if (!out.includes(` ${key} `)) continue;
    for (const t of PHRASES[key]) fromIdiom.add(t);
    out = out.split(` ${key} `).join(` ${PHRASES[key].join(' ')} `);
  }
  return { translated: out.trim(), fromIdiom };
}

/**
 * True when the caller OPENED with an instruction: "Text Dana…", "Book Dana…".
 *
 * ⛔ FIRST POSITION, AND ONLY FIRST. The same reasoning `isReadIntent` already
 * relies on: an imperative LEADS its sentence, and the identical word in the
 * middle is just a word. "Text Dana to say we're running late" names its
 * action in the first word and then spends six words on the MESSAGE — content
 * that belongs in the SMS, not in the search. Without this, `text` was one
 * term among seven and `healthcare_escalate_urgent` won on prose overlap.
 *
 * Deliberately not a synonym boost: this is about WHERE the word sits, so it
 * applies to the word the owner actually typed and to whatever it translates
 * to, but never turns a mid-sentence noun into a command.
 */
export function leadingAction(query: string): string | null {
  const first = normalise(query).split(' ')[0];
  return first && IMPERATIVE.has(first) ? first : null;
}

/**
 * The other number of a word: contact <-> contacts.
 *
 * Deliberately the naive rule and nothing more. A real stemmer would also
 * fold `serialize`/`serialization` and `pricing`/`price`, which is how a
 * lexical ranker starts matching things the caller did not say. Plural `s` is
 * the inflection this registry actually splits on.
 */
function inflect(term: string): string {
  return term.endsWith('s') ? term.slice(0, -1) : `${term}s`;
}

/** A query term plus anything the platform calls the same thing. */
function expand(term: string): string[] {
  const extra = SYNONYMS[term];
  return extra ? [term, ...extra] : [term];
}

export interface SearchableVerb {
  name: string;
  description?: string;
  side_effects?: string;
  /** Canonical twin, when this verb is the non-canonical half of a pair. */
  same_as?: string | null;
}

export interface VerbMatch {
  name: string;
  score: number;
  description: string;
  side_effects: string;
  /** Internal: the canonical twin, used to collapse duplicate pairs. */
  canonicalOf?: string | null;
}

/**
 * Split a phrase into meaningful lowercase terms.
 *
 * Punctuation is flattened to spaces BEFORE idiom matching, so an apostrophe
 * or a question mark cannot hide a phrase from its key ("on file?" is still
 * "on file"). Idioms are translated first, then stopwords are dropped —
 * in that order, because a phrase may legitimately contain a stopword
 * ("make A note", "have left").
 */
export function normalise(query: string): string {
  // ⛔ AN APOSTROPHE JOINS A WORD, IT DOES NOT SPLIT ONE. Replacing it with a
  // space turned "we're" into `we` + `re` and "can't" into `can` + `t` —
  // fragments that are not words, survive the length filter at two
  // characters, and then sit in the IDF denominator diluting every real term.
  // Closing the contraction up instead yields `were` and `cant`, which are
  // single droppable stopwords, and lets an idiom like "can't make" be
  // written as one readable key.
  return query.toLowerCase().replace(/['\u2019]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function terms(query: string): string[] {
  const normalised = normalise(query);
  const kept = applyPhrases(normalised)
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  // ⛔ DEDUPE. Two idioms can translate to the same platform word — "anyone
  // called Whitfield ON FILE" hits both `anyone called` and `on file`, and
  // both mean `contact`. A repeated term is scored once per occurrence and
  // counted twice in the IDF total, so the query silently doubles its own
  // emphasis on one word and the ranking turns on which verb name is
  // shortest. The owner said one thing; it counts once.
  return [...new Set(kept)];
}

/** The pieces of a verb name: "payment.refund" -> ["payment", "refund"]. */
function nameSegments(name: string): string[] {
  return name.toLowerCase().split(/[._]/).filter(Boolean);
}

/**
 * Is the caller ASKING something, or TELLING us to do something?
 *
 * ⛔ WHY THIS EXISTS. Measured 2026-09-13 by the eval suite: three read-only
 * questions were answered with a MUTATING verb ranked first.
 *
 *     "Is anything failing to sync to the accounts?"  -> invoice_sync   (runs a sync)
 *     "Is anything on my account not working?"        -> invoice_sync
 *     "How much will we make next quarter?"           -> crm_task_create
 *
 * The ranker carried `side_effects` all the way into its output and never once
 * consulted it while scoring. So the word "sync" in a question about sync
 * STATUS scored identically to the same word in a command to sync — and the
 * verb that acts usually has the shorter, more on-the-nose name, so it wins.
 *
 * An agent following our own documented route (find -> describe -> invoke) is
 * therefore handed something destructive in answer to a question. That is our
 * defect, not the model's.
 *
 * ⛔ DEMOTED, NEVER HIDDEN. A mutating verb still appears, just not first: the
 * caller may genuinely want it, and a search that silently withholds a
 * capability is a worse failure than one that ranks it second. Harden, do not
 * delete.
 *
 * ⛔ AN IMPERATIVE ALWAYS WINS. "Delete every contact" contains `delete`, so
 * this never fires and `gdpr_delete_contact` still ranks first — correctly.
 * Refusing that request is the JOB OF THE EXECUTION BOUNDARY, not of search;
 * hiding the verb would move a safety decision somewhere it cannot be audited,
 * and would break the owner who meant it.
 */
const IMPERATIVE = new Set([
  'create', 'add', 'new', 'make', 'update', 'edit', 'change', 'set', 'rename',
  'delete', 'remove', 'clear', 'drop', 'void', 'cancel', 'close', 'archive',
  'send', 'email', 'text', 'call', 'invite', 'publish', 'unpublish', 'post',
  'refund', 'charge', 'pay', 'bill', 'issue', 'collect',
  'book', 'schedule', 'reschedule', 'assign', 'dispatch',
  'enable', 'disable', 'turn', 'switch', 'start', 'stop', 'pause', 'resume',
  'upload', 'import', 'export', 'sync', 'run', 'apply', 'generate', 'draft',
  'connect', 'disconnect', 'install', 'grant', 'revoke', 'approve', 'reject',
]);

const INTERROGATIVE = new Set([
  'who', 'what', 'whats', 'when', 'where', 'why', 'how', 'which', 'whose',
  'is', 'are', 'was', 'were', 'do', 'does', 'did', 'can', 'could', 'should',
  'am', 'have', 'has', 'any', 'anything', 'anyone',
]);

/**
 * True when the query reads as a QUESTION and contains no instruction to act.
 *
 * Both halves are required. "How do I delete a contact?" is interrogative but
 * names the action, so the delete verb is exactly what was asked for.
 */
export function isReadIntent(query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const words = q.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;

  // ⛔ POSITION, NOT PRESENCE. The first attempt asked whether an imperative
  // word appeared ANYWHERE, and it got two of the three cases wrong — because
  // half of these words are also ordinary nouns and verbs:
  //
  //   "Is anything failing to SYNC to the accounts?"   sync = a noun here
  //   "How much will we MAKE next quarter?"            make = earn, not create
  //
  // Both were read as commands and kept their write verb on top. An imperative
  // LEADS its sentence; the same word in the middle of a question is just a
  // word. Only the first position counts.
  if (IMPERATIVE.has(words[0])) return false;

  // "How do I delete a contact?" is a question ABOUT an action, and the action
  // verb is precisely the right answer. Demoting it would break discovery —
  // the most common way anyone learns what this CLI can do.
  if (/^how\s+(do|can|to|would|should)\b/.test(q) && words.some((w) => IMPERATIVE.has(w))) {
    return false;
  }

  return q.endsWith('?') || INTERROGATIVE.has(words[0]);
}

/**
 * How much a mutating verb is held back when the caller only asked a question.
 *
 * 0.45 was chosen against the suite, not by feel: it is low enough to move
 * `invoice_sync` off the top for "is anything failing to sync" (where a read
 * verb exists and scored close behind), and high enough that a mutating verb
 * with NO read competitor still surfaces in the list rather than vanishing.
 */
const WRITE_PENALTY_ON_QUESTION = 0.45;

/**
 * Score one verb against one term.
 *
 * The weights encode a simple claim: a term appearing in the NAME is far
 * stronger evidence than the same term appearing in prose, because a name is
 * chosen and a description merely mentions. "refund" in `payment.refund` means
 * the verb refunds; "refund" in a description may only mean it is refund-aware
 * (`payments.preview_refund_impact` is a read).
 */
function scoreTerm(term: string, segs: string[], nameLower: string, desc: string): number {
  let best = 0;
  const variants = expand(term);
  for (let i = 0; i < variants.length; i++) {
    const t = variants[i];
    let s = 0;
    if (segs.includes(t)) {
      s += 6;                                // whole segment: payment.REFUND
    } else if (segs.includes(inflect(t))) {
      // ⛔ SINGULAR AND PLURAL ARE THE SAME SEGMENT, AND THIS REGISTRY SPLITS
      // THEM CONSTANTLY: contact/contacts, invoice/invoices, page/pages,
      // order/orders, deal/deals. Without this, `contact` scored 6 against
      // `contact.create` and only 3 against `crm_contacts_search` — a
      // substring match — so a search verb lost to whatever else happened to
      // carry the exact singular. Below a whole-segment hit, above a mere
      // substring, because an inflection is weaker evidence than the exact
      // word and stronger than an accidental overlap.
      s += 5;
    } else if (nameLower.includes(t)) {
      s += 3;                                // inside a segment: preview_REFUND_impact
    }
    if (desc.includes(t)) {
      // Word boundary, so "pay" does not score against "payment".
      s += new RegExp(`\\b${t}\\b`).test(desc) ? 2 : 0.5;
    }
    // A synonym is weaker evidence than the word the caller actually typed.
    // Without this discount "add" would match `create` as strongly as `add`,
    // and a verb literally named *_add would lose to one merely about creating.
    if (i > 0) s *= 0.8;
    if (s > best) best = s;
  }
  return best;
}

/**
 * Rank verbs against a plain-language query.
 *
 * Returns at most `limit` matches, best first, with a 0..1 score. Verbs
 * matching no term at all are dropped — a ranked list of things that do not
 * match is worse than an empty one, because it invites a confident wrong pick.
 */
export function rankVerbs(
  query: string,
  verbs: readonly SearchableVerb[],
  limit = 5,
): VerbMatch[] {
  const qTerms = terms(query);
  if (qTerms.length === 0) return [];

  const readIntent = isReadIntent(query);

  /**
   * Terms the caller EMPHASISED, by idiom or by opening the sentence with
   * them. See analyse() and leadingAction() for why each counts.
   */
  const emphasis = new Set<string>(analyse(normalise(query)).fromIdiom);
  const lead = leadingAction(query);

  /**
   * ⛔ WEIGHT EACH TERM BY HOW RARE IT IS. Without this, every word in the
   * query counted the same and a sentence was worse than a keyword: measured
   * 2026-09-13, "A customer wants a refund on a payment they made" returned
   * `payment.refund` correctly, and the SAME sentence plus "Work out how to do
   * that." returned `payment.full_history`. Five filler words flipped it,
   * because coverage was `matched / qTerms.length` — unmatched noise punished
   * the right verb in exact proportion to how much noise there was.
   *
   * A term appearing in 300 of 845 verbs carries almost no information; one
   * appearing in 3 decides the query. Standard IDF, and it is what lets a
   * prompt be a sentence rather than a keyword — which is how an agent (and an
   * owner) actually asks.
   */
  const df = new Map<string, number>();
  for (const t of qTerms) {
    let n = 0;
    for (const v of verbs) {
      const hay = `${v.name} ${v.description || ''}`.toLowerCase();
      if (expand(t).some((x) => hay.includes(x))) n++;
    }
    df.set(t, n);
  }
  const N = Math.max(1, verbs.length);

  /**
   * ⛔ ONLY EMPHASISE A LEADING IMPERATIVE THAT IS ITSELF DISCRIMINATING.
   *
   * The first version emphasised every leading imperative and a held-out
   * prompt caught it: "CHANGE the phone greeting to say we're closed until
   * Monday" put `user_change_role` on top, with `deal.explain_stage_change`
   * and `audit.explain_balance_change` behind it. Every one of those is a
   * perfect match on `change` and none of them is about a phone.
   *
   * The reason is that imperatives are not equally informative. "Text",
   * "Book", "Refund" and "Invite" each name a capability — 0.6% to 4.2% of
   * the manifest mentions them. "Change", "Update", "Set" and "Turn" name an
   * OPERATION that dozens of unrelated nouns share: 6.9%, 6.7%, 11.9%, 19.6%.
   * Emphasising the second kind amplifies the one word in the query that
   * cannot discriminate, and buries the noun that can.
   *
   * So the gate is the measurement already in hand — document frequency — and
   * not a hand-kept list of "good" verbs, which would go stale the moment the
   * registry grew. 5% sits in the gap the data actually shows between the two
   * groups. A lead the idiom map already consumed is skipped: the idiom's own
   * emphasis is a better statement of intent than the bare verb it ate.
   */
  const LEAD_DF_CEILING = 0.05;
  // ⛔ COUNT THE WORD THE OWNER TYPED, NOT THE WORD PLUS ITS SYNONYMS. The
  // `df` map above is built over expanded terms, which is right for scoring
  // and wrong for this question. `text` appears in 4.2% of the manifest and
  // is discriminating; `text` OR `sms` together clear 5% and the gate then
  // threw out the one lead it was built to keep. What is being asked here is
  // whether the word the owner CHOSE narrows the field — so count only it.
  const leadDf = lead
    ? verbs.reduce(
        (n, v) => n + (`${v.name} ${v.description || ''}`.toLowerCase().includes(lead) ? 1 : 0),
        0,
      )
    : 0;
  if (lead && df.has(lead) && leadDf <= N * LEAD_DF_CEILING) {
    emphasis.add(lead);
    // The lead's platform translation carries the emphasis too: an owner who
    // opens with "Text …" named `sms` just as surely as one who typed it.
    for (const t of expand(lead)) emphasis.add(t);
  }
  /**
   * ⛔ CAP THE RARITY BONUS, AND DROP TERMS THAT MATCH NOTHING.
   *
   * Uncapped IDF made things worse, not better — measured: top-3 fell 16/20 to
   * 13/20. The reason is that a real query is full of PROPER NOUNS and VALUES:
   * "Dana", "Whitfield", "4471", "£450". Those are the rarest terms in any
   * query by a distance, so pure IDF hands them the loudest voice — and
   * whichever unrelated verb happens to mention a digit or a name in its
   * description wins. Rarity is a proxy for informativeness, and for names it
   * is exactly the wrong proxy.
   *
   *   df === 0  the term matches no verb at all. It is a value, not a
   *             capability. Excluded entirely: keeping it in the denominator
   *             only scales every candidate down by the same amount, and
   *             excluding it makes coverage mean what it says.
   *   cap 2.2   ~ a term in 90 of 845 verbs. Beyond that, rarer stops earning
   *             more, so "refund" and "Whitfield" cannot outrank each other on
   *             scarcity alone.
   */
  const IDF_CAP = 2.2;
  const scoring = qTerms.filter((t) => (df.get(t) ?? 0) > 0);
  const useTerms = scoring.length ? scoring : qTerms;   // never rank on nothing
  /**
   * 1.8 was chosen against the bench, not by feel. Below ~1.5 an emphasised
   * term still loses to two incidental ones ("phone" + "quote" beat "notes");
   * above ~2.2 a single idiom starts to swamp genuinely multi-term queries
   * and top-3 falls. It sits inside the same capped range as every other
   * weight here, so an emphasised common word still cannot outrank a rare
   * exact one on emphasis alone.
   */
  const EMPHASIS = 1.8;
  const idf = (t: string) =>
    Math.min(IDF_CAP, Math.max(0.15, Math.log((N + 1) / ((df.get(t) ?? 0) + 1)))) *
    (emphasis.has(t) ? EMPHASIS : 1);
  const totalIdf = useTerms.reduce((a, t) => a + idf(t), 0) || 1;

  // Best achievable score for this query, used to normalize.
  const perfect = totalIdf * 8;

  const scored: VerbMatch[] = [];
  for (const v of verbs) {
    const nameLower = v.name.toLowerCase();
    const segs = nameSegments(v.name);
    const desc = (v.description || '').toLowerCase();

    let raw = 0;
    let matchedIdf = 0;
    let matched = 0;
    for (const t of useTerms) {
      const s = scoreTerm(t, segs, nameLower, desc);
      if (s > 0) { matched++; matchedIdf += idf(t); }
      raw += s * idf(t);
    }
    if (matched === 0) continue;

    // Covering the terms that MATTER beats covering the most terms. Weighted
    // by IDF, so failing to match "the" costs nothing and failing to match
    // "refund" costs almost everything.
    raw *= matchedIdf / totalIdf;

    // Nudge shorter names up. Between two equal matches the more specific
    // name is nearly always the one meant.
    raw *= 1 + 0.05 / segs.length;

    // A question gets an answer, not an action. See isReadIntent above.
    const effects = (v.side_effects || 'read').toLowerCase();
    if (readIntent && effects !== 'read') raw *= WRITE_PENALTY_ON_QUESTION;

    scored.push({
      name: v.name,
      score: Math.min(1, Number((raw / perfect).toFixed(2))),
      description: v.description || '',
      side_effects: v.side_effects || 'read',
      canonicalOf: v.same_as ?? null,
    });
  }

  scored.sort((a, b) => b.score - a.score || a.name.length - b.name.length);
  return collapseDuplicates(scored).slice(0, limit);
}

/**
 * Collapse the 71 duplicate pairs to their canonical half.
 *
 * Without this, "book an appointment" spends three of its five slots on
 * appointment.book, appointment_book and healthcare_appointment_book, all
 * scoring 1.00 — which hands the agent exactly the coin-flip that `same_as`
 * exists to remove, and buries three genuinely different verbs that would
 * have been more useful.
 *
 * Groups by `same_as` when the manifest carries it, and otherwise by the rule
 * the flat pairs were counted with: two names are the same operation when they
 * match after dots become underscores.
 *
 * The survivor is the half WITHOUT `same_as`. Both halves can be dotted
 * (contact.create is an alias of crm.contacts.create), so "the dotted one"
 * alone kept whichever happened to score higher — often the alias the manifest
 * had just told us not to use. Dotted-over-flat is only the tiebreak now.
 */
function collapseDuplicates(matches: VerbMatch[]): VerbMatch[] {
  const bestByOperation = new Map<string, VerbMatch>();
  const order: string[] = [];

  for (const m of matches) {
    const key = (m.canonicalOf ?? m.name).replace(/\./g, '_').toLowerCase();
    const held = bestByOperation.get(key);
    if (!held) {
      bestByOperation.set(key, m);
      order.push(key);
      continue;
    }
    // Declared canonical (no same_as) wins; among equals, the dotted name —
    // it is the one with a real REST route.
    const rank = (x: VerbMatch) => (x.canonicalOf ? 0 : 2) + (x.name.includes('.') ? 1 : 0);
    if (rank(m) > rank(held)) bestByOperation.set(key, m);
  }

  return order.map((k) => bestByOperation.get(k) as VerbMatch);
}

/** Trim a description to a budget without cutting mid-word. */
export function clip(text: string, max = 90): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 40 ? lastSpace : max).trimEnd()}…`;
}
