/**
 * Local validation must agree with the server, or it is worse than nothing.
 *
 * Sprint VNP 2.3. `--dry-run` used to return success:true for a missing
 * required field, a wrong type, and a field that is not in the schema. The
 * real call then failed with a 422 naming the field, so the sandbox said yes
 * and production said no.
 *
 * The trap, and most of what these tests are about: `company_id` sits in the
 * `required` array of most verbs but is injected from auth and stripped from
 * caller args by cli-dispatch. Validating `required` literally would report a
 * missing field on nearly every verb — turning "always says yes" into "always
 * says no", which is louder and equally useless.
 *
 * Checked against the live API while writing this:
 *   payments.preview_refund_impact  required = ["company_id","transaction_id"]
 *   payload {}                      server 422 names ONLY transaction_id
 *   this validator                  missing_required = ["transaction_id"]
 */
import {
  validatePayload,
  jsonTypeOf,
  fixFor,
  AUTH_INJECTED,
  type JsonSchema,
} from '../../lib/schema-validate';

const SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    company_id: { type: 'integer' },
    transaction_id: { type: 'string' },
    amount_cents: { type: 'integer' },
    ratio: { type: 'number' },
    note: { type: 'string', nullable: true },
    active: { type: 'boolean' },
    tags: { type: 'array' },
    meta: { type: 'object' },
  },
  required: ['company_id', 'transaction_id'],
  additionalProperties: true,
};

describe('jsonTypeOf', () => {
  it.each([
    [null, 'null'],
    [[], 'array'],
    [{}, 'object'],
    ['x', 'string'],
    [true, 'boolean'],
    [1, 'integer'],
    [1.5, 'number'],
  ])('%p is %s', (v, want) => expect(jsonTypeOf(v)).toBe(want));
});

describe('auth-injected fields', () => {
  it('never reports company_id as missing, though the schema requires it', () => {
    // The single most important assertion in this file. Without it every dry
    // run on every verb reports a missing field the caller must not send.
    const r = validatePayload({ transaction_id: 't1' }, SCHEMA);
    expect(r.missing_required).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it('does not flag them as unknown either, if a caller sends one anyway', () => {
    const r = validatePayload({ transaction_id: 't1', user_id: 9 }, SCHEMA);
    expect(r.unknown_fields).toEqual([]);
  });

  it('covers exactly what the backend strips or injects', () => {
    // controllers/ada.py strips {company_id, user_id} from caller args and
    // injects viewer_user_id / viewer_role from the session.
    expect([...AUTH_INJECTED].sort()).toEqual(
      ['company_id', 'user_id', 'viewer_role', 'viewer_user_id'],
    );
  });
});

describe('missing required', () => {
  it('names the caller-supplied field that is absent', () => {
    const r = validatePayload({}, SCHEMA);
    expect(r.missing_required).toEqual(['transaction_id']);
    expect(r.valid).toBe(false);
  });

  it('treats an explicit undefined as missing', () => {
    expect(validatePayload({ transaction_id: undefined }, SCHEMA).valid).toBe(false);
  });

  it('accepts null for a nullable field', () => {
    const r = validatePayload({ transaction_id: 't1', note: null }, SCHEMA);
    expect(r.valid).toBe(true);
  });

  it('rejects null for a field that is not nullable', () => {
    const r = validatePayload({ transaction_id: null }, SCHEMA);
    expect(r.type_errors[0]).toMatchObject({ field: 'transaction_id', got: 'null' });
  });
});

describe('type errors', () => {
  it('names field, wanted and got', () => {
    const r = validatePayload({ transaction_id: 123 }, SCHEMA);
    expect(r.type_errors).toEqual([{ field: 'transaction_id', want: 'string', got: 'integer' }]);
    expect(r.valid).toBe(false);
  });

  it('an integer satisfies number', () => {
    expect(validatePayload({ transaction_id: 't', ratio: 2 }, SCHEMA).valid).toBe(true);
  });

  it('a float does NOT satisfy integer', () => {
    // Quietly accepting 10.5 into a cents field is how money goes wrong.
    const r = validatePayload({ transaction_id: 't', amount_cents: 10.5 }, SCHEMA);
    expect(r.type_errors).toEqual([{ field: 'amount_cents', want: 'integer', got: 'number' }]);
  });

  it('distinguishes array from object', () => {
    const r = validatePayload({ transaction_id: 't', tags: {}, meta: [] }, SCHEMA);
    expect(r.type_errors).toHaveLength(2);
  });
});

describe('unknown fields', () => {
  it('reports them even when the schema allows extras', () => {
    // Never silent: a forwarded, ignored field is how a typo reaches prod.
    const r = validatePayload({ transaction_id: 't', bogus: 1 }, SCHEMA);
    expect(r.unknown_fields).toEqual(['bogus']);
  });

  it('is not fatal when additionalProperties is true', () => {
    // 618 of 845 verbs declare the key and most allow extras. Rejecting them
    // would refuse payloads the server accepts.
    expect(validatePayload({ transaction_id: 't', bogus: 1 }, SCHEMA).valid).toBe(true);
  });

  it('IS fatal when additionalProperties is false', () => {
    const strict = { ...SCHEMA, additionalProperties: false };
    expect(validatePayload({ transaction_id: 't', bogus: 1 }, strict).valid).toBe(false);
  });
});

describe('degenerate schemas', () => {
  it('a missing schema validates anything rather than blocking', () => {
    expect(validatePayload({ a: 1 }, undefined).valid).toBe(true);
    expect(validatePayload({ a: 1 }, null).valid).toBe(true);
  });

  it('an empty-properties schema does not reject every field', () => {
    // 20 verbs ship a schema with no properties at all.
    const empty: JsonSchema = { type: 'object', properties: {} };
    const r = validatePayload({ a: 1 }, empty);
    expect(r.valid).toBe(true);
    expect(r.unknown_fields).toEqual(['a']);
  });
});

describe('fixFor', () => {
  it('names a real command, not one that ships later', () => {
    const r = validatePayload({}, SCHEMA);
    const fix = fixFor('payments.preview_refund_impact', r);
    expect(fix).toContain('transaction_id');
    expect(fix).toContain('solid verbs describe');
    // `solid verbs example` is 4.1. Naming it now would be the same
    // documented-but-nonexistent bug this sprint keeps finding.
    expect(fix).not.toContain('verbs example');
  });

  it('explains a type error in terms of want and got', () => {
    const r = validatePayload({ transaction_id: 5 }, SCHEMA);
    expect(fixFor('v', r)).toContain('must be string, got integer');
  });
});
