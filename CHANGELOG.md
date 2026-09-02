# Changelog

All notable changes to `@solidnumber/cli` will be documented in this file.

## [2.17.0] — 2026-09-02

**Deals report their own progress, quizzes actually branch, and the advertised
numbers are generated rather than typed.**

`solid deals` reads the deal and reports where it stands — offer and order
milestones, so an agent can answer "what is left on this?" without stitching
three calls together.

Quiz scoring walks the real branching path instead of a flattened list, so a
quiz that forks on an answer is scored the way a respondent actually experienced
it.

The legacy REST seam now closes wherever a verb exists: one vocabulary, one code
path, and no second way to do the same thing that drifts from the first.

`sync-counts` generates every advertised count instead of trusting a human to
walk twelve surfaces. It stamps the CLI's own paired phrasing and **refuses**
what it should not touch — a minimum version like `@2.10+`, a dated changelog
line, and WebMCP's separate measurement — printing each refusal so a clean run
can never hide one. `prepublishOnly` runs it in check mode, so a stale surface
stops a publish instead of shipping a wrong number.

Verb and command discovery is unchanged and still LIVE: the CLI reads
`/api/v1/agent/verbs` at call time, so a platform-side change reaches you without
a release.

## [2.13.1] — 2026-06-15

**`solid whoami` now shows which company + permission level you're bound to.**

`solid whoami` / `solid auth status` add the bound **company name**, **role**,
and **tier** to the human-readable output (was company id only). The same
fields land in `--json` for agents. Best-effort lookups that never block the
status check.

## [2.7.0] — 2026-05-15

**`solid webmcp ...` + `solid ucp ...` — agent transports go cross-runtime.**

Two verb families that surface Solid#'s in-browser MCP (WebMCP, W3C draft by
Microsoft + Google) and Universal Commerce Protocol (UCP, Google + retail
partners) directly from the CLI. Same JSON-LD verb registry on the backend
serves all three transports (stdio MCP via `@solidnumber/mcp`, WebMCP via
`navigator.modelContext` on every Solid# page, UCP via signed RFC 9421
buyer-agent requests). One registry, three transports — the CLI now drives
all three with symmetric command shapes.

### Added — `solid webmcp ...`

- `solid webmcp manifest [--surface public|tenant-site|dashboard|portal|developer]` —
  dump the WebMCP tool catalog for the current tenant (or a specific surface).
  Defaults to dashboard surface; supports `--json` for agent consumption.
- `solid webmcp verb <name>` — inspect one verb: input schema, annotations,
  platform-canonical IRI (`https://api.solidnumber.com/webmcp/tools/{name}`)
  or tenant-scoped IRI for write verbs.
- `solid webmcp test <tool_name> [--input @payload.json] [--confirm]` —
  dry-run a tool against the backend. Write tools require `--confirm`.
- `solid webmcp execute <tool_name> --input '<json>'` — server-side execute
  with auto-generated idempotency key.
- `solid webmcp invocations [--limit N] [--tool <name>] [--status success|error|denied]` —
  recent WebMCP tool invocations for the current tenant.
- `solid webmcp consent {list|grant|revoke}` — manage the 4-rung consent
  ladder (once / session / permanent / deny) for write verbs.

### Added — `solid ucp ...`

- `solid ucp manifest` — dump the tenant's signed UCP profile from
  `/co/{id}/.well-known/ucp`.
- `solid ucp capabilities` — list capabilities exposed by the current tenant
  (signed envelope, RFC 9421 ES256).
- `solid ucp consent {list|grant|revoke}` — manage UCP consent grants for
  buyer-agent access (owner-only; tied to the same 4-rung ladder).

### Why

Three transports for AI agents to drive Solid# — stdio MCP (`@solidnumber/mcp`
for AI editors), WebMCP (`navigator.modelContext` for in-browser agents), UCP
(signed buyer-agent commerce). Before v2.7 you could see the WebMCP/UCP
verbs by reading the registry source; now the CLI introspects them with the
same shape as `solid schema verbs --json`. Symmetric with how `solid mcp ...`
already worked.

### Platform context

- 31 WebMCP verbs across 5 surfaces (public / tenant-site / dashboard /
  portal / developer). Every solidnumber.com page registers the right
  catalog at mount time; tenant subdomains register their own per-company
  catalog.
- Public discovery file: `https://solidnumber.com/.well-known/webmcp.json`.
- Anonymous manifest endpoint:
  `GET /api/v1/webmcp/public/manifest?company_id={id}&surface={public|tenant-site}`.
- Spec: https://webmachinelearning.github.io/webmcp/ (W3C Web ML Community
  Group, authored by Microsoft + Google).
- Docs: https://solidnumber.com/docs/webmcp + https://solidnumber.com/docs/ucp.

---

## [2.6.0] — 2026-05-12

**`solid qchain ...` — Q-Chain substrate verification for external auditors.**

Four verbs that close the "insurance auditor walks in and verifies our
hash chain without trusting us" loop. JSON-first; the export shape is
the contract `/.well-known/qchain.json` publishes so an auditor can
recompute SHA-256 + verify Ed25519 signatures offline.

### Added

- `solid qchain pubkey` — fetch the platform's verification metadata
  (anonymous, no auth). Returns signer_id, Ed25519 public key, hash +
  signature algorithm spec, canonical-row-fields contract.
- `solid qchain export [--since X --until Y]` — pull this tenant's
  full substrate chain in canonical form. JSON always; the auditor
  recomputes the hash + signature locally.
- `solid qchain verify` — server-side chain walk + sig verify. Sanity
  check before the auditor runs their own offline verification.
- `solid qchain audit-key --label "Acme Insurance — 2026 SOC 2"` —
  mint an API key scoped to `audit:substrate:read` only. Hand to the
  auditor; they can hit export/verify/recent/summary and nothing else.

### Why

Phase 4 substrate attestation (Q-Chain hash chain + Ed25519) is the
audit source of truth for every agent action and observed outcome.
Without these CLI verbs, an auditor (or AI agent diagnosing one) had
to either trust the platform's UI or SSH in and run SQL. Now they
call the CLI, get JSON, walk the chain locally.

Spec: `Owners-Manual/75-Qchain/08-EXTERNAL-AUDITOR-FLOW.md`.

## [2.5.0] — 2026-05-12

**`solid tenant ...` — Tenant Activity Gate introspection from the CLI.**

Four new verbs let agents and operators query the platform-level
compute-budget gate that decides whether per-tenant Celery sweeps fire.
JSON-first; reason codes are stable for pattern-matching.

### Added

- `solid tenant level` — your own company's current activity level
  (HOT/WARM/COLD/DORMANT/BLOCKED), reason code, and all signals.
- `solid tenant gate-debug <company_id>` — admin-only full breakdown for
  any tenant.
- `solid tenant active --min warm` — admin-only list of company IDs
  passing a threshold (same set a Celery fan-out would enqueue).
- `solid tenant allowlist` — admin-only snapshot of the owner allowlist
  (hardcoded IDs + `billing_exempt=true` SOLON partners).

### Why

AI agents diagnosing "why didn't last night's sweep run for tenant X?"
needed a deterministic, JSON-first introspection path. Previously they
had to SSH into production and run a Python REPL. Now they can ask the
CLI and pattern-match on `reason`.

Spec: `Owners-Manual/06-Operations/TENANT-ACTIVITY-GATE/`.

## [2.3.2] — 2026-04-29

**`solid ai` no longer prints "Refusing to write tenant data" when
launched outside a tenant directory.**

### Changed

- `commands/ai.ts::refreshContext` now spawns
  `solid context <flag> --if-tenant` instead of `solid context <flag>`.
  When the AI is launched from `$HOME`, the platform monorepo, or any
  directory without `.solid/manifest.json`, the child context refresh
  silently exits 0 and the AI launches with whatever cached files
  exist — instead of printing the loud guard banner followed by
  "Context refresh failed — launching anyway."

