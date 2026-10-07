/**
 * solid leads test — one labelled TEST lead through the business's live website form.
 *
 * ⛔ WHY THIS EXISTS (clean-room dry run, 2026-10-06). The backend has had a test mode on
 * its lead doors since 2026-09-30: a submission carrying `_solid_test_lead` runs the WHOLE
 * real path — the site's form address, the CRM record, every alert — and is labelled TEST
 * on every channel. It was named nowhere in this CLI, its docs or its how-to, and
 * `solid find "submit a test lead"` returned three unrelated verbs. So the last step of
 * setting a client up — "does a lead actually arrive?" — had two outcomes for an outside
 * agent: type a made-up person into a real business's form, or skip the check.
 *
 * It posts to the SITE's own form address when the company has one (that is the hop a real
 * visitor uses, so it is the one worth proving) and falls back to the API's lead address,
 * saying which it used. Nothing here decides what a test lead is: the backend does.
 */
import axios from 'axios';
import chalk from 'chalk';
import { Command } from 'commander';

import { apiClient, handleApiError } from '../lib/api-client';
import { config } from '../lib/config';
import { isJsonOutput, printJson } from '../lib/json-output';
import { fetchSites, primarySite, siteCanonicalOrigin, type SiteRow } from '../lib/page-url';

/** The marker the backend reads (services/lead_alerts.py::TEST_LEAD_MARKER). */
export const TEST_LEAD_MARKER = '_solid_test_lead';
/** How the CRM tags the contact a test creates, so it can be found and removed. */
export const TEST_LEAD_SOURCE = 'website_contact_form_test';

export interface TestLeadInput { name?: string; email?: string; phone?: string; message?: string }

/** PURE. The body of a test lead. Always carries the marker; always answerable. */
export function testLeadBody(input: TestLeadInput, fallbackEmail?: string): Record<string, string> {
  const email = (input.email || fallbackEmail || '').trim();
  const phone = (input.phone || '').trim();
  const body: Record<string, string> = {
    name: (input.name || 'Test Lead').trim(),
    subject: 'Test lead (solid leads test)',
    message: (input.message || 'This is a test sent with `solid leads test` to check the form, the CRM and the alerts. Nobody is waiting for a reply.').trim(),
    [TEST_LEAD_MARKER]: '1',
  };
  if (email) body.email = email;
  if (phone) body.phone = phone;
  // The lead address refuses a submission nobody could answer. A test with neither is
  // given a number that cannot ring anyone (the 555-01xx range is reserved for this).
  if (!email && !phone) body.phone = '+1 801 555 0100';
  return body;
}

/** PURE. The site's own form address for a company, or null when it has no public site. */
export function siteLeadUrl(sites: SiteRow[], companyId: number, siteRef?: SiteRow): string | null {
  const origin = siteCanonicalOrigin(siteRef ?? primarySite(sites));
  return origin ? `${origin}/api/cms-contact?company_id=${companyId}` : null;
}

