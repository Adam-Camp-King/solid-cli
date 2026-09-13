#!/usr/bin/env bash
# sprint-check.sh — acceptance harness for the Solid# CLI agent sprint (VNP).
#
# Read-only. Every write is --dry-run. Run it before and after; the score is the
# deliverable. A sprint you cannot re-run is a story.
#
# ⛔ WHAT THIS HARNESS REFUSES TO DO, and why every line of it is shaped by that:
#
#   1. It never asserts that a KEY EXISTS. The registry published a
#      `dispatch_endpoint` for 272 verbs pointing at a route that does not
#      exist, and every test passed, because they checked the key was set. Each
#      check below asks "does this resolve / run / filter", never "is it there".
#
#   2. It never trusts an HTTP status. controllers/ada.py catches any verb
#      exception and answers 200 with `ok:false`, so VNP's own T1 criteria
#      (200 · 422 · 403 = pass) score a 100%-broken verb green. Two routes on
#      this surface were broken on every call for months and nothing went red.
#      Checks read the BODY.
#
#   3. It never validates `required[]` literally. `company_id` is in most verbs'
#      required arrays and is injected from auth, so a literal reading turns
#      "the dry run always says yes" into "always says no". 2.3 is probed with a
#      TYPE error, which has no such ambiguity.
#
#   4. Every check that can be vacuous carries a denominator. A filter that
#      returns nothing and a filter that does not exist look identical from the
#      outside, so a subset check asserts 0 < n < total, never just "n".
#
# Usage: bash scripts/sprint-check.sh [--verbose]
#   SOLID_BIN=node dist/index.js   to score a local build instead of the
#                                  installed `solid` (the default).
set -uo pipefail
export SOLID_NO_TENANT_WARN=1

VERBOSE=${1:-}
SOLID_BIN=${SOLID_BIN:-solid}
PASS=0; FAIL=0; RESULTS=()

# Run the CLI under test. Word-splitting SOLID_BIN is deliberate: it may be
# "node dist/index.js", which is two words.
# shellcheck disable=SC2086
solidx() { $SOLID_BIN "$@"; }

ck() { # ck <id> <description> <0=pass|1=fail> [detail]
  if [ "$3" -eq 0 ]; then PASS=$((PASS+1)); RESULTS+=("PASS|$1|$2|${4:-}")
  else FAIL=$((FAIL+1)); RESULTS+=("FAIL|$1|$2|${4:-}"); fi
  [ -n "$VERBOSE" ] && printf '  %s %-6s %s %s\n' "$([ "$3" -eq 0 ] && echo ✓ || echo ✗)" "$1" "$2" "${4:-}" >&2
  return 0
}

# Dotted-path read out of JSON on stdin. Empty string for absent/unparseable —
# so a check can distinguish "false" from "not there" by testing -z separately.
jq_get() {
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const v=process.argv[1].split(".").reduce((a,k)=>a==null?a:a[k],o);console.log(v===undefined||v===null?"":(typeof v==="object"?JSON.stringify(v):String(v)))}catch(e){console.log("")}})' "$1"
}

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

DISPATCH_VERB=ai_employees_list   # a dispatch-transport verb (ADA registry)
PAIR_VERB=blog_publish            # the non-canonical half of a duplicate pair
BROKEN_ONCE=nest.outcomes         # broken on 100% of calls, 2026-05-23 → 09-12

# ═══════════ PHASE 0 — every verb is reachable, or says why not ═══════════

# 0.1 — transport is declared AND is one of the three legal values. "Set to
#       something" is not the assertion; "set to something the router honours" is.
TR=$(solidx verbs describe "$DISPATCH_VERB" 2>/dev/null | jq_get transport)
case "$TR" in
  http|dispatch|mcp) ck 0.1 "transport is declared and legal" 0 "$TR" ;;
  "")                ck 0.1 "transport is declared and legal" 1 "no transport field" ;;
  *)                 ck 0.1 "transport is declared and legal" 1 "unknown value: $TR" ;;
esac

