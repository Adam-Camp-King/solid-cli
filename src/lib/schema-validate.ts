/**
 * Validate a verb payload against its declared input_schema, locally.
 *
 * Sprint VNP 2.3. `--dry-run` validated nothing: a missing required field, a
 * wrong type and a field that does not exist in the schema all returned
 * `success: true` and exit 0. The real call then failed correctly with a 422
 * naming the field — so the sandbox said yes and production said no, which is
 * the one arrangement worse than having no sandbox at all.
 *
 * Everything needed to catch it was already local: 753 of 845 verbs declare a
 * non-empty `required[]`, and the CLI has the schema in hand before it sends.
 *
 * ⛔ AUTH-INJECTED FIELDS ARE NOT THE CALLER'S TO SUPPLY. This is the trap that
 * makes a naive implementation worse than none. `company_id` is in the
 * `required` array of most verbs, and its own description says "Injected from
 * auth in HTTP path" — the server fills it and cli-dispatch actively strips it
 * from caller args (controllers/ada.py: `k not in {"company_id","user_id"}`).
 * Verified live: `payments.preview_refund_impact` declares
 * required=["company_id","transaction_id"] and an empty payload returns 422
 * naming ONLY transaction_id.
 *
 * So validating `required` literally would report a missing field on nearly
 * every verb, turning "the dry run always says yes" into "the dry run always
 * says no". Louder, and still wrong. These are excluded.
 *
 * Pure. No I/O, no network — which is also what makes it usable as the T2
 * contract sweep over all 466 writes.
 */

/** Filled in by the server from the session; a caller must never send them. */
export const AUTH_INJECTED = new Set([
  'company_id',
  'user_id',
  'viewer_user_id',
  'viewer_role',
]);

export interface TypeError_ {
  field: string;
  want: string;
  got: string;
}

export interface ValidationReport {
  valid: boolean;
  missing_required: string[];
  type_errors: TypeError_[];
  unknown_fields: string[];
}

export interface JsonSchema {
  type?: string;
  properties?: Record<string, { type?: string | string[]; nullable?: boolean }>;
  required?: string[];
  additionalProperties?: boolean;
}

/** The JSON type name of a value, in the vocabulary schemas use. */
export function jsonTypeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  const t = typeof v;
  if (t === 'number') return Number.isInteger(v as number) ? 'integer' : 'number';
  return t; // string | boolean | object | undefined
}

/** Does `value` satisfy a declared type (or one of a union)? */
function typeMatches(value: unknown, want: string | string[] | undefined, nullable?: boolean): boolean {
  if (want === undefined) return true;              // untyped property: anything goes
  if (value === null) return nullable === true || (Array.isArray(want) ? want.includes('null') : want === 'null');

  const wants = Array.isArray(want) ? want : [want];
  const got = jsonTypeOf(value);

  for (const w of wants) {
    if (w === got) return true;
    // An integer satisfies "number". The reverse is not true — 1.5 is not an
    // integer, and silently accepting it is how a cents field becomes wrong.
    if (w === 'number' && got === 'integer') return true;
  }
  return false;
}

/**
 * Check a payload against a schema.
 *
 * `unknown_fields` is reported but is only fatal when the schema sets
 * `additionalProperties: false`. 618 of 845 verbs declare the key and most
 * allow extras, so treating every unknown field as an error would reject
 * payloads the server accepts. Reported always, though — a field silently
 * forwarded and silently ignored is how a typo survives to production.
 */
export function validatePayload(
  payload: Record<string, unknown>,
  schema: JsonSchema | undefined | null,
): ValidationReport {
  const report: ValidationReport = {
    valid: true,
    missing_required: [],
    type_errors: [],
    unknown_fields: [],
  };
  if (!schema || typeof schema !== 'object') return report;

  const props = schema.properties || {};

  for (const field of schema.required || []) {
    if (AUTH_INJECTED.has(field)) continue;
    const missing =
      !(field in payload) || payload[field] === undefined;
    if (missing) report.missing_required.push(field);
  }

  for (const [field, value] of Object.entries(payload)) {
    const spec = props[field];
    if (!spec) {
      if (!AUTH_INJECTED.has(field)) report.unknown_fields.push(field);
      continue;
    }
    if (value === undefined) continue;
    if (!typeMatches(value, spec.type, spec.nullable)) {
      report.type_errors.push({
        field,
        want: Array.isArray(spec.type) ? spec.type.join('|') : String(spec.type),
        got: jsonTypeOf(value),
      });
    }
  }

  const extrasAreFatal = schema.additionalProperties === false;
  report.valid =
    report.missing_required.length === 0 &&
    report.type_errors.length === 0 &&
    (!extrasAreFatal || report.unknown_fields.length === 0);

  return report;
}

/**
 * The literal next command for a failed validation.
 *
 * Points at `solid verbs describe`, which exists. `solid verbs example` would
 * read better and is what the sprint doc suggests — but it does not ship until
 * 4.1, and naming an unbuilt command in an error message is precisely the bug
 * this sprint keeps finding elsewhere.
 */
export function fixFor(verb: string, report: ValidationReport): string {
  if (report.missing_required.length) {
    const first = report.missing_required[0];
    return `add ${first} — solid verbs describe ${verb}`;
  }
  if (report.type_errors.length) {
    const { field, want, got } = report.type_errors[0];
    return `${field} must be ${want}, got ${got} — solid verbs describe ${verb}`;
  }
  if (report.unknown_fields.length) {
    return `remove ${report.unknown_fields[0]} — solid verbs describe ${verb}`;
  }
  return `solid verbs describe ${verb}`;
}
