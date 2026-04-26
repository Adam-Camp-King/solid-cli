#!/usr/bin/env bash
# Manual pre-publish safety check. Run before `npm publish` if you want
# the full belt-and-suspenders gate.
#
#   prepublishOnly (auto on `npm publish`):
#       build + test + test:security + audit:prod + verify:deps
#       (verify:deps is a STATIC dep check — safe inside npm publish)
#
#   this script adds:
#       clean dist/  — no stale artifacts ride into the tarball
#       test:tarball — actual `npm pack` + `npm install` + boot smoke
#                      (deeper than verify:deps; can't run inside
#                       `npm publish` because of npm's recursion lock)
#       npm pack --dry-run  — file-list visibility into what would ship
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "╔═══════════════════════════════════════╗"
echo "║  Solid# CLI Pre-publish Safety Check  ║"
echo "╚═══════════════════════════════════════╝"
echo ""

# 1. Clean dist/ — guarantee no stale artifacts ride along into the tarball.
echo "▸ Clean dist/..."
rm -rf dist/
echo "  ✓ Clean"

# 2. Run the full prepublishOnly chain (build + tests + audit + verify:deps).
echo "▸ Running prepublishOnly chain..."
npm run prepublishOnly

# 3. Tarball install smoke — actual pack + install + boot in a clean tmpdir.
#    Deeper than verify:deps's static check. Safe here because we're not
#    inside an outer `npm publish` — no recursion lock.
echo ""
echo "▸ Tarball install smoke..."
npm run test:tarball

# 4. Pack dry-run — show the exact file list that would ship.
#    `npm publish --dry-run` would re-trigger prepublishOnly (and now also
#    test:tarball indirectly if we re-added it there) — `npm pack --dry-run`
#    skips lifecycle scripts and just prints the file list.
echo ""
echo "▸ npm pack --dry-run (file list)..."
npm pack --dry-run 2>&1 | tail -10

echo ""
echo "═══════════════════════════════════════"
echo "  All checks passed. Safe to publish."
echo "  Run: npm publish --access public"
echo "═══════════════════════════════════════"
