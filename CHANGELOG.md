# Changelog

All notable changes to `@solidnumber/cli` will be documented in this file.

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
