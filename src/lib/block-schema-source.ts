/**
 * Where `solid schema pages` gets the CMS block schema from.
 *
 * LIVE first: `GET /api/v1/cms/pages/schema` (solid-backend
 * controllers/cms_pages.py::get_block_schema), which serves
 * schemas/block_schema.py — the same table the backend validates every page
 * write against. The bundled `src/data/cms-blocks.json` is the OFFLINE
 * FALLBACK only, and every output that uses it says so.
 *
 * Why: the bundled file drifted (28 of 29 types, `raw_html` missing, props
 * missing on contact/booking/chat-widget/products) while the command called
 * itself the schema. An agent generating layout_json from a stale list writes
 * sections the backend then flags.
 *
 * The live payload carries names only (block types, required/optional prop
 * names, aliases). Prop TYPES, component names, categories, enums and
 * hand-written examples exist only in the bundled file, so the merge keeps the
 * live list authoritative and borrows descriptions from the bundle where the
 * names match. A live prop the bundle does not describe is shown with an
 * explicit "not described" type — never silently dropped, never invented.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { BlockDef, SchemaDoc } from './block-types';

export const SCHEMA_ENDPOINT = '/api/v1/cms/pages/schema';
export const UNDESCRIBED_PROP_TYPE = 'unknown — listed by the live schema; the bundled CLI data has no type for it';

export interface LiveBlockSchema {
  version?: number;
  block_types?: string[];
  block_schema?: Record<string, { required?: string[]; optional?: string[] }>;
  type_aliases?: Record<string, string>;
  universal_optional_props?: string[];
  motion_schema?: unknown;
}

export interface SchemaSourceInfo {
  kind: 'live' | 'bundled';
  stale: boolean;
  endpoint: string;
  fetched_at?: string;
  bundled_synced_at?: string;
  fallback_reason?: string;
}

export interface ResolvedSchema {
  schema: SchemaDoc;
  source: SchemaSourceInfo;
}

export function loadBundledSchema(): SchemaDoc {
  const file = path.join(__dirname, '..', 'data', 'cms-blocks.json');
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as SchemaDoc;
}

function isLiveSchema(body: unknown): body is LiveBlockSchema {
  if (!body || typeof body !== 'object') return false;
  const b = body as LiveBlockSchema;
  return !!b.block_schema && typeof b.block_schema === 'object' && Object.keys(b.block_schema).length > 0;
}

/** Pure: live names + bundled descriptions → the SchemaDoc shape the command prints. */
export function mergeLiveSchema(live: LiveBlockSchema, bundled: SchemaDoc): SchemaDoc {
  const bundledByType = new Map(bundled.blocks.map((b) => [b.type, b]));
  const aliases = live.type_aliases || {};
  const types = live.block_types && live.block_types.length > 0
    ? live.block_types
    : Object.keys(live.block_schema || {});

  const blocks: BlockDef[] = types.map((type) => {
    const spec = (live.block_schema || {})[type] || {};
    const b = bundledByType.get(type);
    const required = (spec.required || []).filter((p) => p !== 'id');
    const names = [...required, ...(spec.optional || []).filter((p) => p !== 'id')];
    const props: Record<string, string> = {};
    for (const n of names) props[n] = b?.props?.[n] ?? UNDESCRIBED_PROP_TYPE;
    const enums = b?.enums
      ? Object.fromEntries(Object.entries(b.enums).filter(([k]) => k in props))
      : undefined;
    const blockAliases = Object.entries(aliases)
      .filter(([alias, canonical]) => canonical === type && alias !== type)
      .map(([alias]) => alias)
      .sort();
    const out: BlockDef = {
      type,
      component: b?.component ?? 'unknown (not in bundled CLI data)',
      category: b?.category ?? 'Uncategorized',
    };
    if (blockAliases.length > 0) out.aliases = blockAliases;
    out.required = required;
    out.props = props;
    if (enums && Object.keys(enums).length > 0) out.enums = enums;
    if (b?.notes) out.notes = b.notes;
    if (b?.example !== undefined) out.example = b.example;
    return out;
  });

  return {
    _meta: {
      version: `live-${live.version ?? 'unversioned'}`,
      source: `GET ${SCHEMA_ENDPOINT}`,
      extracted_from: 'live: solid-backend/schemas/block_schema.py; prop types/components/categories/examples: bundled CLI data',
      note: 'Live schema. Block types, prop names, required props and aliases come from the backend validator.',
    },
    envelope: {
      ...bundled.envelope,
      ...(live.universal_optional_props ? { universal_optional_props: live.universal_optional_props } : {}),
      ...(live.motion_schema !== undefined ? { motion_schema: live.motion_schema } : {}),
    },
    blocks,
  };
}

export type SchemaFetcher = () => Promise<unknown>;

/** Default fetcher: public endpoint, short timeout, no retries (offline must fail fast). */
export function defaultSchemaFetcher(apiUrl: string, token?: string, timeoutMs = 5000): SchemaFetcher {
  return async () => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${apiUrl.replace(/\/+$/, '')}${SCHEMA_ENDPOINT}`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${SCHEMA_ENDPOINT}`);
    return res.json();
  };
}

export async function resolveBlockSchema(opts: {
  offline?: boolean;
  fetcher: SchemaFetcher;
  bundled?: SchemaDoc;
}): Promise<ResolvedSchema> {
  const bundled = opts.bundled ?? loadBundledSchema();
  const bundledSyncedAt = (bundled._meta as Record<string, unknown>)?.synced_at as string | undefined;
  const fallback = (reason: string): ResolvedSchema => ({
    schema: bundled,
    source: {
      kind: 'bundled',
      stale: true,
      endpoint: SCHEMA_ENDPOINT,
      bundled_synced_at: bundledSyncedAt,
      fallback_reason: reason,
    },
  });

  if (opts.offline) return fallback('--offline requested');
  try {
    const body = await opts.fetcher();
    if (!isLiveSchema(body)) return fallback('live endpoint returned an unexpected shape');
    return {
      schema: mergeLiveSchema(body, bundled),
      source: { kind: 'live', stale: false, endpoint: SCHEMA_ENDPOINT, fetched_at: new Date().toISOString() },
    };
  } catch (err) {
    return fallback(`live schema unreachable: ${(err as Error)?.message || String(err)}`);
  }
}
