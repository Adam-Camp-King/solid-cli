/**
 * Voice & phone commands for Solid CLI
 *
 * Manage calls, phone numbers, voicemail, voice personality,
 * and transcripts. All operations scoped to authenticated company.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';

function requireAuth(): void {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
}

function fail(spinner: ReturnType<typeof ora>, msg: string, error: unknown): void {
  spinner.fail(chalk.red(msg));
  console.error(chalk.red(`  ${handleApiError(error).message}`));
}

export const voiceCommand = new Command('voice')
  .description('Voice calls, phone numbers, voicemail & personality');

// ── Calls ────────────────────────────────────────────────────────────

const callsCmd = voiceCommand
  .command('calls')
  .description('List recent calls')
  .option('-s, --status <status>', 'Filter by status (completed, missed, active)')
  .option('-l, --limit <limit>', 'Max results', '20')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireAuth();
    const spinner = ora('Loading calls...').start();
    try {
      const params: Record<string, string> = { limit: options.limit };
      if (options.status) params.status = options.status;
      const response = await apiClient.get('/api/v1/voice/calls', { params });
      const d = response.data as Record<string, any>;
      const calls = Array.isArray(d?.calls) ? d.calls : Array.isArray(d?.items) ? d.items : Array.isArray(d) ? d : [];
      if (options.json) { spinner.stop(); console.log(JSON.stringify(response.data, null, 2)); return; }
      spinner.succeed(chalk.green(`${calls.length} calls`));
      if (calls.length === 0) { console.log(chalk.dim('  No calls found.')); return; }
      console.log('');
      for (const c of calls as Record<string, any>[]) {
        const st = c.status === 'completed' ? chalk.green(c.status) : c.status === 'missed' ? chalk.red(c.status) : chalk.yellow(c.status || 'unknown');
        const dir = c.direction === 'inbound' ? chalk.cyan('IN ') : chalk.magenta('OUT');
        const dur = c.duration_seconds ? chalk.dim(`${c.duration_seconds}s`) : '';
        const date = c.created_at ? chalk.dim(new Date(c.created_at).toLocaleString()) : '';
        console.log(`  ${dir} ${chalk.bold(c.phone_number || c.from || 'Unknown')} ${st} ${dur}`);
        console.log(chalk.dim(`    ID: ${c.id}  ${date}`));
      }
    } catch (error) { fail(spinner, 'Failed to load calls', error); }
  });

callsCmd
  .command('get <call_id>')
  .description('Get call details and transcript')
  .option('--json', 'Output as JSON')
  .action(async (callId, options) => {
    requireAuth();
    const spinner = ora('Loading call details...').start();
    try {
      const response = await apiClient.get(`/api/v1/voice/calls/${callId}`);
      const c = response.data as Record<string, any>;
      if (options.json) { spinner.stop(); console.log(JSON.stringify(c, null, 2)); return; }
      spinner.succeed(chalk.green('Call details'));
      console.log('');
      console.log(`  ${chalk.bold('ID:')}        ${c.id}`);
      console.log(`  ${chalk.bold('Direction:')} ${c.direction || 'N/A'}`);
      console.log(`  ${chalk.bold('Status:')}    ${c.status || 'N/A'}`);
      console.log(`  ${chalk.bold('From:')}      ${c.from || c.phone_number || 'N/A'}`);
      console.log(`  ${chalk.bold('To:')}        ${c.to || 'N/A'}`);
      console.log(`  ${chalk.bold('Duration:')}  ${c.duration_seconds ? c.duration_seconds + 's' : 'N/A'}`);
      console.log(`  ${chalk.bold('Date:')}      ${c.created_at ? new Date(c.created_at).toLocaleString() : 'N/A'}`);
      if (c.transcript) {
        console.log('');
        console.log(chalk.bold('  Transcript:'));
        console.log(chalk.dim(`  ${c.transcript}`));
      }
    } catch (error) { fail(spinner, 'Failed to load call', error); }
  });

// ── Stats ────────────────────────────────────────────────────────────

voiceCommand
  .command('stats')
  .description('Voice call statistics')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireAuth();
    const spinner = ora('Loading voice stats...').start();
    try {
      const response = await apiClient.get('/api/v1/voice/stats');
      const s = response.data as Record<string, any>;
      if (options.json) { spinner.stop(); console.log(JSON.stringify(s, null, 2)); return; }
      spinner.succeed(chalk.green('Voice statistics'));
      console.log('');
      console.log(`  ${chalk.bold('Total calls:')}     ${s.total_calls ?? 'N/A'}`);
      console.log(`  ${chalk.bold('Inbound:')}         ${s.inbound_calls ?? 'N/A'}`);
      console.log(`  ${chalk.bold('Outbound:')}        ${s.outbound_calls ?? 'N/A'}`);
      console.log(`  ${chalk.bold('Missed:')}          ${s.missed_calls ?? 'N/A'}`);
      console.log(`  ${chalk.bold('Avg duration:')}    ${s.avg_duration_seconds ? s.avg_duration_seconds + 's' : 'N/A'}`);
      console.log(`  ${chalk.bold('Total duration:')}  ${s.total_duration_seconds ? s.total_duration_seconds + 's' : 'N/A'}`);
    } catch (error) { fail(spinner, 'Failed to load stats', error); }
  });

// ── Phone Numbers ────────────────────────────────────────────────────

const numbersCmd = voiceCommand
  .command('numbers')
  .description('List phone numbers')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireAuth();
    const spinner = ora('Loading phone numbers...').start();
    try {
      const response = await apiClient.get('/api/v1/phone-numbers');
      const numbers = (response.data as Record<string, any>).items || response.data || [];
      if (options.json) { spinner.stop(); console.log(JSON.stringify(response.data, null, 2)); return; }
      spinner.succeed(chalk.green(`${numbers.length} phone numbers`));
      if (numbers.length === 0) { console.log(chalk.dim('  No phone numbers configured.')); return; }
      console.log('');
      for (const n of numbers as Record<string, any>[]) {
        const label = n.label ? chalk.cyan(` (${n.label})`) : '';
        const status = n.active ? chalk.green('active') : chalk.dim('inactive');
        console.log(`  ${chalk.bold(n.number || n.phone_number)}${label} — ${status}`);
        if (n.id) console.log(chalk.dim(`    ID: ${n.id}`));
      }
    } catch (error) { fail(spinner, 'Failed to load phone numbers', error); }
  });

numbersCmd
  .command('add')
  .description('Add a phone number')
  .requiredOption('-n, --number <number>', 'Phone number (E.164 format)')
  .option('-l, --label <label>', 'Friendly label')
  .action(async (options) => {
    requireAuth();
    const spinner = ora('Adding phone number...').start();
    try {
      const body: Record<string, string> = { number: options.number };
      if (options.label) body.label = options.label;
      const response = await apiClient.post('/api/v1/phone-numbers', body);
      spinner.succeed(chalk.green(`Phone number added: ${options.number}`));
      if ((response.data as Record<string, any>).id) console.log(chalk.dim(`  ID: ${(response.data as Record<string, any>).id}`));
    } catch (error) { fail(spinner, 'Failed to add phone number', error); }
  });

numbersCmd
  .command('update <id>')
  .description('Update phone number config')
  .option('-l, --label <label>', 'New label')
  .action(async (id, options) => {
    requireAuth();
    const spinner = ora('Updating phone number...').start();
    try {
      const body: Record<string, string> = {};
      if (options.label) body.label = options.label;
      await apiClient.patch(`/api/v1/phone-numbers/${id}`, body);
      spinner.succeed(chalk.green('Phone number updated'));
    } catch (error) { fail(spinner, 'Failed to update phone number', error); }
  });

numbersCmd
  .command('remove <id>')
  .description('Remove a phone number')
  .action(async (id) => {
    requireAuth();
    const spinner = ora('Removing phone number...').start();
    try {
      await apiClient.delete(`/api/v1/phone-numbers/${id}`);
      spinner.succeed(chalk.green('Phone number removed'));
    } catch (error) { fail(spinner, 'Failed to remove phone number', error); }
  });

// ── Voicemail ────────────────────────────────────────────────────────

const voicemailCmd = voiceCommand
  .command('voicemail')
  .description('List voicemails')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireAuth();
    const spinner = ora('Loading voicemails...').start();
    try {
      const response = await apiClient.get('/api/v1/voicemails');
      const items = (response.data as Record<string, any>).items || response.data || [];
      if (options.json) { spinner.stop(); console.log(JSON.stringify(response.data, null, 2)); return; }
      spinner.succeed(chalk.green(`${items.length} voicemails`));
      if (items.length === 0) { console.log(chalk.dim('  No voicemails.')); return; }
      console.log('');
      for (const vm of items as Record<string, any>[]) {
        const read = vm.is_read ? chalk.dim('read') : chalk.yellow('NEW');
        const from = vm.from || vm.caller || 'Unknown';
        const date = vm.created_at ? chalk.dim(new Date(vm.created_at).toLocaleString()) : '';
        const dur = vm.duration_seconds ? chalk.dim(`${vm.duration_seconds}s`) : '';
        console.log(`  ${read} ${chalk.bold(from)} ${dur} ${date}`);
        if (vm.transcript) {
          const preview = vm.transcript.substring(0, 80).replace(/\n/g, ' ');
          console.log(chalk.dim(`    ${preview}${vm.transcript.length > 80 ? '...' : ''}`));
        }
        if (vm.id) console.log(chalk.dim(`    ID: ${vm.id}`));
      }
    } catch (error) { fail(spinner, 'Failed to load voicemails', error); }
  });

voicemailCmd
  .command('get <id>')
  .description('Get voicemail details')
  .option('--json', 'Output as JSON')
  .action(async (id, options) => {
    requireAuth();
    const spinner = ora('Loading voicemail...').start();
    try {
      const response = await apiClient.get(`/api/v1/voicemails/${id}`);
      const vm = response.data as Record<string, any>;
      if (options.json) { spinner.stop(); console.log(JSON.stringify(vm, null, 2)); return; }
      spinner.succeed(chalk.green('Voicemail details'));
      console.log('');
      console.log(`  ${chalk.bold('ID:')}       ${vm.id}`);
      console.log(`  ${chalk.bold('From:')}     ${vm.from || vm.caller || 'Unknown'}`);
      console.log(`  ${chalk.bold('Duration:')} ${vm.duration_seconds ? vm.duration_seconds + 's' : 'N/A'}`);
      console.log(`  ${chalk.bold('Date:')}     ${vm.created_at ? new Date(vm.created_at).toLocaleString() : 'N/A'}`);
      console.log(`  ${chalk.bold('Read:')}     ${vm.is_read ? 'Yes' : 'No'}`);
      if (vm.transcript) {
        console.log('');
        console.log(chalk.bold('  Transcript:'));
        console.log(`  ${vm.transcript}`);
      }
    } catch (error) { fail(spinner, 'Failed to load voicemail', error); }
  });

voicemailCmd
  .command('read <id>')
  .description('Mark voicemail as read')
  .action(async (id) => {
    requireAuth();
    const spinner = ora('Marking as read...').start();
    try {
      await apiClient.post(`/api/v1/voicemails/${id}/read`, {});
      spinner.succeed(chalk.green('Voicemail marked as read'));
    } catch (error) { fail(spinner, 'Failed to mark voicemail', error); }
  });

// ── Personality ──────────────────────────────────────────────────────

const personalityCmd = voiceCommand
  .command('personality')
  .description('View voice personality settings')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireAuth();
    const spinner = ora('Loading voice personality...').start();
    try {
      const response = await apiClient.get('/api/v1/voice-personality');
      const p = response.data as Record<string, any>;
      if (options.json) { spinner.stop(); console.log(JSON.stringify(p, null, 2)); return; }
      spinner.succeed(chalk.green('Voice personality'));
      console.log('');
      console.log(`  ${chalk.bold('Voice:')}      ${p.voice || 'default'}`);
      console.log(`  ${chalk.bold('Pace:')}       ${p.pace || 'medium'}`);
      console.log(`  ${chalk.bold('Energy:')}     ${p.energy || 'medium'}`);
      console.log(`  ${chalk.bold('Formality:')}  ${p.formality || 'neutral'}`);
    } catch (error) { fail(spinner, 'Failed to load personality', error); }
  });

personalityCmd
  .command('update')
  .description('Update voice personality')
  .option('--voice <voice>', 'Voice name')
  .option('--pace <pace>', 'Pace (slow, medium, fast)')
  .option('--energy <energy>', 'Energy (low, medium, high)')
  .option('--formality <formality>', 'Formality (casual, neutral, formal)')
  .action(async (options) => {
    requireAuth();
    const body: Record<string, string> = {};
    if (options.voice) body.voice = options.voice;
    if (options.pace) body.pace = options.pace;
    if (options.energy) body.energy = options.energy;
    if (options.formality) body.formality = options.formality;
    if (Object.keys(body).length === 0) {
      console.error(chalk.red('Provide at least one option: --voice, --pace, --energy, --formality'));
      process.exit(1);
    }
    const spinner = ora('Updating voice personality...').start();
    try {
      await apiClient.patch('/api/v1/voice-personality', body);
      spinner.succeed(chalk.green('Voice personality updated'));
    } catch (error) { fail(spinner, 'Failed to update personality', error); }
  });

personalityCmd
  .command('reset')
  .description('Reset voice personality to industry defaults')
  .action(async () => {
    requireAuth();
    const spinner = ora('Resetting voice personality...').start();
    try {
      await apiClient.post('/api/v1/voice-personality/reset', {});
      spinner.succeed(chalk.green('Voice personality reset to defaults'));
    } catch (error) { fail(spinner, 'Failed to reset personality', error); }
  });

// ── Voices ───────────────────────────────────────────────────────────

voiceCommand
  .command('voices')
  .description('List available voices')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireAuth();
    const spinner = ora('Loading available voices...').start();
    try {
      const response = await apiClient.get('/api/v1/voice-personality/voices');
      const voices = (response.data as Record<string, any>).voices || response.data || [];
      if (options.json) { spinner.stop(); console.log(JSON.stringify(response.data, null, 2)); return; }
      spinner.succeed(chalk.green(`${voices.length} voices available`));
      console.log('');
      for (const v of voices as Record<string, any>[]) {
        const name = chalk.bold(v.name || v.id);
        const desc = v.description ? chalk.dim(` — ${v.description}`) : '';
        const lang = v.language ? chalk.cyan(` [${v.language}]`) : '';
        console.log(`  ${name}${lang}${desc}`);
      }
    } catch (error) { fail(spinner, 'Failed to load voices', error); }
  });

// ── Transcript ───────────────────────────────────────────────────────

voiceCommand
  .command('transcript <call_id>')
  .description('Get call transcript')
  .option('--json', 'Output as JSON')
  .action(async (callId, options) => {
    requireAuth();
    const spinner = ora('Loading transcript...').start();
    try {
      const response = await apiClient.get(`/api/v1/voice/calls/${callId}/transcript`);
      const data = response.data as Record<string, any>;
      if (options.json) { spinner.stop(); console.log(JSON.stringify(data, null, 2)); return; }
      spinner.succeed(chalk.green('Call transcript'));
      console.log('');
      const entries = data.entries || data.messages || [];
      if (entries.length > 0) {
        for (const entry of entries as Record<string, any>[]) {
          const speaker = entry.speaker || entry.role || 'Unknown';
          const label = speaker.toLowerCase().includes('agent') ? chalk.cyan(speaker) : chalk.yellow(speaker);
          console.log(`  ${label}: ${entry.text || entry.content || ''}`);
        }
      } else if (data.transcript || data.text) {
        console.log(`  ${data.transcript || data.text}`);
      } else {
        console.log(chalk.dim('  No transcript available for this call.'));
      }
    } catch (error) { fail(spinner, 'Failed to load transcript', error); }
  });

// ── Twilio Reconciliation (super-admin only) ─────────────────────────

voiceCommand
  .command('audit')
  .description('Compare Twilio-billed phone numbers against our DB. Surfaces orphans Twilio is billing you for that our system never tracked. Super-admin only.')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Auditing Twilio account...').start();
    try {
      const res = await apiClient.get('/api/v1/voice/twilio-audit');
      const r = res.data as Record<string, any>;
      if (opts.json) { spinner.stop(); console.log(JSON.stringify(r, null, 2)); return; }
      spinner.succeed(chalk.green(`Twilio: ${r.twilio_count} number(s) | DB: ${r.db_count} number(s)`));
      console.log('');
      if (r.matched?.length) {
        console.log(chalk.green(`✓ Matched (${r.matched.length}):`));
        for (const n of r.matched) console.log(`    ${n.phone_number}  ${chalk.dim(n.sid)}`);
        console.log('');
      }
      if (r.twilio_orphans?.length) {
        console.log(chalk.red(`💸 Twilio orphans (${r.twilio_orphans.length}) — Twilio bills you, our DB doesn't know:`));
        for (const n of r.twilio_orphans) {
          const created = n.date_created ? n.date_created.split('T')[0] : '?';
          console.log(`    ${chalk.bold(n.phone_number)}  ${chalk.dim(n.sid)}  ${chalk.dim(`created ${created}`)}  ${chalk.dim(n.friendly_name || '')}`);
        }
        console.log('');
        console.log(chalk.yellow(`  Estimated waste: ~$${r.estimated_monthly_waste_usd}/mo`));
        console.log(chalk.dim(`  Release with: solid voice release-orphan <sid> --confirm`));
        console.log('');
      }
      if (r.db_orphans?.length) {
        console.log(chalk.yellow(`⚠ DB orphans (${r.db_orphans.length}) — our DB has rows for numbers Twilio doesn't have:`));
        for (const e164 of r.db_orphans) console.log(`    ${e164}`);
        console.log(chalk.dim(`  These are cosmetic — no Twilio billing, but our DB is wrong.`));
        console.log('');
      }
      if (!r.twilio_orphans?.length && !r.db_orphans?.length) {
        console.log(chalk.green('  ✓ No orphans. DB and Twilio are in sync.'));
      }
    } catch (error) { fail(spinner, 'Audit failed', error); }
  });

voiceCommand
  .command('release-orphan <sid>')
  .description('Release a Twilio phone number permanently (stops monthly billing). Use SID from `solid voice audit`. Super-admin only.')
  .option('--confirm', 'Actually release. Without this it dry-runs.')
  .action(async (sid, opts) => {
    requireAuth();
    const spinner = ora(opts.confirm ? `Releasing ${sid}...` : `Dry-run: previewing release of ${sid}...`).start();
    try {
      const res = await apiClient.post('/api/v1/voice/twilio-release', { sid, confirm: !!opts.confirm });
      const r = res.data as Record<string, any>;
      if (r.dry_run) {
        spinner.warn(chalk.yellow('Dry-run — pass --confirm to actually release'));
        console.log('');
        console.log(`  ${chalk.bold('Would release:')} ${r.would_release.phone_number}`);
        console.log(`  ${chalk.dim('SID:')} ${r.would_release.sid}`);
        console.log(`  ${chalk.dim('Friendly name:')} ${r.would_release.friendly_name || '—'}`);
        console.log('');
        console.log(chalk.red('  ⚠ This is permanent. The number cannot be reclaimed.'));
        return;
      }
      spinner.succeed(chalk.green(`Released ${r.phone_number} (${r.db_rows_inactivated} DB row(s) inactivated)`));
    } catch (error) { fail(spinner, 'Release failed', error); }
  });

// ── Real OpenAI Realtime + Twilio cost ──────────────────────────────

voiceCommand
  .command('cost')
  .description('Real OpenAI Realtime + Twilio cost over the last N days, broken down by day. Pulls actual token usage from response.done events.')
  .option('--days <n>', 'Lookback window', '30')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const days = parseInt(opts.days, 10) || 30;
    const spinner = ora(`Loading voice cost (last ${days}d)...`).start();
    try {
      const res = await apiClient.get('/api/v1/voice/cost-summary', { params: { days } });
      const r = res.data as Record<string, any>;
      if (opts.json) { spinner.stop(); console.log(JSON.stringify(r, null, 2)); return; }
      const t = r.totals;
      spinner.succeed(chalk.green(`Voice cost — last ${days} days`));
      console.log('');
      console.log(`  ${chalk.bold('Calls:')}            ${t.calls}  ${chalk.dim(`(${t.ai_calls_with_real_usage} with real OpenAI usage data)`)}`);
      console.log(`  ${chalk.bold('Total minutes:')}    ${(t.duration_seconds / 60).toFixed(1)}`);
      console.log('');
      console.log(`  ${chalk.bold('Twilio:')}           $${t.twilio_usd}`);
      console.log(`  ${chalk.bold('OpenAI Realtime:')}  $${t.openai_usd}  ${chalk.red('← the silent killer')}`);
      console.log(`  ${chalk.bold('Total:')}            $${t.total_usd}`);
      console.log('');
      if (t.ai_calls_with_real_usage > 0) {
        console.log(`  ${chalk.dim('Avg OpenAI cost / call:')}    $${t.avg_openai_cost_per_call_usd}`);
        console.log(`  ${chalk.dim('Avg OpenAI cost / minute:')}  $${t.avg_openai_cost_per_minute_usd}`);
        console.log('');
      }
      if (r.daily?.length) {
        console.log(chalk.bold('  Daily breakdown:'));
        for (const d of r.daily.slice(0, 14) as Record<string, any>[]) {
          const callsLabel = `${d.calls} call${d.calls === 1 ? '' : 's'}`.padEnd(10);
          console.log(`    ${chalk.dim(d.date)}  ${callsLabel}  Twilio $${d.twilio_usd}  OpenAI ${chalk.yellow('$' + d.openai_usd)}`);
        }
        if (r.daily.length > 14) console.log(chalk.dim(`    … ${r.daily.length - 14} more days (use --json for full data)`));
      }
      console.log('');
      console.log(chalk.dim(`  ${r.note}`));
    } catch (error) { fail(spinner, 'Failed to load cost summary', error); }
  });
