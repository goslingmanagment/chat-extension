// AI operations (architecture.md §5.5, §7). One writer in the background
// admits operations atomically: one per chat across the extension, three per
// tab, no queue. Closing the owning tab detaches the surface but does not
// cancel the generation. Nothing indeterminate is ever repeated.

import * as z from 'zod/mini';

import { CgErrorWireSchema } from './errors';
import { FeatureIdSchema, SurfaceSchema, ToneSchema, freshTextSurface, isFreshTextFeature, type FeatureId, type SiteOpId, type Surface, type Tone } from './features';
import { HiFanAvatarUrlSchema, StartProofV1Schema, hasHiStartFields, hasOnlyPersonalCount, hiStartProofMatches } from './hi-start-proof';
import { LiveImagesSchema, LiveTextMessageSchema, LiveTextTailSchema, OPEN_CHAT_PRICE_MAX, type ChatWindow, type HostPort, type LiveImage, type LiveTextTail } from './host';
import { ChatRefSchema, HumanCauseSchema, TargetSchema, type HostIdentity, type HumanCause, type Target } from './ids';
import { AI_REQUEST_LIMITS, COACH_LIMITS, COVERAGE_CHECK_LIMITS, LIVE_PPV_LIMITS, LIVE_TEXT_LIMITS, OP_LIMITS, SEND_LIMITS } from './limits';
import {
  CountSchema,
  DigestSchema,
  DurationMsSchema,
  EpochMsSchema,
  GenerationRefSchema,
  IsoTimestampSchema,
  MicroUsdSchema,
  NATIVE_ID_PATTERN,
  NativeIdSchema,
  OpenTokenSchema,
  UuidSchema,
  boundedText,
  displayText,
  type IsoTimestamp,
} from './primitives';
import { FreshnessCheckpointSchema, checkpointMatches } from './send';
import type { SettingsExt } from './settings-ext';
import type { UNAVAILABLE_REASONS, UnavailableReasonId } from './vm/catalog';

export const OP_STATES = ['admitted', 'requesting', 'streaming', 'done', 'failed', 'canceled', 'interrupted'] as const;
export const OpStateSchema = z.enum(OP_STATES);
export type OpState = z.infer<typeof OpStateSchema>;

export const OP_TERMINAL_STATES = ['done', 'failed', 'canceled', 'interrupted'] as const satisfies readonly OpState[];

/** Allowed state changes; `interrupted` = the environment cut the work, never retried by itself. */
export const OP_TRANSITIONS = {
  admitted: ['requesting', 'failed', 'canceled', 'interrupted'],
  requesting: ['streaming', 'failed', 'canceled', 'interrupted'],
  streaming: ['done', 'failed', 'canceled', 'interrupted'],
  done: [],
  failed: [],
  canceled: [],
  interrupted: [],
} as const satisfies Record<OpState, readonly OpState[]>;

/**
 * Finer waiting stage inside a state, for the waiting bubble and the profiler
 * (AI-083, DB-011). `retry-wait` is the single 5-second wait after a
 * structured service_unavailable before the first output frame.
 */
export const PHASE_NAMES = [
  'admitted',
  'connecting',
  'awaiting-meta',
  'awaiting-first-chunk',
  'streaming',
  'retry-wait',
  'parsing',
  'saving-profile',
  'settled',
] as const;
export const PhaseSchema = z.strictObject({
  name: z.enum(PHASE_NAMES),
  since: EpochMsSchema,
  /** Only in `retry-wait`: when the one transparent retry fires. */
  retryAt: z.optional(EpochMsSchema),
});
export type Phase = z.infer<typeof PhaseSchema>;

/** One past exchange sent as `coachHistory` (long answers are compressed before, AI-088). */
export const CoachTurnSchema = z.strictObject({
  question: boundedText(COACH_LIMITS.questionMaxChars),
  answer: boundedText(COACH_LIMITS.answerMaxChars),
});
export type CoachTurn = z.infer<typeof CoachTurnSchema>;

/** Draft text attached to an operation: Fix's source, Coach's «приложить мой ответ». */
export const OpDraftSchema = z.strictObject({
  text: boundedText(AI_REQUEST_LIMITS.draftMaxChars),
  revision: CountSchema,
  digest: DigestSchema,
});

// ── The window check (1.15.0, R20: spec §3, architecture §5.8, §9.1; hub HF-8в) ─────────────────────────────

/** One message of the check window: its id and the side that sent it, never a text. Media-only and automated ones too. */
export const CoverageWindowEntrySchema = z.strictObject({ id: NativeIdSchema, dir: z.enum(['fan', 'model']) });
export type CoverageWindowEntry = z.infer<typeof CoverageWindowEntrySchema>;
/** The check window as the hub takes it (`coverageCheck.window`): the tab's order, which the hub's answers keep. */
export const CoverageWindowSchema = z.array(CoverageWindowEntrySchema).check(z.maxLength(COVERAGE_CHECK_LIMITS.windowMax));
/** The window's messages the tab saw deleted (`coverageCheck.deletedIds`); never in the window itself. */
export const CoverageDeletedIdsSchema = z.array(NativeIdSchema).check(z.maxLength(COVERAGE_CHECK_LIMITS.deletedMax));

/** Every id of the check is named once across both lists: the hub refuses a repeat (400), one id with two answers is none. */
export function coverageIdsOnce(window: readonly CoverageWindowEntry[], deletedIds: readonly string[]): boolean {
  const ids = new Set([...window.map((entry) => entry.id), ...deletedIds]);
  return ids.size === window.length + deletedIds.length;
}

type ProofShape = {
  readonly window: readonly CoverageWindowEntry[];
  readonly knownFanMessageIds: readonly string[];
  readonly deletedIds: readonly string[];
  readonly tail?: readonly { readonly platformMessageId: string; readonly direction: 'fan' | 'model' }[] | undefined;
  readonly truncated?: boolean;
};

/**
 * Every id of the check comes from the window (FS-TAIL-1): each once, the fan's known messages are the window's fan
 * messages, the tail is the window's messages with a text, on the same side; texts are dropped only from a tail.
 */
function proofIdsHold(p: ProofShape): boolean {
  const side = new Map(p.window.map((entry) => [entry.id, entry.dir]));
  return (
    coverageIdsOnce(p.window, p.deletedIds) &&
    new Set(p.knownFanMessageIds).size === p.knownFanMessageIds.length &&
    p.knownFanMessageIds.every((id) => side.get(id) === 'fan') &&
    (p.tail ?? []).every((m) => side.get(m.platformMessageId) === m.direction) &&
    (p.truncated !== true || p.tail !== undefined)
  );
}

