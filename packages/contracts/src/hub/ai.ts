// The AI stream (architecture.md §8.4; hub H-4b/H-4c, H-10): persona catalog,
// our feature → hub feature map, the request body we send to `aiFeatureStream`
// and every SSE frame the stream may carry. The SDK checks frames strictly
// before we see them; unknown frames are an error. Split markers travel inside
// `content_delta` text (D-15): there is no Split frame.

import * as z from 'zod/mini';

import { TONES, type FeatureId } from '../features';
import { LIVE_TEXT_LIMITS } from '../host';
import { CountSchema, IsoTimestampSchema, MicroUsdSchema, NativeIdSchema, OpenTokenSchema, UuidSchema, boundedText } from '../primitives';
import { AI_STREAM_CAPABILITIES, AiStreamCapabilitySchema, PageLabelSchema, PersonaDefinitionIdSchema } from './wire';

// ── Persona catalog (`aiPersonaCatalog`: metadata only, never prompt text) ──

export const PersonaCatalogItemSchema = z.object({
  key: boundedText(120),
  displayName: boundedText(120),
  version: z.int().check(z.gte(1)),
  definitionId: PersonaDefinitionIdSchema,
  status: z.enum(['active', 'archived']),
});
export type PersonaCatalogItem = z.infer<typeof PersonaCatalogItemSchema>;

export const PersonaCatalogSchema = z.object({ personas: z.array(PersonaCatalogItemSchema) });
export type PersonaCatalog = z.infer<typeof PersonaCatalogSchema>;

// ── Feature map (§8.4 table) ───────────────────────────────────────────────

/** Hub feature keys this client streams (`aiUsageFeatures` subset; path param of `aiFeatureStream`). */
export const HUB_AI_FEATURES = ['fast-reply', 'improve-draft', 'hi-greeting', 'ping', 'chat-review', 'fan-summary', 'coach-chat'] as const;
export const HubAiFeatureSchema = z.enum(HUB_AI_FEATURES);
export type HubAiFeature = z.infer<typeof HubAiFeatureSchema>;

/** Body fields only one hub feature takes; anything else in this list on another feature is our bug. */
export const HUB_FEATURE_ONLY_FIELDS = {
  replyTone: ['fast-reply'],
  draftText: ['improve-draft', 'coach-chat'],
  variantCount: ['hi-greeting'],
  summaryMode: ['fan-summary'],
  chatterQuestion: ['coach-chat'],
  coachHistory: ['coach-chat'],
  preset: ['coach-chat'],
  /** Fresh text (D-14, H-4c): draft features only; Recap/Review/Coach never. */
  liveTextContext: ['fast-reply', 'improve-draft', 'hi-greeting', 'ping'],
} as const satisfies Record<string, readonly HubAiFeature[]>;

export interface HubFeatureSpec {
  readonly hub: HubAiFeature;
  readonly summaryMode?: 'short';
  /**
   * When `replyMode: 'preferSplit'` may be asked for: `always` (Reply, Fix),
   * `split-all-v1` (Hi, Ping, Coach drafts: only with that capability and the
   * page's `splitAll` flag, H-10), or never (Recap, Review).
   */
  readonly replyMode: 'always' | 'split-all-v1' | null;
}

export const HUB_FEATURE_MAP = {
  reply: { hub: 'fast-reply', replyMode: 'always' },
  fix: { hub: 'improve-draft', replyMode: 'always' },
  hi: { hub: 'hi-greeting', replyMode: 'split-all-v1' },
  ping: { hub: 'ping', replyMode: 'split-all-v1' },
  review: { hub: 'chat-review', replyMode: null },
  recap: { hub: 'fan-summary', replyMode: null },
  'recap-short': { hub: 'fan-summary', summaryMode: 'short', replyMode: null },
  coach: { hub: 'coach-chat', replyMode: 'split-all-v1' },
} as const satisfies Record<FeatureId, HubFeatureSpec>;

/** Split markers inside the generated text (D-15): `[VARIANT]` separates Hi variants, `[NEXT]` parts. */
export const SPLIT_MARKERS = { next: '[NEXT]', variant: '[VARIANT]' } as const;

// ── Request body (`aiFeatureStreamBodySchema` + H-4b/H-4c) ─────────────────

export const AI_MESSAGE_COUNT = { min: 5, max: 3000 } as const;
export const COACH_ANSWER_MAX_CHARS = 64_000;
/** `none` = persona only (the hub's own word); the rest are the client's tones. */
export const HUB_REPLY_TONES = ['none', ...TONES] as const;

/** H-4c `liveTextContext`: confirmed messages of the open OF chat, never queued or unsent ones. */
export const LiveTextContextSchema = z.strictObject({
  capturedAt: IsoTimestampSchema,
  items: z
    .array(
      z.strictObject({
        platformMessageId: NativeIdSchema,
        direction: z.enum(['fan', 'model']),
        occurredAt: IsoTimestampSchema,
        text: boundedText(LIVE_TEXT_LIMITS.maxChars),
      }),
    )
    .check(z.minLength(1), z.maxLength(LIVE_TEXT_LIMITS.maxItems)),
});
export type LiveTextContext = z.infer<typeof LiveTextContextSchema>;

