/**
 * `solid verbs example` — the call must be pasteable, not merely printable.
 *
 * Sprint VNP 4.1. Two properties do the work, and both have a specific way of
 * going wrong that a "does it return something" test would miss:
 *
 *   1. auth-injected fields must be ABSENT. `company_id` is in most verbs'
 *      required[] and is filled by the server. An example that includes it
 *      teaches an agent to send a field the platform strips.
 *   2. every placeholder must be TYPE-CORRECT, so `--dry-run` on the example
 *      reaches a real answer instead of failing on the example's own types.
 *
 * The second is checked by round-tripping the generated payload through the
 * 2.3 validator: an example that its own validator rejects is worse than none.
 */
import { buildExample, placeholderFor, shellQuote } from '../../lib/verb-example';
import { validatePayload, type JsonSchema } from '../../lib/schema-validate';

const REFUND: JsonSchema & { properties: Record<string, any> } = {
  type: 'object',
  properties: {
    company_id: { type: 'integer', description: 'Injected from auth in HTTP path' },
    transaction_id: { type: 'string' },
    amount_cents: { type: 'integer' },
    reason: { type: 'string', enum: ['duplicate', 'fraudulent', 'requested'] },
    notify: { type: 'boolean' },
    occurred_at: { type: 'string', format: 'date-time' },
    metadata: { type: 'object' },
  },
  required: ['company_id', 'transaction_id', 'amount_cents'],
};

describe('placeholderFor', () => {
  it('gives strings a visibly fake value', () => {
    expect(placeholderFor('contact_id', { type: 'string' })).toBe('<contact_id>');
  });

  it('prefers a real enum member over a placeholder', () => {
    // The first legal value documents the vocabulary and is immediately valid.
    expect(placeholderFor('reason', { type: 'string', enum: ['duplicate', 'fraudulent'] }))
      .toBe('duplicate');
  });

  it('spells the formats an agent would otherwise guess', () => {
    expect(placeholderFor('start', { type: 'string', format: 'date-time' })).toBe('2026-01-01T09:00:00Z');
    expect(placeholderFor('to', { type: 'string', format: 'email' })).toBe('name@example.com');
  });

  it('keeps numbers, booleans and containers in their own type', () => {
    // ⛔ -1, NOT 0. `{"site_id": 0}` is a plausible integer and the payload is
    // the part people copy — nothing in it said "substitute me". A string
    // placeholder is angle-bracketed and unmistakable; a number has to earn
    // that too, and -1 is legal JSON that is never a real id, limit or count.
    expect(placeholderFor('n', { type: 'integer' })).toBe(-1);
    expect(placeholderFor('b', { type: 'boolean' })).toBe(false);
    expect(placeholderFor('o', { type: 'object' })).toEqual({});
    expect(placeholderFor('ids', { type: 'array', items: { type: 'integer' } })).toEqual([-1]);
  });

  it('treats an undeclared type as a string rather than guessing', () => {
    expect(placeholderFor('mystery')).toBe('<mystery>');
  });

  it('honours a nullable union by taking the real type', () => {
    expect(placeholderFor('n', { type: ['null', 'integer'] })).toBe(-1);
  });
});

