/**
 * `solid nest <folder>` — the site a designer handed over, every page of it.
 *
 * ⛔ A folder used to fall through to "raw code": the CLI sent the PATH STRING to
 * the server as if it were the site's HTML.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('../lib/api-client', () => ({
  apiClient: { post: jest.fn() },
  handleApiError: jest.fn((e: Error) => ({ message: e.message })),
}));

import { apiClient } from '../lib/api-client';
import { detectSource, readFolder } from '../commands/nest-helpers';

function site(): string {
  // Named like a domain on purpose: it must still read as a FOLDER, not a URL.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nest-')) ;
  const dir = path.join(root, 'showerpros.com');
  fs.mkdirSync(path.join(dir, 'services'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'img'));
  fs.mkdirSync(path.join(dir, 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<a href="about.html">About</a>');
  fs.writeFileSync(path.join(dir, 'about.html'), '<h1>About</h1>');
  fs.writeFileSync(path.join(dir, 'services', 'index.html'), '<h1>S</h1>');
  fs.writeFileSync(path.join(dir, 'style.css'), 'h1{color:red}');
  fs.writeFileSync(path.join(dir, 'img', 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(dir, '.DS_Store'), 'x');
  fs.writeFileSync(path.join(dir, 'node_modules', 'x', 'index.js'), 'x');
  return dir;
}

describe('folder intake', () => {
  it('a folder is a folder, even when it is named like a domain', () => {
    expect(detectSource(site())).toBe('folder');
  });

  it('reads relative POSIX paths, text as text, binaries as base64, and names what it skipped', () => {
    const read = readFolder(site());
    const byPath = Object.fromEntries(read.files.map((f) => [f.path, f]));
    expect(Object.keys(byPath).sort()).toEqual(
      ['about.html', 'img/logo.png', 'index.html', 'services/index.html', 'style.css']);
    expect(byPath['style.css'].encoding).toBeUndefined();
    expect(byPath['img/logo.png'].encoding).toBe('base64');
    expect(read.htmlFiles.sort()).toEqual(['about.html', 'index.html', 'services/index.html']);
    expect(read.skipped.map((s) => s.path).sort()).toEqual(['.DS_Store', 'node_modules']);
  });

  it('imports every page, then builds each without overriding its slug or home type', async () => {
    const post = apiClient.post as jest.Mock;
    post.mockReset();
    post.mockImplementation(async (url: string, body: any) => {
      if (url === '/api/v1/agent/nest/import') {
        expect(body.all_pages).toBe(true);
        expect(body.files.length).toBe(5);
        return { data: { ok: true, status: 'preview', pages: [
          { file: 'index.html', ok: true, import_id: 'ant_1', url: '/' },
          { file: 'about.html', ok: true, import_id: 'ant_2', url: '/about' },
        ] } };
      }
      expect(url).toBe('/api/v1/cli/ant/execute');
      expect(body.modifications.destination.page_type).toBeUndefined();
      return { data: { status: 'completed', created: { page: { url: `/${body.import_id}` } } } };
    });
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const { nestCommand } = await import('../commands/nest');
    await nestCommand.parseAsync(['node', 'nest', site(), '--type', 'landing', '--json']);
    const out = JSON.parse(log.mock.calls.map((c) => c[0]).find((l: string) => l.startsWith('{')));
    log.mockRestore();
    expect(out.imported).toBe(2);
    expect(post.mock.calls.filter((c) => c[0] === '/api/v1/cli/ant/execute').map((c) => c[1].import_id))
      .toEqual(['ant_1', 'ant_2']);
  });
});
