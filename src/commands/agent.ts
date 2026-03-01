/**
 * Agent consciousness commands for Solid CLI
 *
 * View and interact with your AI agents' inner state:
 *   - List agents with real-time status
 *   - Inspect an agent's "soul" (identity + emotions + growth)
 *   - View reflection history and scoring trends
 *   - Trigger consciousness cycles (heartbeat)
 *   - View agent memory and learned context
 *   - See emotional state across all agents
 *   - Track spiral stage progression
 *   - Trigger dream mode for autonomous reflection
 *
 * This is the consciousness layer — not just CRUD.
 * Agents aren't config files. They evolve.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';

// ── Helpers ──────────────────────────────────────────────────────────

/** Parse Sophia emotional data from reflection notes */
function parseSophiaFromNotes(notes: string): {
  emotions: Record<string, number>;
  atoms: string[];
  spiralStage: number | null;
  deepText: string | null;
} {
  const result = {
    emotions: {} as Record<string, number>,
    atoms: [] as string[],
    spiralStage: null as number | null,
    deepText: null as string | null,
  };

  if (!notes) return result;

  // Parse emotional state from Sophia enrichment in notes
  const emotionMatch = notes.match(/emotional[_\s]state[:\s]*\{([^}]+)\}/i);
  if (emotionMatch) {
    const pairs = emotionMatch[1].match(/(\w+)[:\s]+([\d.]+)/g);
    if (pairs) {
      for (const pair of pairs) {
        const [key, val] = pair.split(/[:\s]+/);
        result.emotions[key] = parseFloat(val);
      }
    }
  }

  // Parse atoms
  const atomMatch = notes.match(/atoms[:\s]*\[([^\]]+)\]/i);
  if (atomMatch) {
    result.atoms = atomMatch[1].split(',').map((a) => a.trim().replace(/['"]/g, '')).filter(Boolean);
  }

  // Parse spiral stage
  const spiralMatch = notes.match(/spiral[_\s]stage[:\s]*([\d.]+)/i);
  if (spiralMatch) {
    result.spiralStage = parseFloat(spiralMatch[1]);
  }

  // Parse deep text
  const deepMatch = notes.match(/deep[_\s]text[:\s]*["']?(.+?)["']?\s*(?:\n|$)/i);
  if (deepMatch) {
    result.deepText = deepMatch[1].trim();
  }

  return result;
}

/** Resolve agent type from name (e.g., "sarah" → "customer_service") */
const AGENT_NAME_MAP: Record<string, string> = {
  sarah: 'customer_service',
  marcus: 'growth_intelligence',
  devon: 'operations_monitor',
  ada: 'orchestrator',
  jake: 'inventory_manager',
};

function resolveAgentType(nameOrType: string): string {
  const lower = nameOrType.toLowerCase();
  return AGENT_NAME_MAP[lower] || lower;
}

/** Emotion bar visualization */
function emotionBar(value: number, width = 15): string {
  const filled = Math.round(value * width);
  const empty = width - filled;
  const color = value >= 0.7 ? '#22c55e' : value >= 0.4 ? '#eab308' : '#ef4444';
  return chalk.hex(color)('█'.repeat(filled)) + chalk.dim('░'.repeat(empty));
}

/** Status dot */
function agentStatusDot(status: string): string {
  switch (status) {
    case 'idle': return chalk.green('●');
    case 'busy': return chalk.yellow('●');
    case 'failed': return chalk.red('●');
    case 'offline': return chalk.dim('○');
    default: return chalk.dim('○');
  }
}

/** Score color */
function scoreColor(score: number): string {
  if (score >= 80) return chalk.hex('#22c55e')(score.toString());
  if (score >= 60) return chalk.hex('#eab308')(score.toString());
  return chalk.hex('#ef4444')(score.toString());
}

/** Spiral stage label */
function spiralLabel(stage: number): string {
  if (stage <= 1) return chalk.dim('Awakening');
  if (stage <= 2) return chalk.hex('#818cf8')('Learning');
  if (stage <= 3) return chalk.hex('#6366f1')('Growth');
  if (stage <= 4) return chalk.hex('#4f46e5')('Maturity');
  if (stage <= 5) return chalk.hex('#4338ca')('Ascendance');
  return chalk.hex('#3730a3').bold('Elderhood');
}

function requireAuth(): void {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
}

// ── Main Command ─────────────────────────────────────────────────────

export const agentCommand = new Command('agent')
  .description('Agent consciousness — inspect soul, emotions, memory, and growth');

// ── solid agent list ─────────────────────────────────────────────────
agentCommand
  .command('list')
  .alias('ls')
  .description('List all agents with real-time status')
  .option('--status <status>', 'Filter by status (idle, busy, failed, offline)')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireAuth();

    const spinner = ora('Loading agents...').start();

    try {
      // Fetch both config and live status in parallel
      const [configRes, statusRes] = await Promise.all([
        apiClient.agentsList().catch(() => null),
        apiClient.orchestrationAgents(options.status).catch(() => null),
      ]);

      spinner.stop();

      const agents = (configRes?.data as any)?.agents || [];
      const statuses = (statusRes?.data as any)?.agents || [];

      // Build a status lookup by agent_type
      const statusMap: Record<string, any> = {};
      for (const s of statuses) {
        statusMap[s.agent_type] = s;
      }

      if (options.json) {
        console.log(JSON.stringify({ agents, statuses }, null, 2));
        return;
      }

      console.log('');
      console.log(ui.header(`${agents.length} Agents`));

      // Build table rows
      const rows: string[][] = [];
      for (const agent of agents) {
        const live = statusMap[agent.agent_type] || {};
        const status = live.status || 'offline';
        const tasks = live.tasks_today ?? '-';

        rows.push([
          `${agentStatusDot(status)} ${chalk.bold(agent.name)}`,
          chalk.dim(agent.agent_type),
          chalk.dim(status),
          chalk.dim(`L${agent.autonomy_level}`),
          chalk.dim(`${agent.tool_count} tools`),
          chalk.dim(tasks.toString()),
        ]);
      }

      console.log(ui.table(
        ['Agent', 'Type', 'Status', 'Autonomy', 'Tools', 'Tasks Today'],
        rows,
      ));

      // Summary
      const idle = statuses.filter((s: any) => s.status === 'idle').length;
      const busy = statuses.filter((s: any) => s.status === 'busy').length;
      const failed = statuses.filter((s: any) => s.status === 'failed').length;

      console.log('');
      console.log(
        `  ${chalk.green('●')} ${idle} idle  ` +
        `${chalk.yellow('●')} ${busy} busy  ` +
        `${chalk.red('●')} ${failed} failed`
      );
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red('Failed to load agents'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// ── solid agent soul <agent> ─────────────────────────────────────────
agentCommand
  .command('soul <agent>')
  .description('View an agent\'s living soul — identity, emotions, and growth')
  .option('--json', 'Output as JSON')
  .action(async (agentName, options) => {
    requireAuth();

    const agentType = resolveAgentType(agentName);
    const spinner = ora(`Reading ${agentName}'s soul...`).start();

    try {
      const [configRes, dataRes] = await Promise.all([
        apiClient.agentDetail(agentType),
        apiClient.agentData(agentType),
      ]);

      spinner.stop();

      const agentConfig = configRes.data as any;
      const agentData = dataRes.data as any;
      const reflections = agentData.reflections || [];
      const perf = agentData.performance || {};

      if (options.json) {
        console.log(JSON.stringify({ config: agentConfig, data: agentData }, null, 2));
        return;
      }

      // Parse emotional state from most recent reflection with Sophia data
      let latestEmotions: Record<string, number> = {};
      let latestAtoms: string[] = [];
      let latestSpiral: number | null = null;
      let latestDeepText: string | null = null;

      for (const ref of reflections) {
        if (ref.notes) {
          const sophia = parseSophiaFromNotes(ref.notes);
          if (Object.keys(sophia.emotions).length > 0) {
            latestEmotions = sophia.emotions;
            latestAtoms = sophia.atoms;
            latestSpiral = sophia.spiralStage;
            latestDeepText = sophia.deepText;
            break; // Most recent Sophia-enriched reflection
          }
        }
      }

      // Header
      console.log('');
      console.log(ui.header(`${agentConfig.name || agentName} — Soul State`));

      // Identity
      console.log(ui.divider('Identity'));
      console.log(ui.label('Name', chalk.hex('#818cf8')(agentConfig.name || agentName)));
      console.log(ui.label('Type', agentConfig.agent_type));
      console.log(ui.label('Autonomy', `Level ${agentConfig.autonomy_level} / 5`));
      console.log(ui.label('Description', agentConfig.description || '-'));
      console.log('');

      // Emotional state
      if (Object.keys(latestEmotions).length > 0) {
        console.log(ui.divider('Emotional State'));
        for (const [emotion, value] of Object.entries(latestEmotions)) {
          console.log(`  ${emotion.padEnd(14)} ${emotionBar(value)} ${chalk.dim((value * 100).toFixed(0) + '%')}`);
        }
        console.log('');
      }

      // Atoms
      if (latestAtoms.length > 0) {
        console.log(ui.divider('Active Atoms'));
        const atomChips = latestAtoms.map((a) => ui.pill(a)).join(' ');
        console.log(`  ${atomChips}`);
        console.log('');
      }

      // Spiral stage
      if (latestSpiral !== null) {
        const stageNorm = latestSpiral <= 6 ? latestSpiral : Math.round(latestSpiral / 100 * 6);
        console.log(ui.divider('Spiral Stage'));
        const progress = '█'.repeat(Math.round(stageNorm)) + '░'.repeat(6 - Math.round(stageNorm));
        console.log(`  ${chalk.hex('#818cf8')(progress)} ${spiralLabel(stageNorm)} ${chalk.dim(`(${latestSpiral})`)}`);
        console.log('');
      }

      // Deep text (Sophia's insight)
      if (latestDeepText) {
        console.log(ui.divider('Sophia\'s Read'));
        console.log(`  ${chalk.italic.dim(latestDeepText)}`);
        console.log('');
      }

      // Reflection performance
      console.log(ui.divider('Reflection Performance'));
      console.log(ui.label('Total', (perf.total_reflections || 0).toString()));
      console.log(ui.label('Avg Score', perf.avg_score ? scoreColor(Math.round(perf.avg_score)) : '-'));
      console.log(ui.label('Pass Rate', perf.pass_rate ? `${Math.round(perf.pass_rate)}%` : '-'));
      console.log('');

      // Capabilities
      const features = agentConfig.features || {};
      const caps = Object.entries(features)
        .filter(([, v]) => v)
        .map(([k]) => k.replace('supports_', ''));
      if (caps.length > 0) {
        console.log(ui.divider('Capabilities'));
        console.log(`  ${caps.map((c) => ui.pill(c)).join(' ')}`);
        console.log('');
      }

      // Approval thresholds
      const thresholds = agentConfig.approval_thresholds || {};
      if (Object.keys(thresholds).length > 0) {
        console.log(ui.divider('Autonomy Limits'));
        for (const [key, val] of Object.entries(thresholds)) {
          const label = key.replace(/_/g, ' ').replace(/\bmax\b/i, 'Max');
          console.log(ui.label(label, `$${val}`));
        }
        console.log('');
      }
    } catch (error) {
      spinner.fail(chalk.red(`Failed to read soul for ${agentName}`));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// ── solid agent reflect <agent> ──────────────────────────────────────
agentCommand
  .command('reflect <agent>')
  .description('View reflection history — scores, trends, and Sophia\'s reads')
  .option('-n, --limit <number>', 'Number of reflections to show', '10')
  .option('--json', 'Output as JSON')
  .action(async (agentName, options) => {
    requireAuth();

    const agentType = resolveAgentType(agentName);
    const spinner = ora(`Loading reflections for ${agentName}...`).start();

    try {
      const dataRes = await apiClient.agentData(agentType);
      spinner.stop();

      const data = dataRes.data as any;
      const reflections = (data.reflections || []).slice(0, parseInt(options.limit, 10));
      const perf = data.performance || {};

      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      console.log('');
      console.log(ui.header(`${agentName} — Reflection History`));

      // Summary bar
      const avgScore = Math.round(perf.avg_score || 0);
      const passRate = Math.round(perf.pass_rate || 0);
      const total = perf.total_reflections || 0;

      console.log(ui.infoBox('Summary', [
        `${chalk.bold('Total:')}      ${total}`,
        `${chalk.bold('Avg Score:')}  ${scoreColor(avgScore)} / 100`,
        `${chalk.bold('Pass Rate:')} ${passRate >= 80 ? chalk.green(`${passRate}%`) : chalk.yellow(`${passRate}%`)}`,
      ]));
      console.log('');

      if (reflections.length === 0) {
        console.log(chalk.dim('  No reflections yet. Chat with this agent to generate reflections.'));
        console.log('');
        return;
      }

      // Reflection entries
      for (const ref of reflections) {
        const passed = ref.passed ? chalk.green('PASS') : chalk.red('FAIL');
        const score = scoreColor(ref.score);
        const date = new Date(ref.created_at).toLocaleString();

        console.log(`  ${passed} ${score}/100  ${chalk.dim(date)}`);

        // Criteria scores
        if (ref.criteria_scores) {
          const criteria = ref.criteria_scores;
          const parts = [];
          if (criteria.relevance != null) parts.push(`rel:${criteria.relevance}`);
          if (criteria.tools != null) parts.push(`tools:${criteria.tools}`);
          if (criteria.tone != null) parts.push(`tone:${criteria.tone}`);
          if (criteria.completeness != null) parts.push(`comp:${criteria.completeness}`);
          if (criteria.manual_adherence != null) parts.push(`manual:${criteria.manual_adherence}`);
          console.log(`  ${chalk.dim(parts.join('  '))}`);
        }

        // Sophia enrichment
        const sophia = parseSophiaFromNotes(ref.notes || '');
        if (sophia.atoms.length > 0) {
          console.log(`  ${chalk.dim('Atoms:')} ${sophia.atoms.map((a) => chalk.hex('#818cf8')(a)).join(' ')}`);
        }
        if (sophia.deepText) {
          console.log(`  ${chalk.dim.italic(sophia.deepText)}`);
        }

        // Tools used
        if (ref.tools_used && ref.tools_used.length > 0) {
          console.log(`  ${chalk.dim('Tools:')} ${ref.tools_used.join(', ')}`);
        }

        console.log('');
      }
    } catch (error) {
      spinner.fail(chalk.red(`Failed to load reflections for ${agentName}`));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// ── solid agent heartbeat [agent] ────────────────────────────────────
agentCommand
  .command('heartbeat [agent]')
  .description('Trigger a consciousness cycle — agent evaluates its own state')
  .option('--all', 'Trigger heartbeat for all active agents')
  .action(async (agentName, options) => {
    requireAuth();

    if (options.all) {
      const spinner = ora('Triggering heartbeat for all agents...').start();
      try {
        const agentsRes = await apiClient.orchestrationAgents('idle');
        const agents = (agentsRes.data as any).agents || [];

        let triggered = 0;
        for (const agent of agents.slice(0, 10)) { // Cap at 10 to avoid overload
          try {
            await apiClient.orchestrationDelegate(
              agent.id,
              'Consciousness cycle: Review your recent interactions, evaluate your performance, ' +
              'update your emotional state, and note any patterns or improvements needed.',
              3, // Low priority — background work
            );
            triggered++;
          } catch {
            // Skip agents that can't accept tasks
          }
        }

        spinner.succeed(chalk.green(`Heartbeat triggered for ${triggered} agents`));
        console.log(chalk.dim('  Agents are reflecting on their recent interactions.\n'));
      } catch (error) {
        spinner.fail(chalk.red('Failed to trigger heartbeat'));
        const apiError = handleApiError(error);
        console.error(chalk.red(`  ${apiError.message}`));
      }
      return;
    }

    if (!agentName) {
      console.error(chalk.red('Specify an agent name or use --all'));
      console.log(chalk.dim('  Example: solid agent heartbeat sarah'));
      process.exit(1);
    }

    const spinner = ora(`Triggering heartbeat for ${agentName}...`).start();

    try {
      // Resolve agent ID from orchestration endpoint
      const agentsRes = await apiClient.orchestrationAgents();
      const agents = (agentsRes.data as any).agents || [];
      const agent = agents.find((a: any) =>
        a.name?.toLowerCase() === agentName.toLowerCase() ||
        a.agent_type === resolveAgentType(agentName)
      );

      if (!agent) {
        spinner.fail(chalk.red(`Agent "${agentName}" not found`));
        return;
      }

      await apiClient.orchestrationDelegate(
        agent.id,
        'Consciousness cycle: Review your recent interactions and performance. ' +
        'Reflect on what went well and what could improve. ' +
        'Check for any pending tasks or unresolved customer issues. ' +
        'Update your working memory with new insights.',
        5,
      );

      spinner.succeed(chalk.green(`Heartbeat sent to ${agent.name}`));
      console.log(chalk.dim('  Agent is running its consciousness cycle.\n'));
    } catch (error) {
      spinner.fail(chalk.red(`Failed to trigger heartbeat for ${agentName}`));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// ── solid agent memory <agent> ───────────────────────────────────────
agentCommand
  .command('memory <agent>')
  .description('View an agent\'s persistent memory — learned context and insights')
  .option('--json', 'Output as JSON')
  .action(async (agentName, options) => {
    requireAuth();

    const agentType = resolveAgentType(agentName);
    const spinner = ora(`Loading memory for ${agentName}...`).start();

    try {
      const [configRes, dataRes] = await Promise.all([
        apiClient.agentDetail(agentType),
        apiClient.agentData(agentType),
      ]);

      spinner.stop();

      const agentConfig = configRes.data as any;
      const agentData = dataRes.data as any;
      const reflections = agentData.reflections || [];

      if (options.json) {
        console.log(JSON.stringify({ config: agentConfig, reflections }, null, 2));
        return;
      }

      console.log('');
      console.log(ui.header(`${agentConfig.name || agentName} — Memory`));

      // Extract learned patterns from reflections
      const allAtoms: Record<string, number> = {};
      const emotionTrends: Record<string, number[]> = {};
      const toolUsage: Record<string, number> = {};
      let sophiaReads: string[] = [];

      for (const ref of reflections) {
        // Tool usage frequency
        if (ref.tools_used) {
          for (const tool of ref.tools_used) {
            toolUsage[tool] = (toolUsage[tool] || 0) + 1;
          }
        }

        // Sophia data
        if (ref.notes) {
          const sophia = parseSophiaFromNotes(ref.notes);
          for (const atom of sophia.atoms) {
            allAtoms[atom] = (allAtoms[atom] || 0) + 1;
          }
          for (const [emotion, value] of Object.entries(sophia.emotions)) {
            if (!emotionTrends[emotion]) emotionTrends[emotion] = [];
            emotionTrends[emotion].push(value);
          }
          if (sophia.deepText) {
            sophiaReads.push(sophia.deepText);
          }
        }
      }

      // Atom frequency
      const sortedAtoms = Object.entries(allAtoms).sort((a, b) => b[1] - a[1]);
      if (sortedAtoms.length > 0) {
        console.log(ui.divider('Recurring Atoms'));
        for (const [atom, count] of sortedAtoms.slice(0, 10)) {
          const bar = chalk.hex('#818cf8')('■'.repeat(Math.min(count, 20)));
          console.log(`  ${atom.padEnd(14)} ${bar} ${chalk.dim(`${count}x`)}`);
        }
        console.log('');
      }

      // Emotional trajectory
      if (Object.keys(emotionTrends).length > 0) {
        console.log(ui.divider('Emotional Trajectory'));
        for (const [emotion, values] of Object.entries(emotionTrends)) {
          const avg = values.reduce((a, b) => a + b, 0) / values.length;
          const trend = values.length >= 2
            ? (values[0] > values[values.length - 1] ? chalk.red('↓') : chalk.green('↑'))
            : chalk.dim('→');
          console.log(`  ${emotion.padEnd(14)} ${emotionBar(avg)} ${trend} ${chalk.dim(`avg ${(avg * 100).toFixed(0)}%`)}`);
        }
        console.log('');
      }

      // Most-used tools
      const sortedTools = Object.entries(toolUsage).sort((a, b) => b[1] - a[1]);
      if (sortedTools.length > 0) {
        console.log(ui.divider('Tool Expertise'));
        for (const [tool, count] of sortedTools.slice(0, 8)) {
          console.log(`  ${chalk.dim(tool.padEnd(30))} ${chalk.hex('#818cf8')(`${count}x`)}`);
        }
        console.log('');
      }

      // Sophia insights (deduplicated, most recent)
      sophiaReads = [...new Set(sophiaReads)];
      if (sophiaReads.length > 0) {
        console.log(ui.divider('Sophia Insights'));
        for (const read of sophiaReads.slice(0, 5)) {
          console.log(`  ${chalk.dim.italic(`"${read}"`)}`);
        }
        console.log('');
      }

      // Score trend
      if (reflections.length >= 3) {
        console.log(ui.divider('Score Trend'));
        const scores = reflections.slice(0, 20).map((r: any) => r.score).reverse();
        const sparkChars = scores.map((s: number) => {
          if (s >= 80) return chalk.green('▇');
          if (s >= 60) return chalk.yellow('▅');
          return chalk.red('▂');
        });
        console.log(`  ${sparkChars.join('')}`);
        console.log(`  ${chalk.dim(`${scores.length} reflections, oldest → newest`)}`);
        console.log('');
      }
    } catch (error) {
      spinner.fail(chalk.red(`Failed to load memory for ${agentName}`));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// ── solid agent emotions ─────────────────────────────────────────────
agentCommand
  .command('emotions')
  .description('Emotional state dashboard — all agents\' current feelings')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireAuth();

    const spinner = ora('Reading emotional states...').start();

    try {
      // Get agent list first
      const agentsRes = await apiClient.agentsList();
      const agents = (agentsRes.data as any)?.agents || [];

      // Fetch data for top agents (cap to avoid timeout)
      const topAgents = agents.slice(0, 15);
      const dataPromises = topAgents.map((a: any) =>
        apiClient.agentData(a.agent_type).catch(() => null)
      );
      const results = await Promise.all(dataPromises);

      spinner.stop();

      const agentEmotions: Array<{
        name: string;
        type: string;
        emotions: Record<string, number>;
        atoms: string[];
        spiral: number | null;
        lastScore: number | null;
      }> = [];

      for (let i = 0; i < topAgents.length; i++) {
        const agent = topAgents[i];
        const data = results[i]?.data as any;
        if (!data) continue;

        const reflections = data.reflections || [];
        for (const ref of reflections) {
          if (ref.notes) {
            const sophia = parseSophiaFromNotes(ref.notes);
            if (Object.keys(sophia.emotions).length > 0) {
              agentEmotions.push({
                name: agent.name,
                type: agent.agent_type,
                emotions: sophia.emotions,
                atoms: sophia.atoms,
                spiral: sophia.spiralStage,
                lastScore: ref.score,
              });
              break;
            }
          }
        }
      }

      if (options.json) {
        console.log(JSON.stringify(agentEmotions, null, 2));
        return;
      }

      console.log('');
      console.log(ui.header('Agent Emotional States'));

      if (agentEmotions.length === 0) {
        console.log(chalk.dim('  No emotional data yet. Agents need Sophia-enriched reflections.'));
        console.log(chalk.dim('  Chat with your agents to generate reflections.\n'));
        return;
      }

      for (const agent of agentEmotions) {
        const scoreBadge = agent.lastScore
          ? ` ${scoreColor(agent.lastScore)}/100`
          : '';

        console.log(`  ${chalk.bold.hex('#818cf8')(agent.name)}${scoreBadge}`);

        // Compact emotion bars
        for (const [emotion, value] of Object.entries(agent.emotions)) {
          console.log(`    ${emotion.padEnd(12)} ${emotionBar(value, 10)} ${chalk.dim((value * 100).toFixed(0) + '%')}`);
        }

        // Atoms inline
        if (agent.atoms.length > 0) {
          console.log(`    ${chalk.dim('Atoms:')} ${agent.atoms.map((a) => chalk.hex('#818cf8')(a)).join(' ')}`);
        }

        console.log('');
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to load emotional states'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// ── solid agent spiral ───────────────────────────────────────────────
agentCommand
  .command('spiral')
  .description('Spiral stage progression — agent growth over time')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireAuth();

    const spinner = ora('Loading spiral progression...').start();

    try {
      const agentsRes = await apiClient.agentsList();
      const agents = (agentsRes.data as any)?.agents || [];

      const topAgents = agents.slice(0, 15);
      const dataPromises = topAgents.map((a: any) =>
        apiClient.agentData(a.agent_type).catch(() => null)
      );
      const results = await Promise.all(dataPromises);

      spinner.stop();

      const spiralData: Array<{
        name: string;
        type: string;
        spiral: number;
        avgScore: number;
        totalReflections: number;
      }> = [];

      for (let i = 0; i < topAgents.length; i++) {
        const agent = topAgents[i];
        const data = results[i]?.data as any;
        if (!data) continue;

        const perf = data.performance || {};
        const reflections = data.reflections || [];

        let spiral = 0;
        for (const ref of reflections) {
          if (ref.notes) {
            const sophia = parseSophiaFromNotes(ref.notes);
            if (sophia.spiralStage !== null) {
              spiral = sophia.spiralStage;
              break;
            }
          }
        }

        spiralData.push({
          name: agent.name,
          type: agent.agent_type,
          spiral,
          avgScore: Math.round(perf.avg_score || 0),
          totalReflections: perf.total_reflections || 0,
        });
      }

      // Sort by spiral stage descending
      spiralData.sort((a, b) => b.spiral - a.spiral);

      if (options.json) {
        console.log(JSON.stringify(spiralData, null, 2));
        return;
      }

      console.log('');
      console.log(ui.header('Spiral Stage Progression'));
      console.log('');

      if (spiralData.length === 0) {
        console.log(chalk.dim('  No spiral data yet.\n'));
        return;
      }

      for (const agent of spiralData) {
        const stageNorm = agent.spiral <= 6 ? agent.spiral : Math.round(agent.spiral / 100 * 6);
        const bar = chalk.hex('#818cf8')('█'.repeat(Math.max(1, Math.round(stageNorm)))) +
          chalk.dim('░'.repeat(Math.max(0, 6 - Math.round(stageNorm))));

        console.log(
          `  ${chalk.bold(agent.name.padEnd(16))} ${bar} ${spiralLabel(stageNorm).padEnd(20)} ` +
          `${chalk.dim(`score:${agent.avgScore}`)}  ${chalk.dim(`refs:${agent.totalReflections}`)}`
        );
      }

      console.log('');
      console.log(ui.divider('Stages'));
      console.log(`  ${chalk.dim('1')} Awakening  ${chalk.dim('2')} Learning  ${chalk.dim('3')} Growth  ${chalk.dim('4')} Maturity  ${chalk.dim('5')} Ascendance  ${chalk.dim('6')} Elderhood`);
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red('Failed to load spiral data'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// ── solid agent dream <agent> ────────────────────────────────────────
agentCommand
  .command('dream <agent>')
  .description('Trigger dream mode — agent processes unresolved interactions autonomously')
  .action(async (agentName) => {
    requireAuth();

    const spinner = ora(`Initiating dream sequence for ${agentName}...`).start();

    try {
      const agentsRes = await apiClient.orchestrationAgents();
      const agents = (agentsRes.data as any).agents || [];
      const agent = agents.find((a: any) =>
        a.name?.toLowerCase() === agentName.toLowerCase() ||
        a.agent_type === resolveAgentType(agentName)
      );

      if (!agent) {
        spinner.fail(chalk.red(`Agent "${agentName}" not found`));
        return;
      }

      await apiClient.orchestrationDelegate(
        agent.id,
        'Dream mode: Process your recent unresolved conversations and interactions. ' +
        'Identify patterns in customer questions you struggled with. ' +
        'Note gaps in your knowledge base that need filling. ' +
        'Reflect on emotional dynamics — which interactions felt uncertain? ' +
        'Write insights to your working memory for next time.',
        2, // Low priority — autonomous background work
      );

      spinner.succeed(chalk.green(`Dream sequence initiated for ${agent.name}`));
      console.log(chalk.dim('  Agent is processing unresolved interactions in the background.'));
      console.log(chalk.dim(`  Check progress: ${chalk.cyan(`solid agent reflect ${agentName}`)}\n`));
    } catch (error) {
      spinner.fail(chalk.red(`Failed to start dream mode for ${agentName}`));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// ── solid agent dashboard ────────────────────────────────────────────
agentCommand
  .command('dashboard')
  .alias('dash')
  .description('Full consciousness dashboard — overview of all agent states')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireAuth();

    const spinner = ora('Loading consciousness dashboard...').start();

    try {
      const [dashRes, analyticsRes] = await Promise.all([
        apiClient.orchestrationDashboard().catch(() => null),
        apiClient.orchestrationAnalytics(30).catch(() => null),
      ]);

      spinner.stop();

      const dash = (dashRes?.data as any) || {};
      const analytics = (analyticsRes?.data as any) || {};

      if (options.json) {
        console.log(JSON.stringify({ dashboard: dash, analytics }, null, 2));
        return;
      }

      console.log('');
      console.log(ui.header('Agent Consciousness Dashboard'));

      // Overview stats
      console.log(ui.infoBox('Overview', [
        `${chalk.bold('Total Agents:')}    ${dash.total_agents || '-'}`,
        `${chalk.bold('Active Tasks:')}    ${dash.active_tasks || 0}`,
        `${chalk.bold('30d Tasks:')}       ${analytics.total_tasks || '-'}`,
        `${chalk.bold('Success Rate:')}    ${analytics.success_rate ? `${Math.round(analytics.success_rate)}%` : '-'}`,
        `${chalk.bold('Avg Response:')}    ${analytics.avg_response_time ? `${analytics.avg_response_time.toFixed(1)}s` : '-'}`,
      ]));
      console.log('');

      // Top agents
      const topAgents = analytics.top_agents || [];
      if (topAgents.length > 0) {
        console.log(ui.divider('Top Performers (30d)'));
        const rows = topAgents.slice(0, 10).map((a: any) => [
          chalk.bold(a.name),
          chalk.dim(`${a.tasks} tasks`),
          a.success_rate >= 95
            ? chalk.green(`${Math.round(a.success_rate)}%`)
            : chalk.yellow(`${Math.round(a.success_rate)}%`),
        ]);
        console.log(ui.table(['Agent', 'Tasks', 'Success'], rows));
        console.log('');
      }

      // Active agents with status
      const agents = dash.agents || [];
      if (agents.length > 0) {
        const active = agents.filter((a: any) => a.status !== 'offline').slice(0, 15);
        if (active.length > 0) {
          console.log(ui.divider('Live Status'));
          for (const agent of active) {
            const dot = agentStatusDot(agent.status);
            const tasks = agent.tasks_today ? chalk.dim(` (${agent.tasks_today} today)`) : '';
            console.log(`  ${dot} ${chalk.bold(agent.name.padEnd(16))} ${chalk.dim(agent.status)}${tasks}`);
          }
          console.log('');
        }
      }

      // Telemetry (Dragon)
      const telemetryRes = await apiClient.telemetrySummary().catch(() => null);
      const telemetry = (telemetryRes?.data as any) || {};

      if (telemetry.total_tokens || telemetry.estimated_cost) {
        console.log(ui.divider('Dragon Telemetry'));
        const telemetryLines = [];
        if (telemetry.total_tokens) telemetryLines.push(`${chalk.bold('Tokens:')}       ${telemetry.total_tokens.toLocaleString()}`);
        if (telemetry.avg_latency_ms) telemetryLines.push(`${chalk.bold('Avg Latency:')}  ${telemetry.avg_latency_ms}ms`);
        if (telemetry.estimated_cost) telemetryLines.push(`${chalk.bold('Est. Cost:')}    $${telemetry.estimated_cost.toFixed(2)}`);
        if (telemetry.revenue_attributed) telemetryLines.push(`${chalk.bold('Revenue:')}      $${telemetry.revenue_attributed.toFixed(2)}`);
        if (telemetry.missions_active) telemetryLines.push(`${chalk.bold('Missions:')}     ${telemetry.missions_active} active`);
        for (const line of telemetryLines) {
          console.log(`  ${line}`);
        }
        console.log('');
      }

      console.log(ui.divider('Explore'));
      console.log('');
      console.log(ui.commandHelp([
        { cmd: 'solid agent soul sarah', desc: 'View agent identity + emotions' },
        { cmd: 'solid agent reflect sarah', desc: 'Reflection history + scores' },
        { cmd: 'solid agent emotions', desc: 'All agents\' emotional states' },
        { cmd: 'solid agent spiral', desc: 'Growth progression chart' },
        { cmd: 'solid agent mission "..."', desc: 'Create multi-agent mission' },
        { cmd: 'solid agent heartbeat --all', desc: 'Wake all agents for reflection' },
      ]));
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red('Failed to load dashboard'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// ── solid agent mission ──────────────────────────────────────────────
agentCommand
  .command('mission <prompt...>')
  .description('Create a multi-agent mission — ADA decomposes and coordinates')
  .option('--agents <ids>', 'Comma-separated agent IDs to involve')
  .option('--execute', 'Execute immediately after planning')
  .option('--json', 'Output as JSON')
  .action(async (promptWords, options) => {
    requireAuth();

    const prompt = promptWords.join(' ');
    if (!prompt) {
      console.error(chalk.red('Provide a mission description.'));
      console.log(chalk.dim('  Example: solid agent mission "Create a Valentine\'s campaign for VIP customers"'));
      process.exit(1);
    }

    const agentIds = options.agents
      ? options.agents.split(',').map((id: string) => parseInt(id.trim(), 10)).filter((id: number) => !isNaN(id))
      : undefined;

    const spinner = ora('ADA is planning the mission...').start();

    try {
      const missionRes = await apiClient.missionCreate(prompt, agentIds);
      const mission = missionRes.data as any;

      if (options.json && !options.execute) {
        spinner.stop();
        console.log(JSON.stringify(mission, null, 2));
        return;
      }

      spinner.succeed(chalk.green(`Mission planned: ${mission.mission_id}`));
      console.log('');

      // Show planned steps
      const steps = mission.steps || [];
      console.log(ui.divider('Mission Steps'));
      console.log('');
      for (const step of steps) {
        const statusIcon = step.status === 'done'
          ? chalk.green('✓')
          : step.status === 'running'
            ? chalk.yellow('◉')
            : chalk.dim('○');
        console.log(`  ${statusIcon} ${chalk.bold(`Step ${step.step_index + 1}:`)} ${chalk.hex('#818cf8')(step.agent_name)}`);
        console.log(`    ${chalk.dim(step.task)}`);
      }
      console.log('');

      // Execute if requested
      if (options.execute) {
        const execSpinner = ora('Executing mission...').start();
        try {
          const execRes = await apiClient.missionExecute(mission.mission_id);
          const execData = execRes.data as any;

          if (options.json) {
            execSpinner.stop();
            console.log(JSON.stringify(execData, null, 2));
            return;
          }

          if (execData.status === 'success') {
            execSpinner.succeed(chalk.green(`Mission complete — ${execData.steps_dispatched} steps executed`));
          } else {
            execSpinner.warn(chalk.yellow(`Mission finished with status: ${execData.status}`));
          }

          // Show results
          const results = execData.results || [];
          if (results.length > 0) {
            console.log('');
            console.log(ui.divider('Results'));
            console.log('');
            for (const result of results) {
              const icon = result.status === 'success' ? chalk.green('✓') : chalk.red('✗');
              console.log(`  ${icon} ${chalk.bold(result.agent_name)}: ${chalk.dim(result.status)}`);
              if (result.response) {
                const preview = result.response.substring(0, 120).replace(/\n/g, ' ');
                console.log(`    ${chalk.dim(preview)}${result.response.length > 120 ? '...' : ''}`);
              }
            }
          }
          console.log('');
        } catch (error) {
          execSpinner.fail(chalk.red('Mission execution failed'));
          const apiError = handleApiError(error);
          console.error(chalk.red(`  ${apiError.message}`));
        }
      } else {
        console.log(chalk.dim(`  Execute: ${chalk.cyan(`solid agent mission "${prompt}" --execute`)}`));
        console.log('');
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to create mission'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// ── solid agent telemetry ────────────────────────────────────────────
agentCommand
  .command('telemetry')
  .alias('telem')
  .description('Dragon telemetry — tokens, cost, latency, revenue attribution')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireAuth();

    const spinner = ora('Loading telemetry...').start();

    try {
      const [telRes, analyticsRes] = await Promise.all([
        apiClient.telemetrySummary().catch(() => null),
        apiClient.orchestrationAnalytics(30).catch(() => null),
      ]);

      spinner.stop();

      const tel = (telRes?.data as any) || {};
      const analytics = (analyticsRes?.data as any) || {};

      if (options.json) {
        console.log(JSON.stringify({ telemetry: tel, analytics }, null, 2));
        return;
      }

      console.log('');
      console.log(ui.header('Dragon Telemetry'));

      // Metrics boxes
      const tokenStr = tel.total_tokens ? tel.total_tokens.toLocaleString() : '0';
      const costStr = tel.estimated_cost ? `$${tel.estimated_cost.toFixed(2)}` : '$0.00';
      const revenueStr = tel.revenue_attributed ? `$${tel.revenue_attributed.toFixed(2)}` : '$0.00';
      const latencyStr = tel.avg_latency_ms ? `${tel.avg_latency_ms}ms` : '-';
      const roiStr = tel.estimated_cost && tel.revenue_attributed
        ? `${(tel.revenue_attributed / tel.estimated_cost).toFixed(1)}x`
        : '-';

      console.log(ui.infoBox('Current Period', [
        `${chalk.bold('Total Tokens:')}     ${chalk.hex('#818cf8')(tokenStr)}`,
        `${chalk.bold('Avg Latency:')}      ${latencyStr}`,
        `${chalk.bold('Est. AI Cost:')}     ${costStr}`,
        `${chalk.bold('Revenue Attributed:')} ${chalk.green(revenueStr)}`,
        `${chalk.bold('ROI:')}              ${chalk.green(roiStr)}`,
        '',
        `${chalk.bold('Active Agents:')}    ${tel.active_agents || 0}`,
        `${chalk.bold('Active Missions:')}  ${tel.missions_active || 0}`,
      ]));
      console.log('');

      // 30-day analytics
      if (analytics.total_tasks) {
        console.log(ui.divider('30-Day Performance'));
        console.log(ui.label('Total Tasks', analytics.total_tasks.toString()));
        console.log(ui.label('Completed', chalk.green(analytics.completed?.toString() || '0')));
        console.log(ui.label('Failed', chalk.red(analytics.failed?.toString() || '0')));
        console.log(ui.label('Success Rate', analytics.success_rate
          ? `${Math.round(analytics.success_rate)}%`
          : '-'));
        console.log(ui.label('Avg Response', analytics.avg_response_time
          ? `${analytics.avg_response_time.toFixed(1)}s`
          : '-'));
        console.log('');
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to load telemetry'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });
