import { reconcilerFor, knownKinds } from '../../lib/apply/registry';

/**
 * ⛔ `solid apply` COULD NOT DECLARE WHAT A BUSINESS IS ALLOWED TO DO.
 *
 * The manifest reconciled agents, a site, pages, domains, brand, kb, services,
 * products, contacts, deals, webhooks, surveys and phone lines — and could not
 * express capabilities, commerce flows, or which processor takes the money. A
 * file that calls itself "the complete tenant" while omitting those is the parts
 * that happened to have reconcilers, not the business.
 *
 * Each kind added here is backed by routes that were checked first:
 *   capability  GET/POST /api/v1/capabilities, PUT /{id}
 *   flow        GET/POST /api/v1/cli/flows,    PATCH /{id}
 *   processor   GET /api/v1/processors/connected, POST /connect  (no update)
 */

describe('the kinds apply could not reach', () => {
  it.each(['capability', 'flow', 'processor'])('%s has a reconciler', (kind) => {
    expect(knownKinds()).toContain(kind);
    expect(reconcilerFor(kind)).toBeTruthy();
  });

  it('identity is a field a human writes, never a server id', () => {
    // A manifest keyed on database ids is not portable between environments.
    expect(reconcilerFor('capability')!.identity).toBe('name');
    expect(reconcilerFor('flow')!.identity).toBe('name');
    expect(reconcilerFor('processor')!.identity).toBe('processor');
  });

  it('a flow is never activated by apply', () => {
    // ⛔ Activating a flow starts it running. Same reason apply will not
    // provision a phone number: the consequence is not a config change.
    const flow = reconcilerFor('flow')!;
    expect(flow.managedFields).not.toContain('status');
    expect(flow.managedFields).not.toContain('is_active');
  });

  it('a connected processor is never edited in place', () => {
    // ⛔ Rotating live payment credentials from a manifest is not a reconcile,
    // it is an outage waiting for a typo. Drift is reported, nothing rewrites.
    const p = reconcilerFor('processor')!;
    expect(p.updateMethod).toBeNull();
    expect(p.itemPath).toBeNull();
    expect(p.updateReason).toBeTruthy();
  });

  it('the processor reason does not tell anyone to delete their connection', () => {
    // ⛔ THE REASON updateReason EXISTS. The engine's generic text is "delete
    // and recreate to change" — for a live payment processor that is advice
    // that takes payments down.
    const reason = reconcilerFor('processor')!.updateReason!;
    expect(reason).not.toMatch(/delete/i);
    expect(reason).toMatch(/reconnect/i);
  });

  it('nothing prunable was added — apply never deletes these', () => {
    for (const kind of ['capability', 'flow', 'processor']) {
      expect(reconcilerFor(kind)!.prunable).toBe(false);
    }
  });

  it('anything apply can address in place has an item path to address', () => {
    // ⛔ TWO WRONG VERSIONS BEFORE THIS ONE, both asserting the converse.
    // "no update route implies no item path" is false: webhook, site and domain
    // have a path they never use, which is harmless dead config, not a defect
    // to go null out blind. Only the load-bearing direction is asserted — if a
    // kind CAN be updated or pruned it must have somewhere to send that, which
    // is the property engine.ts now relies on after itemPath became nullable.
    for (const kind of knownKinds()) {
      const r = reconcilerFor(kind)!;
      if (r.updateMethod !== null || r.updateRoutes || r.prunable) {
        expect(r.itemPath).not.toBeNull();
      }
    }
  });

});