# 0.2 — the published dispatch address RESOLVES. This is the check that would
#       have caught /api/v1/agent/cli-dispatch: the key was present and wrong.
solidx verbs invoke "$DISPATCH_VERB" -p '{}' >"$TMP/d0.json" 2>/dev/null
D0RC=$?; D0ERR=$(jq_get error.code <"$TMP/d0.json"); D0OK=$(jq_get ok <"$TMP/d0.json")
if [ "$D0ERR" = "NOT_FOUND" ]; then
  ck 0.2 "a dispatch verb actually dispatches" 1 "bare NOT_FOUND — the address 404s"
elif [ "$D0OK" = "false" ]; then
  ck 0.2 "a dispatch verb actually dispatches" 1 "routed, but the verb raised (ok:false)"
elif [ $D0RC -eq 0 ] && [ -s "$TMP/d0.json" ]; then
  ck 0.2 "a dispatch verb actually dispatches" 0 "routed and returned"
else
  ck 0.2 "a dispatch verb actually dispatches" 1 "exit=$D0RC code=${D0ERR:-none}"
fi

# 0.3 — same_as names a verb that EXISTS. A dangling link is worse than none:
#       it sends an agent to a second dead end.
SA=$(solidx verbs describe "$PAIR_VERB" 2>/dev/null | jq_get same_as)
if [ -z "$SA" ]; then
  ck 0.3 "duplicate pairs name a twin that exists" 1 "unlinked twins"
else
  TWIN=$(solidx verbs describe "$SA" 2>/dev/null | jq_get name)
  [ "$TWIN" = "$SA" ] \
    && ck 0.3 "duplicate pairs name a twin that exists" 0 "→ $SA" \
    || ck 0.3 "duplicate pairs name a twin that exists" 1 "same_as=$SA does not resolve"
fi

# 0.4 — the two routes that answered 200 while failing on every call. Asserted
#       on the BODY, which is the whole point of correction C1.
solidx verbs invoke "$BROKEN_ONCE" -p '{}' >"$TMP/n.json" 2>/dev/null
NOK=$(jq_get ok <"$TMP/n.json"); NREASON=$(jq_get error.reason <"$TMP/n.json")
[ "$NOK" != "false" ] \
  && ck 0.4 "$BROKEN_ONCE runs (body, not status)" 0 "" \
  || ck 0.4 "$BROKEN_ONCE runs (body, not status)" 1 "ok:false — ${NREASON:-raised}"

# ═══════════ PHASE 1 — nothing lies and nothing loops ═══════════

solidx verbs list >"$TMP/vl.json" 2>/dev/null
VL_BYTES=$(wc -c <"$TMP/vl.json" | tr -d ' ')
TOTAL=$(jq_get total <"$TMP/vl.json"); [ -z "$TOTAL" ] && TOTAL=$(jq_get count <"$TMP/vl.json")

# 1.1 — compact on a pipe. Two-space indentation at the start of a line is the
#       signature of JSON.stringify(_, null, 2).
if grep -q '^  "' "$TMP/vl.json"; then
  ck 1.1 "compact JSON on a non-TTY" 1 "still pretty-printed"
else
  ck 1.1 "compact JSON on a non-TTY" 0 "${VL_BYTES}B ≈ $((VL_BYTES/4)) tok"
fi

# 1.2 — a 4xx is the caller's fault. Both halves: not retryable, and a code that
#       says "fix your call" rather than SERVER_ERROR.
solidx verbs list --tier bogusXYZ >"$TMP/e4.json" 2>/dev/null
R=$(jq_get error.retryable <"$TMP/e4.json"); RC4=$(jq_get error.code <"$TMP/e4.json")
{ [ "$R" = "false" ] && [ "$RC4" != "SERVER_ERROR" ] && [ -n "$RC4" ]; } \
  && ck 1.2 "4xx is not retryable, and is a client code" 0 "$RC4" \
  || ck 1.2 "4xx is not retryable, and is a client code" 1 "retryable=$R code=${RC4:-none}"

# 1.3 — a preview needs no consent.
solidx verbs invoke contact.create -p '{"name":"Probe"}' --dry-run >"$TMP/d.json" 2>/dev/null
D3RC=$?; D3=$(jq_get dry_run <"$TMP/d.json")
{ [ $D3RC -eq 0 ] && [ "$D3" = "true" ]; } \
  && ck 1.3 "--dry-run needs no --confirm" 0 "" \
  || ck 1.3 "--dry-run needs no --confirm" 1 "exit=$D3RC dry_run=${D3:-absent}"

