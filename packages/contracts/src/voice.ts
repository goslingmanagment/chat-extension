// Voice notes on both sites (1.47.0; the hub's voice-notes lane, HF-4): a
// script spoken from the chat's draft, its paid voicings («варианты») and
// the MP3 the person hands to the site's own composer. One vocabulary for
// ChatSpace (OnlyFans) and Fansly: the studio, its controller and the
// background's service are shared; what differs is the site's handoff of the
// file (HostPort.attachFile) and the chat's ids (on OnlyFans the chat is the
// fan, on Fansly the group).
//
// The flow. The script is an operation of the shared scheduler
// (`voice-script`, a site operation of every site: its admission, timeouts,
// cancel and kept result) — free of characters, spent from the AI quota. A
// take is the paid step: the background writes it into the chat's session
// BEFORE it asks the hub (`voiceNoteCreate`, the take's id is the hub's
// `clientRequestId`), never repeats it by itself, and follows its status
// until the audio is ready. The audio is checked against the hub's sha256
// and length before anyone plays or attaches it. Nothing here sends: the
// person sends the voice with the site's own Send.
//
// Sessions live in storage.local, one per chat, so a reload, a closed tab or
// a restarted browser keeps the takes the person paid for (the old Fansly
// extension kept them for six hours of one browser session only).

import * as z from 'zod/mini';

import { CgErrorWireSchema, type CgCode } from './errors';
import { ToneSchema, type Tone } from './features';
import { LiveTextTailSchema } from './host';
import { ChatRefSchema, HumanCauseSchema, TargetSchema } from './ids';
import { AI_REQUEST_LIMITS, OP_TIMEOUTS, type OpTimeouts } from './limits';
import { OpDraftSchema, OpViewSchema } from './ops';
import { CountSchema, EpochMsSchema, GenerationRefSchema, HubIntIdSchema, IsoTimestampSchema, NativeIdSchema, OpenTokenSchema, UuidSchema, boundedText, displayText } from './primitives';

export const VOICE_LIMITS = {
  /** The hub's live `voiceNotesScriptMaxChars` default: the editor counts to it. The hub checks the script itself. */
  scriptChars: 600,
  /** A script on the wire, a sanity cap: the hub's own schema stops at 8000. */
  scriptMaxChars: 5_000,
  /** The draft a script was made from, kept with its session (shown as «из черновика», asked again by «Переписать»). */
  draftMaxChars: 5_000,
  /** Takes of one session; the hub's day budget of characters bounds the spend anyway. */
  takesPerSession: 12,
  /** Sessions kept, one per chat: the least recently touched beyond this goes — one with a paid take not in the field yet last. */
  sessions: 40,
  /** A session nobody touched for this long goes (the hub keeps the audio longer; this is our list of it). */
  sessionTtlMs: 3 * 24 * 60 * 60 * 1000,
  /** One MP3 from the hub (the hub's own cap, 2 MiB). */
  audioMaxBytes: 2 * 1024 * 1024,
  /** A status read of a take in flight, then again after this long. */
  pollMs: 1_500,
  /** A failed status read waits longer each time, up to this (a free read, never the paid create). */
  pollMaxMs: 15_000,
  /** How long a take may stay in flight before the studio says it takes long (the hub's lease is 120 s). */
  slowMs: 45_000,
  /** Characters a second of speech, for «≈ N с». */
  charsPerSecond: 14,
  /** 1.49.0: a page's day allowance is read from the hub again after this long (a free read; a take that moves reads it at once). */
  allowanceTtlMs: 15_000,
} as const;

/**
 * The audio tags a script may carry: the hub's allowlist (hub voice-script-validation.ts), exact strings. Anything else
 * in brackets is refused by the hub (`voice_script_invalid`); the studio checks it before the paid click.
 */
