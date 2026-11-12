// What the API tells its owner to count (2026-11-12): machine facts only — a purpose, a source —, never an id, a
// header or a text. The owner names the counters (bg/fansly.ts: the site's `client_health` window).
//
// - `sent`: one request of ours left — Fansly answered, or no answer came in time. The client's, per attempt.
// - `limited`: one 429, counted once however many saw it. Our own is seen by the client and, as a fact `own`, by the
//   core's `webRequest` listener: the pacer pairs the two by the client request id and tells the first one only. The
//   page's and the others' come from the facts the core recorded.
// - `refused`: a call ended in CG-FAN-RATE-LIMIT for its caller (a cooldown refused it, or Fansly's 429 after its
//   last attempt). The client's, once per call. A poll told to come back later (`early`) is none of these.

import type { FanslyPurpose } from './allowlist';

export type FanslyObservation =
  | { readonly kind: 'sent'; readonly purpose: FanslyPurpose }
  /** `purpose` — the request's, when the pacer still knew it (null — a fact of ours whose request it never saw). */
  | { readonly kind: 'limited'; readonly source: 'own' | 'page' | 'unknown'; readonly purpose: FanslyPurpose | null }
  | { readonly kind: 'refused'; readonly purpose: FanslyPurpose };

/** Never throws into the API: a failing observer costs a count, never a request. */
export type FanslyObserver = (observation: FanslyObservation) => void;

/** Tells `observer`, swallowing anything it throws. */
export function tell(observer: FanslyObserver | undefined, observation: FanslyObservation): void {
  if (observer === undefined) return;
  try {
    observer(observation);
  } catch {
    // A count lost; the request's own path goes on.
  }
}
