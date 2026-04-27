/**
 * `solid completion` — regression tests for shell-script generation.
 *
 * Generated scripts must parse cleanly under the target shell. The original
 * generator escaped apostrophes with `\'` which is wrong inside zsh/bash
 * single-quoted strings (where `\` is literal), so descriptions like
 * `company's context` produced syntactically invalid scripts.
 *
 * These tests run against dist/ so the spawned CLI sees the same registered
 * tree a real install would.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const distEntry = path.join(__dirname, '..', '..', '..', 'dist', 'index.js');
const distExists = fs.existsSync(distEntry);
const describeOrSkip = distExists ? describe : describe.skip;

function generate(flag: '--bash' | '--fish' | '--zsh' | null): string {
  const args = ['completion'];
  if (flag) args.push(flag);
  const r = spawnSync(process.execPath, [distEntry, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, SOLID_SKIP_VERSION_CHECK: '1' },
  });
  if (r.status !== 0) throw new Error(`completion ${flag ?? ''} failed: ${r.stderr}`);
  return r.stdout;
}

function shellAvailable(bin: string): boolean {
  return spawnSync(bin, ['-c', 'true'], { encoding: 'utf-8' }).status === 0;
}

describeOrSkip('solid completion — generated script parses', () => {
  it('zsh script parses without error (apostrophes escaped correctly)', () => {
    const script = generate(null);
    expect(script).toContain('_solid()');

    // Sanity: the description with an apostrophe must NOT use the broken `\'`
    // escape, which would terminate the single-quoted string early.
    expect(script).not.toMatch(/company\\'s/);

    if (!shellAvailable('zsh')) {
      // Skip the live parse if zsh isn't on the PATH (unlikely on darwin/linux).
      return;
    }

    // Write to a temp file and ask zsh to parse it without executing.
    // `zsh -n` = syntax check only.
    const tmp = path.join(os.tmpdir(), `solid-completion-${process.pid}.zsh`);
    fs.writeFileSync(tmp, script);
    try {
      const r = spawnSync('zsh', ['-n', tmp], { encoding: 'utf-8' });
      expect(r.stderr).toBe('');
      expect(r.status).toBe(0);
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it('bash script parses without error', () => {
    const script = generate('--bash');
    expect(script).toContain('_solid_completions');

    if (!shellAvailable('bash')) return;

    const tmp = path.join(os.tmpdir(), `solid-completion-${process.pid}.bash`);
    fs.writeFileSync(tmp, script);
    try {
      const r = spawnSync('bash', ['-n', tmp], { encoding: 'utf-8' });
      expect(r.stderr).toBe('');
      expect(r.status).toBe(0);
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});