### Why

Same root cause as 2.3.1, second code path. `solid auth login` →
`solid ai` from `$HOME` hit the protected_root guard via the child
context refresh and surfaced the wrong-shape error to the user.
Two regression tests in `__tests__/commands/ai-options.test.ts`
lock in the spawnSync args for all three AI kinds (claude, cursor,
codex).

### Migration

None — purely additive. Re-install: `npm i -g @solidnumber/cli` (or
`npm install -g .` from a local checkout).

## [2.3.1] — 2026-04-29

**`--if-tenant` flag — fixes "Refusing to write tenant data" banner
on every `claude` launch outside a tenant directory.**

### Added

- **`solid context --if-tenant`** — hook-mode flag. Silently exits 0
  when the cwd is not a tenant directory (no `.solid/manifest.json`)
  or sits inside a protected root (platform monorepo, `$HOME`,
  `$HOME/.claude`). Mismatched-company manifests still fail loudly
  because silent skip there would let stale/wrong context flow into
  the next session.

- **`tenantManifestForHook(baseDir, companyId)`** in
  `lib/tenant-guard.ts` — lenient guard for hook contexts. Returns
  `null` (silent no-op) for `protected_root` + `missing`, exits 1
  loud for `mismatch`. Six new unit tests lock in the contract.

### Changed

- **SessionStart hook command** registered by `solid install`:
  `solid context --claude --raw` → `solid context --claude --raw --if-tenant`.
- `solid install` migrates older hooks (`--quiet` pre-2.2, plain
  `--raw` from 2.2–2.3.0) to the current command in place.
- `solid doctor env` recognizes the new command as the pass case;
  older variants drift to `warn` with `solid install` as the hint.

### Why

The 2.2–2.3.0 SessionStart hook printed `Refusing to write tenant
data inside the Solid# platform monorepo` (or `…to your home
directory`) every time a user launched Claude Code outside their
tenant repo. The tenant-guard was doing exactly its job — but the
guard's loud banner is for direct invocation (`solid context --claude`),
not background hooks fired in arbitrary cwds. `--if-tenant` is the
right shape for the hook: refresh when there's a tenant to refresh,
silent otherwise.

Real-world trigger: 2026-04-29, Adam launched `claude` from
`~/Desktop/Solid` (the platform monorepo, Role 1 — never gets
tenant writes) and saw the refusal banner stuck to the splash
screen. Confusing UX that would scare any first-time user.

### Migration

Re-run `solid install`. Existing hooks migrate in place. No tenant
data changes.

**Propagation note (per CLAUDE-CONTEXT-CANONICAL-TRUTH § 650):**
Live — purely additive at the CLI layer. Old hook still works (just
noisy in non-tenant cwds); new hook is silent there. Existing
tenants need no re-seed.

## [2.3.0] — 2026-04-29

**New flag: `solid graph --watch-actions` — live tail of tenant graph
mutations as agents fire.** SSE-driven, tenant-scoped via JWT. Pairs
with the new backend endpoint `/api/v1/cli/graph/watch-actions`.

### Added

- **`solid graph --watch-actions`** — opens a Server-Sent Events
  stream and renders each event as a one-line graph diff:

  ```
  [12:34:56] + Contact #42 (Ada Lovelace)        by Sarah (agent)
  [12:34:58] ~ Service #3 (Drain cleaning)       price: 99 → 119
  [12:35:01] + Order #99 (ORD-2026-099)          fired by chain "New lead followup"
  ```

  Symbols: `+` create (green), `~` update (yellow), `-` delete (red),
  `⚡` fire (cyan). Press Ctrl+C to stop.

- **`--watch-pattern <p>`** — narrows the subscription. Examples:
  `order.*`, `contact.*`, `inventory.*`. Default `*` (all events).

- **`graph-watch-render.ts`** — pure renderer (`formatTime`,
  `payloadLabel`, `payloadId`, `classifyEvent`, `renderWatchEvent`)
  with 31 unit tests covering happy + edge paths.

### Why

The second holy-shit moment after auto-flush. An agent fires an MCP
tool; the operator watches the resulting graph diff stream into the
terminal in real time. Every action is an edge; every response
updates a known node by IRI. Sprint:
`Owners-Manual/99-Active-Sprints/SPRINT-JSONLD-GRAPH-MOAT.md` § A+.3b.

## [2.2.3] — 2026-04-27

**Bug fix — `solid completion install` produced an unparseable zsh script.**

### Fixed

- **Apostrophes in command descriptions broke the generated zsh/bash
  completion script.** The generator escaped `'` with `\'`, which is
  valid in fish but invalid inside zsh/bash single-quoted strings (where
  `\` is literal). The `solid ai` description (`...this company's
  context...`) terminated its string early, surfacing as
  `parse error near '>'` on every shell start after `solid completion
  install`. Each shell now uses its own correct quoting:
  - zsh/bash: `'\''` (close, escaped literal, reopen) — POSIX-portable
  - fish: `\'` (fish's actual single-quote escape) — unchanged

### Added

- **`completion.test.ts`** — runs `zsh -n` / `bash -n` against the
  generated scripts to lock the regression. Catches future quoting bugs
  before they ship.

**Action for existing users:** re-run `solid completion install` (or
`solid setup`) after upgrading. Reload the shell.

## [2.2.2] — 2026-04-27

**Hardening release for the magic-link install path.**
No public CLI surface change — every command behaves the same — but
several quiet correctness + security wins for the `--install-token` flow
shipped in 2.2.0/2.2.1.

### Added

- **`SOLID_INSTALL_TOKEN` env var as the preferred input** for
  `solid setup`. argv (`--install-token <token>`) still works, but
  the CLI now warns when used because tokens on argv are visible in
  process listings (`ps -ef`) for the lifetime of the process.
  install.sh already sets the env var; users + automation should
  prefer it directly.
- **`SOLID_INSTALL_TOKEN_TIMEOUT_MS` env override** for the exchange
  call. Production stays at 30s; tests can drop to 200ms. Clamped to
  `[50ms, 120s]` so a misconfigured shell can't disable the safety.
- **3 regression tests** locking the post-2.2.1 fixes (timeout path,
  token-byte leak prevention, anti-leak prefix phrasing).
- **Cross-repo contract test** — fetches the live `install.sh` and
  asserts (a) it references `SOLID_INSTALL_TOKEN`, (b) it uses the
  same prefix the CLI validates. Network-gated via
  `SOLID_RUN_NETWORK_TESTS=1`. Run on a daily cron — when it fails,
  the cross-repo contract has drifted.

### Changed

- The timeout error message now reflects the actual configured timeout
  instead of a hardcoded "30s" string.

## [2.2.1] — 2026-04-27

**Quiet fixes on top of 2.2.0 — no public CLI behavior change.**
Backfilled CHANGELOG entry; the version was published without one.

### Fixed

- **Hash corruption on partial download** — install scripts now use
  `rm -f` + a `downloaded=false` flag + `[ ! -s "$file" ]` guard so
  a half-downloaded tarball can't pass verification.
- **Indefinite hang on unreachable backend** — `solid setup
  --install-token` now uses `AbortSignal.timeout(30_000)` and
  discriminates `TimeoutError` / `AbortError` from generic network
  errors in the failure detail.
- **User-supplied token bytes leaking into stderr** — bad-prefix
  validation no longer echoes the supplied value; the message reads
  `--install-token must start with "ist_" (got something else)`.
- **Workflow re-run safety** — auto-bump CI uses `git checkout -B` +
  `--force-with-lease` so a re-run on the same tag doesn't choke on
  a stale local branch.

