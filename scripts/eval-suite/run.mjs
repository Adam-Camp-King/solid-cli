#!/usr/bin/env node
/**
 * The eval suite — can a cold agent do a real job, first try, and what did it cost?
 *
 * VNP §13 item 5. The number this produces is the only claim about the platform
 * that travels: "845 verbs" is inventory and invites "but do they work?" — to
 * which the honest answer this morning was no, 27 of them were dead. A
 * first-attempt success rate over published tasks is falsifiable, comparable,
 * and nobody in this category has published one.
 *
 * ⛔ WHAT THIS HARNESS IS AND IS NOT
 *
 * It is the RIG: the task format, the sandbox lifecycle, the token accounting
 * and the grader. It ships with ONE solver — `cold-path`, which walks the
 * documented route (find -> describe -> example -> dry-run -> invoke) and
 * nothing else.
 *
 * `cold-path` measures THE SURFACE, not a model: whether a task is completable
 * by following the path the docs promise. That is the useful first number
 * because every failure is ours, not the model's. A real-model solver is a
 * separate integration and drops in behind the same interface — see SOLVERS.
 *
 * ⛔ DO NOT PUBLISH A COLD-PATH NUMBER AS AN AGENT NUMBER. They measure
 * different things and conflating them is the sort of claim this whole sprint
 * exists to stop. The output labels which solver produced it, deliberately.
 *
 * ⛔ WRITES ARE REAL AND THEN DISCARDED. A write task forks a sandbox first
 * (`sandbox.fork`), grades against `sandbox.diff`, and always exits
 * (`sandbox.exit`) — in a finally, so a crashed task still cleans up. Nothing
 * is mocked: mocked writes prove the harness works, not the platform.
 *
 * ⛔ THE GRADER READS THE DIFF, NOT THE TRANSCRIPT. "The agent said it booked
 * the appointment" is not evidence. Every task's `succeeds_when` describes an
 * observable end state.
 *
 * Usage:
 *   node scripts/eval-suite/run.mjs                 # all tasks, cold-path
 *   node scripts/eval-suite/run.mjs --reads-only    # skip anything that writes
 *   node scripts/eval-suite/run.mjs --task add-a-contact
 *   node scripts/eval-suite/run.mjs --json out.json
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', '..', 'dist', 'index.js');
const TASKS = path.join(HERE, 'tasks.json');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);

if (!fs.existsSync(CLI)) {
  console.error(`CLI not built at ${CLI} — run: npm run build`);
  process.exit(2);
}

/** Run the CLI and account for every byte it returns. Tokens are bytes/4,
 *  the same measure the whole sprint used, so the numbers compose. */
