// Shared pieces of every hub request (architecture.md §8, §13): the client
// version header, the call scope (caller's signal + the sign-in epoch +
// a deadline), reading an error answer into HubFailure facts, Retry-After.

import { HubErrorBodySchema, type AbortSignalLike, type HubFailure } from '@cg/contracts';
import { KernelApiError } from '@kernel/sdk';

import { transportFailure } from './errors';
import { type HubClock } from './ports';

/** The client name on the wire (H-3 `client`, H-12 producer, `x-client-version`). */
export const CLIENT_NAME = 'chat-extension';
export const CLIENT_VERSION_HEADER = 'x-client-version';

/** HB-004: `chat-extension/<version>` on every request, the sign-in and the public health check included. */
export function clientVersionHeaders(extensionVersion: string): Record<string, string> {
  return { [CLIENT_VERSION_HEADER]: `${CLIENT_NAME}/${extensionVersion}` };
}

/** Default deadline of one hub request (not the AI stream, whose timeouts belong to the operation, §7). */
export const REQUEST_TIMEOUT_MS = 30_000;

export interface CallScope {
  readonly signal: AbortSignal;
  /** Our own deadline fired (transport `timeout`), as opposed to a cancel (`aborted`). */
  timedOut(): boolean;
  /** Ends the call from our side (a terminal frame arrived): reads as `aborted`, not as a deadline. */
  abort(): void;
  dispose(): void;
}

/**
 * Listens for `abort` on a signal; the returned function stops listening.
 * A real AbortSignal gets its listener removed, so a long-lived parent (the
 * sign-in epoch's signal, a tab's signal) does not collect one listener per
 * call. A signal without `removeEventListener` (contracts carry no DOM types)
 * keeps it until it fires.
 */
export function onAbort(signal: AbortSignalLike, listener: () => void): () => void {
  signal.addEventListener('abort', listener, { once: true });
  return () => {
    if ('removeEventListener' in signal && typeof signal.removeEventListener === 'function') {
      (signal.removeEventListener as (type: 'abort', listener: () => void) => void).call(signal, 'abort', listener);
    }
  };
}

/** One AbortSignal for a call: any parent aborts it, and so does the deadline. `dispose` detaches it from the parents. */
export function callScope(clock: HubClock, parents: readonly (AbortSignalLike | undefined)[], timeoutMs: number | null): CallScope {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  const detach: (() => void)[] = [];
  for (const parent of parents) {
    if (parent === undefined) continue;
    if (parent.aborted) controller.abort();
    else detach.push(onAbort(parent, abort));
  }
  let timer =
    timeoutMs === null
      ? null
      : clock.setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    abort: () => controller.abort(),
    dispose: () => {
      if (timer !== null) clock.clearTimeout(timer);
      timer = null;
      for (const stop of detach.splice(0)) stop();
    },
  };
}

/** `Retry-After` as delta seconds or an HTTP date → ms from now; null when absent or unreadable. */
export function retryAfterMs(value: string | null, now: number): number | null {
  if (value === null || value.trim() === '') return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds >= 0 ? Math.round(seconds * 1000) : null;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/** The hub's error body, read for its machine fields only; anything else (a proxy's HTML page) gives nulls. */
export function errorFacts(body: unknown): { error: string | null; reason: string | null } {
  const parsed = HubErrorBodySchema.safeParse(body);
  if (parsed.success) return { error: parsed.data.error, reason: parsed.data.reason ?? null };
  if (typeof body === 'object' && body !== null) {
    const loose = body as { error?: unknown; reason?: unknown };
    return {
      error: typeof loose.error === 'string' ? loose.error : null,
      reason: typeof loose.reason === 'string' ? loose.reason : null,
    };
  }
  return { error: null, reason: null };
}

/** True when the body is the hub's structured error shape (the AI retry-once applies only to a structured 503). */
export function isStructuredHubError(body: unknown): boolean {
  return HubErrorBodySchema.safeParse(body).success;
}

export async function readJson(response: Response): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    const text = await response.text();
    return { ok: true, value: text === '' ? null : (JSON.parse(text) as unknown) };
  } catch {
    return { ok: false };
  }
}

export async function httpFailureOf(response: Response, now: number): Promise<{ failure: HubFailure; body: unknown }> {
  const read = await readJson(response);
  const body = read.ok ? read.value : null;
  const { error, reason } = errorFacts(body);
  return {
    failure: { kind: 'http', status: response.status, error, reason, retryAfterMs: retryAfterMs(response.headers.get('retry-after'), now) },
    body,
  };
}

/** A thrown request failure → transport facts. Our deadline is `timeout`, a cancel `aborted`, an SDK contract check `contract`. */
export function thrownFailure(error: unknown, scope: CallScope): HubFailure {
  if (scope.timedOut()) return transportFailure('timeout');
  if (scope.signal.aborted) return transportFailure('aborted');
  if (error instanceof KernelApiError && error.category === 'contract') return transportFailure('contract');
  if (error instanceof SyntaxError) return transportFailure('contract');
  return transportFailure('network');
}
