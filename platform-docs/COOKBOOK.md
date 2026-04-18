# Solid CLI Cookbook

Real scenarios. Copy-paste-runnable. All examples assume `@solidnumber/cli` is installed (`npm i -g @solidnumber/cli`) and you either have a cached session (`solid auth login`) or an API key in `SOLID_API_KEY` / `SOLID_TOKEN`.

Every recipe obeys the [Scripting Contract](https://github.com/Adam-Camp-King/solid-cli/blob/main/README.md#security) — stdout is data, stderr is chrome, exit codes mean "did it work."

## Verification status (2026-04-18, v1.9.16)

Each scenario below lists what's been run end-to-end on the installed binary:

| # | Scenario | Verified |
|---|---|---|
| 1 | Agency onboarding | Shape only (destructive — creates a real company) |
| 2 | Bulk migrate contacts | ✅ Full flow with `--dry-run` + real import |
| 3 | CI/CD pipeline | Commands individually, not the full pipeline |
| 4 | Claude Code context | ✅ `solid context --tools-only --json` verified |
| 5 | Safe production playbook | ✅ `--dry-run`, `--preview`, `SOLID_DRY_RUN=1` verified |
| 6 | Cross-company reporting | ✅ `solid switch --list --json` pipes correctly |
| 7 | Incident response | Commands verified (`audit --since`, `auth token list`). `logout --all-devices` + `members revoke` not run — destructive. |
| 8 | Export to spreadsheet | ✅ `--format csv`, `--output <file>` verified |
| 9 | Chain execute + poll | `chains list --json` ✅. Full poll loop requires a real chain. |
| 10 | Wrapping from other languages | Syntax only — no runtime execution |

---

## Table of contents

1. [Agency onboarding — from zero to a live client](#1-agency-onboarding)
2. [Bulk migrate contacts from GHL / HubSpot / CSV](#2-bulk-migrate-contacts)
3. [CI/CD — deploy a page change with rollback on failure](#3-cicd-deploy-a-page-change)
4. [Agent task — let Claude Code read current tenant state](#4-agent-task-claude-code-context)
5. [Safe production playbook — dry-run, preview, ship](#5-safe-production-playbook)
6. [Cross-company reporting — iterate every client](#6-cross-company-reporting)
7. [Incident response — revoke and rotate](#7-incident-response)
8. [Export-to-spreadsheet workflows](#8-export-to-spreadsheet)
9. [Chain execution and polling](#9-chain-execution-and-polling)
10. [Building your own wrapper — Bun/Deno/Go/shell](#10-building-your-own-wrapper)

---

## 1. Agency onboarding

Provision a new company on behalf of a client, lock it down, invite them,
then hand off just the pieces they should touch.

```bash
# 1. Create the company (every area locked by default, owner invite emailed)
solid company create-for-client \
  --name "Joe's Plumbing" \
  --client-email joe@joesplumbing.com \
  --industry plumber \
  --json > /tmp/joe.json

COMPANY_ID=$(jq -r .company_id /tmp/joe.json)

# 2. Switch into the new company
solid switch $COMPANY_ID

# 3. Do the setup that only the agency should do
solid brand set --logo ./joes-logo.png --favicon ./joes-favicon.ico
solid pages publish home --yes
solid domains add joesplumbing.com

# 4. Open specific areas the client CAN self-edit
solid company unlock $COMPANY_ID --area pages

# 5. Audit what happened (for the agency log)
solid audit --since 1h --json > /tmp/joe-setup.json
```

Rollback if anything looks wrong:

```bash
solid company lock $COMPANY_ID --area pages  # re-lock
solid history pages home        # inspect versions
solid rollback page home --to 1 --yes
```

---

## 2. Bulk migrate contacts

From a CSV export (GHL, HubSpot, or a spreadsheet). Headers auto-map for
`First Name`, `Last Name`, `Email`, `Phone`, `Company` — override for the
oddballs with `--map`.

```bash
# Dry-run first — parses the file, reports what would happen, no writes
solid crm contacts import ./ghl-export.csv --dry-run --json > /tmp/plan.json

# Eyeball the plan
jq '.summary' /tmp/plan.json
# {
#   "total": 1847,
#   "created": 0,
#   "failed": 0,
#   "skipped": 12,         <- rows missing both name and contact fields
#   "dry_run": true
# }

# See which rows would skip
jq '.results[] | select(.status == "skipped") | .row' /tmp/plan.json

# Ship it
solid crm contacts import ./ghl-export.csv --json > /tmp/result.json
echo "Imported: $(jq .summary.created /tmp/result.json)"
```

Orders follow the same pattern:

```bash
solid ecommerce orders import ./orders.csv \
  --map "Customer=customer_email,Amount=total,Ref=reference" \
  --stop-on-error
```

---

## 3. CI/CD — deploy a page change

Shell script you'd drop in a CI workflow. Exit codes drive the pipeline.

```bash
#!/usr/bin/env bash
set -euo pipefail

# Authenticate with an automation key (never interactive in CI)
export SOLID_TOKEN="$SOLID_CI_TOKEN"

# 1. Dry-run everything
echo "==> Preview changes"
solid --dry-run push
DRY_EXIT=$?

if [[ "$DRY_EXIT" -ne 0 ]]; then
  echo "Dry-run failed — aborting" >&2
  exit 1
fi

# 2. Push for real
echo "==> Pushing"
solid push --yes

# 3. Smoke test the critical endpoints
for slug in home services contact; do
  solid pages get $slug --json > /tmp/$slug.json
  STATUS=$(jq -r .is_published /tmp/$slug.json)
  if [[ "$STATUS" != "true" ]]; then
    echo "Page $slug not published — rolling back" >&2
    solid rollback page $slug --to $(( $(jq -r .current_version /tmp/$slug.json) - 1 )) --yes
    exit 1
  fi
done

echo "==> Shipped"
```

The key moves: `SOLID_TOKEN` in env, `--yes` on destructive ops, `--json`
into `jq` for decisions, `exit 1` on the rollback path.

---

## 4. Agent task — Claude Code context

Give an AI agent everything it needs to operate this tenant without
shell-piping a dozen separate commands.

```bash
# Writes .claude/CLAUDE.md + .claude/solid-context.json into the current dir.
# Includes: company info, active site, page list, KB categories, lock state,
# draft/published counts, recent audit, every CLI verb with scope + mutates flag.
solid context --claude
```

For Cursor: `solid context --cursor` (writes `.cursorrules`).

For an MCP server wrapping this CLI: `solid context --tools-only --json`
flattens every command to `{ verb, scope, mutates, description }`.

If the agent is sandboxed with its own API key:

```bash
solid auth token create \
  -n "Claude Code $(date +%Y-%m-%d)" \
  -s kb:read,pages:read,contacts:read \
  -e 7 \
  --json > /tmp/key.json

export SOLID_TOKEN=$(jq -r .key /tmp/key.json)
```

Now the agent has read-only access for a week. For scripted use, the
CLI also honors `SOLID_TOKEN=<key>` and `SOLID_API_KEY=<key>` env vars —
either takes precedence over the cached session for that process.

**Not yet shipped (don't reference in agent code yet):** a per-key
`require_approval` flag that queues every destructive call for a
human OK before firing. It's on the roadmap but does NOT exist on
`solid auth token create` today.

---

## 5. Safe production playbook

Three flags handle 95% of prod risk:

| Flag | What it does |
|------|--------------|
| `--dry-run` | Blocks every POST/PUT/PATCH/DELETE before it leaves the process. GETs still run. Prints `[DRY] <METHOD> <url>`. |
| `--yes` | Skip confirmation prompts on destructive ops. For CI only. |
| `SOLID_DRY_RUN=1` | Gate a whole shell session in dry-run. |

```bash
# Preview a full push
SOLID_DRY_RUN=1 solid push

# Preview a single dangerous operation
solid --dry-run droplet destroy my-client

# Preview an SMS (no send, no prompt)
solid payment-links text2pay --phone +15551234567 --amount 49.00 --preview
```

---

## 6. Cross-company reporting

Loop every company you have access to and aggregate. Pair with `--json`
and `jq -s` to stream results into a single artifact.

```bash
solid switch --list --json | jq -r '.companies[].id' | while read id; do
  solid switch $id
  solid analytics dashboard --period 30 --json
done | jq -s '[ .[] | { company_id: .company_id, revenue: .revenue, txns: .transactions } ]' \
     > /tmp/revenue-all.json

# Top 10 by revenue
jq 'sort_by(-.revenue) | .[:10]' /tmp/revenue-all.json
```

---

## 7. Incident response

A laptop walked off. A token got logged somewhere. A contractor's access
needs to vanish right now.

```bash
# Kill every session server-side (revokes the refresh token)
solid auth logout --all-devices --yes

# Rotate the stored access token on this machine
solid auth refresh

# Audit what's happened recently on this tenant
solid audit --since 24h --json | jq '[.events[] | { ts, actor, method, path, status }]'

# Revoke a specific API key
solid auth token list --json | jq '.api_keys[] | select(.name | test("contractor"))'
solid auth token revoke 47

# Remove a team member from this company
solid company members revoke <user_id> --yes
```

Agency operators: the radius of a leaked CLI is every company you've been
invited to. Inventory with `solid company list --json` before doing
anything else.

---

## 8. Export to spreadsheet

Every list command emits CSV (or TSV) with `--format`. No `jq -r` gymnastics.

```bash
# Contacts → Numbers / Excel
solid crm contacts list --all --format csv > contacts.csv

# Orders, only active, sorted by total descending
solid ecommerce orders list --all --sort-by total --order desc --format csv \
  > orders-by-value.csv

# Deals for a specific stage, TSV for Google Sheets paste
solid crm deals list --stage negotiation --all --format tsv | pbcopy
```

Or send the raw JSON payload to disk with `--output`:

```bash
solid kb list --json --output ./kb-snapshot.json
solid reports run sales_overview_daily --days 90 --json --output ./90d.json
```

---

## 9. Chain execution and polling

Chains are async. `execute` returns an execution_id you can poll.

```bash
# Kick off
EXEC=$(solid chains execute 42 --input '{"customer_id": 128}')
# EXEC is just the execution_id on stdout

# Poll every 5s until terminal
while :; do
  STATUS=$(solid chains execution $EXEC --json | jq -r .status)
  echo "$(date +%H:%M:%S)  $STATUS"
  case "$STATUS" in
    completed|failed|cancelled) break ;;
  esac
  sleep 5
done

# Inspect the final result
solid chains execution $EXEC --json > final.json
jq '.results[] | select(.status == "failed")' final.json
```

---

## 10. Building your own wrapper

The CLI is a portable Node.js binary, but if you're in Go or Bun or shell,
just shell out. Every guarantee in the [Scripting Contract](https://github.com/Adam-Camp-King/solid-cli#security) holds:

### Bun / Deno / Node.js

```ts
const { stdout } = await new Response(
  Bun.spawn(['solid', 'kb', 'list', '--json']).stdout
).json();
// stdout is the raw backend payload, typed per SCHEMAS.md
```

### Go

```go
out, err := exec.Command("solid", "kb", "list", "--json").Output()
if err != nil { /* exit code 1 = backend error, 2 = usage */ }
```

### Python

```python
import subprocess, json
r = subprocess.run(["solid", "kb", "list", "--json"],
                   capture_output=True, text=True, check=True)
data = json.loads(r.stdout)
```

### Shell (POSIX)

```sh
# `-e` so a non-zero exit from solid kills the script
set -e
solid kb list --json | jq '.entries[] | select(.category == "pricing")'
```

### MCP server (wrap CLI as tools)

`solid context --tools-only --json` gives you the full command manifest
(`verb`, `path-args`, `query-args`, `mutates`, `description`) — feed it
into your MCP server's tool registration loop and you've got a
company-scoped MCP endpoint that mirrors every CLI verb.

---

## Gotchas

- **Empty stdout on `--json`** — some commands emit nothing on stdout when there's no result, so `--count` their stderr or check exit code. `solid company current --json` always emits `{ company_id, email }`.
- **`solid --dry-run push`** still writes the local `.solid/manifest.json` cache; the flag only gates the HTTP layer.
- **`solid crm contacts import`** is client-side (POST /contacts in a loop). Backend bulk endpoint is on the roadmap; until then, expect `total/60` seconds on a clean run.
- **`solid chains execute`** prints the job id to stdout *and* a hint to stderr. In a pipe, only the id reaches the next command.
- **CSV quoting** — the `--format csv` writer double-quotes any cell with `,`, `"`, or newline and escapes embedded `"`. `--format tsv` strips tabs/newlines from cells (TSV can't quote).
