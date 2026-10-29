// X8: send from a preview through ChatSpace's own send queue on a human click
// (architecture.md §5.2 "X8", §6.7). Schemas of the port, the freshness
// checkpoint, the hub's one-time dispatch ticket, the attempt view and the
// attempt journal record; the state machine and the end rules as plain data
// are in send-rules.ts. An outcome that is not proven is `uncertain` and is
// NEVER retried; only the late second half of an already linked
// receipt/echo pair may still turn it into `sentObserved`.

import * as z from 'zod/mini';

import { CgCodeSchema, type CgCode } from './errors';
import { HumanCauseSchema, PartRefSchema, PlatformSchema, TargetSchema, type HumanCause, type PartRef } from './ids';
import { PART_LIMITS, SEND_LIMITS } from './limits';
import { SendMediaSchema } from './send-media';
import { PREVIEW_SEND_CONDITION_CODES, SEND_ATTEMPT_STATES, SEND_FUSE_EVIDENCE, SEND_FUSE_REASONS, isNativeRefusalStatus } from './send-rules';
import {
  CountSchema,
  EpochMsSchema,
  EpochTokenSchema,
  GenerationRefSchema,
  HubIntIdSchema,
  HubOriginSchema,
  NativeIdSchema,
  RefSchema,
  UuidSchema,
  boundedText,
  displayText,
  type NativeId,
} from './primitives';

/**
 * Freshness checkpoint, taken synchronously in MAIN when the Generate click's
 * request reaches it, and kept unchanged by the operation (§6.7.5).
 * `coverage: 'unknown'` means the observation cannot prove "nothing new",
 * never "nothing new".
 */
export const FreshnessCheckpointSchema = z
  .strictObject({
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
    /**
     * The fan messages this document saw for (account, fan) before the
     * checkpoint, newest first, at most knownFanMessagesMax: the bounded set
     * the served-context check asks the hub about (body `knownFanMessageIds`,
     * §6.7.5). Order is arrival, never id size. The first is lastFanMessageId.
     */
    knownFanMessageIds: z.array(NativeIdSchema).check(z.maxLength(SEND_LIMITS.knownFanMessagesMax)),
    observedAt: EpochMsSchema,
    coverage: z.enum(['ok', 'unknown']),
  })
  .check(
    z.refine((c) => (c.knownFanMessageIds[0] ?? null) === c.lastFanMessageId, { message: 'the newest known id is lastFanMessageId' }),
    z.refine((c) => new Set(c.knownFanMessageIds).size === c.knownFanMessageIds.length, { message: 'known ids repeat' }),
  );
export type FreshnessCheckpoint = z.infer<typeof FreshnessCheckpointSchema>;

/** The checkpoint was taken for exactly this chat (account and fan as strings). */
export function checkpointMatches(checkpoint: FreshnessCheckpoint, hostAccountId: string, platformFanId: string): boolean {
  return checkpoint.hostAccountId === hostAccountId && checkpoint.platformFanId === platformFanId;
}

const CHECKPOINT_OF_TARGET = { message: 'the checkpoint belongs to the target chat' } as const;

/**
 * What the human asked to send: one part of one finished generation. Parts
 * are not editable in v1 (ui-design §4.13, §4.16 have no part editor):
 * `plainText` is the parsed AI part as shown, so `isAiGenerated` compares it
 * with itself; a future part editor is a new contract version.
 */
export const PreviewSendRequestSchema = z
  .strictObject({
    attemptId: UuidSchema,
    target: TargetSchema,
    /** Hub `meta.requestId` of the generation. */
    generationRef: GenerationRefSchema,
    part: PartRefSchema,
    /**
     * Revision of the preview's local draft field (the Fix source, a greeting
     * draft) the result was made from; a newer revision voids the attempt
     * (CG-SEND-PART). Results not made from the draft carry the revision current at Generate.
     */
    previewRevision: CountSchema,
    plainText: boundedText(SEND_LIMITS.previewDraftMaxChars),
    /** ChatSpace's own "text from AI" mark, by its rule against the ORIGINAL chosen AI part (§6.7.1). */
    isAiGenerated: z.boolean(),
    /** The operation's checkpoint, taken at Generate (at the click when the tab no longer has it, `acceptFreshness`). */
    checkpoint: FreshnessCheckpointSchema,
    /** The person pressed «Отправить всё равно» on a freshness warning: condition 14 is not checked again for this attempt. */
    acceptFreshness: z.optional(z.literal(true)),
    cause: HumanCauseSchema,
    /** 1.30.0 (X53): the vault media the part takes along, as picked at the click; absent — the part's text alone. */
    media: z.optional(SendMediaSchema),
  })
  .check(z.refine((r) => checkpointMatches(r.checkpoint, r.target.chat.hostAccountId, r.target.chat.platformFanId), CHECKPOINT_OF_TARGET));
