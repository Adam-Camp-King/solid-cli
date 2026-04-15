# Changelog

All notable changes to `@solidnumber/cli` will be documented in this file.

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
