/**
 * The contract an AI agent depends on when it drives this CLI:
 *
 *   1. A failed command exits non-zero. Exit 0 with no payload is
 *      indistinguishable from "succeeded and found nothing", so an agent
 *      reports success on a 404 and moves on.
 *   2. A 200 carrying an error-shaped body is still a failure.
 *   3. An explicit --format csv|tsv is honoured even when stdout is piped
 *      (which is always, for an agent).
 *
 * Each of these shipped broken; these tests are the guard.
 */
import { detectErrorBody } from '../../lib/api-client';
import { explicitDelimitedFormat } from '../../lib/json-output';

describe('detectErrorBody — a 200 that is really a failure', () => {
  it('catches {status:"error"} with a summary (the `forms get` shape)', () => {
    expect(
      detectErrorBody({ status: 'error', summary: 'survey 99 not found for this company' }),
    ).toEqual({ message: 'survey 99 not found for this company', code: undefined });
  });

  it('catches an error nested in the verb envelope (the `invoices get` shape)', () => {
    expect(
      detectErrorBody({
        ok: true,
        verb: 'invoice.get',
        result: { error: 'invoice_not_found', message: 'invoice 99 not found' },
      }),
    ).toEqual({ message: 'invoice 99 not found', code: 'invoice_not_found' });
  });

  it('catches {ok:false}', () => {
    expect(detectErrorBody({ ok: false, error: 'nope' })).toEqual({
      message: 'nope',
      code: undefined,
    });
  });

  // False positives here would break working commands, so pin the real
  // payloads that must NOT be read as errors.
  it('does NOT fire on {status:"healthy"} — `solid health`', () => {
    expect(detectErrorBody({ status: 'healthy', timestamp: 'x' })).toBeNull();
  });

  it('does NOT fire on {ok:true} with a clean result — `solid invoices list`', () => {
    expect(detectErrorBody({ ok: true, verb: 'invoice.list', result: { invoices: [] } })).toBeNull();
  });

  it('does NOT fire on an ordinary list body', () => {
    expect(detectErrorBody({ items: [1, 2], total: 2 })).toBeNull();
  });

  it('ignores non-objects', () => {
    expect(detectErrorBody(null)).toBeNull();
    expect(detectErrorBody([{ status: 'error' }])).toBeNull();
    expect(detectErrorBody('error')).toBeNull();
  });
});

describe('explicitDelimitedFormat — --format must beat the non-TTY inference', () => {
  const argv = process.argv;
  afterEach(() => { process.argv = argv; });

  it.each([
    [['--format', 'csv'], true],
    [['--format', 'tsv'], true],
    [['--format=csv'], true],
    [['--format=tsv'], true],
    [['--format', 'json'], false],
    [[], false],
  ])('%p -> %p', (flags, expected) => {
    process.argv = ['node', 'solid', 'pages', 'list', ...(flags as string[])];
    expect(explicitDelimitedFormat()).toBe(expected);
  });
});
