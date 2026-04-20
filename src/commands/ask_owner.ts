/**
 * `solid ask-owner` — typed escalation primitive for AI agents.
 *
 * Agent asks, run suspends, owner answers via dashboard/SMS, run resumes
 * with the answer in context. Mirrors the T12 draft-gate pattern but for
 * QUESTIONS (not mutations).
 *
 * Common use cases:
 *
 *   solid ask-owner "Should I approve this $5,200 refund?" --wait
 *     → blocks until owner answers or 24h SLA expires. Prints the
 *       owner's answer to stdout so the agent can parse it.
 *
 *   solid ask-owner "Customer disputes appointment — reschedule or refund?" \
 *     --answerer-role owner --sla 7200 --context '{"customer_id":42}'
 *     → creates an ask visible only to owner-role users, 2h SLA, with
 *       structured context the owner sees on their screen.
 *
 *   solid ask-owner "..." --no-wait
 *     → fire-and-forget; returns the external_id so the agent can check
 *       later via solid ask-owner check <external_id>.
 *
 * Exit codes:
 *   0   answered — answer text on stdout (or full JSON with --json)
 *   2   expired / cancelled — stderr explains
 *   3   timeout (--wait --timeout hit before answer)
 *   1   API error
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { apiClient, handleApiError } from '../lib/api-client';
import { config } from '../lib/config';

interface AskResponse {
  status: string;
  ask: {
    external_id: string;
    status: string;
    answer_text: string | null;
    answer_payload: Record<string, unknown> | null;
    answered_at: string | null;
    sla_seconds: number;
  };
  answer_url?: string;
}

async function createAsk(
  question: string,
  opts: { context?: string; answererRole?: string; sla?: string },
): Promise<AskResponse> {
  const body: Record<string, unknown> = {
    question,
    answerer_role: opts.answererRole || 'admin',
    sla_seconds: opts.sla ? parseInt(opts.sla, 10) : 86400,
  };
  if (opts.context) {
    try { body.context = JSON.parse(opts.context); }
    catch { body.context = { raw: opts.context }; }
  }
  const res = await apiClient.post<AskResponse>('/api/v1/trust/asks', body);
  return res.data;
}

async function pollAsk(externalId: string): Promise<AskResponse['ask']> {
  const res = await apiClient.get<AskResponse['ask']>(
    `/api/v1/trust/asks/${encodeURIComponent(externalId)}`,
  );
  return res.data;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const askOwnerCommand = new Command('ask-owner')
  .description('Typed escalation — agent asks, owner answers, agent resumes')
  .argument('<question>', 'The question to ask')
  .option('--context <json>', 'Structured context for the owner (JSON)')
  .option('--answerer-role <role>', 'Who must answer: admin | agency | owner', 'admin')
  .option('--sla <seconds>', 'Soft SLA before auto-expiry', '86400')
  .option('--wait', 'Block until the owner answers or SLA expires')
  .option('--timeout <seconds>', 'Max wait when --wait is set (default: SLA)', '')
  .option('--interval <seconds>', 'Poll interval in seconds', '5')
  .option('--json', 'Emit the full JSON response instead of answer text')
  .action(async (question: string, opts) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run: solid auth login'));
      process.exit(1);
    }

    let created: AskResponse;
    try {
      created = await createAsk(question, opts);
    } catch (err) {
      const e = handleApiError(err);
      console.error(chalk.red(e.message));
      process.exit(1);
    }

    const externalId = created.ask.external_id;

    if (!opts.wait) {
      // Fire-and-forget. Print id so the agent can poll later.
      if (opts.json) {
        console.log(JSON.stringify(created, null, 2));
      } else {
        console.log(chalk.dim('ask_id:'), externalId);
        console.log(chalk.dim('status:'), created.ask.status);
        console.log(chalk.dim('Answer when ready:'),
          `solid ask-owner check ${externalId}`);
      }
      return;
    }

    // Polling loop.
    const pollSeconds = Math.max(2, parseInt(opts.interval, 10) || 5);
    const timeoutSeconds = opts.timeout
      ? parseInt(opts.timeout, 10)
      : (parseInt(opts.sla, 10) || 86400);
    const deadline = Date.now() + timeoutSeconds * 1000;

    console.error(chalk.dim(
      `  Waiting on owner answer (ask_id: ${externalId}, polling every ${pollSeconds}s, timeout ${timeoutSeconds}s)`,
    ));

    while (Date.now() < deadline) {
      await sleep(pollSeconds * 1000);
      let current: AskResponse['ask'];
      try { current = await pollAsk(externalId); }
      catch (err) {
        // Transient network — don't die. Next poll may succeed.
        const e = handleApiError(err);
        console.error(chalk.dim(`  (poll error: ${e.message})`));
        continue;
      }

      if (current.status === 'answered') {
        if (opts.json) {
          console.log(JSON.stringify(current, null, 2));
        } else {
          console.log(current.answer_text || '');
        }
        return;
      }
      if (current.status === 'expired' || current.status === 'cancelled') {
        console.error(chalk.red(`Ask ${current.status}. No answer received.`));
        process.exit(2);
      }
      // still pending — keep polling
    }

    console.error(chalk.yellow(
      `Timeout (${timeoutSeconds}s) hit before owner answered. Ask is still pending — check later:`,
    ));
    console.error(chalk.dim(`  solid ask-owner check ${externalId}`));
    process.exit(3);
  });

// ── `solid ask-owner check <external_id>` — one-shot poll helper ──
askOwnerCommand
  .command('check <external_id>')
  .description('Check the status of a previously-created ask (no polling)')
  .option('--json', 'Emit full JSON')
  .action(async (externalId: string, opts) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run: solid auth login'));
      process.exit(1);
    }
    try {
      const ask = await pollAsk(externalId);
      if (opts.json) {
        console.log(JSON.stringify(ask, null, 2));
      } else {
        console.log(chalk.dim('status:'), ask.status);
        if (ask.status === 'answered' && ask.answer_text) {
          console.log('');
          console.log(ask.answer_text);
        }
      }
      if (ask.status === 'expired' || ask.status === 'cancelled') process.exit(2);
    } catch (err) {
      const e = handleApiError(err);
      console.error(chalk.red(e.message));
      process.exit(1);
    }
  });
