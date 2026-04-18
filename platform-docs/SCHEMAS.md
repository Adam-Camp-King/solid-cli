# `--json` Output Schemas

**Verified against live production responses** on 2026-04-18 using
`@solidnumber/cli@1.9.14`. If you find drift, the backend shape is the
ground truth — update this doc or open an issue.

The contract: **every `--json` payload is the backend's response body,
unmodified** (except for list commands using `--all`, which wrap the
flattened page as `{ items: T[], count: number }`).

Schemas are TypeScript interfaces for readability. Optional fields are
`?`. Backend inconsistencies (e.g. both `created_at` and `createdAt` on
the same record) are noted where they occur.

---

## Auth

### `solid whoami --json` / `solid auth status --json`

```ts
interface WhoamiResponse {
  authenticated: boolean | 'offline';   // 'offline' = cached session, couldn't reach server
  email: string | null;
  company_id: number | null;
  user_id?: number;                     // only populated when the server confirmed auth
  environment: 'production' | 'sandbox' | 'development';
  api_url: string;
  token_expires_at: string | null;      // ISO 8601, null if no expiry tracked
}
```

### `solid auth refresh --json`

```ts
interface AuthRefreshResponse {
  refreshed: boolean;
  token_expires_at?: string | null;
  reason?: 'no_refresh_token' | 'refresh_rejected';  // only on failure
}
```

### `solid auth token create` (always emits JSON on success)

```ts
interface ApiKeyCreateResponse {
  id: number;
  name: string;
  key: string;             // sk_solid_... — shown once, never again
  key_prefix: string;      // first 12 chars, safe to log
  scopes: string[];        // e.g. ['kb:read', 'pages:write']
  expires_at: string | null;
  created_at: string;
}
```

---

## Multi-Company

### `solid company current --json`

```ts
{ company_id: number | null; email: string | null }
```

### `solid switch --list --json`

```ts
interface SwitchListResponse {
  active_company_id: number;
  companies: Array<{
    id: number;
    name: string;
    role: 'owner' | 'admin' | 'manager' | 'user' | 'viewer' | string;
  }>;
}
```

### `solid company info --json`

Top-level envelope has a `status` sibling alongside the `company` object:

```ts
interface CompanyInfoResponse {
  status: 'ok' | 'error' | string;
  company: {
    id: number;
    name: string;
    slug: string;
    created_at: string;
    is_demo: boolean;
    logo_asset_id: number | null;
    logo_url: string | null;
    parent_id: number | null;
    portal_type: string | null;
    public_domain: string | null;
    sandbox_enabled: boolean;
    timezone: string;
  };
}
```

Note: `kb_sub_code`, `business_type`, `industry_name`, `mcc_code` are
NOT on this endpoint — fetch them via `solid company current` or the
direct `/api/v1/companies/me` endpoint instead.

---

## CRM

### `solid crm contacts list --json`

Two envelope shapes — single page returns the backend body as-is
(flexible), `--all` normalizes to `{ items, count }`.

```ts
// Single page (default)
interface ContactsListResponse {
  contacts?: Contact[];     // most responses use this key
  items?: Contact[];        // some paths use this
  total?: number;
}

// --all wrapper
interface ContactsAllResponse {
  items: Contact[];
  count: number;
}

// Contact — snake_case and camelCase BOTH appear on the same record
// (legacy fields from the dashboard side kept for backwards compat)
interface Contact {
  id: number;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  name: string | null;                  // camelCase alias
  email: string | null;
  phone: string | null;
  company: string | null;               // company name
  company_id: number | null;            // tenant id (Solid# owner)
  company_name: string | null;
  contact_type: string | null;
  source: string | null;
  status: string | null;
  grade: string | null;
  score: number | null;
  tags: string[];
  assigned_at: string | null;
  assigned_to_user_id: number | null;
  assigned_to_user_name: string | null;
  assigned_to_agent: string | null;
  totalOrders: number | null;           // camelCase
  totalSpent: number | null;            // camelCase
  lastOrderDate: string | null;         // camelCase
  created_at: string;
  createdAt: string;                    // dupe — camelCase
  updated_at: string;
}
```

### `solid crm contacts import --json`

Same shape as `solid ecommerce orders import --json`:

```ts
interface ImportResponse {
  summary: {
    total: number;
    created: number;
    failed: number;
    skipped: number;
    dry_run: boolean;
  };
  results: Array<{
    row: number;                        // 1-indexed within the CSV
    status: 'created' | 'failed' | 'skipped' | 'dry-run';
    id?: number;                        // only when status === 'created'
    error?: string;                     // only when status !== 'created'
  }>;
}
```

### `solid crm deals list --json`

Envelope is NOT `{ items, count }` like contacts — it's `{ deals, limit, offset, total }`.

