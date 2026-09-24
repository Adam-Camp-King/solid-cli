/**
 * ⛔ THE SUITE NEVER WRITES TO THE DEVELOPER'S REAL ~/.solid.
 *
 * Every module resolves its files from os.homedir() at load time
 * (config.json, cli_history.json, identity.json, mcp-key), and dozens of
 * integration tests spawn `node dist/index.js …` with `...process.env`. Those
 * children inherited the real HOME, so every run appended the smoke commands
 * (`mcp connect gpt`, `mcp connect some-agent-invented-tomorrow`, …) to the
 * real ~/.solid/cli_history.json.
 *
 * Setting process.env.HOME inside a test file does NOT fix that: Jest gives
 * each test file its own copy of process.env, and os.homedir() (libuv) reads
 * the real environment. So HOME is redirected HERE, in globalSetup, which runs
 * in the parent process before any worker is forked — workers, in-band runs
 * and every child process they spawn all resolve the temp home.
 *
 * The real ~/.solid/cli_history.json and config.json are stat'ed (read-only)
 * before and after; globalTeardown fails the run if either changed.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const WATCHED = ['cli_history.json', 'config.json', 'identity.json', 'mcp-key'];

export interface Fingerprint { [file: string]: string }

export function fingerprint(home: string): Fingerprint {
  const out: Fingerprint = {};
  for (const f of WATCHED) {
    const p = path.join(home, '.solid', f);
    try {
      const st = fs.statSync(p);
      out[f] = `${st.size}:${st.mtimeMs}`;
    } catch {
      out[f] = 'absent';
    }
  }
  return out;
}

export default async function globalSetup(): Promise<void> {
  const realHome = process.env.SOLID_TEST_REAL_HOME || os.homedir();
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'solid-cli-test-home-'));
  process.env.SOLID_TEST_REAL_HOME = realHome;
  process.env.SOLID_TEST_TMP_HOME = tmpHome;
  process.env.SOLID_TEST_REAL_SOLID_FP = JSON.stringify(fingerprint(realHome));
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome; // Windows
}
