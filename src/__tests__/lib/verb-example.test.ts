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
    expect(placeholderFor('n', { type: 'integer' })).toBe(0);
    expect(placeholderFor('b', { type: 'boolean' })).toBe(false);
    expect(placeholderFor('o', { type: 'object' })).toEqual({});
    expect(placeholderFor('ids', { type: 'array', items: { type: 'integer' } })).toEqual([0]);
  });

  it('treats an undeclared type as a string rather than guessing', () => {
    expect(placeholderFor('mystery')).toBe('<mystery>');
  });

  it('honours a nullable union by taking the real type', () => {
    expect(placeholderFor('n', { type: ['null', 'integer'] })).toBe(0);
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

  it('produces a command that its own validator accepts', () => {
    // The property that makes the example worth pasting: if 2.3 rejects it,
    // the agent's first dry run fails on our placeholder rather than on its
    // own mistake.
    const report = validatePayload(ex.payload, REFUND);
    expect(report.type_errors).toEqual([]);
    expect(report.unknown_fields).toEqual([]);
    expect(report.valid).toBe(true);
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

  it('seeds optional fields when auth supplies the only required one', () => {
    // contact.create's shape: company_id is required and injected, so a
    // literal reading yields `-p '{}'`. An empty object is correct and useless.
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
    // Declaration order, not alphabetical: the schema puts name/email/phone
    // first because they are what the verb is for. Sorting picked
    // company_name/contact_type/custom_fields — correct and useless.
    expect(e.seeded).toEqual(['name', 'email', 'phone']);
    expect(e.payload).toEqual({ name: '<name>', email: 'name@example.com', phone: '<phone>' });
    // The seeded fields must not read as mandatory.
    expect(e.notes.join(' ')).toContain('optional');
    // And the example still has to satisfy its own validator.
    expect(validatePayload(e.payload, only).valid).toBe(true);
  });

  it('does not seed when something is genuinely required', () => {
    expect(buildExample('payment.refund', REFUND).seeded).toEqual([]);
  });

  it('never seeds a container — an empty {} teaches nothing', () => {
    const e = buildExample('v', {
      type: 'object',
      properties: {
        custom_fields: { type: 'object' },
        tags: { type: 'array', items: { type: 'string' } },
        label: { type: 'string' },
      },
      required: ['company_id'],
    } as any);
    expect(e.seeded).toEqual(['label']);
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