const proofShape = {
  /** The conversation the proof is of — the target's (on Fansly the group id, FS-IDN-6). */
  conversationRef: NativeIdSchema,
  /** `complete` — the observation of the chat is unbroken (FS-TAIL-4) or the pass walked it whole; else `unknown`. */
  completeness: z.enum(['complete', 'unknown']),
  /** When it was taken: the tail's `capturedAt`; not part of the proof's identity (the request key). */
  takenAt: IsoTimestampSchema,
  /** The chat's last min(60, messageCount) messages, both sides (FS-TAIL-1). Empty — the chat has none. */
  window: CoverageWindowSchema,
  /** The fan's newest messages of the window, newest first, as the hub body takes them (`knownFanMessageIds`). */
  knownFanMessageIds: z.array(NativeIdSchema).check(z.maxLength(SEND_LIMITS.knownFanMessagesMax)),
  deletedIds: CoverageDeletedIdsSchema,
};

/**
 * 1.15.0 (R20 §9.1, FS-TAIL-6, FS-NEW-7): what proves a generation fresh on a host whose own tab observes its chats
 * — the check window and the ids the hub is asked about (`coverageCheck`, `knownFanMessageIds`). Two sources:
 * - `tab-snapshot` — the tab's snapshot of the Generate click (Fansly: MAIN's `FanslySnapshot`, which the site's AI
 *   policy turns into this shared form); a draft function's texts are inside (`tail`), so the text the hub reads and
 *   the ids it is asked about come from one instant;
 * - `pass` — a pass the background ran itself («Новые» on Fansly, Б17): the checked history and, since 1.41.0
 *   (X69), its confirmed messages with text for the greeting's live context.
 * The background builds the request from it and reads the hub's answer against it (`coverageCheckVerdict`).
 */
export const CoverageProofSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('tab-snapshot'),
      ...proofShape,
      /** Reply, Fix, Hi, Ping only (D-14): the window's messages with a text, oldest first; empty — none has one. */
      tail: z.optional(z.array(LiveTextMessageSchema).check(z.maxLength(LIVE_TEXT_LIMITS.maxItems))),
      /** Old texts were dropped to keep the snapshot in its frame: the result is not verified fresh (spec §3.5). */
      truncated: z.boolean(),
    }),
    // Not `host-pass`: that word is the source of a feature in Fansly's manifest alone, and stays out of ChatSpace's chunks.
    z.strictObject({ kind: z.literal('pass'), ...proofShape, tail: z.optional(z.array(LiveTextMessageSchema).check(z.maxLength(LIVE_TEXT_LIMITS.maxItems))) }),
  ])
  .check(z.refine(proofIdsHold, { message: 'proof ids: each once, all of its window' }));
export type CoverageProof = z.infer<typeof CoverageProofSchema>;

/** The start's evidence kept with its result (1.15.0, R20 P8b3): ids and flags only, never page text. */
export const CoverageFingerprintSchema = z.strictObject({
  completeness: proofShape.completeness,
  truncated: z.boolean(),
  window: CoverageWindowSchema,
  knownFanMessageIds: proofShape.knownFanMessageIds,
  deletedIds: CoverageDeletedIdsSchema,
  /** The original draft carried a non-empty tail; its text is discarded. */
  text: z.boolean(),
}).check(z.refine((p) =>
  coverageIdsOnce(p.window, p.deletedIds) &&
  new Set(p.knownFanMessageIds).size === p.knownFanMessageIds.length &&
  p.knownFanMessageIds.every((id) => p.window.some((entry) => entry.id === id && entry.dir === 'fan')),
));
export type CoverageFingerprint = z.infer<typeof CoverageFingerprintSchema>;

/** The automatic recap is an internal step of Coach and keeps its panel identity. */
function textSurfaceFits(op: { readonly feature: FeatureId; readonly surface: Surface }): boolean {
  return freshTextSurface(op.feature) === op.surface || (op.surface === 'coach' && (op.feature === 'recap' || op.feature === 'recap-short'));
}

/** The starts that carry the fan's newest photos as images (`StartOp.liveImages`): Reply, Fix and Coach, where they answer the fan. */
export const LIVE_IMAGE_FEATURES: ReadonlySet<FeatureId> = new Set<FeatureId>(['reply', 'fix', 'coach']);

/** A start proves its freshness one way: a proof is the target's, never beside ChatSpace's tail or X8's checkpoint. */
function proofFits(op: {
  readonly feature: FeatureId;
  readonly surface: Surface;
  readonly target: { readonly conversationRef: string };
  readonly fresh?: unknown;
  readonly checkpoint?: unknown;
  readonly proof?: CoverageProof | undefined;
}): boolean {
  const proof = op.proof;
  if (proof === undefined) return true;
  if (proof.conversationRef !== op.target.conversationRef || op.fresh !== undefined || op.checkpoint !== undefined) return false;
  return proof.kind === 'pass' ? op.surface === 'newcomers' && (proof.tail === undefined || op.feature === 'hi') : proof.tail === undefined || isFreshTextFeature(op.feature) || textSurfaceFits(op);
}

/**
 * 1.27.0 (decision X54): the PPV state of the open OnlyFans chat as the platform gives it at the Generate click — the
 * model's paid messages among the chat's newest, read from OnlyMonster's API, with their listed price (USD) and
 * whether the fan bought them (OnlyFans' `isOpened`). Ids and facts, no text. A draft start in the dock carries it
 * (`StartOp.livePpv`); the hub takes the same shape as `livePpvContext` and applies it to that one generation.
 */
/** ChatSpace's item: the model's paid message (OnlyFans sells a message). */
export const LivePpvMessageItemSchema = z.strictObject({ platformMessageId: NativeIdSchema, priceUsd: z.number().check(z.gt(0), z.lte(OPEN_CHAT_PRICE_MAX)), purchased: z.boolean() });

/**
 * Fansly's item (hub `live-ppv-fansly-v1`): one paid attachment of the model's message — Fansly sells each media or
 * bundle, not the message — read by the background from Fansly at the click (core services/hosts/fansly/ppv.ts): paid
 * by its PPV permission row, bought by the fan's inline order on the chat's page, not bought only by the fan's own empty
 * `/media/orderhistory` answer. The price when the page served one.
 */
