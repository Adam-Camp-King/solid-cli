/**
 * Integration test for `solid graph --diff` — A+.4.
 *
 * Spawns the built CLI with two fixture .jsonld files (baseline +
 * current) so we exercise: argv parsing → loadDocument → graphDiff →
 * exit code.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

const root = path.join(__dirname, '..', '..', '..');
const distEntry = path.join(root, 'dist', 'index.js');

const distExists = fs.existsSync(distEntry);
const describeOrSkip = distExists ? describe : describe.skip;

function makeFixture(nodes: Array<Record<string, unknown> & { '@id': string }>) {
  return {
    '@context': { '@version': 1.1, graph: '@graph' },
    '@id': 'https://solidnumber.com/co/61',
    '@type': ['solid:TenantContext'],
    graph: nodes,
  };
}

function setupTenant(currentDoc: ReturnType<typeof makeFixture>): { tmp: string; baselinePath: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'solid-diff-'));
  fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
  // The "after" — what `loadDocument --offline` will read.
  fs.writeFileSync(path.join(tmp, '.claude', 'solid-context.jsonld'), JSON.stringify(currentDoc, null, 2));
  // The "before" baseline — passed via --diff
  return { tmp, baselinePath: path.join(tmp, 'baseline.jsonld') };
}

describeOrSkip('solid graph --diff', () => {
  it('exits 0 when graphs are identical', () => {
    const doc = makeFixture([
      { '@id': 'https://solidnumber.com/co/61', '@type': ['schema:Organization'], name: 'X' },
    ]);
    const { tmp, baselinePath } = setupTenant(doc);
    fs.writeFileSync(baselinePath, JSON.stringify(doc, null, 2));

    // execFileSync throws on non-zero exit; reaching the assertion
    // proves exit was 0.
    const out = execFileSync(
      'node',
      [distEntry, 'graph', '--diff', baselinePath, '--offline', '--json'],
      { cwd: tmp, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const report = JSON.parse(out);
    expect(report.summary).toEqual({ added: 0, removed: 0, modified: 0, unchanged: 1 });
  });

  it('exits 1 when graphs differ', () => {
    const before = makeFixture([
      { '@id': 'https://solidnumber.com/co/61', '@type': ['schema:Organization'], name: 'X' },
    ]);
    const after = makeFixture([
      { '@id': 'https://solidnumber.com/co/61', '@type': ['schema:Organization'], name: 'X' },
      { '@id': 'https://solidnumber.com/co/61/kb/1', '@type': ['schema:Article'], name: 'New' },
    ]);
    const { tmp, baselinePath } = setupTenant(after);
    fs.writeFileSync(baselinePath, JSON.stringify(before, null, 2));

    let exited = 0;
    let stdout = '';
    try {
      execFileSync(
        'node',
        [distEntry, 'graph', '--diff', baselinePath, '--offline', '--json'],
        { cwd: tmp, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
      );
    } catch (err: unknown) {
      const e = err as { status?: number; stdout?: Buffer | string };
      exited = e.status ?? 0;
      stdout = String(e.stdout ?? '');
    }
    expect(exited).toBe(1);
    const report = JSON.parse(stdout);
    expect(report.summary.added).toBe(1);
  });

  it('exits 1 when --diff baseline is missing', () => {
    const doc = makeFixture([{ '@id': 'https://solidnumber.com/co/61', '@type': ['schema:Organization'] }]);
    const { tmp } = setupTenant(doc);
    let exited = 0;
    let stderr = '';
    let stdout = '';
    try {
      execFileSync(
        'node',
        [distEntry, 'graph', '--diff', '/nonexistent/baseline.jsonld', '--offline'],
        {
          cwd: tmp,
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'pipe'],
          // Force human-prose mode so "baseline not found" lands on stderr
          // as a clean string (auto-JSON would route it to stdout as a
          // {ok:false,error:"…"} envelope, which is also valid behavior).
          env: { ...process.env, SOLID_NO_JSON: '1' },
        },
      );
    } catch (err: unknown) {
      const e = err as { status?: number; stderr?: Buffer | string; stdout?: Buffer | string };
      exited = e.status ?? 0;
      stderr = String(e.stderr ?? '');
      stdout = String(e.stdout ?? '');
    }
    expect(exited).toBe(1);
    // Either prose on stderr OR JSON envelope on stdout — both are correct.
    expect(`${stderr}\n${stdout}`).toMatch(/baseline not found/);
  });
});
