// The AI stream (architecture.md §8.4; hub H-4b/H-4c, H-10): persona catalog,
// our feature → hub feature map, the request body we send to `aiFeatureStream`
// and every SSE frame the stream may carry. The SDK checks frames strictly
// before we see them; unknown frames are an error. Split markers travel inside
// `content_delta` text (D-15): there is no Split frame.

import * as z from 'zod/mini';

import { TONES, type FeatureId } from '../features';
import { HiFanAvatarUrlSchema, StartProofV1Schema, hasHiStartFields, hiStartProofMatches } from '../hi-start-proof';
import { AI_REQUEST_LIMITS, COACH_LIMITS, COVERAGE_CHECK_LIMITS, LIVE_TEXT_LIMITS, NOTE_FILL_LIMITS, SEND_LIMITS } from '../limits';
import { CoverageDeletedIdsSchema, CoverageWindowSchema, LivePpvStateSchema, coverageIdsOnce } from '../ops';
import {
  CountSchema,
  IsoTimestampSchema,
  MicroUsdSchema,
  NativeIdSchema,
  OpenTokenSchema,
  PersonaDefinitionIdSchema,
  PersonaKeySchema,
  UuidSchema,
  boundedText,
} from '../primitives';
import { AI_STREAM_CAPABILITIES, AiStreamCapabilitySchema, PageLabelSchema, type ClientHubCapability } from './wire';

// ── Persona catalog (`aiPersonaCatalog`: metadata only, never prompt text) ──

export const PersonaCatalogItemSchema = z.object({
  key: PersonaKeySchema,
  displayName: boundedText(120),
  version: z.int().check(z.gte(1)),
  definitionId: PersonaDefinitionIdSchema,
  status: z.enum(['active', 'archived']),
});
export type PersonaCatalogItem = z.infer<typeof PersonaCatalogItemSchema>;

export const PersonaCatalogSchema = z.object({ personas: z.array(PersonaCatalogItemSchema) });
export type PersonaCatalog = z.infer<typeof PersonaCatalogSchema>;

// ── Feature map (§8.4 table) ───────────────────────────────────────────────

/**
 * Hub feature keys this client streams (`aiUsageFeatures` subset; path param of `aiFeatureStream`). 1.15.0 (R20
 * P4b3): the two of Fansly's own operations (`SiteOpId`, architecture §8.8) — `voice-script` (the voice script, the
 * page's `voice`) and `fan-notes-fill` («Заполнить из чата», the page's `notesFill`). Which operation streams which
 * is the site's table (`FANSLY_OP_DRIVERS`, ops-fansly.ts); `HUB_FEATURE_MAP` stays the shared features'.
 */
export const HUB_AI_FEATURES = ['fast-reply', 'improve-draft', 'hi-greeting', 'ping', 'chat-review', 'fan-summary', 'coach-chat', 'voice-script', 'fan-notes-fill'] as const;
export const HubAiFeatureSchema = z.enum(HUB_AI_FEATURES);
export type HubAiFeature = z.infer<typeof HubAiFeatureSchema>;

/** 1.15.0 (R20 P4b3): the hub features of a site's own operations — each a Fansly page's, each names its fan. */
const SITE_HUB_FEATURES: readonly HubAiFeature[] = ['voice-script', 'fan-notes-fill'];

