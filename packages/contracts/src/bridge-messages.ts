// MAIN ↔ isolated bridge (architecture.md §5.3), the per-type half: payload
// and answer schemas of every request, payload schemas of every event, and
// the full discriminated frames. The type lists, the guard and the envelopes
// are in bridge.ts.
//
// The isolated world never sends hub data or tokens to MAIN: only the text to
// insert or send and one-time ids (§14). Hence the *Wire shapes below, which
// strip hub bindings, hub tickets and action tokens from the §5.2 intents.

import * as z from 'zod/mini';

import { BRIDGE_PROTOCOL_VERSION, BridgeRequestIdSchema, BridgeResponseSchema, MainProbeSchema, type FromMainType, type ToMainType } from './bridge';
import {
  AnchorIdSchema,
  ChatWindowSchema,
  ComposerStateSchema,
  HostFanSchema,
  InsertReceiptSchema,
  InsertWireSchema,
  NavigationItemSchema,
  NavigationReceiptSchema,
  RouteStateSchema,
  SentDraftSchema,
  TailSnapshotSchema,
  thenInsertFits,
} from './host';
import { DraftProvenanceSchema, HostAccountSchema, HostIdentitySchema, PartRefSchema } from './ids';
import { BRIDGE_LIMITS, SEND_LIMITS } from './limits';
import { CountSchema, DigestSchema, EpochMsSchema, EpochTokenSchema, IsoTimestampSchema, NativeIdSchema, UuidSchema, boundedText, displayText } from './primitives';
import { FreshnessCheckpointSchema, PendingIdSchema, PreviewSendCommitSchema, PreviewSendPreflightSchema, SendAttemptViewSchema, checkpointMatches } from './send';

const EmptySchema = z.strictObject({});

// ── Payloads ───────────────────────────────────────────────────────────────

/** The host contract as MAIN sees it; the isolated side turns it into a HostContractReport. */
export const ContractWireSchema = z.strictObject({
  build: z.nullable(displayText(80)),
  missing: z.array(AnchorIdSchema).check(z.maxLength(32)),
  /** Present, but of an unexpected shape. */
  shape: z.array(AnchorIdSchema).check(z.maxLength(32)),
  /** X8 receipt profile: module role → fingerprint of the loaded module, matched against bootstrap profiles (§6.2). */
  receiptModules: z.record(boundedText(64), boundedText(128)).check(
    z.refine((r) => Object.keys(r).length <= 32, { message: 'too many receipt modules' }),
  ),
});
export type ContractWire = z.infer<typeof ContractWireSchema>;

export const MainSnapshotSchema = z.strictObject({
  route: RouteStateSchema,
  hostLoginEpoch: z.nullable(EpochTokenSchema),
  composer: z.nullable(ComposerStateSchema),
  accounts: z.array(HostAccountSchema).check(z.maxLength(200)),
  contract: ContractWireSchema,
});
export type MainSnapshot = z.infer<typeof MainSnapshotSchema>;

/** The draft as MAIN read it; the isolated side pairs it with the identity it asked for. */
export const DraftWireSchema = z.strictObject({
  composerInstanceId: EpochTokenSchema,
  revision: CountSchema,
  plainText: displayText(BRIDGE_LIMITS.maxStringLength),
  provenance: DraftProvenanceSchema,
  digest: DigestSchema,
});
export type DraftWire = z.infer<typeof DraftWireSchema>;

/** NavigationIntent without the action token: MAIN gets no tokens (§14). */
export const NavigationWireSchema = z
  .strictObject({
    intentId: UuidSchema,
    acc: NativeIdSchema,
    fan: z.nullable(NativeIdSchema),
    thenInsert: z.optional(InsertWireSchema),
  })
  .check(
    z.refine((n) => thenInsertFits(n.thenInsert, n.acc, n.fan), {
      message: 'thenInsert goes only with a chat target, to the same account and fan, as a deferred insert',
    }),
  );
export type NavigationWire = z.infer<typeof NavigationWireSchema>;

/**
 * PreviewSendRequest as MAIN receives it: no hub binding, no hub ticket, no
 * action token — only the host target, the text, the one-time attempt id and
 * the ticket's deadline (a later call is `held`, never a late send, §6.7.11).
 */
export const MainSendRequestSchema = z
  .strictObject({
    attemptId: UuidSchema,
    acc: NativeIdSchema,
    fan: NativeIdSchema,
    /** = target.binding.platformAccountId (the page's), checked against the loaded `accounts` store (condition 5). */
    platformAccountId: NativeIdSchema,
    part: PartRefSchema,
    previewRevision: CountSchema,
    plainText: boundedText(SEND_LIMITS.previewDraftMaxChars),
    isAiGenerated: z.boolean(),
    checkpoint: FreshnessCheckpointSchema,
    /** The ticket's deadline on the local clock (send-rules localDeadline). */
    expiresAt: EpochMsSchema,
  })
  .check(z.refine((r) => checkpointMatches(r.checkpoint, r.acc, r.fan), { message: 'the checkpoint belongs to acc/fan' }));
