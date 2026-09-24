/**
 * Atlas addresses — what the CLI accepts as one, and what it says when the
 * backend reports that one has been retired.
 *
 * An address is 1 to 3 digits: a class (5), a domain or legacy division (53),
 * or a curated noun (531). The backend resolves them exactly at
 * `GET /api/v1/agent/verbs/address/{address}` and applies the same 1–3 digit
 * rule there (solid-backend/controllers/agent_verb_index.py::resolve_address).
 *
 * ⛔ Inside a CURATED class a two-digit address no longer names a noun — its
 * nouns moved to three digits. The backend answers those with
 * `410 {error: "address_retired", candidates: [...]}` so that an agent holding
 * a cached address is told, instead of being served another noun's verbs under
 * the same digits. This module turns that body into the CLI's error envelope.
 */

/** 1 to 3 digits. The one definition — every caller that parses an address uses it. */
export const ATLAS_ADDRESS_RE = /^[0-9]{1,3}$/;

export function isAtlasAddress(value: string): boolean {
  return ATLAS_ADDRESS_RE.test(value);
}

export const ATLAS_ADDRESS_ENDPOINT = '/api/v1/agent/verbs/address';

export interface AtlasCandidate {
  address: string;
  noun?: string | null;
  title?: string | null;
}

/** The 410 body, as the backend sends it. Every field but `error` is optional here. */
export interface RetiredAddressBody {
  error: 'address_retired';
  address?: string;
  message?: string;
  was?: string[];
  candidates?: AtlasCandidate[];
  now_a_prefix_for?: {
    domain?: string;
    nouns?: Array<{ address: string; noun?: string | null; title?: string | null }>;
  } | null;
}

export function isRetiredAddressResponse(
  status: number | undefined,
  data: unknown,
): data is RetiredAddressBody {
  return (
    status === 410 &&
    typeof data === 'object' &&
    data !== null &&
    (data as { error?: unknown }).error === 'address_retired'
  );
}

export interface RetiredAddressEnvelope {
  error: {
    code: 'BAD_REQUEST';
    status: 410;
    message: string;
    retryable: false;
    reason: 'address_retired';
    address: string;
    /** Runnable commands, one per candidate address. */
    did_you_mean: string[];
    /** The candidates verbatim — address, noun and title — so a caller can choose. */
    candidates: AtlasCandidate[];
    was?: string[];
    fix: string;
  };
}

/**
 * Build the error envelope for a retired address. Pure.
 *
 * Candidates are the nouns that replaced what the address used to hold. When
 * the backend has no retirement record for it, the nouns that now live under
 * it as a prefix are offered instead — those are real addresses too.
 *
 * `fix` is a real command: the one candidate when there is exactly one,
 * otherwise `solid map`. Picking the first of several would be a guess, and an
 * agent runs the fix.
 */
export function retiredAddressEnvelope(address: string, body: RetiredAddressBody): RetiredAddressEnvelope {
  let candidates: AtlasCandidate[] = (body.candidates || []).filter((c) => c && c.address);
  if (!candidates.length && body.now_a_prefix_for?.nouns?.length) {
    candidates = body.now_a_prefix_for.nouns.map((n) => ({
      address: n.address,
      noun: n.noun ?? null,
      title: n.title ?? null,
    }));
  }
  const didYouMean = candidates.map((c) => `solid verbs list ${c.address}`);
  return {
    error: {
      code: 'BAD_REQUEST',
      status: 410,
      message:
        body.message ||
        `${address} is no longer an Atlas address — its nouns have three-digit addresses.`,
      retryable: false,
      reason: 'address_retired',
      address: body.address || address,
      did_you_mean: didYouMean,
      candidates,
      ...(body.was && body.was.length ? { was: body.was } : {}),
      fix: didYouMean.length === 1 ? didYouMean[0] : 'solid map',
    },
  };
}
