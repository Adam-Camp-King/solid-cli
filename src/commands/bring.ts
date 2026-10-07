/**
 * solid bring — the front door for anyone building or bringing a website or an app.
 *
 *   solid bring                      asks the one question: what are you bringing?
 *   solid bring --bringing nothing   the steps, in order, for starting from scratch
 *   solid bring ./my-project         looks at the folder and says what it is — a page,
 *                                    an app, or something with server code — and what to run
 *
 * ⛔ WHY THIS EXISTS. `solid --help` listed 137 commands and no front door: a designer who
 * said "I'm going to design a website" or "I'm going to make an app" had six import
 * commands to choose from and nothing to say which. Whether something is a page or an app
 * was explained only inside `solid app --help`.
 *
 * This command decides nothing itself. It reads the folder (paths, the entry file's text,
 * package.json) and asks the backend's one authority, the verb `design.intake`
 * (services/design_sources.py, services/intake_verdict.py). Nothing is uploaded but those.
 */
import * as fs from 'fs';
import * as path from 'path';

import chalk from 'chalk';
import { Command } from 'commander';

import { apiClient, handleApiError } from '../lib/api-client';
import { isJsonOutput, printJson } from '../lib/json-output';

const DISPATCH = '/api/v1/ada/cli-dispatch';
const SKIP = new Set(['node_modules', '.git', '.next', '.cache', '.turbo', '.vercel', 'coverage', '.solid']);
const MAX_FILES = 2000;
const MAX_CODE_BYTES = 300_000;
/** Where a build writes index.html, most likely first; then the source's own entry. */
const BUILT = ['index.html', 'docs/index.html', 'dist/index.html', 'build/index.html', 'out/index.html',
  'public/index.html'];
const SOURCE = ['src/App.tsx', 'src/App.jsx', 'src/app/App.tsx', 'src/main.tsx', 'src/main.jsx',
  'src/App.vue', 'src/App.svelte', 'app/page.tsx', 'pages/index.tsx', 'pages/index.jsx', 'index.php'];

/** Every file path under `root`, relative, forward-slashed. Pure but for the disk. */
export function listFiles(root: string, limit = MAX_FILES): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= limit) return;
      if (SKIP.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  walk(root);
  return out;
}

/**
 * What to send for a verdict: the paths, the entry file's text, and package.json.
 * The entry is the BUILT index.html when there is one (it is what a visitor gets), else
 * the main source file. An app that lives one folder down (app/, web/) is found too.
 */
export function describeFolder(root: string): { files: string[]; code?: string; entry?: string; package_json?: string } {
  const files = listFiles(root);
  const has = new Set(files);
  const subdirs = ['', ...Array.from(new Set(files.map((f) => f.split('/')[0]).filter((d) => !d.includes('.'))))];
  const pick = (names: string[]): string | undefined => {
    for (const n of names) {
      for (const d of subdirs) {
        const p = d ? `${d}/${n}` : n;
        if (has.has(p)) return p;
      }
    }
    return undefined;
  };
  const entry = pick(BUILT) ?? pick(SOURCE);
  const pkg = pick(['package.json']);
  const read = (rel?: string) => {
    if (!rel) return undefined;
    try { return fs.readFileSync(path.join(root, rel), 'utf8').slice(0, MAX_CODE_BYTES); } catch { return undefined; }
  };
  return { files, entry, code: read(entry), package_json: read(pkg) };
}

/**
 * The answer for a machine, in the order it is needed.
 *
 * ⛔ WHY (clean-room dry run, 2026-10-06). `design.intake` always returns the catalogue of
 * design tools it knows (16 sources) — and the list envelope repeats it as `items`. So
 * `solid bring <folder> --json` printed ~8 KB of Figma / Wix / Canva TWICE before the one
 * thing asked for: what this folder is and what to run. A reader that stops at 5,000
 * characters never reached the verdict.
 *
 * When the question was about a folder or a named source, the verdict comes FIRST and
 * the catalogue is replaced by a count and the command that prints it. Nothing is hidden:
 * `solid bring --json` with no folder still lists every tool. PURE.
 */
export function shapeIntake(out: Record<string, any>): Record<string, any> {
  const { verdict, start, sources, items, total, page, has_more, ...rest } = out;
  void total; void page; void has_more;
  const catalogue = Array.isArray(sources) ? sources : Array.isArray(items) ? items : null;
  if (!verdict && !start) {
    // No folder, no "bringing": the question IS "what can I bring" — the catalogue, once.
    return { ...rest, ...(catalogue ? { sources: catalogue } : {}) };
  }
  return {
    ...(typeof out.ok === 'boolean' ? { ok: out.ok } : {}),
    ...(verdict ? { verdict, next: verdict.next ?? rest.next } : {}),
    ...(start ? { start } : {}),
    ...Object.fromEntries(Object.entries(rest).filter(([k]) => k !== 'ok' && !(verdict && k === 'next'))),
    ...(catalogue ? {
      sources_omitted: `${catalogue.length} design tools and builders are known. `
        + 'Run `solid bring --json` (no folder) to list them.',
    } : {}),
  };
}