export type PreviewSendRequest = z.infer<typeof PreviewSendRequestSchema>;

/** The hub's one-time permission for exactly one attempt (H-7 `dispatch`); short-lived, never batched. */
export const DispatchTicketSchema = z.strictObject({
  attemptId: UuidSchema,
  ticket: boundedText(512),
  /** Local clock: localDeadline(custody.ticketExpiresAt, serverNow, receivedAt), never the server instant as is. */
  expiresAt: EpochMsSchema,
});
export type DispatchTicket = z.infer<typeof DispatchTicketSchema>;

/** One of PREVIEW_SEND_CONDITION_CODES (send-rules.ts). */
export const PreviewSendConditionCodeSchema = z.enum(PREVIEW_SEND_CONDITION_CODES);

/** The freshness conditions a person may pass by a second click («Отправить всё равно»): a warning, never a hold of its own. */
export const FRESHNESS_WARNING_CODES = ['CG-SEND-STALE', 'CG-SEND-FRESHNESS'] as const satisfies readonly (typeof PREVIEW_SEND_CONDITION_CODES)[number][];
export type FreshnessWarningCode = (typeof FRESHNESS_WARNING_CODES)[number];
export const FreshnessWarningCodeSchema = z.enum(FRESHNESS_WARNING_CODES);

/**
 * Side-effect-free check for the button: a reason when it must stay disabled. `warn` — every hold passed, but the fan
 * wrote since Generate or that cannot be checked (2026-10-20 audit, rows 3–4): the row warns and offers «Отправить всё
 * равно»; a send without `acceptFreshness` is still held with that code.
 */
export const PreviewSendPreflightSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), warn: z.optional(FreshnessWarningCodeSchema) }),
  z.strictObject({ ok: z.literal(false), code: PreviewSendConditionCodeSchema, detail: z.optional(displayText(400)) }),
]);
export type PreviewSendPreflight = z.infer<typeof PreviewSendPreflightSchema>;

/** ChatSpace's local id of the queued record (a UUID of theirs): links the attempt, never a delivery proof. */
export const PendingIdSchema = RefSchema;

/**
 * Result of the single queue call. A repeated command with the same attemptId
 * returns the first result. A bridge failure of this call (timeout, transport
 * error) is `uncertain`, never a «not sent» (bridge.ts BRIDGE_WRITE_FAILURES).
 */
export const PreviewSendCommitSchema = z.discriminatedUnion('state', [
  /** Queued; the native send already started. */
  z.strictObject({ state: z.literal('nativeEnqueued'), pendingId: PendingIdSchema }),
  /** The queue returned null (Mimic or 50 entries in the chat) with the call boundary intact. */
  z.strictObject({ state: z.literal('notEnqueued'), code: z.literal('CG-SEND-QUEUE') }),
  /**
   * Nothing touched the queue: a condition failed in the same synchronous step,
   * or the ticket's deadline passed (CG-TIMEOUT: a late command is held, never a late send).
   */
  z.strictObject({ state: z.literal('held'), code: z.union([PreviewSendConditionCodeSchema, z.literal('CG-TIMEOUT')]) }),
  /** The queue may have been called but the result is not known. */
  z.strictObject({ state: z.literal('uncertain'), code: z.literal('CG-SEND-UNCERTAIN') }),
]);
export type PreviewSendCommit = z.infer<typeof PreviewSendCommitSchema>;

/** §6.7.7; the transitions and the end rules are in send-rules.ts. */
export const SendAttemptStateSchema = z.enum(SEND_ATTEMPT_STATES);

