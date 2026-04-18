# `--json` Output Schemas

The contract: **every `--json` payload is the backend's response body, unmodified** — no CLI-added wrapping, no "status" key glued on top. If you want the authoritative schema, that's the OpenAPI spec. This doc is the practical field guide — what you'll actually see in stdout when you run the command.

Schemas below use TypeScript interface shorthand. Optional fields are `?`. Values shown in samples are representative, not fixed.

---

## Auth

### `solid whoami --json` / `solid auth status --json`

```ts
interface WhoamiResponse {
  authenticated: boolean | 'offline';  // 'offline' = cached session, couldn't reach server
  email: string | null;
  company_id: number | null;
  user_id?: number;
  environment: 'production' | 'sandbox' | 'development';
  api_url: string;
  token_expires_at: string | null;  // ISO 8601, null if no expiry tracked
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

### `solid auth token create` (always JSON in output)

```ts
interface ApiKeyCreateResponse {
  id: number;
  name: string;
  key: string;            // sk_solid_... — shown once, never again
  key_prefix: string;     // first 12 chars, safe to log
  scopes: string[];       // e.g. ['kb:read', 'pages:write']
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

```ts
interface CompanyInfoResponse {
  company: {
    id: number;
    name: string;
    kb_sub_code?: string;       // industry slug (plumber, hvac, dentist, …)
    business_type?: string;
    industry_name?: string;
    mcc_code?: string;
    feature_settings?: Record<string, boolean>;
  };
}
```

### `solid company lock-status --json` (T10 agency-managed)

```ts
interface LockStatus {
  company_id: number;
  agency_managed: boolean;
  agency_owner_user_id: number | null;
  locks: {
    pages: boolean;
    brand: boolean;
    domains: boolean;
    modules: boolean;
    design: boolean;
    billing_lock: boolean;
  };
}
```

---

## CRM

### `solid crm contacts list --json`

```ts
interface ContactsListResponse {
  items?: Contact[];        // pass-through; `--all` wraps as { items, count }
  contacts?: Contact[];     // some backend paths use this key
  count: number;
  offset?: number;
  page_size?: number;
}

interface Contact {
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  company_name: string | null;
  status?: 'active' | 'inactive' | 'blocked' | string;
  source?: string;
  contact_type?: string;
  created_at: string;
  updated_at: string;
}
```

### `solid crm contacts import --json`

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
    row: number;                          // 1-indexed within the CSV (row 1 = header)
    status: 'created' | 'failed' | 'skipped' | 'dry-run';
    id?: number;                          // only when status === 'created'
    error?: string;                       // only when status !== 'created'
  }>;
}
```

Same shape for `solid ecommerce orders import --json`.

### `solid crm deals list --json`

```ts
interface DealsListResponse {
  items: Deal[];
  count: number;
}

interface Deal {
  id: number;
  title: string;
  value: number | null;
  stage: string;
  contact_id: number | null;
  contact_name?: string;
  closed_at?: string | null;
  outcome?: 'won' | 'lost' | null;
}
```

---

## Knowledge Base

### `solid kb list --json`

```ts
interface KBListResponse {
  entries: KBEntry[];
  total: number;
}

interface KBEntry {
  id: number;
  title: string;
  category: string | null;
  content: string;           // may be truncated on list endpoint
  version: number;
  updated_at: string;
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

```ts
interface PagesListResponse {
  pages: Array<{
    id: number;
    slug: string;
    title: string;
    is_published: boolean;
    current_version: number;
    updated_at: string;
  }>;
  total: number;
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

```ts
interface BillingOverviewResponse {
  tier: 'starter' | 'builder' | 'professional' | 'enterprise';
  plan?: string;                       // legacy field, mirrors tier
  status: 'active' | 'past_due' | 'cancelled' | 'trialing';
  current_period_end: string;          // ISO
  amount: number;                      // monthly dollars
  processor?: string;
  mcc_code?: string;
  industry?: string;
  active?: boolean;
}
```

### `solid billing invoices --json`

```ts
interface InvoicesListResponse {
  invoices: Array<{
    id: number;
    invoice_id: string;                // Stripe in_... id
    amount: number;
    total: number;
    currency: string;
    status: 'paid' | 'open' | 'void' | 'uncollectible';
    date: string;                      // ISO
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
  rows?: Array<Record<string, unknown>>;   // tabular reports
  data?: Array<Record<string, unknown>>;   // some endpoints use this key
  results?: Array<Record<string, unknown>>;
  summary?: Record<string, number | string>;  // aggregates
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

```ts
interface DashboardSummary {
  revenue?: number;
  transactions?: number;
  customers?: number;
  new_customers?: number;
  avg_transaction?: number;
  chargebacks?: number;
  period?: string;         // days
  date_from?: string;
  date_to?: string;
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
    agent_type: string;           // base — e.g. 'customer_service'
    display_name: string;         // company-specific rename
    system_prompt: string | null;
    personality: string | null;
    model: string | null;
    temperature: number | null;
    last_active: string | null;
  }>;
}
```

---

## MCP Tools / Chains

### `solid chains execute <id> --json`

```ts
interface ChainExecutionResponse {
  execution_id: string;         // UUID — the job handle
  id?: string;                  // legacy alias for execution_id
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

### `solid mcp-server health` / `GET /health` on mcp.solidnumber.com

```ts
interface MCPHealthResponse {
  status: 'healthy';
  server: string;
  version: string;
  tools: number;              // 608+ for the main registry
  categories: number;
  backend: string;            // internal URL
  uptime: number;             // seconds
  timestamp: string;
}
```

---

## Error responses

Any command that hits the backend surfaces the backend's error payload
inside the CLI's red-line formatter. The backend's structured shape:

```ts
interface ApiError {
  detail: string | Array<{ loc: string[]; msg: string; type: string }>;  // FastAPI 422s
  message?: string;
}
```

The CLI flattens `detail` arrays into `loc.path: msg` lines before printing. Structured MCP-protocol errors follow the JSON-RPC 2.0 envelope:

```ts
interface MCPError {
  jsonrpc: '2.0';
  id: string | number | null;
  error: {
    code: number;
    message: string;
    data?: {
      error_class?: string;    // stable identifier — branch on this, not message
      hint?: string;           // human-readable remediation
    };
  };
}
```

---

## Pagination envelope (global)

List endpoints that support `--limit` / `--offset` / `--all` return a common pagination shape when available. `--all` wraps the flattened collection as:

```ts
{ items: T[]; count: number }
```

Single-page responses keep whatever native shape the backend emits (`{ items }`, `{ contacts }`, `{ deals }`, etc.). Use `--all` for schema normalization.
