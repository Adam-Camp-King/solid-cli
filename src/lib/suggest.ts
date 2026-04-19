/**
 * Command suggestion engine — "did you mean ...?" for typos.
 *
 * Prefix matches beat edit distance (typing `crm` should find `crm`, not `ant`).
 * Threshold scales with input length so short typos don't fan out to every
 * 3-letter command in the registry.
 */

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const prev: number[] = new Array(b.length + 1);
  const curr: number[] = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,        // insertion
        prev[j] + 1,            // deletion
        prev[j - 1] + cost,     // substitution
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

export interface SuggestOptions {
  /** Max suggestions to return. Default 3. */
  max?: number;
  /** Max edit distance considered a match. Default scales with input length. */
  threshold?: number;
}

/**
 * Rank candidates for "did you mean?" against an unknown input.
 *
 * Order:
 *   1. Prefix matches (case-insensitive)     — strongest signal
 *   2. Substring matches                     — user remembers a fragment
 *   3. Levenshtein distance ≤ threshold      — typo tolerance
 *
 * Returns up to `max` candidates, deduped, in confidence order.
 */
export function suggest(input: string, available: string[], opts: SuggestOptions = {}): string[] {
  const max = opts.max ?? 3;
  const threshold = opts.threshold ?? Math.max(2, Math.ceil(input.length / 3));
  if (!input || available.length === 0) return [];

  const lower = input.toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];

  const add = (cmd: string) => {
    if (seen.has(cmd)) return;
    seen.add(cmd);
    out.push(cmd);
  };

  // 1. Prefix matches
  for (const c of available) {
    if (out.length >= max) break;
    if (c.toLowerCase().startsWith(lower)) add(c);
  }

  // 2. Substring matches (only if input is long enough to be a meaningful fragment)
  if (out.length < max && lower.length >= 3) {
    for (const c of available) {
      if (out.length >= max) break;
      if (c.toLowerCase().includes(lower)) add(c);
    }
  }

  // 3. Edit-distance matches
  if (out.length < max) {
    const ranked = available
      .map((c) => ({ cmd: c, dist: levenshtein(lower, c.toLowerCase()) }))
      .filter((x) => x.dist <= threshold)
      .sort((a, b) => a.dist - b.dist);
    for (const r of ranked) {
      if (out.length >= max) break;
      add(r.cmd);
    }
  }

  return out;
}