export const LivePpvAttachmentItemSchema = z.strictObject({
  platformMessageId: NativeIdSchema,
  contentKind: z.enum(['media', 'bundle']),
  contentRef: NativeIdSchema,
  priceUsd: z.optional(z.number().check(z.gt(0), z.lte(OPEN_CHAT_PRICE_MAX))),
  purchased: z.boolean(),
});
export type LivePpvAttachmentItem = z.infer<typeof LivePpvAttachmentItemSchema>;

/** An item's identity (the hub's key): a message once; an attachment once per message. */
const livePpvItemKey = (item: { readonly platformMessageId: string; readonly contentKind?: string; readonly contentRef?: string }): string =>
  item.contentRef === undefined ? item.platformMessageId : `${item.platformMessageId}/${item.contentKind}:${item.contentRef}`;

export const LivePpvStateSchema = z.strictObject({
  capturedAt: IsoTimestampSchema,
  items: z
    .array(z.union([LivePpvMessageItemSchema, LivePpvAttachmentItemSchema]))
    .check(
      z.minLength(1),
      z.maxLength(LIVE_PPV_LIMITS.maxItems),
      z.refine((items) => new Set(items.map(livePpvItemKey)).size === items.length, { message: 'PPV ids repeat' }),
    ),
});
export type LivePpvState = z.infer<typeof LivePpvStateSchema>;

/** Whether every item is of one site's shape: Fansly's attachments, or ChatSpace's messages. */
export function livePpvShapeIs(state: LivePpvState, shape: 'attachments' | 'messages'): boolean {
  return state.items.every((item) => ('contentRef' in item) === (shape === 'attachments'));
}

export const StartOpSchema = z
  .strictObject({
    feature: FeatureIdSchema,
    surface: SurfaceSchema,
    target: TargetSchema,
    cause: HumanCauseSchema,
    /** Б1: one-off; Regenerate passes the original's tone. null = no tone. */
    tone: z.nullable(ToneSchema),
    /** Б7: snapshot of the setting at start. */
    split: z.boolean(),
    /** Б5 / R20 P4b2: wire messageCount ≤ 5000; the planner and background cap it by bootstrap `limits.deepMax`. */
    window: z.int().check(z.gte(AI_REQUEST_LIMITS.messageCountMin), z.lte(AI_REQUEST_LIMITS.messageCountMax)),
    draft: z.optional(OpDraftSchema),
    /** Hi in the dock — 3, «Новые» — 1. */
    variantCount: z.optional(z.union([z.literal(1), z.literal(3)])),
    coach: z.optional(
      z.strictObject({
        question: z.optional(boundedText(COACH_LIMITS.questionMaxChars)),
        preset: z.optional(z.literal('situation')),
        history: z.array(CoachTurnSchema).check(z.maxLength(COACH_LIMITS.historyMaxTurns)),
        attachDraft: z.optional(boundedText(AI_REQUEST_LIMITS.draftMaxChars)),
        /**
         * The auto-recap of a composite Coach turn (§7 «ход Coach с авто-рекапом
         * — один составной слот», AI-096): the background first builds this
         * recap for the same target, then asks the Coach. One admission and one
         * token for both steps; the chat's slot is held from the first to the
         * last of them. `window` is the recap's messageCount. The admitted
         * operation is the recap; its terminal view names the answer step in
         * `OpView.continuedBy`. Added in 1.2.0.
         */
        autoRecap: z.optional(
          z.strictObject({
            length: z.enum(['short', 'full']),
            window: z.int().check(z.gte(AI_REQUEST_LIMITS.messageCountMin), z.lte(AI_REQUEST_LIMITS.messageCountMax)),
          }),
        ),
      }),
    ),
    /**
     * Only reply|fix|hi|ping on surface `dock` with the freshText flag (D-14); 1.29.0 (decision X52) also review in
     * the dock and coach on its panel (`freshTextSurface`).
     */
    fresh: z.optional(LiveTextTailSchema),
    /**
     * 1.27.0 (X54): the open chat's PPV state, where `fresh` may go — ChatSpace's in a draft start in the dock; Fansly's
     * (each paid attachment) on every start that may carry fresh text.
     */
    livePpv: z.optional(LivePpvStateSchema),
    /** The fan's newest photos as images (hub `liveImages`, `live-images-v1`): Reply, Fix and Coach, where fresh text may go. */
    liveImages: z.optional(LiveImagesSchema),
    /**
     * Previews: the freshness checkpoint of the Generate click (X8), kept with
     * the opId. Optional so that a preview still generates when MAIN cannot
     * give one; such a result can be inserted, never sent (CG-SEND-FRESHNESS).
     */
    checkpoint: z.optional(FreshnessCheckpointSchema),
    /**
     * 1.15.0 (R20 §9.1): the freshness proof of a host whose tab observes its chats (Fansly) — the window check, and
     * a draft function's page text inside it. Never beside `fresh` or `checkpoint`; a pass's proof only in «Новые».
     */
    proof: z.optional(CoverageProofSchema),
    /** 1.15.0 (R20 HF-5): Hi on the second host, independent of the freshness proof; no proof is not a zero count. */
    startProof: z.optional(StartProofV1Schema),
    personalMessageCount: z.optional(CountSchema),
    /** FX-018: the page's avatar address, forwarded as an image to the provider by the hub. */
    fanAvatarUrl: z.optional(HiFanAvatarUrlSchema),
    regenerateOf: z.optional(UuidSchema),
    /** Bypass the result cache (Regenerate, Refresh). */
    force: z.optional(z.boolean()),
    /**
     * 1.48.0: «с Recap» is unticked in this chat — the generation reads no Recap of the fan (hub `recap: 'off'`, sent
     * to a hub that lists `recap-off-v1`). Never on a Recap build: a build switches it back on.
     */
    recap: z.optional(z.literal('off')),
    /**
     * 1.20.0 (decision X47): the fan as the starting surface already names them (the site's header or memory, the
     * hub's page alias of a board row) — for the refusal list, the toasts and the pages' «Идут сейчас». Display only:
     * not part of the request's identity, never sent to the hub, never logged.
     */
    fanLabel: z.optional(displayText(256)),
  })
  .check(
    z.refine((op) => op.fresh === undefined || textSurfaceFits(op), {
      message: 'fresh text only in the dock or the Coach turn',
    }),
    // ChatSpace's PPV state rides with the drafts in the dock; Fansly's (its attachments) wherever fresh text may go.
    z.refine((op) => op.livePpv === undefined || (livePpvShapeIs(op.livePpv, 'messages') ? op.surface === 'dock' && isFreshTextFeature(op.feature) : textSurfaceFits(op)), {
      message: 'PPV state only where fresh text may go',
    }),
    z.refine((op) => op.liveImages === undefined || (LIVE_IMAGE_FEATURES.has(op.feature) && textSurfaceFits(op)), {
      message: 'photos only on Reply, Fix and Coach where fresh text may go',
    }),
    z.refine((op) => op.coach === undefined || op.feature === 'coach', { message: 'coach fields only for coach' }),
    z.refine((op) => op.recap === undefined || (op.feature !== 'recap' && op.feature !== 'recap-short'), { message: 'a Recap build reads no Recap switch' }),
    z.refine((op) => op.feature !== 'fix' || op.draft !== undefined, { message: 'fix needs the draft' }),
    z.refine((op) => op.variantCount === undefined || op.feature === 'hi', { message: 'variantCount only for hi' }),
    z.refine((op) => op.tone === null || op.feature === 'reply', { message: 'a tone belongs to reply only (§8.4 replyTone)' }),
    z.refine((op) => op.checkpoint === undefined || op.surface === 'preview' || op.surface === 'newcomers', {
      message: 'a freshness checkpoint belongs to a preview',
    }),
    z.refine((op) => op.checkpoint === undefined || checkpointMatches(op.checkpoint, op.target.chat.hostAccountId, op.target.chat.platformFanId), {
      message: 'the checkpoint belongs to the target chat',
    }),
    // The words are short on purpose: every schema of this module weighs on the tab's request registry (its probe).
    z.refine(proofFits, { message: 'the proof does not fit the start' }),
    z.refine((op) => !hasHiStartFields(op) || (op.feature === 'hi' && (op.target.binding.platform === 'fansly' || (op.target.binding.platform === 'onlyfans' && hasOnlyPersonalCount(op)))), {
      message: 'Hi fields only on Fansly Hi; OnlyFans Hi only its personal count',
    }),
    z.refine((op) => hiStartProofMatches(op, op.target.conversationRef), { message: 'Hi proof conversation or count mismatch' }),
  );
