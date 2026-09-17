/**
 * DNS instructions + verification details — rendered from what the BACKEND
 * says, never from a CLI-side guess.
 *
 * `POST /api/v1/domains/custom` (and `GET /api/v1/domains/custom` for an
 * unverified domain) return `dns_instructions` built by
 * solid-backend `models/domain.py::dns_instructions_for`:
 *
 *   { domain, records: [{type, name, value, ttl, pending?}], instructions: [str] }
 *
 * An apex domain needs an A record + TXT `_solid-verify`; a subdomain needs a
 * CNAME + TXT `_solid-verify.<label>`. The CLI used to print a hard-coded
 * `CNAME → proxy.solidnumber.com` for everything, which is wrong for every
 * apex domain (most registrars reject `CNAME @`). These helpers print the
 * backend's records verbatim, and render any record/detail field they do not
 * know about generically so a new backend field is shown, not dropped.
 *
 * Pure (string[] in, string[] out) so the output is unit-tested.
 */

export interface DnsRecord {
  type?: string;
  name?: string;
  value?: string | null;
  ttl?: number | string;
  [extra: string]: unknown;
}

export interface DnsInstructions {
  domain?: string;
  records?: DnsRecord[];
  instructions?: string[];
  [extra: string]: unknown;
}

const KNOWN_RECORD_KEYS = new Set(['type', 'name', 'value', 'ttl']);
const KNOWN_INSTRUCTION_KEYS = new Set(['domain', 'records', 'instructions']);

function scalar(v: unknown): string {
  if (v === null || v === undefined) return '(none)';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

/** True when the payload carries at least one record or instruction line. */
export function hasDnsInstructions(instr: unknown): instr is DnsInstructions {
  if (!instr || typeof instr !== 'object') return false;
  const i = instr as DnsInstructions;
  return (Array.isArray(i.records) && i.records.length > 0)
    || (Array.isArray(i.instructions) && i.instructions.length > 0);
}

/** Plain (uncoloured) lines describing every record and step, in backend order. */
export function renderDnsInstructions(instr: DnsInstructions): string[] {
  const lines: string[] = [];
  const records = Array.isArray(instr.records) ? instr.records : [];
  if (records.length > 0) {
    lines.push('Add these DNS records at your DNS provider:');
    records.forEach((r, idx) => {
      lines.push(`  Record ${idx + 1}`);
      lines.push(`    Type:  ${scalar(r.type)}`);
      lines.push(`    Name:  ${scalar(r.name)}`);
      lines.push(`    Value: ${scalar(r.value)}`);
      if (r.ttl !== undefined) lines.push(`    TTL:   ${scalar(r.ttl)}`);
      for (const [k, v] of Object.entries(r)) {
        if (KNOWN_RECORD_KEYS.has(k)) continue;
        lines.push(`    ${k}: ${scalar(v)}`);
      }
    });
  }
  const steps = Array.isArray(instr.instructions) ? instr.instructions : [];
  if (steps.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push('Steps:');
    for (const s of steps) lines.push(`  ${s}`);
  }
  for (const [k, v] of Object.entries(instr)) {
    if (KNOWN_INSTRUCTION_KEYS.has(k)) continue;
    lines.push(`${k}: ${scalar(v)}`);
  }
  return lines;
}

/**
 * Lines for the `details` object a failed `POST /domains/custom/{id}/verify`
 * returns (`verify_dns_records` in solid-backend controllers/domains.py).
 * Every key is shown — including ones added later (e.g. `stray_a_records`) —
 * with `errors[]` expanded one per line.
 */
export function renderVerifyDetails(details: unknown): string[] {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return [];
  const lines: string[] = [];
  const d = details as Record<string, unknown>;
  for (const [k, v] of Object.entries(d)) {
    if (k === 'errors') continue;
    if (Array.isArray(v)) {
      lines.push(`${k}: ${v.length === 0 ? '(none)' : ''}`.trimEnd());
      for (const item of v) lines.push(`  - ${scalar(item)}`);
    } else {
      lines.push(`${k}: ${scalar(v)}`);
    }
  }
  const errors = Array.isArray(d.errors) ? d.errors : [];
  if (errors.length > 0) {
    lines.push('errors:');
    for (const e of errors) lines.push(`  - ${scalar(e)}`);
  }
  return lines;
}
