/**
 * Every example in help must be a command you can actually run.
 *
 * `fix-commands-resolve.test.ts` guards the strings an ERROR can emit. This
 * guards the strings HELP emits, which is a larger surface and was unguarded:
 * 413 examples live in a `{ cmd, why }` table that nothing verified, alongside
 * the `$ solid ...` prose form that the other test's pattern covers.
 *
 * Two formats, one checked, is how this stayed hidden. `solid company info
 * <id>` is documented in that table, resolves as a command, and answers
 * "error: too many arguments for 'info'. Expected 0 arguments but got 1."
 * Ten examples lied about arity the same way.
 *
 * ⛔ Resolution is NOT enough, and that is this file's whole point. A command
 * can resolve and still reject the arguments its own example shows. We assert
 * both:
 *   1. the command path resolves (borrowed from the sibling test — the Usage
 *      line, never the exit code)
 *   2. the declared arity accepts the number of positional args shown
 *
 * Nothing here touches the network: every check is `--help`, or a read of the
 * Usage line commander prints for the resolved path.
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..');
const CLI_PATH = path.join(ROOT, 'dist', 'index.js');
const SRC = path.join(ROOT, 'src');

interface Example {
  /** Tokens before the first flag, e.g. ["company","info","<id>"] */
  tokens: string[];
  /** Where it came from, so a failure names the file to edit */
  source: string;
  /** The example as written */
  raw: string;
}

/** Every .ts file under src, so a new examples table is covered the day it lands. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      out.push(...sourceFiles(full));
    } else if (entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Tokens of an example, up to the first flag.
 *
 * Everything from the first flag onward is dropped: telling a flag's VALUE
 * from a positional needs that flag's arity, which is not knowable from the
 * text. Dropping the tail costs a little coverage and removes the entire
 * false-positive class.
 */
