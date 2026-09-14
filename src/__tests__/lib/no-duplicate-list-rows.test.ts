/**
 * A list response must never carry its rows twice.
 *
 * T1.7 step one aliased backend list keys to `items` and KEPT the original so
 * existing callers would not break. Step two — dropping it — did not land, and
 * every list response carried both for four minor versions: `solid find` was
 * 49% duplicate bytes, `solid where` about half the Gazetteer, on reads an
 * agent makes constantly.
 *
 * ⛔ Fixing the instance is not the point. The same drift reappears the moment
 * a new backend key is added to KNOWN_LIST_KEYS and someone preserves it "for
 * safety" — so this asserts the PROPERTY: no two keys of a normalized envelope
 * may hold the same rows. That is what could not regress without failing.
 */
import { applyListEnvelope, KNOWN_LIST_KEYS } from '../../lib/list-envelope';

// ⛔ hideSourceKey mirrors the axios interceptor, which is the ONLY caller that
// sets it. printJson deliberately does not: a command's payload declares its
// own shape beside a versioned `schema:` tag, and hiding that key would rewrite
// the contract rather than de-duplicate an alias.

/**
 * Duplicated row arrays IN THE SERIALIZED PAYLOAD.
 *
 * ⛔ Asserts on JSON.parse(JSON.stringify(body)), not on the object. The source
 * key is kept as a NON-ENUMERABLE property so the CLI's own commands can still
 * read it — 20 files do — while it costs nothing on the wire. Bytes sent is
 * the thing an agent pays for, so bytes sent is the thing to measure.
 */
function duplicatedRowKeys(obj: Record<string, unknown>): string[][] {
  const body = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;
  const arrays = Object.entries(body).filter(([, v]) => Array.isArray(v));
  const dupes: string[][] = [];
  for (let i = 0; i < arrays.length; i++) {
    for (let j = i + 1; j < arrays.length; j++) {
      const [ka, va] = arrays[i];
      const [kb, vb] = arrays[j];
      // Reference identity OR equal content — both cost the caller the bytes.
      if (va === vb || JSON.stringify(va) === JSON.stringify(vb)) {
        dupes.push([ka, kb]);
      }
    }
  }
  return dupes;
}

describe('a normalized list response carries its rows once', () => {
  // Every key the normalizer knows how to promote. A new key added to
  // KNOWN_LIST_KEYS is covered the day it lands, without editing this file.
  const sourceKeys = KNOWN_LIST_KEYS.filter((k) => k !== 'items');

  it.each(sourceKeys)('drops `%s` once its rows are on items', (key) => {
    const rows = [{ id: 1 }, { id: 2 }];
    const body: Record<string, unknown> = { [key]: rows, total: 2 };
    applyListEnvelope(body, {}, { hideSourceKey: true });

    expect(body.items).toEqual(rows);
    expect(duplicatedRowKeys(body)).toEqual([]);
    // Gone from the wire...
    expect(JSON.parse(JSON.stringify(body))[key]).toBeUndefined();
    expect(Object.keys(body)).not.toContain(key);
    // ...but still reachable in-process, so `solid where` and the other 19
    // commands that read their source key directly keep working.
    expect(body[key]).toEqual(rows);
  });

  it('leaves nothing duplicated for a body that is already canonical', () => {
    const body: Record<string, unknown> = { items: [{ id: 1 }], total: 1 };
    applyListEnvelope(body, {}, { hideSourceKey: true });
    expect(duplicatedRowKeys(body)).toEqual([]);
  });

  it('does not treat two genuinely different arrays as duplicates', () => {
    // The guard must not force-drop unrelated arrays that happen to coexist.
    const body: Record<string, unknown> = {
      pages: [{ id: 1 }],
      warnings: ['something else entirely'],
    };
    applyListEnvelope(body, {}, { hideSourceKey: true });
    expect(body.warnings).toEqual(['something else entirely']);
    expect(duplicatedRowKeys(body)).toEqual([]);
    // An unrelated array stays fully visible — it is not a duplicate.
    expect(JSON.parse(JSON.stringify(body)).warnings).toEqual(['something else entirely']);
  });

  it('the escape hatch is exempt — it restores the legacy shape on purpose', () => {
    const rows = [{ id: 1 }];
    const body: Record<string, unknown> = { pages: rows };
    applyListEnvelope(body, { SOLID_LEGACY_LIST_SHAPES: '1' } as NodeJS.ProcessEnv);
    // No items, so nothing is duplicated; the caller asked for the old shape.
    expect(body.pages).toEqual(rows);
    expect('items' in body).toBe(false);
  });
});
