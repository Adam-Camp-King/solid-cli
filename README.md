# @solidnumber/cli

**Solid# CLI — AI Business Infrastructure from the terminal.**

Build, train, and deploy AI-powered businesses without leaving your editor.

## Install

```bash
npm install -g @solidnumber/cli
```

Or run without installing:

```bash
npx @solidnumber/cli
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
1. solid pull      → Download pages, KB, services
2. solid context   → Give your AI full company knowledge
3. Edit files      → VS Code, Cursor, any editor (AI-assisted)
4. solid push      → Deploy changes instantly
5. solid vibe      → "Add a hero section" (natural language)
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

## Requirements

- Node.js >= 18.0.0
- A Solid# account ([solidnumber.com](https://solidnumber.com))

## License

MIT