# 1.4 — --tier is accepted AND narrows. A filter that returns everything is not
#       a filter; a denominator is the only way to tell.
T=$(solidx verbs list --tier starter 2>/dev/null | jq_get count)
if [ -z "$T" ] || [ -z "$TOTAL" ]; then
  ck 1.4 "--tier accepted and narrows" 1 "tier=${T:-rejected} of ${TOTAL:-?}"
elif [ "$T" -gt 0 ] && [ "$T" -le "$TOTAL" ]; then
  ck 1.4 "--tier accepted and narrows" 0 "$T of $TOTAL"
else
  ck 1.4 "--tier accepted and narrows" 1 "$T of $TOTAL"
fi

# 1.5 — a preview must not claim to be a completed write. Probed WITH --confirm
#       so 1.3 failing cannot mask it.
solidx verbs invoke contact.create -p '{"name":"Probe"}' --confirm --dry-run >"$TMP/dc.json" 2>/dev/null
S=$(jq_get success <"$TMP/dc.json")
[ "$S" != "true" ] \
  && ck 1.5 "no success:true in a dry run" 0 "" \
  || ck 1.5 "no success:true in a dry run" 1 "success=true"

# ═══════════ PHASE 2 — find it, then safely attempt it ═══════════

# 2.1 — find exists AND ranks. "Returned something" is not the bar: the top
#       match for a refund has to be about refunding.
solidx find "refund a payment" >"$TMP/f.json" 2>/dev/null
TOP=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);console.log((o.matches||[])[0]?.[0]||"")}catch(e){console.log("")}})' <"$TMP/f.json")
F_BYTES=$(wc -c <"$TMP/f.json" | tr -d ' ')
case "$TOP" in
  *refund*) ck 2.1 "find ranks the right verb first" 0 "$TOP · $((F_BYTES/4)) tok" ;;
  "")       ck 2.1 "find ranks the right verb first" 1 "no such command, or no matches" ;;
  *)        ck 2.1 "find ranks the right verb first" 1 "top match was $TOP" ;;
esac

# 2.2 — the default tier. 150KB ≈ 37K tokens: comfortably inside a window,
#       which is the property that matters, not a byte count.
{ [ -n "$VL_BYTES" ] && [ "$VL_BYTES" -lt 150000 ] && [ "$VL_BYTES" -gt 1000 ]; } \
  && ck 2.2 "verbs list defaults to an index" 0 "${VL_BYTES}B ≈ $((VL_BYTES/4)) tok" \
  || ck 2.2 "verbs list defaults to an index" 1 "${VL_BYTES}B ≈ $((VL_BYTES/4)) tok"

# 2.3 — the dry run validates. Probed with a TYPE error, never a missing
#       required field: see refusal 3 at the top of this file.
solidx verbs invoke contact.create -p '{"name":12345}' --confirm --dry-run >"$TMP/v.json" 2>/dev/null
V3RC=$?; VA=$(jq_get valid <"$TMP/v.json"); TE=$(jq_get type_errors <"$TMP/v.json")
{ [ "$VA" = "false" ] && [ "$TE" != "[]" ] && [ -n "$TE" ] && [ $V3RC -ne 0 ]; } \
  && ck 2.3 "dry run catches a wrong type" 0 "$TE" \
  || ck 2.3 "dry run catches a wrong type" 1 "valid=$VA exit=$V3RC type_errors=${TE:-absent}"

# 2.4 — an unknown command answers on stdout, in JSON, with a real suggestion.
solidx contacts >"$TMP/u.json" 2>/dev/null
UCODE=$(jq_get error.code <"$TMP/u.json"); DYM=$(jq_get error.did_you_mean <"$TMP/u.json")
{ [ -n "$UCODE" ] && [ -n "$DYM" ] && [ "$DYM" != "[]" ]; } \
  && ck 2.4 "unknown command → JSON + did_you_mean" 0 "$UCODE $DYM" \
  || ck 2.4 "unknown command → JSON + did_you_mean" 1 "code=${UCODE:-none} did_you_mean=${DYM:-none}"

