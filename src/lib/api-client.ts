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
      const token = config.accessToken;
      if (token) {
        requestConfig.headers.Authorization = `Bearer ${token}`;
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

  // KB endpoints (via MCP tools)
  async kbSearch(query: string, limit = 20): Promise<ApiResponse<{ results: unknown[]; total: number }>> {
    const response = await this.client.post('/mcp/tools/kb.search', { query, limit });
    return { data: response.data, status: response.status, success: true };
  }

  async kbCreate(params: {
    title: string;
    content: string;
    category?: string;
  }): Promise<ApiResponse<{ success: boolean; id?: number }>> {
    const response = await this.client.post('/mcp/tools/kb.create', params);
    return { data: response.data, status: response.status, success: true };
  }

  async kbUpdate(id: number, params: {
    title?: string;
    content?: string;
    category?: string;
  }): Promise<ApiResponse<{ success: boolean }>> {
    const response = await this.client.post('/mcp/tools/kb.update', { id, ...params });
    return { data: response.data, status: response.status, success: true };
  }

  async kbDelete(id: number): Promise<ApiResponse<{ success: boolean }>> {
    const response = await this.client.post('/mcp/tools/kb.delete', { id });
    return { data: response.data, status: response.status, success: true };
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
