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

import { detectBuild, workflowYaml } from '../../commands/app';

describe('solid app github', () => {
  test('the workflow builds in THEIR Actions and publishes with a key that can only publish apps', () => {
    const y = workflowYaml({ slug: 'sell', folder: 'dist', build: 'npm ci && npm run build', branch: 'main' });
    expect(y).toContain('branches: [main]');
    expect(y).toContain('- run: npm ci && npm run build');
    expect(y).toContain('npx -y @solidnumber/cli@latest app publish dist --slug sell --confirm');
    expect(y).toContain('SOLID_API_KEY: ${{ secrets.SOLID_API_KEY }}');
    expect(y).not.toMatch(/sk_[A-Za-z0-9]/); // the key itself never lands in the repo
  });

  test('a committed build folder is published as-is, with no build step', () => {
    const y = workflowYaml({ slug: 'sell', folder: 'docs', build: null, branch: 'main' });
    expect(y).not.toContain('setup-node');
    expect(y).toContain('app publish docs --slug sell');
  });

  test('detectBuild: committed output needs no build; a package with a build script gets one', () => {
    const committed = folder({ 'docs/index.html': '<p>', 'package.json': '{"scripts":{"build":"vite build"}}' });
    expect(detectBuild(committed, 'docs')).toBeNull();
    const source = folder({ 'package.json': '{"scripts":{"build":"vite build"}}', 'package-lock.json': '{}' });
    expect(detectBuild(source, 'dist')).toBe('npm ci && npm run build');
    const noLock = folder({ 'package.json': '{"scripts":{"build":"vite build"}}' });
    expect(detectBuild(noLock, 'dist')).toBe('npm install && npm run build');
    expect(detectBuild(folder({ 'README.md': '#' }), 'dist')).toBeNull();
  });
});