# 2.5 — errors carry a fix, and the fix RESOLVES. The 403 hint named
#       `solid upgrade` for months; a fix that fails when run is worse than none.
#
#       ⛔ Probed on the paths that MUST carry one. An absent fix is legal —
#       BAD_REQUEST and NOT_FOUND have no honest one-liner and deliberately omit
#       the key, so probing those and calling it a failure would be scoring the
#       design as a bug. The two paths where the CLI genuinely knows the next
#       command are the unknown-command envelope and dry-run validation.

# Resolve a fix string's command against commander. ⛔ NOT the exit code:
# --help exits 0 for a path that does not exist and prints the nearest parent's
# help, so `solid upgrade --help` and `solid verbs nonexistent --help` both
# succeed. The Usage line is the only honest signal — a resolved path echoes
# itself, an unresolved one falls back to its parent.
fix_resolves() {
  local fix="$1" words usage
  [ -z "$fix" ] && return 1
  words=$(node -e 'const f=process.argv[1];const i=f.lastIndexOf("solid ");const w=i<0?[]:f.slice(i+6).trim().split(/\s+/);const k=[];for(const x of w){if(x.startsWith("-")||x.includes(".")||x.includes("<"))break;k.push(x)}console.log(k.join(" "))' "$fix")
  [ -z "$words" ] && return 1
  # shellcheck disable=SC2086
  usage=$(solidx $words --help 2>&1 | head -1)
  case "$usage" in
    "Usage: solid $words "*|"Usage: solid $words") return 0 ;;
    *) return 1 ;;
  esac
}

FX_UNKNOWN=$(jq_get error.fix <"$TMP/u.json")
FX_VALID=$(jq_get fix <"$TMP/v.json")
if [ -z "$FX_UNKNOWN" ] || [ -z "$FX_VALID" ]; then
  ck 2.5 "errors carry a fix that resolves" 1 "unknown-command fix=${FX_UNKNOWN:-none} · dry-run fix=${FX_VALID:-none}"
elif ! fix_resolves "$FX_UNKNOWN"; then
  ck 2.5 "errors carry a fix that resolves" 1 "'$FX_UNKNOWN' does not resolve"
elif ! fix_resolves "$FX_VALID"; then
  ck 2.5 "errors carry a fix that resolves" 1 "'$FX_VALID' does not resolve"
else
  ck 2.5 "errors carry a fix that resolves" 0 "$FX_UNKNOWN · $FX_VALID"
fi

# 2.6 — one list shape on every transport. Asked of a DISPATCH verb, because
#       the first fix reached 573 verbs and missed exactly these 272.
for k in items total page has_more; do
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const r=o.result||o;process.exit(Object.prototype.hasOwnProperty.call(r,process.argv[1])?0:1)}catch(e){process.exit(1)}})' "$k" <"$TMP/d0.json" || { MISSING="$k"; break; }
done
if [ -n "${MISSING:-}" ]; then
  ck 2.6 "envelope parity on the dispatch transport" 1 "no '$MISSING' on a dispatch list"
else
  ck 2.6 "envelope parity on the dispatch transport" 0 "items/total/page/has_more"
fi

# ═══════════ PHASE 3 — the surface is addressable ═══════════

# 3.1 — every verb carries a coordinate, and it is the two digits the Atlas
#       actually assigns. Three would mean an ordinal crept back in.
COORD=$(solidx verbs describe payment.refund 2>/dev/null | jq_get coordinate)
case "$COORD" in
  [0-9][0-9]) ck 3.1 "verbs carry a 2-digit coordinate" 0 "$COORD" ;;
  "")         ck 3.1 "verbs carry a 2-digit coordinate" 1 "no coordinate field" ;;
  *)          ck 3.1 "verbs carry a 2-digit coordinate" 1 "unexpected shape: $COORD" ;;
esac

