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

/**
 * Every command path in the tree, space-joined: "crm contacts", "verbs list".
 *
 * Sprint VNP 2.4. The unknown-command handler only ever searched siblings at
 * the level that failed, so `solid contacts` was matched against the top-level
 * list and suggested `connect` and `context` — while `crm contacts`, which is
 * what the user meant and does exist, was never a candidate. A flat tree makes
 * the whole surface reachable by a suggestion.
 */
export function flattenCommandTree(
  cmd: { name(): string; commands: readonly unknown[] },
  prefix = '',
): string[] {
  const out: string[] = [];
  for (const raw of cmd.commands) {
    const sub = raw as { name(): string; commands: readonly unknown[]; _hidden?: boolean };
    const name = sub.name();
    if (!name || name === '*' || sub._hidden) continue;
    const path = prefix ? `${prefix} ${name}` : name;
    out.push(path);
    if (sub.commands?.length) out.push(...flattenCommandTree(sub, path));
  }
  return out;
}

/**
 * "Did you mean?" over full command paths rather than a single level.
 *
 * A path is a candidate when the typed token matches ANY of its segments, so
 * `contacts` finds `crm contacts` without the user knowing the namespace. A
 * leaf whose LAST segment matches outranks one that merely contains it
 * somewhere — `contacts` should reach `crm contacts` before `crm contacts
 * import`.
 */
export function suggestPath(
  typed: string,
  paths: string[],
  opts: SuggestOptions = {},
): string[] {
  const max = opts.max ?? 3;
  const needle = typed.toLowerCase();
  if (!needle) return [];

  const scored: Array<{ path: string; rank: number }> = [];
  for (const path of paths) {
    const segs = path.toLowerCase().split(' ');
    const last = segs[segs.length - 1];

    let rank = Infinity;
    if (last === needle) rank = 0;                       // exact leaf
    else if (segs.includes(needle)) rank = 1;            // exact, deeper in
    else if (last.startsWith(needle)) rank = 2;          // prefix of the leaf
    else if (segs.some((s) => s.startsWith(needle))) rank = 3;
    else {
      const d = Math.min(...segs.map((s) => levenshtein(needle, s)));
      const threshold = needle.length <= 4 ? 1 : needle.length <= 7 ? 2 : 3;
      if (d <= threshold) rank = 4 + d;
    }
    if (rank !== Infinity) scored.push({ path, rank });
  }

  scored.sort((a, b) => a.rank - b.rank || a.path.length - b.path.length);
  return scored.slice(0, max).map((s) => s.path);
}