```ts
interface DealsListResponse {
  deals: Deal[];
  limit: number;
  offset: number;
  total: number;
}

interface Deal {
  id: number;
  title: string;
  stage: string;
  source: string | null;
  amount: number | null;                // dollars
  amount_cents: number | null;          // cents (authoritative)
  lead_cost_cents: number | null;
  notes: string | null;
  contact_id: number | null;
  contact_name: string | null;
  company_id: number;                   // tenant
  company_name: string | null;
  assigned_at: string | null;
  assigned_to_user_id: number | null;
  assigned_to_user_name: string | null;
  assigned_to_agent: string | null;
  follow_up_date: string | null;
  created_at: string;
  updated_at: string;
}
```

---

## Knowledge Base

### `solid kb list --json`

Minimal envelope — just `{ results }`, no total / count / pagination
metadata returned:

```ts
interface KBListResponse {
  results: KBEntry[];
}

interface KBEntry {
  id: number;
  title: string;
  category: string | null;
  content: string;
  // Other fields (version, updated_at) are returned by the /kb/entries/{id}
  // detail endpoint, not the list endpoint.
}
```

### `solid history kb [id] --json`

```ts
interface KBHistoryResponse {
  entry?: { title: string; category: string | null };
  versions: Array<{
    version: number;
    title: string;
    category?: string | null;
    change_summary: string | null;
    source: 'cli' | 'dashboard' | 'vibe' | 'import' | 'api';
    created_at: string;
  }>;
  count: number;
}
```

---

## Pages & CMS

### `solid pages list --json`

Pages list uses the `--all` envelope even for single-page requests
(we added this consistency in 1.9.14).

```ts
interface PagesListResponse {
  items: Page[];
  count: number;
}

interface Page {
  id: number;
  slug: string;
  title: string;
  page_type: 'website' | 'landing' | 'blog' | 'booking' | string;
  is_published: boolean;
  current_version: number;
  updated_at: string;
}
```

### `solid history pages [slug] --json`

```ts
interface PagesHistoryResponse {
  page?: {
    title: string;
    slug: string;
    current_version: number;
  };
  versions: Array<{
    version: number;
    slug?: string;
    title?: string;
    is_published?: boolean;
    source?: string;
    change_summary?: string | null;
    created_at?: string;
    layout_json?: { sections?: unknown[] };
  }>;
  count: number;
}
```

---

## Billing

### `solid billing status --json`

**Backend changed this shape recently — verified 2026-04-18.**

```ts
interface BillingStatusResponse {
  has_payment_method: boolean;
  next_billing_date: string | null;        // ISO
  subscription: Subscription | null;       // null = no active subscription
  sms_pack: PackState | null;
  voice_plan: PackState | null;
  token_budget: PackState | null;
}

interface Subscription {
  tier: 'starter' | 'builder' | 'professional' | 'enterprise';
  status: 'active' | 'past_due' | 'cancelled' | 'trialing';
  amount_cents: number;
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
}

interface PackState {
  included: number;
  used: number;
  remaining: number;
  overage_price_cents: number;
}
```

### `solid billing invoices --json`

```ts
interface InvoicesListResponse {
  invoices: Array<{
    id: number;
    invoice_id: string;                    // Stripe in_... id
    amount: number;
    total: number;
    currency: string;
    status: 'paid' | 'open' | 'void' | 'uncollectible';
    date: string;
    hosted_url?: string;
    pdf_url?: string;
  }>;
  total: number;
}
```

---

## Reports & Analytics

### `solid reports run <type> --json`

Shape depends on the report. The envelope is stable:

```ts
interface ReportRunResponse {
  rows?: Array<Record<string, unknown>>;
  data?: Array<Record<string, unknown>>;
  results?: Array<Record<string, unknown>>;
  summary?: Record<string, number | string>;
  meta?: {
    report: string;
    date_from: string;
    date_to: string;
    row_count: number;
  };
}
```

Use `solid reports run --list --json` to enumerate types.

### `solid analytics dashboard --json`

**Re-verified 2026-04-18 — fully rewritten from the old `{ revenue, transactions, ... }` shape.** Everything is nested under `metrics`, `quick_stats`, `revenue_chart`, `recent_orders`, `top_products`:

