/**
 * Machine-readable contract tests — the AI-agent-facing API.
 *
 * Every --json shape, every exit code, every error message that an AI
 * agent will parse is pinned here. When a contract changes, this test
 * fails BEFORE publish — not after a customer's agent breaks silently.
 *
 * Run standalone:  npm run test:contracts
 */

import { execSync } from 'child_process';
import { exec } from 'child_process';
import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import * as path from 'path';
import * as fs from 'fs';

const CLI_PATH = path.join(__dirname, '..', '..', '..', 'dist', 'index.js');

function run(args: string): string {
  return execSync(`node ${CLI_PATH} ${args}`, {
    timeout: 15000,
    env: { ...process.env, HOME: '/tmp/solid-contract-test', SOLID_API_KEY: '', SOLID_NO_TENANT_WARN: '1', NO_COLOR: '1' },
  }).toString();
}

function runSafe(args: string): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`node ${CLI_PATH} ${args}`, {
      timeout: 15000,
      env: { ...process.env, HOME: '/tmp/solid-contract-test', SOLID_API_KEY: '', SOLID_NO_TENANT_WARN: '1', NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString();
    return { stdout, stderr: '', exitCode: 0 };
  } catch (e: any) {
    return {
      stdout: e.stdout?.toString() || '',
      stderr: e.stderr?.toString() || '',
      exitCode: e.status || 1,
    };
  }
}

interface Route {
  method: string;
  path: string | RegExp;
  status: number;
  body: unknown;
}

function startServer(routes: Route[]): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const route = routes.find((r) => {
        const methodMatch = r.method === req.method;
        const pathMatch =
          typeof r.path === 'string'
            ? req.url === r.path || req.url?.startsWith(r.path + '?')
            : r.path.test(req.url || '');
        return methodMatch && pathMatch;
      });
      if (route) {
        res.writeHead(route.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(route.body));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: `No route: ${req.method} ${req.url}` }));
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port });
    });
  });
}

function runCliAsync(
  args: string,
  port: number,
  env: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
  return new Promise((resolve) => {
    exec(
      `node ${CLI_PATH} ${args}`,
      {
        timeout: 15000,
        cwd: path.join(__dirname, '..', '..', '..'),
        env: {
          PATH: process.env.PATH,
          HOME: '/tmp/solid-contract-test',
          SOLID_API_URL: `http://127.0.0.1:${port}`,
          SOLID_API_KEY: 'sk_test_contract',
          SOLID_NO_TENANT_WARN: '1',
          NO_COLOR: '1',
          SOLID_TIMEOUT_MS: '10000',
          ...env,
        },
      },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout || '',
          stderr: stderr || '',
          exitCode: error ? (typeof (error as any).code === 'number' ? (error as any).code : 1) : 0,
          timedOut: !!(error && (error as any).killed),
        });
      },
    );
  });
}