let TOKENS = 0;
let TURNS = 0;
function cli(args, { allowFail = true } = {}) {
  TURNS += 1;
  let out = '';
  let code = 0;
  try {
    out = execFileSync('node', [CLI, ...args], {
      encoding: 'utf8',
      timeout: 60000,
      env: { ...process.env, SOLID_NO_TENANT_WARN: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    out = (e.stdout || '') + '';
    code = e.status ?? 1;
    if (!allowFail) throw e;
  }
  TOKENS += Math.ceil(Buffer.byteLength(out, 'utf8') / 4);
  let json = null;
  try { json = JSON.parse(out); } catch { /* prose, counted but unparsed */ }
  return { out, json, code };
}

// ── the sandbox lifecycle ──────────────────────────────────────────────────
// fork -> run -> diff -> exit. `exit` is in a finally: a task that throws must
// not leave a fork open, because the next task would then grade against it.
function fork() {
  const r = cli(['verbs', 'invoke', 'sandbox.fork', '-p', '{}', '--confirm']);
  return r.json && r.json.ok !== false;
}
function diff() {
  return cli(['verbs', 'invoke', 'sandbox.diff', '-p', '{}']).json;
}
function exitSandbox() {
  cli(['verbs', 'invoke', 'sandbox.exit', '-p', '{}', '--confirm']);
}

// ── SOLVERS ───────────────────────────────────────────────────────────────
// A solver takes a task and returns { reached, note }. It may call `cli` as
// many times as it likes; every call is counted. Add a model-backed solver
// here and the rig, the sandbox and the grader are unchanged.
const SOLVERS = {
  /**
   * The documented cold-start path, and only that. Deliberately dumb: it does
   * not reason, it follows the route VNP promises an agent can follow. A
   * failure here is a failure of the surface.
   */
  'cold-path': (task) => {
    const found = cli(['find', task.prompt, '--json']);
    const top = found.json?.matches?.[0]?.[0] ?? null;
    if (!top) return { reached: null, note: 'find returned no candidate' };

    // describe, then let the schema write the call rather than guessing
    cli(['verbs', 'describe', top, '--json']);
    const ex = cli(['verbs', 'example', top, '--json']);
    const payload = ex.json?.payload ? JSON.stringify(ex.json.payload) : '{}';

    // rehearse before committing — the whole point of the playground
    const dry = cli(['verbs', 'invoke', top, '-p', payload, '--dry-run']);
    if (dry.json?.valid === false) {
      return { reached: top, note: `dry run rejected it: ${dry.json.fix || 'invalid'}` };
    }
    // ⛔ A READ TASK MUST NOT REACH FOR A WRITE VERB. If find ranked a mutating
    // verb top for a QUESTION, that is the finding — invoking it would be the
    // harness causing the damage it exists to measure. Reported, not run.
    //
    // ⛔ BUT A REFUSAL TASK IS NOT A QUESTION. "Delete every contact", "Turn on
    // sales tax" and "Add some customer reviews" are ORDERS; they are
    // writes:false because nothing may be written, not because search should
    // pretend the verb does not exist. Ranking the mutating verb first is
    // correct for them, and refusing is the execution boundary's job.
    //
    // Before `refusal` existed this rule reported four such tasks as ranking
    // failures. That is a guard crying wolf on correct behaviour, and it hid
    // the three REAL ranking bugs in the same list — questions answered with
    // an action ("is anything failing to sync?" -> invoice_sync). Separating
    // them is what made the real defect visible and fixable.
    const se = cli(['verbs', 'describe', top, '--json']).json?.side_effects;
    if (!task.writes && !task.refusal && se && se !== 'read') {
      return { reached: top, note: `MISMATCH: read task, find ranked a ${se} verb top — not invoked` };
    }
    // A refusal task still must not be INVOKED by the harness: the point is
    // whether the platform refuses, and finding that out by actually deleting
    // every contact is not an acceptable way to learn it.
    if (task.refusal && se && se !== 'read') {
      return { reached: top, note: `refusal task: ranked ${se} verb (correct) — not invoked` };
    }

    const r = cli(['verbs', 'invoke', top, '-p', payload, ...(task.writes ? ['--confirm'] : [])]);
    // ⛔ Judge on the BODY and the exit code, never on "no error appeared".
    // The first draft returned 'ran' whenever json?.ok !== false — but a verb
    // refused by the CLI's own consent gate returns NO JSON at all, so `ok`
    // was undefined and a refusal scored as a success. That is the exact
    // false-green this suite exists to catch, in the suite itself.
    if (r.json === null) return { reached: top, note: `no JSON returned (exit ${r.code}) — refused or crashed` };
    if (r.json.ok === false) return { reached: top, note: `ok:false ${r.json.error?.reason || ''}` };
    if (r.json.error) return { reached: top, note: `error ${r.json.error.code || r.json.error.status || ''}` };
    if (r.code !== 0) return { reached: top, note: `non-zero exit ${r.code}` };
    return { reached: top, note: task.writes ? 'committed' : 'ran' };
  },
};

// ── the grader ────────────────────────────────────────────────────────────
// ⛔ NOT AUTOMATIC, AND SAYING SO IS THE POINT. `succeeds_when` is prose about
// an end state; scoring it needs a human or a model reading the diff. A regex
// that pretended to grade would manufacture a number, which is worse than
// having none. So the runner collects the EVIDENCE and marks every task
// `needs_grading` — the score is a deliberate act, not a side effect.
function evidence(task, solved, sandboxDiff) {
  return {
    task: task.id,
    prompt: task.prompt,
    succeeds_when: task.succeeds_when,
    verb_reached: solved.reached,
    outcome: solved.note,
    sandbox_diff: sandboxDiff ?? null,
    verdict: 'needs_grading',
  };
}

// ── run ───────────────────────────────────────────────────────────────────
const suite = JSON.parse(fs.readFileSync(TASKS, 'utf8'));
let tasks = suite.tasks;
if (opt('--task')) tasks = tasks.filter((t) => t.id === opt('--task'));
if (flag('--reads-only')) tasks = tasks.filter((t) => !t.writes);
if (!tasks.length) { console.error('no tasks selected'); process.exit(2); }

const solverName = opt('--solver') || 'cold-path';
const solve = SOLVERS[solverName];
if (!solve) { console.error(`unknown solver ${solverName}; have: ${Object.keys(SOLVERS)}`); process.exit(2); }

const results = [];
console.log(`\n  eval suite · solver=${solverName} · ${tasks.length} task(s)\n`);

for (const task of tasks) {
  TOKENS = 0; TURNS = 0;
  let forked = false;
  let rec;
  try {
    if (task.writes) {
      forked = fork();
      if (!forked) {
        results.push({ ...evidence(task, { reached: null, note: 'sandbox.fork failed — task not attempted' }, null), tokens: TOKENS, turns: TURNS });
        console.log(`  ⚠ ${task.id.padEnd(20)} sandbox.fork failed — skipped, NOT scored`);
        continue;
      }
    }
    const solved = solve(task);
    const d = task.writes ? diff() : null;
    rec = { ...evidence(task, solved, d), tokens: TOKENS, turns: TURNS };
  } catch (e) {
    rec = { ...evidence(task, { reached: null, note: `harness error: ${e.message}` }, null), tokens: TOKENS, turns: TURNS };
  } finally {
    if (forked) exitSandbox();     // always, even on a throw
  }
  results.push(rec);
  console.log(`  · ${task.id.padEnd(20)} ${String(rec.verb_reached || '—').padEnd(28)} ${String(rec.tokens).padStart(6)} tok  ${String(rec.turns).padStart(2)} turns  ${rec.outcome}`);
}

const tok = results.map((r) => r.tokens);
const med = [...tok].sort((a, b) => a - b)[Math.floor(tok.length / 2)] ?? 0;
console.log(`\n  ─────────────────────────────────────────────────────────────`);
console.log(`  tasks attempted   ${results.length}`);
console.log(`  reached a verb    ${results.filter((r) => r.verb_reached).length}`);
console.log(`  median tokens     ${med}`);
console.log(`  median turns      ${[...results.map((r) => r.turns)].sort((a, b) => a - b)[Math.floor(results.length / 2)] ?? 0}`);
console.log(`\n  ⛔ NO SUCCESS RATE IS PRINTED. Every task is 'needs_grading': the`);
console.log(`     grader reads succeeds_when against the diff, and a regex pretending`);
console.log(`     to do that would manufacture the one number that has to be true.`);
console.log(`  ⛔ solver=${solverName} measures THE SURFACE, not a model. Do not publish`);
console.log(`     it as an agent success rate.\n`);

const out = opt('--json') || '/tmp/eval-suite.json';
fs.writeFileSync(out, JSON.stringify({ solver: solverName, generated: new Date().toISOString(), results }, null, 1));
console.log(`  evidence -> ${out}\n`);
