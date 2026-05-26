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
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
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
          exitCode: error ? (error as any).code ?? 1 : 0,
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
        expect(combined).toMatch(/no companies|0/i);
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
        expect(combined).toMatch(/fail|error|unhealthy|502|backend/i);
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

});
