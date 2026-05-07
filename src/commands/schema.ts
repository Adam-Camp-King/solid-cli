/**
 * solid schema — expose CMS / page block schemas so AI coding agents
 * (Claude Code, Cursor, Codex) can generate valid content without reading
 * the frontend component source.
 *
 *   solid schema pages                          → list all 27 block types
 *   solid schema pages --block hero             → details for one block
 *   solid schema pages --block hero --json      → raw JSON for programmatic use
 *   solid schema pages --json                   → full schema as JSON
 *   solid schema pages --category "Social Proof"
 *
 * Data source: static file at src/data/cms-blocks.json, kept in sync with
 * Owners-Manual/71-Agent-Native-CLI/05-BLOCK-SCHEMA.md. When a backend
 * schema endpoint lands, this command can be retargeted to fetch live.
 */
import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { isJsonOutput } from '../lib/json-output';
import { getProgram } from '../lib/program-registry';
import { buildVerbManifest } from '../lib/verb-manifest';
import { CLI_VERSION } from '../lib/api-client';

type BlockDef = {
  type: string;
  component: string;
  category: string;
  aliases?: string[];
  props?: Record<string, string>;
  enums?: Record<string, string[]>;
  notes?: string;
  example?: unknown;
};

type SchemaDoc = {
  _meta: { version: string; source: string; note: string; extracted_from: string };
  envelope: { sections: string; notes: string[] };
  blocks: BlockDef[];
};

function loadSchema(): SchemaDoc {
  const file = path.join(__dirname, '..', 'data', 'cms-blocks.json');
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as SchemaDoc;
}

function printBlock(block: BlockDef): void {
  const aliases = block.aliases?.length ? chalk.dim(`  (aliases: ${block.aliases.join(', ')})`) : '';
  console.log('');
  console.log(`${chalk.bold.cyan(block.type)}${aliases}`);
  console.log(`  ${chalk.dim('component:')} ${block.component}   ${chalk.dim('category:')} ${block.category}`);
  if (block.props && Object.keys(block.props).length > 0) {
    console.log(`  ${chalk.dim('props:')}`);
    for (const [name, type] of Object.entries(block.props)) {
      console.log(`    ${chalk.green(name)}: ${chalk.dim(type)}`);
    }
  }
  if (block.enums) {
    console.log(`  ${chalk.dim('enums:')}`);
    for (const [name, values] of Object.entries(block.enums)) {
      console.log(`    ${chalk.green(name)}: ${values.map((v) => `"${v}"`).join(' | ')}`);
    }
  }
  if (block.notes) {
    console.log(`  ${chalk.dim('notes:')} ${block.notes}`);
  }
  if (block.example) {
    console.log(`  ${chalk.dim('example:')}`);
    const lines = JSON.stringify(block.example, null, 2).split('\n');
    for (const l of lines) console.log(chalk.dim(`    ${l}`));
  }
}

export const schemaCommand = new Command('schema').description('CMS / page block schema for AI coding agents');

// Default action — `solid schema` (no subcommand) defaults to dumping the
// full verb manifest as JSON, since that is the single highest-leverage
// thing an agent typically wants. Without this default, agents had to
// guess `solid schema verbs --json` on the first try; now `solid schema
// --json` works too. Falls back to help text in non-JSON mode so humans
// still discover the subcommands.
schemaCommand
  .option('--json', 'Emit the full verb manifest as JSON (same as `schema verbs --json`)')
  .option('--include-hidden', 'Include commands hidden from --help')
  .action((opts) => {
    if (isJsonOutput(opts)) {
      const program = getProgram();
      if (!program) {
        process.stdout.write(JSON.stringify({ error: { code: 'SERVER_ERROR', message: 'program-registry not initialized' } }) + '\n');
        process.exit(1);
      }
      const manifest = buildVerbManifest(program, CLI_VERSION, {
        prefix: 'solid',
        skipRoot: true,
        includeHidden: Boolean(opts.includeHidden),
      });
      process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
      return;
    }
    schemaCommand.outputHelp();
  });

