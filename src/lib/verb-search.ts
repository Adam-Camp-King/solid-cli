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
  let s = 0;
  if (segs.includes(term)) {
    s += 6;                                  // whole segment: payment.REFUND
  } else if (nameLower.includes(term)) {
    s += 3;                                  // inside a segment: preview_REFUND_impact
  }
  if (desc.includes(term)) {
    // Word boundary, so "pay" does not score against "payment".
    s += new RegExp(`\\b${term}\\b`).test(desc) ? 2 : 0.5;
  }
  return s;
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

  // Best achievable score for this query, used to normalize. Every term
  // matching as a whole name segment AND on a description word boundary.
  const perfect = qTerms.length * 8;

  const scored: VerbMatch[] = [];
  for (const v of verbs) {
    const nameLower = v.name.toLowerCase();
    const segs = nameSegments(v.name);
    const desc = (v.description || '').toLowerCase();

    let raw = 0;
    let matched = 0;
    for (const t of qTerms) {
      const s = scoreTerm(t, segs, nameLower, desc);
      if (s > 0) matched++;
      raw += s;
    }
    if (matched === 0) continue;

    // Every term matching beats one term matching loudly: an agent asking for
    // "refund a payment" wants the verb about both, not the loudest refund.
    raw *= matched / qTerms.length;

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
