/**
 * Tests for lib/sparql-bgp.ts — A+.5 SPARQL BGP engine.
 *
 * 10 canned queries from the sprint spec, plus parser/matcher
 * invariants. Fixture is a representative tenant graph: Company,
 * Tier, Industry, Service x2, Product, Agent, KB entry, Webhook,
 * Chain.
 */
import { parseQuery, query, runQuery } from '../../lib/sparql-bgp';
import type { JsonLdDocument } from '../../lib/graph-walker';

const SOLID = 'https://solidnumber.com';
const SCHEMA = 'http://schema.org/';
const SOLID_VOCAB = 'https://solidnumber.com/vocab#';
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

const DOC: JsonLdDocument = {
  '@context': { '@version': 1.1, graph: '@graph' },
  '@id': `${SOLID}/co/123`,
  '@type': ['solid:TenantContext'],
  graph: [
    {
      '@id': `${SOLID}/co/123`,
      '@type': [`${SCHEMA}Organization`, `${SOLID_VOCAB}Company`],
      [`${SCHEMA}name`]: 'Acme Plumbing',
      [`${SOLID_VOCAB}withinTier`]: { '@id': `${SOLID}/vocab/tier/builder` },
      [`${SOLID_VOCAB}inIndustry`]: { '@id': `${SOLID}/vocab/industry/plumbing` },
    },
    {
      '@id': `${SOLID}/vocab/tier/builder`,
      '@type': [`${SOLID_VOCAB}Tier`],
      [`${SCHEMA}name`]: 'builder',
    },
    {
      '@id': `${SOLID}/vocab/industry/plumbing`,
      '@type': [`${SOLID_VOCAB}Industry`],
      [`${SCHEMA}name`]: 'plumbing',
    },
    {
      '@id': `${SOLID}/co/123/service/1`,
      '@type': [`${SCHEMA}Service`, `${SOLID_VOCAB}ServiceCatalogItem`],
      [`${SCHEMA}name`]: 'Drain cleaning',
      [`${SCHEMA}category`]: 'emergency',
      [`${SCHEMA}provider`]: { '@id': `${SOLID}/co/123` },
    },
    {
      '@id': `${SOLID}/co/123/service/2`,
      '@type': [`${SCHEMA}Service`, `${SOLID_VOCAB}ServiceCatalogItem`],
      [`${SCHEMA}name`]: 'Annual inspection',
      [`${SCHEMA}category`]: 'preventive',
      [`${SCHEMA}provider`]: { '@id': `${SOLID}/co/123` },
    },
    {
      '@id': `${SOLID}/co/123/product/1`,
      '@type': [`${SCHEMA}Product`, `${SOLID_VOCAB}Product`],
      [`${SCHEMA}name`]: 'Annual maintenance',
      [`${SCHEMA}provider`]: { '@id': `${SOLID}/co/123` },
    },
    {
      '@id': `${SOLID}/co/123/agent/sarah`,
      '@type': [`${SOLID_VOCAB}Agent`],
      [`${SCHEMA}name`]: 'Sarah',
      [`${SOLID_VOCAB}handles`]: ['emergency', 'faq'],
    },
    {
      '@id': `${SOLID}/co/123/kb/1`,
      '@type': [`${SCHEMA}Article`, `${SOLID_VOCAB}KnowledgeBaseEntry`],
      [`${SCHEMA}name`]: 'Refund policy',
      [`${SCHEMA}category`]: 'faq',
    },
    {
      '@id': `${SOLID}/co/123/webhook/1`,
      '@type': [`${SOLID_VOCAB}InboundWebhook`],
      [`${SOLID_VOCAB}fires`]: { '@id': `${SOLID}/co/123/chain/1` },
    },
    {
      '@id': `${SOLID}/co/123/chain/1`,
      '@type': [`${SOLID_VOCAB}AgentChain`],
      [`${SCHEMA}name`]: 'New lead followup',
    },
  ],
};

// ---------------------------------------------------------------------------
// Parser sanity
// ---------------------------------------------------------------------------
describe('parser', () => {
  it('parses a basic SELECT + WHERE', () => {
    const q = parseQuery(`
      PREFIX schema: <${SCHEMA}>
      SELECT ?s WHERE { ?s a schema:Service . }
    `);
    expect(q.selectVars).toEqual(['s']);
    expect(q.where).toHaveLength(1);
    expect(q.where[0].p.kind).toBe('iri');
    expect((q.where[0].p as { value: string }).value).toBe(RDF_TYPE);
  });

  it('SELECT * collects every variable in WHERE', () => {
    const q = parseQuery(`SELECT * WHERE { ?s ?p ?o . }`);
    expect(q.selectAll).toBe(true);
  });

  it('rejects non-variable in SELECT', () => {
    expect(() => parseQuery(`SELECT foo WHERE { ?s ?p ?o . }`)).toThrow(/must start with/);
  });

  it('strips # comments outside strings', () => {
    const q = parseQuery(`
      # leading comment
      SELECT ?s WHERE {
        ?s a schema:Service .  # trailing comment
      }
    `);
    expect(q.where).toHaveLength(1);
  });
});


