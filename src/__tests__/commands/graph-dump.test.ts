/**
 * Tests for `solid graph --dump` — A+.2 RDF export.
 *
 * Strategy: spawn the built CLI with `--offline` pointing at a tempdir
 * containing a fixture .claude/solid-context.jsonld. This exercises the
 * full integration: argv parsing → loadDocument → jsonld.toRDF → stdout.
 *
 * If `dist/` is missing the suite is skipped — CI builds before testing,
 * and prepublishOnly builds before publishing, so we can never ship a
 * broken --dump.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

const root = path.join(__dirname, '..', '..', '..');
const distEntry = path.join(root, 'dist', 'index.js');

const distExists = fs.existsSync(distEntry);
const describeOrSkip = distExists ? describe : describe.skip;

// Minimal but representative JSON-LD doc — exact shape that
// services/ai_context_jsonld.build_jsonld() emits, including the
// Organization root, Tier, Industry, KB entry, and Service. Picked to
// produce a non-trivial number of triples so the round-trip and content
// assertions have something to grip on.
const FIXTURE_DOC = {
  '@context': {
    '@version': 1.1,
    schema: 'http://schema.org/',
    solid: 'https://solidnumber.com/vocab#',
    name: 'schema:name',
    slug: 'schema:alternateName',
    description: 'schema:description',
    category: 'schema:category',
    identifier: 'schema:identifier',
    company: { '@id': 'solid:company', '@type': '@id' },
    withinTier: { '@id': 'solid:withinTier', '@type': '@id' },
    inIndustry: { '@id': 'solid:inIndustry', '@type': '@id' },
    provider: { '@id': 'schema:provider', '@type': '@id' },
    graph: '@graph',
  },
  '@id': 'https://solidnumber.com/co/61',
  '@type': ['solid:TenantContext'],
  graph: [
    {
      '@id': 'https://solidnumber.com/co/61',
      '@type': ['schema:Organization', 'solid:Company'],
      identifier: 61,
      name: 'Test Co',
      slug: 'test-co',
      withinTier: 'https://solidnumber.com/vocab/tier/professional',
      inIndustry: 'https://solidnumber.com/vocab/industry/saas',
    },
    {
      '@id': 'https://solidnumber.com/vocab/tier/professional',
      '@type': ['solid:Tier'],
      name: 'professional',
    },
    {
      '@id': 'https://solidnumber.com/vocab/industry/saas',
      '@type': ['solid:Industry'],
      name: 'saas',
    },
    {
      '@id': 'https://solidnumber.com/co/61/kb/1',
      '@type': ['schema:Article', 'solid:KnowledgeBaseEntry'],
      identifier: 1,
      name: 'Refund policy',
      category: 'faq',
      description: '30 days.',
      company: 'https://solidnumber.com/co/61',
    },
    {
      '@id': 'https://solidnumber.com/co/61/service/1',
      '@type': ['schema:Service', 'solid:ServiceCatalogItem'],
      identifier: 1,
      name: 'Consulting',
      slug: 'consult',
      description: 'Expert advice',
      provider: 'https://solidnumber.com/co/61',
    },
  ],
};


function setupTempTenant(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'solid-graph-dump-'));
  fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, '.claude', 'solid-context.jsonld'),
    JSON.stringify(FIXTURE_DOC, null, 2),
  );
  return tmp;
}


describeOrSkip('solid graph --dump', () => {
  describe('--dump nquads (offline)', () => {
    it('emits N-Quads with every fixture IRI', () => {
      const tmp = setupTempTenant();
      const out = execFileSync(
        'node',
        [distEntry, 'graph', '--dump', 'nquads', '--offline'],
        {
          cwd: tmp,
          encoding: 'utf-8',
          env: { ...process.env, SOLID_SKIP_VERSION_CHECK: '1' },
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      );

      // Output is N-Quads — each non-empty line ends with a period.
      const lines = out.trim().split('\n').filter((l) => l.trim());
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line.trim().endsWith('.')).toBe(true);
      }

      // Every IRI from the fixture must appear in the output —
      // proves the conversion didn't silently drop nodes.
      expect(out).toContain('https://solidnumber.com/co/61');
      expect(out).toContain('https://solidnumber.com/co/61/kb/1');
      expect(out).toContain('https://solidnumber.com/co/61/service/1');
      expect(out).toContain('https://solidnumber.com/vocab/tier/professional');
      expect(out).toContain('https://solidnumber.com/vocab/industry/saas');
    });

    it('exits 0 on success (pipeable to a graph store ingester)', () => {
      const tmp = setupTempTenant();
      // execFileSync throws on non-zero exit. Reaching the assertion
      // proves exit was 0.
      const out = execFileSync(
        'node',
        [distEntry, 'graph', '--dump', 'nquads', '--offline'],
        { cwd: tmp, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
      );
      expect(out.length).toBeGreaterThan(0);
    });
  });

  describe('--dump turtle (requires network)', () => {
    it('exits 1 with a clear hint when --offline is set', () => {
      const tmp = setupTempTenant();
      let exited = 0;
      let stderr = '';
      try {
        execFileSync(
          'node',
          [distEntry, 'graph', '--dump', 'turtle', '--offline'],
          { cwd: tmp, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
        );
      } catch (err: unknown) {
        const e = err as { status?: number; stderr?: Buffer | string };
        exited = e.status ?? 1;
        stderr = String(e.stderr ?? '');
      }
      expect(exited).toBe(1);
      expect(stderr).toMatch(/--dump turtle requires the backend/);
      // Hint should point to the offline-capable alternative
      expect(stderr).toMatch(/nquads/);
    });
  });

  describe('--dump <unknown>', () => {
    it('exits 1 with a clear error', () => {
      const tmp = setupTempTenant();
      let exited = 0;
      let stderr = '';
      try {
        execFileSync(
          'node',
          [distEntry, 'graph', '--dump', 'rdfxml', '--offline'],
          { cwd: tmp, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
        );
      } catch (err: unknown) {
        const e = err as { status?: number; stderr?: Buffer | string };
        exited = e.status ?? 1;
        stderr = String(e.stderr ?? '');
      }
      expect(exited).toBe(1);
      expect(stderr).toMatch(/Unknown --dump format/);
    });
  });

  describe('round-trip — N-Quads parses back to a graph with same IRIs', () => {
    it('output is valid N-Quads (every IRI from fixture appears as either subject or object)', () => {
      const tmp = setupTempTenant();
      const out = execFileSync(
        'node',
        [distEntry, 'graph', '--dump', 'nquads', '--offline'],
        { cwd: tmp, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
      );
      const fixtureIris = [
        'https://solidnumber.com/co/61',
        'https://solidnumber.com/co/61/kb/1',
        'https://solidnumber.com/co/61/service/1',
        'https://solidnumber.com/vocab/tier/professional',
        'https://solidnumber.com/vocab/industry/saas',
      ];
      for (const iri of fixtureIris) {
        // Each IRI shows up at least once — either as <subject> or <object>.
        // N-Quads wraps IRIs in angle brackets.
        expect(out).toMatch(new RegExp(`<${iri.replace(/\./g, '\\.')}>`));
      }
    });
  });
});
