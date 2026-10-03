// X8: send from a preview through ChatSpace's own send queue on a human click
// (architecture.md §5.2 "X8", §6.7). Types of the port, the freshness
// checkpoint, the hub's one-time dispatch ticket, the attempt state machine of
// §6.7.7 and the attempt journal record. An outcome that is not proven is
// `uncertain` and is NEVER retried; only the late second half of an already
// linked receipt/echo pair may still turn it into `sentObserved`.

import * as z from 'zod/mini';

import { CgCodeSchema } from './errors';
import { HumanCauseSchema, PartRefSchema, PlatformSchema, TargetSchema } from './ids';
import { SEND_LIMITS } from './limits';
import {
  CountSchema,
  EpochMsSchema,
  EpochTokenSchema,
  HubIntIdSchema,
  HubOriginSchema,
  NativeIdSchema,
  RefSchema,
  UuidSchema,
  boundedText,
  displayText,
} from './primitives';

/**
 * Freshness checkpoint, taken synchronously in MAIN on the Generate click and
 * kept unchanged by the operation (§6.7.5). `coverage: 'unknown'` means the
 * observation cannot prove "nothing new", never "nothing new".
 */
export const FreshnessCheckpointSchema = z.strictObject({
  documentEpoch: EpochTokenSchema,
  /** A new page socket is a new epoch. */
  socketEpoch: CountSchema,
  /** The account's subscription on the current socket. */
  subscriptionEpoch: CountSchema,
  hostAccountId: NativeIdSchema,
  platformFanId: NativeIdSchema,
  /** Fan messages first seen for (account, fan), deduplicated by id. */
  fanSequence: CountSchema,
  lastFanMessageId: z.nullable(NativeIdSchema),
  observedAt: EpochMsSchema,
  coverage: z.enum(['ok', 'unknown']),
});
export type FreshnessCheckpoint = z.infer<typeof FreshnessCheckpointSchema>;

/** What the human asked to send: one part of one finished generation. */
export const PreviewSendRequestSchema = z.strictObject({
  attemptId: UuidSchema,
  target: TargetSchema,
  /** Hub `meta.requestId` of the generation. */
  generationRef: RefSchema,
  part: PartRefSchema,
  /** Revision of the preview's local draft field; a change voids the attempt (CG-SEND-PART). */
  previewRevision: CountSchema,
  plainText: boundedText(SEND_LIMITS.previewDraftMaxChars),
  /** ChatSpace's own "text from AI" mark, by its rule against the ORIGINAL chosen AI part (§6.7.1). */
  isAiGenerated: z.boolean(),
  checkpoint: FreshnessCheckpointSchema,
  cause: HumanCauseSchema,
});
export type PreviewSendRequest = z.infer<typeof PreviewSendRequestSchema>;

/** The hub's one-time permission for exactly one attempt (H-7 `dispatch`); short-lived, never batched. */
export const DispatchTicketSchema = z.strictObject({
  attemptId: UuidSchema,
  ticket: boundedText(512),
  expiresAt: EpochMsSchema,
});
export type DispatchTicket = z.infer<typeof DispatchTicketSchema>;

/** Side-effect-free check for the button: a reason when it must stay disabled. */
export const PreviewSendPreflightSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(false), code: CgCodeSchema, detail: z.optional(displayText(400)) }),
]);
export type PreviewSendPreflight = z.infer<typeof PreviewSendPreflightSchema>;

/** ChatSpace's local id of the queued record (a UUID of theirs): links the attempt, never a delivery proof. */
export const PendingIdSchema = RefSchema;

/** Result of the single queue call. A repeated command with the same attemptId returns the first result. */
export const PreviewSendCommitSchema = z.discriminatedUnion('state', [
  /** Queued; the native send already started. */
  z.strictObject({ state: z.literal('nativeEnqueued'), pendingId: PendingIdSchema }),
  /** The queue returned null (Mimic or 50 entries in the chat) with the call boundary intact. */
  z.strictObject({ state: z.literal('notEnqueued'), code: CgCodeSchema }),
  /** A condition failed in the same synchronous step, before the queue was touched. */
  z.strictObject({ state: z.literal('held'), code: CgCodeSchema }),
  /** The queue may have been called but the result is not known. */
  z.strictObject({ state: z.literal('uncertain'), code: CgCodeSchema }),
]);
export type PreviewSendCommit = z.infer<typeof PreviewSendCommitSchema>;

/** §6.7.7. */
export const SEND_ATTEMPT_STATES = [
  'ready',
  'preparing',
  'held',
  'notEnqueued',
  'nativeEnqueued',
  'nativeAccepted',
  'sentObserved',
  'rejected',
  'uncertain',
] as const;
export const SendAttemptStateSchema = z.enum(SEND_ATTEMPT_STATES);
export type SendAttemptState = z.infer<typeof SendAttemptStateSchema>;

/**
 * Allowed transitions (§6.7.7):
 * - ready → preparing on a trusted click (local fan lock, hub dispatch);
 * - preparing → held: freshness, a condition or the lease failed BEFORE the native queue;
 * - preparing → notEnqueued: the queue returned null with the call boundary intact;
 * - preparing → nativeEnqueued: ChatSpace returned its pending id, the send has started;
 * - nativeEnqueued → nativeAccepted: the exact server id from the intercepted response;
 * - nativeAccepted → sentObserved: the outgoing echo with the same id, account and fan;
 * - a proven final native refusal (4xx except 401, e.g. Message Guard) → rejected;
 * - after a possible queue call: timeout, reload, lost answer, 401 without a receipt of
 *   the finished chain, observer failure or ambiguity → uncertain;
 * - uncertain → sentObserved only when the late second half of an already linked pair
 *   (receipt and echo with the same id) arrives. Never back to ready.
 */
