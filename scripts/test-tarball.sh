#!/usr/bin/env bash
# Tarball install smoke. Catches the v2.1.0-class miss: `prepublishOnly`'s
# `npm test` runs against the dev tree (where every dep is installed via
# devDependencies), so a runtime dep missing from `dependencies` ships
# undetected. Here we pack, install into a clean tmpdir, exercise commands
# that lazy-load risky deps, and statically resolve every `import('<pkg>')`
# in the installed dist/.
#
# Run manually:   bash scripts/test-tarball.sh
# Wired into:     `prepublishOnly` (package.json) + CI (.github/workflows)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Build first — the tarball ships dist/, not src/.
echo "▸ Building..."
npm run build --silent

echo "▸ Packing tarball..."
TARBALL="$(npm pack --silent | tail -n1)"
TARBALL_ABS="$ROOT/$TARBALL"

WORKDIR="$(mktemp -d -t solid-cli-tarball-XXXXXX)"
cleanup() {
  rm -rf "$WORKDIR"
  rm -f "$TARBALL_ABS"
}
trap cleanup EXIT

echo "▸ Installing into clean tmpdir..."
cd "$WORKDIR"
npm init -y >/dev/null
# --no-audit/--no-fund: keep output clean. --silent: suppress progress.
npm install "$TARBALL_ABS" --silent --no-audit --no-fund

CLI="$WORKDIR/node_modules/.bin/solid"
if [ ! -x "$CLI" ]; then
  echo "✗ FAIL: $CLI not present after install"
  exit 1
fi

echo "▸ Boot smoke..."
"$CLI" --version >/dev/null
"$CLI" --help >/dev/null

# Subcommand --help. Catches eager-import bugs: any top-level `import` in a
# command file that pulls a missing dep crashes here. (v2.1.0 was lazy so
# --help didn't catch it — that's what scan-lazy-imports.mjs handles below.)
echo "▸ Subcommand help smoke..."
HELP_TARGETS=(
  "audit --help"
  "audit a11y --help"
  "audit perf --help"
  "audit mobile --help"
  "render --help"
  "graph --help"
  "completion"
)
for cmd in "${HELP_TARGETS[@]}"; do
  # shellcheck disable=SC2086
  if ! "$CLI" $cmd >/dev/null 2>&1; then
    echo "  ✗ FAIL: solid $cmd"
    "$CLI" $cmd || true
    exit 1
  fi
done
echo "  ✓ ${#HELP_TARGETS[@]} subcommands booted"

echo "▸ Lazy-import resolution scan..."
node "$ROOT/scripts/scan-lazy-imports.mjs" "$WORKDIR"

echo ""
echo "✅ Tarball install smoke passed."
