/**
 * Per-domain shortcuts that wrap `solid agent dispatch` with cleaner
 * ergonomics. All of these are equivalent to:
 *
 *     solid agent dispatch <verb> --args '{...}' --confirm
 *
 * but read better in shell history + tab-completion. The backend
 * contract is identical — they all POST to /api/v1/ada/cli-dispatch
 * with the same role gates / nonce signing / audit log.
 *
 * Used by both humans and the CLI-as-agent users (per memory
 * feedback_cli_is_for_ai). The universal `solid agent dispatch`
 * remains the escape hatch for any verb that doesn't have a wrapper
 * yet.
 */
import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';

import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { isJsonOutput } from '../lib/json-output';
import { requireAuth } from '../lib/command-kit';

async function _dispatch(verb: string, args: Record<string, unknown>, options: { json?: boolean }, spinnerLabel: string) {
  requireAuth();
  const spinner = ora(spinnerLabel).start();
  try {
    const res = await apiClient.post('/api/v1/ada/cli-dispatch', { verb, args, confirm: true });
    const data = (res.data as any) || {};
    if (isJsonOutput(options)) { spinner.stop(); console.log(JSON.stringify(data, null, 2)); return; }
    if (data.ok === false || data.error) {
      const reason = data?.error?.reason || 'unknown';
      const msg = data?.error?.message || 'Verb denied or failed.';
      spinner.fail(chalk.red(`${verb}: ${reason}`));
      console.error(chalk.red(`  ${msg}`));
      process.exit(1);
    }
    spinner.succeed(chalk.green(`${verb}: ${data?.result?.status || 'ok'}`));
    if (data?.result) {
      const compact: Record<string, unknown> = {};
      for (const key of Object.keys(data.result).slice(0, 6)) {
        const v = (data.result as any)[key];
        compact[key] = typeof v === 'string' ? (v.length > 60 ? v.slice(0, 57) + '...' : v) : v;
      }
      if (Object.keys(compact).length > 0) {
        console.log(chalk.dim('  ' + JSON.stringify(compact, null, 2).replace(/\n/g, '\n  ')));
      }
    }
  } catch (error) {
    spinner.fail(chalk.red(`Dispatch failed: ${handleApiError(error).message}`));
    process.exit(1);
  }
}


// ── solid deal ───────────────────────────────────────────────────────

export const dealCommand = new Command('deal')
  .description('Sales deals — create / advance / mark won (wraps Jackson verbs)');

dealCommand
  .command('create')
  .description('Create a new sales deal')
  .requiredOption('--title <text>', 'Deal title')
  .requiredOption('--contact-id <id>', 'Owning CRM contact ID')
  .option('--amount-cents <n>', 'Deal value in cents')
  .option('--stage <stage>', 'Initial stage (new / qualified / proposal_sent / negotiation)', 'new')
  .option('--notes <text>', 'Optional notes')
  .option('--confirm', 'Required: actually create the deal')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    if (!options.confirm) {
      console.error(chalk.red('Refusing to create a deal without --confirm.'));
      process.exit(2);
    }
    const args: Record<string, unknown> = {
      title: options.title,
      contact_id: Number(options.contactId),
      stage: options.stage,
    };
    if (options.amountCents) args.amount_cents = Number(options.amountCents);
    if (options.notes) args.notes = options.notes;
    await _dispatch('deals_create', args, options, `Creating deal "${options.title}"...`);
  });

dealCommand
  .command('advance <deal_id> <to_stage>')
  .description('Move a deal to the next stage (one step at a time)')
  .option('--confirm', 'Required: actually advance the deal')
  .option('--json', 'Output as JSON')
  .action(async (dealId: string, toStage: string, options) => {
    if (!options.confirm) {
      console.error(chalk.red('Refusing to advance a deal without --confirm.'));
      process.exit(2);
    }
    await _dispatch('deals_advance', { deal_id: Number(dealId), to_stage: toStage }, options, `Advancing deal ${dealId} → ${toStage}...`);
  });