### CI

- Added Node 20 + 22 matrix (dropped 18); `npm audit --omit=dev` +
  `audit-ci`; secret-scan; company-isolation grep;
  version-consistency check (`pkg.version === solid --version`);
  tarball install smoke; and a static dep verifier
  (`scripts/verify-runtime-deps.mjs`) catching the v2.1.0 regression
  class.

## [2.2.0] — 2026-04-26

**Phase 3 of `SPRINT-CLI-ONE-COMMAND-ONBOARDING` — magic-link auth.**
A logged-in dashboard user mints a single-use `ist_*` token at
`/dashboard/install-command`, embeds it in their install command,
and the CLI redeems it for real auth in one paste — no browser
dance, no second login.

### Added

- **`solid setup --install-token <ist_*>`** — redeem an install
  token from the dashboard for a real CLI session. Single-use,
  5-minute TTL, scope-bound to the minting user's company. Skips
  the browser auth step entirely.
- **install.sh + install.ps1** forward the `SOLID_INSTALL_TOKEN`
  env var to `solid setup`, enabling one-paste install + auth:
    ```
    curl -fsSL https://solidnumber.com/install.sh | SOLID_INSTALL_TOKEN=ist_xxx sh
    ```
- **Homebrew tap** at `Solidnumber/homebrew-tap` —
  `brew install solidnumber/tap/cli` is live.
- **Scoop bucket** at `Solidnumber/scoop-bucket` —
  `scoop install solidnumber/solid` is live.
- Auto-bump CI workflows in `.github/workflows/` open PRs to
  both registries on every `v*` tag.

### Notes

- Backend ships two new endpoints (`POST /api/v1/auth/install-token`
  and `/install-token/exchange`). Token exchange is CSRF-exempt
  because the token IS the auth — replays return 401 + audit event.
- winget is in the backlog pending a self-contained Windows binary.
  Tracked at `Owners-Manual/98-Backlog/CLI-WINGET-NATIVE-WINDOWS.md`.

## [2.1.1] — 2026-04-26

**Critical fix.** v2.1.0 was published without `lighthouse` declared
as a runtime dependency — `solid audit a11y|perf|mobile <slug>`
would fail with `Cannot find module 'lighthouse'` for every fresh
install. Caught by deploy gate; v2.1.1 ships the dep correctly.

### Fixed

- **`lighthouse@^13.1.0` now declared in `dependencies`** of
  `@solidnumber/cli/package.json` (was only in the parent monorepo's
  `package.json` due to `npm install` running from the wrong cwd).
  Fresh installs of v2.1.1 now have lighthouse available; v2.1.0
  installs need to upgrade.

### Security

- **Added `overrides.minimatch: ^9.0.7`** to force a non-vulnerable
  `minimatch` in the dep tree. lighthouse → @sentry/node → minimatch
  pulled in `9.0.3` which has 3 ReDoS advisories
  (GHSA-3ppc-4f35-3m26, GHSA-7r86-cg39-jmmj, GHSA-23c5-xmqv-rm74).
  `npm audit --omit=dev`: 0 vulnerabilities.

## [2.1.0] — 2026-04-25

**Agents can now see what they ship.** Closes Phase 1 of
SPRINT-CLI-AGENT-CAN-SHIP — the four highest-leverage visible-gap
fixes. The agent's read graph + write graph + visual outcome are now
inspectable from the CLI without reaching for a browser.

### Added

- **`solid render <slug> --png`** — headless screenshot of any page
  or breakpoint. Returns a path the agent can attach to its reasoning.
  Supports named breakpoints (`mobile`, `tablet`, `desktop`, `full`),
  custom `--viewport WxH`, `--full-page`, `--wait <ms>`, multiple
  breakpoints in one call, `--json` output, `--out <dir>` override.
- **`solid render --install`** — one-time Chromium download (~150MB)
  into `~/.solid/chromium/`. Auto-prompted on first `render`/`audit`
  invocation in interactive contexts; non-interactive contexts (CI,
  agents) get a clear "run `solid render --install`" hint or
  auto-install via `SOLID_AUTO_INSTALL=1`.
- **`solid schema blocks --examples`** — canonical example JSON per
  block type. Agents copy/paste; no inferring from the source. Uses
  domain-aware placeholders (headline → marketing copy, image →
  placehold.co, cta_url → /signup, enums → first sane value). Hand-
  written examples in the schema win over synthesized ones.
  `--type <name>` for one block; `--json` for the full
  `{examples, count}` envelope.
- **`solid audit a11y|perf|mobile <slug>`** — Lighthouse-driven page
  quality scoring on top of `solid seo audit`. Supports
  `--threshold <0..100>` (exit 1 if score below — CI-gateable),
  `--keep-raw`, `--json`. Mobile is a form-factor toggle (throttled
  network + viewport). Reuses the same Chromium that powers
  `solid render`.
- **`Owners-Manual/45-Developer-CLI/CUSTOM-MODULES.md`** — canonical
  agent-friendly answer to "what IS a custom module?" File layout,
  lifecycle, where each piece runs, multi-tenancy guarantee, and a
  side-by-side comparison with industry templates so agents stop
  confusing the two.

### Dependencies

- **`puppeteer-core@^24`** — runtime browser automation (~9 MB).
- **`@puppeteer/browsers@^2`** — programmatic Chromium installer.
- **`lighthouse@^13`** — quality auditing.

Total install footprint added: ~30 MB. Chromium itself is downloaded
on first use (~150 MB), not bundled — most CLI users never run
`render`/`audit` and pay zero browser cost.

`npm audit --omit=dev`: 0 vulnerabilities.

### Sprint context

This is **Phase 1** of SPRINT-CLI-AGENT-CAN-SHIP — the subset
shippable in ~3 days as one cohesive release. Phase 2 covers the
heavier items: `solid serve --proxy`, `solid pages diff --visual`,
`solid pages translate`, `solid pages preview --shareable-url`,
integration manifests + OAuth-test + typed clients, app templates +
data model + marketplace publish. Tracked in
`Owners-Manual/98-Backlog/`.

### Verification

- 921/921 tests green (888 → 921, +33 unit + integration tests).
- Lighthouse extract logic, browser install resolution, viewport
  parsing, breakpoint resolution, URL construction, output filename
  generation, block-example synthesis (placeholders, types, enums,
  hand-written precedence) all covered.
- `solid schema blocks --examples --json` smoke-tested in CI.

## [2.0.1] — 2026-04-25

**A+.7 — top-15 command surface smoke coverage.** Catches the most-
common regression class: "user installs the CLI, types
`solid <cmd> --help`, gets a stack trace instead of help text."

### Added

- **23 new smoke tests** in `__tests__/integration/smoke.test.ts`,
  bringing the suite from 12 → 35 tests:
  - `--help` render checks for kb, services, clone, audit, doctor,
    status, schema, mcp, chains, domains, insights, nest, dev, health,
    context, graph, push (each with hand-picked load-bearing tokens)
  - Real-shape tests: `schema verbs --json` parses + has 50+ verbs;
    `graph --offline` exits 1 with no local file; `graph --query`
    without arg is usage error; `--dry-run` + `--queue` global flags
    are parseable; `completion` works for zsh + bash + fish.
- 858/858 tests green (was 835).

### Why this matters for the S-grade goal

Top-20 CLIs are top-20 partly because they don't crash on
first-touch. Every regression class our existing suite caught
(silent failures, exit codes, secret-scanner false positives,
package-lock drift) was a per-incident fix. Smoke coverage is the
preventive layer: every command's help renders without crashing,
verified on every CI run.

### What's still uncovered

- Mocked-backend E2E tests (assert exit code + stdout shape against
  recorded backend responses) — still ~3-5 days of work for full
  top-20 backend coverage.
