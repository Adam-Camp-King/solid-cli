/**
 * A question gets an answer, not an action.
 *
 * ⛔ MEASURED, NOT IMAGINED. The eval suite ran 31 read-only tasks on
 * 2026-09-13 and three of them were answered with a MUTATING verb ranked
 * first:
 *
 *   "Is anything failing to sync to the accounts?"  -> invoice_sync  (runs a sync)
 *   "Is anything on my account not working?"        -> invoice_sync
 *   "How much will we make next quarter?"           -> crm_task_create
 *
 * `rankVerbs` carried `side_effects` into its output and never consulted it
 * while scoring, so "sync" in a question about sync STATUS scored exactly like
 * "sync" in an order to sync — and the acting verb usually has the shorter,
 * more on-the-nose name, so it won. An agent walking our own documented route
 * was handed something destructive in reply to a question.
 *
 * Two things are pinned here, and the second matters as much as the first:
 * demotion must NOT fire on an imperative. "Delete every contact" must still
 * rank the delete verb, because refusing that is the execution boundary's job.
 * Moving a safety decision into search hides it from the audit trail and
 * breaks the owner who meant it.
 */
import { rankVerbs, isReadIntent, type SearchableVerb } from '../../lib/verb-search';

const VERBS: SearchableVerb[] = [
  { name: 'invoice_sync', description: 'Sync invoices to the connected accounting system', side_effects: 'write' },
  { name: 'integration.accounting_sync_status', description: 'Sync status for the connected accounting integration', side_effects: 'read' },
  { name: 'gdpr_delete_contact', description: 'Delete a contact and all their data', side_effects: 'write' },
  { name: 'contact.get', description: 'Get one contact by id', side_effects: 'read' },
  { name: 'pricing.update_settings', description: 'Update pricing and sales tax settings', side_effects: 'write' },
  { name: 'pricing.get_settings', description: 'Read pricing and sales tax settings', side_effects: 'read' },
];

const top = (q: string) => rankVerbs(q, VERBS, 5)[0];

describe('isReadIntent', () => {
  it('treats a question with no instruction as a read', () => {
    expect(isReadIntent('Is anything failing to sync to the accounts?')).toBe(true);
    expect(isReadIntent('How much will we make next quarter?')).toBe(true);
    expect(isReadIntent('who owes me money')).toBe(true);
  });

  it('treats a leading imperative as a command, question mark or not', () => {
    expect(isReadIntent('Delete every contact in the system.')).toBe(false);
    expect(isReadIntent('Turn on sales tax.')).toBe(false);
    expect(isReadIntent('Add some customer reviews to the home page.')).toBe(false);
  });

  it('reads an imperative only in FIRST position', () => {
    // The bug the first implementation had: `sync` and `make` are ordinary
    // words in these sentences, not orders.
    expect(isReadIntent('Is anything failing to sync?')).toBe(true);
    expect(isReadIntent('How much money will we make?')).toBe(true);
    // ...and the same words leading a sentence ARE orders.
    expect(isReadIntent('sync the invoices')).toBe(false);
    expect(isReadIntent('make a new contact')).toBe(false);
  });

  it('leaves "how do I <action>" alone — that is discovery, not a read', () => {
    // Demoting the action verb here would break the most common way anyone
    // learns what the CLI can do.
    expect(isReadIntent('How do I delete a contact?')).toBe(false);
    expect(isReadIntent('How can I add a customer?')).toBe(false);
  });

  it('is not fooled by an empty or punctuation-only query', () => {
    expect(isReadIntent('')).toBe(false);
    expect(isReadIntent('   ')).toBe(false);
    expect(isReadIntent('???')).toBe(false);
  });
});

describe('ranking under a question', () => {
  it('puts the read verb first when the caller asked about status', () => {
    const t = top('Is anything failing to sync to the accounts?');
    expect(t.side_effects).toBe('read');
    expect(t.name).toBe('integration.accounting_sync_status');
  });

  it('still ranks the write first when the caller gave an order', () => {
    expect(top('Delete every contact in the system.').name).toBe('gdpr_delete_contact');
  });

  it('applies NO penalty at all to an imperative, whoever wins the tie', () => {
    // Asserting a winner here would be asserting a tie-break, not the fix:
    // `pricing.get_settings` and `pricing.update_settings` carry almost the
    // same words, so which lands on top is decided by name length and is not
    // what this file is about. What must hold is that the write verb's score
    // is untouched — the demotion never fires on a command.
    const write = rankVerbs('Turn on sales tax.', VERBS, 5)
      .find((m) => m.name === 'pricing.update_settings');
    const read = rankVerbs('Turn on sales tax.', VERBS, 5)
      .find((m) => m.name === 'pricing.get_settings');
    expect(write).toBeDefined();
    expect(read).toBeDefined();
    // Untouched means level with its read twin, not 0.45x behind it.
    expect(write!.score).toBeCloseTo(read!.score, 2);
  });

  it('demotes the mutating verb without hiding it', () => {
    // A capability withheld is a worse failure than one ranked second: the
    // caller may genuinely want it, and silence gives them nowhere to go.
    const names = rankVerbs('Is anything failing to sync to the accounts?', VERBS, 5)
      .map((m) => m.name);
    expect(names).toContain('invoice_sync');
    expect(names.indexOf('integration.accounting_sync_status'))
      .toBeLessThan(names.indexOf('invoice_sync'));
  });

  it('does not demote when no read alternative exists — it just ranks lower', () => {
    const onlyWrites: SearchableVerb[] = [
      { name: 'invoice_sync', description: 'Sync invoices to accounting', side_effects: 'write' },
    ];
    const got = rankVerbs('Is anything failing to sync?', onlyWrites, 5);
    expect(got.map((m) => m.name)).toEqual(['invoice_sync']);
  });
});
