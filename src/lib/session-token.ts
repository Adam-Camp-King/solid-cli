/**
 * Adopt an access token issued OUTSIDE `solid auth login` — today, the
 * `auth_token` returned by `POST /api/v1/onboarding-v2/provision` — as the
 * CLI's session, storing the same fields `solid auth login --token` stores
 * (`accessToken`, `userId`, `userEmail`, `companyId`).
 *
 * Differences from `login --token`, both deliberate:
 *   • Any previous refresh token, expiry and cached company list are CLEARED.
 *     They belong to the previous account; a leftover refresh token would
 *     silently refresh the session back into it.
 *   • The identity the backend just returned (company_id, user_id, email) is
 *     stored even if `/auth/me` cannot confirm it right now, because an env
 *     credential (SOLID_API_KEY / SOLID_TOKEN) outranks the cached token and
 *     would answer `/auth/me` as someone else. The caller is told which.
 */

import { config } from './config';
import { apiClient } from './api-client';

export interface AdoptIdentity {
  companyId?: number | null;
  userId?: number | null;
  email?: string | null;
}

export type AdoptResult =
  | { stored: true; confirmed: true; companyId?: number; userId?: number; email?: string }
  | { stored: true; confirmed: false; reason: 'env_credential_overrides' | 'auth_me_failed'; companyId?: number; userId?: number; email?: string };

export function envCredentialPresent(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.SOLID_API_KEY || env.SOLID_TOKEN);
}

export async function adoptSessionToken(token: string, identity: AdoptIdentity = {}): Promise<AdoptResult> {
  config.accessToken = token;
  config.refreshToken = undefined;
  config.tokenExpiresAt = undefined;
  config.companies = undefined;
  // Always overwrite: the previous account's identity must not linger.
  config.userId = identity.userId ?? undefined;
  config.userEmail = identity.email ?? undefined;
  config.companyId = identity.companyId ?? undefined;

  const base = {
    companyId: identity.companyId ?? undefined,
    userId: identity.userId ?? undefined,
    email: identity.email ?? undefined,
  };

  if (envCredentialPresent()) {
    return { stored: true, confirmed: false, reason: 'env_credential_overrides', ...base };
  }
  try {
    const status = await apiClient.authStatus();
    if (status.data.authenticated && status.data.user) {
      config.userId = status.data.user.id;
      config.userEmail = status.data.user.email;
      config.companyId = status.data.user.company_id;
      return {
        stored: true,
        confirmed: true,
        companyId: status.data.user.company_id,
        userId: status.data.user.id,
        email: status.data.user.email,
      };
    }
  } catch {
    // fall through — the token is stored; the caller reports it unconfirmed
  }
  return { stored: true, confirmed: false, reason: 'auth_me_failed', ...base };
}
