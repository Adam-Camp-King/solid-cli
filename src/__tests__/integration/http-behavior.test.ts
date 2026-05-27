/**
 * HTTP Behavior Tests — the real request/response pipeline.
 *
 * Stands up a local HTTP server, points the CLI binary at it via
 * SOLID_API_URL, and asserts on what the user actually sees.
 *
 * Uses async child_process.exec (not execSync) because the server
 * runs in the same process — execSync would block the event loop
 * and prevent the server from responding.
 */

import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const CLI_PATH = path.join(__dirname, '..', '..', '..', 'dist', 'index.js');

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

function runCli(
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
          HOME: '/tmp/solid-http-test-home',
          SOLID_API_URL: `http://127.0.0.1:${port}`,
          SOLID_API_KEY: 'sk_test_http_integration',
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

describe('CLI HTTP Behavior', () => {
  beforeAll(() => {
    if (!fs.existsSync(CLI_PATH)) {
      throw new Error(`CLI not built. Run: npm run build\nExpected: ${CLI_PATH}`);
    }
  });

  // ── Auth status ───────────────────────────────────────────────────
  describe('auth status', () => {
    it('shows user info when server returns authenticated', async () => {
      const { server, port } = await startServer([
        {
          method: 'GET',
          path: '/api/v1/auth/me',
          status: 200,
          body: {
            user: { id: 5, email: 'dev@agency.com', company_id: 42 },
          },
        },
      ]);
      try {
        const result = await runCli('auth status', port);
        expect(result.exitCode).toBe(0);
        const combined = result.stdout + result.stderr;
        expect(combined).toContain('dev@agency.com');
      } finally {
        server.close();
      }
    });

    it('shows not-authenticated when server returns 401', async () => {
      const { server, port } = await startServer([
        {
          method: 'GET',
          path: '/api/v1/auth/me',
          status: 401,
          body: { detail: 'Token expired' },
        },
      ]);
      try {
        const result = await runCli('auth status', port);
        const combined = result.stdout + result.stderr;
        // auth status catches 401 and reports authenticated:false
        expect(combined).toMatch(/authenticated.*false|not.*logged|not.*authenticated/i);
      } finally {
        server.close();
      }
    });
  });

  // ── Company list ──────────────────────────────────────────────────
  describe('company list', () => {
    it('shows companies as JSON when server returns them', async () => {
      const { server, port } = await startServer([
        {
          method: 'GET',
          path: '/api/v1/cli/companies/',
          status: 200,
          body: {
            companies: [
              { id: 42, name: 'My Company', role: 'owner', is_active: true },
              { id: 61, name: 'ANGL', role: 'developer', is_active: true },
            ],
            active_company_id: 42,
            count: 2,
          },
        },
      ]);
      try {
        const result = await runCli('company list --json', port);
        expect(result.exitCode).toBe(0);
        const parsed = JSON.parse(result.stdout);
        expect(parsed.companies).toHaveLength(2);
        expect(parsed.companies[0].name).toBe('My Company');
        expect(parsed.active_company_id).toBe(42);
      } finally {
        server.close();
      }
    });

    it('shows empty state when no companies', async () => {
      const { server, port } = await startServer([
        {
          method: 'GET',
          path: '/api/v1/cli/companies/',
          status: 200,
          body: { companies: [], active_company_id: null, count: 0 },
        },
      ]);
      try {
        const result = await runCli('company list', port);
        const combined = result.stdout + result.stderr;
        expect(combined).toMatch(/no companies|0 compan|"count":\s*0/i);
      } finally {
        server.close();
      }
    });
  });

  // ── Health check ──────────────────────────────────────────────────
  describe('health', () => {
    it('shows healthy status when server returns ok', async () => {
      const { server, port } = await startServer([
        {
          method: 'GET',
          path: '/api/v1/healthcheck/quick',
          status: 200,
          body: { status: 'healthy', timestamp: '2026-05-26T12:00:00Z' },
        },
      ]);
      try {
        const result = await runCli('health --json', port);
        expect(result.exitCode).toBe(0);
        const parsed = JSON.parse(result.stdout);
        expect(parsed.status).toBe('healthy');
      } finally {
        server.close();
      }
    });

    it('sends Authorization and X-Solid-CLI-Version headers', async () => {
      // Capture headers via a server that echoes them back in the response body
      const { server, port } = await new Promise<{ server: Server; port: number }>((resolve) => {
        const srv = createServer((req: IncomingMessage, res: ServerResponse) => {
          const headers = {
            auth: req.headers['authorization'] || null,
            version: req.headers['x-solid-cli-version'] || null,
            userAgent: req.headers['user-agent'] || null,
          };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'healthy', timestamp: '2026-05-26', _headers: headers }));
        });
        srv.listen(0, '127.0.0.1', () => {
          const addr = srv.address() as { port: number };
          resolve({ server: srv, port: addr.port });
        });
      });
      try {
        const result = await runCli('health --json', port);
        expect(result.exitCode).toBe(0);
        const parsed = JSON.parse(result.stdout);
        // The headers are echoed in the _headers field
        expect(parsed._headers.auth).toContain('sk_test_http_integration');
        expect(parsed._headers.version).toMatch(/^\d+\.\d+\.\d+$/);
        expect(parsed._headers.userAgent).toMatch(/solid-cli/);
      } finally {
        server.close();
      }
    });

    it('reports failure when server returns 5xx', async () => {
      const { server, port } = await startServer([
        {
          method: 'GET',
          path: '/api/v1/healthcheck/quick',
          status: 502,
          body: { error: 'Bad Gateway' },
        },
      ]);
      try {
        const result = await runCli('health', port);
        const combined = result.stdout + result.stderr;
        expect(combined).toMatch(/unhealthy|502|backend error|request failed/i);
      } finally {
        server.close();
      }
    });
  });

  // ── Error formatting pipeline ─────────────────────────────────────
  describe('error formatting', () => {
    it('network error shows offline hint when server is unreachable', async () => {
      const result = await runCli('health', 1);
      const combined = result.stdout + result.stderr;
      expect(combined).toMatch(/reach|connect|offline|network|ECONNREFUSED/i);
    });
  });

  // ===========================================================================
  // Phase 4 — Dangerous command HTTP integration tests
  //
  // These test the 5 most critical commands against a real HTTP server.
  // Request bodies are captured to verify the CLI sends correct payloads.
  // ===========================================================================

  // ── Helper: server that captures request bodies ────────────────────
  function startCapturingServer(
    routes: (Route & { captureBody?: boolean })[],
  ): Promise<{ server: Server; port: number; getCaptured: () => Array<{ method: string; url: string; body: any }> }> {
    const captured: Array<{ method: string; url: string; body: any }> = [];
    return new Promise((resolve) => {
      const server = createServer((req: IncomingMessage, res: ServerResponse) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          const route = routes.find((r) => {
            const methodMatch = r.method === req.method;
            const pathMatch =
              typeof r.path === 'string'
                ? req.url === r.path || req.url?.startsWith(r.path + '?')
                : r.path.test(req.url || '');
            return methodMatch && pathMatch;
          });

          if (route?.captureBody) {
            let parsedBody: any = null;
            if (body) {
              try { parsedBody = JSON.parse(body); } catch { parsedBody = body; }
            }
            captured.push({
              method: req.method || '',
              url: req.url || '',
              body: parsedBody,
            });
          }

          if (route) {
            res.writeHead(route.status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(typeof route.body === 'function' ? (route.body as any)(req, body) : route.body));
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ detail: `No route: ${req.method} ${req.url}` }));
          }
        });
      });
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as { port: number };
        resolve({ server, port: addr.port, getCaptured: () => captured });
      });
    });
  }

  // ── 4.1 auth login --token ────────────────────────────────────────
  // The --token flag verifies via authStatus (GET /api/v1/auth/me).
  // We test this through the auth status command instead of auth login,
  // because auth login opens a browser loopback server that interferes
  // with CI/test environments. The token verification path is the same.
  describe('auth token verification', () => {
    it('valid token shows authenticated user', async () => {
      const { server, port } = await startServer([
        {
          method: 'GET',
          path: '/api/v1/auth/me',
          status: 200,
          body: { user: { id: 5, email: 'dev@agency.com', company_id: 42 } },
        },
      ]);
      try {
        const result = await runCli('auth status', port);
        expect(result.exitCode).toBe(0);
        const combined = result.stdout + result.stderr;
        expect(combined).toContain('dev@agency.com');
      } finally {
        server.close();
      }
    });

    it('invalid token shows not-authenticated', async () => {
      const { server, port } = await startServer([
        {
          method: 'GET',
          path: '/api/v1/auth/me',
          status: 401,
          body: { detail: 'Invalid token' },
        },
      ]);
      try {
        const result = await runCli('auth status', port);
        const combined = result.stdout + result.stderr;
        expect(combined).toMatch(/authenticated.*false|not.*logged|not.*authenticated/i);
      } finally {
        server.close();
      }
    });
  });

  // ── 4.2 company create ────────────────────────────────────────────
  describe('company create', () => {
    it('sends name + template + industry and shows new company on success', async () => {
      const { server, port, getCaptured } = await startCapturingServer([
        {
          method: 'POST',
          path: '/api/v1/cli/companies/',
          status: 201,
          captureBody: true,
          body: {
            company: { id: 150, name: "Mike's Plumbing", slug: 'mikes-plumbing-a1b2' },
            membership: { role: 'owner' },
          },
        },
      ]);
      try {
        const result = await runCli("company create \"Mike's Plumbing\" --template plumber --industry plumbing --json", port);
        expect(result.exitCode).toBe(0);
        const parsed = JSON.parse(result.stdout);
        expect(parsed.company.id).toBe(150);
        expect(parsed.company.name).toBe("Mike's Plumbing");
        expect(parsed.membership.role).toBe('owner');

        const reqs = getCaptured();
        expect(reqs).toHaveLength(1);
        expect(reqs[0].body.name).toBe("Mike's Plumbing");
        expect(reqs[0].body.template).toBe('plumber');
        expect(reqs[0].body.industry).toBe('plumbing');
      } finally {
        server.close();
      }
    });

    it('handles 422 validation error gracefully', async () => {
      const { server, port } = await startServer([
        {
          method: 'POST',
          path: '/api/v1/cli/companies/',
          status: 422,
          body: {
            detail: [{ loc: ['body', 'name'], msg: 'field required', type: 'missing' }],
          },
        },
      ]);
      try {
        const result = await runCli('company create "" --json', port);
        const combined = result.stdout + result.stderr;
        expect(combined).toMatch(/fail|error|validation/i);
        expect(combined).not.toMatch(/at Object\.<anonymous>/);
      } finally {
        server.close();
      }
    });
  });

  // ── 4.3 company switch ────────────────────────────────────────────
  describe('company switch', () => {
    it('shows switched company and role on success', async () => {
      const { server, port } = await startServer([
        {
          method: 'POST',
          path: /\/api\/v1\/cli\/companies\/61\/switch/,
          status: 200,
          body: {
            status: 'switched',
            company: { id: 61, name: 'ANGL LLC' },
            role: 'owner',
            access_token: 'new_jwt_for_61',
            refresh_token: 'new_refresh_61',
            expires_in: 3600,
          },
        },
        {
          method: 'GET',
          path: '/api/v1/cli/companies/',
          status: 200,
          body: {
            companies: [{ id: 61, name: 'ANGL LLC', role: 'owner', is_active: true }],
            active_company_id: 61,
            count: 1,
          },
        },
      ]);
      try {
        const result = await runCli('switch 61', port);
        expect(result.exitCode).toBe(0);
        const combined = result.stdout + result.stderr;
        expect(combined).toMatch(/switched|ANGL/i);
      } finally {
        server.close();
      }
    });

    it('shows error when switching to nonexistent company', async () => {
      const { server, port } = await startServer([
        {
          method: 'POST',
          path: /\/api\/v1\/cli\/companies\/\d+\/switch/,
          status: 404,
          body: { detail: 'Company not found' },
        },
      ]);
      try {
        const result = await runCli('switch 99999', port);
        const combined = result.stdout + result.stderr;
        expect(combined).toMatch(/not found|fail|error/i);
      } finally {
        server.close();
      }
    });
  });

  // ── 4.4 kb list + update ──────────────────────────────────────────
  describe('kb', () => {
    it('kb list --json shows entries from server', async () => {
      const { server, port } = await startServer([
        {
          method: 'GET',
          path: '/api/v1/kb/company',
          status: 200,
          body: {
            results: [
              { id: 1, title: 'Business Hours', content: 'Mon-Fri 8-5', category: 'hours' },
              { id: 2, title: 'FAQ', content: 'Common questions', category: 'faq' },
            ],
            total: 2,
          },
        },
      ]);
      try {
        const result = await runCli('kb list --json', port);
        expect(result.exitCode).toBe(0);
        const parsed = JSON.parse(result.stdout);
        // KB response may or may not include total depending on list-envelope
        const items = parsed.items || parsed.results || parsed.entries || [];
        expect(items.length).toBe(2);
        expect(items[0]).toHaveProperty('id');
        expect(items[0]).toHaveProperty('title');
      } finally {
        server.close();
      }
    });

    it('kb update sends ID + fields to correct endpoint', async () => {
      const { server, port, getCaptured } = await startCapturingServer([
        {
          method: 'PUT',
          path: /\/api\/v1\/kb\/company\/\d+/,
          status: 200,
          captureBody: true,
          body: { success: true },
        },
      ]);
      try {
        const result = await runCli('kb update 15 --title "New Hours" --content "Mon-Sat 7-6"', port);
        expect(result.exitCode).toBe(0);
        const combined = result.stdout + result.stderr;
        expect(combined).toMatch(/updated|success/i);

        const reqs = getCaptured();
        expect(reqs).toHaveLength(1);
        expect(reqs[0].url).toContain('/15');
        expect(reqs[0].body.title).toBe('New Hours');
        expect(reqs[0].body.content).toBe('Mon-Sat 7-6');
      } finally {
        server.close();
      }
    });

    it('kb update with no fields shows usage hint (client-side guard)', async () => {
      // The CLI validates locally before hitting the server —
      // at least one of --title/--content/--category is required.
      const { server, port } = await startServer([]);
      try {
        const result = await runCli('kb update 15', port);
        expect(result.exitCode).toBe(1);
        const combined = result.stdout + result.stderr;
        expect(combined).toMatch(/provide|at least one|title.*content.*category/i);
        expect(combined).not.toMatch(/at Object\.<anonymous>/);
      } finally {
        server.close();
      }
    });
  });

  // ── 4.5 push (with real temp filesystem) ──────────────────────────
  describe('push', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'push-http-'));
      // Create .solid/manifest.json for the tenant guard
      fs.mkdirSync(path.join(tmpDir, '.solid'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.solid', 'manifest.json'), JSON.stringify({
        company_id: 42,
        company_name: 'Test Co',
        pulled_at: '2026-05-26T00:00:00Z',
        api_url: 'https://api.example.com',
        pages: { 'home.json': { id: 10, slug: 'home', updated_at: '2026-05-25T00:00:00Z' } },
        kb: {},
        services: {},
        products: {},
      }));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('push --dry-run shows changes without hitting server', async () => {
      // Create a page file to detect as changed
      fs.mkdirSync(path.join(tmpDir, 'pages'));
      fs.writeFileSync(
        path.join(tmpDir, 'pages', 'home.json'),
        JSON.stringify({ title: 'Updated Home', slug: 'home' }),
      );

      // Server should NOT receive any mutation requests
      const { server, port, getCaptured } = await startCapturingServer([
        { method: 'GET', path: /\/api\/v1\/cms\/pages\/\d+/, status: 200, body: { id: 10, updated_at: '2026-05-25T00:00:00Z' }, captureBody: false },
        { method: 'PATCH', path: /\/api\/v1\/cms\/pages/, status: 200, captureBody: true, body: { success: true } },
        { method: 'POST', path: '/api/v1/cli/history/snapshot', status: 200, captureBody: false, body: { success: true } },
      ]);
      try {
        const result = await runCli(`push --dry-run --yes --dir ${tmpDir}`, port, {
          SOLID_COMPANY_ID: '42',
        });
        const combined = result.stdout + result.stderr;
        expect(combined).toMatch(/dry.?run|DRY/i);

        // No mutations should have been captured
        const mutations = getCaptured().filter((r) => r.method === 'PATCH' || r.method === 'POST');
        expect(mutations).toHaveLength(0);
      } finally {
        server.close();
      }
    });

    it('push --yes sends page update to correct endpoint', async () => {
      fs.mkdirSync(path.join(tmpDir, 'pages'));
      fs.writeFileSync(
        path.join(tmpDir, 'pages', 'home.json'),
        JSON.stringify({ title: 'Updated Home', slug: 'home' }),
      );

      const { server, port, getCaptured } = await startCapturingServer([
        { method: 'GET', path: /\/api\/v1\/cms\/pages\/\d+/, status: 200, body: { id: 10, updated_at: '2026-05-25T00:00:00Z' }, captureBody: false },
        { method: 'PATCH', path: /\/api\/v1\/cms\/pages\/\d+/, status: 200, captureBody: true, body: { id: 10, title: 'Updated Home' } },
        { method: 'POST', path: '/api/v1/cli/history/snapshot', status: 200, captureBody: false, body: { success: true } },
      ]);
      try {
        const result = await runCli(`push --yes --dir ${tmpDir}`, port, {
          SOLID_COMPANY_ID: '42',
        });
        expect(result.exitCode).toBe(0);
        const combined = result.stdout + result.stderr;
        expect(combined).toMatch(/pushed|success|update/i);

        const patches = getCaptured().filter((r) => r.method === 'PATCH');
        expect(patches.length).toBeGreaterThanOrEqual(1);
        expect(patches[0].url).toContain('/10');
        expect(patches[0].body.title).toBe('Updated Home');
      } finally {
        server.close();
      }
    });

    it('push fails cleanly when tenant manifest company_id mismatches', async () => {
      // Change the manifest to a different company
      fs.writeFileSync(path.join(tmpDir, '.solid', 'manifest.json'), JSON.stringify({
        company_id: 99,
        company_name: 'Wrong Co',
        pulled_at: '2026-05-26T00:00:00Z',
        api_url: 'https://api.example.com',
        pages: {},
        kb: {},
        services: {},
        products: {},
      }));

      const { server, port } = await startServer([]);
      try {
        const result = await runCli(`push --yes --dir ${tmpDir}`, port, {
          SOLID_COMPANY_ID: '42',
        });
        expect(result.exitCode).toBe(1);
        const combined = result.stdout + result.stderr;
        expect(combined).toMatch(/mismatch|company 99|company 42|solid switch/i);
      } finally {
        server.close();
      }
    });
  });
});
