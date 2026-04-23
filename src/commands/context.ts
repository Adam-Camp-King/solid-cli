/**
 * Context command for Solid CLI (T11 — Agency-AI Mode)
 *
 * Single-round-trip, full-picture context dump for AI coding agents.
 * The heavy lifting lives on the backend (`GET /api/v1/cli/context`) so
 * Claude Code / Cursor / any MCP client get the same data as the CLI.
 *
 * Output modes:
 *   solid context                     → markdown to stdout
 *   solid context --json              → JSON to stdout
 *   solid context --claude            → writes BOTH
 *                                         .claude/CLAUDE.md          (markdown, human-readable)
 *                                         .claude/solid-context.json (raw JSON for agents)
 *   solid context --cursor            → .cursorrules
 *   solid context --save              → ./SOLID-CONTEXT.md
 *   solid context --section <name>    → one section only (cheap refresh)
 *   solid context --tools-only        → just the CLI tool manifest
 *   solid context --summary           → lightweight counts
 *   solid context --watch             → auto-refresh every N seconds
 *
 * Sections: company, content, operations, capabilities, history, tooling
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';
import { isJsonOutput } from '../lib/json-output';

type ContextSection = 'company' | 'content' | 'operations' | 'capabilities' | 'history' | 'tooling';

interface ContextResponse {
  platform: string;
  version: string;
  generated_at: string;
  company: Record<string, unknown>;
  content: Record<string, unknown>;
  operations: Record<string, unknown>;
  capabilities: Record<string, unknown>;
  history: Record<string, unknown>;
  tooling: Record<string, unknown>;
}

interface MarkdownResponse {
  content: string;
  format: 'markdown';
}

interface SectionResponse {
  section: string;
  data: unknown;
  generated_at: string;
}

interface SummaryResponse {
  company_name: string;
  industry: string;
  tier: string;
  kb_count: number;
  page_count: number;
  pending_drafts: number;
  service_count: number;
  product_count: number;
  agent_count: number;
  chain_count: number;
  module_count: number;
  custom_domain_count: number;
  agency_managed: boolean;
  recent_activity_count: number;
  generated_at: string;
}

interface ToolEntry {
  command: string;
  scope: string;
  mutates: boolean;
  description: string;
}

interface ToolManifestResponse {
  tools: ToolEntry[];
  total: number;
  mutating: number;
  read_only: number;
  scopes_in_use: string[];
}

// ── Ladder mode (SPRINT-CONTEXT-LIBRARY-DDC) ─────────────────────────
// `--claude --ladder` emits a slim spine + one file per non-empty DDC
// shelf under `.claude/library/`, instead of a 70KB monolith. The
// backend does the classification + rendering; the CLI is just an I/O
// layer here.

interface SpineResponse {
  content: string;
  bytes: number;
  schema: string;
  format: string;
  generated_at: string;
}

interface ShelvesResponse {
  shelves: Record<string, string>;  // {ddc: markdown}
  count: number;
  entry_total: number;
  schema: string;
  generated_at: string;
}

async function fetchSpine(): Promise<SpineResponse> {
  const res = await apiClient.get<SpineResponse>('/api/v1/cli/context/spine');
  return res.data;
}

async function fetchShelves(): Promise<ShelvesResponse> {
  const res = await apiClient.get<ShelvesResponse>('/api/v1/cli/context/shelves');
  return res.data;
}

// Pure helpers live in lib/context-ladder so they're testable without
// pulling in ora/chalk (ESM-only). See SPRINT-CONTEXT-LIBRARY-DDC.
import { writeLadder, LadderWriteResult } from '../lib/context-ladder';

async function fetchContext(format: 'markdown' | 'json', minimal: boolean, section?: ContextSection): Promise<string | ContextResponse | SectionResponse> {
  const params: Record<string, string> = { format, minimal: String(minimal) };
  if (section) params.section = section;
  const qs = new URLSearchParams(params).toString();
  const url = `/api/v1/cli/context?${qs}`;

  if (section) {
    const res = await apiClient.get<SectionResponse>(url);
    return res.data;
  }
  if (format === 'json') {
    const res = await apiClient.get<ContextResponse>(url);
    return res.data;
  }
  const res = await apiClient.get<MarkdownResponse>(url);
  return res.data.content;
}

async function fetchSummary(): Promise<SummaryResponse> {
  const res = await apiClient.get<SummaryResponse>('/api/v1/cli/context/summary');
  return res.data;
}

async function fetchTools(): Promise<ToolManifestResponse> {
  const res = await apiClient.get<ToolManifestResponse>('/api/v1/cli/context/tools');
  return res.data;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function printClaudeNextSteps(markdownPath: string, jsonPath: string, markdownBytes: number, jsonBytes: number): void {
  console.log('');
  const lines: string[] = [
    `${chalk.dim('Markdown:')} ${markdownPath} (${formatBytes(markdownBytes)})`,
    `${chalk.dim('JSON:')}     ${jsonPath} (${formatBytes(jsonBytes)})`,
    '',
    `${chalk.dim('Claude Code auto-reads .claude/CLAUDE.md.')}`,
    `${chalk.dim('For programmatic access:')} ${chalk.cyan('cat .claude/solid-context.json')}`,
    `${chalk.dim('Refresh:')} ${chalk.cyan('solid context --claude')}`,
    `${chalk.dim('Watch mode:')} ${chalk.cyan('solid context --claude --watch')}`,
    '',
    `${chalk.dim('This is the legacy monolithic mode (--full).')}`,
    `${chalk.dim('Drop the --full flag for the slim Dewey-classified library.')}`,
  ];
  console.log(ui.successBox('AI Context Ready (full/legacy mode)', lines));
  console.log('');
}

function printLadderNextSteps(r: LadderWriteResult, jsonPath: string, jsonBytes: number): void {
  console.log('');
  const spineWarn = r.spineBytes > 8_000 ? chalk.yellow(` ⚠ over 8KB cap`) : chalk.green(' ✓');
  const lines: string[] = [
    `${chalk.dim('Spine:')}    ${r.spinePath} (${formatBytes(r.spineBytes)})${spineWarn}`,
    `${chalk.dim('Shelves:')}  ${r.libraryDir}/ — ${r.shelfCount} file${r.shelfCount === 1 ? '' : 's'} (${formatBytes(r.shelfBytes)} total)`,
    `${chalk.dim('JSON:')}     ${jsonPath} (${formatBytes(jsonBytes)})`,
    '',
    `${chalk.dim('Claude Code auto-reads .claude/CLAUDE.md (the spine).')}`,
    `${chalk.dim('Shelves load on demand when Claude runs')} ${chalk.cyan('cat .claude/library/<NNN>-<slug>.md')}${chalk.dim('.')}`,
    `${chalk.dim('Full volumes live in the DB:')} ${chalk.cyan('solid kb get <id>')}`,
    '',
    `${chalk.dim('Refresh:')} ${chalk.cyan('solid context --claude')}`,
    `${chalk.dim('Legacy single-file mode:')} ${chalk.cyan('solid context --claude --full')}`,
  ];
  console.log(ui.successBox('AI Context Library Ready (DDC mode)', lines));
  console.log('');
}

function printCursorNextSteps(outputPath: string, bytes: number): void {
  console.log('');
  console.log(ui.successBox('AI Context Ready', [
    `${chalk.dim('Saved:')} ${outputPath} (${formatBytes(bytes)})`,
    `${chalk.dim('Cursor auto-reads .cursorrules.')}`,
    `${chalk.dim('Refresh:')} ${chalk.cyan('solid context --cursor')}`,
  ]));
  console.log('');
}

function printCodexNextSteps(outputPath: string, bytes: number): void {
  console.log('');
  console.log(ui.successBox('AI Context Ready', [
    `${chalk.dim('Saved:')} ${outputPath} (${formatBytes(bytes)})`,
    `${chalk.dim('AGENTS.md is read by Codex, Claude Code, Cursor, and Gemini when present.')}`,
    `${chalk.dim('Refresh:')} ${chalk.cyan('solid context --codex')}`,
  ]));
  console.log('');
}

function printGenericNextSteps(outputPath: string, bytes: number): void {
  console.log('');
  console.log(ui.successBox('Context Saved', [
    `${chalk.dim('Saved:')} ${outputPath} (${formatBytes(bytes)})`,
    `${chalk.dim('For Claude Code:')} ${chalk.cyan('solid context --claude')}`,
    `${chalk.dim('For Cursor:')}      ${chalk.cyan('solid context --cursor')}`,
  ]));
  console.log('');
}

function renderSummary(s: SummaryResponse): void {
  console.log('');
  console.log(chalk.bold('  Company'));
  console.log(`    Name:     ${s.company_name}`);
  console.log(`    Industry: ${s.industry}`);
  console.log(`    Tier:     ${s.tier}`);
  console.log('');
  console.log(chalk.bold('  Content'));
  console.log(`    Pages:             ${s.page_count} ${s.pending_drafts > 0 ? chalk.yellow(`(${s.pending_drafts} with pending drafts)`) : ''}`);
  console.log(`    KB entries:        ${s.kb_count}`);
  console.log(`    Services:          ${s.service_count}`);
  console.log(`    Products:          ${s.product_count}`);
  console.log(`    Agents:            ${s.agent_count}`);
  console.log(`    Chains:            ${s.chain_count}`);
  console.log(`    Custom modules:    ${s.module_count}`);
  console.log(`    Custom domains:    ${s.custom_domain_count}`);
  console.log('');
  if (s.agency_managed) {
    console.log(chalk.yellow(`  🔒 Agency-managed — check locks with: solid company lock-status`));
    console.log('');
  }
  console.log(chalk.dim(`  API calls last 24h: ${s.recent_activity_count}`));
  console.log(chalk.dim(`  Generated: ${s.generated_at}`));
  console.log('');
}

function renderTools(m: ToolManifestResponse): void {
  console.log('');
  console.log(chalk.bold(`  CLI tool manifest — ${m.total} verbs (${m.read_only} read, ${m.mutating} mutate)`));
  console.log(chalk.dim(`  Scopes in use: ${m.scopes_in_use.join(', ')}`));
  console.log('');
  const maxCmd = Math.max(...m.tools.map((t) => t.command.length));
  const maxScope = Math.max(...m.tools.map((t) => t.scope.length));
  m.tools.forEach((t) => {
    const mark = t.mutates ? chalk.yellow('✏️ ') : chalk.dim('👁 ');
    const cmd = t.command.padEnd(maxCmd);
    const scope = t.scope.padEnd(maxScope);
    console.log(`  ${mark} ${chalk.cyan(cmd)}  ${chalk.dim(scope)}  ${t.description}`);
  });
  console.log('');
}

export const contextCommand = new Command('context')
  .description('One-shot AI context dump (company state, locks, drafts, tools) — T11 agency mode')
  .option('--save', 'Save to ./SOLID-CONTEXT.md')
  .option('--claude', 'Save a Dewey-classified library: slim .claude/CLAUDE.md spine + .claude/library/<NNN>-<slug>.md shelves Claude loads on demand')
  .option('--ladder', '(Deprecated alias for --claude ladder mode; retained for compatibility)')
  .option('--full', 'With --claude, emit the legacy monolithic CLAUDE.md (every KB entry inline — can exceed 40KB and trigger Claude Code size warnings)')
  .option('--cursor', 'Save to ./.cursorrules')
  .option('--codex', 'Save to ./AGENTS.md (the emerging cross-agent standard: Codex / Claude / Cursor / Gemini)')
  .option('--json', 'Output JSON to stdout')
  .option('--minimal', 'Compact markdown (drops the tool manifest table)')
  .option('--section <name>', 'Return only one section: company, content, operations, capabilities, history, tooling')
  .option('--tools-only', 'Just the CLI tool manifest (for MCP servers / AI harnesses)')
  .option('--summary', 'Lightweight counts (fast)')
  .option('--watch', 'Auto-refresh the output file on change (use with --claude/--cursor/--save)')
  .option('--interval <seconds>', 'Watch interval in seconds (default: 30)', '30')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` or export SOLID_API_KEY.'));
      process.exit(1);
    }
    if (!config.companyId) {
      console.error(chalk.red('No company selected. Run `solid auth login` first.'));
      process.exit(1);
    }

    // ── Fast paths ────────────────────────────────────────────────
    if (options.summary) {
      const spinner = ora('Loading summary...').start();
      try {
        const s = await fetchSummary();
        spinner.stop();
        if (isJsonOutput(options)) {
          console.log(JSON.stringify(s, null, 2));
          return;
        }
        renderSummary(s);
      } catch (error) {
        spinner.fail(chalk.red('Failed'));
        console.error(chalk.red(handleApiError(error).message));
        process.exit(1);
      }
      return;
    }

    if (options.toolsOnly) {
      const spinner = ora('Loading tool manifest...').start();
      try {
        const m = await fetchTools();
        spinner.stop();
        if (isJsonOutput(options)) {
          console.log(JSON.stringify(m, null, 2));
          return;
        }
        renderTools(m);
      } catch (error) {
        spinner.fail(chalk.red('Failed'));
        console.error(chalk.red(handleApiError(error).message));
        process.exit(1);
      }
      return;
    }

    if (options.section) {
      const valid = ['company', 'content', 'operations', 'capabilities', 'history', 'tooling'];
      if (!valid.includes(options.section)) {
        console.error(chalk.red(`Unknown section. Valid: ${valid.join(', ')}`));
        process.exit(1);
      }
      try {
        const res = await fetchContext('json', false, options.section as ContextSection);
        console.log(JSON.stringify(res, null, 2));
      } catch (error) {
        console.error(chalk.red(handleApiError(error).message));
        process.exit(1);
      }
      return;
    }

    // ── Full context paths ────────────────────────────────────────
    const isSaving = Boolean(options.save || options.claude || options.cursor || options.codex || options.watch);
    const spinner = isSaving ? ora('Building AI context package...').start() : null;

    let doc: string;
    let jsonDoc: string | null = null;
    try {
      if (isJsonOutput(options)) {
        const data = await fetchContext('json', !!options.minimal);
        doc = JSON.stringify(data, null, 2);
      } else {
        const md = await fetchContext('markdown', !!options.minimal);
        doc = md as string;
        // --claude also writes JSON alongside; fetch it now
        if (options.claude) {
          const data = await fetchContext('json', !!options.minimal);
          jsonDoc = JSON.stringify(data, null, 2);
        }
      }
    } catch (error) {
      if (spinner) spinner.fail(chalk.red('Failed to build context'));
      const apiError = handleApiError(error);
      console.error(chalk.red(apiError.message));
      process.exit(1);
    }

    // ── Write files ───────────────────────────────────────────────
    let markdownPath: string | null = null;
    let jsonPath: string | null = null;
    let outputMode: 'claude' | 'cursor' | 'codex' | 'file' | 'stdout' = 'stdout';

    // Ladder mode is now the default for --claude. Legacy --full opts
    // back into the monolithic CLAUDE.md (which can exceed 40KB and
    // trigger the Claude Code "large file will impact performance"
    // warning). --ladder is retained as an alias for backward compat
    // with existing tooling / muscle memory.
    const useLadder = options.claude && !options.full;
    if (useLadder) {
      // Ladder mode: slim spine + one file per DDC shelf. The `doc`
      // (legacy monolith markdown) is ignored — we fetch the spine +
      // shelves fresh from the two new endpoints.
      outputMode = 'claude';
      try {
        const [spineRes, shelvesRes] = await Promise.all([fetchSpine(), fetchShelves()]);
        const writeRes = writeLadder(spineRes.content, shelvesRes.shelves, process.cwd());
        jsonPath = path.join(writeRes.libraryDir, '..', 'solid-context.json');
        if (jsonDoc) fs.writeFileSync(jsonPath, jsonDoc);
        spinner?.succeed(chalk.green('AI context library ready'));
        printLadderNextSteps(writeRes, jsonPath, jsonDoc ? Buffer.byteLength(jsonDoc, 'utf-8') : 0);
        // Skip the remaining output-mode branches — ladder mode prints its own summary
        return;
      } catch (error) {
        spinner?.fail(chalk.red('Failed to build DDC library'));
        console.error(chalk.red(handleApiError(error).message));
        process.exit(1);
      }
    } else if (options.claude) {
      // --claude --full: legacy monolithic mode. Single .claude/CLAUDE.md
      // with every KB entry inlined. Warn if it crosses the 40KB
      // Claude Code threshold so the user knows what they opted into.
      outputMode = 'claude';
      const claudeDir = path.resolve('.claude');
      if (!fs.existsSync(claudeDir)) fs.mkdirSync(claudeDir, { recursive: true });
      markdownPath = path.join(claudeDir, 'CLAUDE.md');
      jsonPath = path.join(claudeDir, 'solid-context.json');
      fs.writeFileSync(markdownPath, doc);
      if (jsonDoc) fs.writeFileSync(jsonPath, jsonDoc);
      const bytes = Buffer.byteLength(doc, 'utf-8');
      if (bytes > 40_000) {
        console.log('');
        console.log(chalk.yellow(`  ⚠ --full wrote ${Math.round(bytes / 1024)}KB — Claude Code warns above 40KB.`));
        console.log(chalk.dim(`     Drop the flag (or use ${chalk.cyan('solid context --claude')}) for the slim ladder library.`));
      }
    } else if (options.cursor) {
      outputMode = 'cursor';
      markdownPath = path.resolve('.cursorrules');
      fs.writeFileSync(markdownPath, doc);
    } else if (options.codex) {
      outputMode = 'codex';
      // AGENTS.md is the emerging multi-agent convention — one file that
      // Claude Code, Cursor, Codex, and Gemini all read when present.
      markdownPath = path.resolve('AGENTS.md');
      fs.writeFileSync(markdownPath, doc);
    } else if (options.save || options.watch) {
      outputMode = 'file';
      markdownPath = path.resolve('SOLID-CONTEXT.md');
      fs.writeFileSync(markdownPath, doc);
    }

    spinner?.succeed(chalk.green('AI context ready'));

    if (outputMode === 'claude' && markdownPath && jsonPath) {
      const mdBytes = fs.statSync(markdownPath).size;
      const jsonBytes = jsonDoc ? fs.statSync(jsonPath).size : 0;
      printClaudeNextSteps(markdownPath, jsonPath, mdBytes, jsonBytes);
    } else if (outputMode === 'cursor' && markdownPath) {
      printCursorNextSteps(markdownPath, fs.statSync(markdownPath).size);
    } else if (outputMode === 'codex' && markdownPath) {
      printCodexNextSteps(markdownPath, fs.statSync(markdownPath).size);
    } else if (outputMode === 'file' && markdownPath) {
      printGenericNextSteps(markdownPath, fs.statSync(markdownPath).size);
    } else {
      process.stdout.write(doc);
      if (!doc.endsWith('\n')) process.stdout.write('\n');
    }

    // ── Watch mode ────────────────────────────────────────────────
    if (options.watch && markdownPath) {
      const intervalSec = Math.max(10, parseInt(options.interval, 10) || 30);
      let lastHash = simpleHash(doc);

      console.log(chalk.dim(`  Watching every ${intervalSec}s (Ctrl+C to stop)`));
      console.log('');

      const tick = async () => {
        try {
          const freshMd = options.json
            ? JSON.stringify(await fetchContext('json', !!options.minimal), null, 2)
            : ((await fetchContext('markdown', !!options.minimal)) as string);
          const h = simpleHash(freshMd);
          if (h !== lastHash) {
            fs.writeFileSync(markdownPath!, freshMd);
            if (outputMode === 'claude' && jsonPath) {
              const freshJson = JSON.stringify(await fetchContext('json', !!options.minimal), null, 2);
              fs.writeFileSync(jsonPath, freshJson);
            }
            lastHash = h;
            const t = new Date().toLocaleTimeString();
            console.log(chalk.green(`  [${t}] context refreshed`));
          }
        } catch {
          // Silently skip transient failures — don't kill the watch loop
        }
      };

      setInterval(tick, intervalSec * 1000);
      await new Promise(() => {}); // keep alive
    }
  });

import { appendExamples as __ae_context } from '../lib/command-kit';
__ae_context(contextCommand, [
  { cmd: 'solid context --claude',           why: 'Dump full company context into Claude (the killer workflow)' },
  { cmd: 'solid context --claude --ladder',  why: 'Dewey-classified context library (≤8KB spine + on-demand shelves)' },
  { cmd: 'solid context --cursor',           why: 'Dump into Cursor' },
  { cmd: 'solid context --json',             why: 'Raw payload for any AI client' },
]);