- The other ~50 commands without test files (most are low-traffic
  or already covered by lib-level unit tests).

## [2.0.0] — 2026-04-25

**v2.0.0 — agent-ready by default.** The structured JSON error
envelopes shipped behind `SOLID_JSON_V2=1` since 1.10.0 are now ON
by default. Every `--json` invocation gets the structured envelope
without ceremony. Closes the v2.0.0 default-flip on the SPRINT-CLI-V2-
AGENT-READY sprint.

### Breaking change

- **Default `--json` shape now ships the structured error envelope.**
  When a `--json` invocation hits an error, stdout receives:

      {
        "error": {
          "code": "NOT_FOUND",
          "status": 404,
          "message": "...",
          "hint": "...",
          "docs_url": "...",
          "scope": "...",
          "feature": "...",
          "upgrade_to": "...",
          "request_id": "..."
        }
      }

  In 1.x this was opt-in via `SOLID_JSON_V2=1`. AI agents and
  scripts that wanted the structured shape had to set the env var.
  In 2.0.0 it's the default — agents work out of the box.

### Backward compatibility

- **Opt-out: `SOLID_LEGACY_ERRORS=1`** restores the 1.x prose-style
  errors for any script that depends on the old shape.
- **`SOLID_JSON_V2=1` is still honored** (it just no longer matters,
  since the default is already on). Scripts that explicitly opt in
  need no changes.
- **List envelope normalization** (the `{items, total, page}` shape
  added in 1.10) is unchanged — already on by default; opt-out via
  `SOLID_LEGACY_LIST_SHAPES=1` still works.

### Why now

The agent-ready features (T1.1 structured errors, T1.2 dry-run
validation, T1.3 schema verbs, T1.4 list envelopes, T1.5 MCP serve,
T1.6 doctor scopes) shipped in 1.10.0 (2026-04-15) but stayed
gated behind `SOLID_JSON_V2=1`. AI agents that didn't know to set
the env var got the legacy shape. Flipping to default-on closes the
"why does the same CLI behave differently for different agents"
gap and is the single biggest functionality grade unlock — it's
what makes the agent-ready sprint actually visible.

### Verification

- 835/835 tests green. The legacy-prose path now requires explicit
  `SOLID_LEGACY_ERRORS=1`; the new default test covers the flipped
  behavior; backward-compat path with `SOLID_JSON_V2=1` still
  yields the structured envelope.

## [1.26.0] — 2026-04-25

**Full SPARQL 1.1 (online).** Closes A+.5b of SPRINT-JSONLD-GRAPH-MOAT.md.
The CLI's offline BGP matcher handles SELECT + multi-pattern joins;
this release adds `--server` to route to the backend's full SPARQL
endpoint for OPTIONAL, FILTER, property paths, UNION, GROUP BY,
ORDER BY, LIMIT.

### Added

- **`solid graph --query <sparql> --server`** — POSTs the query to
  `/api/v1/cli/context/query`. The backend uses rdflib's full SPARQL
  1.1 implementation. Same output shape as the offline matcher
  (`{vars, bindings}`) so the table render works identically.

### Backend

- New endpoint `POST /api/v1/cli/context/query` shipped in
  `solid-backend` 1dc7306. Tenant scope is JWT-derived (cross-tenant
  query is impossible by construction). Response carries both the
  SPARQL 1.1 spec shape (`head.vars` + `results.bindings` with
  type-tagged terms) AND the CLI-friendly flat shape.

### Verification

- 835/835 CLI tests green (1 new flag-parse test).
- 18/18 backend RDF-suite tests green (7 new SPARQL tests covering
  SELECT, OPTIONAL, FILTER, URI classification, empty/invalid query
  rejection, zero-match).

## [1.25.0] — 2026-04-25

**Auto-detect connectivity.** Closes A+.6b of SPRINT-JSONLD-GRAPH-MOAT.md.
The "holy shit" moment: lose wifi mid-mutation, the CLI auto-queues
without erroring; regain wifi, the next successful mutation auto-replays
the entire queue. No flag, no ceremony — it just works.

### Added

- **Auto-queue on network failure.** When a mutation hits
  `ECONNREFUSED` / `ENOTFOUND` / `ECONNABORTED` / `ECONNRESET` /
  `EAI_AGAIN` / "Network Error", the api-client interceptor
  intercepts the failure and writes the mutation to `.solid/queue/`
  (same JSON-LD format as explicit `--queue` mode). User sees:

      [QUEUED — offline] connection failed; mutation saved.
        Replay automatically on the next online command, or run: solid push --flush

  The mutation's success path runs as if the server returned 202.
  Caller code doesn't need to know.

- **Auto-flush on next online mutation.** A successful mutation
  response proves connectivity. The api-client response interceptor
  drains the queue silently in the background. User sees:

      [auto-flush] replayed 4 queued mutations.

  Re-entry is guarded so the replay's own success doesn't trigger
  another flush attempt. Best-effort: a failure on one queued
  mutation leaves it in queue; the rest still get a chance.

### Excluded

- `/auth/login` and `/auth/refresh` are NOT auto-queued — replaying
  them on reconnect would loop or create duplicate sessions.
- Queue mode (`--queue`) supersedes auto-flush: explicitly armed
  offline mode never triggers auto-replay.

### Verification

- `npm test`: 834/834 green (24 unit tests on the queue alone — 18
  for the file format + 6 for auto-flush behavior).
- Re-entry guard: a recursive auto-flush attempt during an in-flight
  flush returns zero-stats instead of double-dispatching. Verified
  by test.
- Tested edge cases: empty queue is a no-op; failed dispatches stay
  in queue for retry; chronological order preserved.

## [1.24.0] — 2026-04-25

**Offline mutation queue.** Closes A+.6 (happy path) of
SPRINT-JSONLD-GRAPH-MOAT.md. Read side was already offline via
`.claude/solid-context.jsonld`; write side now is too. Field agents,
travel, air-gapped demos.

### Added

- **`--queue` global flag** (also `SOLID_OFFLINE_QUEUE=1` env var) —
  arms offline mode. With it on, every mutation (POST/PUT/PATCH/DELETE)
  is written to `.solid/queue/<utc>-<uuid>.jsonld` instead of being
  dispatched. The mutation file is itself a JSON-LD document
  (`@type: solid:QueuedMutation`) so `solid graph` over the queue
  directory can introspect what's pending.
- **`solid push --flush`** — replay every queued mutation in
  chronological order. Idempotency keys travel with each mutation so
  retries are safe. Successful files are deleted; failed files stay
  in queue for the next attempt.
- **`lib/offline-queue.ts`** — pure module: `enqueue`, `readQueue`,
  `deleteQueued`, `queueSize`, plus the mode-toggle plumbing that
  mirrors the dry-run pattern.

### Behavior

- Reads pass through unchanged (the read side already supports offline).
- Queue mode supersedes dry-run: if both armed, queue wins (dry-run
  is fire-and-forget, queue preserves state for replay).
- The api-client interceptor (same layer as `--dry-run`) intercepts
  before any network I/O, so `--queue` works with zero connectivity.
- File names are `<UTC-timestamp>-<UUID>.jsonld` so a directory
  listing IS chronological order.
- `readQueue` skips malformed files with a stderr warning rather
  than failing — one bad file shouldn't block the rest from
  replaying.

### What's NOT shipped (deferred to A+.6b)

- **Conflict resolution.** If the queued mutation conflicts with
  current server state on replay (e.g., the resource was deleted
  while you were offline), v1 surfaces the backend's error and
  preserves the queue file. v1.1 will add a `solid:conflictsWith`
  IRI in the response and an interactive resolver.
