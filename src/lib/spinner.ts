/**
 * The one spinner factory. Drop-in for `ora(...)`.
 *
 * Every command used to call `ora()` directly, so whether a spinner leaked
 * chrome depended on each call site remembering `isSilent`. Most did not:
 * `solid pages get 300 --json` printed "- Loading page #300..." ahead of the
 * JSON, and an agent capturing both streams got an unparseable payload.
 *
 * Rules, applied here once:
 *   - always writes to stderr, never stdout;
 *   - SILENT (no output at all) when JSON was explicitly asked for — --json
 *     anywhere on the command line, SOLID_JSON=1 — or --quiet / --no-spinner /
 *     --raw / SOLID_QUIET=1;
 *   - NO PROGRESS LINE when stdout is merely not a TTY (json-output's
 *     auto-detect): the "- Loading..." start line is dropped, but the final
 *     succeed/fail line still goes to stderr — for commands with no JSON
 *     mode it is the only confirmation they print.
 * An explicit `isSilent` from the caller still wins.
 */
import type ora from 'ora';
import { isJsonOutput } from './json-output';

export type SpinnerMode = 'normal' | 'no-progress' | 'silent';

export function spinnerMode(): SpinnerMode {
  const argv = process.argv;
  if (process.env.SOLID_QUIET === '1' || process.env.SOLID_QUIET === 'true') return 'silent';
  if (argv.includes('--quiet') || argv.includes('--no-spinner') || argv.includes('--raw')) return 'silent';
  if (argv.includes('--no-json')) return 'normal';
  if (argv.includes('--json')) return 'silent';
  if (process.env.SOLID_JSON && /^(1|true|yes|on)$/i.test(process.env.SOLID_JSON)) return 'silent';
  if (isJsonOutput()) return 'no-progress';
  return 'normal';
}

/** True when a spinner would print nothing at all. */
export function spinnersSuppressed(): boolean {
  return spinnerMode() === 'silent';
}

export default function spinner(options?: string | ora.Options): ora.Ora {
  const base: ora.Options = typeof options === 'string' ? { text: options } : { ...(options || {}) };
  const mode = base.isSilent !== undefined ? 'normal' : spinnerMode();
  const opts: ora.Options = {
    ...base,
    stream: base.stream || process.stderr,
    isSilent: base.isSilent !== undefined ? base.isSilent : mode === 'silent',
  };
  // Resolved at call time so jest.mock('ora') in either shape (a bare
  // function, or {__esModule, default}) still applies.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('ora');
  const factory = (mod && mod.default) || mod;
  if (mode !== 'no-progress') return factory(opts) as ora.Ora;

  // Start with no text so the non-interactive "- <text>" line is never
  // written, then restore the text so succeed()/fail() with no argument
  // still report it.
  const text = opts.text ?? '';
  const s = factory({ ...opts, text: '' }) as ora.Ora;
  const realStart = s.start.bind(s);
  (s as { start: ora.Ora['start'] }).start = (t?: string) => {
    realStart();
    try { s.text = t ?? text; } catch { /* mocks may not allow it */ }
    return s;
  };
  return s;
}
