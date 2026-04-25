/**
 * `solid graph` — navigate the tenant JSON-LD context as a typed graph.
 *
 * Fetches GET /api/v1/cli/context?format=jsonld (the Schema.org + solid:*
 * envelope produced by solid-backend/services/ai_context_jsonld.py) and
 * offers CLI-driven traversal primitives:
 *
 *   solid graph                         # summary — counts per @type
 *   solid graph --list-types            # every @type in the graph
 *   solid graph --type Service          # list nodes of a @type
 *   solid graph kb/42                   # center node + its 1-hop neighbourhood
 *   solid graph kb/42 --hops 2          # 2-hop neighbourhood
 *   solid graph kb/42 --out             # outbound edges only (directed)
 *   solid graph --json                  # machine-readable subgraph (JSON-LD)
 *
 * The "oh my gosh" win: a single command that walks relationships
 * instead of forcing Claude to JOIN by hand across nested arrays.
 *
 * Exit codes:
 *   0  success
 *   1  not authenticated OR target IRI not in the graph
 *   2  usage error (bad args)
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';

import { apiClient, handleApiError } from '../lib/api-client';
import { config } from '../lib/config';
import { isJsonOutput } from '../lib/json-output';
import { appendExamples } from '../lib/command-kit';
import {
  JsonLdDocument,
  JsonLdNode,
  bfs,
  bfsOut,
  buildAdjacency,
  listTypes,
  nodesOfType,
  resolveIri,
  subgraph,
  validate,
} from '../lib/graph-walker';
import { diff as graphDiff } from '../lib/graph-diff';
import { query as sparqlQuery } from '../lib/sparql-bgp';

async function fetchJsonLdRemote(): Promise<JsonLdDocument> {
  const res = await apiClient.get<JsonLdDocument>('/api/v1/cli/context', {
    params: { format: 'jsonld' },
  });
  return res.data;
}

/**
 * Default offline path: ``.claude/solid-context.jsonld`` relative to
 * CWD. ``solid context --claude`` writes this file alongside the
 * existing flat ``solid-context.json``; once present, ``solid graph``
 * can walk without hitting the network.
 */
function localJsonLdPath(): string {
  return path.resolve(process.cwd(), '.claude', 'solid-context.jsonld');
}

function readJsonLdLocalOrNull(): JsonLdDocument | null {
  const p = localJsonLdPath();
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    const doc = JSON.parse(raw);
    if (doc && typeof doc === 'object' && '@context' in doc) {
      return doc as JsonLdDocument;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve the document according to the --offline / --remote policy:
 *
 *   --offline → read the local .jsonld file; fail if missing.
 *   --remote  → always hit the API; ignore any local file.
 *   default   → prefer local if it exists AND the session isn't
 *               authenticated (common case for a bound tenant dir
 *               using env-var auth or a stale login). Otherwise go
 *               remote so we don't serve stale data to an active op.
 */
async function loadDocument(opts: { offline?: boolean; remote?: boolean }): Promise<JsonLdDocument> {
  if (opts.remote) {
    return fetchJsonLdRemote();
  }
  const local = readJsonLdLocalOrNull();
  if (opts.offline) {
    if (!local) {
      throw new Error(
        `No local JSON-LD at ${localJsonLdPath()}. Run \`solid context --claude\` in a tenant dir first, or drop --offline.`,
      );
    }
    return local;
  }
  if (local && !config.isLoggedIn()) return local;
  return fetchJsonLdRemote();
}

function typeSummary(doc: JsonLdDocument): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const node of doc.graph ?? []) {
    const t = node['@type'];
    const arr = Array.isArray(t) ? t : t ? [t] : [];
    for (const ty of arr) counts[String(ty)] = (counts[String(ty)] ?? 0) + 1;
  }
  return counts;
}

function renderNode(node: JsonLdNode): string {
  const types = Array.isArray(node['@type']) ? node['@type'].join(', ') : (node['@type'] ?? '');
  const name = (node.name as string | undefined) ?? '';
  const id = node['@id'];
  const header = chalk.bold(id);
  const typeLine = chalk.dim(`  [${types}]`);
  const nameLine = name ? `  ${name}` : '';
  return [header, typeLine, nameLine].filter(Boolean).join('\n');
}