- **Idempotency-Key header send.** Each queue file has an
  idempotencyKey field; v1 doesn't yet thread it as an HTTP header
  through `apiClient.{post,put,patch,delete}` because per-call
  headers aren't in the v1 wrapper signature. The key still serves
  as the de-dup token in the file format for client-side
  deduplication.
- **Auto-detect connectivity.** v1 requires explicit `--queue`. v1.1
  could fall back to the queue when an axios `ECONNREFUSED` /
  network error fires.

### Verification

- `npm test`: 828/828 green (18 unit + 3 integration tests).
- File format is a valid JSON-LD document (verified via the
  `solid graph --offline` walker on a hand-placed queue dir).

## [1.23.0] — 2026-04-25

**SPARQL BGP query.** Closes A+.5 of SPRINT-JSONLD-GRAPH-MOAT.md (offline
half) — answer "show me every Service provided by companies on builder
tier" as a graph query, not an array join.

### Added

- **`solid graph --query <sparql>`** — minimal SPARQL Basic Graph Pattern
  engine, runs in-process against the loaded graph. Works offline (the
  bundled `.claude/solid-context.jsonld`) and remote (auto-fetches via
  the existing `loadDocument` path). Output: a table by default,
  `--json` emits the structured `{vars, bindings}` shape (SPARQL 1.1
  results spec).
- **`lib/sparql-bgp.ts`** — pure functions:
  - `parseQuery(text)` → typed AST with PREFIX expansion
  - `materializeTriples(doc)` → flat (s, p, o) triples
  - `runQuery(query, doc)` → de-duplicated bindings
  - `query(text, doc)` → convenience parse-and-run

### Supported

- `SELECT ?var ?var WHERE { ?s ?p ?o . ?s2 ?p2 ?o2 . }`
- `SELECT *` (binds every variable in WHERE)
- `PREFIX foo: <http://...>` plus always-on `schema:`, `solid:`, `rdf:`
- `a` shorthand for `rdf:type`
- IRI terms, prefixed names, string literals (`"..."`), numeric literals
- Multi-pattern joins (variable bindings carry forward)
- List-valued JSON-LD predicates expand to multiple matches
- Triple terminator `.` properly handled inside `<...>` IRIs and quoted
  literals
- Result rows de-duplicated (DISTINCT-by-default for projection)

### Not supported (use the RDF export + a real SPARQL engine)

- `OPTIONAL { ... }`
- `FILTER (...)`
- Property paths (`?s schema:knows+ ?o`)
- `UNION` / `MINUS`
- `GROUP BY` / `ORDER BY` / `LIMIT` (pipe through `head` / `sort`)
- Named graphs / `GRAPH ?g { ... }`

For those: `solid graph --dump nquads | apache-jena-fuseki tdbloader2`
and run full SPARQL there.

### Verification

- `npm test`: 807/807 green (18 unit + 4 integration tests).
- 10 canned queries from the spec all green: tier holders, services
  by category, agents handling a category, webhooks firing chains,
  type counts, services by provider, KB by category, chained joins,
  predicate-counts, zero-match.
- Plus join-semantics (var bound twice must agree), DISTINCT
  projection, list-valued predicates, and parser sanity.

## [1.22.0] — 2026-04-25

**Graph diff.** Closes A+.4 of SPRINT-JSONLD-GRAPH-MOAT.md — answer
"what changed in my tenant since X" structurally, not by log-grepping.

### Added

- **`solid graph --diff <baseline>`** — load a baseline `.jsonld` file,
  compare against the currently loaded graph (offline file or remote
  fetch), report added / removed / modified nodes with per-predicate
  operations in JSON-Patch style. Pretty-prints by default; `--json`
  emits the structured report.
- **Exit code is the diff signal.** 0 if graphs are identical, 1 if
  any change. Lets you gate CI on graph stability:
  `solid graph --diff baseline.jsonld --offline || echo "tenant drifted"`.
- **`lib/graph-diff.ts`** — pure function `diff(before, after)` so
  consumers (eventually `solid graph --since 2d`) can reuse the
  primitive.

### Behavior

- Identity is `@id`. Anonymous nodes (no `@id`) are skipped — diffing
  them produces phantom add+remove churn that's never useful.
- `@type` array order is normalized — reordering a node's types is
  not a modification.
- Edge changes appear as predicate changes on the source node (every
  JSON-LD edge is a predicate value), not as separate edge entries.
- Stable output ordering: nodes sorted by `@id`, predicates sorted
  alphabetically. Deterministic for snapshots and CI gates.

### Verification

- `npm test`: 785/785 green (11 lib + 3 integration tests).
- 8 acceptance scenarios from the spec all green: zero-diff,
  add/remove × node + edge, modify (rename, predicate add, predicate
  remove), plus tenant-isolation and @type-reorder invariants.

## [1.21.0] — 2026-04-25

**RDF export.** Closes A+.2 of SPRINT-JSONLD-GRAPH-MOAT.md — the
tenant graph is now ingestable into any RDF store (Neo4j, Fuseki,
Blazegraph, GraphDB, Neptune) without going through JSON-LD.

### Added

- **`solid graph --dump nquads`** — converts the loaded JSON-LD context
  to N-Quads and prints to stdout. Pipe to a file, a graph store
  ingester, or `rdfox load` / `tdbloader`. Works **offline** (uses
  the local `.claude/solid-context.jsonld` and the bundled `jsonld`
  npm lib) so AI agents bound to a tenant dir can dump without
  network.
- **`solid graph --dump turtle`** — same idea, Turtle format.
  Currently requires the backend (it fetches `?format=turtle` from
  `/api/v1/cli/context`); offline turtle errors with a hint pointing
  to nquads. Adding offline turtle is a future patch — N-Quads is
  the canonical lossless format every RDF store accepts, so this
  doesn't block any real workflow.

### Dependencies

- **Added `jsonld@^9.0.0`** as a runtime dep (~2 MB unpacked). This
  is the canonical JSON-LD reference implementation; we use its
  `toRDF()` for offline conversion. `npm audit --omit=dev`: 0 vulns.

### Verification

- `npm test`: 771/771 green (5 new in `graph-dump.test.ts`).
- `tsc --noEmit`: clean.
- Round-trip verified: every IRI from a fixture JSON-LD doc survives
  `--dump nquads` as either subject or object position.

## [1.20.1] — 2026-04-25

**License reconciliation.** Closes Phase 0.3 of the AI Stack
Sovereignty sprint — three drifted spellings of the same license,
one of them ("MIT" in the README footer) actively wrong.

### Fixed

- **`package.json` license: `BSL-1.1` → `BUSL-1.1`** — the SPDX
  license list standardized "Business Source License 1.1" to
  identifier `BUSL-1.1` in 2023. The non-standard `BSL-1.1` rendered
  as "Custom" on npm and broke GitHub's license detection. Now
  recognized correctly by tooling (npm, FOSSA, Snyk, GitHub).
- **README footer: `## License\n\nMIT` → BSL-1.1 with plain-English
  summary.** The footer was outright wrong (claimed MIT) while
  `package.json` and `LICENSE` both correctly said BSL-1.1. The new
  section names what's permitted (read source, build on the SDK,
  run for your own business, ship internal tools), what's not
  (competing commercial CLI for AI-powered business infrastructure),
  and the 2030-04-14 conversion to Apache 2.0.

The `LICENSE` file (full BSL-1.1 text + additional use grant) was
already correct; this patch only fixes the references.

### Verification

- `npm test`: 766/766 green.
- `npm view @solidnumber/cli@1.20.1 license` will return `BUSL-1.1`
  after publish.

## [1.20.0] — 2026-04-25

**CI green patch.** Closes Phase 0.2 of the AI Stack Sovereignty
sprint — five red CI runs in a row, two distinct root causes.

