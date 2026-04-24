/**
 * Graph walker unit tests — load-bearing for `solid graph`.
 *
 * Fixture shape matches what services/ai_context_jsonld.py emits so
 * the walker's correctness is measured against the real payload.
 */

import {
  bfs,
  bfsOut,
  buildAdjacency,
  listTypes,
  nodesOfType,
  resolveIri,
  subgraph,
  type JsonLdDocument,
} from '../../lib/graph-walker';

const SOLID = 'https://solidnumber.com';

// A minimal but representative JSON-LD document: Organization, Tier,
// Industry, Service, Product, Agent (platform default), WebsitePage,
// and a KB entry. Edges:
//   Company -withinTier-> Tier
//   Company -inIndustry-> Industry
//   Service -provider-> Company
//   Product -provider-> Company
//   Agent   -company-> Company (null in platform default; here not set)
//   Page    -company-> Company
//   KB      -shelfOf-> Shelf-400
//   KB      -company-> Company
const DOC: JsonLdDocument = {
  '@context': { '@version': 1.1 },
  '@id': `${SOLID}/co/61`,
  '@type': ['solid:TenantContext'],
  graph: [
    {
      '@id': `${SOLID}/co/61`,
      '@type': ['schema:Organization', 'solid:Company'],
      name: 'ANGL LLC',
      withinTier: `${SOLID}/vocab/tier/builder`,
      inIndustry: `${SOLID}/vocab/industry/construction`,
    },
    { '@id': `${SOLID}/vocab/tier/builder`, '@type': ['solid:Tier'], name: 'builder' },
    { '@id': `${SOLID}/vocab/industry/construction`, '@type': ['solid:Industry'], name: 'construction' },
    {
      '@id': `${SOLID}/co/61/service/3`,
      '@type': ['schema:Service'],
      name: 'Leak repair',
      provider: `${SOLID}/co/61`,
    },
    {
      '@id': `${SOLID}/co/61/product/5`,
      '@type': ['schema:Product'],
      name: 'Annual plan',
      provider: `${SOLID}/co/61`,
    },
    {
      '@id': `${SOLID}/co/61/page/1`,
      '@type': ['schema:WebPage'],
      name: 'Home',
      company: `${SOLID}/co/61`,
    },
    {
      '@id': `${SOLID}/co/61/kb/10`,
      '@type': ['schema:Article', 'solid:KnowledgeBaseEntry'],
      name: 'Hours',
      shelfOf: `${SOLID}/vocab/shelf/400`,
      company: `${SOLID}/co/61`,
    },
    { '@id': `${SOLID}/vocab/shelf/400`, '@type': ['solid:Shelf'] },
    { '@id': `${SOLID}/vocab/agent-default/sarah`, '@type': ['solid:Agent'], name: 'Sarah' },
  ],
};

// -- adjacency -------------------------------------------------------------

describe('buildAdjacency', () => {
  test('indexes every node by @id', () => {
    const adj = buildAdjacency(DOC);
    expect(adj.size).toBe(DOC.graph!.length);
    expect(adj.get(`${SOLID}/co/61`)).toBeTruthy();
  });

  test('discovers outbound edges via string-valued fields matching known IDs', () => {
    const adj = buildAdjacency(DOC);
    const company = adj.get(`${SOLID}/co/61`)!;
    const preds = company.outEdges.map((e) => e.predicate).sort();
    expect(preds).toEqual(['inIndustry', 'withinTier']);
  });

  test('populates inbound edges (reverse of every out edge)', () => {
    const adj = buildAdjacency(DOC);
    const tier = adj.get(`${SOLID}/vocab/tier/builder`)!;
    expect(tier.inEdges).toEqual([
      { predicate: 'withinTier', source: `${SOLID}/co/61` },
    ]);
  });

  test('skips self-loops and unknown IDs', () => {
    const doc: JsonLdDocument = {
      graph: [
        { '@id': 'a', '@type': 'X', points: 'a' }, // self-edge → ignored
        { '@id': 'b', '@type': 'X', points: 'nowhere' }, // unknown target → ignored
      ],
    };
    const adj = buildAdjacency(doc);
    expect(adj.get('a')!.outEdges).toEqual([]);
    expect(adj.get('b')!.outEdges).toEqual([]);
  });
});

// -- bfs -------------------------------------------------------------------

