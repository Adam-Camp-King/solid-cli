/**
 * Cross-repo contract: solid-cli ↔ solidnumber.com/install.sh.
 *
 * The published install script lives in the solid-public repo and is
 * served from https://solidnumber.com/install.sh. It forwards an
 * `ist_*` token via the SOLID_INSTALL_TOKEN env var to `solid setup`.
 * If either side drifts — install.sh stops setting SOLID_INSTALL_TOKEN,
 * or the CLI changes INSTALL_TOKEN_PREFIX — the magic-link install
 * silently breaks for every user on the wild internet.
 *
 * This test pins both sides of the contract.
 *
 * Network-gated: skipped unless SOLID_RUN_NETWORK_TESTS=1, so flaky
 * connectivity in CI doesn't fail the suite. Run on a daily cron and
 * surface failures separately. Locally:
 *   SOLID_RUN_NETWORK_TESTS=1 npm test -- install-sh-contract
 */
import * as fs from 'fs';
import * as path from 'path';

const INSTALL_SH_URL = process.env.SOLID_INSTALL_SH_URL || 'https://solidnumber.com/install.sh';

const runIfNetwork = process.env.SOLID_RUN_NETWORK_TESTS === '1' ? describe : describe.skip;

// Pull INSTALL_TOKEN_PREFIX out of setup.ts so the test fails when
// the constant moves or renames. We grep the source rather than
// importing — importing would pull in the full setup module's deps.
function readPrefixFromSource(): string {
  const setupSrc = path.join(__dirname, '..', '..', 'commands', 'setup.ts');
  const src = fs.readFileSync(setupSrc, 'utf-8');
  const m = src.match(/const\s+INSTALL_TOKEN_PREFIX\s*=\s*['"]([^'"]+)['"]/);
  if (!m) throw new Error('INSTALL_TOKEN_PREFIX not found in src/commands/setup.ts — test needs updating.');
  return m[1];
}

async function fetchInstallSh(): Promise<string> {
  const res = await fetch(INSTALL_SH_URL, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`fetch ${INSTALL_SH_URL} → HTTP ${res.status}`);
  return res.text();
}

runIfNetwork('install.sh ↔ solid-cli contract', () => {
  it('install.sh references SOLID_INSTALL_TOKEN', async () => {
    const body = await fetchInstallSh();
    // The script must forward the token via env var, not argv —
    // argv leaks into `ps -ef` for the lifetime of the process.
    expect(body).toMatch(/SOLID_INSTALL_TOKEN/);
  });

  it('install.sh uses the same token prefix the CLI validates', async () => {
    const body = await fetchInstallSh();
    const prefix = readPrefixFromSource();
    // The script's example/check must match what the CLI accepts.
    // Today: prefix is `ist_`. If either side moves, this fails loudly.
    expect(body).toContain(prefix);
  });

  it('install.sh forwards SOLID_INSTALL_TOKEN to solid setup somehow', async () => {
    // Today: install.sh forwards via `--install-token $SOLID_INSTALL_TOKEN`
    // (argv). That has a known leak issue (visible in ps -ef) tracked as
    // a separate hardening task. This test pins ANY forwarding path —
    // env-direct, argv-flag, or stdin — so the cross-repo contract holds
    // even while we move from argv to env-only.
    const body = await fetchInstallSh();
    const forwards =
      /SOLID_INSTALL_TOKEN\s*=/.test(body) ||
      /--install-token[\s=]/.test(body);
    expect(forwards).toBe(true);
  });
});
