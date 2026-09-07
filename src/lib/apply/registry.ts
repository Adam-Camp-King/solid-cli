/**
 * Reconciler registry for `solid apply` — maps a declarative manifest `kind`
 * to the REST shape needed to reconcile it (list current, create, update,
 * delete one). Adding a kind = one entry here; the engine stays generic.
 *
 * Endpoints below are taken verbatim from the matching CLI command files
 * (commands/products.ts, crm.ts, webhooks.ts, pages.ts, site.ts, domains.ts,
 * forms.ts, agent.ts, voice.ts / lib/api-client.ts) so they track the real API.
 * A kind with `updateMethod: null` is immutable (create/delete only) — on
 * drift the engine reports it rather than silently mutating.
 *
 * Two kinds are CONFIGURE-ONLY (`create: null`, `prunable: false`):
 *   - `agent`      — agents are provisioned from the registry, never by a
 *                    manifest, and never deleted (pause with is_enabled: false).
 *   - `voice_line` — a phone number is bought and released by explicit
 *                    commands that cost money and cut service; apply only
 *                    reconciles how an existing line behaves.
 * Both declare `managedFields`: the manifest may only carry fields the list
 * endpoint reads back, so "unchanged" is a real comparison and never a
 * write-only field that plans as drift forever.
 */
export interface UpdateRoute {
  /** Spec fields this endpoint owns. */
  fields: string[];
  method: 'patch' | 'put';
  /** Path template; `{id}` is substituted. */
  path: string;
}

export interface Reconciler {
  /** Manifest `kind` this entry handles. */
  kind: string;
  /** Spec field that uniquely identifies a resource within the company. */
  identity: string;
  /** GET collection (list current state). */
  list: string;
  /** POST collection (create), or null when apply must never create this kind. */
  create: string | null;
  /** Shown on the plan when a declared resource is missing and `create` is null. */
  createReason?: string;
  /** Path template for one item; `{id}` is substituted. Used for update/delete. */
  itemPath: string;
  /** HTTP verb for an in-place update, or null when the resource is immutable. */
  updateMethod: 'patch' | 'put' | null;
  /**
   * When set, an update is split across these routes by field — only routes
   * owning at least one CHANGED field are called. For kinds whose settings
   * live behind several endpoints (an agent's autonomy, pause state, model).
   */
  updateRoutes?: UpdateRoute[];
  /** Field on a fetched server item that holds its id (default `id`). */
  idField: string;
  /** Key in the list response holding the array, when not auto-detectable. */
  listKey?: string;
  /** false = `--prune` never deletes this kind (default true). */
  prunable?: boolean;
  /** The only spec fields accepted for this kind (identity is always allowed). */
  managedFields?: string[];
  /** Read-side field → write-side body, for fields the API names differently on write. */
  writeMap?: Record<string, (value: unknown) => Record<string, unknown>>;
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
  page: {
    kind: 'page',
    identity: 'slug',
    list: '/api/v1/cms/pages',
    create: '/api/v1/cms/pages',
    itemPath: '/api/v1/cms/pages/{id}',
    updateMethod: 'patch',
    idField: 'id',
    listKey: 'pages',
  },
  site: {
    kind: 'site',
    identity: 'slug',
    list: '/api/v1/sites',
    create: '/api/v1/sites',
    itemPath: '/api/v1/sites/{id}',
    updateMethod: null, // no in-place site update endpoint — recreate to change
    idField: 'id',
    listKey: 'sites',
  },
  domain: {
    kind: 'domain',
    identity: 'domain',
    list: '/api/v1/domains/custom', // returns a bare array
    create: '/api/v1/domains/custom',
    itemPath: '/api/v1/domains/custom/{id}',
    updateMethod: null, // domains are verify-then-live — recreate to change
    idField: 'id',
  },
  survey: {
    kind: 'survey',
    identity: 'title',
    list: '/api/v1/surveys',
    create: '/api/v1/surveys/create',
    itemPath: '/api/v1/surveys/{id}',
    updateMethod: 'put',
    idField: 'id',
    listKey: 'surveys',
  },
  agent: {
    kind: 'agent',
    identity: 'agent_type',
    // include_disabled — a paused agent is still declared state, not a missing one.
    list: '/api/v1/agents?include_disabled=true',
    create: null,
    createReason: 'agents are provisioned from the registry, not a manifest — run `solid agent sync`',
    itemPath: '/api/v1/agents/{id}',
    updateMethod: 'put',
    updateRoutes: [
      { fields: ['autonomy_level'], method: 'patch', path: '/api/v1/agents/{id}/autonomy' },
      { fields: ['is_enabled'], method: 'patch', path: '/api/v1/agents/{id}/toggle' },
      { fields: ['llm_model_override', 'llm_provider_id', 'voice_enabled'], method: 'put', path: '/api/v1/agents/{id}' },
    ],
    idField: 'id',
    listKey: 'agents',
    prunable: false,
    managedFields: ['autonomy_level', 'is_enabled', 'llm_model_override', 'llm_provider_id', 'voice_enabled'],
  },
  voice_line: {
    kind: 'voice_line',
    identity: 'phone_number',
    list: '/api/v1/voice/phone-numbers',
    create: null,
    createReason: 'apply never provisions a number (that buys one) — use `solid voice numbers add`',
    itemPath: '/api/v1/voice/phone-numbers/{id}',
    updateMethod: 'patch',
    updateRoutes: [
      { fields: ['routing_mode'], method: 'patch', path: '/api/v1/phone/settings/{id}' },
      {
        fields: [
          'agent_id', 'greeting_message', 'voice_config', 'business_hours',
          'voicemail_enabled', 'translate_mode', 'target_lang', 'is_active',
        ],
        method: 'patch',
        path: '/api/v1/voice/phone-numbers/{id}',
      },
    ],
    idField: 'id',
    listKey: 'phone_numbers',
    prunable: false,
    managedFields: [
      'routing_mode', 'agent_id', 'greeting_message', 'voice_config', 'business_hours',
      'voicemail_enabled', 'translate_mode', 'target_lang', 'is_active',
    ],
    // The list reads `is_active`; the PATCH writes `status`.
    writeMap: { is_active: (v) => ({ status: v ? 'active' : 'inactive' }) },
  },
};

export function reconcilerFor(kind: string): Reconciler | undefined {
  return RECONCILERS[kind] || RECONCILERS[kind.toLowerCase()];
}

export function knownKinds(): string[] {
  return Object.keys(RECONCILERS).sort();
}