export const leadsTestCommand = new Command('test')
  .description('Send ONE labelled TEST lead through your live website form — proves the form, the CRM and the alerts without filing a real lead')
  .option('--name <name>', 'Name on the test lead', 'Test Lead')
  .option('--email <email>', 'Email on the test lead (default: your own, so a visitor copy comes to you)')
  .option('--phone <phone>', 'Phone on the test lead')
  .option('--message <text>', 'Message on the test lead')
  .option('--via <door>', 'site | api — post to the site\'s own form address (default) or straight to the API', 'site')
  .option('--json', 'Output JSON')
  .action(async (opts) => {
    const json = isJsonOutput(opts);
    const stop = (message: string, extra: Record<string, unknown> = {}): void => {
      if (json) printJson({ ok: false, error: message, ...extra });
      else console.error(chalk.red(`✗ ${message}`));
      process.exitCode = 1;
    };
    if (!config.isLoggedIn()) return stop('Not logged in. Run `solid auth login` first.');
    const companyId = config.companyId;
    if (!companyId) return stop('No company selected. Run `solid switch`, or `solid auth login`.');
    if (!['site', 'api'].includes(String(opts.via))) return stop('--via takes site or api.');

    const body = testLeadBody(opts, config.userEmail);
    let via: 'site' | 'api' = opts.via === 'api' ? 'api' : 'site';
    let posted_to = '';
    let reply: Record<string, any> = {};
    let fellBack: string | undefined;

    if (via === 'site') {
      let target: string | null = null;
      try { target = siteLeadUrl(await fetchSites(), companyId); } catch { target = null; }
      if (!target) {
        fellBack = 'This company has no public site address yet, so there is no site form to post to.';
        via = 'api';
      } else {
        try {
          const res = await axios.post(target, body, {
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            timeout: 30_000, validateStatus: () => true,
          });
          if (res.status >= 200 && res.status < 300 && res.data?.success !== false) {
            posted_to = target;
            reply = (res.data && typeof res.data === 'object') ? res.data : {};
          } else {
            const said = typeof res.data === 'object' ? (res.data?.error || res.data?.detail || '') : '';
            return stop(`The site's form address answered ${res.status}${said ? `: ${typeof said === 'string' ? said : JSON.stringify(said)}` : ''}. `
              + 'That is the hop a real visitor uses, so this is a real finding — a visitor\'s lead would fail the same way.',
            { posted_to: target, status: res.status, try: 'solid leads test --via api   (to see whether the backend itself takes the lead)' });
          }
        } catch (error) {
          return stop(`Could not reach the site's form address (${target}): ${(error as Error).message}. `
            + 'A visitor would not reach it either.',
          { posted_to: target, try: 'solid leads test --via api' });
        }
      }
    }

    if (via === 'api') {
      const path = `/api/v1/cms/pages/public/contact?company_id=${companyId}`;
      try {
        const res = await apiClient.post(path, body);
        posted_to = `${config.apiUrl}${path}`;
        reply = (res.data && typeof res.data === 'object') ? res.data as Record<string, any> : {};
      } catch (error) {
        return stop(handleApiError(error).message, { posted_to: `${config.apiUrl}${path}` });
      }
    }

    // ⛔ The backend says whether it treated this as a test. If it did not, say so loudly:
    // an old backend, or a door that ignores the marker, has just filed a REAL-looking lead.
    const labelled = reply.test === true;
    const out = {
      ok: true,
      test: labelled,
      via,
      posted_to,
      sent: { name: body.name, email: body.email ?? null, phone: body.phone ?? null },
      message: reply.message ?? null,
      ...(fellBack ? { fell_back_to_api: fellBack } : {}),
      where_to_look: `Your CRM: a contact with source ${TEST_LEAD_SOURCE}, and a [TEST] note on it. `
        + 'Your alerts: whatever new-lead alerts the business has on, each one labelled TEST.',
      clean_up: 'solid crm contacts search "Test Lead"   then   solid crm contacts delete <id>',
      ...(labelled ? {} : {
        warning: 'The reply did not say test: true. This lead may have been filed as a REAL lead — '
          + 'find it in the CRM and delete it, and check the backend is current.',
      }),
    };
    if (json) return printJson(out);
    console.log(labelled
      ? chalk.green('✓ Test lead sent and labelled TEST.')
      : chalk.yellow('! The lead was sent, but the reply did not confirm it was labelled TEST.'));
    console.log(`  Through:  ${via === 'site' ? 'the site\'s own form address' : 'the API\'s lead address'}  ${chalk.dim(posted_to)}`);
    if (fellBack) console.log(chalk.dim(`            ${fellBack}`));
    console.log(`  As:       ${body.name}${body.email ? ` <${body.email}>` : ''}${body.phone ? `  ${body.phone}` : ''}`);
    if (reply.message) console.log(chalk.dim(`  Reply:    ${reply.message}`));
    console.log('');
    console.log(`  Look for: ${out.where_to_look}`);
    console.log(`  Remove:   ${chalk.cyan(out.clean_up)}`);
    if (!labelled) console.log(chalk.yellow(`\n  ${out.warning}`));
  });

leadsTestCommand.addHelpText('after', `
What it proves, in one go:
  1. the site's form address takes a submission (the hop a real visitor uses)
  2. the lead lands in the CRM
  3. the business's new-lead alerts fire — bell, email, text, whichever are on

Every alert says TEST and the contact is tagged (source ${TEST_LEAD_SOURCE}), so nobody
calls a customer who does not exist. It is ONE lead; run it once after a site goes live.

For an AI agent: use this, never a made-up person typed into the client's form. By hand, on
any form post or JSON body to the lead address, the same mode is the field ${TEST_LEAD_MARKER}=1.
`);