### Breaking

- **Drop Node.js 18 support.** Node 18 reached EOL on 2025-04-30 and
  several runtime deps (notably `inquirer@9`, ESM-only) no longer
  load via CommonJS `require()` on Node 18, producing
  `ERR_REQUIRE_ESM` on every command. Minimum is now Node 20.
  `engines.node` updated to `>=20.0.0`. Users on Node 18 should
  upgrade to Node 20 LTS or 22 LTS.

### Fixed

- **CI matrix: Node 18 dropped, kept 20 + 22.** Was failing
  `test (18)` because of the ESM/CJS interop break described above.
- **CI security job: `npm audit --omit=dev`.** Was failing on the
  `@typescript-eslint/*` dev-only advisory chain — vulns shielded
  from user installs since dev deps don't ship to npm. Now matches
  the `audit:prod` script in `prepublishOnly`. Same flag passed to
  `audit-ci` (`--skip-dev`).

### Verification

- 766/766 tests green locally.
- `npm audit --omit=dev`: 0 vulns.
- CI matrix builds + tests on Node 20 and 22.

## [1.19.5] — 2026-04-24

**Truth-in-advertising patch.** Closes Phase 0.9 of the AI Stack
Sovereignty sprint — the README banner numbers were stale and
undercounting the actual CLI surface by ~3×.

### Fixed

- **README banner now matches the program registry.** Was: "86
  top-level commands, 200+ subcommands". Reality: 96 top-level,
  595 subcommands. Updated to "96 top-level commands, 500+
  subcommands".

### Added

- **`marketing-numbers-drift.test.ts`** — runs `dist/index.js schema
  verbs --json` against the built CLI and asserts the README banner
  is in sync with the registry. Top-level number must match exactly;
  subcommand count must be `≤ actual && ≥ floor(actual/100)*100`.
  Drift now fails CI before publish.

### Verification

- `npm test`: 766/766 green (two new tests).
- README banner now matches `solid schema verbs --json` output.

## [1.19.4] — 2026-04-24

**Honesty patch.** Closes Phases 0.6 and 0.10 of the AI Stack
Sovereignty sprint — eliminates the last placeholder assertion in the
critical-security test file and brings dev dep versions current.

### Fixed

- **`company-isolation.test.ts` no longer contains `expect(true).toBe(true)`**
  (Phase 0.6) — the placeholder for "company switch requires a new
  JWT" is replaced with two real source-level contract assertions:
  one verifying that `commands/switch.ts` writes BOTH new tokens
  AND `companyId` back to config, and one verifying that the
  `companySwitch` API method's return type still includes
  `access_token` and `refresh_token`. A future refactor that breaks
  the new-JWT contract (e.g., dropping refresh_token, or only
  changing `X-Company-ID` while keeping the old JWT) will fail this
  test instead of silently regressing.

### Changed

- **`@types/node` 20.19.33 → 20.19.39, `ts-jest` 29.4.6 → 29.4.9**
  (Phase 0.10) — within-semver dev dep updates. Major-version
  bumps for `chalk` / `ora` / `inquirer` / `commander` / `eslint` /
  `jest` / `typescript` are deferred to a dedicated migration sprint
  (ESM-only conversions and breaking API changes; not safe in a
  hygiene patch).

### Verification

- `npm test`: 764/764 green (one new test added in 0.6).
- `npm audit --omit=dev`: 0 vulns.
- `tsc --noEmit`: clean.

## [1.19.3] — 2026-04-24

**Hygiene batch.** Closes Phases 0.5, 0.7, 0.8, and 0.12 of the AI Stack
Sovereignty sprint — four small but load-bearing gaps that an AI
agent calling the CLI from a script would have hit silently.

### Added

- **`solid kb search <query>`** (Phase 0.5) — first-class subcommand
  for the company-scoped full-text + semantic KB search. Was reachable
  before only via `solid kb list -q`, which is a different code path
  (title `ILIKE` filter, not the embedding-aware `/api/v1/kb/search`).
  Supports `--limit`, `--offset`, and `--json`. Exits non-zero on
  failure.
- **Recursive unknown-command handler** (Phase 0.7) — `solid kb xyzzy`
  and every other typo at any subcommand level now exits 1 with a
  Levenshtein-suggested correction. Previously, only top-level typos
  exited 1; any subcommand typo silently exited 0, which broke
  pipelines that rely on exit codes to detect mistakes.

### Changed

- **`__solid_dry_run` config flags now have a typed home** (Phase 0.12) —
  introduced `ExtendedAxiosRequestConfig`, `ExtendedAxiosError`, and
  `ExtendedRequestConfig` interfaces in `lib/api-client.ts`. Removed
  the 7 `as any` casts that were threading these flags through axios's
  typed config. The flags' lifecycle is now self-documenting in the
  type system instead of a parade of escape hatches.

### Removed

- **Source maps no longer ship to npm** (Phase 0.8) — added `*.js.map`
  and `*.d.ts.map` to `.npmignore`. They exposed original source paths
  to anyone who unpacked the tarball and added ~200 KB of dead weight
  to every install. Stack traces in production CLI usage are
  unaffected (they reference compiled paths).

### Verification

- `npm test`: 763/763 green.
- `tsc --noEmit`: clean.
- Tarball size shrinks; install size for 1M+ AI-agent installs drops
  proportionally.

## [1.19.2] — 2026-04-24

**Correctness patch.** Closes Phase 0.4 of the AI Stack Sovereignty
sprint — the silent-failure bug that broke the scripting contract.

### Fixed

- **109 silent-failure sites across 26 command files** — every catch
  block whose only error handling was `console.error(handleApiError(e).message)`
  (no `process.exit(1)`) now exits non-zero. Pipelines that depended
  on the documented `solid <verb> && next-step` contract no longer
  paper over backend failures.
  Files touched: `accounting`, `analytics`, `audit`, `billing`, `crm`,
  `dashboard`, `demo`, `dev`, `domains`, `export`, `inventory`,
  `llms`, `logs`, `notifications`, `pages`, `payment`, `sandbox`,
  `schedule`, `seo`, `services`, `status`, `storage`, `support`,
  `test`, `webhooks`, plus a JSDoc comment fix in `command-kit.ts`.
- **Cleanup-before-exit preserved** in three catch blocks where
  follow-up code matters — `demo.ts` (state restoration after a
  failed company switch), `demo.ts` delete (helpful CLI hint about
  demo-company-only deletion), `test.ts` (loop continues counting
  failures and exits at end based on aggregate, not on first failure).
- **Redundant `return` after `process.exit`** removed in `webhooks.ts`
  (exit is `never`-typed; return is unreachable).

### Verification

- `npm test`: 763/763 green.
- `npm audit --omit=dev`: 0 vulns (carried from v1.19.1).
- `tsc --noEmit`: clean.
- Audit script (verifies no exit-before-cleanup-code patterns left):
  pass.

## [1.19.1] — 2026-04-24

**Security patch.** Closes the production CVEs that shipped in v1.19.0.
A third-party audit on 2026-04-24 caught that the published tarball
contained a vulnerable `axios@1.13.5` (NO_PROXY → SSRF; header
injection → cloud-metadata exfil) plus a transitively vulnerable
`handlebars@4.7.8` (critical) and minor regressions in
`flatted` / `minimatch` / `picomatch`.

### Security