dealCommand
  .command('won <deal_id>')
  .description('Close a deal as won (records revenue attribution)')
  .option('--amount-cents <n>', 'Final closed-won amount in cents')
  .option('--confirm', 'Required: actually close the deal')
  .option('--json', 'Output as JSON')
  .action(async (dealId: string, options) => {
    if (!options.confirm) {
      console.error(chalk.red('Refusing to mark a deal won without --confirm.'));
      process.exit(2);
    }
    const args: Record<string, unknown> = { deal_id: Number(dealId) };
    if (options.amountCents) args.amount_cents = Number(options.amountCents);
    await _dispatch('deals_won', args, options, `Closing deal ${dealId} as won...`);
  });


// ── solid calendar ───────────────────────────────────────────────────

export const calendarCommand = new Command('calendar')
  .description('Google Calendar event create (requires Google linked)');

calendarCommand
  .command('event')
  .description('Create a Google Calendar event on the user\'s primary calendar')
  .requiredOption('--title <text>', 'Event title')
  .requiredOption('--start <iso>', 'Start time, ISO-8601 with tz (e.g. 2026-06-01T15:00:00-06:00)')
  .requiredOption('--end <iso>', 'End time, ISO-8601 with tz')
  .option('--attendees <emails>', 'Comma-separated attendee emails')
  .option('--description <text>', 'Event body / agenda')
  .option('--location <text>', 'Where')
  .option('--meet', 'Attach a Google Meet link')
  .option('--confirm', 'Required: actually create the event')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    if (!options.confirm) {
      console.error(chalk.red('Refusing to create an event without --confirm.'));
      process.exit(2);
    }
    const attendees = options.attendees
      ? String(options.attendees).split(',').map((s: string) => s.trim()).filter(Boolean)
      : [];
    const args: Record<string, unknown> = {
      title: options.title,
      start_time: options.start,
      end_time: options.end,
    };
    if (attendees.length) args.attendees = attendees;
    if (options.description) args.description = options.description;
    if (options.location) args.location = options.location;
    if (options.meet) args.with_meet_link = true;
    await _dispatch('google_calendar_event_create', args, options, `Creating event "${options.title}"...`);
  });


// ── solid lead promote ───────────────────────────────────────────────

export const leadDispatchCommand = new Command('lead-promote')
  .description('Promote a lead_submission to a real CRM contact')
  .argument('<lead_id>', 'LeadSubmission ID')
  .option('--confirm', 'Required: actually promote the lead')
  .option('--json', 'Output as JSON')
  .action(async (leadId: string, options) => {
    if (!options.confirm) {
      console.error(chalk.red('Refusing to promote a lead without --confirm.'));
      process.exit(2);
    }
    await _dispatch('crm_lead_promote', { lead_id: Number(leadId) }, options, `Promoting lead ${leadId} to contact...`);
  });


// ── Agent-attraction verb shortcuts (v2.11.1) ────────────────────────
//
// These wrap GET-style intelligence verbs from /api/v1/agent/verbs.
// Different endpoint shape than the ADA-tool dispatcher above — these
// hit /api/v1/agent/{namespace}/{verb} directly (the universal verb
// invoker that ships in solid-public's webmcp.json + ucp.json + the
// MCP stdio bridge). Promoted from `solid agent dispatch <verb>` to
// first-class shortcuts because they're the highest-traffic reads
// per the 2026-05-21 verb-gap analysis.