/**
 * The body this client sends (a strict subset of the hub's body: no model or
 * effort override, no Fansly `clientContext` until R20, no deprecated
 * `greetingMode`). On OnlyFans conversationRef = fanRef = the fan id.
 */
export const AiFeatureStreamBodySchema = z.strictObject({
  /** = opId (§8.4). */
  clientRequestId: UuidSchema,
  pageLabel: PageLabelSchema,
  platform: z.enum(['fansly', 'onlyfans']),
  conversationRef: NativeIdSchema,
  fanRef: z.optional(z.nullable(NativeIdSchema)),
  personaKey: z.optional(z.nullable(boundedText(120))),
  expectedPersonaDefinitionId: z.optional(PersonaDefinitionIdSchema),
  replyTone: z.optional(z.enum(HUB_REPLY_TONES)),
  replyMode: z.optional(z.enum(['default', 'preferSplit'])),
  messageCount: z.optional(z.int().check(z.gte(AI_MESSAGE_COUNT.min), z.lte(AI_MESSAGE_COUNT.max))),
  draftText: z.optional(boundedText(20_000)),
  isRegeneration: z.optional(z.boolean()),
  chatterQuestion: z.optional(boundedText(2000)),
  coachHistory: z.optional(
    z
      .array(z.strictObject({ question: boundedText(2000), answer: boundedText(COACH_ANSWER_MAX_CHARS) }))
      .check(z.maxLength(20)),
  ),
  preset: z.optional(z.literal('situation')),
  summaryMode: z.optional(z.literal('short')),
  variantCount: z.optional(z.union([z.literal(1), z.literal(3)])),
  /** H-4b: only an id from the freshness checkpoint; the hub checks page and fan. */
  knownFanMessageId: z.optional(NativeIdSchema),
  liveTextContext: z.optional(LiveTextContextSchema),
});
export type AiFeatureStreamBody = z.infer<typeof AiFeatureStreamBodySchema>;

const featureOnlyFieldsHold = (r: { feature: HubAiFeature; body: Record<string, unknown> }): boolean =>
  Object.entries(HUB_FEATURE_ONLY_FIELDS).every(
    ([field, features]) => r.body[field] === undefined || (features as readonly HubAiFeature[]).includes(r.feature),
  );

/** One stream call: the hub feature, the body and the header capabilities (`x-kernel-ai-capabilities`). */
export const HubStreamRequestSchema = z
  .strictObject({
    feature: HubAiFeatureSchema,
    body: AiFeatureStreamBodySchema,
    capabilities: z.array(AiStreamCapabilitySchema).check(z.maxLength(AI_STREAM_CAPABILITIES.length)),
  })
  .check(
    z.refine((r) => new Set(r.capabilities).size === r.capabilities.length, { message: 'capabilities repeat' }),
    z.refine(featureOnlyFieldsHold, { message: 'a feature-only field is set on another feature' }),
    z.refine((r) => r.body.liveTextContext === undefined || r.capabilities.includes('context-v1'), {
      message: 'liveTextContext needs the context-v1 header (else 400 capability_required)',
    }),
    z.refine((r) => r.feature !== 'improve-draft' || r.body.draftText !== undefined, { message: 'Fix needs draftText' }),
    z.refine((r) => r.body.summaryMode === undefined || r.feature === 'fan-summary', { message: 'summaryMode is fan-summary only' }),
  );
export type HubStreamRequest = z.infer<typeof HubStreamRequestSchema>;

// ── Frames (`aiFeatureStreamFrameSchema` + H-4b `context_v1`) ───────────────

const QuotaSchema = z.object({
  accepted: z.boolean(),
  remainingRequestsToday: z.nullable(CountSchema),
  remainingMicroUsdToday: z.nullable(MicroUsdSchema),
});

const AttachedRecapSchema = z.strictObject({ generatedAt: IsoTimestampSchema, ageMs: CountSchema });

/** First frame: the generation's identity, the persona actually used and the page quota. */
export const MetaFrameSchema = z.strictObject({
  type: z.literal('meta'),
  /** = generationRef of the result. */
  requestId: UuidSchema,
  clientRequestId: UuidSchema,
  feature: OpenTokenSchema,
  pageLabel: z.string(),
  model: z.string(),
  provider: OpenTokenSchema,
  providerResponseId: z.nullable(z.string()),
  /** A different definition than requested → drop the result, refresh the catalog, CG-PERSONA-CHANGED. */
  personaDefinitionId: z.optional(PersonaDefinitionIdSchema),
  attachedRecaps: z.optional(z.strictObject({ full: z.nullable(AttachedRecapSchema), short: z.nullable(AttachedRecapSchema) })),
  presetQuestion: z.optional(z.string()),
  quota: QuotaSchema,
});

