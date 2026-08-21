/**
 * Unit tests for safeJoin in src/commands/dev.ts.
 *
 * `solid dev module pull` writes files whose paths come from the API response,
 * and SOLID_API_URL can point the client at any host. safeJoin pins the
 * invariant: a write target either resolves inside the module directory the CLI
 * created, or it is refused.
 *
 * Pure function tests — no HTTP, no filesystem.
 */
import * as path from 'path';
import { safeJoin } from '../commands/dev';

const ROOT = path.resolve('/tmp/solid-pull-root');

describe('safeJoin — legitimate paths', () => {
  it('joins a plain relative path', () => {
    expect(safeJoin(ROOT, 'backend/routes.py')).toBe(path.join(ROOT, 'backend/routes.py'));
  });

  it('joins a nested path', () => {
    expect(safeJoin(ROOT, 'frontend/components/Widget.tsx'))
      .toBe(path.join(ROOT, 'frontend/components/Widget.tsx'));
  });

  it('allows a dotfile inside the root', () => {
    expect(safeJoin(ROOT, '.gitignore')).toBe(path.join(ROOT, '.gitignore'));
  });

  it('allows a filename merely containing dots', () => {
    expect(safeJoin(ROOT, 'my..module/file.py')).toBe(path.join(ROOT, 'my..module/file.py'));
  });
});

describe('safeJoin — refuses escapes', () => {
  it.each([
    ['../../.zshrc',                 'parent traversal'],
    ['../../../.ssh/authorized_keys','deep traversal'],
    ['a/b/../../../etc/passwd',      'traversal after descent'],
    ['..',                           'bare parent'],
    ['./../../x',                    'traversal behind a dot segment'],
  ])('refuses %s (%s)', (rel) => {
    expect(() => safeJoin(ROOT, rel)).toThrow(/Refusing/);
  });

  it('refuses an absolute posix path', () => {
    expect(() => safeJoin(ROOT, '/etc/passwd')).toThrow(/Refusing/);
  });

  it('refuses a windows drive path', () => {
    expect(() => safeJoin(ROOT, 'C:\\Windows\\System32\\x')).toThrow(/Refusing/);
  });

  it('refuses a backslash traversal', () => {
    expect(() => safeJoin(ROOT, '..\\..\\.zshrc')).toThrow(/Refusing/);
  });

  it('refuses an empty path', () => {
    expect(() => safeJoin(ROOT, '')).toThrow(/Refusing/);
  });

  it('never returns a path outside the root', () => {
    for (const rel of ['../x', '../../x', 'a/../../x']) {
      let out: string | null = null;
      try { out = safeJoin(ROOT, rel); } catch { /* expected */ }
      if (out !== null) {
        expect(out.startsWith(ROOT + path.sep)).toBe(true);
      }
    }
  });
});
