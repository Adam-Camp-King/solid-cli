#!/bin/bash
set -euo pipefail

echo "╔═══════════════════════════════════════╗"
echo "║  Solid# CLI Pre-publish Safety Check  ║"
echo "╚═══════════════════════════════════════╝"
echo ""

# 1. Clean build
echo "▸ Building..."
rm -rf dist/
npm run build
echo "  ✓ Build succeeded"

# 2. Tests
echo "▸ Running tests..."
npm test -- --forceExit --detectOpenHandles 2>&1 | tail -5
echo "  ✓ Tests passed"

# 3. Version check
PKG_VERSION=$(node -p "require('./package.json').version")
BUILT_VERSION=$(node dist/index.js --version 2>/dev/null || echo "UNKNOWN")
if [ "$PKG_VERSION" != "$BUILT_VERSION" ]; then
  echo "  ✗ FAIL: package.json ($PKG_VERSION) != built CLI ($BUILT_VERSION)"
  exit 1
fi
echo "  ✓ Version consistent: $PKG_VERSION"

# 4. Canary: pack and install locally
echo "▸ Canary test..."
TARBALL=$(npm pack --silent)
npm install -g "./$TARBALL" --silent 2>/dev/null
INSTALLED_VERSION=$(solid --version 2>/dev/null || echo "UNKNOWN")
if [ "$PKG_VERSION" != "$INSTALLED_VERSION" ]; then
  echo "  ✗ FAIL: installed version ($INSTALLED_VERSION) != package ($PKG_VERSION)"
  npm uninstall -g @solidnumber/cli --silent 2>/dev/null
  rm -f "$TARBALL"
  exit 1
fi

# Verify core commands don't crash
solid --help > /dev/null 2>&1 || { echo "  ✗ FAIL: solid --help crashed"; exit 1; }
solid completion > /dev/null 2>&1 || { echo "  ✗ FAIL: solid completion crashed"; exit 1; }

npm uninstall -g @solidnumber/cli --silent 2>/dev/null
rm -f "$TARBALL"
echo "  ✓ Canary passed"

# 5. Dry run
echo "▸ npm publish --dry-run..."
npm publish --dry-run --access public 2>&1 | tail -3
echo "  ✓ Dry run passed"

echo ""
echo "═══════════════════════════════════════"
echo "  All checks passed. Safe to publish."
echo "  Run: npm publish --access public"
echo "═══════════════════════════════════════"
