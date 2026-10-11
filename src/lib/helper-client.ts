/**
 * The helper's line to the platform: enrol this machine, hear requests, answer them.
 *
 * It only DIALS OUT. Nothing here listens on the machine's network. The machine's
 * token is kept in ~/.solid/helper.json, readable by this user only, and is separate
 * from a signed-in CLI: a helper on a customer's computer holds no company login.
 *
 * `fetch` and the socket are handed in, so the client is testable with neither.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type HelperIdentity = { api_url: string; token: string; endpoint_id: number; name: string };
type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export const HELPER_FILE = path.join(os.homedir(), '.solid', 'helper.json');

export function loadIdentity(file: string = HELPER_FILE): HelperIdentity | null {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return typeof data?.token === 'string' && data.token.length >= 32 && typeof data?.api_url === 'string' ? data : null;
  } catch {
    return null;
  }
}

export function saveIdentity(identity: HelperIdentity, file: string = HELPER_FILE): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(identity, null, 2), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

export function forgetIdentity(file: string = HELPER_FILE): boolean {
  try { fs.unlinkSync(file); return true; } catch { return false; }
}

/** PURE. Where the helper's socket connects, from the API's address. */
export function socketUrl(apiUrl: string, token: string): string {
  return `${apiUrl.replace(/\/+$/, '').replace(/^http/, 'ws')}/api/v1/remote/helper/connect?token=${encodeURIComponent(token)}`;
}

export class HelperClient {
  constructor(private readonly apiUrl: string, private readonly fetcher: Fetch = fetch as unknown as Fetch) {}

  private async post(pathname: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
    try {
      const res = await this.fetcher(`${this.apiUrl.replace(/\/+$/, '')}/api/v1/remote/helper/${pathname}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      let data: unknown = {};
      try { data = await res.json(); } catch { /* an empty answer */ }
      return { ok: res.ok, status: res.status, data: (data && typeof data === 'object' ? data : {}) as Record<string, unknown> };
    } catch {
      return { ok: false, status: 0, data: {} };
    }
  }

  /** Spend a one-use code: this machine becomes an endpoint and is handed its token. */
  async enrol(code: string, platform: string | null, version: string): Promise<HelperIdentity | null> {
    const out = await this.post('enrol', { code, platform, version });
    const { token, endpoint_id, name } = out.data as { token?: unknown; endpoint_id?: unknown; name?: unknown };
    if (!out.ok || typeof token !== 'string' || typeof endpoint_id !== 'number') return null;
    return { api_url: this.apiUrl, token, endpoint_id, name: typeof name === 'string' ? name : '' };
  }

  /** The person typed the session's code here. The grant's id, or null. */
  async approve(token: string, code: string): Promise<number | null> {
    const out = await this.post('approve', { token, code });
    const id = (out.data as { grant_id?: unknown }).grant_id;
    return out.ok && typeof id === 'number' ? id : null;
  }

  async stop(token: string): Promise<boolean> {
    return (await this.post('stop', { token })).ok;
  }

  async answer(token: string, rid: string, result: Record<string, unknown>): Promise<boolean> {
    return (await this.post('result', { token, rid, result })).ok;
  }
}
