/**
 * Regenerate src/data/cms-blocks.json — the OFFLINE fallback for `solid schema pages` —
 * from the live schema.
 *
 * ⛔ WHY. The file was typed by hand and re-typed when someone remembered. On 2026-10-04
 * it listed 29 block types against the backend's 36, and its examples were guesses at
 * what the renderer reads. The live schema now carries the real shapes
 * (solid-backend/schemas/block_shapes.py), so the fallback is that schema, saved.
 *
 *   npx ts-node scripts/sync-block-schema.ts            # write the file
 *   npx ts-node scripts/sync-block-schema.ts --check    # exit 1 if it would change
 *
 * Component names and categories are not in the backend; they are kept from the file
 * as it stands. A block the file has never seen gets "Uncategorized" until someone
 * says where it belongs.
 */
import * as fs from 'fs';
import * as path from 'path';

import { SCHEMA_ENDPOINT, loadBundledSchema, mergeLiveSchema } from '../src/lib/block-schema-source';

const FILE = path.join(__dirname, '..', 'src', 'data', 'cms-blocks.json');
const API = (process.env.SOLID_API_URL || 'https://api.solidnumber.com').replace(/\/$/, '');

async function main(): Promise<void> {
  const res = await fetch(`${API}${SCHEMA_ENDPOINT}`);
  if (!res.ok) throw new Error(`GET ${SCHEMA_ENDPOINT} answered ${res.status}`);
  const live = await res.json();
  const bundled = loadBundledSchema();
  const merged = mergeLiveSchema(live as any, bundled);
  const { rules: _r, starter_page: _s, ...envelope } = merged.envelope as Record<string, unknown>;
  const out = {
    _meta: {
      ...bundled._meta,
      version: `synced-from-live-${(live as any).version ?? 'unversioned'}`,
      extracted_from: 'block types, props, list item fields, allowed values and examples: solid-backend/schemas/block_schema.py + block_shapes.py (scripts/sync-block-schema.ts); component names and categories: kept by hand',
      note: 'OFFLINE FALLBACK. `solid schema pages` fetches the live schema first and only uses this file when the API is unreachable — output says so. GENERATED: run `npx ts-node scripts/sync-block-schema.ts`, do not edit.',
    },
    envelope,
    blocks: merged.blocks,
  };
  const stable = (o: unknown) => JSON.stringify(o, null, 2) + '\n';
  // Compared with keys sorted: the merge does not promise a key order, and a file that
  // differs only in order is not behind.
  const canon = (o: unknown): unknown => Array.isArray(o) ? o.map(canon)
    : o && typeof o === 'object'
      ? Object.fromEntries(Object.entries(o as Record<string, unknown>).sort(([x], [y]) => x.localeCompare(y)).map(([k, v]) => [k, canon(v)]))
      : o;
  const before = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const { synced_at: _a, ...beforeMeta } = before._meta;
  const same = stable(canon({ ...before, _meta: beforeMeta })) === stable(canon({ ...out, _meta: (({ synced_at: _b, ...m }) => m)(out._meta as any) }));
  if (process.argv.includes('--check')) {
    if (!same) {
      console.error('✗ src/data/cms-blocks.json is behind the live schema. Run: npx ts-node scripts/sync-block-schema.ts');
      process.exit(1);
    }
    console.log(`✓ cms-blocks.json matches the live schema (${merged.blocks.length} blocks)`);
    return;
  }
  if (same) {
    console.log(`✓ already in sync (${merged.blocks.length} blocks)`);
    return;
  }
  (out._meta as any).synced_at = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(FILE, stable(out));
  console.log(`→ src/data/cms-blocks.json — ${before.blocks.length} → ${merged.blocks.length} blocks`);
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
