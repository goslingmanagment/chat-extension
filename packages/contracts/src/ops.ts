// AI operations (architecture.md §5.5, §7). One writer in the background
// admits operations atomically: one per chat across the extension, three per
// tab, no queue. Closing the owning tab detaches the surface but does not
// cancel the generation. Nothing indeterminate is ever repeated.

import * as z from 'zod/mini';

import { CgErrorWireSchema } from './errors';
import { FeatureIdSchema, SurfaceSchema, ToneSchema, isFreshTextFeature, type FeatureId } from './features';
import { LiveTextTailSchema } from './host';
import { ChatRefSchema, HumanCauseSchema, TargetSchema } from './ids';
import { OP_LIMITS } from './limits';
import {
  CountSchema,
  DigestSchema,
  EpochMsSchema,
  IsoTimestampSchema,
  MicroUsdSchema,
  NativeIdSchema,
  RefSchema,
  UuidSchema,
  boundedText,
  displayText,
} from './primitives';
import { FreshnessCheckpointSchema } from './send';

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

export const COACH_LIMITS = {
  questionMaxChars: 4000,
  /** Hub COACH_ANSWER_MAX_CHARS. */
  answerMaxChars: 64_000,
  historyMaxTurns: 20,
  draftMaxChars: 1500,
  draftsMax: 2,
} as const;

/** One past exchange sent as `coachHistory` (long answers are compressed before, AI-088). */
export const CoachTurnSchema = z.strictObject({
  question: boundedText(COACH_LIMITS.questionMaxChars),
  answer: boundedText(COACH_LIMITS.answerMaxChars),
});
export type CoachTurn = z.infer<typeof CoachTurnSchema>;

/** Draft text attached to an operation: Fix's source, Coach's «приложить мой ответ». */
export const OpDraftSchema = z.strictObject({
  text: boundedText(20_000),
  revision: CountSchema,
  digest: DigestSchema,
});

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
    /** Б5: messageCount. */
    window: z.int().check(z.gte(1), z.lte(3000)),
    draft: z.optional(OpDraftSchema),
    /** Hi in the dock — 3, «Новые» — 1. */
    variantCount: z.optional(z.union([z.literal(1), z.literal(3)])),
    coach: z.optional(
      z.strictObject({
        question: z.optional(boundedText(COACH_LIMITS.questionMaxChars)),
        preset: z.optional(z.literal('situation')),
        history: z.array(CoachTurnSchema).check(z.maxLength(COACH_LIMITS.historyMaxTurns)),
        attachDraft: z.optional(boundedText(20_000)),
      }),
    ),
    /** Only reply|fix|hi|ping on surface `dock` with the freshText flag (D-14). */
    fresh: z.optional(LiveTextTailSchema),
    /** Previews: the freshness checkpoint of the Generate click (X8). */
    checkpoint: z.optional(FreshnessCheckpointSchema),
    regenerateOf: z.optional(UuidSchema),
    /** Bypass the result cache (Regenerate, Refresh). */
    force: z.optional(z.boolean()),
  })
  .check(
    z.refine((op) => op.fresh === undefined || (op.surface === 'dock' && isFreshTextFeature(op.feature)), {
      message: 'fresh text only for reply|fix|hi|ping in the dock',
    }),
    z.refine((op) => op.coach === undefined || op.feature === 'coach', { message: 'coach fields only for coach' }),
    z.refine((op) => op.feature !== 'fix' || op.draft !== undefined, { message: 'fix needs the draft' }),
    z.refine((op) => op.variantCount === undefined || op.feature === 'hi', { message: 'variantCount only for hi' }),
    z.refine((op) => op.checkpoint === undefined || op.surface === 'preview' || op.surface === 'newcomers', {
      message: 'a freshness checkpoint belongs to a preview',
    }),
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

export const AdmissionSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), opId: UuidSchema }),
  z.strictObject({
    ok: z.literal(false),
    code: z.enum(['CG-OP-CHAT-BUSY', 'CG-OP-TAB-LIMIT']),
    active: z.array(ActiveOpSummarySchema).check(z.maxLength(OP_LIMITS.perTab)),
  }),
]);
export type Admission = z.infer<typeof AdmissionSchema>;

