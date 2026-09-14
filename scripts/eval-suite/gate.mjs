#!/usr/bin/env node
/**
 * The regression gate — what changed since last time, and is it worse?
 *
 * ⛔ THIS DOES NOT SCORE ANYTHING. run.mjs refuses to print a success rate on
 * purpose: `succeeds_when` is prose about an end state, and a regex pretending
 * to grade it would manufacture the one number that has to be true. That
 * refusal stands.
 *
 * What IS mechanical is which verb a task reached and whether the call ran.
 * Those need no judgement, so they can be pinned. If `add-customer` reached
 * `contact.create` last week and reaches `sales.score` today, something broke
 * and nobody has to read prose to know it.
 *
 * That is the whole idea: grade nothing, notice everything.
 *
 * Usage:
 *   node scripts/eval-suite/run.mjs --json /tmp/eval.json --reads-only
 *   node scripts/eval-suite/gate.mjs /tmp/eval.json              # compare to baseline
 *   node scripts/eval-suite/gate.mjs /tmp/eval.json --accept     # make this the baseline
 *
 * Exit 1 on a regression, so it can gate a push or a deploy.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = path.join(HERE, 'baseline.json');

const argv = process.argv.slice(2);
const runFile = argv.find((a) => !a.startsWith('--'));
const accept = argv.includes('--accept');

if (!runFile || !fs.existsSync(runFile)) {
  console.error('usage: gate.mjs <run.json> [--accept]');
  console.error('produce <run.json> with: run.mjs --json <run.json>');
  process.exit(2);
}

/** task id -> the two mechanical facts. Prose and token counts are excluded:
 *  tokens drift with model and description length and would cry wolf. */
function fingerprint(runPath) {
  const raw = JSON.parse(fs.readFileSync(runPath, 'utf8'));
  const results = Array.isArray(raw) ? raw : raw.results ?? [];
  const out = {};
  for (const r of results) {
    out[r.task] = { verb_reached: r.verb_reached ?? null, outcome: r.outcome ?? null };
  }
  return out;
}

/** "ran" is the only outcome that means the call completed. */
const ran = (o) => typeof o === 'string' && o.startsWith('ran');

const now = fingerprint(runFile);

if (accept || !fs.existsSync(BASELINE)) {
  fs.writeFileSync(BASELINE, JSON.stringify(now, null, 2) + '\n');
  console.log(
    `baseline ${accept ? 'updated' : 'created'}: ${Object.keys(now).length} tasks -> ` +
      path.relative(process.cwd(), BASELINE),
  );
  console.log('⛔ A baseline records what the surface DOES, not what it should do.');
  console.log('   Accepting one with known-bad routing pins the bad routing as normal.');
  process.exit(0);
}

const before = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));

const regressions = [];
const improvements = [];
const rerouted = [];
const added = [];

for (const [task, cur] of Object.entries(now)) {
  const prev = before[task];
  if (!prev) { added.push(task); continue; }

  // A call that used to complete and now does not. This is the one that fails.
  if (ran(prev.outcome) && !ran(cur.outcome)) {
    regressions.push(`${task}: ${prev.outcome} -> ${cur.outcome}`);
  } else if (!ran(prev.outcome) && ran(cur.outcome)) {
    improvements.push(`${task}: ${prev.outcome} -> ${cur.outcome}`);
  }

  // Routing moved. NOT automatically bad — a new verb may genuinely be the
  // better answer — so it is reported for a human and does not fail the gate.
  if (prev.verb_reached !== cur.verb_reached) {
    rerouted.push(`${task}: ${prev.verb_reached} -> ${cur.verb_reached}`);
  }
}

const missing = Object.keys(before).filter((t) => !(t in now));

const line = (s) => console.log(s);
line('');
if (regressions.length) {
  line(`  ✗ ${regressions.length} task(s) stopped completing:`);
  for (const r of regressions) line(`      ${r}`);
}
if (improvements.length) {
  line(`  ✔ ${improvements.length} task(s) now complete:`);
  for (const r of improvements) line(`      ${r}`);
}
if (rerouted.length) {
  line(`  · ${rerouted.length} task(s) reached a different verb (review, not a failure):`);
  for (const r of rerouted.slice(0, 15)) line(`      ${r}`);
  if (rerouted.length > 15) line(`      … and ${rerouted.length - 15} more`);
}
if (added.length) line(`  + ${added.length} new task(s): ${added.join(', ')}`);
if (missing.length) line(`  − ${missing.length} task(s) not run this time: ${missing.join(', ')}`);
if (!regressions.length && !improvements.length && !rerouted.length && !added.length && !missing.length) {
  line('  no change since the baseline.');
}
line('');

if (regressions.length) {
  line('  A task that used to reach its verb and run no longer does.');
  line('  Accept deliberately with --accept if the change is intended.');
  process.exit(1);
}
process.exit(0);
