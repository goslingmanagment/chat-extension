// The only automatic retry (architecture.md §7 «Повтор», AI-133, RB-001): a
// structured `service_unavailable` (503) of the AI stream before any frame
// of the attempt → one transparent retry after 5 s. Nothing else repeats by
// itself: not a 502, not an EOF, not a timeout, not an error frame, never a
// send. The wait is interrupted when the environment goes away (sign-in,
// persona or hub change, a background unload): an interrupted retry is never
// re-POSTed later.

import { type HubErrorDisposition } from '@cg/contracts/hub';
import { OP_LIMITS } from '@cg/contracts/limits';

export interface RetryInput {
  /** What the resolver made of the failure (only `retry-once` qualifies). */
  readonly disposition: HubErrorDisposition;
  /** 1 for the first POST. */
  readonly attempt: number;
  /** Any frame of this attempt arrived (the hub answered 200 and started a stream). */
  readonly frameSeen: boolean;
  /** Any output frame of the operation arrived (content after `meta`). */
  readonly outputSeen: boolean;
  /** The operation was canceled or the environment it belongs to changed meanwhile. */
  readonly environmentLost: boolean;
}

export type RetryDecision = { readonly retry: false } | { readonly retry: true; readonly delayMs: number };

export const MAX_STREAM_ATTEMPTS = 1 + OP_LIMITS.serviceUnavailableRetries;

export function retryDecision(input: RetryInput): RetryDecision {
  if (input.disposition !== 'retry-once') return { retry: false };
  if (input.attempt >= MAX_STREAM_ATTEMPTS) return { retry: false };
  if (input.frameSeen || input.outputSeen || input.environmentLost) return { retry: false };
  return { retry: true, delayMs: OP_LIMITS.serviceUnavailableRetryDelayMs };
}