/** Inputs of the attempt machine; R10 implements the reducer over SEND_ATTEMPT_TRANSITIONS. */
export type SendAttemptInput =
  | { readonly type: 'click'; readonly cause: HumanCause }
  | { readonly type: 'held'; readonly code: CgCode }
  | { readonly type: 'notEnqueued'; readonly code: CgCode }
  | { readonly type: 'nativeEnqueued'; readonly pendingId: string }
  /** The intercepted response of exactly this attempt; a 401 is not an outcome (§6.7.6). */
  | { readonly type: 'receipt'; readonly httpStatus: number; readonly platformMessageId: NativeId | null }
  /** The outgoing echo with the same id, account and fan. */
  | { readonly type: 'echo'; readonly platformMessageId: NativeId }
  | { readonly type: 'nativeRejected'; readonly httpStatus: number; readonly code: CgCode; readonly guardTopics?: readonly string[] }
  /** Timeout, reload, lost answer, observer failure or ambiguity after a possible queue call. */
  | { readonly type: 'lost'; readonly code: CgCode };

/**
 * One attempt as MAIN observed it, and as the background journals and
 * reports it. `httpStatus` is the status of the intercepted response of
 * exactly this attempt, carried only by a proven refusal: the background
 * reports the hub's `failed: native_rejected` with it (H-7 needs a 4xx other
 * than 401). Message Guard recognised at the end of a 401 chain has no
 * status of its own: it shows as `rejected`, but the custody waits for the
 * hub's `resolve` (SEND_CUSTODY_REPORTS).
 */
export const SendAttemptViewSchema = z
  .strictObject({
    attemptId: UuidSchema,
    state: SendAttemptStateSchema,
    code: z.optional(CgCodeSchema),
    /** Only from the receipt; a string, never a number. */
    platformMessageId: z.optional(NativeIdSchema),
    httpStatus: z.optional(z.int().check(z.gte(100), z.lte(599))),
    detail: z.optional(
      z.strictObject({
        /** Message Guard topics as ChatSpace reported them. */
        guardTopics: z.optional(z.array(displayText(64)).check(z.maxLength(16))),
        upstream: z.optional(displayText(400)),
      }),
    ),
  })
  .check(
    z.refine((v) => v.httpStatus === undefined || (v.state === 'rejected' && isNativeRefusalStatus(v.httpStatus)), {
      message: 'httpStatus belongs to a rejected attempt and is a 4xx other than 401',
    }),
    z.refine((v) => v.state !== 'rejected' || v.code !== 'CG-SEND-REJECTED' || v.httpStatus !== undefined, {
      message: 'CG-SEND-REJECTED is proven by the intercepted status',
    }),
  );
export type SendAttemptView = z.infer<typeof SendAttemptViewSchema>;

/**
 * 1.30.0 (X53): what a part took along, as the hub records who sent the message (X48, `clientSendAttributions`): a
 * price above zero, media. The background never sees the media themselves, only these two marks.
 */
export const SendMarksSchema = z.strictObject({ priced: z.boolean(), withMedia: z.boolean() });
export type SendMarks = z.infer<typeof SendMarksSchema>;

/** Why the hub custody exists: an «Новые» greeting or a Spenders preview reply (H-7). */
export const SEND_PURPOSES = ['greeting', 'preview-reply'] as const;
export const SendPurposeSchema = z.enum(SEND_PURPOSES);

/**
 * The parts of one generation form one group: same generationRef, chosen
 * variant, part order (§6.7.9). `variant` is the Hi variant; every other
 * feature has one variant, 0 — a PartRef without `variant` means 0 in the
 * group and in the hub custody key.
 */
export const SendGroupSchema = z.strictObject({
  generationRef: GenerationRefSchema,
  variant: z.int().check(z.gte(0), z.lte(PART_LIMITS.maxVariants - 1)),
  partCount: z.int().check(z.gte(1), z.lte(PART_LIMITS.maxParts)),
});
export type SendGroup = z.infer<typeof SendGroupSchema>;

/** The part is a member of the group: same variant (absent = 0), index below the part count. */
export function partInGroup(part: PartRef, group: SendGroup): boolean {
  return (part.variant ?? 0) === group.variant && part.index < group.partCount;
}

