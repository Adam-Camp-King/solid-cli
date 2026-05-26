/**
 * Verb metadata inference.
 *
 * Enriches VerbEntry with inferred metadata that agents need to make
 * decisions without guessing: does this command mutate? what envelope
 * does it return? what errors can it throw? is it idempotent?
 *
 * Inference is heuristic — based on verb naming conventions. Override
 * with explicit metadata in verb-overrides.json for special cases.
 */
import type { VerbEntry } from './verb-manifest';

export interface VerbContract {
  verb: string;
  path: string;
  description: string;

  /** Input: options and positional args with types. */
  input: {
    options: { flag: string; type: string; required: boolean; default?: unknown; description: string }[];
    args: { name: string; type: string; required: boolean; description?: string }[];
  };

  /** Inferred output envelope type. */
  output_envelope: 'list' | 'detail' | 'mutation' | 'status' | 'stream' | 'unknown';

  /** Standard errors this command can return. */
  errors: string[];

  /** Does this command change state? */
  mutates: boolean;

  /** Safe to retry without side effects? */
  idempotent: boolean;

  /** Does this command require authentication? */
  requires_auth: boolean;

  /** Command category for filtering. */
  category: string;

  /** Example invocation. */
  example: string;
}

const READ_VERBS = new Set([
  'list', 'get', 'show', 'status', 'info', 'check', 'health',
  'view', 'describe', 'inspect', 'search', 'find', 'count',
  'export', 'download', 'pull', 'diff', 'compare', 'audit',
  'verbs', 'pages', 'blocks', 'workflows', 'schema',
]);

const MUTATION_VERBS = new Set([
  'create', 'add', 'update', 'edit', 'set', 'delete', 'remove',
  'push', 'deploy', 'publish', 'unpublish', 'activate', 'deactivate',
  'enable', 'disable', 'reset', 'clear', 'import', 'clone',
  'enroll', 'connect', 'disconnect', 'cancel', 'archive',
  'send', 'dispatch', 'train', 'generate', 'build',
]);

const IDEMPOTENT_MUTATIONS = new Set([
  'update', 'edit', 'set', 'enable', 'disable', 'activate', 'deactivate',
]);

const NO_AUTH_COMMANDS = new Set([
  'solid auth', 'solid auth login', 'solid auth signup',
  'solid health', 'solid doctor', 'solid --version',
  'solid schema', 'solid schema verbs', 'solid schema pages',
  'solid schema blocks', 'solid schema describe', 'solid schema workflows',
]);

const LIST_VERBS = new Set(['list', 'search', 'find']);
const DETAIL_VERBS = new Set(['get', 'show', 'info', 'describe', 'inspect', 'view']);
const STATUS_VERBS = new Set(['status', 'health', 'check', 'doctor', 'audit']);