function leadingTokens(raw: string): string[] | null {
  const at = raw.indexOf('solid ');
  if (at < 0) return null;
  // Examples carry trailing prose: `solid pages list   # every page`. Cut it.
  const body = raw.slice(at + 'solid '.length).split(/\s+#|\s{3,}/)[0];
  // Quoted values are ONE argument: `voice text "Jane Smoke"` passes one, not
  // two. Splitting on whitespace counted the words separately and invented a
  // second positional that was never there.
  const out: string[] = [];
  for (const t of body.trim().match(/"[^"]*"|'[^']*'|\S+/g) ?? []) {
    if (t.startsWith('-')) break;
    out.push(t);
  }
  return out.length ? out : null;
}

/** Collect both example formats from every source file. */
function allExamples(): Example[] {
  const out: Example[] = [];
  for (const file of sourceFiles(SRC)) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);

    // Format A — prose: `$ solid company info`
    for (const m of src.matchAll(/\$ (solid [^\n'"`]+)/g)) {
      const t = leadingTokens(m[1]);
      if (t) out.push({ tokens: t, source: rel, raw: m[1].trim() });
    }
    // Format B — table: { cmd: 'solid company info <id>', why: '...' }
    for (const m of src.matchAll(/cmd:\s*'(solid [^']+)'/g)) {
      const t = leadingTokens(m[1]);
      if (t) out.push({ tokens: t, source: rel, raw: m[1].trim() });
    }
  }
  // Dedupe on the example text; the same one may appear in several files.
  const seen = new Set<string>();
  return out.filter((e) => (seen.has(e.raw) ? false : (seen.add(e.raw), true)));
}

/** commander's help for a path, or '' if it blew up. */
function helpFor(commandPath: string): string {
  try {
    return execSync(`node ${CLI_PATH} ${commandPath} --help`, {
      timeout: 20000,
      env: { ...process.env, HOME: '/tmp/solid-test-home', SOLID_API_KEY: '' },
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString();
  } catch (e: any) {
    return (e.stdout?.toString() || '') + (e.stderr?.toString() || '');
  }
}

/**
 * ⛔ The exit code is not the answer — see the sibling test. `--help` exits 0
 * for a path that does not exist, because commander walks up to the nearest
 * resolvable parent and prints ITS help. The Usage line cannot be faked.
 */
function usageLine(commandPath: string): string | null {
  const first = helpFor(commandPath).split('\n')[0].trim();
  const m = /^Usage: solid (.*)$/.exec(first);
  if (!m) return null;

  // Commander echoes the CANONICAL name and its aliases per segment:
  //   solid subs list      -> "solid subscriptions list|ls [options]"
  //   solid ec active      -> "solid ecommerce|ec [options] [command]"   (parent!)
  // So compare per segment against that segment's alias set. Matching the
  // literal string rejected every aliased command; matching only the first
  // alias accepted the parent fallback, which is the false green this whole
  // file exists to avoid.
  const printed = m[1]
    .split(/\s+/)
    .filter((w) => !w.startsWith('[') && !w.startsWith('<'));
  // Depth + the leaf is the reliable signal.
  //
  // Commander prints aliases inconsistently: a parent shown alone lists them
  // ("solid ecommerce|ec"), but a parent shown with a resolved child prints
  // only its canonical name ("solid payment-links mark-paid"). Comparing every
  // segment therefore rejected valid aliased paths like `paylinks mark-paid`.
  //
  // Depth alone is what catches the fallback: an unresolved child makes
  // commander print the PARENT, which is one segment shorter than asked for.
  // `solid ec active` -> "solid ecommerce|ec" (1 vs 2) is still correctly
  // rejected, and `solid users remove` -> "solid users" likewise.
  const wanted = commandPath.split(/\s+/);
  if (printed.length !== wanted.length) return null;
  const leaf = printed[printed.length - 1].split('|');
  if (!leaf.includes(wanted[wanted.length - 1])) return null;
  return first;
}

/**
 * How many positional arguments does the resolved command accept?
 *
 * Read from the Usage line commander prints, which is generated from the real
 * declaration rather than from prose: `Usage: solid company info [options]`
 * accepts none; `Usage: solid pages get [options] <id>` accepts one.
 */
function declaredArity(usage: string): { min: number; max: number } {
  const after = usage.replace(/^Usage: solid \S+(?: [a-z0-9:_-]+)*/, '').replace('[options]', '');
  const required = (after.match(/<[^>]+>/g) ?? []).length;
  const optional = (after.match(/\[[^\]]+\]/g) ?? []).length;
  const variadic = /\.\.\./.test(after);
  return { min: required, max: variadic ? Infinity : required + optional };
}

const examples = allExamples();

/**
 * The longest prefix of these tokens that commander resolves, and its Usage.
 *
 * This is the whole trick. `solid agent soul sarah` cannot be split lexically —
 * `sarah` and `soul` are both bare words, and only the command tree knows which
 * is a subcommand. So resolve greedily longest-first, exactly as commander
 * does, and whatever is left over is positional. An earlier draft guessed from
 * the token's shape and produced 288 false failures.
 */
const usageCache = new Map<string, string | null>();
function cachedUsage(p: string): string | null {
  if (!usageCache.has(p)) usageCache.set(p, usageLine(p));
  return usageCache.get(p) ?? null;
}

function split(tokens: string[]): { command: string; usage: string; extra: number } | null {
  for (let n = tokens.length; n >= 1; n--) {
    const candidate = tokens.slice(0, n).join(' ');
    // A placeholder is never a command word; do not waste a subprocess on it.
    if (/[<[".\/=]/.test(candidate.split(' ').pop() as string)) continue;
    const usage = cachedUsage(candidate);
    if (usage) return { command: candidate, usage, extra: tokens.length - n };
  }
  return null;
}

describe('help examples', () => {
  beforeAll(() => {
    if (!fs.existsSync(CLI_PATH)) {
      throw new Error(`CLI not built. Run: npm run build\nExpected: ${CLI_PATH}`);
    }
  });

  it('finds examples in both formats', () => {
    // A census: if a refactor moves examples somewhere this test cannot see,
    // the count collapses and that is the failure, not a silent pass.
    expect(examples.length).toBeGreaterThan(300);
  });

  it('every example names a command that resolves', () => {
    const bad = examples
      .filter((e) => split(e.tokens) === null)
      .map((e) => `${e.source}: "${e.raw}"`);
    if (bad.length) {
      throw new Error(
        `${bad.length} help example(s) name no command that resolves.\n` +
          `An agent reading help runs it and gets the parent's help instead.\n\n  ` +
          bad.join('\n  '),
      );
    }
  });

  it('no example passes more positional arguments than the command accepts', () => {
    // Only the UPPER bound. "Requires N, example shows fewer" is usually an
    // abbreviated teaser line, and flagging it buries the real defect.
    const bad: string[] = [];
    for (const ex of examples) {
      const s = split(ex.tokens);
      if (!s) continue; // reported above
      const { max } = declaredArity(s.usage);
      if (s.extra > max) {
        bad.push(
          `${ex.source}: "${ex.raw}"\n      passes ${s.extra} positional(s) but ` +
            `\`solid ${s.command}\` accepts ${max === Infinity ? 'any' : max}\n` +
            `      ${s.usage}`,
        );
      }
    }
    if (bad.length) {
      throw new Error(
        `${bad.length} help example(s) show arguments the command rejects.\n` +
          `This is exactly what "solid company info <id>" did: documented, ` +
          `resolvable, and answers "Expected 0 arguments but got 1".\n\n  ` +
          bad.join('\n  '),
      );
    }
  });
});