function renderSubgraph(doc: JsonLdDocument, ids: Set<string>, root: string): void {
  const adj = buildAdjacency(doc);
  const rootEntry = adj.get(root);
  if (!rootEntry) {
    console.error(chalk.red(`IRI not in graph: ${root}`));
    return;
  }
  console.log('');
  console.log(chalk.bold('Root:'));
  console.log(renderNode(rootEntry.node));
  console.log('');

  // Group edges by predicate for readability.
  const outByPredicate = new Map<string, string[]>();
  for (const e of rootEntry.outEdges) {
    const list = outByPredicate.get(e.predicate) ?? [];
    list.push(e.target);
    outByPredicate.set(e.predicate, list);
  }
  const inByPredicate = new Map<string, string[]>();
  for (const e of rootEntry.inEdges) {
    const list = inByPredicate.get(e.predicate) ?? [];
    list.push(e.source);
    inByPredicate.set(e.predicate, list);
  }

  if (outByPredicate.size) {
    console.log(chalk.bold('Outgoing edges:'));
    for (const [pred, targets] of outByPredicate) {
      console.log(`  ${chalk.cyan(pred)} → ${targets.length}`);
      for (const t of targets) console.log(`    ${chalk.dim(t)}`);
    }
    console.log('');
  }
  if (inByPredicate.size) {
    console.log(chalk.bold('Incoming edges:'));
    for (const [pred, sources] of inByPredicate) {
      console.log(`  ${chalk.cyan(pred)} ← ${sources.length}`);
      for (const s of sources) console.log(`    ${chalk.dim(s)}`);
    }
    console.log('');
  }

  const extraIds = [...ids].filter((i) => i !== root);
  if (extraIds.length) {
    console.log(chalk.bold(`Reached ${extraIds.length} additional node(s):`));
    for (const i of extraIds) {
      const entry = adj.get(i);
      if (!entry) continue;
      const types = Array.isArray(entry.node['@type']) ? entry.node['@type'].join(', ') : entry.node['@type'];
      const name = (entry.node.name as string | undefined) ?? '';
      console.log(`  ${chalk.dim('•')} ${i} ${chalk.dim(`[${types}]`)}${name ? ' — ' + name : ''}`);
    }
    console.log('');
  }
}