describe('buildExample', () => {
  const ex = buildExample('payment.refund', REFUND, { sideEffects: 'write' });

  it('omits auth-injected fields and says why they are missing', () => {
    expect(ex.payload).not.toHaveProperty('company_id');
    expect(ex.injected).toEqual(['company_id']);
  });

  it('fills every field the caller genuinely has to supply', () => {
    expect(Object.keys(ex.payload).sort()).toEqual(['amount_cents', 'transaction_id']);
  });

  it('lists the optional properties without filling them', () => {
    expect(ex.optional).toEqual(['metadata', 'notify', 'occurred_at', 'reason']);
  });

  it('flags placeholders that could be mistaken for real values', () => {
    // `<transaction_id>` cannot be. A `0` amount can, so it must be named.
    expect(ex.notes.join(' ')).toContain('amount_cents');
    expect(ex.notes.join(' ')).not.toContain('transaction_id');
  });

  it('produces a shape its own validator accepts, and says what is left to fill', () => {
    // ⛔ THIS ASSERTION WAS WEAKENED ON PURPOSE, AND THAT IS THE POINT.
    // It used to require `valid: true`, on the reasoning that "if the
    // validator rejects our own example, the agent's first dry run fails on
    // OUR placeholder rather than on its own mistake."
    //
    // That reasoning only held while the validator ignored values. It did:
    // `--dry-run` reported valid:true for {"status":"<status>","limit":0},
    // which the server then 400'd — the playground certifying a call that
    // cannot work is a worse failure than a dry run that says "substitute
    // this first".
    //
    // So for a verb with REQUIRED fields the example is a TEMPLATE, not a
    // runnable call — we cannot invent a real transaction_id — and the right
    // behaviour is to say exactly which fields still need a value. What must
    // never happen is a SHAPE error: the types and field names are ours to get
    // right, and those are still asserted empty.
    const report = validatePayload(ex.payload, REFUND);
    expect(report.type_errors).toEqual([]);
    expect(report.unknown_fields).toEqual([]);
    expect(report.missing_required).toEqual([]);
    // Every remaining objection is "you have not filled this in yet".
    expect(report.value_errors.length).toBeGreaterThan(0);
    expect(report.value_errors.every((e) => e.kind === 'placeholder')).toBe(true);
    expect(report.value_errors.map((e) => e.field).sort())
      .toEqual(['amount_cents', 'transaction_id']);
  });

  it('a verb needing nothing produces a payload that IS valid', () => {
    // The other half of the contract, and the case that was actually broken:
    // when auth supplies everything required, the example must be a call that
    // runs as it stands.
    const e = buildExample('workflow.list', {
      type: 'object',
      properties: { status: { type: 'string' }, limit: { type: 'integer' } },
      required: [],
    } as any);
    expect(e.payload).toEqual({});
    expect(validatePayload(e.payload, { type: 'object', properties: {}, required: [] }).valid)
      .toBe(true);
  });

  it('rehearses before it commits, for a write', () => {
    expect(ex.command).toContain('--dry-run');
    expect(ex.command).toContain('--confirm');
    expect(ex.command.indexOf('--dry-run')).toBeLessThan(ex.command.indexOf('--confirm'));
  });

  it('does not mention consent for a read', () => {
    const r = buildExample('payments.preview_refund_impact', REFUND, { sideEffects: 'read' });
    expect(r.command).toContain('--dry-run');
    expect(r.command).not.toContain('--confirm');
  });

  it('sends {} when auth supplies the only required field — and NAMES the options', () => {
    // ⛔ THIS TEST USED TO ASSERT THE BUG. It pinned that the example seeds up
    // to three optional fields into the payload, on the reasoning that a bare
    // {} "is correct and useless". Measured 2026-09-13, the seeded payload was
    // not merely inelegant, it was WRONG:
    //
    //     solid verbs example workflow.list  ->  {"status":"<status>","limit":0}
    //     that payload                       ->  400 BAD_REQUEST
    //     {}                                 ->  ok:true
    //
    // Same for invoice.summary and report_transactions. Three working verbs
    // went into the eval baseline as broken because the example volunteered
    // values the server rejects, and --dry-run then certified the call.
    //
    // The original goal stands — an empty object teaches nothing — but the
    // teaching belongs in `optional` and the notes, not in a payload that is
    // advertised as runnable and is not.
    const only: JsonSchema & { properties: Record<string, any> } = {
      type: 'object',
      properties: {
        company_id: { type: 'integer' },
        name: { type: 'string' },
        email: { type: 'string', format: 'email' },
        phone: { type: 'string' },
        source: { type: 'string' },
      },
      required: ['company_id'],
    };
    const e = buildExample('contact.create', only, { sideEffects: 'write' });
    expect(e.payload).toEqual({});
    expect(e.seeded).toEqual([]);
    // The options are still taught, just not smuggled into the call.
    expect(e.optional).toEqual(['email', 'name', 'phone', 'source']);
    const note = e.notes.join(' ');
    expect(note).toContain('{}');
    expect(note).toContain('name');
    expect(note).toContain('email');
  });

  it('never puts a container in the payload either', () => {
    // Nothing optional goes in the payload now, containers least of all.
    const e = buildExample('v', {
      type: 'object',
      properties: {
        custom_fields: { type: 'object' },
        tags: { type: 'array', items: { type: 'string' } },
        label: { type: 'string' },
      },
      required: ['company_id'],
    } as any);
    expect(e.payload).toEqual({});
    expect(e.seeded).toEqual([]);
  });

  it('survives the 20 verbs that declare no schema at all', () => {
    const e = buildExample('ai_employees_list', {});
    expect(e.payload).toEqual({});
    expect(e.optional).toEqual([]);
    expect(e.command).toContain('solid verbs invoke ai_employees_list');
  });

  it('survives a required field the properties block never declares', () => {
    // The registry has these. Falling back to a string placeholder keeps the
    // example callable instead of dropping the field silently.
    const e = buildExample('v', { type: 'object', properties: {}, required: ['ghost'] });
    expect(e.payload).toEqual({ ghost: '<ghost>' });
  });
});

describe('shellQuote', () => {
  it('wraps in single quotes so JSON double quotes survive a shell', () => {
    expect(shellQuote('{"a":1}')).toBe(`'{"a":1}'`);
  });

  it('escapes an embedded single quote the only way a POSIX shell allows', () => {
    expect(shellQuote(`it's`)).toBe(`'it'\\''s'`);
  });
});
