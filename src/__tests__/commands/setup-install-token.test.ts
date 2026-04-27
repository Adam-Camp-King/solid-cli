/**
 * `solid setup --install-token` — Phase 3 magic-link auth.
 *
 * Spins up a tiny in-process HTTP server that mocks the
 * /api/v1/auth/install-token/exchange endpoint, points the CLI at it
 * via SOLID_API_URL, and runs the built dist's `solid setup`. We
 * verify:
 *   1. Valid token → exchange called → config stamped → setup proceeds.
 *   2. Bad-prefix token → fails fast WITHOUT hitting the network.
 *   3. 401 from exchange → fails with a useful message, no config stamp.
 *   4. Network error → fails clearly.
 *   5. --install-token shows up in --help.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import { spawn } from 'child_process';

const distEntry = path.join(__dirname, '..', '..', '..', 'dist', 'index.js');
const distExists = fs.existsSync(distEntry);
const describeOrSkip = distExists ? describe : describe.skip;

interface MockServer {
  url: string;
  close: () => Promise<void>;
  requests: Array<{ url: string; body: string; method: string }>;
}

async function startMockServer(handler: (req: http.IncomingMessage, body: string) => { status: number; body: string }): Promise<MockServer> {
  const requests: MockServer['requests'] = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ url: req.url || '', body, method: req.method || 'GET' });
    const out = handler(req, body);
    res.writeHead(out.status, { 'Content-Type': 'application/json' });
    res.end(out.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    requests,
  };
}

/**
 * Spawn the CLI ASYNCHRONOUSLY so the in-process mock server's event loop
 * stays unblocked. spawnSync blocks the parent's event loop entirely,
 * which means an in-process http.Server can't accept the child's TCP
 * connection — the child's fetch hangs and the test times out at 5 min.
 */