schemaCommand
  .command('pages')
  .description('Show the page layout_json block schema (27 block types)')
  .option('--block <type>', 'Show details for a single block type (e.g., hero)')
  .option('--category <name>', 'Filter blocks by category (e.g., "Social Proof")')
  .option('--json', 'Output as JSON for programmatic consumption')
  .action((opts) => {
    const schema = loadSchema();

    // --block hero → one block
    if (opts.block) {
      const target = String(opts.block).toLowerCase();
      const block = schema.blocks.find(
        (b) => b.type.toLowerCase() === target || b.aliases?.some((a) => a.toLowerCase() === target),
      );
      if (!block) {
        console.error(chalk.red(`Unknown block type: ${opts.block}`));
        console.error(chalk.dim('  Run `solid schema pages` to list all available types.'));
        process.exit(1);
      }
      if (isJsonOutput(opts)) {
        console.log(JSON.stringify(block, null, 2));
        return;
      }
      printBlock(block);
      return;
    }

    // --category Filter
    let blocks = schema.blocks;
    if (opts.category) {
      const cat = String(opts.category).toLowerCase();
      blocks = blocks.filter((b) => b.category.toLowerCase() === cat);
      if (blocks.length === 0) {
        console.error(chalk.red(`No blocks in category: ${opts.category}`));
        const cats = [...new Set(schema.blocks.map((b) => b.category))];
        console.error(chalk.dim(`  Available: ${cats.join(', ')}`));
        process.exit(1);
      }
    }

    // --json → full schema
    if (isJsonOutput(opts)) {
      console.log(JSON.stringify({ ...schema, blocks }, null, 2));
      return;
    }

    // Human-readable summary
    console.log('');
    console.log(chalk.bold('Page layout_json envelope'));
    console.log(chalk.dim(`  Top-level:  { "sections": [ { "type": string, ...props } ] }`));
    console.log(chalk.dim(`  Schema v${schema._meta.version}   source: ${schema._meta.source}`));
    console.log('');

    // Group by category
    const byCat = new Map<string, BlockDef[]>();
    for (const b of blocks) {
      if (!byCat.has(b.category)) byCat.set(b.category, []);
      byCat.get(b.category)!.push(b);
    }

    for (const [category, list] of byCat) {
      console.log(chalk.bold(`  ${category}`));
      for (const b of list) {
        const aliases = b.aliases?.length ? chalk.dim(` (aliases: ${b.aliases.join(', ')})`) : '';
        console.log(`    ${chalk.cyan(b.type.padEnd(16))} ${chalk.dim(b.component)}${aliases}`);
      }
      console.log('');
    }

    console.log(chalk.dim(`  ${blocks.length} block types. Use --block <type> for props, --json for machine output.`));
    console.log('');
  });