function show(out: Record<string, any>): void {
  const v = out.verdict;
  if (v) {
    console.log(chalk.bold(v.in_plain_words));
    for (const why of v.because || []) console.log(chalk.dim(`  · ${why}`));
    if (v.server_code?.length) console.log(chalk.yellow(`  ${v.instead_of_a_server}`));
    if (v.if_the_site_is_live) console.log(`  ${v.if_the_site_is_live.why}`);
    if (v.next?.cli) console.log(`\nNext:  ${chalk.cyan(v.next.cli)}`);
    if (v.next?.needs) console.log(chalk.dim(`  ${v.next.needs}`));
    if (v.next?.then) console.log(chalk.dim(`  ${v.next.then}`));
  }
  const s = out.start;
  if (s) {
    console.log(chalk.bold(`\n${s.says}`));
    (s.steps || []).forEach((step: string, n: number) => console.log(`  ${n + 1}. ${step}`));
  }
  const q = out.what_are_you_bringing;
  if (q && !v && !s) {
    console.log(chalk.bold(q.ask));
    for (const [key, says] of Object.entries(q.answers || {})) {
      console.log(`  ${chalk.cyan(`solid bring --bringing ${key}`.padEnd(32))} ${says}`);
    }
    console.log(`  ${chalk.cyan('solid bring <folder>'.padEnd(32))} I have files — tell me what they are`);
  }
  if (out.how && !s) console.log(`\n${out.how}`);
  const starters = out.starters as Record<string, any> | undefined;
  if (starters && !out._written) {
    for (const kind of Object.keys(starters)) {
      console.log(chalk.dim(`\nA working ${kind} to copy:  solid bring --bringing ${s?.bringing ?? kind} --starter ${kind} --out ./${kind === 'app' ? 'my-app' : 'my-page'}`));
    }
  }
}

/**
 * Write one starter's files into `dir`. Refuses to overwrite: a starter is for an
 * empty start, and a file already there is someone's work.
 */
export function writeStarter(dir: string, starter: { files?: Record<string, string> }): { written: string[]; kept: string[] } {
  const written: string[] = [];
  const kept: string[] = [];
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, body] of Object.entries(starter.files || {})) {
    if (rel.includes('..') || path.isAbsolute(rel)) continue;
    const file = path.join(dir, rel);
    if (fs.existsSync(file)) { kept.push(rel); continue; }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    written.push(rel);
  }
  return { written, kept };
}

export const bringCommand = new Command('bring')
  .description('START HERE to build or bring a website or an app: asks what you are bringing, or reads a folder and says what it is')
  .argument('[source]', 'A folder to look at, or a design link / tool name (e.g. "Figma Make")')
  .option('--bringing <what>', 'nothing | design | site | app — the steps, in order, for that')
  .option('--starter <kind>', 'page | app — write a working starter (use with --out)')
  .option('--out <dir>', 'Where --starter writes its files', '.')
  .option('--json', 'Output JSON')
  .action(async (source: string | undefined, opts) => {
    const json = isJsonOutput(opts);
    const args: Record<string, unknown> = {};
    if (opts.bringing) args.bringing = String(opts.bringing);
    // A starter comes with the steps for what is being brought; asking for one says which.
    if (opts.starter && !opts.bringing) args.bringing = opts.starter === 'app' ? 'app' : 'site';
    if (source) {
      const abs = path.resolve(source);
      if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
        const d = describeFolder(abs);
        if (!d.files.length) {
          const message = `Nothing in ${source} to look at.`;
          if (json) printJson({ ok: false, error: message }); else console.error(chalk.red(`✗ ${message}`));
          process.exitCode = 1;
          return;
        }
        Object.assign(args, { files: d.files, ...(d.code ? { code: d.code } : {}),
          ...(d.package_json ? { package_json: d.package_json } : {}) });
        if (!json && d.entry) console.log(chalk.dim(`Read ${d.files.length} file path(s) and ${d.entry}`));
      } else {
        args.source = source;      // a link or a tool's name
      }
    }
    try {
      const res = await apiClient.post(DISPATCH, { verb: 'design.intake', args });
      const out = ((res.data as any)?.result ?? res.data) as Record<string, any>;
      if (opts.starter) {
        const starter = out.starters?.[String(opts.starter)];
        if (!starter) {
          const message = `No "${opts.starter}" starter. Ask for page or app.`;
          if (json) printJson({ ok: false, error: message }); else console.error(chalk.red(`✗ ${message}`));
          process.exitCode = 1;
          return;
        }
        const res2 = writeStarter(path.resolve(String(opts.out)), starter);
        if (json) return printJson({ ok: true, ...res2, rules: starter.rules, then: starter.then });
        for (const f of res2.written) console.log(chalk.green(`  ✓ ${path.join(String(opts.out), f)}`));
        for (const f of res2.kept) console.log(chalk.yellow(`  · ${f} is already there — left alone`));
        console.log('');
        (starter.rules || []).forEach((r: string) => console.log(`  · ${r}`));
        if (starter.then?.cli) console.log(`\nThen:  ${chalk.cyan(starter.then.cli)}`);
        return;
      }
      if (json) return printJson(shapeIntake(out));
      show(out);
    } catch (error) {
      const message = handleApiError(error).message;
      if (json) printJson({ ok: false, error: message });
      else {
        console.error(chalk.red(`✗ ${message}`));
        console.error(chalk.dim('  Signed in? solid auth login. The rule itself is in: solid app --help'));
      }
      process.exitCode = 1;
    }
  });

bringCommand.addHelpText('after', `
A working file to copy, wired the right way from line one:
  solid bring --starter page --out ./my-page    one HTML file, the owner's editable spots marked
  solid bring --starter app --out ./my-app      an app that shows the brand and sends leads

For an AI agent: run "solid bring <folder> --json" FIRST when someone has files, and
"solid bring --bringing nothing --json" when they are starting from scratch. The reply names
the exact next command. Do not ask the person whether it is a page or an app — the folder says.

Which import command? One: "solid nest <file|folder|url>" — it previews, builds and places the
page, scores it against the original, and can be rolled back. The others are narrower:
"solid ant import" is the same import one step at a time; "solid import" works offline and only
writes a local blocks file; "solid design import" converts HTML to blocks with no import record.
An app is not imported: "solid app publish" / "solid app github".
`);
