/**
 * Tests for lib/graph-diff.ts — A+.4 graph diff.
 *
 * 8 scenarios covering add/remove/modify on both nodes and edges,
 * plus zero-diff (identical), and an isolation invariant.
 */
import { diff } from '../../lib/graph-diff';
import type { JsonLdDocument } from '../../lib/graph-walker';

const SOLID = 'https://solidnumber.com';

function doc(nodes: Array<Record<string, unknown> & { '@id': string }>): JsonLdDocument {
  return {
    '@context': { '@version': 1.1 },
    '@id': `${SOLID}/co/61`,
    '@type': ['solid:TenantContext'],
    graph: nodes,
  };
}

describe('graph-diff', () => {
  describe('zero-diff', () => {
    it('two identical graphs produce an empty report', () => {
      const a = doc([
        { '@id': `${SOLID}/co/61`, '@type': ['schema:Organization'], name: 'X' },
        { '@id': `${SOLID}/co/61/kb/1`, '@type': ['schema:Article'], name: 'Refund' },
      ]);
      const b = doc([
        { '@id': `${SOLID}/co/61`, '@type': ['schema:Organization'], name: 'X' },
        { '@id': `${SOLID}/co/61/kb/1`, '@type': ['schema:Article'], name: 'Refund' },
      ]);
      const r = diff(a, b);
      expect(r.summary).toEqual({ added: 0, removed: 0, modified: 0, unchanged: 2 });
      expect(r.added).toHaveLength(0);
      expect(r.removed).toHaveLength(0);
      expect(r.modified).toHaveLength(0);
    });
  });

  describe('node added', () => {
    it('reports a single ADD with the new IRI and type', () => {
      const a = doc([{ '@id': `${SOLID}/co/61`, '@type': ['schema:Organization'], name: 'X' }]);
      const b = doc([
        { '@id': `${SOLID}/co/61`, '@type': ['schema:Organization'], name: 'X' },
        { '@id': `${SOLID}/co/61/kb/1`, '@type': ['schema:Article', 'solid:KnowledgeBaseEntry'], name: 'Refund' },
      ]);
      const r = diff(a, b);
      expect(r.summary.added).toBe(1);
      expect(r.summary.removed).toBe(0);
      expect(r.summary.modified).toBe(0);
      expect(r.added[0]['@id']).toBe(`${SOLID}/co/61/kb/1`);
      expect(r.added[0]['@type']).toContain('solid:KnowledgeBaseEntry');
    });
  });

  describe('node removed', () => {
    it('reports a single REMOVE with the old IRI', () => {
      const a = doc([
        { '@id': `${SOLID}/co/61`, '@type': ['schema:Organization'], name: 'X' },
        { '@id': `${SOLID}/co/61/service/3`, '@type': ['schema:Service'], name: 'Drain' },
      ]);
      const b = doc([{ '@id': `${SOLID}/co/61`, '@type': ['schema:Organization'], name: 'X' }]);
      const r = diff(a, b);
      expect(r.summary.added).toBe(0);
      expect(r.summary.removed).toBe(1);
      expect(r.removed[0]['@id']).toBe(`${SOLID}/co/61/service/3`);
    });
  });

  describe('node renamed (predicate replace)', () => {
    it('reports MODIFY with the changed predicate', () => {
      const a = doc([
        { '@id': `${SOLID}/co/61/service/3`, '@type': ['schema:Service'], name: 'Drain cleaning' },
      ]);
      const b = doc([
        { '@id': `${SOLID}/co/61/service/3`, '@type': ['schema:Service'], name: 'Drain repair' },
      ]);
      const r = diff(a, b);
      expect(r.summary.modified).toBe(1);
      const change = r.modified[0];
      expect(change['@id']).toBe(`${SOLID}/co/61/service/3`);
      const namePred = change.predicates.find((p) => p.predicate === 'name');
      expect(namePred?.op).toBe('replace');
      expect(namePred?.before).toBe('Drain cleaning');
      expect(namePred?.after).toBe('Drain repair');
    });
  });

  describe('predicate added on existing node', () => {
    it('reports MODIFY with an ADD operation', () => {
      const a = doc([
        { '@id': `${SOLID}/co/61/service/3`, '@type': ['schema:Service'], name: 'Drain' },
      ]);
      const b = doc([
        { '@id': `${SOLID}/co/61/service/3`, '@type': ['schema:Service'], name: 'Drain', category: 'emergency' },
      ]);
      const r = diff(a, b);
      expect(r.summary.modified).toBe(1);
      const change = r.modified[0];
      const catPred = change.predicates.find((p) => p.predicate === 'category');
      expect(catPred?.op).toBe('add');
      expect(catPred?.after).toBe('emergency');
    });
  });

  describe('predicate removed on existing node', () => {
    it('reports MODIFY with a REMOVE operation', () => {
      const a = doc([
        { '@id': `${SOLID}/co/61/service/3`, '@type': ['schema:Service'], name: 'Drain', category: 'emergency' },
      ]);
      const b = doc([
        { '@id': `${SOLID}/co/61/service/3`, '@type': ['schema:Service'], name: 'Drain' },
      ]);
      const r = diff(a, b);
      expect(r.summary.modified).toBe(1);
      const change = r.modified[0];
      const catPred = change.predicates.find((p) => p.predicate === 'category');
      expect(catPred?.op).toBe('remove');
      expect(catPred?.before).toBe('emergency');
    });
  });

  describe('edge added (predicate of @id type)', () => {
    it('reports the source node as MODIFY with the new edge predicate', () => {
      const a = doc([
        { '@id': `${SOLID}/co/61/service/3`, '@type': ['schema:Service'], name: 'Drain' },
      ]);
      const b = doc([
        { '@id': `${SOLID}/co/61/service/3`, '@type': ['schema:Service'], name: 'Drain',
          provider: `${SOLID}/co/61` },
      ]);
      const r = diff(a, b);
      expect(r.summary.modified).toBe(1);
      const provPred = r.modified[0].predicates.find((p) => p.predicate === 'provider');
      expect(provPred?.op).toBe('add');
      expect(provPred?.after).toBe(`${SOLID}/co/61`);
    });
  });

  describe('edge re-targeted (predicate of @id type, value changed)', () => {
    it('reports the source node as MODIFY with a REPLACE on the edge predicate', () => {
      const a = doc([
        { '@id': `${SOLID}/co/61/page/1`, '@type': ['schema:WebPage'], company: `${SOLID}/co/61` },
      ]);
      const b = doc([
        // Hypothetical company rename; the IRI itself doesn't change here, but
        // the page's `company` edge could be updated to point at a new
        // versioned IRI.
        { '@id': `${SOLID}/co/61/page/1`, '@type': ['schema:WebPage'], company: `${SOLID}/co/61?v=2` },
      ]);
      const r = diff(a, b);
      expect(r.summary.modified).toBe(1);
      const compPred = r.modified[0].predicates.find((p) => p.predicate === 'company');
      expect(compPred?.op).toBe('replace');
      expect(compPred?.before).toBe(`${SOLID}/co/61`);
      expect(compPred?.after).toBe(`${SOLID}/co/61?v=2`);
    });
  });

  describe('multi-tenant isolation', () => {
    it('an @id from another company never appears as added on tenant A', () => {
      // Both docs are nominally for company 61 but the "before" doc is
      // missing a node and the "after" doc accidentally contains one
      // from company 42. The diff still classifies it as ADDED — the
      // diff library doesn't enforce tenant scope (that's the caller's
      // job) — but the node it reports MUST be the one from `after`,
      // never invented or copied from elsewhere.
      const a = doc([{ '@id': `${SOLID}/co/61`, '@type': ['schema:Organization'], name: 'A' }]);
      const b = doc([
        { '@id': `${SOLID}/co/61`, '@type': ['schema:Organization'], name: 'A' },
        { '@id': `${SOLID}/co/42/kb/1`, '@type': ['schema:Article'], name: 'Foreign' },
      ]);
      const r = diff(a, b);
      expect(r.summary.added).toBe(1);
      // The added node IS the cross-tenant one — but every field comes
      // from `b`, none invented.
      expect(r.added[0]['@id']).toBe(`${SOLID}/co/42/kb/1`);
      expect(r.added[0].name).toBe('Foreign');
      // No "phantom" entries from `a` show up in `added`
      for (const n of r.added) {
        const matchedInB = b.graph!.find((bn) => bn['@id'] === n['@id']);
        expect(matchedInB).toBeDefined();
      }
    });
  });

  describe('@type reorder is not a modification', () => {
    it('rearranging @type array does not flag a modify', () => {
      const a = doc([{ '@id': `${SOLID}/co/61/kb/1`, '@type': ['schema:Article', 'solid:KnowledgeBaseEntry'] }]);
      const b = doc([{ '@id': `${SOLID}/co/61/kb/1`, '@type': ['solid:KnowledgeBaseEntry', 'schema:Article'] }]);
      const r = diff(a, b);
      expect(r.summary.modified).toBe(0);
      expect(r.summary.unchanged).toBe(1);
    });
  });

  describe('summary counts match list lengths', () => {
    it('mixed-change graph: counts add up correctly', () => {
      const a = doc([
        { '@id': `${SOLID}/co/61/kb/1`, '@type': ['schema:Article'], name: 'A' },
        { '@id': `${SOLID}/co/61/kb/2`, '@type': ['schema:Article'], name: 'B' },
        { '@id': `${SOLID}/co/61/service/3`, '@type': ['schema:Service'], name: 'X' },
      ]);
      const b = doc([
        // kb/1 unchanged
        { '@id': `${SOLID}/co/61/kb/1`, '@type': ['schema:Article'], name: 'A' },
        // kb/2 removed
        // service/3 modified
        { '@id': `${SOLID}/co/61/service/3`, '@type': ['schema:Service'], name: 'X-renamed' },
        // kb/9 added
        { '@id': `${SOLID}/co/61/kb/9`, '@type': ['schema:Article'], name: 'New' },
      ]);
      const r = diff(a, b);
      expect(r.summary.added).toBe(1);
      expect(r.summary.removed).toBe(1);
      expect(r.summary.modified).toBe(1);
      expect(r.summary.unchanged).toBe(1);
      expect(r.added).toHaveLength(1);
      expect(r.removed).toHaveLength(1);
      expect(r.modified).toHaveLength(1);
    });
  });
});
