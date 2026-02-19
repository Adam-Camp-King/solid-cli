/**
 * Configuration management for Solid CLI
 * Uses a simple JSON file at ~/.solid/config.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface SolidConfig {
  api_url: string;
  company_id?: number;
  environment: 'production' | 'sandbox' | 'development';
  access_token?: string;
  refresh_token?: string;
  token_expires_at?: string;
  user_id?: number;
  user_email?: string;
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
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  get apiUrl(): string {
    return this.data.api_url;
  }

  set apiUrl(url: string) {
    this.data.api_url = url;
    this.save();
  }

  get companyId(): number | undefined {
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

  isLoggedIn(): boolean {
    const token = this.accessToken;
    const expires = this.tokenExpiresAt;

    if (!token) return false;
    if (expires && expires < new Date()) return false;

    return true;
  }

  logout(): void {
    delete this.data.access_token;
    delete this.data.refresh_token;
    delete this.data.token_expires_at;
    delete this.data.user_id;
    delete this.data.user_email;
    delete this.data.company_id;
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
