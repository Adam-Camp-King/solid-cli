/**
 * Reconciler registry for `solid apply` — maps a declarative manifest `kind`
 * to the REST shape needed to reconcile it (list current, create, update,
 * delete one). Adding a kind = one entry here; the engine stays generic.
 *
 * Endpoints below are taken verbatim from the matching CLI command files
 * (commands/products.ts, crm.ts, webhooks.ts) so they track the real API.
 * A kind with `updateMethod: null` is immutable (create/delete only) — on
 * drift the engine reports it rather than silently mutating.
 */
export interface Reconciler {
  /** Manifest `kind` this entry handles. */
  kind: string;
  /** Spec field that uniquely identifies a resource within the company. */
  identity: string;
  /** GET collection (list current state). */
  list: string;
  /** POST collection (create). */
  create: string;
  /** Path template for one item; `{id}` is substituted. Used for update/delete. */
  itemPath: string;
  /** HTTP verb for an in-place update, or null when the resource is immutable. */
  updateMethod: 'patch' | 'put' | null;
  /** Field on a fetched server item that holds its id (default `id`). */
  idField: string;
  /** Key in the list response holding the array, when not auto-detectable. */
  listKey?: string;
}

export const RECONCILERS: Record<string, Reconciler> = {
  product: {
    kind: 'product',
    identity: 'sku',
    list: '/api/v1/products/',
    create: '/api/v1/products/',
    itemPath: '/api/v1/products/{id}',
    updateMethod: 'patch',
    idField: 'id',
    listKey: 'products',
  },
  contact: {
    kind: 'contact',
    identity: 'email',
    list: '/api/v1/crm/contacts',
    create: '/api/v1/crm/contacts',
    itemPath: '/api/v1/crm/contacts/{id}',
    updateMethod: 'patch',
    idField: 'id',
    listKey: 'contacts',
  },
  deal: {
    kind: 'deal',
    identity: 'name',
    list: '/api/v1/crm/deals',
    create: '/api/v1/crm/deals',
    itemPath: '/api/v1/crm/deals/{id}',
    updateMethod: 'patch',
    idField: 'id',
    listKey: 'deals',
  },
  webhook: {
    kind: 'webhook',
    identity: 'url',
    list: '/api/v1/developer/webhooks',
    create: '/api/v1/developer/webhooks',
    itemPath: '/api/v1/developer/webhooks/{id}',
    updateMethod: null, // webhooks are immutable — recreate to change
    idField: 'id',
    listKey: 'webhooks',
  },
};

export function reconcilerFor(kind: string): Reconciler | undefined {
  return RECONCILERS[kind] || RECONCILERS[kind.toLowerCase()];
}

export function knownKinds(): string[] {
  return Object.keys(RECONCILERS).sort();
}