export type MainSendRequest = z.infer<typeof MainSendRequestSchema>;

const AccFan = { acc: NativeIdSchema, fan: NativeIdSchema };

/**
 * Requests isolated → MAIN: payload and answer schema of each `t`.
 * `write` requests are deduplicated by id in MAIN (a repeated id returns the
 * first result and does not execute again); `timeout` picks the deadline.
 */
export const TO_MAIN = {
  probe: { payload: EmptySchema, data: MainProbeSchema, write: false, timeout: 'call' },
  snapshot: { payload: EmptySchema, data: MainSnapshotSchema, write: false, timeout: 'call' },
  readDraft: { payload: z.strictObject({ expected: HostIdentitySchema }), data: DraftWireSchema, write: false, timeout: 'call' },
  readTail: {
    payload: z.strictObject({ expected: HostIdentitySchema, max: z.int().check(z.gte(1), z.lte(BRIDGE_LIMITS.maxSnapshotMessages)) }),
    data: z.nullable(TailSnapshotSchema),
    write: false,
    timeout: 'call',
  },
  chatWindow: {
    payload: z.strictObject({ ...AccFan, max: z.int().check(z.gte(1), z.lte(BRIDGE_LIMITS.maxSnapshotMessages)) }),
    data: z.nullable(ChatWindowSchema),
    write: false,
    timeout: 'call',
  },
  fan: { payload: z.strictObject(AccFan), data: z.nullable(HostFanSchema), write: false, timeout: 'call' },
  listChats: {
    payload: z.strictObject({ acc: NativeIdSchema, limit: z.int().check(z.gte(1), z.lte(BRIDGE_LIMITS.maxArrayLength)) }),
    data: z.array(NavigationItemSchema).check(z.maxLength(BRIDGE_LIMITS.maxArrayLength)),
    write: false,
    timeout: 'call',
  },
  listAccounts: { payload: EmptySchema, data: z.array(HostAccountSchema).check(z.maxLength(200)), write: false, timeout: 'call' },
  /** An `open` insert; a deferred one only rides `navigate`. */
  insertGuarded: {
    payload: z.strictObject({ intent: InsertWireSchema }).check(z.refine((p) => p.intent.expected.kind === 'open', { message: 'insertGuarded takes an open intent' })),
    data: InsertReceiptSchema,
    write: true,
    timeout: 'call',
  },
  focus: { payload: z.strictObject({ expected: HostIdentitySchema }), data: z.strictObject({ focused: z.boolean() }), write: false, timeout: 'call' },
  navigate: { payload: z.strictObject({ intent: NavigationWireSchema }), data: NavigationReceiptSchema, write: true, timeout: 'navInsert' },
  /**
   * Cancels the deferred insert (`thenInsert.intentId`) of an «Открыть и
   * вставить» (§6.5: sign-out, persona or binding change, the preview
   * closed); it may come before its navigation reached MAIN. `canceled` —
   * MAIN will not write it; false — it was already written or had ended.
   * The navigation itself is not undone; its receipt carries the outcome.
   */
  cancelInsert: { payload: z.strictObject({ intentId: UuidSchema }), data: z.strictObject({ canceled: z.boolean() }), write: false, timeout: 'call' },
  checkpoint: { payload: z.strictObject(AccFan), data: FreshnessCheckpointSchema, write: false, timeout: 'call' },
  previewSendPreflight: { payload: z.strictObject({ req: MainSendRequestSchema }), data: PreviewSendPreflightSchema, write: false, timeout: 'call' },
  previewSendCommit: { payload: z.strictObject({ req: MainSendRequestSchema }), data: PreviewSendCommitSchema, write: true, timeout: 'call' },
  flags: {
    payload: z.strictObject({ wsTap: z.boolean(), previewSend: z.boolean() }),
    data: z.strictObject({ wsTap: z.boolean(), previewSend: z.boolean() }),
    write: false,
    timeout: 'call',
  },
} as const satisfies Record<ToMainType, { readonly payload: z.ZodMiniType; readonly data: z.ZodMiniType; readonly write: boolean; readonly timeout: 'call' | 'navInsert' }>;

export type ToMainPayload<T extends ToMainType> = z.infer<(typeof TO_MAIN)[T]['payload']>;
export type ToMainData<T extends ToMainType> = z.infer<(typeof TO_MAIN)[T]['data']>;
/** §5.3 `ToMain`: a request type with its payload. */
export type ToMain = { [T in ToMainType]: { readonly t: T; readonly payload: ToMainPayload<T> } }[ToMainType];

