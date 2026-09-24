/**
 * scripts/sync-counts.ts counts top-level commands from the command index,
 * never from `--help` text. Counting help lines after "Commands:" also
 * counted the after-help tour's example rows, so the published figure was
 * 172 against 135 registered commands (2.24.5).
 */
import { existsSync } from 'fs';
import { join } from 'path';
import { commandsFromIndex, countCommands } from '../lib/command-count';

describe('sync-counts — command count', () => {
  it('reads the count from the command index', () => {
    const raw = JSON.stringify({ schema: 'solid:command-index/v1', commands: 3, names: ['a', 'b', 'c'] });
    expect(commandsFromIndex(raw)).toBe(3);
  });

  it('refuses an index that disagrees with itself', () => {
    const raw = JSON.stringify({ schema: 'solid:command-index/v1', commands: 4, names: ['a', 'b', 'c'] });
    expect(() => commandsFromIndex(raw)).toThrow(/disagrees/);
  });

  it('refuses output that is not the index', () => {
    expect(() => commandsFromIndex(JSON.stringify({ hello: 1 }))).toThrow(/command index/);
  });

  const dist = join(__dirname, '..', '..', 'dist', 'index.js');
  (existsSync(dist) ? it : it.skip)('agrees with program.commands in the built CLI', () => {
    const env = { ...process.env, SOLID_NO_WIZARD: '1', CI: '1', SOLID_NO_TENANT_WARN: '1' };
    const n = countCommands(dist, env);
    expect(n).toBeGreaterThan(50);
    // The help-text tour lines ("  solid inbox  …") are not commands; the
    // index names none of them.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execSync } = require('child_process');
    const names: string[] = JSON.parse(
      execSync(`node "${dist}"`, { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }),
    ).names;
    expect(names).not.toContain('solid');
    expect(names.length).toBe(n);
  });
});
