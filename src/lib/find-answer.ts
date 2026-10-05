/**
 * What `agent.verbs.search` concluded — read once, so `solid find` cannot lose it.
 *
 * ⛔ WHY THIS EXISTS. The backend search answers with more than a ranked list:
 * how sure it is (`confidence.level` + the caller's `next_step`), whether a
 * model read the candidates against the request (`judged`), and — when no verb
 * does the request — that there is none (`level: "no_verb"`, `matches: []`,
 * the `closest` it read, and the `gap` it recorded).
 *
 * ⛔ AND "NOT ONE VERB" IS NOT "NO". A request to BUILD something (an app, a site,
 * an automation, a connection) comes back as `level: "build"` with the path to
 * follow, and a request too vague to route as `level: "ask"` with the questions
 * to settle. Both carry `answer` — instructions written to the AI that asked.
 * A customer's AI was told "no verb" for "create an app that uses Solid# verbs"
 * on 2026-10-04; that answer was true, and useless.
 *
 * `solid find` used to keep only `matches`. Two things followed: an agent never
 * saw the confidence the server had measured, and an empty `matches` was read
 * as "the server path failed", so find fell back to the LOCAL lexical ranker
 * and printed its five best guesses — turning the server's honest "there is no
 * verb for this" back into five confident wrong turns.
 */
import type { VerbMatch } from './verb-search';

export type SearchState = 'matches' | 'build' | 'ask' | 'no_verb' | 'unusable';

export interface SearchConfidence {
  level: string;
  next_step?: string;
  calibration?: Record<string, unknown>;
}

export interface PathStep {
  step: number;
  do: string;
  /** The action this step calls. Absent when the step is the caller's own work. */
  verb?: string;
  args?: Record<string, unknown>;
  yours?: boolean;
}

/** What the server tells the caller's AI to do when the request is not one action. */
export interface RequestAnswer {
  kind: 'build' | 'ask' | 'not_ours';
  /** One line the AI may pass to its human. */
  say: string;
  /** Written to the AI, in the imperative. */
  instructions: string;
  path?: { key: string; what: string; who_builds: string; how_it_connects: string; steps: PathStep[] };
  ask?: string[];
}

export interface SearchAnswer {
  /** `matches`: use them. `build`: something to make — follow `answer.path`.
   *  `ask`: too little was said — settle `answer.ask`, then search again.
   *  `no_verb`: the server read the catalog and nothing does it.
   *  `unusable`: no answer came back — rank locally instead. */
  state: SearchState;
  matches: VerbMatch[];
  rankedBy: string;
  confidence: SearchConfidence | null;
  judged: { kind?: string; fit?: string; by?: string } | null;
  closest: Array<{ name: string; description: string }>;
  gap: Record<string, unknown> | null;
  answer: RequestAnswer | null;
}

const UNUSABLE: SearchAnswer = {
  state: 'unusable', matches: [], rankedBy: '', confidence: null, judged: null, closest: [], gap: null,
  answer: null,
};

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Pure. The `answer` block, kept only when it is whole enough to act on. */
export function readRequestAnswer(raw: unknown): RequestAnswer | null {
  const a = obj(raw);
  if (!a) return null;
  const kind = str(a.kind);
  if (kind !== 'build' && kind !== 'ask' && kind !== 'not_ours') return null;
  if (!str(a.instructions)) return null;
  const out: RequestAnswer = { kind, say: str(a.say), instructions: str(a.instructions) };
  const path = obj(a.path);
  if (kind === 'build') {
    const steps: PathStep[] = (Array.isArray(path?.steps) ? path!.steps : [])
      .map((s) => obj(s))
      .filter((s): s is Record<string, unknown> => !!s && typeof s.do === 'string')
      .map((s, i) => ({
        step: Number(s.step) || i + 1,
        do: String(s.do),
        ...(typeof s.verb === 'string' ? { verb: s.verb } : {}),
        ...(obj(s.args) ? { args: obj(s.args)! } : {}),
        ...(s.yours === true ? { yours: true } : {}),
      }));
    if (!path || !steps.length) return null;   // a build with no path is not an answer
    out.path = {
      key: str(path.key), what: str(path.what), who_builds: str(path.who_builds),
      how_it_connects: str(path.how_it_connects), steps,
    };
  }
  if (kind === 'ask') {
    out.ask = (Array.isArray(a.ask) ? a.ask : []).filter((q): q is string => typeof q === 'string' && !!q);
    if (!out.ask.length) return null;          // "ask" with nothing to ask is not an answer
  }
  return out;
}

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
        ...(typeof judgedRaw.kind === 'string' ? { kind: judgedRaw.kind } : {}),
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
  const answer = readRequestAnswer(payload.answer);
  if (confidence?.level === 'no_verb') {
    const closest = Array.isArray(payload.closest)
      ? payload.closest
          .map((c) => obj(c))
          .filter((c): c is Record<string, unknown> => !!c && typeof c.name === 'string')
          .map((c) => ({ name: String(c.name), description: String(c.description || '') }))
      : [];
    return {
      state: 'no_verb', matches: [], rankedBy, confidence, judged, closest, gap: obj(payload.gap),
      answer: answer?.kind === 'not_ours' ? answer : null,
    };
  }
  // ⛔ Believed only when the server said the level AND sent the whole answer —
  // the same rule as "no verb". Anything less falls through to plain matches.
  if (confidence?.level === 'build' && answer?.kind === 'build') {
    return { state: 'build', matches, rankedBy, confidence, judged, closest: [], gap: null, answer };
  }
  if (confidence?.level === 'ask' && answer?.kind === 'ask') {
    return { state: 'ask', matches: [], rankedBy, confidence, judged, closest: [], gap: null, answer };
  }
  if (!matches.length) return UNUSABLE;
  return { state: 'matches', matches, rankedBy, confidence, judged, closest: [], gap: null, answer: null };
}
