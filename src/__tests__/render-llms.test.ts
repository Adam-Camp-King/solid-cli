/**
 * Unit tests for src/lib/render-llms.ts.
 *
 * Locks the contract that platform-docs/llms.txt's auto-section will:
 *   1. Embed the live CLI version (no v1.7.1-style drift).
 *   2. Show the right top-level group count + total subcommand count.
 *   3. Enumerate every group with its full subcommand list (so agents
 *      stop confidently invoking commands that don't exist).
 *   4. Surface `solid schema verbs --json` as the canonical machine-
 *      readable verb tree.
 *   5. Be idempotent — running the renderer twice on the same template
 *      produces byte-identical output.
 *   6. In strict mode, throw if either marker pair is missing instead
 *      of silently leaving stale content.
 */
import {
  applyToTemplate,
  MARKERS,
  renderCliFaqAnswer,
  renderCliSection,
  VerbManifest,
} from "../lib/render-llms";

function fakeManifest(overrides: Partial<VerbManifest> = {}): VerbManifest {
  return {
    version: "1.0.0",
    cli_version: "2.3.2",
    count: 7,
    verbs: [
      // depth 0 — top-level groups
      { verb: "site", path: "solid site", description: "Manage sites", depth: 0, subcommands: ["list", "create", "info"], is_leaf: false },
      { verb: "pages", path: "solid pages", description: "Manage pages", depth: 0, subcommands: ["list", "update", "publish"], is_leaf: false },
      // depth 0 — top-level leaf
      { verb: "vibe", path: "solid vibe", description: "Natural-language modification", depth: 0, subcommands: [], is_leaf: true },
      // depth 1 — site subcommands
      { verb: "list", path: "solid site list", description: "List sites", depth: 1, subcommands: [], is_leaf: true },
      { verb: "create", path: "solid site create", description: "Create a site", depth: 1, subcommands: [], is_leaf: true },
      { verb: "info", path: "solid site info", description: "Site details", depth: 1, subcommands: [], is_leaf: true },
      // depth 1 — pages subcommands
      { verb: "list", path: "solid pages list", description: "List pages", depth: 1, subcommands: [], is_leaf: true },
      { verb: "update", path: "solid pages update", description: "Update a page", depth: 1, subcommands: [], is_leaf: true },
      { verb: "publish", path: "solid pages publish", description: "Publish a draft", depth: 1, subcommands: [], is_leaf: true },
    ],
    ...overrides,
  };
}

describe("renderCliSection", () => {
  it("embeds the cli_version from the manifest", () => {
    const out = renderCliSection({ manifest: fakeManifest({ cli_version: "9.9.9" }), generated_at: "2026-05-07" });
    expect(out).toContain("`@solidnumber/cli` v9.9.9");
  });

  it("counts top-level groups and total subcommands from the manifest", () => {
    // 3 top-level (site, pages, vibe), 6 subcommands (3 site + 3 pages).
    const out = renderCliSection({ manifest: fakeManifest(), generated_at: "2026-05-07" });
    expect(out).toContain("3 top-level command groups, 6 subcommands.");
  });

  it("lists every subcommand for each group with subs", () => {
    const out = renderCliSection({ manifest: fakeManifest(), generated_at: "2026-05-07" });
    // pages group lists list, publish, update (alphabetical).
    expect(out).toMatch(/\*\*pages\*\* \(3 subcommands\).*?`list, publish, update`/);
    expect(out).toMatch(/\*\*site\*\* \(3 subcommands\).*?`create, info, list`/);
  });

  it("lists top-level leaves (no-subcommand top-levels) in their own section", () => {
    const out = renderCliSection({ manifest: fakeManifest(), generated_at: "2026-05-07" });
    expect(out).toContain("**Top-level commands (no subcommands):**");
    expect(out).toContain("`solid vibe`");
  });

  it("points agents at `solid schema verbs --json`", () => {
    const out = renderCliSection({ manifest: fakeManifest(), generated_at: "2026-05-07" });
    expect(out).toContain("solid schema verbs --json");
  });
});

describe("renderCliFaqAnswer", () => {
  it("uses live counts, not hardcoded numbers", () => {
    const answer = renderCliFaqAnswer(fakeManifest());
    expect(answer).toContain("3 top-level command groups, 6 subcommands");
  });

  it("redirects agents to the machine-readable manifest", () => {
    const answer = renderCliFaqAnswer(fakeManifest());
    expect(answer).toContain("solid schema verbs --json");
  });
});

describe("applyToTemplate", () => {
  const TEMPLATE = [
    "# Solid#",
    "",
    "## CLI",
    "",
    MARKERS.CLI_BEGIN,
    "OLD STALE CONTENT",
    MARKERS.CLI_END,
    "",
    "## FAQ",
    "",
    MARKERS.FAQ_BEGIN,
    '- "Does Solid# have a CLI?" → OLD STALE ANSWER',
    MARKERS.FAQ_END,
    "",
  ].join("\n");

  it("replaces content between markers and preserves everything else", () => {
    const out = applyToTemplate(TEMPLATE, { cli: "NEW CLI BODY", faq_cli: "NEW FAQ BODY" });
    expect(out).toContain("# Solid#"); // header preserved
    expect(out).toContain("NEW CLI BODY");
    expect(out).toContain("NEW FAQ BODY");
    expect(out).not.toContain("OLD STALE CONTENT");
    expect(out).not.toContain("OLD STALE ANSWER");
  });

  it("is idempotent — running twice with the same input produces identical output", () => {
    const once = applyToTemplate(TEMPLATE, { cli: "BODY", faq_cli: "FAQ" });
    const twice = applyToTemplate(once, { cli: "BODY", faq_cli: "FAQ" });
    expect(twice).toBe(once);
  });

  it("throws in strict mode when CLI markers are missing", () => {
    const broken = "# Solid#\n\nno markers anywhere";
    expect(() => applyToTemplate(broken, { cli: "X", faq_cli: "Y" }, { strict: true })).toThrow(/CLI markers missing/);
  });

  it("throws in strict mode when FAQ markers are missing", () => {
    const partial = [
      "# Solid#",
      MARKERS.CLI_BEGIN,
      "...",
      MARKERS.CLI_END,
      "no faq markers",
    ].join("\n");
    expect(() => applyToTemplate(partial, { cli: "X", faq_cli: "Y" }, { strict: true })).toThrow(/CLI:Q&A markers missing/);
  });

  it("non-strict mode silently leaves text unchanged when markers are absent", () => {
    const broken = "no markers";
    expect(applyToTemplate(broken, { cli: "X", faq_cli: "Y" })).toBe(broken);
  });
});