export type StartOp = z.infer<typeof StartOpSchema>;

/** A running operation, for refusal lists, the palette and «идёт в другой вкладке». */
export const ActiveOpSummarySchema = z.strictObject({
  opId: UuidSchema,
  feature: FeatureIdSchema,
  surface: SurfaceSchema,
  chat: ChatRefSchema,
  /** Fan name for the list, display only; null = unknown. */
  fanLabel: z.nullable(displayText(256)),
  state: OpStateSchema,
  startedAt: EpochMsSchema,
  /** Started from the asking tab. */
  inThisTab: z.boolean(),
});
export type ActiveOpSummary = z.infer<typeof ActiveOpSummarySchema>;

/** Display metadata from a site registry, beside the closed common summary. Never an executable start. */
export const SiteActiveOpSummarySchema = z.strictObject({ ...ActiveOpSummarySchema.shape, feature: OpenTokenSchema.check(z.regex(/^[a-z][a-z0-9-]{0,63}$/)) });
export type SiteActiveOpSummary = z.infer<typeof SiteActiveOpSummarySchema>;
export type AnyActiveOpSummary = ActiveOpSummary | SiteActiveOpSummary;

export const AdmissionSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), opId: UuidSchema }),
  z.strictObject({
    ok: z.literal(false),
    code: z.enum(['CG-OP-CHAT-BUSY', 'CG-OP-TAB-LIMIT']),
    active: z.array(ActiveOpSummarySchema).check(z.maxLength(OP_LIMITS.perTab)),
    siteActive: z.optional(z.array(SiteActiveOpSummarySchema).check(z.maxLength(OP_LIMITS.perTab))),
  }).check(z.refine((value) => value.active.length + (value.siteActive?.length ?? 0) <= OP_LIMITS.perTab, { message: 'too many active operations' })),
]);
export type Admission = z.infer<typeof AdmissionSchema>;

/** How much of the history a number or a result covers; the hub's coverage words (§8.5, `context_v1`). */
export const COVERAGE_LEVELS = ['complete', 'partial', 'unknown'] as const;
export type CoverageLevel = (typeof COVERAGE_LEVELS)[number];

/** Coverage of the history a result was built from; null fields = unknown. */
export const CoverageSchema = z.strictObject({
  level: z.enum(COVERAGE_LEVELS),
  requested: z.nullable(CountSchema),
  served: z.nullable(CountSchema),
  asOf: z.nullable(IsoTimestampSchema),
});
export type Coverage = z.infer<typeof CoverageSchema>;

/** A numbered item of Review's mistakes/recommendations, with the «Как надо было:» example. */
export const ReviewItemSchema = z.strictObject({
  body: displayText(8000),
  /** Ready-to-send example message; never insertable from Review. */
  fix: z.nullable(displayText(4000)),
  /** Placement note of the example («после "[Photo]"»). */
  fixWhere: z.nullable(displayText(400)),
  afterFix: z.nullable(displayText(4000)),
});

export const REVIEW_SECTION_KINDS = ['verdict', 'money', 'persona', 'mistakes', 'works'] as const;

/** Review parsed for display only; `raw` stays the source of truth for copy (AI-053). */
export const ReviewDocSchema = z.strictObject({
  /** N/10; null when the model gave none. */
  rating: z.nullable(z.int().check(z.gte(1), z.lte(10))),
  lead: displayText(8000),
  sections: z
    .array(
      z.strictObject({
        kind: z.enum(REVIEW_SECTION_KINDS),
        body: displayText(16_000),
        items: z.array(ReviewItemSchema).check(z.maxLength(20)),
      }),
    )
    .check(z.maxLength(REVIEW_SECTION_KINDS.length)),
  recommendations: z.nullable(
    z.strictObject({
      lead: displayText(8000),
      items: z.array(ReviewItemSchema).check(z.maxLength(20)),
    }),
  ),
});
export type ReviewDoc = z.infer<typeof ReviewDocSchema>;

export const COACH_BLOCK_KINDS = ['situation', 'missed', 'move', 'risk'] as const;