- **`axios` 1.13.5 → 1.15.2** —
  closes [GHSA-3p68-rc4w-qgx5](https://github.com/advisories/GHSA-3p68-rc4w-qgx5)
  (NO_PROXY bypass → SSRF) and
  [GHSA-fvcv-3m26-pcqx](https://github.com/advisories/GHSA-fvcv-3m26-pcqx)
  (header injection → cloud-metadata exfiltration). `follow-redirects`
  also bumped to a non-vulnerable version
  ([GHSA-r4q5-vmmm-2653](https://github.com/advisories/GHSA-r4q5-vmmm-2653) —
  auth-header leak on cross-domain redirects).
- **`handlebars` 4.7.8 → 4.7.9** — closes the
  critical-severity advisory chain (transitive via `ts-jest`; not
  reachable from runtime, but still patched).
- **`flatted`, `minimatch`, `picomatch`** bumped to non-vulnerable
  versions in lockfile.

### Changed

- **`prepublishOnly` adds `npm run audit:prod`** —
  `npm publish` now refuses if the production dependency tree
  (`npm audit --omit=dev --audit-level=high`) has any high or critical
  vulnerabilities. The local publish flow now catches what CI catches.
  Closes the gap that let v1.16.2 / v1.17.0 / v1.18.0 / v1.19.0 ship
  through a failing security job.
- New script `audit:prod` for production-only audit (devDeps excluded
  from the gate so eslint / typescript / jest churn doesn't block
  releases that are clean for end users).

### Verification

- `npm audit --omit=dev`: **0 vulnerabilities** in the production tree.
- `npm test`: 763/763 green.
- `npm pack --dry-run`: tarball builds cleanly.

### Outstanding (deferred — won't block users)

- 6 high-severity advisories remain in the `@typescript-eslint`
  devDependency family (require a major version bump from v6/v7 to
  v8+, which needs a separate PR to verify the eslint config still
  builds). These are devDeps only — they don't ship in the published
  tarball, so end users are unaffected.

## [1.16.1] — 2026-04-23

Gap-closure patch following the 1.16.0 tenant-guard ship. Tightens the
same invariant in the one write-path command that was missed.

### Added

- **`refuseProtectedRoot(baseDir)`** in `lib/tenant-guard.ts` — home-dir-
  only refusal helper for commands that CREATE the manifest and therefore
  can't call `requireTenantManifest` yet. Exits 1 if `baseDir` resolves
  to `$HOME` or `$HOME/.claude/`. Shares `isProtectedRoot` with the full
  guard so there's one source of truth.
- **`isProtectedRoot`** now exported (was previously private).

### Changed

- **`solid pull`** now calls `refuseProtectedRoot(baseDir)` before writing.
  Prevents scaffolding a tenant project (pages/, kb/, .solid/manifest.json)
  into the home directory, closing the symmetric gap to 1.16.0's `context`
  and `push` coverage.
- **`pull.ts`** now imports `PullManifest` from `lib/tenant-guard.ts`
  instead of keeping its own inline duplicate. `push.ts` + `pull.ts` +
  `context.ts` all share one canonical type.

### Tests

- 4 new cases in `__tests__/lib/tenant-guard.test.ts` covering
  `refuseProtectedRoot` and `isProtectedRoot`.
- Suite: 709 / 709 passing.

## [1.16.0] — 2026-04-23

Tenant context boundary guard. Closes a multi-tenant hygiene bug where
`solid context --claude` would write tenant-scoped data to any directory
the user happened to be in, including the platform monorepo and
`$HOME/.claude/` (which is loaded by every Claude Code session on the
machine).

### Added

- **`lib/tenant-guard.ts`** — new shared guard module exporting
  `requireTenantManifest(baseDir, companyId)` and the pure testable variant
  `checkTenantManifest(...)`. Enforces three rules:
  1. `$HOME` and `$HOME/.claude/` are never writeable (hard refusal, even
     if a manifest somehow existed there).
  2. `<cwd>/.solid/manifest.json` must exist.
  3. `manifest.company_id` must equal the active session's `company_id`.
- **`PullManifest` interface** — exported from `lib/tenant-guard.ts` as the
  canonical type. `push.ts` now imports it from there instead of keeping
  its own copy.
- Tests: `__tests__/lib/tenant-guard.test.ts`, `__tests__/commands/context.test.ts`.

### Changed

- **`solid context --claude / --cursor / --codex / --save / --watch`** now
  calls `requireTenantManifest` before writing. Unbound directories exit 1
  with a friendly error instead of silently contaminating the filesystem.
  Read-only paths (`--summary`, `--tools-only`, `--section`, `--json` to
  stdout) are unchanged and remain usable in any directory.
- **`solid push`** refactored to use the shared guard (previously had an
  inline duplicate check). Behavior equivalent; the extraction is proven
  by reuse.

### Docs

- New canonical-truth doc:
  `Owners-Manual/03-AI-Systems/CLAUDE-CONTEXT-CANONICAL-TRUTH.md`
  consolidating the previously-dispersed Claude context architecture
  (three roles of CLAUDE.md, four flows-down channels, write model,
  refresh model, multi-tenant invariants).
- Platform `CLAUDE.md` now references the canonical-truth doc as Rule 4b.

### Fixed

- `solid context --claude` no longer writes into `$HOME`, the platform
  monorepo, or any directory whose bound `company_id` differs from the
  active session.

## [1.10.0] — 2026-04-19

Sprint 1 — CLI v2 Agent-Ready. Six agent-quality-of-life upgrades ship
in this release, all behind opt-in env flags so existing callers are
unaffected until v2.0 flips defaults.

### Added
- **Structured JSON errors (T1.1)** — Enable with `SOLID_JSON_V2=1`.
  Under `--json + V2`, errors emit `{error:{code,status,message,scope?,
  feature?,upgrade_to?,hint?,request_id?}}` to stdout instead of prose
  to stderr. Closed `ErrorCode` vocabulary (12 codes): AUTH_REQUIRED,
  FORBIDDEN, FEATURE_GATED, SCOPE_MISSING, NOT_FOUND, VALIDATION_FAILED,
  CONFLICT, RATE_LIMITED, SERVER_ERROR, NETWORK_ERROR, TIMEOUT,
  DRY_RUN_BLOCKED. Honors backend-supplied envelope shapes.
- **Dry-run existence verification (T1.2)** — Mutations with `--dry-run`
  now GET the resource URL first. If it 404s, the CLI surfaces
  NOT_FOUND instead of synthetic success. Closes the `solid pages
  update 99999 --dry-run` false-success lie. Skips for POST/collection
  and action endpoints where existence can't be probed.
- **`solid schema verbs` (T1.3)** — Full CLI verb manifest for agent
  discovery. Walks the Commander tree, emits `{verb, path, description,
  options, args, subcommands, is_leaf}` per node. `--json` for machine
  consumption; `--include-hidden` surfaces normally-hidden verbs.
- **Unified list envelopes (T1.4)** — Every list response now carries
  `.items` + `.total / .page / .has_more` regardless of whether the
  backend returned `pages`, `results`, `leads`, `logs`, `api_keys`, etc.
  Original keys preserved — no breakage. Opt out with
  `SOLID_LEGACY_LIST_SHAPES=1` (removes in next minor).
- **`solid mcp install|serve|tools` (T1.5)** — Install Solid# into
  Claude Desktop / Cursor / Windsurf with one command; spawn the MCP
  server; list tools from the backend manifest. Auto-detects per-OS
  config paths, non-destructive merge preserves other MCP servers.
- **`solid doctor scopes` (T1.6)** — Catches the silent-failure case
  where a tenant enables a feature after an API key was issued and the
  key lacks the implied scopes. Reports missing scopes + one-line
  rotation hint. Uses the same feature→scope map as the backend
  (services/scope_expansion.py).

### Changed
- `ApiError` now carries optional `code / hint / docs_url / scope /
  feature / upgrade_to / request_id`. Legacy string `message` still
  printed unchanged for humans.
- Request interceptor issues a verify GET before short-circuiting
  resource-targeted PATCH/PUT/DELETE under `--dry-run`.
- Response interceptor non-destructively aliases list arrays to
  `.items` — consumers that used to branch on `d.pages || d.items ||
  d.results` can simplify to `d.items`.

### Internal
- `CLI_VERSION` now exported from `src/lib/api-client.ts` so other
  modules don't re-read `package.json`.
- New pure libraries: `error-codes`, `verb-manifest`, `list-envelope`,
  `mcp-client-config`, `scope-diagnostic`, `program-registry`. Each
  ships with a dedicated unit-test suite.
- Full suite grew from **486 → 642 tests** (+156 new Sprint 1 cases).
  TypeScript + build clean.

### Rollout (T1.7 two-step)
- `1.10.0`: every new behavior is opt-in via env var. Old `--json`
  callers see exactly what they see today.
- `2.0.0` (after soak, TBD): `SOLID_JSON_V2` defaults to on.
  `SOLID_LEGACY_LIST_SHAPES=1` preserves old envelope keys for one
  more minor before final removal.

---

## [1.7.3] — 2026-04-15

### Added
- `solid demo create plumber "Joe's" --expires 72h` — live demo with AI for sales meetings
- `solid demo convert <id> --tier starter` — convert demo to paid via checkout link
- `solid sandbox fork` — server-side sandbox (isolated copy via backend API)
- `solid sandbox preview` — shareable preview URL for client approval
- `solid sandbox promote` — push sandbox to production
- `solid sandbox exit` — discard sandbox
- `solid brand set --logo --domain --colors --email-from` — full white-label from CLI
- `solid init my-app --type marketplace` — scaffold apps on Solid# (4 templates: basic, marketplace, saas, agency-dashboard)
- `solid payment analytics` — payment volume, interchange savings, chargebacks
- `solid payment connect stripe --account acct_123` — connect payment processor
- `solid payment terminal --amount 49.99` — POS from the CLI
- Tab completion for all new commands

### Fixed
- Inventory endpoints: corrected to /api/v1/Inventory/list, /get, /create, /adjust
- Audit endpoint: /api/v1/audit/log → /api/v1/security/audit/logs
- Token auto-refresh: isLoggedIn() no longer rejects expired tokens (interceptor handles refresh)
- .npmignore: dist/__tests__/ excluded from npm package

## [1.7.2] — 2026-04-14

### Added
- `solid dashboard` — cross-company overview for agencies (revenue, agents, health)
- `solid api list/docs/call` — API explorer from the CLI (13 sections, 70+ endpoints)
- `solid proposal "Business" --template plumber` — branded client proposals with tier pricing
- `solid webhooks listen` — forward production webhooks to localhost for development
- `solid webhooks test <event>` — send test webhook events to local server
- `solid status --all` — quick view of all companies for agencies
- `solid open --portal / --api-docs / --sdk / --webhooks` — open developer docs in browser
- Developer portal, API docs, and SDK links in help output

### Fixed
- Refresh interceptor no longer nukes session on 401 (was wiping tokens on network blips)
- Banner only shows on top-level `--help`, not subcommand help
- Health `--full` hits correct endpoint `/api/v1/health`
- 9 CLI bugs from QA audit (inbox, auth, services, SEO, flows, completion, analytics)
- Chalk v5 → v4 for Node 18 compatibility
- Version banner reads from package.json instead of hardcoded v1.0.0

### Changed
- License changed from MIT to BSL-1.1
- `@anthropic-ai/sdk` moved to optionalDependencies
- Dead `keytar` dependency removed
- Platform docs `llms.txt` updated (v1.4.6 → v1.7.2, 47 → 62 commands)

## [1.7.1] — 2026-04-14

### Fixed
- Banner version was hardcoded as v1.0.0 — now reads from package.json
- Login used `expires_at` (undefined) instead of `expires_in` (seconds) from backend
- Chalk v5 ESM-only — pinned to v4 for Node 18 compatibility
- CI secrets scanner false positive on example `sk_live_...` text
- 9 CLI bugs from QA audit:
  - Inbox crash on non-array API responses
  - `auth status` double-nested user object from `/me` endpoint
  - Services list hitting wrong endpoint (`/cms/public/services` → `/services/catalog`)
  - SEO audit sending empty body without `--url`
  - `health --full` hitting admin-gated endpoint — now uses `/api/v1/health`
  - Flows showing cryptic error instead of explaining CLI API key requirement
  - 14 commands missing from tab completion
  - Analytics dashboard showing blank instead of "no data" message
  - Health subcommand recursion removed — flags-only interface

## [1.7.0] — 2026-04-12

### Added
- Sandbox Engine CLI — 10 new `solid dev` commands for isolated development
- `solid logs` and `solid test` commands
- `solid serve --preview` and `solid migrate --replace` flags
- Services create/delete commands
- 154 tests passing (up from 98)

## [1.6.5] — 2026-04-10

### Fixed
- Replace `solid dev` stubs with redirects to real commands

## [1.6.4] — 2026-04-09

### Fixed
- Build and packaging improvements

## [1.6.3] — 2026-04-08

### Fixed
- Build and packaging improvements

## [1.6.1] — 2026-04-06

### Added
- Full type safety — zero `any` casts across all 47 commands
- 98 tests passing with CI/CD pipeline

### Fixed
- Live reload, npmignore, zero remaining gaps

## [1.6.0] — 2026-04-04

### Added
- AI-powered import command (`solid import mockup.html`)
- 7 new commands: import, sandbox, watch, dedicated droplets
- Agency CMS workflow — full content management for client companies
- CI/CD pipeline with company isolation security tests
- 98 tests across 9 suites

### Fixed
- Removed all `as any` casts from api-client.ts

## [1.5.0] — 2026-03-28

### Added
- `solid open`, `solid diff`, `solid serve` commands
- CLI testing + deploy safety system
- Push auto-snapshot with comprehensive unit tests
- History, deploy, migrate, rollback commands with tests and docs

## [1.4.6] — 2026-03-20

### Fixed
- Close CLI gaps — billing endpoints, domains, page generate, site regenerate
- Synced llms.txt with platform

## [1.4.5] — 2026-03-18

### Added
- `solid billing checkout-link` and `solid billing invoice` commands

## [1.4.4] — 2026-03-16

### Added
- `solid site` commands + expanded `solid pages`
- Site management and page delete API methods

## [1.4.3] — 2026-03-14

### Added
- Billing, audit, notifications, domains commands

## [1.4.2] — 2026-03-12

### Added
- Accounting, webhooks, support, export commands

## [1.4.1] — 2026-03-10

### Added
- Analytics, SEO, insights, llms commands

## [1.4.0] — 2026-03-08

### Added
- `solid context` — AI context package generation (CLAUDE.md, Cursor rules)
- Watch mode for context regeneration
- `solid payment` — Level 3 interchange CLI commands

## [1.3.1] — 2026-03-05

### Added
- `solid design` command for AI-generated UI

## [1.3.0] — 2026-03-02

### Added
- `solid explore` — Platform Intelligence Console with zero-setup API proxy
- CRM, voice, inbox, schedule, reports, inventory, blog commands
- Commerce flows, brand, widgets, ant farm commands
- Agent consciousness commands — soul, reflect, emotions, spiral, missions
- `solid connect` — import from Figma, Slack, Notion, CSV, WordPress, GitHub

### Fixed
- ASCII `#` character redesigned (looked like `4`)
- Removed `--password` and `--token` CLI flags to prevent credential exposure

### Security
- Config file permissions set to 0600

## [1.2.0] — 2026-02-20

### Added
- Multi-company commands + API key auth
- Complete CLI with 16 commands, branded UI, AI training, clone templates

## [1.0.0] — 2026-02-15

### Added
- Initial release — tenant-scoped business management CLI
- Auth, status, KB, pages, pull/push, clone with 52 industry templates