/** Body fields only one hub feature takes; anything else in this list on another feature is our bug. */
export const HUB_FEATURE_ONLY_FIELDS = {
  /** 1.15.0: the voice script speaks a tone too (the hub's `supportsReplyTone`; the panel's three presets). */
  replyTone: ['fast-reply', 'voice-script'],
  /** 1.15.0: the voice script is written from the draft (the hub's `requiresDraft`). */
  draftText: ['improve-draft', 'coach-chat', 'voice-script'],
  variantCount: ['hi-greeting'],
  startProof: ['hi-greeting'],
  personalMessageCount: ['hi-greeting'],
  fanAvatarUrl: ['hi-greeting'],
  summaryMode: ['fan-summary'],
  chatterQuestion: ['coach-chat'],
  coachHistory: ['coach-chat'],
  preset: ['coach-chat'],
  /**
   * Fresh text (D-14, H-4c): draft features; 1.23.0 (decision X52) Review and Coach too, on a hub that lists
   * `live-text-review-coach-v1` (`LIVE_TEXT_HUB_NEEDS`); Recap never.
   */
  liveTextContext: ['fast-reply', 'improve-draft', 'hi-greeting', 'ping', 'chat-review', 'coach-chat'],
  /** 1.27.0 (X54): the open chat's PPV state, where fresh text goes (the hub refuses it elsewhere, 400). */
  livePpvContext: ['fast-reply', 'improve-draft', 'hi-greeting', 'ping'],
  /** 1.15.0 (R20 P4b3): the questionnaire's labels, the notes fill's alone. */
  noteFields: ['fan-notes-fill'],
  /** 1.16.0 (R20 P11b2): the merge mode — the questionnaire's values (`NoteValuesSchema`; empty only before 1.28.0). */
  noteValues: ['fan-notes-fill'],
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

/**
 * 1.23.0 (decision X52): what a feature's fresh text needs of the hub beyond the page's `freshText` — Review and Coach
 * take it only on a hub that lists `live-text-review-coach-v1` (an older one answers 400 `live_text_not_allowed`).
 * The draft features need nothing more. The planner asks for no tail and the request builder sends none without it.
 */
export const LIVE_TEXT_HUB_NEEDS: Readonly<Partial<Record<FeatureId, ClientHubCapability>>> = {
  review: 'live-text-review-coach-v1',
  coach: 'live-text-review-coach-v1',
};

/** Split markers inside the generated text (D-15): `[VARIANT]` separates Hi variants, `[NEXT]` parts. */
export const SPLIT_MARKERS = { next: '[NEXT]', variant: '[VARIANT]' } as const;

// ── Request body (`aiFeatureStreamBodySchema` + H-4b/H-4c) ─────────────────

export const AI_MESSAGE_COUNT = { min: AI_REQUEST_LIMITS.messageCountMin, max: AI_REQUEST_LIMITS.messageCountMax } as const;
export const COACH_ANSWER_MAX_CHARS = COACH_LIMITS.answerMaxChars;
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
 * 1.15.0 (R20 HF-8в) `coverageCheck`: the window check of a start's proof (`CoverageProof`) as the hub takes it
 * (`aiCoverageCheckSchema`): ids only, never a text; every id once across both lists — the hub answers a repeat with
 * 400. Sent only with `coverage-check-v1` and `context-v1`: the answer rides in the context frame.
 */
export const CoverageCheckBodySchema = z
  .strictObject({ window: CoverageWindowSchema, deletedIds: CoverageDeletedIdsSchema })
  .check(z.refine((c) => coverageIdsOnce(c.window, c.deletedIds), { message: 'coverageCheck ids repeat' }));
export type CoverageCheckBody = z.infer<typeof CoverageCheckBodySchema>;

/**
 * 1.15.0 (R20 P4b3; hub `aiNoteFieldsSchema`): one label of the fan's questionnaire («Имя», «Локация»…), as the
 * notes panel reads it off the note — never a value (FS-NOTE-5, FX-015). The model answers one `Label: value` line
 * per label, the label copied byte for byte, so it holds no line break, no `:` and none of `<`, `>`, `&`. The hub
 * trims a label before its checks; this client sends it trimmed, so a label with edge spaces is refused here.
 */
export const NoteFieldLabelSchema = boundedText(NOTE_FILL_LIMITS.labelMaxChars).check(
  z.regex(/^[^\r\n\u2028\u2029:<>&]+$/),
  z.refine((label) => label.trim() === label, { message: 'label untrimmed' }),
);

/** The labels of `fan-notes-fill`, in the order the answer fills them: 1–30, none twice (the hub compares them case-insensitively). */
export const NoteFieldsSchema = z
  .array(NoteFieldLabelSchema)
  .check(
    z.minLength(1),
    z.maxLength(NOTE_FILL_LIMITS.fieldsMax),
    z.refine((labels) => new Set(labels.map((label) => label.toLowerCase())).size === labels.length, { message: 'noteFields repeat' }),
  );

/**
 * 1.28.0 (decision X43, the owner's ruling of 2026-10-17): one value of `noteValues` — what a field's own line holds,
 * trimmed, one line (the client flattens its line breaks), within 2000 UTF-16 code units (`aiNoteValueSchema`: the hub
 * trims too, so this client sends exactly what the hub reads); `''` for an empty field and a template label the note
 * lacks. 1.16.0 allowed only `''`.
 */
const NoteValueSchema = z
  .string()
  .check(
    z.maxLength(NOTE_FILL_LIMITS.valueMaxChars),
    z.refine((value) => value === value.trim(), { message: 'a note value is trimmed' }),
    z.regex(/^[^\r\n\u2028\u2029]*$/, { message: 'a note value holds no line break' }),
  );

/**
 * `noteValues` of `fan-notes-fill` (1.16.0, R20 P11b2; values since 1.28.0, X43): index-aligned with `noteFields`, the
 * questionnaire's current values — the hub's merge mode, as the Fansly extension 2.11.0 sends it (decision 164). The
 * hub answers `Label: =` for a field the chat adds nothing to, its rewrite for one it changes, `+ Label: value` for one
 * it names itself. The values travel in this body and nowhere else: never a log, diagnostics, `client_health` or
 * telemetry (FS-NOTE-5).
 */
export const NoteValuesSchema = z.array(NoteValueSchema).check(z.minLength(1), z.maxLength(NOTE_FILL_LIMITS.fieldsMax));

/**
 * The body this client sends (a strict subset of the hub's body: no model or
 * effort override, no `clientContext` (also on Fansly), no deprecated
 * `greetingMode`; the notes fill's `noteValues` — the questionnaire's values,
 * here and nowhere else, X43). On OnlyFans conversationRef = fanRef = the fan id.
 */
export const AiFeatureStreamBodySchema = z.strictObject({
  /** = opId (§8.4). */
  clientRequestId: UuidSchema,
  pageLabel: PageLabelSchema,
  platform: z.enum(['fansly', 'onlyfans']),
  conversationRef: NativeIdSchema,
  fanRef: z.optional(z.nullable(NativeIdSchema)),
  personaKey: z.optional(z.nullable(PersonaKeySchema)),
  expectedPersonaDefinitionId: z.optional(PersonaDefinitionIdSchema),
  replyTone: z.optional(z.enum(HUB_REPLY_TONES)),
  replyMode: z.optional(z.enum(['default', 'preferSplit'])),
  messageCount: z.optional(z.int().check(z.gte(AI_MESSAGE_COUNT.min), z.lte(AI_MESSAGE_COUNT.max))),
  draftText: z.optional(boundedText(AI_REQUEST_LIMITS.draftMaxChars)),
  isRegeneration: z.optional(z.boolean()),
  chatterQuestion: z.optional(boundedText(COACH_LIMITS.questionMaxChars)),
  coachHistory: z.optional(
    z
      .array(z.strictObject({ question: boundedText(COACH_LIMITS.questionMaxChars), answer: boundedText(COACH_ANSWER_MAX_CHARS) }))
      .check(z.maxLength(COACH_LIMITS.historyMaxTurns)),
  ),
  preset: z.optional(z.literal('situation')),
  summaryMode: z.optional(z.literal('short')),
  variantCount: z.optional(z.union([z.literal(1), z.literal(3)])),
  /**
   * H-4b: only ids from the freshness checkpoint (FreshnessCheckpoint
   * .knownFanMessageIds), never text; the hub checks page and fan for each
   * and answers `knownFanMessages` in `context_v1`.
   */
  knownFanMessageIds: z.optional(
    z
      .array(NativeIdSchema)
      .check(
        z.minLength(1),
        z.maxLength(SEND_LIMITS.knownFanMessagesMax),
        z.refine((ids) => new Set(ids).size === ids.length, { message: 'known ids repeat' }),
      ),
  ),
  liveTextContext: z.optional(LiveTextContextSchema),
  /**
   * 1.27.0 (X54; hub `aiLivePpvContextSchema`): the PPV state of the open OnlyFans chat as OnlyMonster's API gives it,
   * only to a hub that lists `live-ppv-v1`, on an OnlyFans page; ids, prices and purchase flags, no text.
   */
  livePpvContext: z.optional(LivePpvStateSchema),
  /** 1.15.0 (R20 HF-8в): the window check — only from a start's proof, under `coverage-check-v1`. */
  coverageCheck: z.optional(CoverageCheckBodySchema),
  /** 1.15.0 (R20 P4b3): `fan-notes-fill` only, and required there — the labels (their values: `noteValues`). */
  noteFields: z.optional(NoteFieldsSchema),
  /** 1.16.0 (R20 P11b2): the hub's merge mode, one value per label — the questionnaire's, since 1.28.0 (X43). */
  noteValues: z.optional(NoteValuesSchema),
  /** 1.15.0 (R20 HF-5): only Fansly hi-greeting under hi-start-proof-v1; ids only, never a text. */
  startProof: z.optional(StartProofV1Schema),
  /** Optional repetition of startProof.personalCount; alone it proves nothing. */
  personalMessageCount: z.optional(CountSchema),
  /** FX-018: same schema as the old clientContext avatar; the hub forwards it as an image, never fetches it. */
  fanAvatarUrl: z.optional(HiFanAvatarUrlSchema),
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
    // 1.27.0 (X54): the hub takes the PPV state on an OnlyFans page only (`live_text_not_allowed` elsewhere).
    z.refine((r) => r.body.livePpvContext === undefined || r.body.platform === 'onlyfans', { message: 'livePpvContext only on OnlyFans' }),
    // 1.15.0: a hub before HF-8в refuses the field (its body is strict); one after answers it only to both tokens.
    z.refine((r) => r.body.coverageCheck === undefined || (r.capabilities.includes('coverage-check-v1') && r.capabilities.includes('context-v1')), {
      message: 'coverageCheck needs coverage-check-v1 and context-v1',
    }),
    z.refine((r) => !hasHiStartFields(r.body) || (r.body.platform === 'fansly' && r.capabilities.includes('hi-start-proof-v1')), {
      message: 'Hi fields need Fansly and hi-start-proof-v1',
    }),
    z.refine((r) => hiStartProofMatches(r.body, r.body.conversationRef), { message: 'start_proof_mismatch' }),
    z.refine((r) => r.feature !== 'improve-draft' || r.body.draftText !== undefined, { message: 'Fix needs draftText' }),
    // 1.15.0 (R20 P4b3), the hub's own rules of Fansly's two features (its handler; else 400, or 409 for our narrow
    // token on a page without the switch): a Fansly page's, the fan named apart from the group; the voice script is
    // spoken from a draft that is not blank, the notes fill needs the labels it fills.
    z.refine((r) => !SITE_HUB_FEATURES.includes(r.feature) || (r.body.platform === 'fansly' && typeof r.body.fanRef === 'string'), {
      message: 'a Fansly feature: its page and fan',
    }),
    z.refine((r) => r.feature !== 'voice-script' || (r.body.draftText ?? '').trim() !== '', { message: 'voice-script needs draftText' }),
    z.refine((r) => r.feature !== 'fan-notes-fill' || r.body.noteFields !== undefined, { message: 'fan-notes-fill needs noteFields' }),
    // The hub: `noteValues must hold exactly one value per noteFields label` (400).
    z.refine((r) => r.body.noteValues === undefined || r.body.noteValues.length === r.body.noteFields?.length, { message: 'noteValues: one per noteFields label' }),
    z.refine((r) => r.body.summaryMode === undefined || r.feature === 'fan-summary', { message: 'summaryMode is fan-summary only' }),
    // 1.3.0, the hub's own rule of `coach-chat` (400 otherwise): a preset carries its question on the hub and
    // forbids ours; without a preset a question is required.
    z.refine((r) => r.feature !== 'coach-chat' || r.body.preset === undefined || (r.body.chatterQuestion ?? '').trim() === '', {
      message: 'coach-chat preset forbids chatterQuestion',
    }),
    z.refine((r) => r.feature !== 'coach-chat' || r.body.preset !== undefined || (r.body.chatterQuestion ?? '').trim() !== '', {
      message: 'coach-chat requires chatterQuestion',
    }),
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

// Known values of `source`, `live.status`, `coverage` and `knownFanMessages[].state`
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
  /** One answer per id of the body's `knownFanMessageIds`: included | absent | deleted | unknown. */
  knownFanMessages: z.optional(z.array(z.object({ id: z.string(), state: OpenTokenSchema })).check(z.maxLength(SEND_LIMITS.knownFanMessagesMax))),
  /**
   * 1.15.0 (R20 HF-8в): one answer per id of the body's `coverageCheck`, each list in the body's order — only to a
   * request with `coverage-check-v1`. States are the hub's open tokens; `narrowCoverageCheck` (ops.ts) reads them.
   */
  coverageCheck: z.optional(
    z.object({
      window: z.array(z.object({ id: z.string(), state: OpenTokenSchema })).check(z.maxLength(COVERAGE_CHECK_LIMITS.windowMax)),
      deleted: z.array(z.object({ id: z.string(), state: OpenTokenSchema })).check(z.maxLength(COVERAGE_CHECK_LIMITS.deletedMax)),
    }),
  ),
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
