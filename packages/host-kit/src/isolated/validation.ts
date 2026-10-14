// What a host's schema module is to the bridge client (bridge-client.ts), as
// types only. Every host has its own registry — the requests it sends MAIN
// with their payloads and answers, the events MAIN sends back — and its own
// module of schemas for it (ChatSpace: host-chatspace/src/isolated/
// validate.ts over @cg/contracts/bridge-messages). The client knows neither:
// it is generic over the registry's shape and calls the three stages below.
//
// The schemas are built on the first frame from MAIN, never at document_start
// (§11) — and whoever starts the host says where they come from, with a
// loader:
//
// - a bundle that can load a module of its own (tests, the e2e harness) takes
//   the host's own loader of the module next to it, by `import()`;
// - an extension content script is ONE classic file — a dynamic import inside
//   it is inlined, and the schemas of the whole bridge (with zod's share of
//   them, about 6 KiB gzip) would sit in the early isolated bundle, which has
//   30 KiB for everything (§11). Its composition root hands in a loader of a
//   lazy chunk of the site's own build instead.
//
// A loader is asked on every frame and must answer the same module each time.

import type { BridgeError, BridgeRejectReason } from '@cg/contracts/bridge';

/** A host's bridge registry as types: each request's payload and answer, each event's payload. */
export interface BridgeShape {
  readonly requests: Record<string, { readonly payload: unknown; readonly data: unknown }>;
  readonly events: Record<string, unknown>;
}
export type RequestType<B extends BridgeShape> = keyof B['requests'] & string;
export type EventType<B extends BridgeShape> = keyof B['events'] & string;

/** A frame from MAIN after stages one and two: its envelope is known, its payload or answer is still unchecked. */
export type CheckedFrame<B extends BridgeShape> =
  | { readonly kind: 'res'; readonly id: number; readonly t: RequestType<B>; readonly documentEpoch: string; readonly ok: true; readonly data: unknown }
  | { readonly kind: 'res'; readonly id: number; readonly t: RequestType<B>; readonly documentEpoch: string; readonly ok: false; readonly err: BridgeError }
  | { readonly kind: 'evt'; readonly t: EventType<B>; readonly documentEpoch: string; readonly payload: unknown }
  | { readonly kind: 'reject'; readonly reason: BridgeRejectReason };

/**
 * The three stages every frame from MAIN passes (§5.3, §14), as a host's schema module gives them: plain JSON within
 * the limits and the envelope (`checkFrame`), then the answer schema of the request's own type (`parseAnswer`: the
 * result says whether it passed — `null` is a valid answer of several reads, never a failure by itself) or the payload
 * schema of the event's type (`parseEvent`: null — broken). A host may type the last two closer, by the type it is
 * given; the client needs no more than this.
 */
export interface BridgeValidation<B extends BridgeShape> {
  checkFrame(raw: unknown): CheckedFrame<B>;
  parseAnswer(t: RequestType<B>, data: unknown): { readonly ok: true; readonly data: B['requests'][RequestType<B>]['data'] } | { readonly ok: false };
  parseEvent(t: EventType<B>, payload: unknown): B['events'][EventType<B>] | null;
}

/** Where a host's schema module comes from; `V` — that module (it implements BridgeValidation of the host's registry, and may hold more). */
export type ValidationLoader<V> = () => Promise<V>;