/** Coverage of the history a result was built from; null fields = unknown. */
export const CoverageSchema = z.strictObject({
  level: z.enum(['complete', 'partial', 'unknown']),
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
    shared: z.strictObject({ generationRef: RefSchema }),
  }),
  z.strictObject({ kind: z.literal('coach'), answer: CoachAnswerSchema }),
]);
export type OpResult = z.infer<typeof OpResultSchema>;

/** Which snapshot actually served the generation (`context_v1`, H-4). */
export const ServedContextSchema = z.strictObject({
  source: z.enum(['archive', 'union', 'live-overlay']),
  servedHead: z.nullable(z.strictObject({ messageRef: NativeIdSchema, at: IsoTimestampSchema })),
  knownFanMessage: z.optional(
    z.strictObject({ id: NativeIdSchema, state: z.enum(['included', 'absent', 'deleted', 'unknown']) }),
  ),
});
export type ServedContext = z.infer<typeof ServedContextSchema>;

/** Debug-only details (debug.enabled): profiler stages, usage and cost, reasoning, prompt token. */
export const OpDebugViewSchema = z.strictObject({
  stages: z
    .array(z.strictObject({ name: boundedText(48), at: EpochMsSchema }))
    .check(z.maxLength(32)),
  usage: z.nullable(
    z.strictObject({
      inputTokens: z.nullable(CountSchema),
      outputTokens: z.nullable(CountSchema),
      cacheReadTokens: z.nullable(CountSchema),
      cacheWriteTokens: z.nullable(CountSchema),
      costMicroUsd: z.nullable(MicroUsdSchema),
    }),
  ),
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
  generationRef: z.optional(RefSchema),
  /** The tone the result was generated with; Regenerate repeats it (AI-007). */
  toneUsed: z.nullable(ToneSchema),
  servedContext: z.optional(z.nullable(ServedContextSchema)),
  /** A newer fan message exists (the dock may still insert; previews hold sends, §6.7.5). */
  stale: z.optional(z.strictObject({ reason: z.enum(['fan-wrote', 'archive-moved']), at: z.nullable(IsoTimestampSchema) })),
  /** Only when debug.enabled. */
  debug: z.optional(OpDebugViewSchema),
});
export type OpView = z.infer<typeof OpViewSchema>;

/** Starting timeouts per feature, ms (§7 «Тайм-ауты»); refined by lab measurements. */
export interface OpTimeouts {
  /** From the request until the `meta` frame. */
  readonly untilMetaMs: number;
  /** From `meta` until the first output chunk. */
  readonly firstChunkAfterMetaMs: number;
  /** Longest silence between frames. */
  readonly silenceMs: number;
  /** Whole operation. */
  readonly maxMs: number;
}

const s = (seconds: number): number => seconds * 1000;
const QUICK: OpTimeouts = { untilMetaMs: s(30), firstChunkAfterMetaMs: s(30), silenceMs: s(30), maxMs: s(60) };
const DEEP: OpTimeouts = { untilMetaMs: s(180), firstChunkAfterMetaMs: s(45), silenceMs: s(45), maxMs: s(300) };

export const OP_TIMEOUTS: Readonly<Record<FeatureId, OpTimeouts>> = {
  reply: QUICK,
  fix: QUICK,
  hi: QUICK,
  ping: QUICK,
  'recap-short': { untilMetaMs: s(60), firstChunkAfterMetaMs: s(45), silenceMs: s(45), maxMs: s(120) },
  review: DEEP,
  recap: DEEP,
  coach: { untilMetaMs: s(60), firstChunkAfterMetaMs: s(45), silenceMs: s(45), maxMs: s(180) },
};
