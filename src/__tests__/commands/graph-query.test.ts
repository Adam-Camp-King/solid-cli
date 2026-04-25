/**
 * Integration test for `solid graph --query` — A+.5.
 *
 * Spawn the built CLI with a fixture .jsonld and a SPARQL BGP query,
 * verify the JSON output shape and exit code.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

const root = path.join(__dirname, '..', '..', '..');
const distEntry = path.join(root, 'dist', 'index.js');

const distExists = fs.existsSync(distEntry);
const describeOrSkip = distExists ? describe : describe.skip;

const SOLID = 'https://solidnumber.com';
const SCHEMA = 'http://schema.org/';
const SOLID_VOCAB = 'https://solidnumber.com/vocab#';

const FIXTURE = {
  '@context': { '@version': 1.1, graph: '@graph' },
  '@id': `${SOLID}/co/61`,
  '@type': ['solid:TenantContext'],
  graph: [
    {
      '@id': `${SOLID}/co/61`,
      '@type': [`${SCHEMA}Organization`, `${SOLID_VOCAB}Company`],
      [`${SCHEMA}name`]: 'Test Co',
      [`${SOLID_VOCAB}withinTier`]: { '@id': `${SOLID}/vocab/tier/builder` },
    },
    {
      '@id': `${SOLID}/co/61/service/1`,
      '@type': [`${SCHEMA}Service`],
      [`${SCHEMA}name`]: 'Drain cleaning',
      [`${SCHEMA}provider`]: { '@id': `${SOLID}/co/61` },
    },
  ],
};

function setupTenant() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'solid-query-'));
  fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.claude', 'solid-context.jsonld'), JSON.stringify(FIXTURE, null, 2));
  return tmp;
}

describeOrSkip('solid graph --query', () => {
  it('runs a simple SELECT and returns bindings as JSON', () => {
    const tmp = setupTenant();
    const out = execFileSync(
      'node',
      [
        distEntry, 'graph',
        '--query', `SELECT ?s WHERE { ?s a schema:Service . }`,
        '--offline', '--json',
      ],
      { cwd: tmp, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const result = JSON.parse(out);
    expect(result.vars).toEqual(['s']);
    expect(result.bindings).toHaveLength(1);
    expect(result.bindings[0].s).toBe(`${SOLID}/co/61/service/1`);
  });

  it('returns empty bindings (not error) for zero matches', () => {
    const tmp = setupTenant();
    const out = execFileSync(
      'node',
      [
        distEntry, 'graph',
        '--query', `SELECT ?s WHERE { ?s solid:nonexistent ?o . }`,
        '--offline', '--json',
      ],
      { cwd: tmp, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const result = JSON.parse(out);
    expect(result.bindings).toEqual([]);
  });

  it('exits 1 with a parse error message on bad query', () => {
    const tmp = setupTenant();
    let exited = 0;
    let stdout = '';
    try {
      execFileSync(
        'node',
        [
          distEntry, 'graph',
          '--query', `THIS IS NOT VALID SPARQL`,
          '--offline', '--json',
        ],
        { cwd: tmp, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
      );
    } catch (err: unknown) {
      const e = err as { status?: number; stdout?: Buffer | string };
      exited = e.status ?? 0;
      stdout = String(e.stdout ?? '');
    }
    expect(exited).toBe(1);
    const result = JSON.parse(stdout);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/parse error/i);
  });

  it('chained join — ?co withinTier ?t  with ?co also referenced as provider', () => {
    const tmp = setupTenant();
    const out = execFileSync(
      'node',
      [
        distEntry, 'graph',
        '--query', `
          SELECT ?service ?tier WHERE {
            ?service schema:provider ?co .
            ?co solid:withinTier ?tier .
          }`,
        '--offline', '--json',
      ],
      { cwd: tmp, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const result = JSON.parse(out);
    expect(result.bindings).toHaveLength(1);
    expect(result.bindings[0].service).toBe(`${SOLID}/co/61/service/1`);
    expect(result.bindings[0].tier).toBe(`${SOLID}/vocab/tier/builder`);
  });

  it('--server flag is accepted by argv parser (no "unknown option" error)', () => {
    // Smoke test: --server is a registered flag. Actual backend
    // roundtrip is covered by the backend SPARQL service tests
    // (test_ai_context_rdf.py); this just verifies argv parsing.
    const tmp = setupTenant();
    let stdout = '';
    let stderr = '';
    try {
      stdout = execFileSync(
        'node',
        [distEntry, 'graph', '--query', 'SELECT * WHERE { ?s ?p ?o }', '--server', '--json'],
        {
          cwd: tmp,
          encoding: 'utf-8',
          env: { ...process.env, HOME: tmp, USERPROFILE: tmp, SOLID_API_URL: 'http://127.0.0.1:1' },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
    } catch (err: unknown) {
      const e = err as { stdout?: Buffer | string; stderr?: Buffer | string };
      stdout = String(e.stdout ?? '');
      stderr = String(e.stderr ?? '');
    }
    // The exact exit code depends on whether the auto-queue intercepted
    // the network failure (exit 0 + queued) or surfaced as an error
    // (exit 1). Either is fine — the test just confirms the flag was
    // recognized (not "unknown option" / "error: unknown option").
    expect(stderr).not.toMatch(/unknown option/i);
    expect(stdout + stderr).not.toMatch(/error:.*unknown option/);
  });
});
