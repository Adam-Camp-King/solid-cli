/**
 * Configuration management for Solid CLI
 * Uses a simple JSON file at ~/.solid/config.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface CompanyInfo {
  id: number;
  name: string;
  role: string;
}

interface SolidConfig {
  api_url: string;
  company_id?: number;
  environment: 'production' | 'sandbox' | 'development';
  access_token?: string;
  refresh_token?: string;
  token_expires_at?: string;
  user_id?: number;
  user_email?: string;
  companies?: CompanyInfo[];
}

const CONFIG_DIR = path.join(os.homedir(), '.solid');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

class ConfigManager {
  private data: SolidConfig;

  constructor() {
    this.data = this.load();
  }

  private load(): SolidConfig {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
        return { api_url: 'https://api.solidnumber.com', environment: 'production', ...JSON.parse(raw) };
      }
    } catch {
      // Corrupted config, reset
    }
    return { api_url: 'https://api.solidnumber.com', environment: 'production' };
  }

  private save(): void {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
    fs.chmodSync(CONFIG_FILE, 0o600);
  }

  get apiUrl(): string {
    return this.data.api_url;
  }

  set apiUrl(url: string) {
    this.data.api_url = url;
    this.save();
  }

  get companyId(): number | undefined {
    // Env pins take precedence over the cached config — mirrors the
    // auth-source precedence in isLoggedIn()/the request interceptor.
    // Both vars are part of the public surface and must actually work:
    //   1. SOLID_COMPANY_OVERRIDE — set by `solid ai --company <id>` for
    //      the editor session it launches
    //   2. SOLID_COMPANY_ID — the documented pin (tenant-warn hint,
    //      `solid mcp install --company` writes it into MCP configs)
    //   3. cached company from `solid auth login`
    for (const envVar of ['SOLID_COMPANY_OVERRIDE', 'SOLID_COMPANY_ID'] as const) {
      const raw = process.env[envVar];
      if (raw) {
        const id = parseInt(raw, 10);
        if (Number.isFinite(id) && id > 0) return id;
      }
    }
    return this.data.company_id;
  }

  set companyId(id: number | undefined) {
    if (id) {
      this.data.company_id = id;
    } else {
      delete this.data.company_id;
    }
    this.save();
  }

  get environment(): string {
    return this.data.environment;
  }

  set environment(env: 'production' | 'sandbox' | 'development') {
    this.data.environment = env;
    this.save();
  }

  get accessToken(): string | undefined {
    return this.data.access_token;
  }

  set accessToken(token: string | undefined) {
    if (token) {
      this.data.access_token = token;
    } else {
      delete this.data.access_token;
    }
    this.save();
  }

  get refreshToken(): string | undefined {
    return this.data.refresh_token;
  }

  set refreshToken(token: string | undefined) {
    if (token) {
      this.data.refresh_token = token;
    } else {
      delete this.data.refresh_token;
    }
    this.save();
  }

  get tokenExpiresAt(): Date | undefined {
    const expires = this.data.token_expires_at;
    return expires ? new Date(expires) : undefined;
  }

  set tokenExpiresAt(date: Date | undefined) {
    if (date) {
      this.data.token_expires_at = date.toISOString();
    } else {
      delete this.data.token_expires_at;
    }
    this.save();
  }

  get userId(): number | undefined {
    return this.data.user_id;
  }

  set userId(id: number | undefined) {
    if (id) {
      this.data.user_id = id;
    } else {
      delete this.data.user_id;
    }
    this.save();
  }

  get userEmail(): string | undefined {
    return this.data.user_email;
  }

  set userEmail(email: string | undefined) {
    if (email) {
      this.data.user_email = email;
    } else {
      delete this.data.user_email;
    }
    this.save();
  }

  get companies(): CompanyInfo[] | undefined {
    return this.data.companies;
  }

  set companies(list: CompanyInfo[] | undefined) {
    if (list && list.length > 0) {
      this.data.companies = list;
    } else {
      delete this.data.companies;
    }
    this.save();
  }

  isLoggedIn(): boolean {
    // BUG-6 fix (role drift): any of FIVE auth sources counts as
    // "logged in" — not just the cached JWT. Prior impl only saw the
    // JWT, so `SOLID_API_KEY=sk_... solid agent list` was refused with
    // "Not logged in" even though the backend would have happily
    // accepted the key. Makes the CLI consistent with what the api
    // interceptor actually sends (src/lib/api-client.ts:141).
    //
    // Precedence matches the request interceptor:
    //   1. --token flag (per-invocation)
    //   2. SOLID_API_KEY env (CI / AI agent)
    //   3. SOLID_TOKEN env (legacy)
    //   4. cached access_token (solid auth login)
    //   5. cached refresh_token (auto-refresh flow)
    if (process.env.SOLID_API_KEY) return true;
    if (process.env.SOLID_TOKEN) return true;
    const token = this.accessToken;
    const refresh = this.refreshToken;
    if (!token && !refresh) return false;
    return true;
  }

  logout(): void {
    delete this.data.access_token;
    delete this.data.refresh_token;
    delete this.data.token_expires_at;
    delete this.data.user_id;
    delete this.data.user_email;
    delete this.data.company_id;
    delete this.data.companies;
    this.save();
  }

  getAll(): Partial<SolidConfig> {
    return {
      api_url: this.apiUrl,
      company_id: this.companyId,
      environment: this.environment as SolidConfig['environment'],
      user_id: this.userId,
      user_email: this.userEmail,
    };
  }

  clear(): void {
    this.data = { api_url: 'https://api.solidnumber.com', environment: 'production' };
    this.save();
  }
}

export const config = new ConfigManager();
