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
