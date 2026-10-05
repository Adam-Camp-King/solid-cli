/**
 * One reading of what the verb surface sends back.
 *
 * ⛔ WHY THIS EXISTS. `POST /api/v1/agent/<ns>/<verb>` answers bare from its own
 * route and wrapped — `{ ok, verb, result }` — from the backend's catch-all.
 * `solid app`, `solid notes`, `solid code` and `solid history` read the wrapper
 * as if it were the answer. A customer found it on 2026-10-04:
 *
 *   $ solid app publish docs --slug sell --confirm
 *   ✗ Failed to parse URL from undefined
 *   $ solid app get sell
 *   undefined  undefined  (offline)          ← the app was live
 *
 * The shapes below are the server's (controllers/ada.py::_cli_dispatch), not
 * what a command would like them to be.
 */
import { asDispatched, asRefused, unwrapVerb } from '../../lib/verb-envelope';

const UPLOAD = {
  ok: true, upload_id: 'a'.repeat(32), upload_url: 'https://store.example/put?sig=1',
  method: 'PUT', headers: { 'Content-Type': 'application/zip' }, max_bytes: 26214400, expires_in: 3600,
};

describe('unwrapVerb', () => {
  it('reads the answer out of the catch-all envelope — the customer case', () => {
    const sent = { ok: true, verb: 'app.upload_url', result: UPLOAD };
    expect((sent as any).upload_url).toBeUndefined();          // what the CLI used to read
    expect(unwrapVerb(sent).upload_url).toBe(UPLOAD.upload_url);
    expect(unwrapVerb(sent)).toEqual(UPLOAD);
  });

  it('leaves a bare answer exactly as it is', () => {
    const bare = { note_id: 7, note_type: 'decision' };
    expect(unwrapVerb(bare)).toBe(bare);
  });

  it('leaves a bare answer alone even when it has a key called result', () => {
    // No `ok` and no `verb`: this is a payload, not an envelope.
    const bare = { result: { rows: 3 }, took_ms: 12 };
    expect(unwrapVerb(bare)).toBe(bare);
  });

  it('keeps a verb-level refusal the handler returned inside the envelope', () => {
    const sent = asDispatched('app.publish', { ok: false, error: '1 file(s) did not pass the safety check.', next: 'Remove them.' });
    expect(unwrapVerb(sent)).toEqual({ ok: false, error: '1 file(s) did not pass the safety check.', next: 'Remove them.' });
  });

  it('flattens a door-level refusal so the sentence and the way on can be printed', () => {
    const sent = asRefused('app.publish', 'confirmation_required', 'This changes what is live. Send confirm: true.', 'Add --confirm.');
    expect(unwrapVerb(sent)).toEqual({
      ok: false, verb: 'app.publish', reason: 'confirmation_required',
      error: 'This changes what is live. Send confirm: true.', next: 'Add --confirm.',
    });
  });

  it('a refusal with no message still says something', () => {
    expect(unwrapVerb({ ok: false, verb: 'x.y', error: { reason: 'unknown_tool' } }))
      .toEqual({ ok: false, verb: 'x.y', reason: 'unknown_tool', error: 'unknown_tool' });
  });

  it('an envelope whose result is a list or a scalar is left for the caller', () => {
    const sent = { ok: true, verb: 'x.count', result: 3 };
    expect(unwrapVerb(sent)).toBe(sent);
  });

  it.each([null, undefined])('answers an empty object for %p', (v) => {
    expect(unwrapVerb(v)).toEqual({});
  });

  it('the test helpers build what the server sends', () => {
    expect(asDispatched('notes.add', { note_id: 1 })).toEqual({ ok: true, verb: 'notes.add', result: { note_id: 1 } });
    expect(asRefused('notes.add', 'r', 'm')).toEqual({ ok: false, verb: 'notes.add', error: { reason: 'r', message: 'm' } });
  });
});
