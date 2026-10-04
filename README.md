# @solidnumber/cli

Run an AI-powered business from your terminal.
<!-- AUTO-NUMBERS: do not edit by hand; run `npm run sync:counts` (scripts/sync-counts.ts). Verified by `npm run check:counts`, which prepublishOnly runs. -->
176 top-level commands, 924 verbs. One CLI, built for an AI agent to drive.

## What a verb tells you before you call it

Every action in Solid# is a verb (`page.publish`, `contact.update`,
`appointment.book`). Each one publishes its own contract, so an agent can
decide before it acts:

```bash
solid verbs describe page.publish --json
```

```jsonc
{
  "name": "page.publish",
  "side_effects": "write",
  "requires_consent": true,            // refused without --confirm
  "undone_by": "page.unpublish",       // the way back, named before the write
  "refuses_when": [                    // what it will refuse, and the override if there is one
    { "code": "publish_requires_subscription", "override": null },
    { "code": "fidelity_below_threshold", "override": "accept_fidelity" },
    { "code": "blocked_by_guardrails", "override": null }
  ],
  "output_schema": {                   // what comes back
    "required": ["success"],
    "anyOf": [
      { "title": "worked",  "required": ["message", "page", "promoted_fields", "published_url", "success"] },
      { "title": "did not", "required": ["error", "success"] }
    ],
    "x-solid-derivation": "proven-from-return-paths"
  }
}
```

- **Refusals up front.** `refuses_when` lists each refusal code, the condition
  and the override.
- **The undo, before the write.** `undone_by` names the verb that takes a write
  back; `null` means none is known, never a guess.
- **What comes back.** `output_schema` says which keys are on every result.
  `proven-from-return-paths` means every return path of the handler was read;
  `inferred-from-return-literals` means keys worth looking for, none promised.
- **A dry run that tells the truth.** `solid verbs invoke <verb> -p '{…}' --dry-run`
  validates the payload locally, shows the exact request, `undone_by` and what
  would come back, and exits 1 when the call is invalid. It needs no consent.
- **Consent is part of the contract.** A write needs `--confirm`. Without it
  the call is still sent, the server refuses it, and the refusal is on record.
- **Every call hands back its receipt.** `solid verbs invoke` prints
  `_receipt`, the handle of the record that call left, and a refusal prints one
  too. `solid verbs receipts <ref>` reads it back: who, what, outcome, duration,
  and whether the result matched the verb's published schema (`contract: kept`
  or `broken`). `--session <id>` reads a whole run; set `SOLID_SESSION_ID` to
  join several invocations into one.
- **What changed since the catalog you were holding.** `solid verbs snapshot >
  verbs.snap.json`, then `solid verbs list --changed-since verbs.snap.json`
  returns the verbs added, removed or changed — inputs, outputs and refusals.
- **A list is a page.** `solid verbs list` returns 100 working verbs, one name
  per operation, leading with the ones an AI is handed as tools. `solid map`, a
  prefix or `solid find "<task>"` reaches the rest.

Release notes are in [CHANGELOG.md](CHANGELOG.md).

```bash
npx @solidnumber/cli clone plumber
```

## Install

