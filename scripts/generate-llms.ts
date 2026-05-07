/**
 * generate-llms — stamps the auto-section of platform-docs/llms.txt
 * from the live commander verb tree.
 *
 * Sequence:
 *   1. Run the freshly-built CLI: `node dist/index.js schema verbs --include-hidden --json`
 *      (we already have this command — Sprint 1 T1.3).
 *   2. Parse the manifest.
 *   3. Render the CLI section + FAQ line via the pure renderer
 *      in scripts/lib/render-llms.ts.
 *   4. Replace content between the AUTO markers in platform-docs/llms.txt.
 *
 * Wired into `postbuild` so every `npm run build` (and therefore every
 * `npm publish`, since prepublishOnly chains build) re-syncs the docs
 * before the tarball is sealed.
 *
 * Why post-build, not pre-build:
 *   The generator literally invokes the built CLI to read its own
 *   command tree. dist/ has to exist first. Build is fast (~5s) so the
 *   extra step is invisible in the publish flow.
 *
 * Modes:
 *   ts-node scripts/generate-llms.ts           rewrite in place
 *   ts-node scripts/generate-llms.ts --check   exit 1 if rewriting
 *                                              would change anything
 */
import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

import { applyToTemplate, renderCliFaqAnswer, renderCliSection, VerbManifest } from "../src/lib/render-llms";

function readManifest(): VerbManifest {
  const root = join(__dirname, "..");
  const cli = join(root, "dist", "index.js");
  const out = execSync(`node "${cli}" schema verbs --include-hidden --json`, {
    encoding: "utf8",
    env: {
      ...process.env,
      // Belt-and-suspenders: silence first-run wizard, stay non-interactive,
      // ignore any user config the test machine might have, and silence the
      // implicit-tenant warning (this is a build-time introspection call,
      // not real tenant work).
      SOLID_SKIP_FIRST_RUN_WIZARD: "1",
      SOLID_NO_TENANT_WARN: "1",
      NO_COLOR: "1",
      CI: "1",
    },
  });
  return JSON.parse(out) as VerbManifest;
}

function main(): void {
  const root = join(__dirname, "..");
  const docPath = join(root, "platform-docs", "llms.txt");
  const before = readFileSync(docPath, "utf8");
  const manifest = readManifest();

  const generated_at = new Date().toISOString().slice(0, 10);
  const cli = renderCliSection({ manifest, generated_at });
  const faq_cli = renderCliFaqAnswer(manifest);

  const after = applyToTemplate(before, { cli, faq_cli }, { strict: true });

  if (before === after) {
    console.log(`✓ platform-docs/llms.txt — already in sync (CLI v${manifest.cli_version}, ${manifest.count} verbs)`);
    return;
  }

  if (process.argv.includes("--check")) {
    console.error("✗ platform-docs/llms.txt — drift detected");
    console.error("  Run: npm run build  (postbuild auto-syncs the file)");
    process.exit(1);
  }

  writeFileSync(docPath, after, "utf8");
  console.log(`→ platform-docs/llms.txt — regenerated (CLI v${manifest.cli_version}, ${manifest.count} verbs)`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`✗ generate-llms failed: ${message}`);
    process.exit(1);
  }
}
