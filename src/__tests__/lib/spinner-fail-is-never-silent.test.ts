/**
 * A failed spinner must still say why when JSON was asked for.
 *
 * `solid agent dispatch kb_entry_create --json` with no --confirm printed
 * nothing and exited 1 (seen 2026-10-12): the refusal was reported only through
 * spinner.fail(), and the spinner is silent under --json. An AI calling the CLI
 * got an empty reply to every refused or failed write.
 */
import spinner from '../../lib/spinner';

describe('spinner.fail under --json', () => {
  const argv = process.argv;
  let written: string[];
  let spy: jest.SpyInstance;

  beforeEach(() => {
    written = [];
    spy = jest.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      written.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    }) as never);
  });

  afterEach(() => {
    spy.mockRestore();
    process.argv = argv;
  });

  it('writes the failure line to stderr', () => {
    process.argv = [...argv, '--json'];
    spinner('Dispatching kb_entry_create...').start().fail('kb_entry_create: confirmation_required');
    expect(written.join('')).toContain('kb_entry_create: confirmation_required');
  });

  it('still prints no progress and no success line', () => {
    process.argv = [...argv, '--json'];
    spinner('Dispatching kb_entry_create...').start().succeed('done');
    expect(written.join('')).toBe('');
  });

  it('a caller that asked for silence itself still gets silence', () => {
    process.argv = [...argv, '--json'];
    spinner({ text: 'x', isSilent: true }).start().fail('hidden');
    expect(written.join('')).toBe('');
  });
});
