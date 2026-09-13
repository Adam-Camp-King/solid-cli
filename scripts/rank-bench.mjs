#!/usr/bin/env node
/**
 * How good is `solid find`, as a number?
 *
 * VNP 2.1 shipped lexical ranking and its own docstring said it was "the honest
 * baseline: if this is not good enough we will be able to say so with a number
 * instead of a hunch." This is that number.
 *
 * The 20 queries are lifted VERBATIM from the eval suite's 50 tasks — the way
 * an owner actually types, not the keyword phrasing the ranker was built
 * against. That distinction is the whole point: short keyword tests said find
 * worked, and it did, on keywords.
 *
 *   baseline                      top-1  8/20   top-3 11/20
 *   + synonyms                    top-1 11/20   top-3 16/20
 *   + uncapped IDF                top-1 12/20   top-3 13/20   ← top-3 got WORSE
 *   + capped IDF, values dropped  top-1 13/20   top-3 16/20
 *
 * Run it before and after any change to src/lib/verb-search.ts.
 * Needs a built dist and a logged-in CLI; it reads the live manifest once.
 */
import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { rankVerbs } = await import(path.join(HERE, '..', 'dist', 'lib', 'verb-search.js'));
const { CASES } = await import(path.join(HERE, 'rank-bench-cases.mjs'));

const raw = execFileSync('node', [path.join(HERE, '..', 'dist', 'index.js'), 'verbs', 'list', '--full'], {
  encoding: 'utf8', maxBuffer: 1 << 28,
  env: { ...process.env, SOLID_NO_TENANT_WARN: '1' },
});
const verbs = JSON.parse(raw).verbs || [];
if (verbs.length < 700) {
  console.error(`only ${verbs.length} verbs — refusing to benchmark against a partial manifest`);
  process.exit(2);
}

let hit1 = 0, hit3 = 0;
console.log(`\n  find() ranking · ${CASES.length} real prompts · ${verbs.length} verbs\n`);
for (const [q, want] of CASES) {
  const re = new RegExp(want, 'i');
  const m = rankVerbs(q, verbs, 3);
  const top = m[0]?.name ?? '—';
  const inTop3 = m.some((x) => re.test(x.name));
  if (re.test(top)) hit1++;
  if (inTop3) hit3++;
  console.log(`  ${re.test(top) ? '✓' : '✗'} ${top.padEnd(30)} ${inTop3 ? ' ' : '✗'}top3  "${q.slice(0, 46)}"`);
}
const pc = (n) => `${n}/${CASES.length} (${Math.round((100 * n) / CASES.length)}%)`;
console.log(`\n  top-1 ${pc(hit1)}   top-3 ${pc(hit3)}\n`);