async function _invokeAgentVerb(verbName: string, payload: Record<string, unknown>, options: { json?: boolean }, spinnerLabel: string) {
  requireAuth();
  const spinner = ora(spinnerLabel).start();
  try {
    // Look up the verb to know its HTTP endpoint + method.
    const lookup = await apiClient.get(`/api/v1/agent/verbs/${encodeURIComponent(verbName)}`);
    const verb = lookup.data as { name: string; http_endpoint: string; http_method?: string };
    const method = (verb.http_method || 'GET').toUpperCase();
    const res = method === 'GET'
      ? await apiClient.get(verb.http_endpoint, { params: payload })
      : await apiClient.post(verb.http_endpoint, payload);
    spinner.succeed(chalk.green(`${verbName}: ok`));
    if (isJsonOutput(options)) { console.log(JSON.stringify(res.data, null, 2)); return; }
    const data = res.data as Record<string, unknown>;
    const compact: Record<string, unknown> = {};
    for (const key of Object.keys(data).slice(0, 8)) {
      const v = (data as any)[key];
      compact[key] = typeof v === 'string' ? (v.length > 80 ? v.slice(0, 77) + '...' : v) : v;
    }
    console.log(chalk.dim('  ' + JSON.stringify(compact, null, 2).replace(/\n/g, '\n  ')));
  } catch (error) {
    spinner.fail(chalk.red(`${verbName} failed: ${handleApiError(error).message}`));
    process.exit(1);
  }
}


// solid customer-context <customer_id> — customer.full_context
export const customerContextCommand = new Command('customer-context')
  .description('Aggregate customer view: orders + interactions + lifecycle + payment methods')
  .argument('<customer_id>', 'CRM contact ID')
  .option('--include-payment-methods', 'Include payment-method snapshots')
  .option('--json', 'Output as JSON')
  .action(async (customerId: string, options) => {
    const payload: Record<string, unknown> = { customer_id: Number(customerId) };
    if (options.includePaymentMethods) payload.include_payment_methods = true;
    await _invokeAgentVerb('customer.full_context', payload, options, `Fetching full context for customer ${customerId}...`);
  });


// solid deal-next <deal_id> — deal.suggest_next_action
export const dealNextCommand = new Command('deal-next')
  .description('Ranked next-best-action suggestions for a deal')
  .argument('<deal_id>', 'Deal ID')
  .option('--json', 'Output as JSON')
  .action(async (dealId: string, options) => {
    await _invokeAgentVerb('deal.suggest_next_action', { deal_id: Number(dealId) }, options, `Computing next action for deal ${dealId}...`);
  });


// solid contact-map <contact_id> — contact.relationship_map
export const contactMapCommand = new Command('contact-map')
  .description('Relationship graph for a contact: company, peers, deals, activities')
  .argument('<contact_id>', 'CRM contact ID')
  .option('--json', 'Output as JSON')
  .action(async (contactId: string, options) => {
    await _invokeAgentVerb('contact.relationship_map', { contact_id: Number(contactId) }, options, `Mapping contact ${contactId} relationships...`);
  });


// solid customer-upsell <customer_id> — customer.suggest_upsell
export const customerUpsellCommand = new Command('customer-upsell')
  .description('Ranked product suggestions based on a customer\'s purchase history')
  .argument('<customer_id>', 'CRM contact ID')
  .option('--limit <n>', 'Max suggestions to return', '5')
  .option('--json', 'Output as JSON')
  .action(async (customerId: string, options) => {
    const payload: Record<string, unknown> = { customer_id: Number(customerId) };
    if (options.limit) payload.limit = Number(options.limit);
    await _invokeAgentVerb('customer.suggest_upsell', payload, options, `Computing upsell suggestions for customer ${customerId}...`);
  });


// solid inventory-reorder — inventory.suggest_reorder
export const inventoryReorderCommand = new Command('inventory-reorder')
  .description('Ranked reorder suggestions per location')
  .option('--location-id <id>', 'Limit to one inventory location')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const payload: Record<string, unknown> = {};
    if (options.locationId) payload.location_id = Number(options.locationId);
    await _invokeAgentVerb('inventory.suggest_reorder', payload, options, 'Computing reorder suggestions...');
  });
