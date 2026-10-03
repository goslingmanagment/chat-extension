// Session tokens, in the role of ChatSpace's session provider: a short-lived
// token cached ~55 s, refreshed on demand with `skipCache` (the 401 path).

import { record } from '../journal';
import { NATIVE_REQUEST_HEADER, STAND_TOKEN_PATH } from '../protocol';

const CACHE_MS = 55_000;

let cached: { token: string; at: number } | null = null;
let userId: string | null = null;
let inFlight: Promise<string | null> | null = null;

async function issue(): Promise<string | null> {
  const response = await globalThis.fetch(STAND_TOKEN_PATH, { method: 'POST', headers: { [NATIVE_REQUEST_HEADER]: 'auth' } });
  if (!response.ok) return null;
  const body = (await response.json()) as { token?: unknown; userId?: unknown };
  if (typeof body.token !== 'string') return null;
  if (typeof body.userId === 'string') userId = body.userId;
  cached = { token: body.token, at: Date.now() };
  return body.token;
}

export async function getToken(options: { readonly skipCache?: boolean } = {}): Promise<string | null> {
  if (options.skipCache !== true && cached !== null && Date.now() - cached.at < CACHE_MS) return cached.token;
  if (options.skipCache === true) record('auth-refresh');
  inFlight ??= issue().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** The signed-in OnlyMonster user id (synthetic); known after the first token. */
export function currentUserId(): string {
  return userId ?? 'anonymous';
}
