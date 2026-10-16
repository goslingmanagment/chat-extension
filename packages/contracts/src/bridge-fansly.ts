// Fansly MAIN ↔ isolated bridge (R20, docs/project-unite/architecture.md §6): the light half, as bridge.ts is for
// ChatSpace — the type lists, the coalesced states and the undroppable stream, the (empty) list of writes, the credits
// of `fx.batch`, the byte limit of a frame by its type and the generic envelopes. The per-type payload and answer
// schemas, `fx.batch` and `fx.gap` are in bridge-messages-fansly.ts.
//
// The transport is ChatSpace's, moved to host-kit byte for byte (P5): the same handshake and MessagePort, the same
// envelope `{v, kind, id, t, documentEpoch, seq, payload}`, the same three stages of checks on the isolated side
// (`checkBridgeFrame`, the envelope, the schema of the type), the same transport errors (BRIDGE_ERRORS) and the same
// `probe`, which the shared boot answers itself. What is Fansly's own: MAIN packs the events of one listener call
// into one `fx.batch`; the isolated side acknowledges what it took with `fx.ack`; MAIN keeps at most
// FANSLY_BRIDGE_LIMITS.maxUnackedBatches batches and maxInFlightBytes in flight, and the rest waits in its queue (part
// of its memory account, §5.5). Over its budget it stops and sends one `fx.gap` — every chat unknown — and stays
// silent until the isolated side asks `fx.state`.
//
// A site module (1.15.0): only Fansly code imports it, by its own subpath. The root `@cg/contracts` does not
// re-export it, so neither a ChatSpace bundle nor the background core carries it (§1.8, §3.2).

import * as z from 'zod/mini';

import { BRIDGE_PROTOCOL_VERSION, BridgeErrorSchema, BridgeRequestIdSchema } from './bridge';
import { BRIDGE_LIMITS } from './limits';
import { CountSchema, EpochTokenSchema } from './primitives';

const KiB = 1024;

// ── Message types ──────────────────────────────────────────────────────────

/**
 * Requests isolated → MAIN (§6 `ToMainFansly`); payload and answer schemas: TO_MAIN_FANSLY in bridge-messages-fansly.ts.
 * `fx.health` (R20 P7a): MAIN's counts and parse times, read on demand.
 */
export const TO_MAIN_FANSLY_TYPES = ['probe', 'fx.state', 'fx.focus', 'fx.generationSnapshot', 'fx.groupForFan', 'fx.windowMeta', 'fx.ack', 'fx.health'] as const;
export type ToMainFanslyType = (typeof TO_MAIN_FANSLY_TYPES)[number];

/**
 * MAIN on Fansly writes nothing (§5, А4): it does not touch the DOM and sends no request and no frame of its own.
 * Inserts, file handoffs and navigation are the isolated world's; `fx.focus` and `fx.ack` only steer what MAIN
 * reports, `fx.health` only reads it. So no request is deduplicated by id, and none has a «may have run» outcome
 * (BRIDGE_WRITE_FAILURES).
 */
export const FANSLY_BRIDGE_WRITE_REQUESTS = [] as const satisfies readonly ToMainFanslyType[];

/** Events MAIN → isolated, inside `fx.batch` (§6 `FromMainFansly`): metadata only, never a message text. */
export const FROM_MAIN_FANSLY_TYPES = [
  'fx.identity',
  'fx.chat',
  'fx.contract',
  'fx.incoming',
  'fx.follow',
  'fx.sent',
  'fx.coverage',
  'fx.deleted',
  'fx.vaultAdded',
  'fx.vaultLoaded',
] as const;
export type FromMainFanslyType = (typeof FROM_MAIN_FANSLY_TYPES)[number];

/**
 * States: at most once per type in a batch, the latest wins; `fx.state` returns all three whole. `fx.chat` is the
 * focused group only.
 */
export const FANSLY_BRIDGE_STATE_EVENTS = ['fx.identity', 'fx.chat', 'fx.contract'] as const satisfies readonly FromMainFanslyType[];

/**
 * The stream: in order, never coalesced, thinned or dropped one by one — freshness, sound, receipts and the vault
 * confirmation hang on each of them. When MAIN's budget runs out, the whole waiting queue goes at once and `fx.gap`
 * says so: every chat is unknown, and no lost event can make a false `sent` (FS-TAIL-5).
 */
