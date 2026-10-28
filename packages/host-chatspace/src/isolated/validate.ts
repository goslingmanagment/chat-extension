// Everything the isolated side checks with schemas, in one module that is
// loaded lazily (`import('./validate')`): building zod schemas costs time at
// startup, and the early isolated start must stay within its budget (§11,
// docs/spike-m0.md). Nothing here is needed before the first frame from MAIN.
//
// Three stages for every frame from MAIN (§5.3, §14): `checkBridgeFrame`
// (plain JSON within the limits), the envelope, then the payload or answer
// schema of its own type.

import { BridgeEventEnvelopeSchema, BridgeResponseSchema, checkBridgeFrame, type BridgeError, type BridgeRejectReason, type FromMainType, type ToMainType } from '@cg/contracts/bridge';
import { AttachWireSchema, FROM_MAIN, TO_MAIN, type FromMainPayload, type ToMainData } from '@cg/contracts/bridge-messages';
import { InsertIntentSchema, NavigationIntentSchema, OmFanNoteInputSchema, OmNoteIdSchema } from '@cg/contracts/host';
import { HumanCauseSchema } from '@cg/contracts/ids';
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

/**
 * Stage three of an answer: the answer schema of the request's own type. The result says whether it passed —
 * `null` is a valid answer of several reads («ChatSpace holds no such fan / chat yet»), never a failure by itself.
 */
export function parseAnswer<T extends ToMainType>(t: T, data: unknown): { readonly ok: true; readonly data: ToMainData<T> } | { readonly ok: false } {
  const parsed = TO_MAIN[t].data.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data as ToMainData<T> } : { ok: false };
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
/** 2026-10-28: a note of the open chat's fan to write (OmFanNoteInputSchema: the title, the raw text, the colour) and a note's id. */
export const isFanNoteInput = (value: unknown): boolean => OmFanNoteInputSchema.safeParse(value).success;
export const isFanNoteId = (value: unknown): boolean => OmNoteIdSchema.safeParse(value).success;
/** 1.47.0: an AttachIntent — what MAIN gets of it (AttachWireSchema: the name the page reads, the MP3 within the cap) and the person's cause. */
export const isAttachIntent = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null) return false;
  const { cause, ...wire } = value as { readonly cause?: unknown };
  return HumanCauseSchema.safeParse(cause).success && AttachWireSchema.safeParse(wire).success;
};