export const VOICE_TAGS = ['[warmly]', '[cheerfully]', '[thoughtful]', '[excited]', '[whispers]', '[chuckles]', '[giggles]', '[sighs]', '[short pause]', '[long pause]'] as const;
export type VoiceTag = (typeof VOICE_TAGS)[number];

/** The studio's presets: the tone of the script (the old extension's «Спокойный · Тёплый · Игривый»). */
export const VOICE_TONES = ['calm', 'warm', 'playful'] as const;
export const VoiceToneSchema = z.enum(VOICE_TONES);
export type VoiceTone = z.infer<typeof VoiceToneSchema>;

/** The hub's `replyTone` of a preset; calm — no tone (`none`). */
export const VOICE_TONE_REPLY: Readonly<Record<VoiceTone, Tone | null>> = { calm: null, warm: 'casual', playful: 'flirty' };

// ── the script: an operation of the shared scheduler ─────────────────────────

/** What drives `voice-script` in the scheduler: the hub feature it streams, the manifest entry that admits it, its timeouts. */
export const VOICE_OP_DRIVER = {
  hub: 'voice-script',
  feature: 'voice',
  result: 'voice-script',
  timeouts: OP_TIMEOUTS.reply,
} as const satisfies { readonly hub: string; readonly feature: string; readonly result: string; readonly timeouts: OpTimeouts };

/**
 * The voice script's start (`VoiceScriptStart` of ops.ts): spoken from the draft in the chat's field (never blank), in
 * a preset's tone (null — calm). Any site's chat: the target's refinements hold the ids (on OnlyFans the chat is the
 * fan, on Fansly the group named apart from the fan).
 */
export const VoiceScriptStartSchema = z
  .strictObject({
    feature: z.literal('voice-script'),
    target: TargetSchema,
    cause: HumanCauseSchema,
    window: z.int().check(z.gte(AI_REQUEST_LIMITS.messageCountMin), z.lte(AI_REQUEST_LIMITS.messageCountMax)),
    fresh: z.optional(LiveTextTailSchema),
    regenerateOf: z.optional(UuidSchema),
    force: z.optional(z.boolean()),
    tone: z.nullable(ToneSchema),
    draft: OpDraftSchema,
  })
  .check(z.refine((start) => start.draft.text.trim() !== '', { message: 'the voice script is spoken from a draft' }));
export type VoiceScriptStartWire = z.infer<typeof VoiceScriptStartSchema>;

/** The script, ready for the editor and then for the paid voicing; its source is the view's `generationRef`. */
export const VoiceScriptResultSchema = z.strictObject({
  kind: z.literal('voice-script'),
  script: boundedText(VOICE_LIMITS.scriptMaxChars).check(z.refine((script) => script.trim() !== '', { message: 'an empty voice script' })),
});

/** The voice script's kept view, as the scheduler keeps it for any site. */
export const VoiceOpViewSchema = z
  .strictObject({
    ...OpViewSchema.shape,
    feature: z.literal('voice-script'),
    result: z.optional(VoiceScriptResultSchema),
  })
  .check(z.refine((view) => view.state !== 'done' || (view.result !== undefined && view.generationRef !== undefined), { message: 'done needs a result and its source' }));
export type VoiceOpView = z.infer<typeof VoiceOpViewSchema>;

// ── the hub's voice note ─────────────────────────────────────────────────────

/** The hub's voice note states (`voiceNoteStateSchema` of the SDK). */
export const VOICE_NOTE_STATES = ['queued', 'dispatched', 'completed', 'indeterminate', 'failed_definite', 'failed_after_dispatch', 'quota_denied', 'artifact_expired'] as const;
export type VoiceNoteState = (typeof VOICE_NOTE_STATES)[number];

export const Sha256HexSchema = z.string().check(z.regex(/^[0-9a-f]{64}$/));