# 3.2 — the map, and the property that makes it useful: truncating a coordinate
#       widens the result set. A prefix that returns the whole registry is not
#       scoping, and one that returns nothing is a broken filter.
solidx map >"$TMP/m.json" 2>/dev/null
MB=$(wc -c <"$TMP/m.json" | tr -d ' '); MN=$(jq_get nouns <"$TMP/m.json")
{ [ -n "$MN" ] && [ "$MN" -gt 1 ]; } \
  && ck 3.2a "solid map answers with nouns" 0 "$MN nouns · $((MB/4)) tok" \
  || ck 3.2a "solid map answers with nouns" 1 "no map"

# ⛔ Derive both prefixes from a coordinate that DEMONSTRABLY exists, rather
#    than typing one in. A hardcoded `50` failed here and the failure was the
#    harness's, not the CLI's: class 5's division 0 is `shift4`, whose verbs are
#    pack-gated and never reach a public manifest, so `verbs list 50` correctly
#    returns nothing. A probe that cannot tell "empty neighbourhood" from
#    "broken filter" is not measuring the property it claims to.
if [ -z "$COORD" ]; then
  ck 3.2b "a shorter prefix is a wider query" 1 "no coordinate to scope by"
else
  NARROW_P="$COORD"; WIDE_P="${COORD:0:1}"
  WIDE=$(solidx verbs list "$WIDE_P" 2>/dev/null | jq_get count)
  NARROW=$(solidx verbs list "$NARROW_P" 2>/dev/null | jq_get count)
  if [ -z "$WIDE" ] || [ -z "$NARROW" ] || [ -z "$TOTAL" ]; then
    ck 3.2b "a shorter prefix is a wider query" 1 "prefix scoping not supported"
  elif [ "$NARROW" -gt 0 ] && [ "$NARROW" -lt "$WIDE" ] && [ "$WIDE" -lt "$TOTAL" ]; then
    # And the same answer on every output tier: --full used to ignore the
    # prefix entirely, returning all 845 while the index tier filtered fine.
    NFULL=$(solidx verbs list "$NARROW_P" --full 2>/dev/null | jq_get count)
    [ "$NFULL" = "$NARROW" ] \
      && ck 3.2b "a shorter prefix is a wider query" 0 "${WIDE_P}→$WIDE · ${NARROW_P}→$NARROW of $TOTAL" \
      || ck 3.2b "a shorter prefix is a wider query" 1 "--full ignores the prefix: $NFULL vs $NARROW"
  else
    ck 3.2b "a shorter prefix is a wider query" 1 "${WIDE_P}→$WIDE · ${NARROW_P}→$NARROW of $TOTAL"
  fi
fi

# 3.3 — the non-canonical half of a pair says so where an agent will see it.
solidx verbs describe "$PAIR_VERB" >"$TMP/p.json" 2>/dev/null
CANON=$(jq_get same_as <"$TMP/p.json")
[ -n "$CANON" ] \
  && ck 3.3 "the twin is named on the verb card" 0 "$PAIR_VERB → $CANON" \
  || ck 3.3 "the twin is named on the verb card" 1 "no canonical twin"

# 3.4 — the entry point. 4,728 tokens of prose help was the first thing an agent
#       ever ran; 500 is the budget for an index that replaces it.
BARE=$(solidx 2>/dev/null | wc -c | tr -d ' ')
{ [ "$BARE" -gt 0 ] && [ "$BARE" -lt 2000 ]; } \
  && ck 3.4 "bare solid on a pipe is an index" 0 "${BARE}B ≈ $((BARE/4)) tok" \
  || ck 3.4 "bare solid on a pipe is an index" 1 "${BARE}B ≈ $((BARE/4)) tok"

# 3.5 — facets filter. Denominator again: 0 and TOTAL are both failures.
W=$(solidx verbs list --writes 2>/dev/null | jq_get count)
if [ -z "$W" ] || [ -z "$TOTAL" ]; then
  ck 3.5 "facets are filterable (--writes)" 1 "no facet filter"
elif [ "$W" -gt 0 ] && [ "$W" -lt "$TOTAL" ]; then
  ck 3.5 "facets are filterable (--writes)" 0 "$W of $TOTAL"
else
  ck 3.5 "facets are filterable (--writes)" 1 "$W of $TOTAL — no-op"
fi

