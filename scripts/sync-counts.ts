/**
 * sync-counts — one command that makes every advertised number true.
 *
 * ⛔ THE PROBLEM THIS ENDS. The CLI version, the top-level command count and
 * the verb count are duplicated across ~30 places: .well-known discovery JSON,
 * llms.txt / ai.txt, the docs pages, the Owners-Manual, CLAUDE.md. They were
 * hand-copied at release time from a number somebody measured once, so they
 * drifted — on 2026-08-21 the public docs advertised "748 verbs" against a real
 * 863, stale by 115, while "163 commands" happened to still be right. Nobody
 * can tell which of those two is trustworthy by looking, which makes ALL of
 * them untrustworthy.
 *
 * The numbers are measurable. The CLI measures itself:
 *   version  → package.json
 *   commands → the commander tree's top-level entries
 *   verbs    → `solid schema verbs --include-hidden --json`
 *
 * So they are generated here, never typed. `generate-llms.ts` already proved
 * the shape for one file; this does it for the rest.
 *
 * Modes:
 *   ts-node scripts/sync-counts.ts            rewrite every surface in place
 *   ts-node scripts/sync-counts.ts --check    exit 1 if anything is stale
 *                                             (run before a release; CI-safe)
 *
 * ⛔ WHAT IT WILL NOT TOUCH. Point-in-time records — legal registers, sprint
 * status blocks, changelog entries, infrastructure snapshots — state what was
 * true on a date. Rewriting those falsifies a record, so they are excluded by
 * path and the exclusion is deliberate, not an oversight. Marketing pages are
 * excluded too (design is owned elsewhere).
 */
import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..", "..");        // the monorepo root
const CLI = join(__dirname, "..");

interface Counts {
  version: string;
  commands: number;
  verbs: number;
}

function measure(): Counts {
  const version = JSON.parse(readFileSync(join(CLI, "package.json"), "utf8")).version as string;
  const dist = join(CLI, "dist", "index.js");
  if (!existsSync(dist)) {
    throw new Error("dist/index.js missing — run `npm run build` first; this tool measures the BUILT CLI, not the source");
  }
  const env = { ...process.env, SOLID_NO_WIZARD: "1", CI: "1", SOLID_NO_TENANT_WARN: "1" };
  const manifest = JSON.parse(
    execSync(`node "${dist}" schema verbs --include-hidden --json`, { encoding: "utf8", env, maxBuffer: 64 * 1024 * 1024 }),
  );
  const help = execSync(`node "${dist}" --help`, { encoding: "utf8", env });
  const commandsBlock = help.slice(help.indexOf("Commands:"));
  const commands = commandsBlock.split("\n").filter((l) => /^ {2}[a-z]/.test(l)).length;
  return { version, commands, verbs: Number(manifest.count) };
}

/**
 * Every surface that advertises a count.
 *
 * Keep this list in step with
 * Owners-Manual/45-Developer-CLI/VERSION-BUMP-CHECKLIST.md — that file is the
 * human inventory; this array is the executable one.
 */
const SURFACES = [
  "solid-public/public/llms.txt",
  "solid-public/public/llms-full.txt",
  "solid-public/public/solidnumber-llms.txt",
  "solid-public/public/ai.txt",
  "solid-public/public/humans.txt",
  "solid-public/public/robots.txt",
  "solid-public/public/.well-known/ai.txt",
  "solid-public/public/.well-known/agent.json",
  "solid-public/public/.well-known/mcp.json",
  "solid-public/public/.well-known/webmcp.json",
  "solid-public/public/.well-known/ucp.json",
  "solid-public/public/.well-known/ai-plugin.json",
  "solid-public/public/.well-known/anthropic-ai-plugin.json",
  "solid-public/public/.well-known/cli-version.json",
  "solid-public/src/app/docs/cli/page.tsx",
  "solid-public/src/app/docs/cli/layout.tsx",
  "solid-public/src/app/docs/sdks/page.tsx",
  "solid-public/src/app/docs/api/page.tsx",
  "solid-public/src/app/docs/quickstart/page.tsx",
  "solid-public/src/app/ai-index/page.tsx",
  "solid-public/src/components/SolidNumberHead.tsx",
  "solid-public/src/components/footer.tsx",
  "solid-cli/README.md",
  "CLAUDE.md",
];

/**
 * ⛔ EXCLUDED ON PURPOSE — a record of what was true, not a claim about now.
 * The changelog is the clearest case: "v2.15 … 748 verbs" is CORRECT history.
 */
const EXCLUDED = [
  "changelog",            // release history — every entry is a dated record
  "23-Legal/",            // IP register, attorney hand-off
  "99-Active-Sprints/",   // sprint status blocks are dated
  "06-Operations/03-INFRASTRUCTURE-STATE",
  "/research/", "/demo/", "/why-solid/", "/industries/", "/partners/", "/compare/",
];

