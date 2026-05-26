/**
 * Persona-grouped command taxonomy for `solid --help`.
 *
 * The CLI has 91 verbs. A flat alphabetical list doesn't tell you anything
 * about who should run what. This module maps every command to one of four
 * personas:
 *
 *   common     — everyone (auth, whoami, ai, install, etc.)
 *   customer   — business owner running their own shop (CRM, orders, voice...)
 *   developer  — builder on a specific company (pages, push, sandbox...)
 *   agency     — manages multiple companies / agent orchestration
 *
 * No command is HIDDEN from anyone — the backend is the authority on what
 * actually runs for a given token. This is pure help-output organization.
 *
 * If you add a new top-level command, put it in ONE group below. Anything
 * not listed ends up in `common` as a safe default (visible but ungrouped).
 */

export type Persona = 'common' | 'customer' | 'developer' | 'agency' | 'sales';

export const PERSONA_TITLES: Record<Persona, string> = {
  common: 'Common — everyone',
  customer: 'Customer — run your business',
  sales: 'Sales — grow your business',
  developer: 'Developer — build your site & integrations',
  agency: 'Agency / Agent — manage multiple companies',
};

/**
 * Ordered so that stupid-easy onboarding commands appear first within each
 * group. Order matters for help output; don't alphabetize blindly.
 */
export const COMMAND_PERSONAS: Record<string, Persona> = {
  // ── Common ───────────────────────────────────────────────────────
  auth: 'common',
  whoami: 'common',
  status: 'common',
  ai: 'common',
  install: 'common',
  'ask-owner': 'common',  // Typed escalation — available to every agent session
  signal: 'common',       // Event stream — every agent needs to sense state changes
  context: 'common',
  docs: 'common',
  open: 'common',
  feedback: 'common',
  health: 'common',
  doctor: 'common',
  completion: 'common',
  init: 'common',

  // ── Customer (runs the business) ─────────────────────────────────
  dashboard: 'customer',
  crm: 'customer',
  inbox: 'customer',
  leads: 'customer',
  orders: 'customer',
  products: 'customer',
  services: 'customer',
  payment: 'customer',
  'payment-links': 'customer',
  voice: 'customer',
  schedule: 'customer',
  billing: 'customer',
  analytics: 'customer',
  reports: 'customer',
  insights: 'customer',
  inventory: 'customer',
  subscriptions: 'customer',
  ecommerce: 'customer',
  notifications: 'customer',
  emails: 'customer',
  marketplace: 'customer',
  brand: 'customer',

  flow: 'customer',
  widget: 'customer',

  // ── Sales (grows the business) ───────────────────────────────────
  sales: 'sales',

  // ── Developer (builds on a company) ──────────────────────────────
  pages: 'developer',
  site: 'developer',
  blog: 'developer',
  kb: 'developer',
  push: 'developer',
  pull: 'developer',
  diff: 'developer',
  deploy: 'developer',
  publish: 'developer',
  drafts: 'developer',
  schema: 'developer',
  sandbox: 'developer',
  vibe: 'developer',
  watch: 'developer',
  clone: 'developer',
  import: 'developer',
  api: 'developer',
  logs: 'developer',
  test: 'developer',
  serve: 'developer',
  visual: 'developer',
  rollback: 'developer',
  history: 'developer',
  seo: 'developer',
  connect: 'developer',
  dev: 'developer',
  droplet: 'developer',
  explore: 'developer',
  export: 'developer',
  design: 'developer',
  landing: 'developer',
  'chat-widgets': 'developer',
  forms: 'developer',
  storage: 'developer',
  domains: 'developer',
  integrations: 'developer',
  inbound: 'developer',
  webhooks: 'developer',
  chains: 'developer',
  ant: 'developer',
  llms: 'developer',
  demo: 'developer',
  proposal: 'developer',

  // ── Agency / Agent (manages multiple companies) ─────────────────
  switch: 'agency',
  company: 'agency',
  users: 'agency',
  keys: 'agency',
  migrate: 'agency',
  onboarding: 'agency',
  agent: 'agency',
  train: 'agency',
  accounting: 'agency',
  audit: 'agency',
  support: 'agency',
};

/**
 * Stable display order — `common` first (everyone needs it), then the three
 * role tracks in the order a new user typically grows through:
 * customer first (running a biz), then developer (customizing), then
 * agency (scaling to many).
 */
export const PERSONA_ORDER: Persona[] = ['common', 'customer', 'sales', 'developer', 'agency'];

export function personaFor(commandName: string): Persona {
  return COMMAND_PERSONAS[commandName] || 'common';
}