export const ContentDeltaFrameSchema = z.strictObject({ type: z.literal('content_delta'), text: z.string() });
/** Debug only on screen. */
export const ReasoningDeltaFrameSchema = z.strictObject({ type: z.literal('reasoning_delta'), text: z.string() });

/** Always logged; shown only in debug. */
export const UsageFrameSchema = z.strictObject({
  type: z.literal('usage'),
  usage: z.object({
    inputTokens: CountSchema,
    outputTokens: CountSchema,
    cacheWriteTokens: CountSchema,
    cacheReadTokens: CountSchema,
    costMicroUsd: MicroUsdSchema,
    costApproximate: z.boolean(),
  }),
  providerResponseId: z.nullable(z.string()),
  cacheHit: z.boolean(),
});

/** Terminal. `code` maps through HUB_SSE_ERROR_CODES; only `provider_rate_limited` carries `retryAfterMs`. */
export const ErrorFrameSchema = z.strictObject({
  type: z.literal('error'),
  code: boundedText(100),
  message: boundedText(500),
  retryAfterMs: z.nullable(CountSchema),
});

/** Terminal; actions on the result open only after it (§7). */
export const DoneFrameSchema = z.strictObject({ type: z.literal('done'), stopReason: z.nullable(z.string()) });

export const AI_DEBUG_PROMPT_BLOCK_MAX_CHARS = 2_500_000;
const DebugPromptBlockSchema = z.strictObject({
  text: boundedText(AI_DEBUG_PROMPT_BLOCK_MAX_CHARS),
  cache: z.enum(['1h', '5m', 'none']),
});
const FANSLY_AVATAR_URL = /^https:\/\/[a-z0-9-]+\.fansly\.com\//;

/** Prompt snapshot for debug-prompt.html (`debug-input-v1`); kept in the background's memory only. */
export const DebugInputFrameSchema = z.strictObject({
  type: z.literal('debug_input_v1'),
  systemBlocks: z.array(DebugPromptBlockSchema).check(z.minLength(1), z.maxLength(64)),
  userBlocks: z.array(DebugPromptBlockSchema).check(z.minLength(1), z.maxLength(64)),
  contextManifest: z.nullable(z.record(z.string(), z.unknown())),
  images: z.optional(
    z.array(z.strictObject({ url: z.string().check(z.maxLength(4096), z.regex(FANSLY_AVATAR_URL)) })).check(z.maxLength(1)),
  ),
});

// Known values of `source`, `live.status`, `coverage` and `knownFanMessage.state`
// are ops.ts CONTEXT_SOURCES, LIVE_TEXT_STATUSES, COVERAGE_LEVELS and
// KNOWN_FAN_MESSAGE_STATES: the tab's ServedContext narrows to them.
export const FAN_LANGUAGE_EVIDENCE = ['latin', 'cyrillic', 'mixed', 'unknown'] as const;

const ContextHeadSchema = z.object({
  messageRef: z.string(),
  occurredAt: z.nullable(IsoTimestampSchema),
  isFromFan: z.boolean(),
});

/**
 * H-4b: the snapshot that ACTUALLY served this generation, for every feature,
 * right after `meta` and before the first `content_delta` — only when we
 * declared `context-v1`. Not strict: future keys are safe. `source` names the
 * hub reader; our fresh text is the separate `live` block.
 */
export const ContextFrameSchema = z.object({
  type: z.literal('context_v1'),
  /** = meta.requestId. */
  generationRef: UuidSchema,
  source: OpenTokenSchema,
  servedHead: z.nullable(ContextHeadSchema),
  /** Diagnostics only. */
  archiveHead: z.optional(z.nullable(ContextHeadSchema)),
  window: z.object({ requested: CountSchema, served: CountSchema }),
  coverage: OpenTokenSchema,
  knownFanMessage: z.optional(z.object({ id: z.string(), state: OpenTokenSchema })),
  live: z.object({ status: OpenTokenSchema, accepted: CountSchema, rejected: CountSchema }),
  fanLanguageEvidence: z.optional(OpenTokenSchema),
});

/** Every frame of `aiFeatureStream` this client accepts. */
export const HubFrameSchema = z.discriminatedUnion('type', [
  MetaFrameSchema,
  ContentDeltaFrameSchema,
  ReasoningDeltaFrameSchema,
  UsageFrameSchema,
  ErrorFrameSchema,
  DoneFrameSchema,
  DebugInputFrameSchema,
  ContextFrameSchema,
]);
export type HubFrame = z.infer<typeof HubFrameSchema>;
export type HubFrameType = HubFrame['type'];
export type MetaFrame = z.infer<typeof MetaFrameSchema>;
export type ContextFrame = z.infer<typeof ContextFrameSchema>;
export type ErrorFrame = z.infer<typeof ErrorFrameSchema>;

/** Frames that end a stream; EOF before one of them is CG-STREAM-TRUNCATED. */
export const HUB_TERMINAL_FRAMES = ['done', 'error'] as const satisfies readonly HubFrameType[];