/**
 * ⛔ ONLY COUNTS THAT ARE UNAMBIGUOUSLY THE CLI'S.
 *
 * The first cut of this matched a bare `\d+ verbs` and promptly rewrote
 * WebMCP's "508 verbs across 5 surfaces" and a dated "82 verbs registered …
 * as of 2026-05-15" into the CLI's verb count — three different measurements
 * flattened into one wrong number, automatically and confidently. That is a
 * WORSE failure than the hand-copying this replaces, because it is fast and
 * looks authoritative. Caught before commit on 2026-08-21 by reading the diff.
 *
 * So every pattern is ANCHORED to CLI context: the counts must appear in the
 * CLI's own paired phrasing ("N commands, M verbs") or beside
 * `@solidnumber/cli`. Anything this tool cannot PROVE is the CLI's is left
 * alone and reported by --check, so a human decides instead of a regex.
 */
function rewrite(text: string, c: Counts): string {
  return text
    // 1. The CLI's paired count phrasing — "163 top-level commands, 748 verbs".
    //    No other metric on the platform uses this shape, and neither number
    //    makes a claim about a PAST version, so both are safe to stamp.
    .replace(/\b\d{2,4}(?= (?:top-level )?commands, \d{2,4} verbs\b)/g, String(c.commands))
    .replace(/(\b\d{2,4} (?:top-level )?commands, )\d{2,4}(?= verbs\b)/g, `$1${c.verbs}`)
    // 2. STRUCTURED version fields only — a JSON/TS key whose whole job is to
    //    name the current version.
    .replace(/("(?:latest|softwareVersion|cli:version)"\s*:\s*")\d+\.\d+\.\d+(?=")/g, `$1${c.version}`)
    .replace(/((?:^|\s)version:\s*')\d+\.\d+\.\d+(?=')/gm, `$1${c.version}`);
}

/**
 * ⛔ WHAT THIS TOOL REFUSES TO TOUCH, AND WHY IT REPORTS INSTEAD.
 *
 * Two traps, both found by reading the diff before committing (2026-08-21):
 *
 *   "508 verbs across 5 surfaces"        — WebMCP's count, not the CLI's.
 *   "from @solidnumber/cli@2.10+"        — a MINIMUM version. Stamping the
 *                                          current one claims a feature needs
 *                                          2.16 when it has worked since 2.10.
 *   "v2.15 ships the Starter Kit"        — a historical claim. 2.16 did not
 *                                          ship it; 2.15 did.
 *
 * A version embedded in prose is usually an ASSERTION ABOUT A VERSION, and no
 * regex can tell that from "install this one". So prose mentions are listed for
 * a human and left alone. Automating them is how a release turns docs into
 * confident fiction.
 */
function needsAHuman(text: string, c: Counts): string[] {
  const out: string[] = [];
  const patterns = [
    /[^\n]{0,50}\b\d{2,4} verbs\b[^\n]{0,30}/g,                    // any other verb count
    /[^\n]{0,40}@solidnumber\/cli@\d+\.\d+(?:\.\d+)?\+?[^\n]{0,40}/g, // prose version mentions
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const hit = m[0].trim();
      if (/commands, \d{2,4} verbs/.test(hit)) continue;            // stamped above
      if (hit.includes(`@solidnumber/cli@${c.version}`)) continue;  // already current
      out.push(hit);
    }
  }
  return out;
}

function main() {
  const check = process.argv.includes("--check");
  const c = measure();
  const stale: string[] = [];
  const unowned: string[] = [];

  for (const rel of SURFACES) {
    if (EXCLUDED.some((x) => rel.includes(x))) continue;
    const path = join(ROOT, rel);
    if (!existsSync(path)) continue;              // a surface may not exist yet
    const before = readFileSync(path, "utf8");
    const after = rewrite(before, c);
    for (const u of needsAHuman(after, c)) unowned.push(`${rel}: ${u}`);
    if (before === after) continue;
    stale.push(rel);
    if (!check) writeFileSync(path, after);
  }

  const head = `CLI v${c.version} · ${c.commands} commands · ${c.verbs} verbs`;
  if (check) {
    if (stale.length) {
      console.error(`✗ ${head} — ${stale.length} surface(s) STALE:`);
      for (const s of stale) console.error(`    ${s}`);
      console.error("  Fix:  npm run sync:counts");
      process.exit(1);
    }
    console.log(`✓ ${head} — every surface current`);
    reportHumanOwned(unowned);
    return;
  }
  if (stale.length) {
    console.log(`→ ${head} — updated ${stale.length} surface(s):`);
    for (const s of stale) console.log(`    ${s}`);
  } else {
    console.log(`✓ ${head} — every surface already current`);
  }
  reportHumanOwned(unowned);
}

/** Never silent: the un-automatable mentions print in BOTH modes, because a
 *  clean "every surface current" that hides them is the same false green this
 *  tool exists to end. */
function reportHumanOwned(unowned: string[]): void {
  if (!unowned.length) return;
  console.log(`\n  ${unowned.length} mention(s) this tool refuses to auto-stamp — a human owns these:`);
  for (const u of unowned.slice(0, 15)) console.log(`    ${u}`);
  if (unowned.length > 15) console.log(`    …and ${unowned.length - 15} more`);
}

main();
