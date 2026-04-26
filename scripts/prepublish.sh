#!/usr/bin/env bash
# Manual pre-publish safety check. Run before `npm publish` if you want
# a slower, more paranoid gate than CI alone.
#
#   prepublishOnly:    build + test + test:security + audit:prod + tarball smoke
#   this script adds:  clean dist/ before build + `npm pack --dry-run`
#                      (file-list visibility into what would actually ship)
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

# 2. Run the full prepublishOnly chain: build + test + test:security
#    + audit:prod + tarball install smoke + lazy-import scan.
echo "▸ Running prepublishOnly chain..."
npm run prepublishOnly

# 3. Pack dry-run — show the exact file list that would ship.
#    Note: `npm publish --dry-run` is unsafe to invoke from here because it
#    re-triggers `prepublishOnly`, which runs `npm pack` inside the active
#    publish process (exit 254). `npm pack --dry-run` skips lifecycle
#    scripts and just prints the file list.
echo ""
echo "▸ npm pack --dry-run (file list)..."
npm pack --dry-run 2>&1 | tail -10

echo ""
echo "═══════════════════════════════════════"
echo "  All checks passed. Safe to publish."
echo "  Run: npm publish --access public"
echo "═══════════════════════════════════════"
