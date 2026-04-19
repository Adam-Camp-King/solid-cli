/**
 * verify-schemas.ts
 *
 * Runs the CLI against live production, captures --json output, and
 * asserts every response has the expected top-level keys + primitive
 * types. Catches backend drift that SCHEMAS.md would otherwise silently
 * rot past.
 *
 * Usage:
 *   npm run verify:schemas
 *   SOLID_API_URL=http://localhost:8000 npm run verify:schemas
 *
 * Exit codes:
 *   0   all shapes match
 *   1   at least one mismatch or network error
 *   2   not authenticated
 *
 * Designed to be run from CI. Requires a valid login (or SOLID_TOKEN).
 * Safe — every command is read-only.
 */

import { execSync } from 'child_process';

type Expected = Record<string, 'string' | 'number' | 'boolean' | 'object' | 'array' | 'stringOrNull' | 'numberOrNull' | 'any'>;

interface SchemaCase {
  name: string;
  cmd: string;
  expect: Expected;
  // Some endpoints return arrays at the top level rather than objects.
  expectTopLevelArray?: boolean;
  // Skip if the call returns a known 4xx — useful for tier-gated endpoints.
  tolerate?: number[];
}

const CASES: SchemaCase[] = [
  {
    name: 'whoami',
    cmd: 'whoami --json',
    expect: {
      authenticated: 'any',
      email: 'stringOrNull',
      company_id: 'numberOrNull',
      environment: 'string',
      api_url: 'string',
    },
  },
  {
    name: 'company current',
    cmd: 'company current --json',
    expect: {
      company_id: 'numberOrNull',
    },
  },
  {
    name: 'doctor',
    cmd: 'doctor --json',
    expect: {
      ok: 'boolean',
      passed: 'number',
      failed: 'number',
      total_ms: 'number',
      results: 'array',
    },
  },
  {
    name: 'kb list',
    cmd: 'kb list --json --limit 1',
    expect: {
      results: 'any',
    },
  },
  {
    name: 'pages list',
    cmd: 'pages list --json --limit 1',
    expect: {
      items: 'any',
      count: 'number',
    },
  },
  {
    name: 'orders list',
    cmd: 'orders list --json --limit 1',
    expect: {
      items: 'any',
      count: 'number',
    },
  },
  {
    name: 'crm contacts list',
    cmd: 'crm contacts list --json --limit 1',
    expect: {
      // Backend returns `contacts` envelope, not the standard `items`/`count`.
      // Known drift from the rest of the CLI — worth surfacing in docs.
      contacts: 'array',
    },
  },
];

function checkType(value: unknown, expected: Expected[string]): boolean {
  switch (expected) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number';
    case 'boolean': return typeof value === 'boolean';
    case 'array': return Array.isArray(value);
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'stringOrNull': return value === null || typeof value === 'string';
    case 'numberOrNull': return value === null || typeof value === 'number';
    case 'any': return true;
  }
}

interface CaseResult {
  name: string;
  ok: boolean;
  errors: string[];
  durationMs: number;
}

function runCase(c: SchemaCase): CaseResult {
  const start = Date.now();
  const bin = process.env.SOLID_BIN || 'solid';
  let raw: string;
  try {
    raw = execSync(`${bin} ${c.cmd}`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000,
    });
  } catch (e) {
    const err = e as { status?: number; stderr?: Buffer; message: string };
    return {
      name: c.name,
      ok: false,
      errors: [`exit ${err.status ?? '?'}: ${(err.stderr?.toString() || err.message).slice(0, 200)}`],
      durationMs: Date.now() - start,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      name: c.name,
      ok: false,
      errors: [`invalid JSON: ${(e as Error).message.slice(0, 120)}; first 120 chars: ${raw.slice(0, 120)}`],
      durationMs: Date.now() - start,
    };
  }
  const errors: string[] = [];
  if (c.expectTopLevelArray) {
    if (!Array.isArray(parsed)) errors.push('expected top-level array');
  } else if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    errors.push('expected top-level object');
  } else {
    const obj = parsed as Record<string, unknown>;
    for (const [k, t] of Object.entries(c.expect)) {
      if (!(k in obj)) {
        errors.push(`missing key: ${k}`);
      } else if (!checkType(obj[k], t)) {
        errors.push(`${k}: expected ${t}, got ${Array.isArray(obj[k]) ? 'array' : typeof obj[k]}`);
      }
    }
  }
  return { name: c.name, ok: errors.length === 0, errors, durationMs: Date.now() - start };
}

function main() {
  const results = CASES.map(runCase);
  console.log('');
  console.log('  Schema drift check');
  console.log('  ' + '─'.repeat(56));
  for (const r of results) {
    const mark = r.ok ? '✓' : '✗';
    console.log(`  ${mark} ${r.name.padEnd(24)}  ${String(r.durationMs).padStart(5)}ms`);
    if (!r.ok) for (const e of r.errors) console.log(`      → ${e}`);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log('');
  if (failed === 0) {
    console.log(`  All ${results.length} shapes match.`);
    process.exit(0);
  }
  console.log(`  ${failed} of ${results.length} cases drifted.`);
  process.exit(1);
}

main();
