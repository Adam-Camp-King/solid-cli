/**
 * solid app — BEHAVIOURAL: the real command runs against a real temp folder with
 * the API client mocked. What matters: no index.html is refused before any call,
 * no --confirm never publishes, --confirm sends the folder with consent.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('chalk', () => {
  const id = (s: string) => s;
  const proxy: any = new Proxy(id, { get: () => proxy });
  return { __esModule: true, default: proxy };
});
const post = jest.fn();
// ⛔ THE SERVER'S REAL SHAPE. `/api/v1/agent/app/<verb>` is served by the backend's
// catch-all, which wraps every answer as `{ ok, verb, result }`
// (controllers/ada.py::_cli_dispatch). These tests used to hand the command the
// bare answer it expected, so they passed while `solid app publish` failed for
// every real user with "Failed to parse URL from undefined" (found by a customer,
// 2026-10-04). Each test below still states the VERB's answer; this wraps it the
// way the server does before the command sees it.
jest.mock('../../lib/api-client', () => ({
  apiClient: {
    post: async (...a: unknown[]) => {
      const res = await post(...a);
      if (!res || typeof res.data !== 'object' || res.data === null) return res;
      const verb = `app.${String(a[0]).split('/').pop()}`;
      return { ...res, data: { ok: true, verb, result: res.data } };
    },
  },
  handleApiError: (e: Error) => ({ message: e.message }),
}));

import { unzipSync } from 'fflate';

import { appCommand } from '../../commands/app';

function folder(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solid-app-'));
  for (const [p, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    fs.writeFileSync(path.join(dir, p), c);
  }
  return dir;
}

async function run(args: string[]): Promise<string> {
  const out: string[] = [];
  const log = jest.spyOn(console, 'log').mockImplementation((...a) => { out.push(a.join(' ')); });
  const err = jest.spyOn(console, 'error').mockImplementation((...a) => { out.push(a.join(' ')); });
  const write = jest.spyOn(process.stdout, 'write').mockImplementation((s: any) => (out.push(String(s)), true));
  try {
    const pub = appCommand.commands.find((c) => c.name() === 'publish')!;
    for (const k of ['confirm', 'json', 'root', 'name', 'slug', 'hold']) pub.setOptionValue(k, undefined);
    await appCommand.parseAsync(args, { from: 'user' });
  } finally {
    log.mockRestore(); err.mockRestore(); write.mockRestore();
  }
  return out.join('\n');
}

// ⛔ GitHub's runner sets GITHUB_SHA / GITHUB_REPOSITORY, and `solid app publish`
// reads them to say which commit is live — so the same test passed on a Mac and
// failed in CI, which failed the npm release workflow on every tag. The tests
// that assert "no commit is claimed" run without them; the CI case is pinned below.
const CI_ENV = ['GITHUB_SHA', 'GITHUB_REPOSITORY', 'GITHUB_ACTIONS', 'GITHUB_SERVER_URL'];
const savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  post.mockReset(); process.exitCode = 0;
  for (const k of CI_ENV) { savedEnv[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of CI_ENV) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
});
afterAll(() => { process.exitCode = 0; });

test('a folder with no index.html is refused before anything is sent', async () => {
  const dir = folder({ 'src/App.tsx': 'x', 'package.json': '{}' });
  const text = await run(['publish', dir, '--slug', 'sell', '--confirm']);
  expect(post).not.toHaveBeenCalled();
  expect(text).toContain('BUILT app');
  expect(process.exitCode).toBe(1);
});

test('without --confirm it says what it would publish and sends nothing', async () => {
  const dir = folder({ 'index.html': '<p>', 'assets/a.js': 'x' });
  const text = await run(['publish', dir, '--slug', 'sell']);
  expect(post).not.toHaveBeenCalled();
  expect(text).toContain('Would publish 2 file(s)');
  expect(text).toContain('--confirm');
});

test('--confirm zips the folder, PUTs it to the upload link, then publishes by reference', async () => {
  const dir = folder({ 'index.html': '<p>', 'assets/a.js': 'x', 'logo.png': '\x89PNG' });
  const put = jest.fn().mockResolvedValue({ ok: true, status: 200 });
  (global as any).fetch = put;
  post.mockImplementation(async (url: string) => (url.endsWith('/upload_url')
    ? { data: { ok: true, upload_id: 'a'.repeat(32), upload_url: 'https://store/put?sig=1', headers: { 'Content-Type': 'application/zip' } } }
    : { data: { ok: true, url: 'https://store/company_42/apps/sell/index.html', published_version: 1 } }));
  const text = await run(['publish', dir, '--slug', 'sell', '--confirm']);

  expect(post.mock.calls[0][0]).toBe('/api/v1/agent/app/upload_url');
  const [putUrl, init] = put.mock.calls[0];
  expect(putUrl).toBe('https://store/put?sig=1');
  expect(init.method).toBe('PUT');
  const entries = unzipSync(init.body);
  expect(Object.keys(entries).sort()).toEqual(['assets/a.js', 'index.html', 'logo.png']);

  const [url, body] = post.mock.calls[1];
  expect(url).toBe('/api/v1/agent/app/publish');
  expect(body).toEqual({ slug: 'sell', upload_id: 'a'.repeat(32), confirm: true });   // a temp folder is no git repo: no commit is claimed
  expect(body.files).toBeUndefined(); // the bytes never ride in the API call
  expect(text).toContain('Live: https://store/company_42/apps/sell/index.html');
});

test('a failed upload stops before publishing', async () => {
  const dir = folder({ 'index.html': '<p>' });
  (global as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 });
  post.mockResolvedValue({ data: { ok: true, upload_id: 'b'.repeat(32), upload_url: 'https://s', headers: {} } });
  const text = await run(['publish', dir, '--slug', 'sell', '--confirm']);
  expect(post).toHaveBeenCalledTimes(1);
  expect(text).toContain('Upload failed (403)');
  expect(process.exitCode).toBe(1);
});

test('an answer with no upload link never reaches the network and says so plainly', async () => {
  // The customer's failure was fetch(undefined): "Failed to parse URL from undefined".
  // Whatever the server sends, a missing link must stop here with a sentence.
  const dir = folder({ 'index.html': '<p>' });
  const put = jest.fn();
  (global as any).fetch = put;
  post.mockResolvedValue({ data: { ok: true, something_else: 1 } });
  const text = await run(['publish', dir, '--slug', 'sell', '--confirm']);
  expect(put).not.toHaveBeenCalled();
  expect(post).toHaveBeenCalledTimes(1);
  expect(text).toContain('did not hand back an upload link');
  expect(text).not.toContain('undefined');
  expect(process.exitCode).toBe(1);
});

test('a build over the size limit is refused before it is uploaded, with both sizes', async () => {
  // The same customer's first two builds were 27.4 MB against a 25 MB limit; the dry
  // run had said "would publish". The limit rides on the upload answer (max_bytes).
  const dir = folder({ 'index.html': '<p>', 'big.bin': 'x'.repeat(4096) });
  const put = jest.fn();
  (global as any).fetch = put;
  post.mockResolvedValue({ data: { ok: true, upload_id: 'e'.repeat(32), upload_url: 'https://s', headers: {}, max_bytes: 16 } });
  const text = await run(['publish', dir, '--slug', 'sell', '--confirm']);
  expect(put).not.toHaveBeenCalled();
  expect(post).toHaveBeenCalledTimes(1);          // publish is never called
  expect(text).toContain('the limit is');
  expect(text).toContain('Nothing was sent');
  expect(process.exitCode).toBe(1);
});

test('a refusal from the server is shown with its way forward and exits 1', async () => {
  const dir = folder({ 'index.html': '<p>' });
  (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
  post.mockImplementation(async (url: string) => (url.endsWith('/upload_url')
    ? { data: { ok: true, upload_id: 'c'.repeat(32), upload_url: 'https://s', headers: {} } }
    : { data: { ok: false, error: '1 file(s) did not pass the safety check.', next: 'Remove them.' } }));
  const text = await run(['publish', dir, '--slug', 'sell', '--confirm']);
  expect(text).toContain('did not pass the safety check');
  expect(text).toContain('Remove them.');
  expect(process.exitCode).toBe(1);
});

import { inspectRepo, workflowYaml } from '../../commands/app';

const PKG = '{"scripts":{"build":"vite build"}}';
/** `tracked` stands in for git: the listed paths are committed. */
const inGit = (...paths: string[]) => (rel: string) => paths.includes(rel);

