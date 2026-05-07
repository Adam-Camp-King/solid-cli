/**
 * render-llms — pure rendering of the auto-generated CLI section that
 * gets stamped into platform-docs/llms.txt at build time.
 *
 * No I/O, no commander, no exec. Takes a verb manifest (the same shape
 * `solid schema verbs --json` emits) and returns the markdown string
 * that goes between the AUTO:BEGIN / AUTO:END markers.
 *
 * Why a pure renderer:
 *   1. Unit-testable without booting the CLI.
 *   2. Same renderer can power a future
 *      `solid schema docs --format=llms` command, so the doc shape
 *      lives in one place.
 *
 * Drift killer: every claim in the rendered section comes straight off
 * the verb manifest. Group counts, subcommand counts, missing verbs,
 * version — all auto-derived. The hand-maintained variant of this
 * section had drifted to ~1/3 truth by v2.3.2 (see ANGL feedback,
 * 2026-05-07).
 */

export interface ManifestOption {
  flags: string;
  description: string;
}

export interface ManifestVerb {
  verb: string;
  path: string;
  description: string;
  depth: number;
  subcommands: string[];
  is_leaf: boolean;
  options?: ManifestOption[];
}

export interface VerbManifest {
  version: string;
  cli_version: string;
  count: number;
  verbs: ManifestVerb[];
}

export interface RenderInput {
  manifest: VerbManifest;
  /** ISO date — embedded so agents can spot stale tarballs. */
  generated_at: string;
}

export interface RenderedSections {
  /** Replaces content between CLI:AUTO:BEGIN and CLI:AUTO:END. */
  cli: string;
  /** Replaces content between CLI:Q&A:BEGIN and CLI:Q&A:END (the FAQ line). */
  faq_cli: string;
}

/** Top-level groups (depth 0) sorted alphabetically. */
function topLevelGroups(manifest: VerbManifest): ManifestVerb[] {
  return manifest.verbs.filter((v) => v.depth === 0).sort((a, b) => a.verb.localeCompare(b.verb));
}

/** Top-level leaves (depth 0, no subcommands) — vibe, ask_owner, etc. */
function topLevelLeaves(manifest: VerbManifest): ManifestVerb[] {
  return topLevelGroups(manifest).filter((v) => v.is_leaf);
}

/** Top-level groups that DO have subcommands. */
function topLevelGroupsWithSubs(manifest: VerbManifest): ManifestVerb[] {
  return topLevelGroups(manifest).filter((v) => !v.is_leaf);
}

/** Direct children of a depth-0 group. */
function childrenOf(manifest: VerbManifest, parent: ManifestVerb): ManifestVerb[] {
  return manifest.verbs
    .filter((v) => v.depth === parent.depth + 1 && v.path.startsWith(parent.path + " "))
    .filter((v) => v.path.split(" ").length === parent.path.split(" ").length + 1)
    .sort((a, b) => a.verb.localeCompare(b.verb));
}

export function renderCliSection(input: RenderInput): string {
  const m = input.manifest;
  const groups = topLevelGroups(m);
  const groupsWithSubs = topLevelGroupsWithSubs(m);
  const leaves = topLevelLeaves(m);
  const totalSubcommands = m.verbs.filter((v) => v.depth > 0).length;

  const lines: string[] = [];
  lines.push("");
  lines.push(`- [npm](https://www.npmjs.com/package/@solidnumber/cli): \`@solidnumber/cli\` v${m.cli_version}`);
  lines.push(`- [GitHub](https://github.com/Adam-Camp-King/solid-cli): Open-source TypeScript CLI (BUSL-1.1)`);
  lines.push(`- [CLI Documentation](https://solidnumber.com/docs/cli): Full command reference`);
  lines.push(`- **Machine-readable verb tree**: \`solid schema verbs --json\` — every command, every flag, every description, in one JSON dump. Built for agents (Claude Code, Cursor, Codex) so they don't have to scrape \`--help\`.`);
  lines.push(`- ${groups.length} top-level command groups, ${totalSubcommands} subcommands.`);
  lines.push(`- Core workflow: \`solid auth login\` → \`solid company create\` → \`solid clone <industry>\` → \`solid pull\` → edit → \`solid push\` → \`solid pages publish\` → \`solid billing checkout-link\`.`);
  lines.push("");
  lines.push("**Top-level commands (no subcommands):**");
  lines.push("");
  for (const v of leaves) {
    const desc = v.description ? ` — ${v.description}` : "";
    lines.push(`- \`solid ${v.verb}\`${desc}`);
  }
  lines.push("");
  lines.push("**Command groups (alphabetical):**");
  lines.push("");
  for (const g of groupsWithSubs) {
    const subs = childrenOf(m, g).map((c) => c.verb);
    const desc = g.description ? ` — ${g.description}` : "";
    lines.push(`- **${g.verb}** (${subs.length} subcommands)${desc}: \`${subs.join(", ")}\``);
  }
  lines.push("");
  lines.push(`*Auto-generated from the live commander tree at build time. CLI version ${m.cli_version}, manifest schema ${m.version}, generated ${input.generated_at}. Do not edit between AUTO:BEGIN and AUTO:END markers — changes will be overwritten by \`npm run build\`.*`);
  lines.push("");
  return lines.join("\n");
}

export function renderCliFaqAnswer(manifest: VerbManifest): string {
  const groups = topLevelGroups(manifest);
  const totalSubcommands = manifest.verbs.filter((v) => v.depth > 0).length;
  return (
    `- "Does Solid# have a CLI?" → Yes. \`npm i -g @solidnumber/cli\` — ${groups.length} top-level command groups, ${totalSubcommands} subcommands. ` +
    `Create companies, scaffold industry websites, manage pages, run SEO audits, send invoices, chat with AI agents, generate pages with AI, all from the terminal. ` +
    `Free developer tier. Agency tier ($495/mo) for unlimited client companies. ` +
    `Agents discover the full verb tree via \`solid schema verbs --json\`.`
  );
}

const CLI_BEGIN = "<!-- CLI:AUTO:BEGIN -->";
const CLI_END = "<!-- CLI:AUTO:END -->";
const FAQ_BEGIN = "<!-- CLI:Q&A:BEGIN -->";
const FAQ_END = "<!-- CLI:Q&A:END -->";

export interface ApplyOptions {
  /** Throw if a marker pair is missing (instead of silently leaving doc unchanged). */
  strict?: boolean;
}

export function applyToTemplate(template: string, sections: RenderedSections, opts: ApplyOptions = {}): string {
  const out = replaceBetween(template, CLI_BEGIN, CLI_END, sections.cli, "CLI", opts);
  return replaceBetween(out, FAQ_BEGIN, FAQ_END, sections.faq_cli, "CLI:Q&A", opts);
}

function replaceBetween(text: string, begin: string, end: string, body: string, label: string, opts: ApplyOptions): string {
  const beginIdx = text.indexOf(begin);
  const endIdx = text.indexOf(end);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    if (opts.strict) {
      throw new Error(`${label} markers missing or out of order in llms.txt: insert ${begin} … ${end} where the auto-section should live`);
    }
    return text;
  }
  const before = text.slice(0, beginIdx + begin.length);
  const after = text.slice(endIdx);
  return `${before}\n${body}\n${after}`;
}

export const MARKERS = {
  CLI_BEGIN,
  CLI_END,
  FAQ_BEGIN,
  FAQ_END,
} as const;