// ---------------------------------------------------------------------------
// solid schema blocks — (A.3 of SPRINT-CLI-AGENT-CAN-SHIP)
//
// `schema pages` already lists block types and their props. This new
// subcommand emits a canonical EXAMPLE per block type. Agents stop
// guessing block shape from the source; they get a runnable JSON
// snippet they can paste directly into a layout.
// ---------------------------------------------------------------------------
schemaCommand
  .command('blocks')
  .description('Emit canonical example JSON per block type — agents copy/paste, no inference (A.3)')
  .option('--examples', 'Emit examples (default for this subcommand)')
  .option('--type <name>', 'Show one block type only (e.g., hero)')
  .option('--json', 'Emit JSON; without --json renders a human-readable list')
  .action(async (opts) => {
    const { synthesizeExample, synthesizeAllExamples } = await import('../lib/block-example-synth');
    const schema = loadSchema();

    if (opts.type) {
      const target = String(opts.type).toLowerCase();
      const block = schema.blocks.find(
        (b) => b.type.toLowerCase() === target || b.aliases?.some((a) => a.toLowerCase() === target),
      );
      if (!block) {
        console.error(chalk.red(`Unknown block type: ${opts.type}`));
        console.error(chalk.dim('  Run `solid schema blocks` to list all available types.'));
        process.exit(1);
      }
      const ex = synthesizeExample(block);
      if (isJsonOutput(opts)) {
        process.stdout.write(JSON.stringify(ex, null, 2) + '\n');
        return;
      }
      console.log('');
      console.log(chalk.bold.cyan(block.type));
      console.log(chalk.dim(`  category: ${block.category}`));
      console.log('');
      const lines = JSON.stringify(ex, null, 2).split('\n');
      for (const l of lines) console.log(`  ${l}`);
      console.log('');
      return;
    }

    // All blocks
    const all = synthesizeAllExamples(schema.blocks);
    if (isJsonOutput(opts)) {
      process.stdout.write(JSON.stringify({ examples: all, count: schema.blocks.length }, null, 2) + '\n');
      return;
    }

    console.log('');
    console.log(chalk.bold(`${schema.blocks.length} block types — canonical examples`));
    console.log('');
    for (const [type, ex] of Object.entries(all)) {
      console.log(chalk.bold.cyan(type));
      const lines = JSON.stringify(ex, null, 2).split('\n');
      for (const l of lines) console.log(chalk.dim(`  ${l}`));
      console.log('');
    }
  });

// ---------------------------------------------------------------------------
// solid schema verbs — (Sprint 1 T1.3) enumerate the full CLI verb tree so
// agents can discover every command without scraping --help. Builds a
// manifest by walking the Commander tree stored in program-registry.
// ---------------------------------------------------------------------------
schemaCommand
  .command('verbs')
  .description('Emit the full verb manifest (every command + options + args)')
  .option('--json', 'Output as JSON (default shape for agents)')
  .option('--include-hidden', 'Include commands hidden from --help')
  .action((opts) => {
    const program = getProgram();
    if (!program) {
      const err = {
        error: {
          code: 'SERVER_ERROR',
          status: 500,
          message:
            'program-registry not initialized — this is a CLI bug. ' +
            'Open an issue: https://github.com/Adam-Camp-King/solid-cli/issues',
        },
      };
      if (isJsonOutput(opts)) {
        process.stdout.write(JSON.stringify(err, null, 2) + '\n');
      } else {
        console.error(chalk.red(err.error.message));
      }
      process.exit(1);
    }

    const manifest = buildVerbManifest(program, CLI_VERSION, {
      prefix: 'solid',
      skipRoot: true,
      includeHidden: Boolean(opts.includeHidden),
    });

    // Under --json or SOLID_JSON, emit the full wire shape to stdout.
    // Otherwise print a short human summary to make the command self-
    // describing when invoked without --json.
    if (isJsonOutput(opts)) {
      process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
      return;
    }
    console.log('');
    console.log(chalk.bold(`Solid# CLI verbs — ${manifest.count} total`));
    console.log(chalk.dim(`  v${manifest.cli_version}  ·  schema v${manifest.version}`));
    console.log('');
    for (const v of manifest.verbs) {
      const indent = '  '.repeat(v.depth + 1);
      const leaf = v.is_leaf ? '' : chalk.dim(`  (${v.subcommands.length} subcommand${v.subcommands.length === 1 ? '' : 's'})`);
      console.log(`${indent}${chalk.cyan(v.verb)}${leaf}`);
      if (v.description) console.log(chalk.dim(`${indent}  ${v.description}`));
    }
    console.log('');
    console.log(chalk.dim('  Run with --json for the full machine-readable manifest.'));
    console.log('');
  });

import { appendExamples as __ae_schema } from '../lib/command-kit';
__ae_schema(schemaCommand, [
  { cmd: 'solid schema pages',             why: 'Page block schema — feed this to AI coding agents' },
  { cmd: 'solid schema pages --format yaml', why: 'YAML instead of JSON' },
  { cmd: 'solid schema verbs --json',      why: 'Full CLI verb manifest for agent discovery' },
]);
