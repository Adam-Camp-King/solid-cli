/**
 * API Client for Solid# Backend
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { config } from './config';

interface ApiResponse<T = unknown> {
  data: T;
  status: number;
  success: boolean;
}

interface ApiError {
  message: string;
  code?: string;
  status: number;
}

class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: config.apiUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add auth interceptor
    this.client.interceptors.request.use((requestConfig) => {
      // CLI API key from env var takes priority (CI/CD, LLM agents)
      const envApiKey = process.env.SOLID_API_KEY;
      if (envApiKey) {
        requestConfig.headers.Authorization = `Bearer ${envApiKey}`;
      } else {
        const token = config.accessToken;
        if (token) {
          requestConfig.headers.Authorization = `Bearer ${token}`;
        }
      }
      const companyId = config.companyId;
      if (companyId) {
        requestConfig.headers['X-Company-ID'] = companyId.toString();
      }
      return requestConfig;
    });

    // Add response interceptor
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        if (error.response?.status === 401) {
          // Try to refresh token
          const refreshed = await this.refreshToken();
          if (refreshed && error.config) {
            // Retry original request
            return this.client.request(error.config);
          }
        }
        throw error;
      }
    );
  }

  private async refreshToken(): Promise<boolean> {
    const refreshToken = config.refreshToken;
    if (!refreshToken) return false;

    try {
      const response = await axios.post(`${config.apiUrl}/api/v1/auth/refresh`, {
        refresh_token: refreshToken,
      });

      config.accessToken = response.data.access_token;
      if (response.data.refresh_token) {
        config.refreshToken = response.data.refresh_token;
      }
      if (response.data.expires_at) {
        config.tokenExpiresAt = new Date(response.data.expires_at);
      }

      return true;
    } catch {
      config.logout();
      return false;
    }
  }

  // Generic HTTP methods (used by droplet, dev, etc.)
  async get<T = unknown>(url: string, options?: { params?: Record<string, unknown> }): Promise<ApiResponse<T>> {
    const response = await this.client.get(url, options);
    return { data: response.data, status: response.status, success: true };
  }

  async post<T = unknown>(url: string, data?: unknown): Promise<ApiResponse<T>> {
    const response = await this.client.post(url, data);
    return { data: response.data, status: response.status, success: true };
  }

  async patch<T = unknown>(url: string, data?: unknown): Promise<ApiResponse<T>> {
    const response = await this.client.patch(url, data);
    return { data: response.data, status: response.status, success: true };
  }

  async delete<T = unknown>(url: string, options?: { params?: Record<string, unknown> }): Promise<ApiResponse<T>> {
    const response = await this.client.delete(url, options);
    return { data: response.data, status: response.status, success: true };
  }

  // Auth endpoints
  async login(email: string, password: string): Promise<ApiResponse<{
    access_token: string;
    refresh_token: string;
    expires_at: string;
    user: { id: number; email: string; company_id: number };
  }>> {
    const response = await this.client.post('/api/v1/auth/login', {
      email,
      password,
    });
    return { data: response.data, status: response.status, success: true };
  }

  async authStatus(): Promise<ApiResponse<{
    authenticated: boolean;
    user?: { id: number; email: string; company_id: number };
  }>> {
    try {
      const response = await this.client.get('/api/v1/auth/me');
      return { data: { authenticated: true, user: response.data }, status: response.status, success: true };
    } catch {
      return { data: { authenticated: false }, status: 401, success: false };
    }
  }

  // Health endpoints
  async healthQuick(): Promise<ApiResponse<{ status: string; timestamp: string }>> {
    const response = await this.client.get('/api/v1/healthcheck/quick');
    return { data: response.data, status: response.status, success: true };
  }

  async healthFull(): Promise<ApiResponse<{
    status: string;
    layers: Record<string, unknown>;
    summary: { healthy_layers: number; total_layers: number };
  }>> {
    const response = await this.client.get('/api/v1/healthcheck/');
    return { data: response.data, status: response.status, success: true };
  }

  async healthMcp(): Promise<ApiResponse<{
    status: string;
    mcp_enabled: boolean;
    agents: { total_agents: number };
  }>> {
    const response = await this.client.get('/api/v1/healthcheck/mcp');
    return { data: response.data, status: response.status, success: true };
  }

  // Integration endpoints
  async integrationsCatalog(): Promise<ApiResponse<{
    internal_apis: Record<string, unknown>;
    mcp_tools: Record<string, unknown>;
    external_integrations: Record<string, unknown>;
  }>> {
    const response = await this.client.get('/api/v1/vibe/integrations/catalog');
    return { data: response.data, status: response.status, success: true };
  }

  async integrationsList(status?: string): Promise<ApiResponse<{
    integrations: Array<{
      id: string;
      name: string;
      description: string;
      integration_type: string;
      status: string;
      created_at: string;
    }>;
    total: number;
  }>> {
    const params = status ? { status } : {};
    const response = await this.client.get('/api/v1/vibe/integrations/', { params });
    return { data: response.data, status: response.status, success: true };
  }

  async integrationsHealth(): Promise<ApiResponse<{
    healthy: boolean;
    can_proceed: boolean;
    checks: Record<string, { status: string; message: string }>;
    warnings: string[];
  }>> {
    const response = await this.client.get('/api/v1/vibe/integrations/health');
    return { data: response.data, status: response.status, success: true };
  }

  async integrationsGenerate(params: {
    name: string;
    description: string;
    integration_type: string;
    method?: string;
    endpoint?: string;
    tool_name?: string;
    provider?: string;
  }): Promise<ApiResponse<{
    success: boolean;
    integration: { id: string; name: string; status: string };
    code_preview: string;
  }>> {
    const response = await this.client.post('/api/v1/vibe/integrations/generate', params);
    return { data: response.data, status: response.status, success: true };
  }

  async integrationsValidate(integrationId: string): Promise<ApiResponse<{
    valid: boolean;
    issues: Array<{ severity: string; code: string; message: string }>;
    blocking_issues_count: number;
  }>> {
    const response = await this.client.post(`/api/v1/vibe/integrations/validate/${integrationId}`);
    return { data: response.data, status: response.status, success: true };
  }

  async integrationsTest(integrationId: string, testParams?: Record<string, unknown>): Promise<ApiResponse<{
    success: boolean;
    message: string;
    status: string;
  }>> {
    const response = await this.client.post(`/api/v1/vibe/integrations/test/${integrationId}`, {
      test_params: testParams || {},
    });
    return { data: response.data, status: response.status, success: true };
  }

  async integrationsDeploy(integrationId: string): Promise<ApiResponse<{
    success: boolean;
    integration_id: string;
    status: string;
    deployed_at: string;
  }>> {
    const response = await this.client.post(`/api/v1/vibe/integrations/deploy/${integrationId}`);
    return { data: response.data, status: response.status, success: true };
  }

  async integrationsDisable(integrationId: string, reason?: string): Promise<ApiResponse<{
    success: boolean;
    status: string;
  }>> {
    const response = await this.client.post(`/api/v1/vibe/integrations/disable/${integrationId}`, { reason });
    return { data: response.data, status: response.status, success: true };
  }

  async integrationsRollback(integrationId: string, reason?: string): Promise<ApiResponse<{
    success: boolean;
    status: string;
  }>> {
    const response = await this.client.post(`/api/v1/vibe/integrations/rollback/${integrationId}`, { reason });
    return { data: response.data, status: response.status, success: true };
  }

  async integrationsLogs(integrationId: string, limit = 100): Promise<ApiResponse<{
    logs: Array<{
      id: string;
      action: string;
      success: boolean;
      created_at: string;
    }>;
    total: number;
  }>> {
    const response = await this.client.get(`/api/v1/vibe/integrations/${integrationId}/logs`, {
      params: { limit },
    });
    return { data: response.data, status: response.status, success: true };
  }

  // Vibe endpoints
  async vibeAnalyze(prompt: string): Promise<ApiResponse<{
    intent: { action: string; entity_type: string };
    parsed: Record<string, unknown>;
    safety_check: { passed: boolean; blocked: boolean };
    preview_id?: string;
  }>> {
    const response = await this.client.post('/api/v1/vibe/analyze', { prompt });
    return { data: response.data, status: response.status, success: true };
  }

  async vibeApply(previewId: string): Promise<ApiResponse<{
    success: boolean;
    message: string;
    entity_id?: number;
  }>> {
    const response = await this.client.post('/api/v1/vibe/apply', {
      preview_id: previewId,
      confirm: true,
    });
    return { data: response.data, status: response.status, success: true };
  }

  // Company info
  async companyInfo(): Promise<ApiResponse<{ status: string; company: Record<string, unknown> }>> {
    const response = await this.client.post('/api/v1/rpc/Company/info', {
      query: { id: config.companyId },
    });
    return { data: response.data, status: response.status, success: true };
  }

  // KB endpoints (via REST API)
  async kbSearch(query: string, limit = 20): Promise<ApiResponse<{ results: unknown[]; total: number }>> {
    const response = await this.client.get('/api/v1/kb/company', {
      params: { search: query, limit },
    });
    const data = response.data as any;
    return {
      data: { results: data.entries || data.items || [], total: data.total || 0 },
      status: response.status,
      success: true,
    };
  }

  async kbCreate(params: {
    title: string;
    content: string;
    category?: string;
  }): Promise<ApiResponse<{ success: boolean; id?: number }>> {
    const response = await this.client.post('/api/v1/kb/company', params);
    const data = response.data as any;
    return { data: { success: true, id: data.id, ...data }, status: response.status, success: true };
  }

  async kbUpdate(id: number, params: {
    title?: string;
    content?: string;
    category?: string;
  }): Promise<ApiResponse<{ success: boolean }>> {
    const response = await this.client.put(`/api/v1/kb/company/${id}`, params);
    return { data: { success: true, ...response.data as any }, status: response.status, success: true };
  }

  async kbDelete(id: number): Promise<ApiResponse<{ success: boolean }>> {
    const response = await this.client.delete(`/api/v1/kb/company/${id}`);
    return { data: { success: true, ...response.data as any }, status: response.status, success: true };
  }

  // CMS Pages
  async pagesList(params?: { site_id?: number; page_type?: string }): Promise<ApiResponse<{ pages: unknown[]; total: number }>> {
    const response = await this.client.get('/api/v1/cms/pages', { params });
    return { data: response.data, status: response.status, success: true };
  }

  async pagesPublish(pageId: number): Promise<ApiResponse<{ success: boolean }>> {
    const response = await this.client.post(`/api/v1/cms/pages/${pageId}/publish`);
    return { data: response.data, status: response.status, success: true };
  }

  async pagesUnpublish(pageId: number): Promise<ApiResponse<{ success: boolean }>> {
    const response = await this.client.post(`/api/v1/cms/pages/${pageId}/unpublish`);
    return { data: response.data, status: response.status, success: true };
  }

  // Services
  async servicesList(): Promise<ApiResponse<{ items: unknown[]; total: number }>> {
    const companyId = config.companyId;
    const response = await this.client.get(`/api/v1/cms/public/services`, {
      params: { company_id: companyId },
    });
    return { data: response.data, status: response.status, success: true };
  }

  // Products
  async productsList(params?: { category?: string; featured_only?: boolean }): Promise<ApiResponse<{ items: unknown[]; total: number }>> {
    const companyId = config.companyId;
    const response = await this.client.get(`/api/v1/cms/public/products`, {
      params: { company_id: companyId, ...params },
    });
    return { data: response.data, status: response.status, success: true };
  }

  // Website settings update
  async updateWebsiteSettings(settings: Record<string, unknown>): Promise<ApiResponse<unknown>> {
    const companyId = config.companyId;
    const response = await this.client.patch(`/api/v1/companies/${companyId}`, {
      website_settings: settings,
    });
    return { data: response.data, status: response.status, success: true };
  }

  // Single page (full detail with layout_json)
  async pageGet(pageId: number): Promise<ApiResponse<Record<string, unknown>>> {
    const response = await this.client.get(`/api/v1/cms/pages/${pageId}`);
    return { data: response.data, status: response.status, success: true };
  }

  // Update page
  async pageUpdate(pageId: number, data: Record<string, unknown>): Promise<ApiResponse<Record<string, unknown>>> {
    const response = await this.client.patch(`/api/v1/cms/pages/${pageId}`, data);
    return { data: response.data, status: response.status, success: true };
  }

  // Create page
  async pageCreate(data: Record<string, unknown>): Promise<ApiResponse<Record<string, unknown>>> {
    const response = await this.client.post(`/api/v1/cms/pages`, data);
    return { data: response.data, status: response.status, success: true };
  }

  // AI Chat (talk to agents)
  async agentChat(message: string, agentName = 'sarah'): Promise<ApiResponse<{ response: string }>> {
    const response = await this.client.post('/api/v1/chat/', {
      message,
      agent: agentName,
    });
    return { data: response.data, status: response.status, success: true };
  }

  // Templates (solid clone)
  async templatesList(): Promise<ApiResponse<{ templates: unknown[]; total: number }>> {
    const response = await this.client.get('/api/v1/cli/templates/');
    return { data: response.data, status: response.status, success: true };
  }

  async templatePreview(name: string): Promise<ApiResponse<Record<string, unknown>>> {
    const response = await this.client.get(`/api/v1/cli/templates/${name}`);
    return { data: response.data, status: response.status, success: true };
  }

  async templateClone(name: string): Promise<ApiResponse<{
    success: boolean;
    template: string;
    display_name: string;
    created: { kb_entries: number; pages?: number; services?: number };
  }>> {
    const response = await this.client.post(`/api/v1/cli/templates/${name}/clone`);
    return { data: response.data, status: response.status, success: true };
  }

  // Multi-company (CLI Agency)
  async companiesList(): Promise<ApiResponse<{
    companies: Array<{ id: number; name: string; role: string; is_active: boolean; joined_at?: string }>;
    active_company_id: number;
    count: number;
  }>> {
    const response = await this.client.get('/api/v1/cli/companies/');
    return { data: response.data, status: response.status, success: true };
  }

  async companyCreate(name: string, template?: string, industry?: string): Promise<ApiResponse<{
    status: string;
    company: { id: number; name: string; slug: string };
    membership: { role: string };
    template?: unknown;
  }>> {
    const response = await this.client.post('/api/v1/cli/companies/', { name, template, industry });
    return { data: response.data, status: response.status, success: true };
  }

  async companySwitch(companyId: number): Promise<ApiResponse<{
    status: string;
    company: { id: number; name: string };
    role: string;
    access_token: string;
    refresh_token: string;
    expires_in: number;
  }>> {
    const response = await this.client.post(`/api/v1/cli/companies/${companyId}/switch`);
    return { data: response.data, status: response.status, success: true };
  }

  async companyMembers(companyId: number): Promise<ApiResponse<{
    company_id: number;
    members: Array<{ user_id: number; email: string; name?: string; role: string; joined_at?: string }>;
    count: number;
  }>> {
    const response = await this.client.get(`/api/v1/cli/companies/${companyId}/members`);
    return { data: response.data, status: response.status, success: true };
  }

  async companyMemberRevoke(companyId: number, userId: number): Promise<ApiResponse<{
    status: string;
    message: string;
    company_id: number;
    user_id: number;
  }>> {
    const response = await this.client.delete(`/api/v1/cli/companies/${companyId}/members/${userId}`);
    return { data: response.data, status: response.status, success: true };
  }

  async companyInvite(companyId: number, email: string, role = 'developer'): Promise<ApiResponse<{
    status: string;
    message: string;
    token?: string;
  }>> {
    const response = await this.client.post(`/api/v1/cli/companies/${companyId}/invite`, { email, role });
    return { data: response.data, status: response.status, success: true };
  }

  // CLI API Keys
  async apiKeyCreate(name: string, scopes: string[], expiresInDays?: number): Promise<ApiResponse<{
    status: string;
    key: string;
    warning: string;
    api_key: { id: number; name: string; key_prefix: string; scopes: string[] };
  }>> {
    const response = await this.client.post('/api/v1/cli/api-keys/', {
      name,
      scopes,
      expires_in_days: expiresInDays,
    });
    return { data: response.data, status: response.status, success: true };
  }

  async apiKeyList(): Promise<ApiResponse<{
    api_keys: Array<{ id: number; name: string; key_prefix: string; scopes: string[]; is_active: boolean; last_used_at?: string }>;
    count: number;
    available_scopes: string[];
  }>> {
    const response = await this.client.get('/api/v1/cli/api-keys/');
    return { data: response.data, status: response.status, success: true };
  }

  async apiKeyRevoke(keyId: number): Promise<ApiResponse<{ status: string; id: number }>> {
    const response = await this.client.delete(`/api/v1/cli/api-keys/${keyId}`);
    return { data: response.data, status: response.status, success: true };
  }

  // Agent consciousness endpoints
  async agentsList(): Promise<ApiResponse<{
    agents: Array<{
      agent_type: string;
      name: string;
      description: string;
      autonomy_level: number;
      tool_count: number;
    }>;
    total: number;
  }>> {
    const response = await this.client.get('/api/v1/cli/agents');
    return { data: response.data, status: response.status, success: true };
  }

  async agentDetail(agentType: string): Promise<ApiResponse<{
    agent_type: string;
    name: string;
    description: string;
    autonomy_level: number;
    system_prompt: string;
    features: Record<string, boolean>;
    approval_thresholds: Record<string, number>;
    tools: string[];
  }>> {
    const response = await this.client.get(`/api/v1/cli/agents/${agentType}`);
    return { data: response.data, status: response.status, success: true };
  }

  async agentTools(agentType: string): Promise<ApiResponse<{
    agent_type: string;
    tools: Record<string, string[]>;
    total: number;
  }>> {
    const response = await this.client.get(`/api/v1/cli/agents/${agentType}/tools`);
    return { data: response.data, status: response.status, success: true };
  }

  async agentData(agentType: string): Promise<ApiResponse<{
    agent_type: string;
    performance: {
      total_reflections: number;
      avg_score: number;
      pass_rate: number;
    };
    reflections: Array<{
      id: number;
      score: number;
      passed: boolean;
      notes: string;
      criteria_scores: Record<string, number>;
      tools_used: string[];
      created_at: string;
    }>;
  }>> {
    const response = await this.client.get(`/api/v1/cli/agents/${agentType}/data`);
    return { data: response.data, status: response.status, success: true };
  }

  async orchestrationDashboard(): Promise<ApiResponse<{
    agents: Array<{
      id: number;
      name: string;
      agent_type: string;
      status: string;
      current_task_id: string | null;
      last_active: string | null;
      tasks_today: number;
    }>;
    active_tasks: number;
    total_agents: number;
  }>> {
    const response = await this.client.get('/api/orchestration/dashboard');
    return { data: response.data, status: response.status, success: true };
  }

  async orchestrationAgents(statusFilter?: string): Promise<ApiResponse<{
    agents: Array<{
      id: number;
      name: string;
      agent_type: string;
      status: string;
      last_active: string | null;
      tasks_today: number;
      tasks_failed_today: number;
    }>;
  }>> {
    const params = statusFilter ? { status_filter: statusFilter } : {};
    const response = await this.client.get('/api/orchestration/agents', { params });
    return { data: response.data, status: response.status, success: true };
  }

  async orchestrationAgentDetail(agentId: number): Promise<ApiResponse<{
    agent: {
      name: string;
      role: string;
      status: string;
      current_task_id: string | null;
      last_active: string;
      tasks_today: number;
      avg_response_time: number;
      total_tasks: number;
      performance_30d: {
        total_tasks: number;
        completed: number;
        failed: number;
        success_rate: number;
        avg_response_time: number;
      };
    };
  }>> {
    const response = await this.client.get(`/api/orchestration/agents/${agentId}`);
    return { data: response.data, status: response.status, success: true };
  }

  async orchestrationDelegate(agentId: number, task: string, priority?: number): Promise<ApiResponse<{
    task_id: string;
    status: string;
    agent_id: number;
  }>> {
    const response = await this.client.post('/api/orchestration/delegate', {
      agent_id: agentId,
      task,
      priority: priority || 5,
    });
    return { data: response.data, status: response.status, success: true };
  }

  async orchestrationAnalytics(days?: number): Promise<ApiResponse<{
    period_days: number;
    total_tasks: number;
    completed: number;
    failed: number;
    success_rate: number;
    avg_response_time: number;
    top_agents: Array<{ name: string; tasks: number; success_rate: number }>;
  }>> {
    const params = days ? { days } : {};
    const response = await this.client.get('/api/orchestration/analytics', { params });
    return { data: response.data, status: response.status, success: true };
  }

  // Dragon — Mission orchestration
  async missionCreate(mission: string, agentIds?: number[]): Promise<ApiResponse<{
    mission_id: string;
    status: string;
    steps: Array<{
      step_index: number;
      agent_id: number;
      agent_name: string;
      task: string;
      status: string;
    }>;
    conversation_id: string;
  }>> {
    const body: Record<string, unknown> = { mission };
    if (agentIds && agentIds.length > 0) body.agent_ids = agentIds;
    const response = await this.client.post('/api/v1/agents/missions', body);
    return { data: response.data, status: response.status, success: true };
  }

  async missionExecute(missionId: string): Promise<ApiResponse<{
    status: string;
    mission_id: string;
    steps_dispatched: number;
    results: Array<{
      step_index: number;
      agent_name: string;
      status: string;
      response?: string;
    }>;
  }>> {
    const response = await this.client.post(`/api/v1/agents/missions/${missionId}/execute`);
    return { data: response.data, status: response.status, success: true };
  }

  // Dragon — Telemetry
  async telemetrySummary(): Promise<ApiResponse<{
    total_tokens: number;
    avg_latency_ms: number;
    estimated_cost: number;
    revenue_attributed: number;
    active_agents: number;
    missions_active: number;
  }>> {
    const response = await this.client.get('/api/v1/telemetry/agents/summary');
    return { data: response.data, status: response.status, success: true };
  }
}

export const apiClient = new ApiClient();

export function handleApiError(error: unknown): ApiError {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<{ detail?: string; message?: string }>;
    return {
      message: axiosError.response?.data?.detail || axiosError.response?.data?.message || axiosError.message,
      status: axiosError.response?.status || 500,
    };
  }
  return {
    message: error instanceof Error ? error.message : 'Unknown error',
    status: 500,
  };
}