**Easiest — one paste, everything handled** (installs Node if needed, runs
setup, connects your AI). Or just visit [solidnumber.com/install](https://solidnumber.com/install):

```bash
# macOS / Linux
curl -fsSL https://solidnumber.com/install.sh | sh

# Windows (PowerShell)
iwr -useb https://solidnumber.com/install.ps1 | iex
```

Other ways, if you already have a package manager you trust:

```bash
# any platform with Node 20+
npm install -g @solidnumber/cli

# macOS / Linux — note: on macOS older than 13 (Ventura), brew may compile
# Node from source (slow). Prefer the one-paste installer there.
brew install solidnumber/tap/cli

# Windows
scoop bucket add solidnumber https://github.com/Solidnumber/scoop-bucket
scoop install solidnumber/solid

# one-paste install + magic-link auth (logged-in dashboard users only)
# get your personal command at https://app.solidnumber.com/dashboard/install-command
curl -fsSL https://solidnumber.com/install.sh | SOLID_INSTALL_TOKEN=ist_xxx sh
```

## Quick Start

```bash
# Login to your company
solid auth login

# Clone an industry template (52 available)
solid clone plumber

# Download your business data as local files
solid pull

# Edit pages, KB, settings in VS Code / Cursor / any editor

# Upload changes (they land as drafts / unpublished pages)
solid push

# Make them live — publish is the step that goes live, not push or deploy
solid publish <page_id>   # or: solid publish --all

# Give your AI full context about this company
solid context --claude    # Claude Code
solid context --cursor    # Cursor
solid context --save      # Any AI (paste into project)

# Talk to your AI agent
solid train chat sarah

# Natural language site edits
solid vibe "Add a hero section with our phone number"

# See your agents' consciousness
solid agent dashboard

# View an agent's soul — identity, emotions, growth
solid agent soul sarah

# Launch a multi-agent mission
solid agent mission "Create a Valentine's campaign for VIP customers"
```

## Commands

### Core Workflow
| Command | Description |
|---------|-------------|
| `solid auth login` | Authenticate with your company |
| `solid auth logout` | Clear stored credentials |
| `solid auth whoami` | Show current session |
| `solid status` | Company dashboard |
| `solid update` | Update everything Solid# on this machine — CLI, MCP server, hook, completion, agent skills, render browser |
| `solid pull` | Download pages, KB, settings as files |
| `solid push` | Upload local changes (drafts / unpublished pages) |
| `solid publish <id>` / `--all` | Make pages live (pending drafts + never-published pages) |
| `solid deploy` | Create a shareable preview snapshot — does NOT publish |
| `solid diff` | Preview changes before pushing |
| `solid serve` | Local preview server (localhost:4000) |
| `solid open <page>` | Open page in web WYSIWYG builder |
| `solid watch` | Auto-push on file save |

### Import & Sandbox
| Command | Description |
|---------|-------------|
| `solid import file.html --page "Title"` | Convert HTML/JSX to CMS blocks |
| `solid import --clipboard --page "Title"` | Import from clipboard |
| `solid sandbox create` | Fork site into isolated sandbox |
| `solid sandbox status` | Show sandbox changes |
| `solid sandbox diff` | Compare sandbox vs original |
| `solid sandbox push` | Promote sandbox to production |
| `solid sandbox reset` | Discard sandbox |

### Multi-Company & Droplets
| Command | Description |
|---------|-------------|
| `solid company create "Name"` | Create on shared platform |
| `solid company create "Name" --dedicated` | Provision dedicated droplet |
| `solid company create "Name" --dedicated --size medium` | With size (small/medium/large) |
| `solid switch <id>` | Switch active company |
| `solid droplet status <customer>` | Check droplet health |

### AI Training
| Command | Description |
|---------|-------------|
| `solid train import ./kb/` | Bulk import knowledge base from directory |
| `solid train chat [agent]` | Interactive chat with your AI agent |
| `solid train add -t "Title"` | Quick-add a KB entry |
| `solid train status` | Coverage dashboard with gap analysis |

### Business Data
| Command | Description |
|---------|-------------|
| `solid kb list` | List knowledge base entries |
| `solid pages list` | List CMS pages |
| `solid services list` | List services |

### Money & Orders
| Command | Description |
|---------|-------------|
| `solid offer get --cart <id>` | Read the deal — line items, SKUs, tax, fees, disclosure, total |
| `solid offer get --link <id>` | Same offer, from a payment link (or `--order <id>`) |
| `solid payment-links create --amount <n>` | Create a payment link |
| `solid payment-links text2pay` | Text a payment link |
| `solid payment-links capture-methods` | What this merchant can take money with right now |
| `solid orders progress <id>` | Where an order is — the state AND the milestones under it |
| `solid orders milestone <id> <name>` | Report progress (pick ticket, packed, label, handed to carrier) |
| `solid orders milestones` | What progress can be reported, and what each milestone means |

> The offer is one shape whether it comes from a cart, an order or a link, and
> its total is **quoted by the pricing engine** — the same call the charge path
> makes — so what you read is what gets charged. `--json` on any of these for
> agent consumption.

### AI Context
| Command | Description |
|---------|-------------|
| `solid context` | Generate AI context package (stdout) |
| `solid context --claude` | Save to `.claude/CLAUDE.md` (auto-read by Claude Code) |
| `solid context --cursor` | Save to `.cursorrules` (auto-read by Cursor) |
| `solid context --save` | Save to `SOLID-CONTEXT.md` |
| `solid context --watch` | Auto-refresh when data changes |
| `solid context --json` | JSON output |
| `solid context --jsonld` | JSON-LD typed graph (Schema.org + `solid:*` vocab) |

### Graph (v2 — vendor-portable JSON-LD)

Your business is a typed graph. Every entity has a globally-resolvable
IRI. Walk it, query it, diff it, export it, take it offline.

| Command | Description |
|---------|-------------|
| `solid graph` | Top-level summary — types and counts |
| `solid graph services` | Walk a single node and its 1-hop neighborhood |
| `solid graph --type Service` | List every node of a given `@type` |
| `solid graph --validate` | Check edges resolve, required fields present |
| `solid graph --query <sparql>` | Offline SPARQL BGP — SELECT + WHERE patterns |
| `solid graph --query <sparql> --server` | Full SPARQL 1.1 via backend (OPTIONAL/FILTER/UNION/property paths) |
| `solid graph --dump nquads` | Export as N-Quads — pipe to Fuseki, Neptune, GraphDB |
| `solid graph --dump turtle` | Export as Turtle (requires `--remote`) |
| `solid graph --diff <baseline.jsonld>` | What changed since X — added/removed/modified nodes + predicates |
| `--queue` | Offline mode — mutations write to `.solid/queue/*.jsonld` |
| `solid push --flush` | Replay queued offline mutations |

**Auto-magic:** lose wifi mid-mutation, the CLI auto-queues. Regain
wifi, the next mutation auto-replays the queue. Zero flags, zero
ceremony — `[QUEUED — offline]` and `[auto-flush]` lines on stderr
are your only signal.

**Dereferenceable IRIs** — every `@id` resolves:

```bash
curl -H 'Accept: application/ld+json' https://solidnumber.com/co/61/service/3
```

Returns the typed JSON-LD node. Public allowlist applied unless your
JWT matches the path's company.

### AI Discovery (llms.txt)
| Command | Description |
|---------|-------------|
| `solid llms preview` | Preview what AI shopping agents see |
| `solid llms check` | AI commerce readiness score |

### Analytics & SEO
| Command | Description |
|---------|-------------|
| `solid analytics dashboard` | Revenue, customers, transactions |
| `solid analytics mcp-traffic` | AI crawler traffic (ChatGPT, Claude, etc.) |
| `solid seo audit` | Full local SEO audit |
| `solid seo rank` | Search rankings |
| `solid seo citations` | Citation report |
| `solid seo gaps` | Open SEO gaps |
| `solid insights list` | AI-generated conversation insights |
| `solid insights approve <id>` | Approve and apply to KB |

### Operations
| Command | Description |
|---------|-------------|
| `solid accounting sync` | QuickBooks/Xero sync |
| `solid accounting status` | Sync connection status |
| `solid webhooks list` | List webhooks |
| `solid webhooks create <url>` | Create webhook |
| `solid support list` | Support tickets |
| `solid export` | Export all data (GDPR/backup) |

### Platform
| Command | Description |
|---------|-------------|
| `solid clone <template>` | Scaffold from 52 industry templates |
| `solid vibe "<instruction>"` | Natural language modifications |
| `solid docs` | Pull developer documentation |
| `solid health` | Platform health checks |
| `solid integrations` | Manage integrations |

### Agent Consciousness
| Command | Description |
|---------|-------------|
| `solid agent dashboard` | Full consciousness overview — status, telemetry, performance |
| `solid agent list` | List all agents with real-time status |
| `solid agent soul <agent>` | View agent's living soul — identity, emotions, growth stage |
| `solid agent reflect <agent>` | Reflection history — scores, trends, AI insights |
| `solid agent emotions` | Emotional state dashboard across all agents |
| `solid agent memory <agent>` | Persistent memory — learned context, behavioral patterns, tool expertise |
| `solid agent spiral` | Growth progression — agent development over time |
| `solid agent heartbeat [agent]` | Trigger consciousness cycle (or `--all` for all agents) |
| `solid agent dream <agent>` | Dream mode — autonomous processing of unresolved interactions |
| `solid agent mission "<prompt>"` | Multi-agent mission — ADA decomposes and coordinates |
| `solid agent telemetry` | Dragon telemetry — tokens, cost, latency, revenue attribution |

### Dev Tools
| Command | Description |
|---------|-------------|
| `solid dev` | Local development utilities |
| `solid droplet` | Infrastructure management |

## Workflow

```
1. solid pull                          → Download pages, KB, services
2. solid serve --open                  → Preview locally at localhost:4000
3. solid context --claude              → Give your AI full company knowledge
4. Edit files / solid import / vibe    → Make changes any way you want
5. solid diff                          → Preview what will change
6. solid push                          → Upload (drafts / unpublished)
7. solid publish --all                 → Go live
```

### Agency Workflow (Sandbox Mode)
```
1. solid pull                          → Get the client's site
2. solid sandbox create                → Fork into .sandbox/
3. solid serve --dir .sandbox          → Preview sandbox locally
4. solid import promo.html --page "Ad" → Add ChatGPT landing page
5. solid sandbox diff                  → Review all changes
6. solid sandbox push                  → Promote to main files
7. solid push                          → Upload (drafts / unpublished)
8. solid publish --all                 → Go live
```

## File Formats

After `solid pull`, your project looks like:

```
.solid/
├── manifest.json        # File → ID mappings
├── pages/
│   ├── home.json        # Page with layout_json sections
│   └── about.json
├── kb/
│   ├── hours.md         # Markdown with YAML frontmatter
│   └── services.md
└── settings/
    └── company.json     # Business settings
```

## Industry Templates

52 templates across 8 categories:

- **Home Services** — Plumber, HVAC, Electrician, Roofing, Landscaping...
- **Health & Wellness** — Dentist, Chiropractor, Med Spa, Veterinarian...
- **Food & Hospitality** — Restaurant, Bakery, Catering, Food Truck...
- **Professional Services** — Accountant, Law Firm, Insurance, Realtor...
- **Automotive** — Auto Repair, Car Wash, Detailing, Towing...
- **Tech & Digital** — IT Services, Web Agency, SaaS, Cybersecurity...
- **Education & Creative** — Tutoring, Photography, Music School...

```bash
solid clone --list          # Browse all templates
solid clone plumber         # Scaffold instantly
```

## MCP Editor Integration

Add to your Claude Code or Cursor MCP config:

```json
{
  "mcpServers": {
    "solid": {
      "command": "npx",
      "args": ["@solidnumber/cli", "mcp"]
    }
  }
}
```

## Security

### Credential storage

`solid auth login` writes your access token, refresh token, and company
context to `~/.solid/config.json` in **plaintext**. The file is `chmod 600`
(owner-readable only), but that's the only protection — anything running
as your UID can read it.

**On a shared or unattended machine:**

- Don't run `solid auth login` on it. Use an API key instead:
  ```bash
  export SOLID_TOKEN=sk_solid_xxx...   # (or SOLID_API_KEY)
  solid kb list
  ```
- Or pass per-invocation and never touch disk:
  ```bash
  solid --token sk_solid_xxx kb list
  ```
- Create short-lived, scoped keys for anything automated:
  ```bash
  solid auth token create -n "CI readonly" -s kb:read,pages:read -e 30
  ```

**On a dev laptop that might leak:**

- Rotate your token any time with `solid auth refresh`, or revoke all
  sessions with `solid auth logout --all-devices`.
- For agency operators: a compromised laptop is a multi-tenant breach —
  your CLI can touch every client company you've been invited to.
  Inventory your access with `solid company list` and drop what you
  don't need via the dashboard.

### Exit codes

| Code | Meaning |
|---:|---|
| `0` | Success — data is on stdout. |
| `1` | Runtime/user error — auth failed, server returned 4xx/5xx, target not found, user cancelled a confirmation. |
| `2` | Usage error — unknown flag, missing required argument, malformed value. |

### Stream discipline for scripts

- **stdout** = data only (`--json` payloads, command output).
- **stderr** = spinners, progress, warnings, errors.
- `solid X --json | jq` is always safe — the spinner writes to stderr.

Full contract: see the [Scripting Contract doc](https://github.com/Adam-Camp-King/solid-cli/blob/main/docs/SCRIPTING-CONTRACT.md) (or `Owners-Manual/45-Developer-CLI/21-SCRIPTING-CONTRACT.md` in the Solid# platform repo).

## Update notifier

When it says there's a new version, run:

```bash
solid update                  # bring everything Solid# on this machine current
solid update --check          # say what would happen, change nothing
solid update --json           # do it, and report it as JSON (for an agent)
solid update --check --json   # report only, as JSON
```

Besides the CLI it keeps the MCP server current: any AI-tool config (Claude
Desktop, Cursor, Windsurf, Claude Code — including per-project servers) that
launches a bare `@solidnumber/mcp`, which npx serves from its cache forever, is
switched to `@solidnumber/mcp@latest`, and a global npm install is upgraded. A
version someone pinned on purpose is left alone and reported. The MCP SDK ships
inside the server, so it moves with it.

It then brings everything else the CLI set up up to date: the Claude Code
session hook, your shell completion, the agent skills and plugin in every
project where you ran `solid agent setup`, and the render browser. The
freshly installed CLI does this part, so the files come from the new version.
Only what is already installed is refreshed; an update never adds something
you did not set up.

It works out how this copy was installed and runs the right thing —
`npm install -g`, `brew upgrade`, or `scoop update`. If that guess is wrong, or
the command fails, it tries the next way, and it calls the update done only
when the `solid` your shell runs reports the new version. You never have to
pick between commands. If Homebrew's formula has not caught up with npm yet
(it checks every 4 hours), it says so and does not put a second copy on top.
You only get a command to run yourself when every route has failed. It also warns when a
**second** `solid` is on your PATH at a different version: an npm global under
nvm in front of a Homebrew formula is easy to end up with, whichever comes
first in PATH wins, and upgrading one leaves the other lying in wait. The
notifier cannot see that — it only ever looks at the copy that is running.

The CLI checks npm once every **4 hours** for a newer release and prints
a boxed notice on the next run. Suppress it:

```bash
NO_UPDATE_NOTIFIER=1 solid …     # whole shell session
solid … --no-update-notifier     # single invocation
```

The check runs in a detached process, never blocks your command, and
writes to stderr so pipelines are unaffected.

## Requirements

- Node.js >= 20.0.0 (the one-paste installer above sets this up for you)
- A Solid# account ([solidnumber.com](https://solidnumber.com))

## Verb taxonomy

The 12 verb shapes (aggregate, explain, preview, suggest, transaction, receipt, revert, subscribe, discovery, trail, reputation, macro) are defined in the verb spec bundled with `@solidnumber/mcp`:

- **Spec docs:** [solidnumber.com/docs/spec](https://solidnumber.com/docs/spec) — shapes, manifest, transport, receipts, consent
- **Live manifest:** [`/api/v1/agent/verbs`](https://api.solidnumber.com/api/v1/agent/verbs) — every VerbRecord, filterable by `?surface=`
- **Docs:** [solidnumber.com/docs/verbs](https://solidnumber.com/docs/verbs)

The CLI is one of four transports projecting the same `UNIFIED_VERB_REGISTRY`. The spec defines the contract; this CLI is one implementation.

## License

[Business Source License 1.1](./LICENSE) (`BUSL-1.1`).

**Plain English:** read the source, run the CLI, build on top of the SDK,
ship internal tools, run it in production for your own business — all
permitted. What's not permitted: offering a substantially similar
command-line interface for managing AI-powered business infrastructure
as a competing commercial product or service.

On **2030-04-14** (the Change Date), this license converts automatically
to **Apache 2.0** and all restrictions drop. No "phone home" required.

The full license text and the additional use grant are in [LICENSE](./LICENSE).
Background on BSL: <https://mariadb.com/bsl11/>.