/** Coach answer: prose (or labelled blocks) plus up to two drafts, each split into parts (AI-084, AI-085). */
export const CoachAnswerSchema = z.strictObject({
  prose: displayText(COACH_LIMITS.answerMaxChars),
  blocks: z.nullable(
    z
      .array(z.strictObject({ kind: z.enum(COACH_BLOCK_KINDS), body: displayText(COACH_LIMITS.answerMaxChars) }))
      .check(z.maxLength(COACH_BLOCK_KINDS.length)),
  ),
  drafts: z
    .array(
      z.strictObject({
        index: z.int().check(z.gte(0), z.lte(COACH_LIMITS.draftsMax - 1)),
        parts: z.array(boundedText(COACH_LIMITS.draftMaxChars)).check(z.minLength(1), z.maxLength(10)),
      }),
    )
    .check(z.maxLength(COACH_LIMITS.draftsMax)),
});
export type CoachAnswer = z.infer<typeof CoachAnswerSchema>;

const PartsSchema = z.array(boundedText(20_000)).check(z.minLength(1), z.maxLength(10));

/** Actions on a result are available only after `done` and a full parse (§7 «Разбор и Split»). */
export const OpResultSchema = z.discriminatedUnion('kind', [
  /** Reply, Fix, Ping. `splitRequested` with one part → «Получилась одна часть» (AI-011). */
  z.strictObject({ kind: z.literal('parts'), parts: PartsSchema, splitRequested: z.boolean() }),
  /** Hi: variants, each split into parts. */
  z.strictObject({ kind: z.literal('variants'), variants: z.array(PartsSchema).check(z.minLength(1), z.maxLength(3)) }),
  z.strictObject({ kind: z.literal('review'), doc: z.nullable(ReviewDocSchema), raw: displayText(64_000) }),
  z.strictObject({
    kind: z.literal('recap'),
    markdown: displayText(64_000),
    coverage: z.nullable(CoverageSchema),
    /** Recaps are shared by every granted chatter of the page (H-13, D-31). */
    shared: z.strictObject({ generationRef: GenerationRefSchema }),
  }),
  z.strictObject({ kind: z.literal('coach'), answer: CoachAnswerSchema }),
]);
export type OpResult = z.infer<typeof OpResultSchema>;

/** Hub readers that may have served a generation (`context_v1.source`); `live_union` is the hub's Fansly socket overlay. */
export const CONTEXT_SOURCES = ['archive', 'union', 'live_union'] as const;
/** What the hub did with our fresh text (`context_v1.live.status`, H-4c). */
export const LIVE_TEXT_STATUSES = ['not_sent', 'disabled', 'shadow', 'served', 'rejected'] as const;
export const KNOWN_FAN_MESSAGE_STATES = ['included', 'absent', 'deleted', 'unknown'] as const;

/**
 * 1.15.0 (R20 HF-8в): how the client reads the hub's answer to each id of the window check, one table per list — the
 * matrix the hub and this client share (hub `tests/fixtures/ai-coverage-check-matrix.json`, `classes`; a verbatim copy
 * is this package's fixture, its test reads every case; spec §3.5, table one). `counted` — the context holds it, or
 * knows it deleted; `miss` — the context may lack it; `stale` — the context holds what the tab saw deleted;
 * `unverified` — not checked. A state its list's table does not name, or one this build does not know, reads
 * `unverified`.
 */
export const COVERAGE_WINDOW_STATES = ['included', 'deleted', 'direction_mismatch', 'outside_window', 'absent', 'unknown'] as const;
export const COVERAGE_DELETED_STATES = ['deleted', 'absent', 'still_served', 'included', 'unknown'] as const;
export type CoverageClass = 'counted' | 'miss' | 'stale' | 'unverified';
export const COVERAGE_CHECK_CLASSES = {
  window: { included: 'counted', deleted: 'counted', direction_mismatch: 'miss', outside_window: 'miss', absent: 'miss', unknown: 'unverified' },
  deleted: { deleted: 'counted', absent: 'counted', still_served: 'stale', included: 'stale', unknown: 'unverified' },
} as const satisfies {
  window: Record<(typeof COVERAGE_WINDOW_STATES)[number], CoverageClass>;
  deleted: Record<(typeof COVERAGE_DELETED_STATES)[number], CoverageClass>;
};

/**
 * Which snapshot actually served the generation (`context_v1`, H-4b), as the
 * background narrowed the hub's open tokens: the hub reader in `source`, our
 * fresh text in the separate `live` block (hub-pr-plan.md §5: `live-overlay`
 * is the hub's Fansly socket reader). A token this client does not know becomes null.
 */
export const ServedContextSchema = z.strictObject({
  source: z.nullable(z.enum(CONTEXT_SOURCES)),
  servedHead: z.nullable(z.strictObject({ messageRef: NativeIdSchema, at: IsoTimestampSchema })),
  /** The hub's answer per known id; an unknown state token becomes null (it never lifts a hold, servedContextCovers). */
  knownFanMessages: z.optional(
    z.array(z.strictObject({ id: NativeIdSchema, state: z.nullable(z.enum(KNOWN_FAN_MESSAGE_STATES)) })).check(z.maxLength(SEND_LIMITS.knownFanMessagesMax)),
  ),
  live: z.strictObject({ status: z.nullable(z.enum(LIVE_TEXT_STATUSES)), accepted: CountSchema, rejected: CountSchema }),
  /**
   * 1.15.0 (R20 HF-8в): the hub's answers to the start's window check, each list in the hub's order, each state
   * narrowed by its own list (`narrowCoverageCheck`; unknown → null). Absent — the frame had none (no
   * `coverage-check-v1`, no proof), or answered something that is no id.
   */
  coverageCheck: z.optional(
    z.strictObject({
      window: z.array(z.strictObject({ id: NativeIdSchema, state: z.nullable(z.enum(COVERAGE_WINDOW_STATES)) })).check(z.maxLength(COVERAGE_CHECK_LIMITS.windowMax)),
      deleted: z.array(z.strictObject({ id: NativeIdSchema, state: z.nullable(z.enum(COVERAGE_DELETED_STATES)) })).check(z.maxLength(COVERAGE_CHECK_LIMITS.deletedMax)),
    }),
  ),
});
export type ServedContext = z.infer<typeof ServedContextSchema>;
export type ServedCoverageCheck = NonNullable<ServedContext['coverageCheck']>;

type CoverageAnswer = { readonly id: string; readonly state: string };
const knownState = <T extends string>(states: readonly T[], state: string): T | null => ((states as readonly string[]).includes(state) ? (state as T) : null);