/** A voice note as the hub reports it (`voiceNoteStatusSchema` of the SDK). */
export const VoiceNoteViewSchema = z.strictObject({
  voiceNoteId: HubIntIdSchema,
  state: z.enum(VOICE_NOTE_STATES),
  scriptChars: CountSchema,
  /** null — the hub does not know yet. */
  billed: z.nullable(z.boolean()),
  audioSha256: z.nullable(Sha256HexSchema),
  audioBytesLen: z.nullable(CountSchema),
  createdAt: IsoTimestampSchema,
  /** The hub's own failure word, for diagnostics only. */
  errorCode: z.optional(OpenTokenSchema),
});
export type VoiceNoteView = z.infer<typeof VoiceNoteViewSchema>;

// ── a take: one paid voicing ─────────────────────────────────────────────────

/**
 * Where a take stands:
 * - `creating` — written before the hub's create; no answer yet;
 * - `uncertain` — the create got no clear answer: it may have been charged. Never repeated by itself; the person's
 *   «Проверить» asks again with the same id, which the hub answers with the same note (or creates it once);
 * - `working` — the hub admitted it (queued or rendering);
 * - `ready` — rendered; its audio's sha256 and length are known;
 * - `failed` — the render failed (`error` says whether characters were spent);
 * - `refused` — the hub refused the create: nothing was charged (quota, script, source, the lane off…);
 * - `expired` — the hub no longer keeps the audio.
 */
export const VOICE_TAKE_STATES = ['creating', 'uncertain', 'working', 'ready', 'failed', 'refused', 'expired'] as const;
export type VoiceTakeState = (typeof VOICE_TAKE_STATES)[number];

export const VoiceTakeSchema = z.strictObject({
  /** The hub's `clientRequestId` of the create: one take, one id, for ever. */
  takeId: UuidSchema,
  createdAt: EpochMsSchema,
  /** The script it voices, as it was sent; the session's script may have moved on since. */
  script: boundedText(VOICE_LIMITS.scriptMaxChars),
  /** The source generation it was sent with (the hub's check of the script's origin). */
  sourceGenerationRef: GenerationRefSchema,
  state: z.enum(VOICE_TAKE_STATES),
  voiceNoteId: z.nullable(HubIntIdSchema),
  /** The facts the audio is checked against: the hub's sha256 and length; null until rendered. */
  audio: z.nullable(z.strictObject({ sha256: Sha256HexSchema, bytes: z.int().check(z.gte(1), z.lte(VOICE_LIMITS.audioMaxBytes)) })),
  /** Characters spent: true, false, or null — not known. */
  billed: z.nullable(z.boolean()),
  /** Why it failed, was refused or is uncertain; null otherwise. */
  error: z.nullable(CgErrorWireSchema),
  /** The person put it into the chat's field: seen there (`attached`), or handed over and not seen (`unknown`). */
  attached: z.nullable(z.strictObject({ state: z.enum(['attached', 'unknown']), at: EpochMsSchema })),
});
export type VoiceTake = z.infer<typeof VoiceTakeSchema>;

/** The take states that still wait for the hub: their status is read until they settle. */
export const VOICE_TAKE_IN_FLIGHT: readonly VoiceTakeState[] = ['creating', 'working'];

// ── a session: the chat's voice ──────────────────────────────────────────────

/** The chat's script: the AI's text from the draft in a preset's tone, and the person's text of it. */
export const VoiceScriptSchema = z.strictObject({
  tone: VoiceToneSchema,
  /** The source of the paid voicing (HF-4а): the `voice-script` generation that wrote it. */
  generationRef: GenerationRefSchema,
  /** The AI's script. */
  original: boundedText(VOICE_LIMITS.scriptMaxChars),
  /** The person's text of it; null — the AI's as it is. */
  edited: z.nullable(displayText(VOICE_LIMITS.scriptMaxChars)),
});
export type VoiceScript = z.infer<typeof VoiceScriptSchema>;