/** Events MAIN → isolated, without any message text (§5.3). */
export const FROM_MAIN = {
  route: z.strictObject({ route: RouteStateSchema, hostLoginEpoch: z.nullable(EpochTokenSchema) }),
  /** The accounts store changed; the isolated side asks `listAccounts`. */
  accounts: EmptySchema,
  composer: z.strictObject({ state: z.nullable(ComposerStateSchema) }),
  /** The cache of the open chat changed. */
  chatCache: z.strictObject(AccFan),
  contract: ContractWireSchema,
  incoming: z.strictObject({
    ...AccFan,
    msgId: NativeIdSchema,
    fromFan: z.boolean(),
    automatic: z.boolean(),
    tip: z.boolean(),
    sentAt: z.nullable(IsoTimestampSchema),
    socketEpoch: CountSchema,
    fanSequence: CountSchema,
  }),
  coverage: z.strictObject({ acc: NativeIdSchema, state: z.enum(['ok', 'unknown']), reason: boundedText(64) }),
  /** A human send from the composer (§6.6): once per send, after the native chain settled (HumanSendFact). */
  humanSend: z.strictObject({
    ...AccFan,
    pendingId: PendingIdSchema,
    platformMessageId: z.nullable(NativeIdSchema),
    textDigest: DigestSchema,
    draft: SentDraftSchema,
  }),
  previewSendState: z.strictObject({ view: SendAttemptViewSchema }),
} as const satisfies Record<FromMainType, z.ZodMiniType>;

export type FromMainPayload<T extends FromMainType> = z.infer<(typeof FROM_MAIN)[T]>;
/** §5.3 `FromMain` events: an event type with its payload. */
export type FromMain = { [T in FromMainType]: { readonly t: T; readonly payload: FromMainPayload<T> } }[FromMainType];

// ── Frames ─────────────────────────────────────────────────────────────────

function requestFrame<T extends ToMainType>(t: T) {
  return z.strictObject({
    v: z.literal(BRIDGE_PROTOCOL_VERSION),
    kind: z.literal('req'),
    id: BridgeRequestIdSchema,
    t: z.literal(t),
    /** The document epoch the isolated side last saw; null before the first frame from MAIN. */
    documentEpoch: z.nullable(EpochTokenSchema),
    /** Grows per sender within a document. */
    seq: CountSchema,
    payload: TO_MAIN[t].payload,
  });
}

/** A request isolated → MAIN. MAIN checks the same shape by hand. */
export const BridgeRequestSchema = z.discriminatedUnion('t', [
  requestFrame('probe'),
  requestFrame('snapshot'),
  requestFrame('readDraft'),
  requestFrame('readTail'),
  requestFrame('chatWindow'),
  requestFrame('fan'),
  requestFrame('listChats'),
  requestFrame('listAccounts'),
  requestFrame('insertGuarded'),
  requestFrame('focus'),
  requestFrame('navigate'),
  requestFrame('cancelInsert'),
  requestFrame('checkpoint'),
  requestFrame('previewSendPreflight'),
  requestFrame('previewSendCommit'),
  requestFrame('flags'),
]);
export type BridgeRequest = z.infer<typeof BridgeRequestSchema>;

export function parseBridgeData<T extends ToMainType>(t: T, data: unknown): ToMainData<T> | null {
  const parsed = TO_MAIN[t].data.safeParse(data);
  return parsed.success ? (parsed.data as ToMainData<T>) : null;
}

function eventFrame<T extends FromMainType>(t: T) {
  return z.strictObject({
    v: z.literal(BRIDGE_PROTOCOL_VERSION),
    kind: z.literal('evt'),
    t: z.literal(t),
    documentEpoch: EpochTokenSchema,
    seq: CountSchema,
    payload: FROM_MAIN[t],
  });
}

/** An event MAIN → isolated. */
export const BridgeEventSchema = z.discriminatedUnion('t', [
  eventFrame('route'),
  eventFrame('accounts'),
  eventFrame('composer'),
  eventFrame('chatCache'),
  eventFrame('contract'),
  eventFrame('incoming'),
  eventFrame('coverage'),
  eventFrame('humanSend'),
  eventFrame('previewSendState'),
]);
export type BridgeEvent = z.infer<typeof BridgeEventSchema>;

/** Everything MAIN may send on the port, after `checkBridgeFrame`. */
export const FromMainFrameSchema = z.union([BridgeResponseSchema, BridgeEventSchema]);
export type FromMainFrame = z.infer<typeof FromMainFrameSchema>;