export const FANSLY_BRIDGE_UNDROPPABLE_EVENTS = [
  'fx.incoming',
  'fx.follow',
  'fx.sent',
  'fx.coverage',
  'fx.deleted',
  'fx.vaultAdded',
  'fx.vaultLoaded',
] as const satisfies readonly FromMainFanslyType[];

/**
 * Event frames on the port (`kind: 'evt'`): a batch, and two that go outside batches and their credits — the one gap
 * notice (the credits are what ran out) and the count of a guarded failure (decision X22), which the shared boot
 * posts by itself.
 */
export const FANSLY_WIRE_EVENT_TYPES = ['fx.batch', 'fx.gap', 'fault'] as const;
export type FanslyWireEventType = (typeof FANSLY_WIRE_EVENT_TYPES)[number];

/**
 * Why MAIN stopped the stream (`fx.gap`): `overflow` — the isolated side fell behind, the credits were spent and the
 * waiting queue reached its limit; `memory` — the memory account of the observation (§5.5) dropped the queue.
 */
export const FANSLY_GAP_REASONS = ['overflow', 'memory'] as const;
export type FanslyGapReason = (typeof FANSLY_GAP_REASONS)[number];

// ── Limits ─────────────────────────────────────────────────────────────────

/**
 * The credits of `fx.batch` and the frames with a limit of their own (§5.8, §6). Starting values; P7a calibrates
 * them. MAIN repeats them as literals, and its tests pin them here.
 */
export const FANSLY_BRIDGE_LIMITS = {
  /** Batches MAIN has sent and not yet seen acknowledged. */
  maxUnackedBatches: 8,
  /** UTF-8 bytes of those batches together. */
  maxInFlightBytes: 256 * KiB,
  /** One `fx.batch` frame, UTF-8 bytes of its JSON. */
  maxBatchBytes: 64 * KiB,
  /** Events in one batch. */
  maxBatchEvents: 512,
  /** The answer frame of `fx.generationSnapshot`: over it MAIN drops the oldest texts first and says `truncated`. */
  maxSnapshotBytes: 128 * KiB,
} as const;

/**
 * The byte limit of one frame from MAIN by its kind and type. The isolated side checks every frame against the
 * bridge's limit first (`checkBridgeFrame`), then compares the bytes it counted with this one: over it, the frame is
 * `too-large`.
 */
export function fanslyFrameByteLimit(kind: string, t: string): number {
  if (kind === 'evt' && t === 'fx.batch') return FANSLY_BRIDGE_LIMITS.maxBatchBytes;
  if (kind === 'res' && t === 'fx.generationSnapshot') return FANSLY_BRIDGE_LIMITS.maxSnapshotBytes;
  return BRIDGE_LIMITS.maxFrameBytes;
}

// ── Envelopes ──────────────────────────────────────────────────────────────

const ToMainFanslyTypeSchema = z.enum(TO_MAIN_FANSLY_TYPES);

/**
 * An answer MAIN → isolated, first stage: the envelope with `data` still unchecked. `t` echoes the request type and
 * must equal the pending request's; the second stage is that type's answer schema (`parseFanslyBridgeData`).
 */
export const FanslyBridgeResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    v: z.literal(BRIDGE_PROTOCOL_VERSION),
    kind: z.literal('res'),
    id: BridgeRequestIdSchema,
    t: ToMainFanslyTypeSchema,
    documentEpoch: EpochTokenSchema,
    seq: CountSchema,
    ok: z.literal(true),
    data: z.unknown(),
  }),
  z.strictObject({
    v: z.literal(BRIDGE_PROTOCOL_VERSION),
    kind: z.literal('res'),
    id: BridgeRequestIdSchema,
    t: ToMainFanslyTypeSchema,
    documentEpoch: EpochTokenSchema,
    seq: CountSchema,
    ok: z.literal(false),
    err: BridgeErrorSchema,
  }),
]);
export type FanslyBridgeResponse = z.infer<typeof FanslyBridgeResponseSchema>;

/** An event MAIN → isolated, first stage: a known wire type, payload unchecked (FANSLY_WIRE_EVENTS). */
export const FanslyBridgeEventEnvelopeSchema = z.strictObject({
  v: z.literal(BRIDGE_PROTOCOL_VERSION),
  kind: z.literal('evt'),
  t: z.enum(FANSLY_WIRE_EVENT_TYPES),
  documentEpoch: EpochTokenSchema,
  seq: CountSchema,
  payload: z.unknown(),
});
export type FanslyBridgeEventEnvelope = z.infer<typeof FanslyBridgeEventEnvelopeSchema>;
