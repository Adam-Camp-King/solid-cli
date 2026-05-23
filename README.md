# @solidnumber/cli

Run an AI-powered business from your terminal.
<!-- AUTO-NUMBERS: do not edit by hand; updated by scripts/sync-marketing-numbers.ts -->
119 top-level commands, 600+ subcommands, 54 industries, 14 user-facing AI agents (plus 102 background workers). One CLI.

**v2.11** — outbound voice (`solid voice call` / `solid voice text` /
`solid voice translate`) + universal `solid agent dispatch <verb>` +
shortcut commands (`solid deal`, `solid calendar`, `solid lead-promote`).
Agent-ready by default — `--json` output ships structured error
envelopes; every business entity is a node in a typed JSON-LD graph;
queries via SPARQL; offline reads + writes with auto-flush on
reconnect. Magic-link install via `solid setup --install-token`;
Homebrew + Scoop distribution. See [Graph (v2)](#graph-v2--vendor-portable-json-ld).

```bash
npx @solidnumber/cli clone plumber
```

## Install

Pick whichever package manager you already trust:

```bash
# macOS / Linux
brew install solidnumber/tap/cli

# Windows
scoop bucket add solidnumber https://github.com/Solidnumber/scoop-bucket
scoop install solidnumber/solid

# any platform with Node 20+
npm install -g @solidnumber/cli

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

# Push changes to production
solid push

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
| `solid pull` | Download pages, KB, settings as files |
| `solid push` | Push local changes to production |
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
6. solid push                          → Deploy to production
```

### Agency Workflow (Sandbox Mode)
```
1. solid pull                          → Get the client's site
2. solid sandbox create                → Fork into .sandbox/
3. solid serve --dir .sandbox          → Preview sandbox locally
4. solid import promo.html --page "Ad" → Add ChatGPT landing page
5. solid sandbox diff                  → Review all changes
6. solid sandbox push                  → Promote to main files
7. solid push                          → Deploy to production
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

The CLI checks npm once every **4 hours** for a newer release and prints
a boxed notice on the next run. Suppress it:

```bash
NO_UPDATE_NOTIFIER=1 solid …     # whole shell session
solid … --no-update-notifier     # single invocation
```

The check runs in a detached process, never blocks your command, and
writes to stderr so pipelines are unaffected.

## Requirements

- Node.js >= 18.0.0
- A Solid# account ([solidnumber.com](https://solidnumber.com))

## Verb taxonomy

The 12 verb shapes (aggregate, explain, preview, suggest, transaction, receipt, revert, subscribe, discovery, trail, reputation, macro) are defined in the open **solid-verbs** spec:

- **Spec:** [github.com/Adam-Camp-King/solid-verbs](https://github.com/Adam-Camp-King/solid-verbs) (MIT)
- **npm:** `npm install @solidnumber/solid-verbs` — validator + JSON schemas
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