describe('solid app github — reads the repo, asks nobody', () => {
  test('TRADE NOW\'S SHAPE: app/ + pnpm + docs/ rebuilt by their own workflow → publish AFTER that workflow', () => {
    // 2026-10-03. Publishing docs/ on push would have run before their rebuild landed —
    // always one version behind — and a bot's commit never fires a second push run.
    const repo = folder({
      'app/package.json': '{"scripts":{"build":"vite build"},"packageManager":"pnpm@11.9.0"}',
      'app/pnpm-lock.yaml': '',
      'docs/index.html': '<p>',
      '.github/workflows/deploy.yml':
        'name: Build demo\non:\n  push:\n    paths: ["app/**"]\njobs:\n  build:\n    steps:\n      - run: |\n          git add docs solid-embed\n          git push\n',
    });
    const plan = inspectRepo(repo, { tracked: inGit('docs/index.html') });
    expect(plan).toMatchObject({ mode: 'after_workflow', folder: 'docs', appDir: 'app', manager: 'pnpm', problems: [] });
    expect(plan.after).toEqual({ name: 'Build demo', file: '.github/workflows/deploy.yml' });
    expect(plan.build).toBeNull();                       // their workflow builds; ours must not

    const y = workflowYaml({ slug: 'sell', branch: 'main', plan });
    expect(y).toContain('workflow_run:');
    expect(y).toContain('workflows: ["Build demo"]');
    expect(y).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(y).toContain('ref: main');                    // the HEAD that holds the rebuilt docs/
    expect(y).not.toMatch(/^ {2}push:/m);                // never on push: that is the stale build
    expect(y).not.toContain('pnpm install');
    expect(y).toContain('app publish docs --slug sell --confirm');
  });

  test('a committed folder nothing rebuilds is published as-is, only when it changes', () => {
    const repo = folder({ 'docs/index.html': '<p>', 'package.json': PKG });
    const plan = inspectRepo(repo, { tracked: inGit('docs/index.html') });
    expect(plan).toMatchObject({ mode: 'committed', folder: 'docs', build: null });
    const y = workflowYaml({ slug: 'sell', branch: 'main', plan });
    expect(y).toContain('paths: ["docs/**", ".github/workflows/solid-app-sell.yml"]');
    expect(y).not.toContain('setup-node');
  });

  test('source at the root, npm: built in THEIR Actions, key only as a secret', () => {
    const repo = folder({ 'package.json': PKG, 'package-lock.json': '{}' });
    const plan = inspectRepo(repo, { tracked: inGit() });
    expect(plan).toMatchObject({ mode: 'build', folder: 'dist', appDir: '', manager: 'npm',
      install: 'npm ci', build: 'npm run build' });
    const y = workflowYaml({ slug: 'sell', branch: 'main', plan });
    expect(y).toContain('branches: [main]');
    expect(y).toContain('- run: npm ci');
    expect(y).toContain('- run: npm run build');
    expect(y).not.toContain('working-directory');
    expect(y).toContain('npx -y @solidnumber/cli@latest app publish dist --slug sell --confirm');
    expect(y).toContain('SOLID_API_KEY: ${{ secrets.SOLID_API_KEY }}');
    expect(y).not.toMatch(/sk_[A-Za-z0-9]/); // the key itself never lands in the repo
  });

  test('an app in a subfolder builds there, with its own package manager and Vite outDir', () => {
    const repo = folder({
      'web/package.json': '{"scripts":{"build":"vite build"},"packageManager":"pnpm@10.0.0"}',
      'web/pnpm-lock.yaml': '',
      'web/vite.config.ts': "export default { build: { outDir: 'site' } }",
    });
    const plan = inspectRepo(repo, { tracked: inGit() });
    expect(plan).toMatchObject({ mode: 'build', appDir: 'web', manager: 'pnpm', folder: 'web/site',
      install: 'pnpm install --frozen-lockfile', build: 'pnpm run build' });
    const y = workflowYaml({ slug: 'sell', branch: 'main', plan });
    expect(y).toContain('pnpm/action-setup@v4');
    expect(y).toContain('package_json_file: web/package.json');
    expect((y.match(/working-directory: web/g) || []).length).toBe(2);
    expect(y).toContain('app publish web/site --slug sell');
  });

  test('yarn and bun are read from their lockfiles; no lockfile means npm install', () => {
    expect(inspectRepo(folder({ 'package.json': PKG, 'yarn.lock': '' }), { tracked: inGit() }).install)
      .toBe('yarn install --frozen-lockfile');
    const bun = inspectRepo(folder({ 'package.json': PKG, 'bun.lockb': '' }), { tracked: inGit() });
    expect(bun.install).toBe('bun install --frozen-lockfile');
    expect(workflowYaml({ slug: 's', branch: 'main', plan: bun })).toContain('oven-sh/setup-bun@v2');
    expect(inspectRepo(folder({ 'package.json': PKG }), { tracked: inGit() }).install).toBe('npm install');
  });

  test('--folder and --build given by the caller win over what was found', () => {
    const repo = folder({ 'package.json': PKG, 'package-lock.json': '{}' });
    const plan = inspectRepo(repo, { folder: './public_html/', build: 'make site', tracked: inGit() });
    expect(plan).toMatchObject({ folder: 'public_html', customBuild: 'make site', build: null });
    expect(workflowYaml({ slug: 's', branch: 'main', plan })).toContain('- run: make site');
  });

  test('nothing built and nothing to build is a named problem, not a guess', () => {
    const plan = inspectRepo(folder({ 'README.md': '#' }), { tracked: inGit() });
    expect(plan.folder).toBe('');
    expect(plan.problems[0]).toContain('Pass --folder');
  });

  test('our own earlier workflow is never mistaken for theirs', () => {
    const repo = folder({
      'docs/index.html': '<p>',
      '.github/workflows/solid-app-sell.yml': 'name: Publish sell to Solid#\n# docs\n# git push\n',
    });
    expect(inspectRepo(repo, { tracked: inGit('docs/index.html') }).mode).toBe('committed');
  });

  test('the help tells an agent the exact order and what is always true', () => {
    let help = '';
    appCommand.configureOutput({ writeOut: (t) => { help += t; } });
    appCommand.outputHelp();
    expect(help).toContain('ask the person nothing');
    expect(help).toContain('solid app github --slug <name> --plan --json');
    expect(help).toContain('never pulls from GitHub');
    // page or app: the question, both answers, and why there are two addresses
    expect(help).toContain('does it need its OWN JavaScript to do its job?');
    expect(help).toContain('<company>.solidnumber.com');
    expect(help).toContain('<company>.solidhost.app/<name>/');
    expect(help).toContain("shares the dashboard's sign-in");
    expect(help).toContain('not the App Store');
  });
});


