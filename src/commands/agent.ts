/**
 * Agent management commands for Solid CLI
 *
 * Practical agent operations: list, soul, tools, reflect, memory,
 * chat, dashboard, telemetry, missions, prompt, settings.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';

// ── Helpers ──────────────────────────────────────────────────────────

const AGENT_NAME_MAP: Record<string, string> = {
  sarah: 'customer_service', marcus: 'growth_intelligence', devon: 'operations_monitor',
  ada: 'orchestrator', jake: 'inventory_manager', morgan: 'appointment_scheduler',
  alex: 'sales_rep', jordan: 'review_manager', maya: 'email_marketer',
  riley: 'loyalty_program', ace: 'design_engine', annie: 'phone_agent',
  nora: 'social_media', emma: 'content_writer', victor: 'voice_setup',
  gwen: 'google_workspace', jackson: 'estimates', lucie: 'lead_intake',
  daphne: 'dispatch', dexter: 'data_entry',
};

function resolveAgentType(nameOrType: string): string {
  return AGENT_NAME_MAP[nameOrType.toLowerCase()] || nameOrType.toLowerCase();
}

function requireLogin(): void {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
}

function scoreBar(value: number, width = 15): string {
  const v = Math.max(0, Math.min(1, value));
  const filled = Math.round(v * width);
  const color = v >= 0.7 ? '#22c55e' : v >= 0.4 ? '#eab308' : '#ef4444';
  return chalk.hex(color)('█'.repeat(filled)) + chalk.dim('░'.repeat(width - filled));
}

function fmt(n: number): string { return n.toLocaleString(); }
function trunc(s: string, max: number): string { return !s ? '' : s.length > max ? s.slice(0, max - 1) + '…' : s; }

function catchError(spinner: ReturnType<typeof ora>, label: string) {
  return (error: unknown) => {
    spinner.fail(chalk.red(label));
    console.log(ui.errorBox('Error', [handleApiError(error).message]));
    console.log('');
  };
}

// ── Command Tree ─────────────────────────────────────────────────────

export const agentCommand = new Command('agent')
  .description('Manage and interact with AI agents');

// ── list ──────────────────────────────────────────────────────────────

agentCommand
  .command('list')
  .description('List all agents with status')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireLogin();
    const spinner = ora('Loading agents...').start();
    try {
      const { data } = await apiClient.agentsList();
      spinner.stop();
      if (opts.json) { console.log(JSON.stringify(data, null, 2)); return; }
      const agents = (data as any).agents || [];
      console.log(ui.header(`Agents (${agents.length})`));
      if (!agents.length) { console.log(chalk.dim('  No agents found.\n')); return; }
      console.log(ui.table(
        ['Name', 'Type', 'Autonomy', 'Tools', 'Description'],
        agents.map((a: any) => [
          chalk.hex('#818cf8')(a.name || a.agent_type), chalk.dim(a.agent_type),
          a.autonomy_level != null ? `L${a.autonomy_level}` : '-',
          String(a.tool_count ?? '-'), trunc(a.description || '', 40),
        ]),
      ));
      console.log('');
    } catch (e) { catchError(spinner, 'Failed to list agents')(e); }
  });

// ── soul ──────────────────────────────────────────────────────────────

agentCommand
  .command('soul <name>')
  .description('View agent identity, config, and performance')
  .option('--json', 'Output as JSON')
  .action(async (name, opts) => {
    requireLogin();
    const agentType = resolveAgentType(name);
    const spinner = ora(`Loading ${name}...`).start();
    try {
      const [detailRes, dataRes] = await Promise.allSettled([
        apiClient.agentDetail(agentType), apiClient.agentData(agentType),
      ]);
      spinner.stop();
      const detail = detailRes.status === 'fulfilled' ? (detailRes.value.data as any) : null;
      const data = dataRes.status === 'fulfilled' ? (dataRes.value.data as any) : null;
      if (!detail) { console.log(ui.errorBox('Not Found', [`Agent "${name}" (${agentType}) not found.`])); return; }
      if (opts.json) { console.log(JSON.stringify({ detail, data }, null, 2)); return; }

      console.log(ui.header(detail.name || agentType));
      console.log(ui.label('Type', detail.agent_type));
      console.log(ui.label('Autonomy', `Level ${detail.autonomy_level ?? '-'}`));
      console.log(ui.label('Tools', String(detail.tools?.length ?? 0)));
      if (detail.description) console.log(ui.label('Description', detail.description));

      const features = detail.features;
      if (features && Object.keys(features).length > 0) {
        console.log(ui.header('Features'));
        for (const [key, val] of Object.entries(features)) {
          console.log(`  ${val ? chalk.green('●') : chalk.dim('○')} ${key.replace(/_/g, ' ')}`);
        }
      }

      const perf = data?.performance;
      if (perf) {
        console.log(ui.header('Performance'));
        console.log(ui.label('Reflections', fmt(perf.total_reflections || 0)));
        if (perf.avg_score != null) console.log(ui.label('Avg Score', `${(perf.avg_score * 100).toFixed(1)}%  ${scoreBar(perf.avg_score)}`));
        if (perf.pass_rate != null) console.log(ui.label('Pass Rate', `${(perf.pass_rate * 100).toFixed(1)}%  ${scoreBar(perf.pass_rate)}`));
      }

      console.log('\n' + ui.divider('Commands') + '\n');
      console.log(ui.commandHelp([
        { cmd: `solid agent tools ${name}`, desc: 'View tools by namespace' },
        { cmd: `solid agent reflect ${name}`, desc: 'Reflection history' },
        { cmd: `solid agent memory ${name}`, desc: 'Learned patterns' },
        { cmd: `solid agent chat ${name} "message"`, desc: 'Chat with agent' },
      ]));
      console.log('');
    } catch (e) { catchError(spinner, 'Failed to load agent')(e); }
  });

// ── tools ─────────────────────────────────────────────────────────────

agentCommand
  .command('tools <name>')
  .description('Show tools grouped by namespace')
  .option('--json', 'Output as JSON')
  .action(async (name, opts) => {
    requireLogin();
    const agentType = resolveAgentType(name);
    const spinner = ora(`Loading tools for ${name}...`).start();
    try {
      const { data } = await apiClient.agentTools(agentType);
      spinner.stop();
      if (opts.json) { console.log(JSON.stringify(data, null, 2)); return; }
      const toolMap = (data as any).tools || {};
      console.log(ui.header(`Tools for ${name} (${(data as any).total || 0} total)`));
      const namespaces = Object.keys(toolMap).sort();
      if (!namespaces.length) { console.log(chalk.dim('  No tools found.\n')); return; }
      for (const ns of namespaces) {
        const tools: string[] = toolMap[ns] || [];
        console.log(`  ${chalk.hex('#818cf8')(ns)} ${chalk.dim(`(${tools.length})`)}`);
        for (const t of tools) console.log(`    ${chalk.dim('•')} ${t}`);
        console.log('');
      }
    } catch (e) { catchError(spinner, 'Failed to load tools')(e); }
  });

// ── reflect ───────────────────────────────────────────────────────────

agentCommand
  .command('reflect <name>')
  .description('View reflection history and scores')
  .option('--limit <n>', 'Number of reflections', '10')
  .option('--json', 'Output as JSON')
  .action(async (name, opts) => {
    requireLogin();
    const agentType = resolveAgentType(name);
    const spinner = ora(`Loading reflections for ${name}...`).start();
    try {
      const { data } = await apiClient.agentData(agentType);
      spinner.stop();
      if (opts.json) { console.log(JSON.stringify(data, null, 2)); return; }
      const d = data as any;
      const perf = d.performance;
      if (perf) {
        console.log(ui.header('Performance Summary'));
        console.log(ui.label('Total', fmt(perf.total_reflections || 0)));
        console.log(ui.label('Avg Score', perf.avg_score != null ? `${(perf.avg_score * 100).toFixed(1)}%` : '-'));
        console.log(ui.label('Pass Rate', perf.pass_rate != null ? `${(perf.pass_rate * 100).toFixed(1)}%` : '-'));
      }
      const reflections = (d.reflections || []).slice(0, parseInt(opts.limit, 10));
      if (!reflections.length) { console.log(chalk.dim('\n  No reflections recorded yet.\n')); return; }
      console.log(ui.header('Reflection History'));
      console.log(ui.table(
        ['Date', 'Score', 'Status', 'Notes', 'Tools Used'],
        reflections.map((r: any) => [
          r.created_at ? new Date(r.created_at).toLocaleDateString() : '-',
          r.score != null ? `${(r.score * 100).toFixed(0)}%` : '-',
          r.passed ? chalk.green('pass') : chalk.red('fail'),
          trunc(r.notes || '', 35),
          (r.tools_used || []).slice(0, 3).join(', '),
        ]),
      ));
      console.log('');
    } catch (e) { catchError(spinner, 'Failed to load reflections')(e); }
  });

// ── memory ────────────────────────────────────────────────────────────

agentCommand
  .command('memory <name>')
  .description('View learned patterns from reflections')
  .option('--json', 'Output as JSON')
  .action(async (name, opts) => {
    requireLogin();
    const agentType = resolveAgentType(name);
    const spinner = ora(`Loading memory for ${name}...`).start();
    try {
      const { data } = await apiClient.agentData(agentType);
      spinner.stop();
      if (opts.json) { console.log(JSON.stringify(data, null, 2)); return; }
      const reflections = (data as any).reflections || [];
      if (!reflections.length) { console.log(chalk.dim('\n  No reflections to extract patterns from.\n')); return; }

      console.log(ui.header(`Memory — ${name}`));

      // Criteria averages
      const criteriaAgg: Record<string, number[]> = {};
      const toolFreq: Record<string, number> = {};
      for (const r of reflections) {
        if (r.criteria_scores) for (const [k, v] of Object.entries(r.criteria_scores)) {
          (criteriaAgg[k] ||= []).push(v as number);
        }
        if (r.tools_used) for (const t of r.tools_used) toolFreq[t] = (toolFreq[t] || 0) + 1;
      }
      if (Object.keys(criteriaAgg).length) {
        console.log(ui.divider('Criteria Averages') + '\n');
        for (const key of Object.keys(criteriaAgg).sort()) {
          const scores = criteriaAgg[key];
          const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
          console.log(`  ${key.replace(/_/g, ' ').padEnd(22)} ${scoreBar(avg)}  ${(avg * 100).toFixed(0)}%`);
        }
        console.log('');
      }
      // Top tools
      const sorted = Object.entries(toolFreq).sort((a, b) => b[1] - a[1]).slice(0, 10);
      if (sorted.length) {
        console.log(ui.divider('Most Used Tools') + '\n');
        for (const [tool, count] of sorted)
          console.log(`  ${chalk.dim('•')} ${tool.padEnd(30)} ${chalk.hex('#818cf8')(String(count))} uses`);
        console.log('');
      }
      // Recent notes
      const notes = reflections.filter((r: any) => r.notes).slice(0, 5).map((r: any) => trunc(r.notes, 70));
      if (notes.length) {
        console.log(ui.divider('Recent Notes') + '\n');
        for (const n of notes) console.log(`  ${chalk.dim('>')} ${n}`);
        console.log('');
      }
    } catch (e) { catchError(spinner, 'Failed to load memory')(e); }
  });

// ── chat ──────────────────────────────────────────────────────────────

agentCommand
  .command('chat <name> <message>')
  .description('Chat with an agent')
  .option('--json', 'Output as JSON')
  .action(async (name, message, opts) => {
    requireLogin();
    const agentType = resolveAgentType(name);
    const spinner = ora(`Talking to ${name}...`).start();
    try {
      const { data } = await apiClient.post<{ response: string }>(
        `/api/v1/cli/agents/${agentType}/chat`, { message },
      );
      spinner.stop();
      if (opts.json) { console.log(JSON.stringify(data, null, 2)); return; }
      const reply = (data as any).response || (data as any).message || JSON.stringify(data);
      console.log('\n' + ui.infoBox(name, [reply]) + '\n');
    } catch (e) { catchError(spinner, 'Chat failed')(e); }
  });

// ── dashboard ─────────────────────────────────────────────────────────

agentCommand
  .command('dashboard')
  .description('Overview of all agents and active tasks')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireLogin();
    const spinner = ora('Loading dashboard...').start();
    try {
      const [dashRes, telRes] = await Promise.allSettled([
        apiClient.orchestrationDashboard(), apiClient.telemetrySummary(),
      ]);
      spinner.stop();
      const dash = dashRes.status === 'fulfilled' ? (dashRes.value.data as any) : null;
      const tel = telRes.status === 'fulfilled' ? (telRes.value.data as any) : null;
      if (opts.json) { console.log(JSON.stringify({ dashboard: dash, telemetry: tel }, null, 2)); return; }

      console.log(ui.header('Agent Dashboard'));
      console.log(ui.label('Total Agents', String(dash?.total_agents || 0)));
      console.log(ui.label('Active Tasks', String(dash?.active_tasks || 0)));
      if (tel) {
        console.log(ui.label('Active Now', String(tel.active_agents || 0)));
        console.log(ui.label('Missions', String(tel.missions_active || 0)));
      }

      const agents = dash?.agents || [];
      if (agents.length) {
        console.log(ui.header('Agents'));
        console.log(ui.table(
          ['Agent', 'Status', 'Tasks Today', 'Last Active'],
          agents.map((a: any) => {
            const dot = a.status === 'active' ? chalk.green('●') : a.status === 'idle' ? chalk.yellow('●') : chalk.dim('○');
            return [
              `${dot} ${a.name || a.agent_type}`, a.status || '-',
              String(a.tasks_today || 0),
              a.last_active ? new Date(a.last_active).toLocaleString() : chalk.dim('never'),
            ];
          }),
        ));
      }

      if (tel) {
        console.log(ui.header('Telemetry'));
        console.log(ui.label('Tokens', fmt(tel.total_tokens || 0)));
        console.log(ui.label('Avg Latency', `${(tel.avg_latency_ms || 0).toFixed(0)}ms`));
        console.log(ui.label('Est. Cost', `$${(tel.estimated_cost || 0).toFixed(2)}`));
        console.log(ui.label('Revenue', `$${(tel.revenue_attributed || 0).toFixed(2)}`));
        if (tel.estimated_cost > 0 && tel.revenue_attributed > 0)
          console.log(ui.label('ROI', `${((tel.revenue_attributed / tel.estimated_cost) * 100).toFixed(0)}%`));
      }
      console.log('');
    } catch (e) { catchError(spinner, 'Failed to load dashboard')(e); }
  });

// ── telemetry ─────────────────────────────────────────────────────────

agentCommand
  .command('telemetry')
  .description('View token usage, cost, latency, and ROI')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireLogin();
    const spinner = ora('Loading telemetry...').start();
    try {
      const { data } = await apiClient.telemetrySummary();
      spinner.stop();
      const t = data as any;
      if (opts.json) { console.log(JSON.stringify(t, null, 2)); return; }
      const roi = t.estimated_cost > 0 && t.revenue_attributed > 0
        ? `${((t.revenue_attributed / t.estimated_cost) * 100).toFixed(0)}%` : '-';
      console.log('\n' + ui.infoBox('Agent Telemetry', [
        `${chalk.bold('Tokens:')}      ${fmt(t.total_tokens || 0)}`,
        `${chalk.bold('Avg Latency:')} ${(t.avg_latency_ms || 0).toFixed(0)}ms`,
        `${chalk.bold('Est. Cost:')}   $${(t.estimated_cost || 0).toFixed(2)}`,
        `${chalk.bold('Revenue:')}     $${(t.revenue_attributed || 0).toFixed(2)}`,
        `${chalk.bold('ROI:')}         ${roi}`,
        '', `${chalk.bold('Active Agents:')}   ${t.active_agents || 0}`,
        `${chalk.bold('Active Missions:')} ${t.missions_active || 0}`,
      ]) + '\n');
    } catch (e) { catchError(spinner, 'Failed to load telemetry')(e); }
  });

// ── mission ───────────────────────────────────────────────────────────

agentCommand
  .command('mission <description>')
  .description('Create a multi-agent mission')
  .option('--execute', 'Execute the mission immediately')
  .option('--json', 'Output as JSON')
  .action(async (description, opts) => {
    requireLogin();
    const spinner = ora('Creating mission...').start();
    try {
      const { data: mission } = await apiClient.missionCreate(description) as any;

      if (opts.execute && mission.mission_id) {
        spinner.text = 'Executing mission...';
        const { data: result } = await apiClient.missionExecute(mission.mission_id) as any;
        spinner.stop();
        if (opts.json) { console.log(JSON.stringify({ mission, execution: result }, null, 2)); return; }
        console.log(ui.successBox('Mission Executed', [
          `${chalk.bold('ID:')}     ${mission.mission_id}`,
          `${chalk.bold('Steps:')}  ${result.steps_dispatched || 0} dispatched`,
        ]));
        if (result.results?.length) {
          console.log(ui.header('Results'));
          console.log(ui.table(['Step', 'Agent', 'Status', 'Response'],
            result.results.map((r: any) => {
              const dot = r.status === 'completed' ? chalk.green('●') : r.status === 'failed' ? chalk.red('●') : chalk.yellow('●');
              return [`#${r.step_index}`, r.agent_name || '-', `${dot} ${r.status}`, trunc(r.response || '', 40)];
            })));
        }
      } else {
        spinner.stop();
        if (opts.json) { console.log(JSON.stringify(mission, null, 2)); return; }
        console.log(ui.successBox('Mission Created', [
          `${chalk.bold('ID:')}     ${mission.mission_id}`, `${chalk.bold('Status:')} ${mission.status}`,
        ]));
        if (mission.steps?.length) {
          console.log(ui.header('Planned Steps'));
          console.log(ui.table(['Step', 'Agent', 'Task'],
            mission.steps.map((s: any) => [`#${s.step_index}`, s.agent_name || '-', trunc(s.task || '', 50)])));
        }
        console.log('\n' + chalk.dim(`  Run with --execute to dispatch immediately.`));
      }
      console.log('');
    } catch (e) { catchError(spinner, 'Mission failed')(e); }
  });

// ── prompt ────────────────────────────────────────────────────────────

agentCommand
  .command('prompt <name> <instructions>')
  .description('Push custom instructions to an agent')
  .option('--json', 'Output as JSON')
  .action(async (name, instructions, opts) => {
    requireLogin();
    const agentType = resolveAgentType(name);
    const spinner = ora(`Updating prompt for ${name}...`).start();
    try {
      const { data } = await apiClient.put(`/api/v1/cli/agents/${agentType}/prompt`, { custom_instructions: instructions });
      spinner.stop();
      if (opts.json) { console.log(JSON.stringify(data, null, 2)); return; }
      console.log('\n' + ui.successBox('Instructions Updated', [
        `${chalk.bold('Agent:')}  ${name} (${agentType})`,
        `${chalk.bold('Prompt:')} ${trunc(instructions, 60)}`,
      ]) + '\n');
    } catch (e) { catchError(spinner, 'Failed to update prompt')(e); }
  });

// ── settings ──────────────────────────────────────────────────────────

agentCommand
  .command('settings <name>')
  .description('Update agent settings')
  .option('--display-name <name>', 'Set display name')
  .option('--autonomy <level>', 'Set autonomy level (1-5)')
  .option('--temperature <temp>', 'Set temperature (0.0-2.0)')
  .option('--model <model>', 'Set AI model')
  .option('--json', 'Output as JSON')
  .action(async (name, opts) => {
    requireLogin();
    const agentType = resolveAgentType(name);
    const settings: Record<string, unknown> = {};
    if (opts.displayName) settings.display_name = opts.displayName;
    if (opts.autonomy) settings.autonomy_level = parseInt(opts.autonomy, 10);
    if (opts.temperature) settings.temperature = parseFloat(opts.temperature);
    if (opts.model) settings.model = opts.model;

    if (!Object.keys(settings).length) {
      // No flags — show current settings
      const spinner = ora(`Loading settings for ${name}...`).start();
      try {
        const { data } = await apiClient.agentDetail(agentType);
        spinner.stop();
        const d = data as any;
        if (opts.json) { console.log(JSON.stringify(d, null, 2)); return; }
        console.log(ui.header(`Settings — ${d.name || agentType}`));
        console.log(ui.label('Type', d.agent_type));
        console.log(ui.label('Autonomy', `Level ${d.autonomy_level ?? '-'}`));
        console.log(ui.label('Tools', String(d.tools?.length ?? 0)));
        if (d.approval_thresholds && Object.keys(d.approval_thresholds).length) {
          console.log(ui.header('Approval Thresholds'));
          for (const [k, v] of Object.entries(d.approval_thresholds)) console.log(ui.label(k, String(v)));
        }
        console.log('\n' + chalk.dim('  Use flags to update: --display-name, --autonomy, --temperature, --model') + '\n');
      } catch (e) { catchError(spinner, 'Failed to load settings')(e); }
      return;
    }

    const spinner = ora(`Updating settings for ${name}...`).start();
    try {
      const { data } = await apiClient.put(`/api/v1/cli/agents/${agentType}/settings`, settings);
      spinner.stop();
      if (opts.json) { console.log(JSON.stringify(data, null, 2)); return; }
      const updated = Object.entries(settings).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(', ');
      console.log('\n' + ui.successBox('Settings Updated', [
        `${chalk.bold('Agent:')}    ${name} (${agentType})`, `${chalk.bold('Updated:')} ${updated}`,
      ]) + '\n');
    } catch (e) { catchError(spinner, 'Failed to update settings')(e); }
  });
