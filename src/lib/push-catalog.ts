/**
 * solid push for services/ and products/.
 *
 * ⛔ WHY. `solid pull` wrote services/ and products/ as files and `solid push` never
 * sent them back, so the folder looked two-way and was not: someone corrected a
 * description in a file, pushed, was told it worked, and nothing changed.
 *
 * What goes back, and what does not:
 *   - name / title, description, category of a file that carries its `_id` and DIFFERS
 *     from the record — through the verbs `service.update` / `product.update`, so the
 *     change is versioned and can be rolled back like any other.
 *   - ⛔ NEVER the price. A price on a two-price program has a basis (cash or card) that
 *     a file cannot state, and a wrong guess reprices the business. A changed price is
 *     reported with the verb that changes it.
 *   - A file with no `_id` is not created: creating is `service.create` /
 *     `product.create`, which need more than a pulled file holds.
 *
 * Pure but for reading the folder: the diff takes the remote records as an argument.
 */
import * as fs from 'fs';
import * as path from 'path';

export type CatalogKind = 'services' | 'products';

/** file field → verb argument, per kind. */
export const PUSHABLE: Record<CatalogKind, Record<string, string>> = {
  services: { title: 'title', description: 'description', category: 'category' },
  products: { name: 'name', description: 'description', category: 'category' },
};
export const VERB: Record<CatalogKind, { verb: string; idArg: string; priceVerb: string }> = {
  services: { verb: 'service.update', idArg: 'service_id', priceVerb: 'service.update' },
  products: { verb: 'product.update', idArg: 'product_id', priceVerb: 'product.update_pricing' },
};

export interface CatalogChange {
  kind: CatalogKind;
  file: string;
  id: number;
  verb: string;
  args: Record<string, unknown>;
  changed: string[];
}
export interface CatalogDiff {
  changes: CatalogChange[];
  /** Files whose price differs from the record — never pushed. */
  price_not_pushed: Array<{ kind: CatalogKind; file: string; id: number; local: unknown; remote: unknown; use: string }>;
  /** Files with no `_id`, or whose record is gone — never created from a file. */
  not_pushed: Array<{ kind: CatalogKind; file: string; why: string }>;
}

const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null)
  || (typeof a === 'string' && typeof b === 'string' && a.trim() === b.trim());

export function diffCatalog(
  kind: CatalogKind, local: Array<{ file: string; data: Record<string, any> }>, remote: Array<Record<string, any>>,
): CatalogDiff {
  const byId = new Map(remote.map((r) => [Number(r.id), r]));
  const out: CatalogDiff = { changes: [], price_not_pushed: [], not_pushed: [] };
  const { verb, idArg, priceVerb } = VERB[kind];
  for (const { file, data } of local) {
    const id = Number(data?._id);
    if (!Number.isFinite(id) || id <= 0) {
      out.not_pushed.push({ kind, file, why: `no _id — create it with ${kind === 'services' ? 'service.create' : 'product.create'}` });
      continue;
    }
    const record = byId.get(id);
    if (!record) {
      out.not_pushed.push({ kind, file, why: `no ${kind === 'services' ? 'service' : 'product'} with id ${id} in this business` });
      continue;
    }
    const args: Record<string, unknown> = {};
    for (const [field, arg] of Object.entries(PUSHABLE[kind])) {
      if (field in data && data[field] != null && !same(data[field], record[field])) args[arg] = data[field];
    }
    if (Object.keys(args).length) {
      out.changes.push({ kind, file, id, verb, args: { [idArg]: id, ...args }, changed: Object.keys(args) });
    }
    if ('price' in data && data.price != null && Number(data.price) !== Number(record.price)) {
      out.price_not_pushed.push({ kind, file, id, local: data.price, remote: record.price ?? null, use: priceVerb });
    }
  }
  return out;
}

export function readCatalogFiles(baseDir: string, kind: CatalogKind): Array<{ file: string; data: Record<string, any> }> {
  const dir = path.join(baseDir, kind);
  if (!fs.existsSync(dir)) return [];
  const out: Array<{ file: string; data: Record<string, any> }> = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    try {
      out.push({ file, data: JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')) });
    } catch { /* not JSON — not ours to push */ }
  }
  return out;
}

export function mergeDiffs(...diffs: CatalogDiff[]): CatalogDiff {
  return {
    changes: diffs.flatMap((d) => d.changes),
    price_not_pushed: diffs.flatMap((d) => d.price_not_pushed),
    not_pushed: diffs.flatMap((d) => d.not_pushed),
  };
}