/**
 * One record of `send.journal` in storage.local, written BEFORE the command
 * goes to MAIN; no text. An unwritten record means no queue call. Uncertain
 * records live until resolved, independent of the 30-minute result TTL.
 */
export const SendJournalEntrySchema = z
  .strictObject({
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
  partIndex: z.int().check(z.gte(0), z.lte(PART_LIMITS.maxParts - 1)),
  previewRevision: CountSchema,
  documentEpoch: EpochTokenSchema,
  state: SendAttemptStateSchema,
  code: z.optional(CgCodeSchema),
  pendingId: z.optional(PendingIdSchema),
  platformMessageId: z.optional(NativeIdSchema),
  /** 1.30.0 (X53): the marks of what the part took along; absent — its text alone. */
  marks: z.optional(SendMarksSchema),
  /** A manual preview has no scheduler operation: keep its authenticated sign-in for late send attribution. */
  manualOwner: z.optional(z.strictObject({ userId: HubIntIdSchema, epoch: CountSchema })),
  createdAt: EpochMsSchema,
  updatedAt: EpochMsSchema,
  })
  .check(z.refine((e) => e.partIndex < e.group.partCount, { message: 'partIndex must be below the group part count' }));
export type SendJournalEntry = z.infer<typeof SendJournalEntrySchema>;

/** `${hubOrigin}|${pageId}|${platform}|${fanRef}` — the background serializes attempts per this key. */
export type SendLockKey = `${string}|${number}|${string}|${string}`;

export function sendLockKey(entry: Pick<SendJournalEntry, 'hubOrigin' | 'pageId' | 'platform' | 'fanRef'>): SendLockKey {
  return `${entry.hubOrigin}|${entry.pageId}|${entry.platform}|${entry.fanRef}`;
}

/**
 * 1.11.0 (decision X25): what MAIN saw after an X8 send that the fuse trips on
 * (the bridge's `previewSendFuse`, the host port's `sendFuse` event). Never a
 * text: the lengths of the two texts compared, as ChatSpace shows them, when
 * the reason is `text`.
 */
export const SendFuseFactSchema = z.strictObject({
  attemptId: UuidSchema,
  reason: z.enum(SEND_FUSE_REASONS),
  where: z.enum(SEND_FUSE_EVIDENCE),
  /** Characters of the part we queued and of the text seen, white space aside (`text` only). */
  sentChars: z.optional(CountSchema),
  seenChars: z.optional(CountSchema),
});
export type SendFuseFact = z.infer<typeof SendFuseFactSchema>;

/** The fuse as the background keeps it (storage.local `send.fuse`): what tripped it, when, on which ChatSpace build. No text. */
export const SendFuseSchema = z.strictObject({
  trippedAt: EpochMsSchema,
  reason: z.enum(SEND_FUSE_REASONS),
  where: z.enum(SEND_FUSE_EVIDENCE),
  /**
   * The ChatSpace build the trip was seen on (HostContractReport `build`, the hashed name of its entry module). The
   * fuse holds while a tab runs this build; another build lifts it. null — every build: the build was not known, or
   * the fuse tripped on two builds in a row; only the person's reset lifts it then.
   */
  build: z.nullable(displayText(80)),
  /** The attempt whose outcome tripped it; null — a run of outcomes, no single attempt. */
  attemptId: z.nullable(UuidSchema),
});
export type SendFuse = z.infer<typeof SendFuseSchema>;

/** The fuse's state: the one that holds (null — none) and when the person last reset it (null — never). */
export const SendFuseStateSchema = z.strictObject({
  fuse: z.nullable(SendFuseSchema),
  resetAt: z.nullable(EpochMsSchema),
});
export type SendFuseState = z.infer<typeof SendFuseStateSchema>;

/**
 * X8 port of HostPort (§5.2): side-effect-free preflight, exactly one queue
 * call per attempt. Both calls go to MAIN, which alone sees the conditions;
 * a preflight the bridge cannot answer is `{ok: false, code: 'CG-SEND-HOST'}`.
 */
export interface PreviewSendPort {
  preflight(req: PreviewSendRequest): Promise<PreviewSendPreflight>;
  commit(req: PreviewSendRequest, ticket: DispatchTicket): Promise<PreviewSendCommit>;
  onState(attemptId: string, cb: (view: SendAttemptView) => void): () => void;
}
