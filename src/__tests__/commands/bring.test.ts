/**
 * `solid bring` — the front door. The folder reading is pure but for the disk,
 * so it runs against a real temp folder.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { bringCommand, describeFolder, listFiles, writeStarter } from '../../commands/bring';

function folder(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'solid-bring-'));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  return root;
}

describe('listFiles', () => {
  it('lists every file, forward-slashed, and skips what a build leaves behind', () => {
    const root = folder({
      'index.html': '<h1>x</h1>', 'src/App.tsx': 'x',
      'node_modules/a/index.js': 'x', '.git/HEAD': 'x',
    });
    expect(listFiles(root)).toEqual(['index.html', 'src/App.tsx']);
  });

  it('stops at the limit', () => {
    const root = folder({ 'a.txt': '1', 'b.txt': '2', 'c.txt': '3' });
    expect(listFiles(root, 2)).toHaveLength(2);
  });
});

describe('describeFolder', () => {
  it('reads the BUILT index.html before the source, because it is what a visitor gets', () => {
    const root = folder({ 'dist/index.html': '<div id="root"></div>', 'src/App.tsx': 'export default 1',
      'package.json': '{"name":"a"}' });
    const d = describeFolder(root);
    expect(d.entry).toBe('dist/index.html');
    expect(d.code).toContain('id="root"');
    expect(d.package_json).toContain('"name"');
  });

  it('falls back to the source entry when nothing is built', () => {
    const d = describeFolder(folder({ 'src/App.tsx': 'export default function App() {}' }));
    expect(d.entry).toBe('src/App.tsx');
  });

  it('finds an app that lives one folder down', () => {
    const d = describeFolder(folder({ 'web/src/App.tsx': 'x', 'web/package.json': '{}', 'README.md': 'x' }));
    expect(d.entry).toBe('web/src/App.tsx');
    expect(d.package_json).toBe('{}');
  });

  it('sends no code when there is no entry file', () => {
    const d = describeFolder(folder({ 'notes.txt': 'x' }));
    expect(d.entry).toBeUndefined();
    expect(d.code).toBeUndefined();
  });
});

describe('bring help', () => {
  it('names the one import and never calls design import the same door', () => {
    let help = '';
    bringCommand.configureOutput({ writeOut: (s) => { help += s; } });
    bringCommand.outputHelp();
    expect(help).toContain('solid nest');
    expect(help).toContain('solid app publish');
    expect(help).not.toMatch(/same door/);
  });
});

describe('writeStarter', () => {
  it('writes the files and never overwrites one that is already there', () => {
    const root = folder({ 'index.html': 'mine' });
    const out = writeStarter(root, { files: { 'index.html': 'starter', 'a/b.css': 'x', '../escape': 'no' } });
    expect(out).toEqual({ written: ['a/b.css'], kept: ['index.html'] });
    expect(fs.readFileSync(path.join(root, 'index.html'), 'utf8')).toBe('mine');
    expect(fs.existsSync(path.join(root, '..', 'escape'))).toBe(false);
  });
});
