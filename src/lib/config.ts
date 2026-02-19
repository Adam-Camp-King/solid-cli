/**
 * Configuration management for Solid CLI
 */

import Conf from 'conf';
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

const configSchema = {
  api_url: {
    type: 'string' as const,
    default: 'https://api.solidnumber.com',
  },
  company_id: {
    type: 'number' as const,
  },
  environment: {
    type: 'string' as const,
    default: 'production',
  },
  access_token: {
    type: 'string' as const,
  },
  refresh_token: {
    type: 'string' as const,
  },
  token_expires_at: {
    type: 'string' as const,
  },
  user_id: {
    type: 'number' as const,
  },
  user_email: {
    type: 'string' as const,
  },
};

class ConfigManager {
  private config: Conf<SolidConfig>;

  constructor() {
    this.config = new Conf<SolidConfig>({
      projectName: 'solid-cli',
      schema: configSchema,
      cwd: path.join(os.homedir(), '.solid'),
    });
  }

  get apiUrl(): string {
    return this.config.get('api_url', 'https://api.solidnumber.com');
  }

  set apiUrl(url: string) {
    this.config.set('api_url', url);
  }

  get companyId(): number | undefined {
    return this.config.get('company_id');
  }

  set companyId(id: number | undefined) {
    if (id) {
      this.config.set('company_id', id);
    } else {
      this.config.delete('company_id');
    }
  }

  get environment(): string {
    return this.config.get('environment', 'production');
  }

  set environment(env: 'production' | 'sandbox' | 'development') {
    this.config.set('environment', env);
  }

  get accessToken(): string | undefined {
    return this.config.get('access_token');
  }

  set accessToken(token: string | undefined) {
    if (token) {
      this.config.set('access_token', token);
    } else {
      this.config.delete('access_token');
    }
  }

  get refreshToken(): string | undefined {
    return this.config.get('refresh_token');
  }

  set refreshToken(token: string | undefined) {
    if (token) {
      this.config.set('refresh_token', token);
    } else {
      this.config.delete('refresh_token');
    }
  }

  get tokenExpiresAt(): Date | undefined {
    const expires = this.config.get('token_expires_at');
    return expires ? new Date(expires) : undefined;
  }

  set tokenExpiresAt(date: Date | undefined) {
    if (date) {
      this.config.set('token_expires_at', date.toISOString());
    } else {
      this.config.delete('token_expires_at');
    }
  }

  get userId(): number | undefined {
    return this.config.get('user_id');
  }

  set userId(id: number | undefined) {
    if (id) {
      this.config.set('user_id', id);
    } else {
      this.config.delete('user_id');
    }
  }

  get userEmail(): string | undefined {
    return this.config.get('user_email');
  }

  set userEmail(email: string | undefined) {
    if (email) {
      this.config.set('user_email', email);
    } else {
      this.config.delete('user_email');
    }
  }

  isLoggedIn(): boolean {
    const token = this.accessToken;
    const expires = this.tokenExpiresAt;

    if (!token) return false;
    if (expires && expires < new Date()) return false;

    return true;
  }

  logout(): void {
    this.config.delete('access_token');
    this.config.delete('refresh_token');
    this.config.delete('token_expires_at');
    this.config.delete('user_id');
    this.config.delete('user_email');
    this.config.delete('company_id');
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
    this.config.clear();
  }
}

export const config = new ConfigManager();