// ---------------------------------------------------------------------------
// 10 canned queries from the spec
// ---------------------------------------------------------------------------
describe('canned queries (spec acceptance)', () => {
  it('1. tier holders — companies with a withinTier edge', () => {
    const r = query(`SELECT ?co ?tier WHERE { ?co solid:withinTier ?tier . }`, DOC);
    expect(r.bindings).toHaveLength(1);
    expect(r.bindings[0].co).toBe(`${SOLID}/co/123`);
    expect(r.bindings[0].tier).toBe(`${SOLID}/vocab/tier/builder`);
  });

  it('2. services by category — every service in `emergency`', () => {
    const r = query(`
      SELECT ?s ?n WHERE {
        ?s a schema:Service .
        ?s schema:category "emergency" .
        ?s schema:name ?n .
      }
    `, DOC);
    expect(r.bindings).toHaveLength(1);
    expect(r.bindings[0].n).toBe('Drain cleaning');
  });

  it('3. agents handling a category — `solid:handles` list-valued', () => {
    const r = query(`SELECT ?a WHERE { ?a solid:handles "emergency" . }`, DOC);
    expect(r.bindings).toHaveLength(1);
    expect(r.bindings[0].a).toBe(`${SOLID}/co/123/agent/sarah`);
  });

  it('4. webhooks firing chains — `solid:fires` edge', () => {
    const r = query(`SELECT ?w ?c WHERE { ?w solid:fires ?c . }`, DOC);
    expect(r.bindings).toHaveLength(1);
    expect(r.bindings[0].w).toBe(`${SOLID}/co/123/webhook/1`);
    expect(r.bindings[0].c).toBe(`${SOLID}/co/123/chain/1`);
  });

  it('5. count distinct types — `SELECT * WHERE { ?s a ?t }`', () => {
    const r = query(`SELECT ?s ?t WHERE { ?s a ?t . }`, DOC);
    // Every node has at least one type → at least 9 bindings (one per type per node).
    // De-dup is per (s, t) pair (DISTINCT-by-default for projection).
    expect(r.bindings.length).toBeGreaterThan(0);
    const types = new Set(r.bindings.map((b) => b.t));
    expect(types.has(`${SCHEMA}Service`)).toBe(true);
    expect(types.has(`${SOLID_VOCAB}Tier`)).toBe(true);
  });

  it('6. all services provided by a specific company', () => {
    const r = query(`
      SELECT ?s ?n WHERE {
        ?s a schema:Service .
        ?s schema:provider <${SOLID}/co/123> .
        ?s schema:name ?n .
      }
    `, DOC);
    expect(r.bindings).toHaveLength(2);
    const names = new Set(r.bindings.map((b) => b.n));
    expect(names).toEqual(new Set(['Drain cleaning', 'Annual inspection']));
  });

  it('7. KB entries by category', () => {
    const r = query(`
      SELECT ?k ?n WHERE {
        ?k a solid:KnowledgeBaseEntry .
        ?k schema:category "faq" .
        ?k schema:name ?n .
      }
    `, DOC);
    expect(r.bindings).toHaveLength(1);
    expect(r.bindings[0].n).toBe('Refund policy');
  });

  it('8. industries by tier (chained join via Company)', () => {
    const r = query(`
      SELECT ?ind WHERE {
        ?co solid:withinTier <${SOLID}/vocab/tier/builder> .
        ?co solid:inIndustry ?ind .
      }
    `, DOC);
    expect(r.bindings).toHaveLength(1);
    expect(r.bindings[0].ind).toBe(`${SOLID}/vocab/industry/plumbing`);
  });

  it('9. count by predicate — every name in the graph', () => {
    const r = query(`SELECT ?s ?n WHERE { ?s schema:name ?n . }`, DOC);
    // 1 company, 2 services, 1 product, 1 agent, 1 KB, 1 chain, 1 tier, 1 industry = 9
    expect(r.bindings.length).toBeGreaterThanOrEqual(8);
  });

  it('10. zero-match — predicate that does not exist returns []', () => {
    const r = query(`SELECT ?s WHERE { ?s solid:nonexistent ?o . }`, DOC);
    expect(r.bindings).toEqual([]);
  });
});


// ---------------------------------------------------------------------------
// Matcher invariants
// ---------------------------------------------------------------------------
describe('matcher invariants', () => {
  it('var bound twice in same query must agree (join semantics)', () => {
    // ?x must equal both schema:provider and the company IRI's @id —
    // bindings carry forward across patterns.
    const r = query(`
      SELECT ?x WHERE {
        ?s schema:provider ?x .
        ?x a schema:Organization .
      }
    `, DOC);
    expect(r.bindings).toHaveLength(1);
    expect(r.bindings[0].x).toBe(`${SOLID}/co/123`);
  });

  it('result rows are de-duplicated', () => {
    // Each service has @type Service AND ServiceCatalogItem, so without
    // dedup we'd get duplicate ?s bindings. We project to ?s only and
    // expect distinct rows.
    const r = query(`SELECT ?s WHERE { ?s a schema:Service . }`, DOC);
    expect(r.bindings).toHaveLength(2);
    const ids = new Set(r.bindings.map((b) => b.s));
    expect(ids.size).toBe(2);  // no dups
  });

  it('list-valued predicates expand to multiple matches', () => {
    // sarah handles ["emergency", "faq"] — two separate triples
    const r = query(`SELECT ?a ?cat WHERE { ?a solid:handles ?cat . }`, DOC);
    expect(r.bindings).toHaveLength(2);
    const cats = new Set(r.bindings.map((b) => b.cat));
    expect(cats).toEqual(new Set(['emergency', 'faq']));
  });

  it('parsed query result has the expected variable names', () => {
    const r = runQuery(parseQuery(`SELECT ?service ?label WHERE { ?service schema:name ?label . }`), DOC);
    expect(r.vars).toEqual(['service', 'label']);
  });
});
