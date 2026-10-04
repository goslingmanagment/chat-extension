// Everything the isolated side checks with schemas, in one module that is
// loaded lazily (`import('./validate')`): building zod schemas costs time at
// startup, and the early isolated start must stay within its budget (§11,
// docs/spike-m0.md). Nothing here is needed before the first frame from MAIN.
//
// Three stages for every frame from MAIN (§5.3, §14): `checkBridgeFrame`
// (plain JSON within the limits), the envelope, then the payload or answer
// schema of its own type.

import { BridgeEventEnvelopeSchema, BridgeResponseSchema, checkBridgeFrame, type BridgeError, type BridgeRejectReason, type FromMainType, type ToMainType } from '@cg/contracts/bridge';
import { FROM_MAIN, parseBridgeData, type FromMainPayload, type ToMainData } from '@cg/contracts/bridge-messages';
import { InsertIntentSchema, NavigationIntentSchema } from '@cg/contracts/host';
import { DispatchTicketSchema, PreviewSendRequestSchema } from '@cg/contracts/send';

export type CheckedFrame =
  | { readonly kind: 'res'; readonly id: number; readonly t: ToMainType; readonly documentEpoch: string; readonly ok: true; readonly data: unknown }
  | { readonly kind: 'res'; readonly id: number; readonly t: ToMainType; readonly documentEpoch: string; readonly ok: false; readonly err: BridgeError }
  | { readonly kind: 'evt'; readonly t: FromMainType; readonly documentEpoch: string; readonly payload: unknown }
  | { readonly kind: 'reject'; readonly reason: BridgeRejectReason };

/** Stages one and two: plain JSON within the limits, then the envelope. The payload is still unchecked. */
export function checkFrame(raw: unknown): CheckedFrame {
  const frame = checkBridgeFrame(raw);
  if (!frame.ok) return { kind: 'reject', reason: frame.reason };
  const kind = (raw as { kind?: unknown }).kind;
  if (kind === 'res') {
    const parsed = BridgeResponseSchema.safeParse(raw);
    return parsed.success ? parsed.data : { kind: 'reject', reason: 'envelope' };
  }
  if (kind === 'evt') {
    const parsed = BridgeEventEnvelopeSchema.safeParse(raw);
    if (parsed.success) return { kind: 'evt', t: parsed.data.t, documentEpoch: parsed.data.documentEpoch, payload: parsed.data.payload };
    const t = (raw as { t?: unknown }).t;
    return { kind: 'reject', reason: typeof t === 'string' && !(t in FROM_MAIN) ? 'unknown-type' : 'envelope' };
  }
  return { kind: 'reject', reason: 'envelope' };
}

/** Stage three of an answer: the answer schema of the request's own type. */
export function parseAnswer<T extends ToMainType>(t: T, data: unknown): ToMainData<T> | null {
  return parseBridgeData(t, data);
}

/** Stage three of an event: the payload schema of its type. */
export function parseEvent<T extends FromMainType>(t: T, payload: unknown): FromMainPayload<T> | null {
  const parsed = FROM_MAIN[t].safeParse(payload);
  return parsed.success ? (parsed.data as FromMainPayload<T>) : null;
}

/** HostPort inputs from our own controllers: a broken one is a programming error, not a host refusal. */
export const isInsertIntent = (value: unknown): boolean => InsertIntentSchema.safeParse(value).success;
export const isNavigationIntent = (value: unknown): boolean => NavigationIntentSchema.safeParse(value).success;
export const isPreviewSendRequest = (value: unknown): boolean => PreviewSendRequestSchema.safeParse(value).success;
export const isDispatchTicket = (value: unknown): boolean => DispatchTicketSchema.safeParse(value).success;