const STANDARD_READ_ERRORS = ['UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'RATE_LIMITED'];
const STANDARD_MUTATION_ERRORS = ['UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'RATE_LIMITED', 'VALIDATION_ERROR', 'CONFLICT'];

function inferCategory(path: string): string {
  const parts = path.split(' ');
  if (parts.length < 2) return 'general';
  const top = parts[1];
  const categoryMap: Record<string, string> = {
    auth: 'auth', crm: 'crm', kb: 'knowledge-base', pages: 'cms',
    products: 'commerce', orders: 'commerce', inventory: 'commerce',
    ecommerce: 'commerce', billing: 'billing', payment: 'billing',
    voice: 'voice', sms: 'communications', agent: 'ai',
    train: 'ai', predict: 'ai', schema: 'schema', deploy: 'operations',
    health: 'operations', doctor: 'operations', status: 'operations',
    pull: 'sync', push: 'sync', context: 'context', mcp: 'mcp',
    api: 'developer', dev: 'developer', webhook: 'developer',
  };
  return categoryMap[top] || 'general';
}

function inferFlagType(flags: string): string {
  if (flags.includes('<number>') || flags.includes('<count>') || flags.includes('<limit>')) return 'number';
  if (flags.includes('<id>') || flags.includes('<name>') || flags.includes('<path>')) return 'string';
  if (flags.includes('[')) return 'string?';
  if (!flags.includes('<') && !flags.includes('[')) return 'boolean';
  return 'string';
}

function lastVerb(path: string): string {
  const parts = path.split(' ');
  return parts[parts.length - 1];
}

export function inferVerbContract(entry: VerbEntry): VerbContract {
  const tail = lastVerb(entry.path);

  const isMutation = MUTATION_VERBS.has(tail) && !READ_VERBS.has(tail);
  const isRead = READ_VERBS.has(tail);
  const mutates = isMutation;
  const idempotent = isRead || IDEMPOTENT_MUTATIONS.has(tail);
  const requiresAuth = !NO_AUTH_COMMANDS.has(entry.path);

  let outputEnvelope: VerbContract['output_envelope'] = 'unknown';
  if (LIST_VERBS.has(tail)) outputEnvelope = 'list';
  else if (DETAIL_VERBS.has(tail)) outputEnvelope = 'detail';
  else if (STATUS_VERBS.has(tail)) outputEnvelope = 'status';
  else if (mutates) outputEnvelope = 'mutation';

  const errors = mutates ? [...STANDARD_MUTATION_ERRORS] : [...STANDARD_READ_ERRORS];

  const options = entry.options.map((o) => ({
    flag: o.flags,
    type: inferFlagType(o.flags),
    required: o.required,
    default: o.default,
    description: o.description,
  }));

  const args = entry.args.map((a) => ({
    name: a.name,
    type: a.variadic ? 'string[]' : 'string',
    required: a.required,
    description: a.description,
  }));

  const example = entry.path + (entry.args.length > 0
    ? ' ' + entry.args.map(a => a.required ? `<${a.name}>` : `[${a.name}]`).join(' ')
    : '') + ' --json';

  return {
    verb: entry.verb,
    path: entry.path,
    description: entry.description,
    input: { options, args },
    output_envelope: outputEnvelope,
    errors,
    mutates,
    idempotent,
    requires_auth: requiresAuth,
    category: inferCategory(entry.path),
    example,
  };
}

export function inferAllContracts(entries: VerbEntry[]): VerbContract[] {
  return entries.map(inferVerbContract);
}

/**
 * Standard envelope schemas documented for agents.
 * Agents can call `solid schema envelopes --json` to get these.
 */
export const ENVELOPE_SCHEMAS = {
  list: {
    description: 'Paginated list response. Auto-normalized by the CLI response interceptor.',
    shape: {
      items: 'unknown[]',
      total: 'number | null',
      page: 'number | string | null',
      has_more: 'boolean | null',
      _source_key: 'string | null',
    },
    note: 'Original keys (pages, results, leads, etc.) are preserved alongside canonical aliases.',
  },
  detail: {
    description: 'Single item response.',
    shape: {
      id: 'number | string',
      '...fields': 'Record<string, unknown>',
    },
    note: 'Shape varies per resource. Use `solid schema describe <verb>` for specifics.',
  },
  mutation: {
    description: 'Create, update, or delete response.',
    shape: {
      success: 'boolean',
      id: 'number | string | undefined',
      message: 'string | undefined',
    },
    note: 'Created items return the full object. Updates return the updated fields.',
  },
  status: {
    description: 'Health or status check response.',
    shape: {
      status: 'string',
      '...checks': 'Record<string, unknown>',
    },
    note: 'Use `solid status --full --json` for comprehensive company state.',
  },
  error: {
    description: 'Structured error response. All commands use this shape on failure.',
    shape: {
      error: {
        code: 'string',
        status: 'number',
        message: 'string',
        hint: 'string | undefined',
        docs_url: 'string | undefined',
        upgrade_to: 'string | undefined',
      },
    },
    note: 'Error codes: UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, RATE_LIMITED, VALIDATION_ERROR, CONFLICT, SERVER_ERROR.',
  },
};
