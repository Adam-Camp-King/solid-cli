/**
 * One reading of what the verb surface sends back.
 *
 * ⛔ WHY THIS EXISTS. `POST /api/v1/agent/<namespace>/<verb>` answers in one of
 * two shapes, and which one depends on something a command cannot see — whether
 * the backend serves that address from its own route or from the catch-all:
 *
 *   its own route   { note_id: 7, note_type: "decision" }                     (bare)
 *   the catch-all   { ok: true,  verb: "notes.add", result: { note_id: 7 … } }
 *                   { ok: false, verb: "notes.add", error: { reason, message, next } }
 *
 * Commands written against the bare shape read `data.upload_url` and got
 * `undefined`. Found 2026-10-04 by a customer: `solid app publish --confirm`
 * died with "Failed to parse URL from undefined" and `solid app get` printed
 * "undefined  undefined  (offline)" for a live app — on every version since
 * `solid app` shipped. The same mistake sat in `solid notes`, `solid code` and
 * `solid history`. `--json` looked right throughout, because it prints the
 * answer raw.
 *
 * ⛔ AND WHY THE TESTS WERE GREEN. Each command's test mocked the server with
 * the bare shape the command expected. A fake that agrees with the code under
 * test proves the code agrees with itself. The shapes above are copied from the
 * backend (`controllers/ada.py::_cli_dispatch`); tests use `asDispatched()` to
 * answer the way the server really does.
 *
 * Three commands had already been fixed one at a time with `data.result ?? data`,
 * and two files carried a private helper each. This is the one reading.
 */

export type VerbAnswer = Record<string, any>;

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * The verb's own answer, whichever shape it arrived in.
 *
 * - dispatched and it worked   → the `result`, unwrapped
 * - dispatched and refused     → `{ ok: false, reason, error: <message>, next, verb }`,
 *                                flat, so a command prints the sentence and the way on
 * - answered bare              → unchanged
 */
export function unwrapVerb<T = VerbAnswer>(data: unknown): T {
  if (!isObject(data)) return (data ?? {}) as T;
  const enveloped = 'verb' in data || 'ok' in data;
  if (enveloped && data.ok === false && isObject(data.error)) {
    const err = data.error;
    return {
      ok: false,
      ...(typeof data.verb === 'string' ? { verb: data.verb } : {}),
      ...(err.reason !== undefined ? { reason: err.reason } : err.code !== undefined ? { reason: err.code } : {}),
      error: typeof err.message === 'string' && err.message ? err.message : String(err.reason ?? err.code ?? 'refused'),
      ...(err.next !== undefined ? { next: err.next } : {}),
    } as T;
  }
  if (enveloped && isObject(data.result)) return data.result as T;
  return data as T;
}

/** For tests: the catch-all's envelope around a verb's answer, as the server sends it. */
export function asDispatched(verb: string, result: Record<string, unknown>): Record<string, unknown> {
  return { ok: true, verb, result };
}

/** For tests: the catch-all's refusal, as the server sends it. */
export function asRefused(verb: string, reason: string, message: string, next?: string): Record<string, unknown> {
  return { ok: false, verb, error: { reason, message, ...(next ? { next } : {}) } };
}