import { buildSource } from '../../commands/app';

describe('what nobody should have to ask us', () => {
  const publishing = (reply: Record<string, unknown>) => {
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    post.mockImplementation(async (url: string) => (url.endsWith('/upload_url')
      ? { data: { ok: true, upload_id: 'd'.repeat(32), upload_url: 'https://s', headers: {} } }
      : { data: reply }));
  };

  test('a publish prints how updates happen and how to send a lead, as the server worded them', async () => {
    const dir = folder({ 'index.html': '<p>' });
    publishing({ ok: true, url: 'https://trade-now.solidhost.app/sell/', published_version: 2,
      keep_it_current: 'This was a ONE-TIME publish. Solid# never pulls',
      send_a_lead: 'await fetch("https://api.solidnumber.com/api/v1/public/apps/trade-now/sell/lead"',
      warnings: ['The app loads from mrishii.github.io'] });
    const text = await run(['publish', dir, '--slug', 'sell', '--confirm']);
    expect(text).toContain('ONE-TIME publish');
    expect(text).toContain('/api/v1/public/apps/trade-now/sell/lead');
    expect(text).toContain('mrishii.github.io');
  });

  test('--hold asks the server to keep the build without making it live, and says how to', async () => {
    const dir = folder({ 'index.html': '<p>' });
    publishing({ ok: true, held: true, held_version: 3, live_version: 2,
      make_it_live: 'Version 3 is kept but NOT live: solid app rollback sell 3 --confirm' });
    const text = await run(['publish', dir, '--slug', 'sell', '--confirm', '--hold']);
    expect(post.mock.calls[1][1]).toMatchObject({ hold: true });
    expect(text).toContain('Kept as version 3');
    expect(text).toContain('solid app rollback sell 3 --confirm');
    expect(text).not.toContain('✓ Live');
  });

  test('in GitHub Actions the commit and the repository ride with the publish', () => {
    expect(buildSource('/nowhere', { GITHUB_SHA: 'A'.repeat(40), GITHUB_REPOSITORY: 'MrIshii/tradenow-sell-page' }))
      .toEqual({ commit: 'a'.repeat(40), repo: 'MrIshii/tradenow-sell-page' });
    expect(buildSource('/nowhere', { GITHUB_SHA: 'not a sha', GITHUB_REPOSITORY: 'no slash' })).toEqual({});
  });

  test('--review writes a workflow whose every build waits for the owner', () => {
    const repo = folder({ 'package.json': PKG, 'package-lock.json': '{}' });
    const plan = inspectRepo(repo, { tracked: inGit() });
    const y = workflowYaml({ slug: 'sell', branch: 'main', plan, review: true });
    expect(y).toContain('app publish dist --slug sell --confirm --hold');
    expect(y).toContain('REVIEW MODE');
    // the file answers, for a later reader, what a developer once had to write to us to ask
    expect(y).toContain('Solid# never pulls from this repository');
    expect(y).toContain('app get sell');
    expect(workflowYaml({ slug: 'sell', branch: 'main', plan })).not.toContain('--hold');
  });
});