/**
 * The frame's `coverageCheck` (hub tokens) as the background hands it on: each state narrowed by its own list,
 * unknown → null. An answer that names something which is no id answers nothing the client asked (it asks ids only):
 * the check reads as unanswered — absent, `unverified`.
 */
export function narrowCoverageCheck(answer: { readonly window: readonly CoverageAnswer[]; readonly deleted: readonly CoverageAnswer[] } | undefined): ServedCoverageCheck | undefined {
  if (answer === undefined || [...answer.window, ...answer.deleted].some((item) => !NATIVE_ID_PATTERN.test(item.id))) return undefined;
  return {
    window: answer.window.map((item) => ({ id: item.id, state: knownState(COVERAGE_WINDOW_STATES, item.state) })),
    deleted: answer.deleted.map((item) => ({ id: item.id, state: knownState(COVERAGE_DELETED_STATES, item.state) })),
  };
}

/** The class of each asked id's one answer, in the asked order; null — an id answered never or twice, or one not asked. */
function classesOf<S extends string>(
  asked: readonly string[],
  answers: readonly { readonly id: string; readonly state: S | null }[],
  table: Readonly<Record<S, CoverageClass>>,
): CoverageClass[] | null {
  const byId = new Map<string, S | null>();
  for (const answer of answers) {
    if (byId.has(answer.id)) return null;
    byId.set(answer.id, answer.state);
  }
  if (byId.size !== asked.length || new Set(asked).size !== asked.length || !asked.every((id) => byId.has(id))) return null;
  return asked.map((id) => {
    const state = byId.get(id) ?? null;
    return state === null ? 'unverified' : table[state];
  });
}

/**
 * The window check's own part of the verdict (spec §3.5, table two; the shared matrix's `coverageVerdict`), the first
 * that holds: `unverified` — no answer, an asked id answered never or twice in its list, an id its list did not ask,
 * or any answer reads `unverified`; `miss` — a window answer reads `miss`; `stale` — a deleted answer reads `stale`;
 * `fresh` otherwise. The caller puts its own conditions around it (spec §3.5: no frame, no snapshot, an unknown
 * observation and a truncated snapshot first; the fresh text's `live` beside `miss`; coverage `complete`, and an empty
 * window only under full observation, before `fresh`).
 */
export function coverageCheckVerdict(
  asked: { readonly window: readonly { readonly id: string }[]; readonly deletedIds: readonly string[] },
  answer: ServedCoverageCheck | undefined,
): 'fresh' | 'miss' | 'stale' | 'unverified' {
  if (answer === undefined) return 'unverified';
  const window = classesOf(asked.window.map((entry) => entry.id), answer.window, COVERAGE_CHECK_CLASSES.window);
  const deleted = classesOf(asked.deletedIds, answer.deleted, COVERAGE_CHECK_CLASSES.deleted);
  if (window === null || deleted === null || window.includes('unverified') || deleted.includes('unverified')) return 'unverified';
  if (window.includes('miss')) return 'miss';
  return deleted.includes('stale') ? 'stale' : 'fresh';
}

/**
 * Why a result is not shown as fresh (`OpView.stale`): `fan-wrote` — the fan wrote after the generation (§6.7.5);
 * `archive-moved` — the archive moved past it. 1.15.0 (R20 spec §3.5, the verdict of the window check, FS-TAIL-8):
 * `unverified` — its freshness is not verified (no context frame, no proof, an unknown observation, a truncated
 * snapshot, an unchecked id); `window-miss` — the answer may not have counted the latest messages (a miss of the
 * window, or a draft's page text the hub did not serve); `deleted-served` — the context held a message the tab saw
 * deleted. Any of them holds a preview's send (CG-SEND-STALE); the dock still inserts.
 */
export const STALE_REASONS = ['fan-wrote', 'archive-moved', 'unverified', 'window-miss', 'deleted-served'] as const;
export type StaleReason = (typeof STALE_REASONS)[number];

/** A greeting draft keeps its generation's own verdict across windows, tabs and background restarts. */
export const GreetingDraftGenerationSchema = z.strictObject({
  opId: UuidSchema,
  generationRef: z.nullable(GenerationRefSchema),
  text: boundedText(SEND_LIMITS.previewDraftMaxChars),
  historyRevision: UuidSchema,
  mark: z.nullable(z.enum(STALE_REASONS)),
});
export type GreetingDraftGeneration = z.infer<typeof GreetingDraftGenerationSchema>;

/** What the hub's `usage` frame said of a generation: numbers only, never a text. */
export const OpUsageSchema = z.strictObject({
  inputTokens: z.nullable(CountSchema),
  outputTokens: z.nullable(CountSchema),
  cacheReadTokens: z.nullable(CountSchema),
  cacheWriteTokens: z.nullable(CountSchema),
  costMicroUsd: z.nullable(MicroUsdSchema),
});
export type OpUsage = z.infer<typeof OpUsageSchema>;

/** Debug-only details (debug.enabled): profiler stages, usage and cost, reasoning, prompt token. */
/** Debug only: the exact start proof (including its draft tail) and the narrowed hub answer. Never logged. */
export const GenerationDebugSchema = z.strictObject({ proof: CoverageProofSchema, served: z.nullable(ServedContextSchema) });
export type GenerationDebug = z.infer<typeof GenerationDebugSchema>;

export const OpDebugViewSchema = z.strictObject({
  generation: z.optional(GenerationDebugSchema),
  stages: z
    .array(z.strictObject({ name: boundedText(48), at: EpochMsSchema }))
    .check(z.maxLength(32)),
  usage: z.nullable(OpUsageSchema),
  reasoning: z.nullable(displayText(64_000)),
  /** Opaque token for debug-prompt.html (DB-006); the prompt itself never reaches a tab. */
  promptToken: z.nullable(boundedText(128)),
  context: z.nullable(
    z.strictObject({
      source: boundedText(64),
      coverage: boundedText(64),
      windowRequested: CountSchema,
      windowServed: CountSchema,
      liveAccepted: CountSchema,
      liveRejected: CountSchema,
    }),
  ),
  /** The model `meta` named: the end of the cost line (DB-017); null — unknown. Added in 1.1.0. */
  model: z.optional(z.nullable(displayText(80))),
  /**
   * The hub's own stages from the prompt manifest, as durations (DB-016:
   * summary-cache-check, prompt-build, llm-ttfb, llm-stream); `stages` above
   * are the client's marks. Added in 1.1.0.
   */
  hubStages: z.optional(z.array(z.strictObject({ name: boundedText(48), ms: DurationMsSchema })).check(z.maxLength(16))),
});
export type OpDebugView = z.infer<typeof OpDebugViewSchema>;

