#!/usr/bin/env node
/**
 * T1 — does the registry advertise anything it cannot reach?
 *
 * Sprint VNP, §15 step 3. Not a behaviour test: it does not care whether a verb
 * does the right thing, only whether the address the manifest publishes leads
 * somewhere. That is the cheapest tier and it is the one that catches drift.
 *
 * ⛔ ASSERT ON THE BODY, NEVER THE STATUS. This is VNP correction C1 and it is
 * the whole reason the tier is worth running. `controllers/ada.py` catches any
 * verb exception and answers HTTP 200 with `ok:false`, so a verb that raises on
 * every single call is a 200. Measured 2026-09-13: 138 of 844 verbs answer
 * 200 with ok:false, 65 of them having raised. Under VNP's original criteria
 * ("pass on 200 · 422 · 403") every one of those scores GREEN and the tier
 * reports ~99% reachable while being worthless.
 *
 * ⛔ READ-ONLY BY CONSTRUCTION, and the construction is the point:
 *   • reads are invoked with {} — company_id is injected from auth anyway.
 *   • writes are invoked WITHOUT confirm, so the SERVER's ConsentPolicy refuses
 *     them before execution. The refusal happens AFTER the route resolves and
 *     the verb is found, so it proves reachability and mutates nothing.
 *     ⚠️ The CLI's own consent gate refuses client-side and never sends, which
 *     proves nothing — that is why this talks to the API directly.
 *   • any write that does NOT declare requires_consent is EXCLUDED, because
 *     nothing would stop it running. Computed from the manifest every run,
 *     never hardcoded: today that is exactly one verb
 *     (healthcare_escalate_urgent, the self-harm escape valve).
 *
 * ⛔ THE AGENT FIREWALL WILL RATE-LIMIT THIS. It is per (company, agent, verb)
 * per minute, so a fast sweep trips it — 18 verbs returned 429 on the first
 * run. A 429 is NOT a failure, it is this script being impatient, so they are
 * retried slowly and only then judged. Counting them as failures would have
 * overstated the damage by a quarter.
 *
 * WHAT IT CANNOT TELL YOU: it calls with EMPTY arguments, so `internal_error`
 * is ambiguous — either the verb is genuinely broken, or it needs an argument
 * and the handler raises instead of validating. Both are defects, and they are
 * the same family as the 33 verbs answering "Request failed". Separating them
 * needs T2 (dry-run contract), which is blocked on nothing now that 2.3 exists.
 *
 * Usage:  node scripts/t1-reachability.mjs [--json out.json]
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const OUT = process.argv.includes('--json')
  ? process.argv[process.argv.indexOf('--json') + 1]
  : '/tmp/t1-results.json';

const cfgPath = path.join(os.homedir(), '.solid', 'config.json');
if (!fs.existsSync(cfgPath)) {
  console.error(`no ${cfgPath} — run \`solid auth login\` first`);
  process.exit(2);
}
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const BASE = cfg.api_url || 'https://api.solidnumber.com';
if (!cfg.access_token) { console.error('no access_token in ~/.solid/config.json'); process.exit(2); }
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.access_token}` };

const manifest = await (await fetch(`${BASE}/api/v1/agent/verbs`, { headers: H })).json();
const verbs = manifest.verbs || [];
// Denominator. A sweep over a manifest that failed to load reports zero
// failures and looks like success.
if (verbs.length < 700) {
  console.error(`only ${verbs.length} verbs returned — refusing to run a vacuous sweep`);
  process.exit(2);
}

const excluded = [];
const targets = [];
for (const v of verbs) {
  const writes = v.side_effects !== 'read';
  if (writes && !v.requires_consent) { excluded.push(`${v.name} (write, no consent gate)`); continue; }
  const url = v.transport === 'dispatch' ? v.dispatch_endpoint : v.http_endpoint;
  if (!url) { excluded.push(`${v.name} (no advertised endpoint)`); continue; }
  targets.push({ name: v.name, url, transport: v.transport });
}

/** One probe. Returns a verdict derived from the BODY first, status second. */
async function probe(t) {
  const body = t.transport === 'dispatch'
    ? JSON.stringify({ verb: t.name, args: {} })
    : JSON.stringify({});
  let status = 0, payload = null, transport_error = null;
  try {
    const r = await fetch(`${BASE}${t.url}`, { method: 'POST', headers: H, body, signal: AbortSignal.timeout(25000) });
    status = r.status;
    const txt = await r.text();
    try { payload = JSON.parse(txt); } catch { payload = null; }
  } catch (e) {
    transport_error = e.name === 'TimeoutError' ? 'TIMEOUT' : String(e.message || e).slice(0, 60);
  }

  const ok = payload && typeof payload === 'object' ? payload.ok : undefined;
  const reason = payload && typeof payload === 'object'
    ? String(payload.detail?.error || payload.error?.reason || payload.error?.code || payload.detail || '')
    : '';

  if (transport_error) return { ...t, status, verdict: 'ERROR', reason: transport_error };
  if (status === 429) return { ...t, status, verdict: 'RATE_LIMITED', reason: 'firewall — retry slower' };
  if (status === 404) return { ...t, status, verdict: 'NOT_FOUND', reason };
  if (status === 405) return { ...t, status, verdict: 'METHOD_NOT_ALLOWED', reason };
  if (status >= 500) return { ...t, status, verdict: 'SERVER_5XX', reason: reason || 'internal' };
  if (ok === false) {
    // The C1 bucket. Split it, because these are NOT all the same thing: a verb
    // that rejected empty arguments reached fine; one that raised did not.
    if (reason === 'internal_error') return { ...t, status, verdict: 'RAISED', reason };
    if (!reason) return { ...t, status, verdict: 'AMBIGUOUS', reason: '(ok:false, no reason given)' };
    return { ...t, status, verdict: 'REACHED', reason };   // invalid_arguments, role_denied, …
  }
  if (status === 400 && reason.includes('confirmation')) return { ...t, status, verdict: 'REACHED', reason: 'consent gate' };
  if (status === 422 || status === 400) return { ...t, status, verdict: 'REACHED', reason: 'validation' };
  if (status === 403) return { ...t, status, verdict: 'REACHED', reason: 'permission' };
  if (status >= 200 && status < 300) return { ...t, status, verdict: 'REACHED', reason: 'ran' };
  return { ...t, status, verdict: `OTHER_${status}`, reason };
}