# 3.6 — a verb missing from a surface says whether that is design or lag.
SR=$(solidx verbs describe "$DISPATCH_VERB" 2>/dev/null | jq_get surface_reason)
[ -n "$SR" ] \
  && ck 3.6 "surface_reason on a partial verb" 0 "$SR" \
  || ck 3.6 "surface_reason on a partial verb" 1 "gap unexplained"

# ═══════════ PHASE 4 — nothing is paid that wasn't asked for ═══════════

# 4.1 — the example exists AND survives its own dry run. An example its own
#       validator rejects fails the agent on our placeholder, not its mistake.
solidx verbs example contact.create >"$TMP/ex.json" 2>/dev/null
EXP=$(jq_get payload <"$TMP/ex.json")
if [ -z "$EXP" ]; then
  ck 4.1 "verbs example round-trips its own dry run" 1 "no such subcommand"
else
  EXVALID=$(solidx verbs invoke contact.create -p "$EXP" --dry-run 2>/dev/null | jq_get valid)
  # A payload with no auth-injected field in it must also not be rejected for
  # sending one.
  case "$EXP" in
    *company_id*) ck 4.1 "verbs example round-trips its own dry run" 1 "example sends an auth-injected field" ;;
    *) [ "$EXVALID" = "true" ] \
         && ck 4.1 "verbs example round-trips its own dry run" 0 "$EXP" \
         || ck 4.1 "verbs example round-trips its own dry run" 1 "its own dry run says valid=$EXVALID" ;;
  esac
fi

# 4.2 — the manifest changes on release, not per call.
E=$(jq_get etag <"$TMP/vl.json")
[ -n "$E" ] \
  && ck 4.2 "the manifest carries an etag" 0 "$E" \
  || ck 4.2 "the manifest carries an etag" 1 "absent"

# 4.3 — session start is cheap by default, and the full dump is still there.
CB=$(solidx context 2>/dev/null | wc -c | tr -d ' ')
CF=$(solidx context --full 2>/dev/null | wc -c | tr -d ' ')
{ [ "$CB" -gt 0 ] && [ "$CB" -lt 16000 ] && [ "$CF" -gt "$CB" ]; } \
  && ck 4.3 "context is tiered, --full still works" 0 "${CB}B ≈ $((CB/4)) tok · full $((CF/4)) tok" \
  || ck 4.3 "context is tiered, --full still works" 1 "brief ${CB}B · full ${CF}B"

# 4.4 — a group with one member answers as that member. "Not the help screen"
#       is the assertion; being unauthenticated is a legal outcome.
SC=$(solidx scope 2>/dev/null | head -c 400)
case "$SC" in
  *'"schema"'*|*'"identity"'*) ck 4.4 "solid scope answers bare" 0 "" ;;
  *Usage:*)                    ck 4.4 "solid scope answers bare" 1 "still prints help" ;;
  "")                          ck 4.4 "solid scope answers bare" 1 "empty stdout" ;;
  *)                           ck 4.4 "solid scope answers bare" 1 "unexpected output" ;;
esac

# ═══════════════════════════ the score ═══════════════════════════
COLD=$(( VL_BYTES / 4 ))
CHAIN=$(( (F_BYTES + $(solidx verbs describe payment.refund 2>/dev/null | wc -c | tr -d ' ') + $(wc -c <"$TMP/d.json" | tr -d ' ')) / 4 ))

echo
echo "  Solid# CLI — VNP acceptance"
echo "  $(solidx --version 2>/dev/null | head -1) · $(date +%Y-%m-%d) · $SOLID_BIN"
echo "  ────────────────────────────────────────────────────────────────────────"
for r in "${RESULTS[@]}"; do
  IFS='|' read -r st id desc detail <<< "$r"
  [ "$st" = "PASS" ] && mark="  ✓" || mark="  ✗"
  printf '%s  %-6s %-42s %s\n' "$mark" "$id" "$desc" "$detail"
done
echo "  ────────────────────────────────────────────────────────────────────────"
printf '  %d passed · %d failed\n' "$PASS" "$FAIL"
printf '  discovery cold-start ≈ %s tok · find→describe→rehearse ≈ %s tok\n' "$COLD" "$CHAIN"
echo
[ "$FAIL" -eq 0 ] && echo "  damn." && exit 0
exit 1
