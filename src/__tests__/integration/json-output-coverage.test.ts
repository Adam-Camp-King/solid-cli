/**
 * Machine-readable output is the contract, so its absence must be a decision.
 *
 * This CLI's primary caller is an agent. A command that can only print prose
 * forces it to scrape, and scraping breaks on a colour change. Most of the
 * surface already emits JSON — the gap was that nothing recorded WHICH commands
 * deliberately do not, so a new prose-only command looked exactly like an
 * oversight and neither got fixed.
 *
 * The allowlist below is the decision, written down. Adding a command file
 * without `--json` fails this test, and the fix is either to support it or to
 * add the file here with a reason. Both are fine; silence is not.
 */
import * as fs from 'fs';
import * as path from 'path';

const COMMANDS_DIR = path.join(__dirname, '..', '..', 'commands');

/**
 * Commands whose output is not data, with the reason.
 *
 * ⛔ Add an entry only when JSON would be meaningless — an installer, a
 * long-lived watcher, an interactive prompt, a browser launcher. "Nobody has
 * got to it yet" is not a reason and belongs in a ticket, not here.
 */
const NO_JSON_BY_DESIGN: Record<string, string> = {
  'install.ts': 'installer — writes to a shell, and its output IS the side effect',
  'open.ts': 'launches a browser; there is nothing to serialise',
  'serve.ts': 'long-lived local server; streams a log until interrupted',
  'watch.ts': 'long-lived watcher; streams change events until interrupted',
  'completion.ts': 'emits shell completion scripts, consumed by a shell not a parser',
  'connect.ts': 'interactive OAuth handshake with browser redirects',
  'init.ts': 'scaffolds a directory; the filesystem is the output',
  'ai.ts': 'execs into another tool (Claude/Cursor/Codex) and hands over the tty',
  'docs.ts': 'renders prose documentation for a human reader',
  'how-to.ts': 'renders prose guidance for a human reader',
  'explore.ts': 'interactive browser of the surface',
  'feedback.ts': 'interactive prompt that submits what the human typed',
  'demo.ts': 'scripted walkthrough for a human audience',
  'train.ts': 'interactive training flow',
  'visual.ts': 'opens a visual editor',
  'clone.ts': 'copies a tenant into a directory; the filesystem is the output',
  'import.ts': 'converts local files in place; the filesystem is the output',
  'push.ts': 'syncs local files upward; progress is inherently a stream',
  'pull.ts': 'writes files to disk; the filesystem is the output',
  'export.ts': 'writes an export file; the file is the output',
  'api.ts': 'raw passthrough — it prints the API response verbatim, which is already JSON',
  'droplet.ts': 'infra admin; ssh/exec hand over a remote tty, and the rest is operator prose',
  'webhooks-listen.ts': 'long-lived listener; streams deliveries until interrupted',
};

function commandFiles(): string[] {
  return fs
    .readdirSync(COMMANDS_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'));
}

/** Does this file offer machine-readable output anywhere? */
function supportsJson(file: string): boolean {
  const src = fs.readFileSync(path.join(COMMANDS_DIR, file), 'utf8');
  return /isJsonOutput|printJson|'--json'|"--json"/.test(src);
}

describe('machine-readable output coverage', () => {
  const files = commandFiles();

  it('has command files to check', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('every command either emits JSON or is listed as interactive by design', () => {
    const undeclared = files.filter((f) => !supportsJson(f) && !(f in NO_JSON_BY_DESIGN));
    if (undeclared.length) {
      throw new Error(
        `${undeclared.length} command file(s) emit no machine-readable output and are not ` +
          `declared interactive.\n` +
          `An agent cannot consume these without scraping prose.\n\n` +
          `Either add --json, or add the file to NO_JSON_BY_DESIGN with a reason:\n  ` +
          undeclared.join('\n  '),
      );
    }
  });

  it('the allowlist has no stale entries', () => {
    // A file that gained --json should leave the list, so the list keeps
    // meaning "deliberately prose" rather than drifting into a list of
    // everything anyone ever skipped.
    const stale = Object.keys(NO_JSON_BY_DESIGN).filter(
      (f) => fs.existsSync(path.join(COMMANDS_DIR, f)) && supportsJson(f),
    );
    const missing = Object.keys(NO_JSON_BY_DESIGN).filter(
      (f) => !fs.existsSync(path.join(COMMANDS_DIR, f)),
    );
    expect({ stale, missing }).toEqual({ stale: [], missing: [] });
  });

  it('every allowlist entry gives a reason', () => {
    for (const [file, reason] of Object.entries(NO_JSON_BY_DESIGN)) {
      expect(reason.length).toBeGreaterThan(15);
      expect(file).toMatch(/\.ts$/);
    }
  });
});
