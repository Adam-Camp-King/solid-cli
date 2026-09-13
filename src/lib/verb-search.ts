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

/** Words that carry no signal in a capability search. */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'for', 'from',
  'how', 'i', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'that', 'the',
  'this', 'to', 'want', 'was', 'what', 'when', 'where', 'which', 'with',
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
};

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

/** Split a phrase into meaningful lowercase terms. */
export function terms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** The pieces of a verb name: "payment.refund" -> ["payment", "refund"]. */
function nameSegments(name: string): string[] {
  return name.toLowerCase().split(/[._]/).filter(Boolean);
}

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
  const idf = (t: string) =>
    Math.min(IDF_CAP, Math.max(0.15, Math.log((N + 1) / ((df.get(t) ?? 0) + 1))));
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
 * Prefers `same_as` when the manifest carries it. It does not yet in
 * production — the field is committed but undeployed — so this falls back to
 * the same rule the pairs were counted with: two names are the same operation
 * when they match after dots become underscores. The fallback is not a guess;
 * it is the definition.
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
    // The dotted name is canonical: it is the one with a real REST route.
    const heldIsCanonical = held.name.includes('.');
    const mineIsCanonical = m.name.includes('.');
    if (mineIsCanonical && !heldIsCanonical) bestByOperation.set(key, m);
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