describe('bfs', () => {
  const adj = buildAdjacency(DOC);

  test('hops=0 returns just the root', () => {
    const visited = bfs(adj, `${SOLID}/co/61`, 0);
    expect([...visited]).toEqual([`${SOLID}/co/61`]);
  });

  test('hops=1 from the company reaches the tier + industry + everything that points at the company', () => {
    const visited = bfs(adj, `${SOLID}/co/61`, 1);
    expect(visited.has(`${SOLID}/vocab/tier/builder`)).toBe(true);
    expect(visited.has(`${SOLID}/vocab/industry/construction`)).toBe(true);
    // Service, Product, Page, KB all have inbound edges pointing to the company
    expect(visited.has(`${SOLID}/co/61/service/3`)).toBe(true);
    expect(visited.has(`${SOLID}/co/61/product/5`)).toBe(true);
    expect(visited.has(`${SOLID}/co/61/page/1`)).toBe(true);
    expect(visited.has(`${SOLID}/co/61/kb/10`)).toBe(true);
  });

  test('hops=2 from the KB entry reaches the Organization via company-edge AND the Tier via Organization', () => {
    const visited = bfs(adj, `${SOLID}/co/61/kb/10`, 2);
    expect(visited.has(`${SOLID}/co/61`)).toBe(true);         // 1 hop: kb → company
    expect(visited.has(`${SOLID}/vocab/shelf/400`)).toBe(true); // 1 hop: kb → shelf
    expect(visited.has(`${SOLID}/vocab/tier/builder`)).toBe(true); // 2 hops: company → tier
  });

  test('unknown root → empty set', () => {
    expect([...bfs(adj, 'not-in-graph', 5)]).toEqual([]);
  });
});

describe('bfsOut (directed)', () => {
  const adj = buildAdjacency(DOC);

  test('does not cross inbound edges', () => {
    // From the Tier, outbound-only should NOT reach the Company
    // (which only has an inbound withinTier pointing at it).
    const visited = bfsOut(adj, `${SOLID}/vocab/tier/builder`, 5);
    expect([...visited]).toEqual([`${SOLID}/vocab/tier/builder`]);
  });

  test('still reaches downstream nodes', () => {
    const visited = bfsOut(adj, `${SOLID}/co/61/kb/10`, 2);
    expect(visited.has(`${SOLID}/vocab/shelf/400`)).toBe(true);
    expect(visited.has(`${SOLID}/co/61`)).toBe(true);
  });
});

// -- nodesOfType -----------------------------------------------------------

describe('nodesOfType', () => {
  test('bare Schema.org suffix matches', () => {
    const n = nodesOfType(DOC, 'Service');
    expect(n.map((x) => x['@id'])).toEqual([`${SOLID}/co/61/service/3`]);
  });

  test('fully prefixed solid:* term matches', () => {
    const n = nodesOfType(DOC, 'solid:Agent');
    expect(n.map((x) => x['@id'])).toEqual([`${SOLID}/vocab/agent-default/sarah`]);
  });

  test('case-insensitive match', () => {
    const n = nodesOfType(DOC, 'organization');
    expect(n.map((x) => x['@id'])).toEqual([`${SOLID}/co/61`]);
  });

  test('matches nodes whose @type array includes multiple types', () => {
    const n = nodesOfType(DOC, 'KnowledgeBaseEntry');
    expect(n.map((x) => x['@id'])).toEqual([`${SOLID}/co/61/kb/10`]);
  });
});

// -- listTypes -------------------------------------------------------------

describe('listTypes', () => {
  test('deduplicates + sorts alphabetically', () => {
    const types = listTypes(DOC);
    expect(types).toEqual([...types].sort());
    expect(new Set(types).size).toBe(types.length);
    expect(types).toContain('schema:Organization');
    expect(types).toContain('solid:KnowledgeBaseEntry');
  });
});

// -- resolveIri ------------------------------------------------------------

describe('resolveIri', () => {
  const DOC_ROOT = `${SOLID}/co/61`;

  test('passes fully-qualified URLs through unchanged', () => {
    expect(resolveIri('https://x.com/y', DOC_ROOT)).toBe('https://x.com/y');
  });

  test('expands short relative form against doc root', () => {
    expect(resolveIri('kb/42', DOC_ROOT)).toBe(`${SOLID}/co/61/kb/42`);
    expect(resolveIri('service/3', DOC_ROOT)).toBe(`${SOLID}/co/61/service/3`);
  });

  test('recognises platform-wide slugs (tier/*, industry/*, shelf/*)', () => {
    expect(resolveIri('tier/builder', DOC_ROOT)).toBe(`${SOLID}/vocab/tier/builder`);
    expect(resolveIri('industry/hvac', DOC_ROOT)).toBe(`${SOLID}/vocab/industry/hvac`);
    expect(resolveIri('shelf/400', DOC_ROOT)).toBe(`${SOLID}/vocab/shelf/400`);
    expect(resolveIri('agent-default/sarah', DOC_ROOT)).toBe(`${SOLID}/vocab/agent-default/sarah`);
  });

  test('recognises cross-tenant "co/<id>/..." short form', () => {
    expect(resolveIri('co/99/kb/1', DOC_ROOT)).toBe(`${SOLID}/co/99/kb/1`);
  });
});

// -- subgraph --------------------------------------------------------------

describe('subgraph', () => {
  test('keeps only the requested node ids and preserves @context', () => {
    const ids = new Set([`${SOLID}/co/61`, `${SOLID}/vocab/tier/builder`]);
    const sg = subgraph(DOC, ids);
    expect(sg.graph!.map((n) => n['@id']).sort()).toEqual([...ids].sort());
    expect(sg['@context']).toEqual(DOC['@context']);
    expect(sg['@id']).toBe(DOC['@id']);
  });
});
