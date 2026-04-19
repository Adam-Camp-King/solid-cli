/**
 * Agent mode — capability caps for AI-driven CLI sessions.
 *
 * When `solid ai --mode <mode>` is used, the CLI sets SOLID_AGENT_MODE and
 * refuses commands that aren't on the allowlist for that mode. This is a
 * CLIENT-SIDE cap: the backend is still the authority (it also gets the
 * X-Solid-Agent header so it can log/enforce independently). Two guards
 * are better than one — but never rely on the CLI cap alone.
 *
 * Modes (mirror personas but narrower — an agent in "customer" mode should
 * not refactor pages, a "developer"-mode agent should not issue refunds):
 *
 *   customer    Run the business. CRM, orders, voice, analytics.
 *               Cannot touch code, cannot manage other companies,
 *               cannot charge / refund without explicit --yes.
 *
 *   developer   Build the site. Pages, push/pull, sandbox, vibe.
 *               Cannot issue refunds, cannot delete customer data,
 *               cannot invite users.
 *
 *   agency      Manage multiple companies. Switch, invite, train.
 *               Still requires --yes for destructive ops (delete,
 *               refund, cancel-subscription).
 *
 *   full        No cap. Human user OR trusted agent. Default when
 *               SOLID_AGENT_MODE is unset.
 *
 * Destructive ops (REQUIRES_HUMAN below) need `--yes` regardless of mode
 * when an agent is driving. In "full" mode (no agent present), normal
 * command behavior applies.
 */

export type AgentMode = 'customer' | 'developer' | 'agency' | 'full';

/** Top-level command names allowed in each mode. "full" has no entry here — it allows everything. */
export const MODE_ALLOWLIST: Record<Exclude<AgentMode, 'full'>, readonly string[]> = {
  customer: [
    // Common (always available)
    'auth', 'whoami', 'status', 'ai', 'install', 'context', 'docs', 'open',
    'feedback', 'health', 'doctor', 'completion',
    // Customer surface
    'dashboard', 'crm', 'inbox', 'leads', 'orders', 'products', 'services',
    'payment', 'payment-links', 'voice', 'schedule', 'billing', 'analytics',
    'reports', 'insights', 'inventory', 'subscriptions', 'ecommerce',
    'notifications', 'emails', 'marketplace', 'brand', 'flow', 'widget',
    // Reading is fine across modes
    'pages', 'kb', 'blog', 'site',
  ],
  developer: [
    // Common
    'auth', 'whoami', 'status', 'ai', 'install', 'context', 'docs', 'open',
    'feedback', 'health', 'doctor', 'completion', 'init',
    // Developer surface
    'pages', 'site', 'blog', 'kb', 'push', 'pull', 'diff', 'deploy',
    'publish', 'drafts', 'schema', 'sandbox', 'vibe', 'watch', 'clone',
    'import', 'api', 'logs', 'test', 'serve', 'visual', 'rollback',
    'history', 'seo', 'connect', 'dev', 'droplet', 'explore', 'export',
    'design', 'landing', 'widget', 'chat-widgets', 'forms', 'storage',
    'domains', 'integrations', 'inbound', 'webhooks', 'chains', 'ant',
    'llms', 'demo', 'proposal',
  ],
  agency: [
    // Common
    'auth', 'whoami', 'status', 'ai', 'install', 'context', 'docs', 'open',
    'feedback', 'health', 'doctor', 'completion',
    // Agency surface
    'switch', 'company', 'users', 'keys', 'migrate', 'onboarding', 'agent',
    'train', 'accounting', 'audit', 'support',
    // Customer + developer are visible so agency devs can work inside a tenant
    'dashboard', 'analytics', 'reports', 'insights',
    'pages', 'site', 'kb', 'push', 'pull', 'diff', 'deploy',
  ],
};

/**
 * Mutating verbs that should always require --yes when an agent is driving.
 * Matched against the full command path (e.g. "orders refund", "users delete").
 * Use substrings; we intentionally match loosely so new sub-verbs fall under
 * the cap by default rather than slipping through.
 */
export const REQUIRES_HUMAN_CONFIRMATION: readonly string[] = [
  'refund',
  'delete',
  'remove',
  'cancel',
  'revoke',
  'uninstall',
  'logout --all', // revokes all devices
  'rollback',
  'force',
];

export function isModeAllowed(mode: AgentMode, topLevelCommand: string): boolean {
  if (mode === 'full') return true;
  return MODE_ALLOWLIST[mode].includes(topLevelCommand);
}

export function requiresHumanConfirmation(commandPath: string): boolean {
  const lower = commandPath.toLowerCase();
  return REQUIRES_HUMAN_CONFIRMATION.some((needle) => lower.includes(needle));
}

export function parseAgentMode(raw: string | undefined | null): AgentMode | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  if (lower === 'customer' || lower === 'developer' || lower === 'agency' || lower === 'full') {
    return lower;
  }
  return null;
}

/**
 * Short descriptor for error messages / audit logs.
 */
export function modeDescriptor(mode: AgentMode): string {
  switch (mode) {
    case 'customer': return 'customer mode (business operations only)';
    case 'developer': return 'developer mode (build surface only)';
    case 'agency': return 'agency mode (multi-company + training)';
    case 'full': return 'full access (no cap)';
  }
}
