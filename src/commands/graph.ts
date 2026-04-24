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
} from '../lib/graph-walker';

async function fetchJsonLd(): Promise<JsonLdDocument> {
  const res = await apiClient.get<JsonLdDocument>('/api/v1/cli/context', {
    params: { format: 'jsonld' },
  });
  return res.data;
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
  .action(async (iri: string | undefined, opts: { hops?: string; out?: boolean; type?: string; listTypes?: boolean; json?: boolean }) => {
    if (!config.isLoggedIn()) {
      if (isJsonOutput(opts)) {
        process.stdout.write(JSON.stringify({ ok: false, error: 'not_authenticated' }, null, 2) + '\n');
      } else {
        console.error(chalk.red('Not authenticated. Run: solid auth login'));
      }
      process.exit(1);
    }

    let doc: JsonLdDocument;
    try {
      doc = await fetchJsonLd();
    } catch (err) {
      const e = handleApiError(err);
      if (isJsonOutput(opts)) {
        process.stdout.write(JSON.stringify({ ok: false, error: e.message }, null, 2) + '\n');
      } else {
        console.error(chalk.red(`Failed to fetch JSON-LD context: ${e.message}`));
      }
      process.exit(1);
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
]);