```ts
interface DashboardSummary {
  period: string;                          // '7', '30', '90'
  metrics: {
    total_revenue: TrendMetric;            // see below
    total_orders: TrendMetric;
    customers: { total: number; new: number; trend: number; trend_direction: 'up' | 'down' };
    active_products: { value: number };
    growth_rate: { value: number; formatted: string };
  };
  quick_stats: {
    daily_sales: { value: number; formatted: string; orders: number; date: string };
    month_previous: { value: number; formatted: string; orders: number; month: string };
  };
  revenue_chart: Array<{ date: string; revenue: number }>;
  recent_orders: Array<{ id: number; total: number; customer: string; created_at: string }>;
  top_products: Array<{ id: number; name: string; revenue: number; units: number }>;
}

interface TrendMetric {
  value: number;
  formatted?: string;
  trend: number;                           // % change vs prior period
  trend_direction: 'up' | 'down';
  daily_average: number;
  daily_average_formatted?: string;
  prev_daily_average: number;
}
```

---

## Agents

### `solid agent list --json`

```ts
interface AgentListResponse {
  agents: Array<{
    name: string;
    agent_type: string;
    autonomy_level: number | null;
    tool_count: number;
    description: string;
    status?: 'active' | 'idle' | 'paused';
    tasks_today?: number;
    last_active?: string;
  }>;
}
```

### `solid agent clones --json`

```ts
interface AgentClonesResponse {
  profiles: Array<{
    agent_type: string;                    // base — e.g. 'customer_service'
    display_name: string;                  // company-specific rename
    system_prompt: string | null;
    personality: string | null;
    model: string | null;
    temperature: number | null;
    last_active: string | null;
  }>;
}
```

---

## E-commerce

### `solid ecommerce orders list --json`

Single-page envelope from the backend; `--all` normalizes as usual.

```ts
interface OrdersListResponse {
  orders?: Order[];                        // backend key
  items?: Order[];                         // fallback key on some paths
}

interface Order {
  id: number;
  customer_email?: string;
  customer_name?: string;
  total: number;
  status: 'pending' | 'paid' | 'shipped' | 'cancelled' | 'refunded';
  currency: string;
  created_at: string;
}
```

---

## Conversation Insights

### `solid insights list --json`

Uses the unified `{ items, count }` envelope from command-kit's
`runListCommand`:

```ts
interface InsightListResponse {
  items: Array<{
    insight_type?: 'kb_gap' | 'pattern' | 'suggestion' | string;
    type?: string;                         // some paths duplicate this
    title?: string;
    summary?: string;
    recommendation?: string;
  }>;
  count: number;
}
```

---

## MCP Tools / Chains

### `solid chains execute <id> --json`

```ts
interface ChainExecutionResponse {
  execution_id: string;                    // UUID — the job handle
  id?: string;                             // legacy alias
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  chain_id: number;
  started_at: string;
  completed_at?: string | null;
  results?: Array<{
    step_index: number;
    agent_name?: string;
    status: 'completed' | 'failed' | 'skipped' | 'running';
    response?: string;
  }>;
}
```

### MCP server `/health` on `mcp.solidnumber.com`

```ts
interface MCPHealthResponse {
  status: 'healthy';
  server: string;
  version: string;
  tools: number;                           // 608+ for the main registry
  categories: number;
  backend: string;                         // internal URL
  uptime: number;                          // seconds
  timestamp: string;
}
```

---

## Error shapes

Backend 4xx/5xx responses:

```ts
interface ApiError {
  detail: string | Array<{ loc: string[]; msg: string; type: string }>;
  message?: string;
}
```

The CLI flattens `detail` arrays into `loc.path: msg` lines before
printing (on stderr). MCP protocol errors follow JSON-RPC 2.0:

```ts
interface MCPError {
  jsonrpc: '2.0';
  id: string | number | null;
  error: {
    code: number;
    message: string;
    data?: {
      error_class?: string;                // stable identifier — branch on this, not message
      hint?: string;                       // human-readable remediation
    };
  };
}
```

---

## `--all` envelope (universal)

When you pass `--all`, command-kit's `runListCommand` normalizes the
flattened collection as:

```ts
{ items: T[]; count: number }
```

regardless of the backend's native key (`contacts`, `deals`, `orders`,
`items`, etc.). This lets scripts write `jq '.items[]'` without
per-endpoint special-casing.

Single-page responses keep the backend's native shape — documented
above per command.

---

## Gotchas I actually hit while writing this

- `billing status` used to return `{ tier, status, amount, ... }` flat.
  It's now `{ subscription: {...}, sms_pack, voice_plan, token_budget, ... }`.
  If you wrote scripts against the old shape, they're broken.
- Contact records double-serialize both `created_at` (snake) AND
  `createdAt` (camel), `totalOrders`/`totalSpent` (camel) alongside
  snake_case fields from the same row. The backend is mid-migration.
- Deals use `deals` as the envelope key; contacts use `contacts` or
  `items`; orders use `orders`; insights uses `items` (because we wrap it).
  No universal naming — use `--all` if you want consistency.
- `kb list` returns just `{ results }` — no `total` or pagination
  metadata. Use `solid history kb` if you need versioned history.