export const graphCommand = new Command('graph')
  .description('Navigate the tenant JSON-LD context graph — counts, types, and N-hop neighbourhoods around any entity')
  .argument('[iri]', 'Short form ("kb/42"), full IRI, or "co/<id>/<type>/<entity>". Omit for a top-level summary.')
  .option('--hops <n>', 'Max traversal depth from the root IRI (default 1; ignored without an IRI)', '1')
  .option('--out', 'Only walk outbound edges (directed). Default is bidirectional so inbound relationships surface too.')
  .option('--type <t>', 'List every node of this @type (e.g. "Service", "solid:Agent"). Mutually exclusive with IRI.')
  .option('--list-types', 'Print every @type value present in the graph.')
  .option('--json', 'Emit the subgraph (or root doc, if no IRI) as JSON-LD on stdout.')
  .option('--offline', 'Force reading from local .claude/solid-context.jsonld — no API call. Fail if the file is absent.')
  .option('--remote', 'Force a network fetch — ignore any local .claude/solid-context.jsonld.')
  .option('--validate', 'Check that every edge target resolves in @graph and required per-type fields are present. Exit 1 on errors.')
  .option('--dump <format>', 'Emit RDF for piping to a graph store. Format: nquads (offline-capable) | turtle (requires --remote)')
  .option('--diff <before>', 'Compare a baseline .jsonld file against the current graph. Reports added/removed/modified nodes. Exit 1 if any change.')
  .option('--query <sparql>', 'Run a minimal SPARQL BGP query against the graph. Supports SELECT + WHERE with triple patterns. See `solid graph --query "?"` for examples.')
  .action(async (iri: string | undefined, opts: { hops?: string; out?: boolean; type?: string; listTypes?: boolean; json?: boolean; offline?: boolean; remote?: boolean; validate?: boolean; dump?: string; diff?: string; query?: string }) => {
    // --offline doesn't require auth; --remote does; the default prefers
    // local-if-logged-out, remote-if-logged-in.
    if (!opts.offline && !readJsonLdLocalOrNull() && !config.isLoggedIn()) {
      if (isJsonOutput(opts)) {
        process.stdout.write(JSON.stringify({ ok: false, error: 'not_authenticated' }, null, 2) + '\n');
      } else {
        console.error(chalk.red('Not authenticated and no local .claude/solid-context.jsonld found.'));
        console.error(chalk.dim('  Run `solid auth login` and retry, or cd into a tenant dir with a fresh context.'));
      }
      process.exit(1);
    }

    let doc: JsonLdDocument;
    try {
      doc = await loadDocument(opts);
    } catch (err) {
      const e = handleApiError(err);
      if (isJsonOutput(opts)) {
        process.stdout.write(JSON.stringify({ ok: false, error: e.message }, null, 2) + '\n');
      } else {
        console.error(chalk.red(`Failed to fetch JSON-LD context: ${e.message}`));
      }
      process.exit(1);
    }

    // --dump ---------------------------------------------------------------
    // RDF export for piping to external graph stores. N-Quads runs offline
    // (jsonld.toRDF natively); Turtle requires the backend so we ask for
    // it via ?format=turtle. Output goes straight to stdout — no chalk,
    // no extra newlines beyond what the format requires — so users can
    // shell-pipe (`solid graph --dump nquads > tenant.nq`).
    if (opts.dump) {
      const fmt = opts.dump.toLowerCase();
      if (fmt !== 'nquads' && fmt !== 'turtle') {
        console.error(chalk.red(`Unknown --dump format: ${opts.dump}. Use nquads or turtle.`));
        process.exit(1);
      }
      try {
        if (fmt === 'nquads') {
          // Offline-capable: convert in-process via jsonld lib.
          // Lazy-load so users who never use --dump don't pay the
          // require cost.
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const jsonldLib = require('jsonld');
          const nquads = await jsonldLib.toRDF(doc, { format: 'application/n-quads' });
          process.stdout.write(nquads);
          return;
        }
        // turtle — needs the backend serializer
        if (opts.offline) {
          console.error(chalk.red('--dump turtle requires the backend (no offline turtle yet).'));
          console.error(chalk.dim('  Use --dump nquads for offline export, or drop --offline.'));
          process.exit(1);
        }
        // FastAPI returns text/turtle; ask axios for raw text so it
        // doesn't try to JSON-parse the body.
        const res = await apiClient.get<string>('/api/v1/cli/context', {
          params: { format: 'turtle' },
          responseType: 'text',
        });
        process.stdout.write(typeof res.data === 'string' ? res.data : String(res.data));
        return;
      } catch (err) {
        const e = handleApiError(err);
        console.error(chalk.red(`Dump failed: ${e.message}`));
        process.exit(1);
      }
    }

    // --query --------------------------------------------------------------
    // Minimal SPARQL BGP query against the loaded graph. Supports
    // SELECT + WHERE with triple patterns; no OPTIONAL / FILTER /
    // property paths (use the RDF export + a real SPARQL engine for
    // those). Output: JSON `{vars, bindings}` under --json, or a
    // table by default.
    if (opts.query) {
      try {
        const result = sparqlQuery(opts.query, doc);
        if (isJsonOutput(opts)) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n');
          process.exit(0);
        }
        // Table render — variable names as headers, then one row per binding.
        if (result.vars.length === 0) {
          console.log(chalk.dim('  No SELECT variables.'));
          process.exit(0);
        }
        if (result.bindings.length === 0) {
          console.log(chalk.dim('  No matches.'));
          process.exit(0);
        }
        // Compute column widths for a clean table.
        const widths: number[] = result.vars.map((v) =>
          Math.max(v.length, ...result.bindings.map((b) => (b[v] ?? '').length)),
        );
        const sep = '  ';
        const header = result.vars.map((v, i) => chalk.bold(v.padEnd(widths[i]))).join(sep);
        const rule = result.vars.map((_, i) => '─'.repeat(widths[i])).join(sep);
        console.log('');
        console.log(`  ${header}`);
        console.log(chalk.dim(`  ${rule}`));
        for (const row of result.bindings) {
          console.log(`  ${result.vars.map((v, i) => (row[v] ?? '').padEnd(widths[i])).join(sep)}`);
        }
        console.log('');
        console.log(chalk.dim(`  ${result.bindings.length} row${result.bindings.length === 1 ? '' : 's'}`));
        console.log('');
        process.exit(0);
      } catch (err) {
        const msg = (err as Error).message;
        if (isJsonOutput(opts)) {
          process.stdout.write(JSON.stringify({ ok: false, error: msg }, null, 2) + '\n');
        } else {
          console.error(chalk.red(`Query error: ${msg}`));
        }
        process.exit(1);
      }
    }

    // --diff ---------------------------------------------------------------
    // Compare a baseline file (the "before") against the loaded
    // current graph (the "after"). Output a JSON-Patch-style report.
    // Exit 1 if anything changed so this can gate CI: "fail the build
    // if the tenant graph diverges from the committed baseline."
    if (opts.diff) {
      const beforePath = path.resolve(opts.diff);
      if (!fs.existsSync(beforePath)) {
        const msg = `--diff baseline not found: ${beforePath}`;
        if (isJsonOutput(opts)) {
          process.stdout.write(JSON.stringify({ ok: false, error: msg }, null, 2) + '\n');
        } else {
          console.error(chalk.red(msg));
        }
        process.exit(1);
      }
      let before: JsonLdDocument;
      try {
        before = JSON.parse(fs.readFileSync(beforePath, 'utf-8')) as JsonLdDocument;
      } catch (err) {
        const msg = `Failed to parse ${beforePath}: ${(err as Error).message}`;
        if (isJsonOutput(opts)) {
          process.stdout.write(JSON.stringify({ ok: false, error: msg }, null, 2) + '\n');
        } else {
          console.error(chalk.red(msg));
        }
        process.exit(1);
      }

      const report = graphDiff(before, doc);
      const hasChanges = report.summary.added + report.summary.removed + report.summary.modified > 0;

      if (isJsonOutput(opts)) {
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
        process.exit(hasChanges ? 1 : 0);
      }

      console.log('');
      console.log(chalk.bold('Graph diff'));
      console.log(chalk.dim(`  Before: ${beforePath}`));
      console.log(chalk.dim(`  After:  ${doc['@id'] || '(loaded graph)'}`));
      console.log('');
      console.log(`  ${chalk.green('+')} ${report.summary.added} added`);
      console.log(`  ${chalk.red('-')} ${report.summary.removed} removed`);
      console.log(`  ${chalk.yellow('~')} ${report.summary.modified} modified`);
      console.log(chalk.dim(`    ${report.summary.unchanged} unchanged`));
      console.log('');

      for (const node of report.added) {
        const types = Array.isArray(node['@type']) ? node['@type'].join(', ') : (node['@type'] ?? '');
        console.log(chalk.green(`  + ${node['@id']}`));
        if (types) console.log(chalk.dim(`      [${types}]`));
      }
      for (const node of report.removed) {
        const types = Array.isArray(node['@type']) ? node['@type'].join(', ') : (node['@type'] ?? '');
        console.log(chalk.red(`  - ${node['@id']}`));
        if (types) console.log(chalk.dim(`      [${types}]`));
      }
      for (const change of report.modified) {
        console.log(chalk.yellow(`  ~ ${change['@id']}`));
        for (const p of change.predicates) {
          const sym = p.op === 'add' ? chalk.green('+') : p.op === 'remove' ? chalk.red('-') : chalk.yellow('~');
          if (p.op === 'add') {
            console.log(chalk.dim(`      ${sym} ${p.predicate} = ${JSON.stringify(p.after)}`));
          } else if (p.op === 'remove') {
            console.log(chalk.dim(`      ${sym} ${p.predicate} (was ${JSON.stringify(p.before)})`));
          } else {
            console.log(chalk.dim(`      ${sym} ${p.predicate}: ${JSON.stringify(p.before)} → ${JSON.stringify(p.after)}`));
          }
        }
      }
      console.log('');
      if (!hasChanges) {
        console.log(chalk.green('  ✓ graphs are identical'));
        console.log('');
      }
      process.exit(hasChanges ? 1 : 0);
    }

    // --validate -----------------------------------------------------------
    if (opts.validate) {
      const report = validate(doc);
      if (isJsonOutput(opts)) {
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
        process.exit(report.ok ? 0 : 1);
      }
      console.log('');
      console.log(chalk.bold(`Graph validation`));
      console.log(chalk.dim(`  Root: ${doc['@id']}`));
      console.log(chalk.dim(`  Nodes: ${report.nodeCount}   Edges traversed: ${report.edgeCount}`));
      console.log(chalk.dim(`  Issues: ${report.issues.length}`));
      console.log('');
      for (const issue of report.issues) {
        const marker = issue.severity === 'error' ? chalk.red('✗') : chalk.yellow('⚠');
        console.log(`  ${marker} [${issue.code}] ${chalk.dim(issue.nodeId)}`);
        console.log(`      ${issue.message}`);
      }
      console.log('');
      if (report.ok) {
        console.log(chalk.green('  ✓ graph is well-formed — every edge resolves, every required field present'));
      } else {
        console.log(chalk.red(`  ✗ ${report.issues.filter((i) => i.severity === 'error').length} error(s) — fix required`));
      }
      console.log('');
      process.exit(report.ok ? 0 : 1);
    }

    // --list-types ---------------------------------------------------------
    if (opts.listTypes) {
      const types = listTypes(doc);
      if (isJsonOutput(opts)) {
        process.stdout.write(JSON.stringify({ types }, null, 2) + '\n');
        return;
      }
      console.log('');
      console.log(chalk.bold(`@type values in this graph (${types.length}):`));
      for (const t of types) console.log(`  ${t}`);
      console.log('');
      return;
    }

    // --type <t> -----------------------------------------------------------
    if (opts.type) {
      const nodes = nodesOfType(doc, opts.type);
      if (isJsonOutput(opts)) {
        process.stdout.write(JSON.stringify({ type: opts.type, count: nodes.length, nodes }, null, 2) + '\n');
        return;
      }
      console.log('');
      console.log(chalk.bold(`Nodes of @type ${opts.type}: ${nodes.length}`));
      for (const n of nodes) {
        const name = (n.name as string | undefined) ?? '';
        console.log(`  ${n['@id']}${name ? chalk.dim(`  — ${name}`) : ''}`);
      }
      console.log('');
      return;
    }

    // Subgraph walk from a specific IRI ------------------------------------
    if (iri) {
      const root = resolveIri(iri, doc['@id']);
      const hops = Math.max(0, parseInt(opts.hops ?? '1', 10) || 0);
      const adj = buildAdjacency(doc);
      if (!adj.has(root)) {
        if (isJsonOutput(opts)) {
          process.stdout.write(JSON.stringify({ ok: false, error: 'iri_not_found', iri: root }, null, 2) + '\n');
        } else {
          console.error(chalk.red(`IRI not in graph: ${root}`));
          console.error(chalk.dim('  Try `solid graph --list-types` or `solid graph --type <type>` to find it.'));
        }
        process.exit(1);
      }
      const walker = opts.out ? bfsOut : bfs;
      const ids = walker(adj, root, hops);
      if (isJsonOutput(opts)) {
        process.stdout.write(JSON.stringify(subgraph(doc, ids), null, 2) + '\n');
        return;
      }
      renderSubgraph(doc, ids, root);
      return;
    }

    // Default: top-level summary -------------------------------------------
    if (isJsonOutput(opts)) {
      process.stdout.write(JSON.stringify(doc, null, 2) + '\n');
      return;
    }
    const counts = typeSummary(doc);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log('');
    console.log(chalk.bold(`Tenant context graph`));
    console.log(chalk.dim(`  Root: ${doc['@id']}`));
    console.log(chalk.dim(`  Total nodes: ${total}`));
    console.log('');
    console.log(chalk.bold('Node counts by @type:'));
    const sorted = Object.entries(counts).sort(([, a], [, b]) => b - a);
    for (const [ty, n] of sorted) {
      console.log(`  ${String(n).padStart(4)}  ${ty}`);
    }
    console.log('');
    console.log(chalk.dim('  Walk a node:   ') + chalk.cyan('solid graph kb/42 --hops 2'));
    console.log(chalk.dim('  List a type:   ') + chalk.cyan('solid graph --type Service'));
    console.log(chalk.dim('  JSON output:   ') + chalk.cyan('solid graph --json'));
    console.log('');
  });

appendExamples(graphCommand, [
  { cmd: 'solid graph',                    why: 'Top-level summary — counts per @type' },
  { cmd: 'solid graph --list-types',       why: 'Every @type present in the graph' },
  { cmd: 'solid graph --type Service',     why: 'Every Service node + its name' },
  { cmd: 'solid graph kb/42',              why: 'Node kb/42 + its direct neighbours (1 hop)' },
  { cmd: 'solid graph kb/42 --hops 2',     why: 'kb/42 neighbourhood, 2 hops out' },
  { cmd: 'solid graph kb/42 --out --json', why: 'Directed subgraph as machine-readable JSON-LD' },
  { cmd: 'solid graph --offline',          why: 'Walk .claude/solid-context.jsonld — no network, no auth' },
]);
