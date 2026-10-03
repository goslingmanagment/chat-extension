// Session tokens, in the role of ChatSpace's session provider: a short-lived
// token cached ~55 s, refreshed on demand with `skipCache` (the 401 path); the
// session also says whether the user owns the organisation (owners send even
// when their role has of_block_message_sending) and whether they are signed in.

import { shallowRef } from 'vue';

import { env } from '../env';
import { record } from '../journal';
import { NATIVE_REQUEST_HEADER, STAND_TOKEN_PATH } from '../protocol';

const CACHE_MS = 55_000;

/** The signed-in user owns the organisation (from the session, like ChatSpace's permission bits). */
export const isOwner = shallowRef(false);
/** Signed in; a sign-out flips it (the send queue resets, the socket closes). */
export const isSignedIn = shallowRef(true);

let cached: { token: string; at: number } | null = null;
let userId: string | null = null;
let inFlight: Promise<string | null> | null = null;
let issued = 0;

async function issue(): Promise<string | null> {
  issued += 1;
  const response = await globalThis.fetch(STAND_TOKEN_PATH, { method: 'POST', headers: { [NATIVE_REQUEST_HEADER]: `${env.bootId}.auth${issued}` } });
  if (!response.ok) return null;
  const body = (await response.json()) as { token?: unknown; userId?: unknown; owner?: unknown };
  if (typeof body.token !== 'string') return null;
  if (typeof body.userId === 'string') userId = body.userId;
  isOwner.value = body.owner === true;
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