async function runSetupWithIsolatedConfig(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stdout: string; stderr: string; configPath: string; configContents: any }> {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-instok-'));
  const configPath = path.join(tmpHome, '.solid', 'config.json');

  const child = spawn(process.execPath, [distEntry, 'setup', ...args], {
    env: {
      ...process.env,
      ...env,
      HOME: tmpHome,
      SOLID_SKIP_VERSION_CHECK: '1',
      SOLID_SKIP_FIRST_RUN_WIZARD: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf-8');
  child.stderr.setEncoding('utf-8');
  child.stdout.on('data', (chunk: string) => { stdout += chunk; });
  child.stderr.on('data', (chunk: string) => { stderr += chunk; });

  const code: number | null = await new Promise((resolve) => {
    child.on('exit', (c) => resolve(c));
  });

  let configContents: any = null;
  if (fs.existsSync(configPath)) {
    try { configContents = JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch { /* corrupt */ }
  }

  return { code, stdout, stderr, configPath, configContents };
}

describeOrSkip('solid setup --install-token', () => {
  it('exposes --install-token in --help', async () => {
    const child = spawn(process.execPath, [distEntry, 'setup', '--help'], {
      env: { ...process.env, SOLID_SKIP_VERSION_CHECK: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (c: string) => { stdout += c; });
    const code: number | null = await new Promise((res) => child.on('exit', res));
    expect(code).toBe(0);
    expect(stdout).toMatch(/--install-token/);
    expect(stdout).toMatch(/ist_/);
  });

  it('valid token: calls exchange, stamps config, succeeds', async () => {
    const mock = await startMockServer((_req, _body) => ({
      status: 200,
      body: JSON.stringify({
        status: 'OK',
        access_token: 'fake.access.token',
        refresh_token: 'fake.refresh.token',
        expires_in: 3600,
        token_type: 'bearer',
        user: { id: 42, email: 'unit@example.com', name: 'Unit', role: 'owner', company_id: 99999 },
        company: { id: 99999, name: 'Unit Test Co' },
      }),
    }));

    try {
      const r = await runSetupWithIsolatedConfig(
        ['--install-token', 'ist_validtoken_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', '--yes', '--skip-mcp', '--skip-completion', '--skip-render', '--skip-first-action', '--json'],
        { SOLID_API_URL: mock.url },
      );

      expect(r.code).toBe(0);

      const exchangeRequests = mock.requests.filter(req => req.url === '/api/v1/auth/install-token/exchange');
      expect(exchangeRequests.length).toBe(1);
      expect(exchangeRequests[0].method).toBe('POST');
      const sent = JSON.parse(exchangeRequests[0].body);
      expect(sent.token).toBe('ist_validtoken_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');

      // Config was stamped.
      expect(r.configContents).toBeTruthy();
      expect(r.configContents.access_token).toBe('fake.access.token');
      expect(r.configContents.refresh_token).toBe('fake.refresh.token');
      expect(r.configContents.user_email).toBe('unit@example.com');
      expect(r.configContents.company_id).toBe(99999);

      // Envelope confirms the install_token step ran.
      const env = JSON.parse(r.stdout);
      const tokenStep = env.results.find((s: any) => s.step === 'install_token');
      expect(tokenStep).toBeTruthy();
      expect(tokenStep.status).toBe('done');
    } finally {
      await mock.close();
    }
  });

  it('bad-prefix token: fails fast without hitting the network', async () => {
    const mock = await startMockServer(() => ({
      status: 200,
      body: JSON.stringify({ access_token: 'should_never_be_used', refresh_token: 'x' }),
    }));

    try {
      const r = await runSetupWithIsolatedConfig(
        ['--install-token', 'wrong_prefix_xxxxxxxxxxxxxxxxxxxx', '--yes', '--skip-mcp', '--skip-completion', '--skip-render', '--skip-first-action', '--json'],
        { SOLID_API_URL: mock.url },
      );

      expect(r.code).toBe(1);
      // The mock should NOT have been called — bad prefix is caught client-side.
      expect(mock.requests.length).toBe(0);
      // Config should NOT contain the should-never-be-used token.
      if (r.configContents) {
        expect(r.configContents.access_token).not.toBe('should_never_be_used');
      }

      const env = JSON.parse(r.stdout);
      const tokenStep = env.results.find((s: any) => s.step === 'install_token');
      expect(tokenStep.status).toBe('failed');
      expect(tokenStep.detail).toMatch(/ist_/);
    } finally {
      await mock.close();
    }
  });

  it('401 from exchange: fails with replay/expiry hint, no config stamp', async () => {
    const mock = await startMockServer(() => ({
      status: 401,
      body: JSON.stringify({ detail: 'Invalid or expired install token' }),
    }));

    try {
      const r = await runSetupWithIsolatedConfig(
        ['--install-token', 'ist_expiredtoken_yyyyyyyyyyyyyyyyyyyyyyyyyyyyy', '--yes', '--skip-mcp', '--skip-completion', '--skip-render', '--skip-first-action', '--json'],
        { SOLID_API_URL: mock.url },
      );

      expect(r.code).toBe(1);
      // Filter out fire-and-forget telemetry; assert the exchange call landed.
      const exchangeReqs = mock.requests.filter((req) => req.url === '/api/v1/auth/install-token/exchange');
      expect(exchangeReqs.length).toBe(1);
      // Config should NOT contain anything from the failed exchange.
      if (r.configContents) {
        expect(r.configContents.access_token).toBeUndefined();
      }

      const env = JSON.parse(r.stdout);
      const tokenStep = env.results.find((s: any) => s.step === 'install_token');
      expect(tokenStep.status).toBe('failed');
      expect(tokenStep.detail).toMatch(/expired|invalid|already used|fresh/i);
    } finally {
      await mock.close();
    }
  });

  it('network error: fails clearly when the API is unreachable', async () => {
    // Use a port we know is closed by binding+immediately-closing a server.
    // Simpler: point at 127.0.0.1:1 (privileged port, almost always refused).
    const r = await runSetupWithIsolatedConfig(
      ['--install-token', 'ist_doesnotmatter_zzzzzzzzzzzzzzzzzzzzzzzzzzzz', '--yes', '--skip-mcp', '--skip-completion', '--skip-render', '--skip-first-action', '--json'],
      { SOLID_API_URL: 'http://127.0.0.1:1' },
    );

    expect(r.code).toBe(1);
    const env = JSON.parse(r.stdout);
    const tokenStep = env.results.find((s: any) => s.step === 'install_token');
    expect(tokenStep.status).toBe('failed');
    expect(tokenStep.detail).toMatch(/network|ECONNREFUSED|fetch failed/i);
  });

  // ───── post-2.2.1 regression locks ─────

  it('timeout: AbortSignal.timeout fires when backend hangs (regression: #4)', async () => {
    // Mock that NEVER responds — the timeout path is the only way out.
    // SOLID_INSTALL_TOKEN_TIMEOUT_MS=200 forces a fast trip; production
    // stays at 30s. If a future refactor drops AbortSignal.timeout, the
    // test hangs and CI kills the suite — also a regression signal.
    const hangServer = http.createServer((_req, _res) => {
      // intentionally never respond
    });
    await new Promise<void>((resolve) => hangServer.listen(0, '127.0.0.1', resolve));
    const addr = hangServer.address();
    if (!addr || typeof addr === 'string') throw new Error('no address');
    const url = `http://127.0.0.1:${addr.port}`;

    try {
      const r = await runSetupWithIsolatedConfig(
        ['--install-token', 'ist_hangtoken_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', '--yes', '--skip-mcp', '--skip-completion', '--skip-render', '--skip-first-action', '--json'],
        { SOLID_API_URL: url, SOLID_INSTALL_TOKEN_TIMEOUT_MS: '200' },
      );

      expect(r.code).toBe(1);
      const env = JSON.parse(r.stdout);
      const tokenStep = env.results.find((s: any) => s.step === 'install_token');
      expect(tokenStep.status).toBe('failed');
      // The detail must clearly indicate timeout, not a generic network error.
      expect(tokenStep.detail).toMatch(/timed out/i);
      // No partial success leaked into the config.
      if (r.configContents) {
        expect(r.configContents.access_token).toBeUndefined();
      }
    } finally {
      await new Promise<void>((resolve) => hangServer.close(() => resolve()));
    }
  }, 15_000);

  it('bad-prefix: error detail does NOT echo the bad-token bytes (regression: #5)', async () => {
    // The whole point of the prefix check is to fail BEFORE leaking
    // user-supplied entropy into stderr. If a refactor reverts to
    // `(got "${token}")`, this test catches it.
    const sentinelToken = 'sentineltokenZZZZZZZZZZZZZZZZZZZZ';
    const r = await runSetupWithIsolatedConfig(
      ['--install-token', sentinelToken, '--yes', '--skip-mcp', '--skip-completion', '--skip-render', '--skip-first-action', '--json'],
      { SOLID_API_URL: 'http://127.0.0.1:1' },
    );

    expect(r.code).toBe(1);
    const env = JSON.parse(r.stdout);
    const tokenStep = env.results.find((s: any) => s.step === 'install_token');
    expect(tokenStep.status).toBe('failed');
    // The full token must NOT appear anywhere — stdout, stderr, or detail.
    expect(tokenStep.detail).not.toContain(sentinelToken);
    expect(r.stdout).not.toContain(sentinelToken);
    expect(r.stderr).not.toContain(sentinelToken);
    // Even a non-trivial substring of the secret must not leak.
    expect(tokenStep.detail).not.toContain(sentinelToken.slice(0, 8));
  });

  it('env var: SOLID_INSTALL_TOKEN works without --install-token argv flag', async () => {
    // The recommended path — token in env, not argv. install.sh sets
    // this; users can `export SOLID_INSTALL_TOKEN=…` directly.
    const mock = await startMockServer(() => ({
      status: 200,
      body: JSON.stringify({
        access_token: 'env.access.token',
        refresh_token: 'env.refresh.token',
        expires_in: 3600,
        user: { id: 1, email: 'env@example.com', company_id: 11111 },
      }),
    }));

    try {
      const r = await runSetupWithIsolatedConfig(
        ['--yes', '--skip-mcp', '--skip-completion', '--skip-render', '--skip-first-action', '--json'],
        {
          SOLID_API_URL: mock.url,
          SOLID_INSTALL_TOKEN: 'ist_envtoken_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        },
      );

      expect(r.code).toBe(0);
      const exchangeReqs = mock.requests.filter((req) => req.url === '/api/v1/auth/install-token/exchange');
      expect(exchangeReqs.length).toBe(1);
      expect(JSON.parse(exchangeReqs[0].body).token).toBe('ist_envtoken_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
      expect(r.configContents.access_token).toBe('env.access.token');
      // No warning when env var is the source.
      expect(r.stderr).not.toMatch(/visible in process listings/);
    } finally {
      await mock.close();
    }
  });

  it('argv path: emits stderr warning recommending the env var', async () => {
    // argv still works (back-compat for install.sh today and any
    // wild-internet automation), but we warn so the next sweep flips
    // those callers to env.
    const mock = await startMockServer(() => ({
      status: 200,
      body: JSON.stringify({
        access_token: 'argv.access.token',
        refresh_token: 'argv.refresh.token',
        expires_in: 3600,
        user: { id: 1, email: 'argv@example.com', company_id: 22222 },
      }),
    }));

    try {
      const r = await runSetupWithIsolatedConfig(
        ['--install-token', 'ist_argvtoken_yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy', '--yes', '--skip-mcp', '--skip-completion', '--skip-render', '--skip-first-action', '--json'],
        { SOLID_API_URL: mock.url },
      );

      expect(r.code).toBe(0);
      // The whole point — argv path warns about ps -ef visibility.
      expect(r.stderr).toMatch(/visible in process listings/);
      expect(r.stderr).toMatch(/SOLID_INSTALL_TOKEN/);
    } finally {
      await mock.close();
    }
  });

  it('bad-prefix: detail uses the anti-leak phrasing "got something else"', async () => {
    // Locks the exact wording. If a maintainer changes the message to
    // include the user-supplied bytes ("got 'sentineltoken...'"), this
    // test fires before the leak ships.
    const r = await runSetupWithIsolatedConfig(
      ['--install-token', 'wrongprefix_aaaaaaaaaaaaaaaaaaaaaa', '--yes', '--skip-mcp', '--skip-completion', '--skip-render', '--skip-first-action', '--json'],
      { SOLID_API_URL: 'http://127.0.0.1:1' },
    );

    expect(r.code).toBe(1);
    const env = JSON.parse(r.stdout);
    const tokenStep = env.results.find((s: any) => s.step === 'install_token');
    expect(tokenStep.status).toBe('failed');
    expect(tokenStep.detail).toMatch(/got something else/i);
    expect(tokenStep.detail).toMatch(/ist_/);
  });
});