const results = [];
let done = 0;
const queue = [...targets];
await Promise.all(Array.from({ length: 5 }, async () => {
  while (queue.length) {
    results.push(await probe(queue.shift()));
    if (++done % 100 === 0) process.stderr.write(`  ${done}/${targets.length}\n`);
    await new Promise(r => setTimeout(r, 40));
  }
}));

// Retry what the firewall throttled, slowly. These are not findings.
const throttled = results.filter(r => r.verdict === 'RATE_LIMITED');
if (throttled.length) {
  process.stderr.write(`  retrying ${throttled.length} rate-limited (the firewall, not a defect)\n`);
  for (const t of throttled) {
    await new Promise(r => setTimeout(r, 900));
    Object.assign(t, await probe(t));
  }
}

const FAIL = new Set(['NOT_FOUND', 'METHOD_NOT_ALLOWED', 'SERVER_5XX', 'RAISED', 'ERROR', 'RATE_LIMITED']);
const counts = {};
for (const r of results) counts[r.verdict] = (counts[r.verdict] || 0) + 1;
const failures = results.filter(r => FAIL.has(r.verdict));
const ambiguous = results.filter(r => r.verdict === 'AMBIGUOUS');

console.log(`\n  T1 REACHABILITY — ${results.length} probed, ${excluded.length} excluded\n`);
for (const [k, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${String(n).padStart(4)}  ${k}`);
}
console.log(`\n  REACHABLE ${results.length - failures.length - ambiguous.length}   FAILING ${failures.length}   ambiguous ${ambiguous.length}\n`);

const byNamespace = {};
for (const f of failures) {
  const ns = f.name.split(/[._]/)[0];
  (byNamespace[ns] ||= { n: 0, kinds: new Set() });
  byNamespace[ns].n++;
  byNamespace[ns].kinds.add(f.verdict);
}
console.log('  failures by namespace:');
for (const [ns, v] of Object.entries(byNamespace).sort((a, b) => b[1].n - a[1].n)) {
  console.log(`   ${String(v.n).padStart(3)}  ${ns.padEnd(20)} ${[...v.kinds].join(', ')}`);
}

console.log('\n  ⚠️  RAISED means HTTP 200 with ok:false. Empty arguments were sent, so it is');
console.log('      either a broken verb or an unvalidated missing argument — T1 cannot tell.');
console.log('      T2 (dry-run contract) separates them.\n');

fs.writeFileSync(OUT, JSON.stringify({
  probed: results.length, excluded, counts,
  reachable: results.length - failures.length - ambiguous.length,
  failing: failures.length, results,
}, null, 1));
console.log(`  full results -> ${OUT}`);
process.exit(failures.length ? 1 : 0);