export const OpViewSchema = z.strictObject({
  opId: UuidSchema,
  feature: FeatureIdSchema,
  surface: SurfaceSchema,
  target: TargetSchema,
  state: OpStateSchema,
  phase: PhaseSchema,
  startedAt: EpochMsSchema,
  firstChunkAt: z.optional(EpochMsSchema),
  endedAt: z.optional(EpochMsSchema),
  /** The accumulated stream (preview text; actions only on `result`). */
  text: z.optional(displayText(64_000)),
  result: z.optional(OpResultSchema),
  /**
   * The one final error of the operation, as code and facts; the tab renders
   * it into a CgErrorView in the current locale (I18-001 switches on the fly).
   */
  error: z.optional(CgErrorWireSchema),
  generationRef: z.optional(GenerationRefSchema),
  /** The tone the result was generated with; Regenerate repeats it (AI-007). */
  toneUsed: z.nullable(ToneSchema),
  servedContext: z.optional(z.nullable(ServedContextSchema)),
  /**
   * 1.46.0: the Recaps the hub put into this generation's prompt, as its meta frame says (`attachedRecaps`): Coach's
   * full and short ones; a Reply's or a Ping's dossier — the latest saved full Recap — as `full`. Each is when that
   * Recap was made; null — none went in. Absent — the hub did not say. 1.48.0: `off` — none went in because the start
   * asked so (`StartOp.recap`, «с Recap» unticked).
   */
  recapsUsed: z.optional(z.strictObject({ full: z.nullable(IsoTimestampSchema), short: z.nullable(IsoTimestampSchema), off: z.optional(z.literal(true)) })),
  /** The operation's own evidence survives a reload. An older result without it is unverified. */
  freshnessProof: z.optional(z.strictObject({
    windowSize: z.number().check(z.int(), z.minimum(1), z.maximum(COVERAGE_CHECK_LIMITS.windowMax)),
    fingerprint: CoverageFingerprintSchema,
  })),
  /** The result is not shown as fresh (the dock may still insert; previews hold sends, §6.7.5): STALE_REASONS. */
  stale: z.optional(z.strictObject({ reason: z.enum(STALE_REASONS), at: z.nullable(IsoTimestampSchema) })),
  /**
   * 2026-10-22: the generation's usage as the hub's `usage` frame said it (numbers only) — the cost line of the result's
   * head, as the old Fansly extension printed it whatever the debug mode. Absent — no frame came.
   */
  usage: z.optional(OpUsageSchema),
  /** Only when debug.enabled. */
  debug: z.optional(OpDebugViewSchema),
  /**
   * The operation that took this one's place in the chat's slot the moment
   * it ended: the answer step of a composite Coach turn whose recap step
   * this was (`StartOp.coach.autoRecap`). Present only on a terminal view;
   * absent — nothing follows (an ordinary operation, a canceled or stopped
   * turn). Added in 1.2.0.
   */
  continuedBy: z.optional(UuidSchema),
});
export type OpView = z.infer<typeof OpViewSchema>;

// ── The site's AI policy (1.15.0, R20 F10; docs/project-unite/architecture.md §1.6, §9.1) ──
//
// What of an AI start and of its result is the site's to say. The shared controller of the open chat calls these
// ports and never names a site; the site's application half of its adapter hands its policy in (`HostAppAdapter.ai`).
// ChatSpace's policy is what the controller did by itself before the second site: the visible tail as fresh text,
// Hi refused by the loaded window, no fingerprint, the background's «фан написал новое» as the mark. Fansly's is its
// snapshot, the start proof of Hi and the coverage verdict (P8b1–P8c). Types only: no schema of a port goes into a
// bundle.

/** A reason of the action catalog that carries a CG code: what a pre-check refuses with — the start fails with that code. */
export type AiGateReason = { [K in UnavailableReasonId]: (typeof UNAVAILABLE_REASONS)[K]['code'] extends null ? never : K }[UnavailableReasonId];

/**
 * The mark over a finished result's parts, ready to be drawn — the shared result's model of it (`ResultVM.stale`): the
 * site's AI policy gives it (`verdict`), the shared result only shows it. ChatSpace's is the background's «фан написал
 * новое после генерации» (`OpView.stale`); the window check's reasons (`StaleReason`) are Fansly's (P8b2). Here, next to
 * the view it is read from: the view models import `ops`, never the other way round.
 */
export interface ResultMarkVM {
  readonly reason: StaleReason;
  readonly at: IsoTimestamp | null;
}

/** What a start asks the site's proof for. */
export interface AiProofAsk {
  readonly feature: FeatureId;
  readonly surface: Surface;
  /** Effective messageCount of this start, after its one-off option and hub limits. Absent on older callers. */
  readonly messageCount?: number;
  /** The open chat as the start found it: the host answers only while it is still this chat. */
  readonly identity: HostIdentity;
  /** How much fresh page text the start may carry (D-14: a draft feature in the dock, admitted on the page); null — none. */
  readonly fresh: { readonly maxItems: number; readonly maxChars: number } | null;
  /**
   * 1.27.0 (X54): the start may carry the open chat's PPV state — fresh text is admitted and the hub lists the site's
   * capability (`live-ppv-v1` for ChatSpace, `live-ppv-fansly-v1` for Fansly).
   */
  readonly livePpv?: boolean;
  /** The start may carry the fan's newest photos: fresh text is admitted and the hub lists `live-images-v1`. */
  readonly liveImages?: boolean;
}

/**
 * The site's own fields of a start, made from its proof. The shared plan trims `fresh` to D-14 and copies the rest
 * into the start as they are; the StartOp schema checks them like every other field, so a field the schema does not
 * know refuses the start (CG-UI-FAILED) instead of reaching the background.
 */
export interface AiStartFields {
  /** The visible tail as fresh page text (D-14): ChatSpace's. */
  readonly fresh?: LiveTextTail | null;
  /** 1.27.0 (X54): the open chat's PPV state read from the host's API: ChatSpace's paid messages, Fansly's attachments. */
  readonly livePpv?: LivePpvState;
  /** The fan's newest photos the host drew (ChatSpace's from its media proxy, Fansly's from its CDN), JPEG. */
  readonly liveImages?: readonly LiveImage[];
  /** The proof of freshness the site made of its snapshot (`CoverageProof`, its texts inside): Fansly's (P8b1). */
  readonly proof?: CoverageProof;
  /** Hi's start evidence and avatar (1.15.0, P4b4); the shared plan carries them to StartOp unchanged. */
  readonly startProof?: StartOp['startProof'];
  readonly personalMessageCount?: StartOp['personalMessageCount'];
  readonly fanAvatarUrl?: StartOp['fanAvatarUrl'];
}