export const SEND_ATTEMPT_TRANSITIONS = {
  ready: ['preparing'],
  preparing: ['held', 'notEnqueued', 'nativeEnqueued', 'uncertain'],
  held: [],
  notEnqueued: [],
  nativeEnqueued: ['nativeAccepted', 'rejected', 'uncertain'],
  nativeAccepted: ['sentObserved', 'uncertain'],
  sentObserved: [],
  rejected: [],
  uncertain: ['sentObserved'],
} as const satisfies Record<SendAttemptState, readonly SendAttemptState[]>;

/** States after which a NEW attempt (new click, new attemptId) is allowed for this part. */
export const SEND_ATTEMPT_RETRYABLE_ENDS = ['held', 'notEnqueued'] as const satisfies readonly SendAttemptState[];

/** States that keep the hub custody and hold the fan and the group (§6.7.7 п. 4–6, §6.7.9). */
export const SEND_ATTEMPT_CUSTODY_STATES = ['preparing', 'nativeEnqueued', 'nativeAccepted', 'uncertain'] as const satisfies readonly SendAttemptState[];

/** Inputs of the attempt machine; R10 implements the reducer over SEND_ATTEMPT_TRANSITIONS. */
export type SendAttemptInput =
  | { readonly type: 'click'; readonly cause: z.infer<typeof HumanCauseSchema> }
  | { readonly type: 'held'; readonly code: z.infer<typeof CgCodeSchema> }
  | { readonly type: 'notEnqueued' }
  | { readonly type: 'nativeEnqueued'; readonly pendingId: string }
  | { readonly type: 'receipt'; readonly httpStatus: number; readonly platformMessageId: string | null }
  | { readonly type: 'echo'; readonly platformMessageId: string }
  | { readonly type: 'nativeRejected'; readonly httpStatus: number; readonly code: z.infer<typeof CgCodeSchema>; readonly guardTopics?: readonly string[] }
  | { readonly type: 'lost'; readonly code: z.infer<typeof CgCodeSchema> };

export const SendAttemptViewSchema = z.strictObject({
  attemptId: UuidSchema,
  state: SendAttemptStateSchema,
  code: z.optional(CgCodeSchema),
  /** Only from the receipt; a string, never a number. */
  platformMessageId: z.optional(NativeIdSchema),
  detail: z.optional(
    z.strictObject({
      /** Message Guard topics as ChatSpace reported them. */
      guardTopics: z.optional(z.array(displayText(64)).check(z.maxLength(16))),
      upstream: z.optional(displayText(400)),
    }),
  ),
});
export type SendAttemptView = z.infer<typeof SendAttemptViewSchema>;

/** Why the hub custody exists: an «Новые» greeting or a Spenders preview reply (H-7). */
export const SEND_PURPOSES = ['greeting', 'preview-reply'] as const;
export const SendPurposeSchema = z.enum(SEND_PURPOSES);

/** The parts of one generation form one group: same generationRef, chosen variant, part order (§6.7.9). */
export const SendGroupSchema = z.strictObject({
  generationRef: RefSchema,
  variant: z.int().check(z.gte(0), z.lte(2)),
  partCount: z.int().check(z.gte(1), z.lte(10)),
});
export type SendGroup = z.infer<typeof SendGroupSchema>;

/**
 * One record of `send.journal` in storage.local, written BEFORE the command
 * goes to MAIN; no text. An unwritten record means no queue call. Uncertain
 * records live until resolved, independent of the 30-minute result TTL.
 */
export const SendJournalEntrySchema = z.strictObject({
  attemptId: UuidSchema,
  /** The lock key's parts: one attempt at a time per (hubOrigin, pageId, platform, fanRef). */
  hubOrigin: HubOriginSchema,
  pageId: HubIntIdSchema,
  platform: PlatformSchema,
  fanRef: NativeIdSchema,
  hostAccountId: NativeIdSchema,
  purpose: SendPurposeSchema,
  opId: UuidSchema,
  group: SendGroupSchema,
  partIndex: z.int().check(z.gte(0), z.lte(9)),
  previewRevision: CountSchema,
  documentEpoch: EpochTokenSchema,
  state: SendAttemptStateSchema,
  code: z.optional(CgCodeSchema),
  pendingId: z.optional(PendingIdSchema),
  platformMessageId: z.optional(NativeIdSchema),
  createdAt: EpochMsSchema,
  updatedAt: EpochMsSchema,
});
export type SendJournalEntry = z.infer<typeof SendJournalEntrySchema>;

/** `${hubOrigin}|${pageId}|${platform}|${fanRef}` — the background serializes attempts per this key. */
export type SendLockKey = `${string}|${number}|${string}|${string}`;

export function sendLockKey(entry: Pick<SendJournalEntry, 'hubOrigin' | 'pageId' | 'platform' | 'fanRef'>): SendLockKey {
  return `${entry.hubOrigin}|${entry.pageId}|${entry.platform}|${entry.fanRef}`;
}

/** X8 port of HostPort (§5.2): side-effect-free preflight, exactly one queue call per attempt. */
export interface PreviewSendPort {
  preflight(req: PreviewSendRequest): PreviewSendPreflight;
  commit(req: PreviewSendRequest, ticket: DispatchTicket): Promise<PreviewSendCommit>;
  onState(attemptId: string, cb: (view: SendAttemptView) => void): () => void;
}
