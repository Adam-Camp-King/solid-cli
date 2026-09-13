/**
 * Build a ready-to-edit call from a verb's declared input_schema.
 *
 * Sprint VNP 4.1. Between "I found the verb" and "I called it correctly" sits
 * a guess: which fields, in what shape. That guess is where most sad paths
 * start, and the manifest already contains everything needed to remove it.
 *
 * Two rules make the output worth pasting rather than merely reading.
 *
 * ⛔ AUTH-INJECTED FIELDS ARE NEVER IN THE EXAMPLE. `company_id` sits in most
 * verbs' `required[]` and is filled by the server — `cli_dispatch` strips it
 * from caller args. An example that includes it teaches an agent to send a
 * field the platform ignores, and the same trap already made a naive 2.3
 * validator report a missing field on nearly every verb. Reuses the one
 * exclusion list from schema-validate so the two can never disagree.
 *
 * ⛔ EVERY PLACEHOLDER IS TYPE-CORRECT. The point of the example is that
 * `--dry-run` on it reaches a real validation answer instead of tripping on
 * the example's own types. A string placeholder is visibly angle-bracketed so
 * nobody mistakes it for a value; numbers and booleans cannot be, which is why
 * `notes` names them explicitly rather than hoping the shape speaks for itself.
 *
 * Pure — no network, no I/O. The command string is assembled here so the JSON
 * and human paths cannot drift.
 */
import { AUTH_INJECTED, type JsonSchema } from './schema-validate';

/** A property as the manifest declares it. Deliberately loose: the registry
 *  carries untyped and enum-only properties and both must survive. */
export interface SchemaProperty {
  type?: string | string[];
  format?: string;
  enum?: unknown[];
  description?: string;
  items?: { type?: string | string[] };
  nullable?: boolean;
}

export interface VerbExample {
  verb: string;
  /** The payload, required fields only, every value a typed placeholder. */
  payload: Record<string, unknown>;
  /** Declared optional properties, named but not filled in. */
  optional: string[];
  /** Fields the server supplies; listed so their absence reads as deliberate. */
  injected: string[];
  /** Placeholders a reader could mistake for real values. */
  notes: string[];
  /** Optional fields filled in only because nothing was required. */
  seeded: string[];
  /** The literal command, ready to paste. */
  command: string;
}

/** The first declared type, when a property declares a union. */
function firstType(t: string | string[] | undefined): string | undefined {
  if (Array.isArray(t)) return t.find((x) => x !== 'null') ?? t[0];
  return t;
}

/**
 * A placeholder for one property: the right JSON type, and unmistakable as a
 * value wherever the type allows it to be.
 */
export function placeholderFor(name: string, p: SchemaProperty = {}): unknown {
  // An enum's first member is a real, legal value — better than a placeholder,
  // because it also documents the vocabulary.
  if (Array.isArray(p.enum) && p.enum.length > 0) return p.enum[0];

  switch (firstType(p.type)) {
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'array': {
      const inner = firstType(p.items?.type);
      if (inner === 'integer' || inner === 'number') return [0];
      if (inner === 'object') return [{}];
      return inner === undefined ? [] : [`<${name}>`];
    }
    case 'object':
      return {};
    case 'null':
      return null;
    case 'string':
    default:
      // Formats an agent would otherwise have to guess the spelling of.
      switch (p.format) {
        case 'date-time': return '2026-01-01T09:00:00Z';
        case 'date': return '2026-01-01';
        case 'email': return 'name@example.com';
        case 'uri':
        case 'url': return 'https://example.com';
        default: return `<${name}>`;
      }
  }
}

/** Single-quoted for a POSIX shell; embedded quotes are escaped the only way
 *  a single-quoted shell string can be. */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function buildExample(
  verbName: string,
  schema: JsonSchema & { properties?: Record<string, SchemaProperty> } = {},
  opts: { sideEffects?: string } = {},
): VerbExample {
  const properties = (schema.properties ?? {}) as Record<string, SchemaProperty>;
  const required = (schema.required ?? []).filter((f) => typeof f === 'string');

  const injected = required.filter((f) => AUTH_INJECTED.has(f));
  const callerRequired = required.filter((f) => !AUTH_INJECTED.has(f));

  const payload: Record<string, unknown> = {};
  const notes: string[] = [];
  for (const field of callerRequired) {
    const prop = properties[field] ?? {};
    const value = placeholderFor(field, prop);
    payload[field] = value;
    // A `0` or a `false` reads as a decision, not a blank. Say so, once per
    // field, rather than trusting the reader to infer it from the type.
    if (value === 0) notes.push(`${field} is a placeholder 0 — replace it with a real ${firstType(prop.type) ?? 'number'}`);
    else if (value === false) notes.push(`${field} defaults to false here — set it deliberately`);
  }

  const optional = Object.keys(properties)
    .filter((f) => !required.includes(f) && !AUTH_INJECTED.has(f))
    .sort();

  // A verb whose only required field is auth-injected would otherwise hand back
  // `-p '{}'` — technically correct and useless. contact.create is exactly this
  // shape: `company_id` is its sole required field, and the seven fields an
  // agent actually needs are all optional. Seed a few so the example is a call
  // rather than an empty object, and say which they are so nobody reads them as
  // mandatory.
  //
  // ⛔ Seed in DECLARATION order, not the sorted order `optional` is displayed
  // in. Schema authors list the fields that matter first: contact.create
  // declares `name, email, phone, company_name, source, contact_type,
  // custom_fields`, so alphabetical seeding picked company_name, contact_type
  // and custom_fields — the three least useful fields it has. Sorting is right
  // for a list a human scans and wrong for a choice about significance.
  //
  // Containers are skipped: `{}` or `[]` in an example teaches nothing about
  // what belongs inside them.
  const seeded: string[] = [];
  if (callerRequired.length === 0) {
    const candidates = Object.keys(properties).filter((f) => {
      if (required.includes(f) || AUTH_INJECTED.has(f)) return false;
      const t = firstType(properties[f]?.type);
      return t !== 'object' && t !== 'array';
    });
    for (const field of candidates.slice(0, 3)) {
      payload[field] = placeholderFor(field, properties[field] ?? {});
      seeded.push(field);
    }
    if (seeded.length) {
      notes.push(`no field is required beyond auth — ${seeded.join(', ')} are optional, seeded so this is a call you can run`);
    }
  }

  const writes = opts.sideEffects !== undefined && opts.sideEffects !== 'read';
  const command =
    `solid verbs invoke ${verbName} -p ${shellQuote(JSON.stringify(payload))}` +
    ` --dry-run${writes ? '  # then swap --dry-run for --confirm' : ''}`;

  return { verb: verbName, payload, optional, injected, seeded, notes, command };
}
