/**
 * What `agent.verbs.search` concluded — read once, so `solid find` cannot lose it.
 *
 * ⛔ WHY THIS EXISTS. The backend search answers with more than a ranked list:
 * how sure it is (`confidence.level` + the caller's `next_step`), whether a
 * model read the candidates against the request (`judged`), and — when no verb
 * does the request — that there is none (`level: "no_verb"`, `matches: []`,
 * the `closest` it read, and the `gap` it recorded).
 *
 * `solid find` used to keep only `matches`. Two things followed: an agent never
 * saw the confidence the server had measured, and an empty `matches` was read
 * as "the server path failed", so find fell back to the LOCAL lexical ranker
 * and printed its five best guesses — turning the server's honest "there is no
 * verb for this" back into five confident wrong turns.
 */
import type { VerbMatch } from './verb-search';

export type SearchState = 'matches' | 'no_verb' | 'unusable';

export interface SearchConfidence {
  level: string;
  next_step?: string;
  calibration?: Record<string, unknown>;
}

export interface SearchAnswer {
  /** `matches`: use them. `no_verb`: the server read the catalog and nothing does it.
   *  `unusable`: no answer came back — rank locally instead. */
  state: SearchState;
  matches: VerbMatch[];
  rankedBy: string;
  confidence: SearchConfidence | null;
  judged: { fit?: string; by?: string } | null;
  closest: Array<{ name: string; description: string }>;
  gap: Record<string, unknown> | null;
}

const UNUSABLE: SearchAnswer = {
  state: 'unusable', matches: [], rankedBy: '', confidence: null, judged: null, closest: [], gap: null,
};

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Pure. The dispatch response of `agent.verbs.search`, read into one answer. */
export function readSearchAnswer(responseData: unknown): SearchAnswer {
  const data = obj(responseData);
  if (!data || data.ok === false) return UNUSABLE;
  const payload = obj(data.result) ?? data;

  const rawConfidence = obj(payload.confidence);
  const confidence: SearchConfidence | null =
    rawConfidence && typeof rawConfidence.level === 'string'
      ? {
          level: rawConfidence.level,
          ...(typeof rawConfidence.next_step === 'string' ? { next_step: rawConfidence.next_step } : {}),
          ...(obj(rawConfidence.calibration) ? { calibration: obj(rawConfidence.calibration)! } : {}),
        }
      : null;
  const judgedRaw = obj(payload.judged);
  const judged = judgedRaw
    ? {
        ...(typeof judgedRaw.fit === 'string' ? { fit: judgedRaw.fit } : {}),
        ...(typeof judgedRaw.by === 'string' ? { by: judgedRaw.by } : {}),
      }
    : null;

  const matches: VerbMatch[] = Array.isArray(payload.matches)
    ? payload.matches
        .map((m) => obj(m))
        .filter((m): m is Record<string, unknown> => !!m && typeof m.name === 'string')
        .map((m) => ({
          name: String(m.name),
          score: Number(m.score) || 0,
          description: String(m.description || ''),
          side_effects: String(m.side_effects || 'read'),
        }))
    : [];
  const rankedBy = typeof payload.ranked_by === 'string' ? payload.ranked_by : 'hybrid';

  // ⛔ "No verb" is an ANSWER, not a failure. Only the server can say it — it is
  // the judged reading of the closest candidates — so it is believed only when
  // the server said exactly that.
  if (confidence?.level === 'no_verb') {
    const closest = Array.isArray(payload.closest)
      ? payload.closest
          .map((c) => obj(c))
          .filter((c): c is Record<string, unknown> => !!c && typeof c.name === 'string')
          .map((c) => ({ name: String(c.name), description: String(c.description || '') }))
      : [];
    return { state: 'no_verb', matches: [], rankedBy, confidence, judged, closest, gap: obj(payload.gap) };
  }
  if (!matches.length) return UNUSABLE;
  return { state: 'matches', matches, rankedBy, confidence, judged, closest: [], gap: null };
}