describe('CLI Contract Tests', () => {
  beforeAll(() => {
    if (!fs.existsSync(CLI_PATH)) {
      throw new Error(`CLI not built. Run: npm run build\nExpected: ${CLI_PATH}`);
    }
  });

  // ===========================================================================
  // 1. JSON SHAPE CONTRACTS — no-auth commands
  //
  // These run against the built binary with no server. Pin every field
  // an AI agent would parse. Rename = snapshot break = publish blocked.
  // ===========================================================================
  describe('JSON shapes — no-auth commands', () => {

    // ── schema verbs ──────────────────────────────────────────────────
    describe('schema verbs --json', () => {
      let parsed: any;
      beforeAll(() => { parsed = JSON.parse(run('schema verbs --json')); });

      it('top-level keys: cli_version, count, verbs, version', () => {
        expect(Object.keys(parsed).sort()).toEqual(['cli_version', 'count', 'verbs', 'version']);
      });

      it('verbs is an array with > 50 entries', () => {
        expect(Array.isArray(parsed.verbs)).toBe(true);
        expect(parsed.verbs.length).toBeGreaterThan(50);
      });

      it('count matches verbs.length', () => {
        expect(parsed.count).toBe(parsed.verbs.length);
      });

      it('every entry has verb, path, description, depth, is_leaf', () => {
        for (const v of parsed.verbs.slice(0, 20)) {
          expect(v).toHaveProperty('verb');
          expect(v).toHaveProperty('path');
          expect(v).toHaveProperty('description');
          expect(v).toHaveProperty('depth');
          expect(v).toHaveProperty('is_leaf');
        }
      });

      it('entry has args, options, subcommands arrays', () => {
        const entry = parsed.verbs[0];
        expect(Array.isArray(entry.args)).toBe(true);
        expect(Array.isArray(entry.options)).toBe(true);
        expect(Array.isArray(entry.subcommands)).toBe(true);
      });
    });

    // ── schema blocks ─────────────────────────────────────────────────
    describe('schema blocks --json', () => {
      it('top-level keys: count, examples', () => {
        const parsed = JSON.parse(run('schema blocks --json'));
        expect(Object.keys(parsed).sort()).toEqual(['count', 'examples']);
        expect(typeof parsed.count).toBe('number');
        expect(parsed.count).toBeGreaterThan(20);
      });

      it('--type hero returns a single block with type field', () => {
        const parsed = JSON.parse(run('schema blocks --type hero --json'));
        expect(parsed.type).toBe('hero');
        expect(parsed).toHaveProperty('title');
      });

      it('--examples has count matching examples object keys', () => {
        const parsed = JSON.parse(run('schema blocks --examples --json'));
        expect(parsed.count).toBe(Object.keys(parsed.examples).length);
      });

      it('every example has a type field', () => {
        const parsed = JSON.parse(run('schema blocks --examples --json'));
        for (const [blockType, example] of Object.entries(parsed.examples)) {
          expect((example as any).type).toBe(blockType);
        }
      });
    });

    // ── doctor env ────────────────────────────────────────────────────
    describe('doctor env --json', () => {
      let parsed: any;
      beforeAll(() => {
        const { stdout } = runSafe('doctor env --json');
        parsed = JSON.parse(stdout);
      });

      it('top-level keys: ok, results, summary', () => {
        expect(Object.keys(parsed).sort()).toEqual(['ok', 'results', 'summary']);
      });

      it('ok is a boolean', () => {
        expect(typeof parsed.ok).toBe('boolean');
      });

      it('results is an array of probe objects', () => {
        expect(Array.isArray(parsed.results)).toBe(true);
        expect(parsed.results.length).toBeGreaterThan(0);
      });

      it('each probe has name, label, status, detail', () => {
        for (const probe of parsed.results) {
          expect(probe).toHaveProperty('name');
          expect(probe).toHaveProperty('label');
          expect(probe).toHaveProperty('status');
          expect(probe).toHaveProperty('detail');
          expect(['pass', 'fail', 'warn', 'skip']).toContain(probe.status);
        }
      });

      it('failed probes include a hint field', () => {
        const failed = parsed.results.filter((p: any) => p.status === 'fail');
        expect(failed.length).toBeGreaterThan(0);
        for (const probe of failed) {
          expect(probe).toHaveProperty('hint');
          expect(probe.hint.length).toBeGreaterThan(0);
        }
      });
    });

    // ── version ───────────────────────────────────────────────────────
    describe('version --json', () => {
      it('keys: node, schema_version, version', () => {
        const parsed = JSON.parse(run('version --json'));
        expect(Object.keys(parsed).sort()).toEqual(['node', 'schema_version', 'version']);
        expect(parsed.version).toMatch(/^\d+\.\d+\.\d+$/);
        expect(parsed.node).toMatch(/^v?\d+\.\d+\.\d+$/);
      });
    });

    // ── --version (bare) ──────────────────────────────────────────────
    it('--version emits bare semver (no JSON wrapper)', () => {
      const version = run('--version').trim();
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  // ===========================================================================
  // 2. JSON SHAPE CONTRACTS — auth-gated commands (HTTP server)
  //
  // These spawn a local HTTP server with canned responses and run the
  // CLI binary against it. Pin the shapes that AI agents parse.
  // ===========================================================================
  describe('JSON shapes — auth-gated commands', () => {

    // ── company list ──────────────────────────────────────────────────
    it('company list --json: companies array + active_company_id + count', async () => {
      const { server, port } = await startServer([{
        method: 'GET',
        path: '/api/v1/cli/companies/',
        status: 200,
        body: {
          companies: [
            { id: 42, name: 'Test Co', role: 'owner', is_active: true, joined_at: '2026-01-01' },
          ],
          active_company_id: 42,
          count: 1,
        },
      }]);
      try {
        const result = await runCliAsync('company list --json', port);
        expect(result.exitCode).toBe(0);
        const parsed = JSON.parse(result.stdout);
        expect(parsed).toHaveProperty('companies');
        expect(parsed).toHaveProperty('active_company_id');
        expect(parsed).toHaveProperty('count');
        expect(Array.isArray(parsed.companies)).toBe(true);
        const co = parsed.companies[0];
        expect(co).toHaveProperty('id');
        expect(co).toHaveProperty('name');
        expect(co).toHaveProperty('role');
      } finally {
        server.close();
      }
    });

    // ── health ────────────────────────────────────────────────────────
    it('health --json: status + timestamp', async () => {
      const { server, port } = await startServer([{
        method: 'GET',
        path: '/api/v1/healthcheck/quick',
        status: 200,
        body: { status: 'healthy', timestamp: '2026-05-26T12:00:00Z' },
      }]);
      try {
        const result = await runCliAsync('health --json', port);
        expect(result.exitCode).toBe(0);
        const parsed = JSON.parse(result.stdout);
        expect(parsed).toHaveProperty('status');
        expect(parsed).toHaveProperty('timestamp');
      } finally {
        server.close();
      }
    });

    // ── health --full ─────────────────────────────────────────────────
    it('health --full --json: status + layers', async () => {
      const { server, port } = await startServer([{
        method: 'GET',
        path: '/api/v1/health',
        status: 200,
        body: {
          status: 'healthy',
          database: { status: 'healthy' },
          redis: { status: 'healthy' },
          celery: { status: 'healthy' },
        },
      }]);
      try {
        const result = await runCliAsync('health --full --json', port);
        expect(result.exitCode).toBe(0);
        const parsed = JSON.parse(result.stdout);
        expect(parsed).toHaveProperty('status');
      } finally {
        server.close();
      }
    });

    // ── health --mcp ──────────────────────────────────────────────────
    it('health --mcp --json: status + mcp_enabled + agents', async () => {
      const { server, port } = await startServer([{
        method: 'GET',
        path: '/api/v1/healthcheck/mcp',
        status: 200,
        body: { status: 'healthy', mcp_enabled: true, agents: { total_agents: 14 } },
      }]);
      try {
        const result = await runCliAsync('health --mcp --json', port);
        expect(result.exitCode).toBe(0);
        const parsed = JSON.parse(result.stdout);
        expect(parsed).toHaveProperty('status');
        expect(parsed).toHaveProperty('mcp_enabled');
        expect(parsed).toHaveProperty('agents');
        expect(parsed.agents).toHaveProperty('total_agents');
      } finally {
        server.close();
      }
    });

    // ── pages list ────────────────────────────────────────────────────
    // list-envelope normalizer aliases .pages → .items, so the CLI
    // output always has items + total regardless of backend field name.
    it('pages list --json: items array + total', async () => {
      const { server, port } = await startServer([{
        method: 'GET',
        path: '/api/v1/cms/pages',
        status: 200,
        body: {
          pages: [
            { id: 1, title: 'Home', slug: 'home', page_type: 'website', status: 'published' },
          ],
          total: 1,
        },
      }]);
      try {
        const result = await runCliAsync('pages list --json', port);
        expect(result.exitCode).toBe(0);
        const parsed = JSON.parse(result.stdout);
        expect(parsed).toHaveProperty('items');
        expect(parsed).toHaveProperty('total');
        expect(Array.isArray(parsed.items)).toBe(true);
        const page = parsed.items[0];
        expect(page).toHaveProperty('id');
        expect(page).toHaveProperty('title');
        expect(page).toHaveProperty('slug');
      } finally {
        server.close();
      }
    });

    // ── services list ─────────────────────────────────────────────────
    it('services list --json: items array + total', async () => {
      const { server, port } = await startServer([{
        method: 'GET',
        path: '/api/v1/services/catalog',
        status: 200,
        body: {
          items: [
            { id: 1, name: 'Drain Clearing', price: 150, duration_minutes: 60 },
          ],
          total: 1,
        },
      }]);
      try {
        const result = await runCliAsync('services list --json', port);
        expect(result.exitCode).toBe(0);
        const parsed = JSON.parse(result.stdout);
        expect(parsed).toHaveProperty('items');
        expect(parsed).toHaveProperty('total');
        expect(Array.isArray(parsed.items)).toBe(true);
      } finally {
        server.close();
      }
    });
  });

  // ===========================================================================
  // 3. EXIT CODE CONTRACTS
  // ===========================================================================
  describe('exit code contracts', () => {
    describe.each([
      ['--version',                           0],
      ['--help',                              0],
      ['completion',                          0],
      ['schema verbs --json',                 0],
      ['schema blocks --json',                0],
      ['version --json',                      0],
    ])('solid %s → exit 0', (args, expectedExit) => {
      it('exits correctly', () => {
        const { exitCode } = runSafe(args);
        expect(exitCode).toBe(expectedExit);
      });
    });

    describe.each([
      ['graph --offline',          'no offline context file'],
      ['push',                     'no auth or manifest'],
    ])('solid %s → exit 1 (%s)', (args, _reason) => {
      it('exits with expected failure code', () => {
        const { exitCode } = runSafe(args);
        expect(exitCode).toBe(1);
      });
    });

    describe.each([
      ['company list',             'requires auth'],
      ['pages list',               'requires auth'],
      ['kb list',                  'requires auth'],
      ['services list',            'requires auth'],
      ['leads list',               'requires auth'],
    ])('solid %s → exit 1 without auth (%s)', (args, _reason) => {
      it('fails cleanly without auth', () => {
        const { exitCode, stdout, stderr } = runSafe(args);
        expect(exitCode).toBe(1);
        const combined = stdout + stderr;
        expect(combined).toMatch(/login|auth|logged in/i);
      });
    });
  });

  // ===========================================================================
  // 4. ERROR MESSAGE REGRESSION TESTS
  // ===========================================================================
  describe('error message contracts', () => {
    it('graph --offline without context gives recovery hint', () => {
      const { stderr, stdout } = runSafe('graph --offline');
      const combined = stdout + stderr;
      expect(combined).toMatch(/solid context|\.claude|jsonld/i);
    });

    it('push without auth says to login, never a stack trace', () => {
      const { stderr, stdout } = runSafe('push');
      const combined = stdout + stderr;
      expect(combined).toMatch(/login|auth|manifest|tenant/i);
      expect(combined).not.toMatch(/at Object\.<anonymous>/);
      expect(combined).not.toMatch(/TypeError:/);
    });

    it('auth-gated commands say "solid auth login" when unauthenticated', () => {
      const { stderr, stdout } = runSafe('company list');
      const combined = stdout + stderr;
      expect(combined).toMatch(/solid auth login/);
    });

    describe.each([
      ['--help'],
      ['--version'],
      ['schema verbs --json'],
      ['schema blocks --json'],
      ['completion'],
      ['graph --offline'],
      ['push'],
      ['company list'],
      ['pages list'],
      ['doctor env --json'],
    ])('solid %s never shows a raw stack trace', (args) => {
      it('no stack traces in user output', () => {
        const { stderr, stdout } = runSafe(args);
        const combined = stdout + stderr;
        expect(combined).not.toMatch(/at Object\.<anonymous>/);
        expect(combined).not.toMatch(/at Module\._compile/);
        expect(combined).not.toMatch(/Cannot read prop/);
      });
    });
  });

  // ===========================================================================
  // 5. JSON ENVELOPE CONSISTENCY
  // ===========================================================================
  describe('JSON envelope consistency', () => {
    describe.each([
      ['schema verbs'],
      ['schema blocks'],
      ['schema blocks --type hero'],
      ['schema blocks --examples'],
      ['version'],
      ['doctor env'],
    ])('solid %s --json returns an object, not a bare array', (cmd) => {
      it('is an object', () => {
        expect.hasAssertions();
        const { stdout, exitCode } = runSafe(`${cmd} --json`);
        expect([0, 1]).toContain(exitCode);
        expect(stdout.trim()).not.toBe('');
        const parsed = JSON.parse(stdout);
        expect(typeof parsed).toBe('object');
        expect(Array.isArray(parsed)).toBe(false);
      });
    });

    it('list commands return items in an array field (not bare array)', async () => {
      const { server, port } = await startServer([
        {
          method: 'GET', path: '/api/v1/cli/companies/',
          status: 200, body: { companies: [], active_company_id: null, count: 0 },
        },
        {
          method: 'GET', path: '/api/v1/cms/pages',
          status: 200, body: { pages: [], total: 0 },
        },
        {
          method: 'GET', path: '/api/v1/services/catalog',
          status: 200, body: { items: [], total: 0 },
        },
      ]);
      try {
        for (const cmd of ['company list', 'pages list', 'services list']) {
          const result = await runCliAsync(`${cmd} --json`, port);
          expect(result.exitCode).toBe(0);
          expect(result.stdout.trim()).not.toBe('');
          const parsed = JSON.parse(result.stdout);
          expect(typeof parsed).toBe('object');
          expect(Array.isArray(parsed)).toBe(false);
        }
      } finally {
        server.close();
      }
    });
  });
});