/** A script being written: the `voice-script` operation; it takes the place of `script` once it is done. */
export const VoiceWritingSchema = z.strictObject({
  opId: UuidSchema,
  tone: VoiceToneSchema,
  startedAt: EpochMsSchema,
});
export type VoiceWriting = z.infer<typeof VoiceWritingSchema>;

/**
 * The voice of one chat: its draft, its script and the takes of it. One per chat; «Новый войс» discards it (the
 * hub keeps the paid audio; the person is asked first when a take was never put into the field).
 */
export const VoiceSessionSchema = z.strictObject({
  sessionId: UuidSchema,
  pageId: HubIntIdSchema,
  chat: ChatRefSchema,
  /** The hub's chat (on OnlyFans the fan, on Fansly the group) and the fan, as the script was asked for them. */
  conversationRef: NativeIdSchema,
  fanRef: NativeIdSchema,
  createdAt: EpochMsSchema,
  updatedAt: EpochMsSchema,
  /** Grows on every write: a view of an older one is replaced by the newer. */
  revision: CountSchema,
  /** The draft the script was made from. */
  draft: boundedText(VOICE_LIMITS.draftMaxChars),
  /** The script to voice; null — none written yet. A rewrite keeps it until the new one is done. */
  script: z.nullable(VoiceScriptSchema),
  writing: z.nullable(VoiceWritingSchema),
  /** The last failure of the session's own: a script that could not be written. null — none. */
  error: z.nullable(CgErrorWireSchema),
  takes: z.array(VoiceTakeSchema).check(z.maxLength(VOICE_LIMITS.takesPerSession)),
});
export type VoiceSession = z.infer<typeof VoiceSessionSchema>;

/** The MP3 of a ready take, checked: the bytes as base64 (4 characters a 3 bytes). */
export const VOICE_AUDIO_BASE64_MAX = Math.ceil(VOICE_LIMITS.audioMaxBytes / 3) * 4;
export const VoiceAudioSchema = z.strictObject({
  mime: z.literal('audio/mpeg'),
  base64: z.string().check(z.maxLength(VOICE_AUDIO_BASE64_MAX), z.regex(/^[A-Za-z0-9+/]*={0,2}$/)),
  sha256: Sha256HexSchema,
  bytes: z.int().check(z.gte(1), z.lte(VOICE_LIMITS.audioMaxBytes)),
});
export type VoiceAudio = z.infer<typeof VoiceAudioSchema>;

/** What a write of the session answers: the session as stored, or why not (with the session as it is, when there is one). */
export const VoiceWriteResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), session: VoiceSessionSchema }),
  z.strictObject({ ok: z.literal(false), error: CgErrorWireSchema, session: z.nullable(VoiceSessionSchema) }),
]);
export type VoiceWriteResult = z.infer<typeof VoiceWriteResultSchema>;

// ── the hub's refusals as CG codes ───────────────────────────────────────────

/**
 * The hub's voice codes (hub docs/error-handling.md, HF-4): the status each comes with (the fake hub answers with it)
 * and the CG code it reads as. A failure of the voice calls (create, status, audio) is read by this table first, then
 * by the shared rules (hub/error-map.ts), which claim no `voice_*` code. `gate_voice_*` come on the AI stream of
 * `voice-script`; `gate_voice_unsupported_platform` and `gate_voice_identity_required` are our own bugs there and stay
 * CG-HUB-REQUEST by their 400.
 */
