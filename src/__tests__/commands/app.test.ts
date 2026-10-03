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
jest.mock('../../lib/api-client', () => ({
  apiClient: { post: (...a: unknown[]) => post(...a) },
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
    for (const k of ['confirm', 'json', 'root', 'name', 'slug']) pub.setOptionValue(k, undefined);
    await appCommand.parseAsync(args, { from: 'user' });
  } finally {
    log.mockRestore(); err.mockRestore(); write.mockRestore();
  }
  return out.join('\n');
}

beforeEach(() => { post.mockReset(); process.exitCode = 0; });
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
  expect(body).toEqual({ slug: 'sell', upload_id: 'a'.repeat(32), confirm: true });
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
  });
});