/**
 * The site's AI policy. `P` is the proof the site gathers for a start (ChatSpace: the visible tail); `F` — its
 * fingerprint, what the tab keeps of that proof with the operation for the verdict (ChatSpace: nothing). Both are
 * opaque to the shared controller: it only hands them back to the policy.
 */
export interface AiHostPolicy<P = unknown, F = unknown> {
  /** Optional result observation from page memory. Calls changed after an asynchronous verdict check; disposed with the workspace. */
  watch?(host: HostPort, changed: () => void): () => void;
  /**
   * The pre-check: the site's own reason a feature cannot start in the open chat, from what the page holds — after
   * the shared rules (the chat is loading, Fix without a draft, a short history for Review and Recap), before a token
   * is asked for or anything reaches the hub. It only spares a round trip: the hub decides its gates itself. Asked
   * with `proof` null for a view and for the first check of a start, and once more with the start's proof before
   * its token: a site whose rule needs the proof (Fansly's Hi, FS-AI-2) refuses there.
   */
  preflight(feature: FeatureId, window: ChatWindow, proof: P | null): AiGateReason | null;
  /**
   * The proof of the open chat a start gathers after its pre-check, from page memory only. null — nothing to gather
   * for this start (nothing is awaited); a proof that fails or rejects is no proof, and the start goes on without one.
   */
  proof(host: HostPort, ask: AiProofAsk): Promise<P | null> | null;
  /** The site's fields of the start, from its proof. */
  fields(proof: P | null): AiStartFields;
  /**
   * What the tab keeps of the proof with the operation for as long as its result lives, for the verdict; null —
   * nothing. Never a text of the conversation (R20 F8: after the start no tail is kept anywhere in the tab).
   */
  fingerprint(proof: P | null): F | null;
  /** The verdict on a result: the ready mark the shared result shows over its parts; null — no mark. */
  verdict(view: OpView, fingerprint: F | null): ResultMarkVM | null;
  /**
   * 1.15.0 (R20 P8c): the person's wish of the deep window kept by the site (Fansly's `settings.ext`: 3001…5000, §12),
   * asked only by a start whose window is the deep one (Review, the full Recap, Coach's full auto-Recap). The planner
   * caps it by `limits.deepMax`; a one-off window still wins. Absent, null or failed — the v1 window (ChatSpace).
   */
  windows?(): Promise<SettingsExt['windows'] | null>;
}

// ── Operations of a site's own slice (1.15.0, R20 P4b3; architecture §1.6, §8.8) ───────────────────────────────

/**
 * The start of an operation of a site's own slice (`SiteOpId`: Fansly's voice script and «Заполнить из чата»). It
 * goes through the shared scheduler — one operation per chat across the extension and three per tab together with
 * Reply and the rest; timeouts, cancel, spend, dedup and the kept result — but it is no `StartOp`: `StartOpSchema`,
 * `OpViewSchema` and every shared schema built on `FEATURE_IDS` stay closed, and no ChatSpace bundle carries a site's
 * operation. This union is the types' alone: the schemas that check these shapes are the site's module
 * (`ops-fansly`), parsed in its own chunk, and they give exactly these types (its test holds both ways).
 */
interface SiteStartBase<F extends SiteOpId> {
  readonly feature: F;
  readonly target: Target;
  readonly cause: HumanCause;
  /** The hub body's `messageCount`: the voice script reads the quick window, the notes fill the deep one. */
  readonly window: number;
  /** Latest confirmed texts of the open chat, sent only to a hub that supports this operation. */
  readonly fresh?: LiveTextTail | undefined;
  readonly regenerateOf?: string | undefined;
  /** Bypass the result cache (Regenerate). */
  readonly force?: boolean | undefined;
}

/** The voice script (`voice-script`): spoken from the draft of the chat's field, in the tone of a preset (null — calm, the hub's `none`). */
export interface VoiceScriptStart extends SiteStartBase<'voice-script'> {
  readonly tone: Tone | null;
  readonly draft: { readonly text: string; readonly revision: number; readonly digest: string };
}

/** «Дополнить из чата» (`notes-fill`): the questionnaire's labels and, 1.28.0 (X43), their values — the hub body's
 * `noteValues` and nowhere else (FS-NOTE-5). */
export interface NotesFillStart extends SiteStartBase<'notes-fill'> {
  readonly fields: readonly string[];
  readonly values?: readonly string[] | undefined;
}

export type SiteStartOp = VoiceScriptStart | NotesFillStart;
/** What the scheduler admits: a shared feature's start or a site operation's. */
export type AnyStartOp = StartOp | SiteStartOp;

/** One label of the questionnaire and what the chat says of it; `''` — nothing (the panel leaves the field as it is).
 * 1.16.0 (R20 P11b2): `quotes` — the fan's own words behind the value, as the hub's merge mode quotes them (shown,
 * never saved). */
export interface NoteFieldValue {
  readonly label: string;
  readonly value: string;
  readonly quotes?: readonly string[] | undefined;
}

/**
 * The result of a site operation, as its driver parses the finished stream: the voice script's text (its
 * `generationRef` — the source of the paid voicing, HF-4а — is the view's), or the asked labels with what the chat
 * gave each one, in the asked order.
 */
/** 1.16.0 (R20 P11b2): `proposed` of `note-fields` — the fields the hub named itself (`+ Label: value`), in its order. */
export type SiteOpResult = { readonly kind: 'voice-script'; readonly script: string } | { readonly kind: 'note-fields'; readonly fields: readonly NoteFieldValue[]; readonly proposed?: readonly NoteFieldValue[] | undefined };
/** What the scheduler keeps as a result: a shared feature's or a site operation's. */
export type AnyOpResult = OpResult | SiteOpResult;

/** A site's kept view has the same lifecycle, but its own feature and result schemas. */
export type SiteOpView = Omit<OpView, 'feature' | 'result'> & { readonly feature: SiteOpId; readonly result?: SiteOpResult | undefined };
export type AnyOpView = OpView | SiteOpView;
