// Everything the isolated side checks of Fansly's bridge with schemas, in one
// module that loads lazily: in the extension it is the `bridge-validation`
// chunk of Fansly's own build (lazy/fansly/), loaded with the first frame from
// MAIN, never at document_start (docs/project-unite/architecture.md §3.1, §6).
//
// Three stages for every frame from MAIN, as on ChatSpace (§6): plain JSON
// within the bridge's limits (`checkBridgeFrame`) and the byte limit of its
// own type (`fanslyFrameByteLimit`: a batch 64 KiB, a snapshot 128 KiB), the
// envelope, then the answer schema of the request's type or the payload schema
// of the event frame (a batch is checked whole). And the intents our own
// controllers hand the port's writes (R20 P7e).

import { checkBridgeFrame } from '@cg/contracts/bridge';
import { FANSLY_WIRE_EVENT_TYPES, FanslyBridgeEventEnvelopeSchema, FanslyBridgeResponseSchema, fanslyFrameByteLimit, type FanslyWireEventType, type ToMainFanslyType } from '@cg/contracts/bridge-fansly';
import { parseFanslyBridgeData, parseFanslyWireEvent, type FanslyWireEventPayload, type ToMainFanslyData } from '@cg/contracts/bridge-messages-fansly';
import { InsertIntentSchema, NavigationIntentSchema } from '@cg/contracts/host';
import { HostIdentitySchema, HumanCauseSchema } from '@cg/contracts/ids';
import { UuidSchema } from '@cg/contracts/primitives';
import type { CheckedFrame } from '@cg/host-kit/isolated/validation';

import type { FanslyBridge } from './bridge-client';

/** Stages one and two: plain JSON within the limits — the bridge's, then its own type's — and the envelope. The payload is still unchecked. */
export function checkFrame(raw: unknown): CheckedFrame<FanslyBridge> {
  const frame = checkBridgeFrame(raw);
  if (!frame.ok) return { kind: 'reject', reason: frame.reason };
  const { kind, t } = raw as { readonly kind?: unknown; readonly t?: unknown };
  if (typeof kind === 'string' && typeof t === 'string' && frame.bytes > fanslyFrameByteLimit(kind, t)) return { kind: 'reject', reason: 'too-large' };
  if (kind === 'res') {
    const parsed = FanslyBridgeResponseSchema.safeParse(raw);
    return parsed.success ? parsed.data : { kind: 'reject', reason: 'envelope' };
  }
  if (kind === 'evt') {
    const parsed = FanslyBridgeEventEnvelopeSchema.safeParse(raw);
    if (parsed.success) return { kind: 'evt', t: parsed.data.t, documentEpoch: parsed.data.documentEpoch, payload: parsed.data.payload };
    return { kind: 'reject', reason: typeof t === 'string' && !(FANSLY_WIRE_EVENT_TYPES as readonly string[]).includes(t) ? 'unknown-type' : 'envelope' };
  }
  return { kind: 'reject', reason: 'envelope' };
}

/**
 * Stage three of an answer: the answer schema of the request's own type. The result says whether it passed — `null`
 * is a valid answer of several requests (`fx.focus`, `fx.ack`, a snapshot MAIN cannot give), never a failure by itself.
 */
export function parseAnswer<T extends ToMainFanslyType>(t: T, data: unknown): { readonly ok: true; readonly data: ToMainFanslyData<T> } | { readonly ok: false } {
  return parseFanslyBridgeData(t, data);
}

/**
 * Stage three of an event frame: the payload schema of its type; null — it did not pass. A batch that did not pass is
 * lost whole (§6) — and yet the isolated side must acknowledge it, or MAIN holds its credit: when its number can be
 * read, it comes on as that number alone, `{n, events: []}` — a batch MAIN never sends (a batch has at least one
 * event), so the consumer (stream.ts) takes it for what it is: acknowledged, every chat unknown, `fx.state` again.
 */
export function parseEvent<T extends FanslyWireEventType>(t: T, payload: unknown): FanslyWireEventPayload<T> | null {
  const parsed = parseFanslyWireEvent(t, payload);
  if (parsed !== null || t !== 'fx.batch' || typeof payload !== 'object' || payload === null) return parsed;
  const n: unknown = (payload as { readonly n?: unknown }).n;
  return Number.isSafeInteger(n) && (n as number) >= 1 ? ({ n, events: [] } as unknown as FanslyWireEventPayload<T>) : null;
}

type Fields<K extends string> = Partial<Record<K, unknown>>;

/** HostPort inputs from our own controllers (R20 P7e): a broken one is a programming error, not a refusal of the page. */
export const isInsertIntent = (value: unknown): boolean => InsertIntentSchema.safeParse(value).success;
export const isNavigationIntent = (value: unknown): boolean => NavigationIntentSchema.safeParse(value).success;
/**
 * `AttachIntent` (contracts host.ts, 1.47.0) is an interface, its bytes no wire's: its ids and identity by their
 * schemas, its file an MP3 with a name and something in it.
 */
export const isAttachIntent = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null) return false;
  const { intentId, expected, cause, file } = value as Fields<'intentId' | 'expected' | 'cause' | 'file'>;
  if (!UuidSchema.safeParse(intentId).success || !HostIdentitySchema.safeParse(expected).success || !HumanCauseSchema.safeParse(cause).success) return false;
  if (typeof file !== 'object' || file === null) return false;
  const { name, type, bytes } = file as Fields<'name' | 'type' | 'bytes'>;
  return typeof name === 'string' && name.length > 0 && name.length <= 255 && type === 'audio/mpeg' && bytes instanceof ArrayBuffer && bytes.byteLength > 0;
};