export const HUB_VOICE_ERROR_CODES = {
  voice_disabled: { status: 403, cg: 'CG-VOICE-OFF' },
  voice_not_allowlisted: { status: 403, cg: 'CG-VOICE-NOT-ALLOWED' },
  gate_voice_disabled: { status: 400, cg: 'CG-VOICE-NOT-ALLOWED' },
  voice_no_profile: { status: 409, cg: 'CG-VOICE-NO-PROFILE' },
  gate_voice_no_profile: { status: 400, cg: 'CG-VOICE-NO-PROFILE' },
  voice_script_invalid: { status: 400, cg: 'CG-VOICE-SCRIPT' },
  voice_source_invalid: { status: 400, cg: 'CG-VOICE-SOURCE' },
  voice_quota_denied: { status: 429, cg: 'CG-VOICE-QUOTA' },
  idempotency_mismatch: { status: 409, cg: 'CG-VOICE-ATTEMPT' },
  artifact_expired: { status: 410, cg: 'CG-VOICE-EXPIRED' },
  voice_retrieval_disabled: { status: 403, cg: 'CG-VOICE-RETRIEVAL-OFF' },
  voice_provider_unavailable: { status: 503, cg: 'CG-VOICE-PROVIDER' },
  gate_voice_provider_unavailable: { status: 400, cg: 'CG-VOICE-PROVIDER' },
  voice_artifact_corrupt: { status: 500, cg: 'CG-VOICE-CORRUPT' },
} as const satisfies Readonly<Record<string, { readonly status: number; readonly cg: CgCode }>>;
export type HubVoiceErrorCode = keyof typeof HUB_VOICE_ERROR_CODES;

// ── the hub's routes (`voiceNoteCreate`, `voiceNoteStatus`, `voiceNoteAudio`; the SDK's schemas) ─────────────

/** The create's body: the SDK's `voiceNoteCreateBodySchema` (`fanRef` apart from the chat on Fansly, HF-4а). */
export const VoiceNoteCreateBodySchema = z.strictObject({
  clientRequestId: UuidSchema,
  conversationRef: z.string().check(z.minLength(1), z.maxLength(200)),
  fanRef: z.optional(z.string().check(z.minLength(1), z.maxLength(200))),
  sourceGenerationRef: z.string().check(z.minLength(1), z.maxLength(200)),
  script: z.string().check(z.minLength(1), z.maxLength(8000)),
});
export type VoiceNoteCreateBody = z.infer<typeof VoiceNoteCreateBodySchema>;

/** A create as the facade takes it: the page's label beside the body. */
export const VoiceNoteCreateRequestSchema = z.strictObject({ pageLabel: boundedText(120), body: VoiceNoteCreateBodySchema });
export type VoiceNoteCreateRequest = z.infer<typeof VoiceNoteCreateRequestSchema>;

/** A voice note of a page: its status, its audio. */
export const VoiceNoteRefSchema = z.strictObject({ pageLabel: boundedText(120), voiceNoteId: HubIntIdSchema });
export type VoiceNoteRef = z.infer<typeof VoiceNoteRefSchema>;

/** The audio route answers bytes, not JSON: the registry's marker of that answer (the caller checks sha256 and length). */
export const VoiceNoteAudioBytesSchema = z.custom<ArrayBuffer>((value) => value instanceof ArrayBuffer && value.byteLength > 0 && value.byteLength <= VOICE_LIMITS.audioMaxBytes);

// ── the day's allowance (1.49.0; `voiceNoteAllowance`) ───────────────────────

/**
 * What a page may still voice today, as the hub counts it (`voiceNoteAllowance`, a free read): the live cap of one
 * script, the page's day budget, what a create could reserve now — the smaller of the page's and the whole hub's day
 * budget left, never below 0 — and when the day (UTC) renews. The studio says it beside «Озвучить»; the hub still
 * decides every create (`voice_quota_denied` charges nothing).
 */
export const VoiceAllowanceSchema = z.strictObject({
  scriptMaxChars: z.int().check(z.gte(1)),
  dailyChars: CountSchema,
  remainingChars: CountSchema,
  resetsAt: IsoTimestampSchema,
});
export type VoiceAllowance = z.infer<typeof VoiceAllowanceSchema>;

/** The allowance of a page, as the facade takes it. */
export const VoiceAllowanceQuerySchema = z.strictObject({ pageLabel: boundedText(120) });
export type VoiceAllowanceQuery = z.infer<typeof VoiceAllowanceQuerySchema>;
