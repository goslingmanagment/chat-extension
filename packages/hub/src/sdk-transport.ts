// The vendored @kernel/sdk path: operations the SDK already has. Every call
// goes through `client.raw` with the SDK's own method/path manifest and auth
// plumbing, then the answer is checked by the SDK's response schema first
// (HB-006: a wrong shape is a hub failure, not data) and by our contract
// mirror second. `raw` keeps what the typed methods drop: the status, the
// Retry-After header, the `reason` of an error body, and the H-3 `client`
// echo the SDK's sign-in schema strips. A per-call client binds the call's
// AbortSignal (the SDK's request path takes none).

import { HUB_ROUTE_SCHEMAS, HUB_ROUTES, type HubRouteKey } from '@cg/contracts';
import { createClient, kernelOperations, routeSchemas, type KernelClientOptions } from '@kernel/sdk';

import { type FetchLike } from './ports';

/** Contract routes the vendored SDK serves. */
export type SdkRouteKey = {
  [K in HubRouteKey]: (typeof HUB_ROUTES)[K]['since'] extends 'sdk' ? K : never;
}[HubRouteKey];

/**
 * SDK operations this client may call at all: the contract's SDK routes,
 * plus `pages` for the dev/compat bootstrap only. Anything else — `/ofapi/*`,
 * the event streams, full personas, the raw gateway — is refused before a
 * request exists (§8.1 «Никогда», AU-029).
 */
export const SDK_ALLOWED_OPERATIONS: readonly string[] = [
  ...(Object.keys(HUB_ROUTES) as HubRouteKey[]).filter((key) => HUB_ROUTES[key].since === 'sdk'),
  'pages',
];
export type SdkOperation = SdkRouteKey | 'pages';

export interface SdkCaller {
  readonly hubOrigin: string;
  /** null for the public routes (sign-in, health). */
  readonly token: string | null;
  readonly headers: Readonly<Record<string, string>>;
  readonly fetch: FetchLike;
  readonly signal: AbortSignal;
  readonly onAuthError?: KernelClientOptions['onAuthError'];
}

export interface SdkRawInput {
  readonly params?: Record<string, string | number>;
  readonly query?: Record<string, unknown>;
  readonly body?: unknown;
}

export function sdkOptions(caller: SdkCaller): KernelClientOptions {
  const { token } = caller;
  const fetchWithSignal = ((input: string | URL | Request, init?: RequestInit) =>
    caller.fetch(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, { ...init, signal: caller.signal })) as typeof fetch;
  return {
    baseUrl: caller.hubOrigin,
    ...(token === null ? {} : { auth: { mode: 'bearer' as const, token: () => token } }),
    headers: { ...caller.headers },
    fetch: fetchWithSignal,
    ...(caller.onAuthError === undefined ? {} : { onAuthError: caller.onAuthError }),
  };
}

/** A colon inside a path segment (`/api/v2/spenders:batch`) is literal, not a `:param`. */
const LITERAL_COLON = /[^/]:[A-Za-z]/;

/**
 * The SDK's own path builder reads every `:word` as a parameter, so the
 * manifest path `/api/v2/spenders:batch` throws «missing path param» there
 * (the vendored SDK cannot call `spenderBatch` at all). Such a path goes out
 * with the same manifest method, auth and headers, its `/:param` segments
 * filled and its literal colon kept.
 */
async function sendLiteralPath(caller: SdkCaller, operation: SdkOperation, input: SdkRawInput): Promise<Response> {
  const def = kernelOperations[operation];
  const path = def.path.replace(/\/:([A-Za-z0-9_]+)/g, (_match, name: string) => {
    const value = input.params?.[name];
    if (value === undefined) throw new TypeError(`${operation}: missing path param ${name}`);
    return `/${encodeURIComponent(String(value))}`;
  });
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') throw new TypeError(`${operation}: query field ${key} is not a scalar`);
    search.append(key, String(value));
  }
  const query = search.toString();
  const headers: Record<string, string> = { ...caller.headers };
  if (caller.token !== null) headers['authorization'] = `Bearer ${caller.token}`;
  const init: RequestInit = { method: def.method, headers, signal: caller.signal };
  if (input.body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(input.body);
  }
  return caller.fetch(`${caller.hubOrigin}${path}${query === '' ? '' : `?${query}`}`, init);
}

export async function sendSdkOperation(caller: SdkCaller, operation: SdkOperation, input: SdkRawInput): Promise<Response> {
  if (!SDK_ALLOWED_OPERATIONS.includes(operation)) throw new TypeError(`${operation} is not an operation of this client`);
  if (LITERAL_COLON.test(kernelOperations[operation].path)) return sendLiteralPath(caller, operation, input);
  const client = createClient(sdkOptions(caller));
  const raw: { params?: Record<string, string | number>; query?: Record<string, unknown>; body?: unknown } = {};
  if (input.params !== undefined) raw.params = input.params;
  if (input.query !== undefined) raw.query = input.query;
  if (input.body !== undefined) raw.body = input.body;
  return client.raw(operation, raw);
}

interface LooseSchema {
  safeParse(value: unknown): { success: true; data: unknown } | { success: false };
}
const SDK_SCHEMAS = routeSchemas as unknown as Readonly<Record<string, { readonly response: Readonly<Record<number, LooseSchema | undefined>> }>>;

/**
 * An SDK answer of a declared status, checked by the SDK's schema and then
 * by ours; `null` when either refuses it (contract failure). Our mirror keeps
 * the fields the SDK strips (the H-3 `client` echo).
 */
export function checkSdkAnswer(operation: SdkOperation, status: number, value: unknown): { ok: true; value: unknown } | { ok: false } {
  const sdkSchema = SDK_SCHEMAS[operation]?.response[status];
  if (sdkSchema === undefined) return { ok: false };
  const bySdk = sdkSchema.safeParse(value);
  if (!bySdk.success) return { ok: false };
  if (operation === 'pages') return { ok: true, value: bySdk.data };
  const ours = HUB_ROUTE_SCHEMAS[operation].response.safeParse(value);
  return ours.success ? { ok: true, value: ours.data } : { ok: false };
}
