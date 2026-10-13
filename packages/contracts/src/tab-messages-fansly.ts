// fansly.com's own tab protocol (1.15.0; R20 docs/project-unite/architecture.md
// §1.6, §8, §12): the requests and events only a Fansly tab, its relay frame
// and the `bg/fansly` chunk speak, beside the shared registry
// (tab-messages.ts) that a Fansly tab speaks too.
//
// - Same envelope, transport and sender rules (tab-protocol.ts). Every type is
//   `fansly.<family>.<name>` and every request names `hosts: ['fansly-web']`:
//   a ChatSpace tab may send none of them, and a ChatSpace bundle never carries
//   this module (it is not in the package index).
// - The background core checks the sender, the tab session, the site and the
//   envelope; the body is parsed here, in the site's chunk
//   (`parseFanslyTabPayload`), and so is the answer.
// - A failure of the site's own (a `CG-FAN-*`, `CG-NOTE-*`… code) travels in
//   the payload, `{ok: false, error: CgAnyErrorWire}`: the shared envelope's
//   error carries shared codes only, which every receiver can read
//   (errors-fansly.ts).
// - Only ids, states and the texts the person sees cross here. Session headers
//   cross only to the relay frame (`fansly.relay.fetch`) and are never logged;
//   a note's text only between the «Заметки» panel and the background, never
//   to the hub (FS-NOTE-5).
//
// Families. `fansly.followers.*` — «Новые» by the background's pass (Б17,
// FS-NEW-*); `fansly.notes.*` — the fan's native notes (FS-NOTE-*);
// `fansly.voice.*` — paid voice notes over the hub (HF-4, FS-VOI-*; the script
// is the `voice-script` operation of the shared `op.start`);
// `fansly.vault.*` — upload checkpoints (FS-VLT-*); `fansly.relay.*` — «Fansly
// через вкладку» (FS-NET-4, port `cg-relay`). A family's own PR (P10*, P11b,
// P12b*, P13a, P9c) may add fields and types to it, additively.

import * as z from 'zod/mini';

import { CgAnyErrorWireSchema } from './errors-fansly';
import { type HostKind } from './hosts';
import { CountSchema, EpochMsSchema, GenerationRefSchema, HubIntIdSchema, IsoTimestampSchema, NativeIdSchema, OpenTokenSchema, UuidSchema, boundedText, displayText } from './primitives';
import type { TabPayloadCheck } from './tab-messages';
import { senderAllowed, type ExtensionPage, type TabEventSpec, type TabRequestSpec, type TabSender } from './tab-protocol';

/** Every type of this registry starts with it; no shared type does. */
export const FANSLY_TAB_TYPE_PREFIX = 'fansly.';

const FANSLY = ['fansly-web'] as const satisfies readonly HostKind[];
const TAB = ['tab'] as const satisfies readonly TabSender[];
const RELAY = ['relay'] as const satisfies readonly TabSender[];

const Ack = z.strictObject({ recorded: z.boolean() });
/** The site's own failure, in the payload (`ok: false`); the other branch of each answer is `ok: true`. */
const Failure = z.strictObject({ ok: z.literal(false), error: CgAnyErrorWireSchema });
const Done = z.strictObject({ ok: z.literal(true) });

export const FANSLY_TAB_LIMITS = {
  /** «Новые» window (NF-003): 1–720 hours, 48 by default. */
  windowHoursMin: 1,
  windowHoursMax: 720,
  windowHoursDefault: 48,
  /** Rows of one `fansly.followers.read` answer (NF-006 pages of 100 fit five times). */
  followerRowsPerRead: 500,
  /** Changed rows in one `fansly.followers.changed` event. */
  followerRowsPerChange: 100,
  /** Messages of one preview read; the window shows up to 750 by «загрузить ещё» (NF-010). */
  historyMessagesPerRead: 250,
  historyMessageMaxChars: 20_000,
  /** Fansly states no limit; ours sit far above any real note and are never cut (FS-NOTE-4: a longer text is refused). */
  noteTitleMaxChars: 1_000,
  noteTextMaxChars: 50_000,
  customNameMaxChars: 1_000,
  notesPerFan: 200,
  /** A sanity cap: the hub validates the script itself (`voice_script_invalid`); the editor holds about 600. */
  voiceScriptMaxChars: 5_000,
  voiceAttemptsPerChat: 20,
  /** One MP3 voice note, as base64 in `fansly.voice.audio` (4 characters a 3 bytes). */
  voiceAudioMaxBytes: 8 * 1024 * 1024,
  vaultFilesPerUpload: 500,
  /** The relay: a request body we send, a response body it hands back, and the headers each way. */
  relayRequestBodyMaxChars: 256 * 1024,
  relayResponseBodyMaxChars: 4 * 1024 * 1024,
  relayRequestHeadersMax: 32,
  relayResponseHeadersMax: 8,
} as const;

// ── fansly.followers.* — «Новые» (Б17) ─────────────────────────────────────

/**
 * The background's pass: the fast part (subscribers and confirmed results), then one automatic queue that checks
 * the rest; `cooldown` — the pacer waits out a 429 of the creator; `stopped` — the identity guard (NF-026) or a
 * failure ended it (`error`).
 */
export const FANSLY_PASS_STATES = ['scanning', 'queue', 'paused', 'cooldown', 'done', 'stopped'] as const;
export const FanslyPassStateSchema = z.enum(FANSLY_PASS_STATES);

export const FanslyPassViewSchema = z.strictObject({
  passId: UuidSchema,
  /** The creator (Fansly `account.id`) the pass runs for; a tab on another account gets nothing of it. */
  hostAccountId: NativeIdSchema,
  windowHours: z.int().check(z.gte(FANSLY_TAB_LIMITS.windowHoursMin), z.lte(FANSLY_TAB_LIMITS.windowHoursMax)),
  state: FanslyPassStateSchema,
  startedAt: IsoTimestampSchema,
  counts: z.strictObject({ total: CountSchema, checked: CountSchema, ready: CountSchema, greeted: CountSchema, dmClosed: CountSchema, excluded: CountSchema }),
  /** «Результат неполный» (NF-025). */
  partial: z.boolean(),
  /** When the pacer goes on, during `cooldown`. */
  cooldownUntil: z.nullable(EpochMsSchema),
  /** Why it stopped (CG-FNEW-ACCOUNT, CG-FAN-*); null while it runs, pauses or is done. */
  error: z.nullable(CgAnyErrorWireSchema),
});
export type FanslyPassView = z.infer<typeof FanslyPassViewSchema>;

/** A subscriber's row; `dm-closed` — «Нельзя написать» (FS-NEW-2), decided before any request. */
export const FANSLY_FOLLOWER_STATUSES = ['pending', 'checking', 'ready', 'greeted', 'dm-closed', 'excluded', 'failed'] as const;

export const FanslyFollowerRowSchema = z.strictObject({
  fanRef: NativeIdSchema,
  /** The conversation (`groupId`), once known: never the fan's id (FS-IDN-6). */
  groupId: z.nullable(NativeIdSchema),
  username: z.nullable(displayText(64)),
  displayName: z.nullable(displayText(128)),
  followedAt: IsoTimestampSchema,
  status: z.enum(FANSLY_FOLLOWER_STATUSES),
  /** Why the fan cannot be messaged: a paid DM, or `dmPermissionFlags` the model does not meet. */
  dmClosed: z.nullable(z.enum(['paid', 'permissions'])),
  /** The revision of the history the pass checked in full (FS-NEW-6, FS-NEW-7); null — not checked in full. */
  historyRevision: z.nullable(UuidSchema),
  checkedAt: z.nullable(IsoTimestampSchema),
});
export type FanslyFollowerRow = z.infer<typeof FanslyFollowerRowSchema>;

/** One message of the preview (NF-009, NF-010): the text the person reads in the window, marked when automated. */
export const FanslyPreviewMessageSchema = z.strictObject({
  messageId: NativeIdSchema,
  fromFan: z.boolean(),
  at: IsoTimestampSchema,
  text: displayText(FANSLY_TAB_LIMITS.historyMessageMaxChars),
  /** A welcome, a mass message or another automation: not counted as personal (§5.8). */
  automated: z.boolean(),
  attachments: CountSchema,
});

const PassRef = { passId: UuidSchema };

// ── fansly.notes.* — «Заметки» (FS-NOTE-*) ─────────────────────────────────

/** A regular note (contentType 12000). `foreign` — FBuddy's «FBuddy Notes»: shown read-only, never edited or cleaned. */
export const FanslyNoteSchema = z.strictObject({
  noteId: NativeIdSchema,
  title: displayText(FANSLY_TAB_LIMITS.noteTitleMaxChars),
  text: displayText(FANSLY_TAB_LIMITS.noteTextMaxChars),
  foreign: z.boolean(),
});
export type FanslyNote = z.infer<typeof FanslyNoteSchema>;

/** The one «Custom Username» note (contentType 12002): the name for oneself. */
export const FanslyCustomNameSchema = z.strictObject({ noteId: NativeIdSchema, name: displayText(FANSLY_TAB_LIMITS.customNameMaxChars) });

/** Notes are the creator's, about one fan: every request names both, and the background writes only under that creator's session. */
const NoteTarget = { hostAccountId: NativeIdSchema, fanRef: NativeIdSchema };

// ── fansly.voice.* — paid voice notes (HF-4) ───────────────────────────────

/** The hub's voice note states (`voiceNoteStateSchema` of the SDK). */
export const VOICE_NOTE_STATES = ['queued', 'dispatched', 'completed', 'indeterminate', 'failed_definite', 'failed_after_dispatch', 'quota_denied', 'artifact_expired'] as const;

/** A voice note as the hub reports it (`voiceNoteStatusSchema` of the SDK). */
export const VoiceNoteViewSchema = z.strictObject({
  voiceNoteId: HubIntIdSchema,
  state: z.enum(VOICE_NOTE_STATES),
  scriptChars: CountSchema,
  /** null — the hub does not know yet. */
  billed: z.nullable(z.boolean()),
  audioSha256: z.nullable(z.string().check(z.regex(/^[0-9a-f]{64}$/))),
  audioBytesLen: z.nullable(CountSchema),
  createdAt: IsoTimestampSchema,
  /** The hub's own failure word, for diagnostics only. */
  errorCode: z.optional(OpenTokenSchema),
});
export type VoiceNoteView = z.infer<typeof VoiceNoteViewSchema>;

/**
 * A paid attempt the background keeps across event-page unloads (§8.8, AI-113): created once with its
 * `clientRequestId`, restored with the same one, never repeated by itself. `uncertain` — sent, outcome unknown.
 */
export const VoiceAttemptViewSchema = z.strictObject({
  attemptId: UuidSchema,
  clientRequestId: UuidSchema,
  pageId: HubIntIdSchema,
  conversationRef: NativeIdSchema,
  fanRef: NativeIdSchema,
  state: z.enum(['creating', 'created', 'uncertain', 'failed']),
  view: z.nullable(VoiceNoteViewSchema),
  updatedAt: EpochMsSchema,
});
export type VoiceAttemptView = z.infer<typeof VoiceAttemptViewSchema>;

const VoiceRef = { attemptId: UuidSchema, pageId: HubIntIdSchema, voiceNoteId: HubIntIdSchema };
const BASE64_MAX_CHARS = Math.ceil(FANSLY_TAB_LIMITS.voiceAudioMaxBytes / 3) * 4;

// ── fansly.vault.* — upload checkpoints (FS-VLT-1) ─────────────────────────

/**
 * Where an upload into one album stands, written before each file is handed to Fansly's form: per account and
 * album. A file passed and not confirmed (`pending`) is never uploaded again without the person's answer.
 */
export const VaultCheckpointSchema = z
  .strictObject({
    hostAccountId: NativeIdSchema,
    albumId: NativeIdSchema,
    uploadId: UuidSchema,
    /** The person's files by name, size and time: nothing of their content. */
    files: z
      .array(z.strictObject({ name: displayText(255), size: CountSchema, lastModified: EpochMsSchema }))
      .check(z.minLength(1), z.maxLength(FANSLY_TAB_LIMITS.vaultFilesPerUpload)),
    /** Files confirmed by an album card, from the start. */
    confirmed: CountSchema,
    /** The file passed and not yet confirmed: its index and when it was passed. */
    pending: z.nullable(z.strictObject({ index: CountSchema, passedAt: EpochMsSchema })),
    updatedAt: EpochMsSchema,
  })
  .check(
    z.refine((c) => c.confirmed <= c.files.length, { message: 'no more confirmed files than files' }),
    z.refine((c) => c.pending === null || (c.pending.index >= c.confirmed && c.pending.index < c.files.length), { message: 'the pending file is one not yet confirmed' }),
  );
export type VaultCheckpoint = z.infer<typeof VaultCheckpointSchema>;

const AlbumRef = { hostAccountId: NativeIdSchema, albumId: NativeIdSchema };

// ── fansly.relay.* — «Fansly через вкладку» (port `cg-relay`) ──────────────

/** The only addresses the relay fetches (FS-NET-1); it checks this itself before any request. */
export const FANSLY_RELAY_TARGET = 'https://apiv3.fansly.com/api/v1/';

const HeaderNameSchema = z.string().check(z.regex(/^[a-z0-9-]{1,64}$/));
const HeaderListSchema = (max: number) => z.array(z.tuple([HeaderNameSchema, displayText(4096)])).check(z.maxLength(max));

/** Why the relay made no request or got no answer; `refused` — its own last check failed: provably no fetch. */
export const FANSLY_RELAY_FAILURES = ['refused', 'network', 'aborted', 'too-large'] as const;

// ── Requests ───────────────────────────────────────────────────────────────

export const FANSLY_TAB_REQUESTS = {
  // ── «Новые» ──
  /** Opens a pass for the creator of the tab and the window; an open one for the same creator and window is answered as is. */
  'fansly.followers.scan': {
    req: z.strictObject({ hostAccountId: NativeIdSchema, windowHours: FanslyPassViewSchema.shape.windowHours }),
    res: z.discriminatedUnion('ok', [z.strictObject({ ok: z.literal(true), pass: FanslyPassViewSchema }), Failure]),
    from: TAB,
    hosts: FANSLY,
  },
  'fansly.followers.pause': { req: z.strictObject(PassRef), res: z.strictObject({ pass: z.nullable(FanslyPassViewSchema) }), from: TAB, hosts: FANSLY },
  'fansly.followers.resume': {
    req: z.strictObject(PassRef),
    res: z.discriminatedUnion('ok', [z.strictObject({ ok: z.literal(true), pass: FanslyPassViewSchema }), Failure]),
    from: TAB,
    hosts: FANSLY,
  },
  /** The window's snapshot when it opens or after a lost port; changes then come as `fansly.followers.changed`. */
  'fansly.followers.read': {
    req: z.strictObject({ ...PassRef, offset: CountSchema, limit: z.int().check(z.gte(1), z.lte(FANSLY_TAB_LIMITS.followerRowsPerRead)) }),
    res: z.strictObject({
      pass: z.nullable(FanslyPassViewSchema),
      rows: z.array(FanslyFollowerRowSchema).check(z.maxLength(FANSLY_TAB_LIMITS.followerRowsPerRead)),
      total: CountSchema,
    }),
    from: TAB,
    hosts: FANSLY,
  },
  /** «Проверить следующим» (FS-NEW-1): the selected fan goes first in the queue. */
  'fansly.followers.prioritize': { req: z.strictObject({ ...PassRef, fanRef: NativeIdSchema }), res: Ack, from: TAB, hosts: FANSLY },
  /** Out of «К обработке» and back (FS-NEW-2). */
  'fansly.followers.exclude': { req: z.strictObject({ ...PassRef, fanRef: NativeIdSchema, excluded: z.boolean() }), res: Ack, from: TAB, hosts: FANSLY },
  /** The preview of a fan's conversation, newest first; `before` — the oldest message already shown. */
  'fansly.followers.history': {
    req: z.strictObject({
      ...PassRef,
      fanRef: NativeIdSchema,
      before: z.nullable(NativeIdSchema),
      limit: z.int().check(z.gte(1), z.lte(FANSLY_TAB_LIMITS.historyMessagesPerRead)),
    }),
    res: z.discriminatedUnion('ok', [
      z.strictObject({ ok: z.literal(true), messages: z.array(FanslyPreviewMessageSchema).check(z.maxLength(FANSLY_TAB_LIMITS.historyMessagesPerRead)), more: z.boolean() }),
      Failure,
    ]),
    from: TAB,
    hosts: FANSLY,
  },
  /** The window closed: the pass keeps its results and drafts; nothing new starts for this window. */
  'fansly.followers.close': { req: z.strictObject(PassRef), res: Ack, from: TAB, hosts: FANSLY },

  // ── «Заметки» ──
  /** Group and `GET /account?ids=` through the pacer, one attempt; `force` — «Обновить» (FS-NOTE-3). */
  'fansly.notes.read': {
    req: z.strictObject({ ...NoteTarget, groupId: z.nullable(NativeIdSchema), force: z.optional(z.boolean()) }),
    res: z.discriminatedUnion('ok', [
      z.strictObject({
        ok: z.literal(true),
        notes: z.array(FanslyNoteSchema).check(z.maxLength(FANSLY_TAB_LIMITS.notesPerFan)),
        customName: z.nullable(FanslyCustomNameSchema),
        readAt: IsoTimestampSchema,
      }),
      Failure,
    ]),
    from: TAB,
    hosts: FANSLY,
  },
  /** «Создать» — one attempt, never repeated before a fresh read (FS-NOTE-4). */
  'fansly.notes.create': {
    req: z.strictObject({ ...NoteTarget, title: displayText(FANSLY_TAB_LIMITS.noteTitleMaxChars), text: displayText(FANSLY_TAB_LIMITS.noteTextMaxChars) }),
    res: z.discriminatedUnion('ok', [z.strictObject({ ok: z.literal(true), note: FanslyNoteSchema }), Failure]),
    from: TAB,
    hosts: FANSLY,
  },
  'fansly.notes.edit': {
    req: z.strictObject({
      ...NoteTarget,
      noteId: NativeIdSchema,
      title: displayText(FANSLY_TAB_LIMITS.noteTitleMaxChars),
      text: displayText(FANSLY_TAB_LIMITS.noteTextMaxChars),
    }),
    res: z.discriminatedUnion('ok', [z.strictObject({ ok: z.literal(true), note: FanslyNoteSchema }), Failure]),
    from: TAB,
    hosts: FANSLY,
  },
  /** After the person confirmed it in the panel. */
  'fansly.notes.delete': { req: z.strictObject({ ...NoteTarget, noteId: NativeIdSchema }), res: z.discriminatedUnion('ok', [Done, Failure]), from: TAB, hosts: FANSLY },
  /** The name for oneself (12002 «Custom Username»): an empty name deletes the note. */
  'fansly.notes.name': {
    req: z.strictObject({ ...NoteTarget, name: displayText(FANSLY_TAB_LIMITS.customNameMaxChars) }),
    res: z.discriminatedUnion('ok', [z.strictObject({ ok: z.literal(true), customName: z.nullable(FanslyCustomNameSchema) }), Failure]),
    from: TAB,
    hosts: FANSLY,
  },

  // ── voice notes ──
  /**
   * The paid step (`voiceNoteCreate`): the attempt is stored before the call and restored with the same
   * `clientRequestId`; never repeated by itself (FS-VOI-1: no double payment). `conversationRef` is the group,
   * `fanRef` the fan (HF-4а), apart.
   */
  'fansly.voice.create': {
    req: z.strictObject({
      attemptId: UuidSchema,
      clientRequestId: UuidSchema,
      pageId: HubIntIdSchema,
      conversationRef: NativeIdSchema,
      fanRef: NativeIdSchema,
      sourceGenerationRef: GenerationRefSchema,
      script: boundedText(FANSLY_TAB_LIMITS.voiceScriptMaxChars),
    }),
    res: z.discriminatedUnion('ok', [z.strictObject({ ok: z.literal(true), view: VoiceNoteViewSchema }), Failure]),
    from: TAB,
    hosts: FANSLY,
  },
  'fansly.voice.status': {
    req: z.strictObject(VoiceRef),
    res: z.discriminatedUnion('ok', [z.strictObject({ ok: z.literal(true), view: VoiceNoteViewSchema }), Failure]),
    from: TAB,
    hosts: FANSLY,
  },
  /** The MP3 (`fetchVoiceNoteAudio` of the SDK), checked against the hub's sha256 and length before it is handed over. */
  'fansly.voice.audio': {
    req: z.strictObject(VoiceRef),
    res: z.discriminatedUnion('ok', [
      z.strictObject({
        ok: z.literal(true),
        mime: z.literal('audio/mpeg'),
        base64: z.string().check(z.maxLength(BASE64_MAX_CHARS), z.regex(/^[A-Za-z0-9+/]*={0,2}$/)),
        sha256: z.string().check(z.regex(/^[0-9a-f]{64}$/)),
        bytes: z.int().check(z.gte(1), z.lte(FANSLY_TAB_LIMITS.voiceAudioMaxBytes)),
      }),
      Failure,
    ]),
    from: TAB,
    hosts: FANSLY,
  },
  /** The paid attempts kept for one chat: a panel opened again (a reload) continues them instead of paying again. */
  'fansly.voice.attempts': {
    req: z.strictObject({ pageId: HubIntIdSchema, conversationRef: NativeIdSchema }),
    res: z.strictObject({ attempts: z.array(VoiceAttemptViewSchema).check(z.maxLength(FANSLY_TAB_LIMITS.voiceAttemptsPerChat)) }),
    from: TAB,
    hosts: FANSLY,
  },

  // ── vault ──
  /** Written before each file is handed to Fansly's form; `recorded: false` — not kept: the file is not handed over. */
  'fansly.vault.checkpoint': { req: z.strictObject({ checkpoint: VaultCheckpointSchema }), res: Ack, from: TAB, hosts: FANSLY },
  /** Where the last upload into this album stopped (FS-PERM-5: it stops at a checkpoint). */
  'fansly.vault.resume': { req: z.strictObject(AlbumRef), res: z.strictObject({ checkpoint: z.nullable(VaultCheckpointSchema) }), from: TAB, hosts: FANSLY },
  /** The upload is over or the person dropped it. */
  'fansly.vault.clear': { req: z.strictObject({ ...AlbumRef, uploadId: UuidSchema }), res: Ack, from: TAB, hosts: FANSLY },

  // ── relay: its answers to `fansly.relay.fetch` ──
  /** Status and headers as soon as `fetch` has them: a 429 or a 401 counts even when its body never arrives. */
  'fansly.relay.head': {
    req: z.strictObject({
      requestId: UuidSchema,
      status: z.int().check(z.gte(100), z.lte(599)),
      /** Only `content-type`, `content-length` and `retry-after`; the rest stays in the frame. */
      headers: HeaderListSchema(FANSLY_TAB_LIMITS.relayResponseHeadersMax),
    }),
    res: Ack,
    from: RELAY,
    hosts: FANSLY,
  },
  'fansly.relay.body': {
    req: z.strictObject({ requestId: UuidSchema, body: displayText(FANSLY_TAB_LIMITS.relayResponseBodyMaxChars) }),
    res: Ack,
    from: RELAY,
    hosts: FANSLY,
  },
  'fansly.relay.failure': { req: z.strictObject({ requestId: UuidSchema, reason: z.enum(FANSLY_RELAY_FAILURES) }), res: Ack, from: RELAY, hosts: FANSLY },
} as const satisfies Record<`fansly.${string}`, TabRequestSpec>;

export type FanslyTabRequestType = keyof typeof FANSLY_TAB_REQUESTS;
export const FANSLY_TAB_REQUEST_TYPES = Object.keys(FANSLY_TAB_REQUESTS) as FanslyTabRequestType[];
export type FanslyTabRequestPayload<T extends FanslyTabRequestType> = z.infer<(typeof FANSLY_TAB_REQUESTS)[T]['req']>;
export type FanslyTabResponsePayload<T extends FanslyTabRequestType> = z.infer<(typeof FANSLY_TAB_REQUESTS)[T]['res']>;

// ── Events ─────────────────────────────────────────────────────────────────

export const FANSLY_TAB_EVENTS = {
  /** Rows of an open pass changed (the window is told, it does not poll); `seq` grows per pass. */
  'fansly.followers.changed': {
    payload: z.strictObject({
      pass: FanslyPassViewSchema,
      seq: CountSchema,
      rows: z.array(FanslyFollowerRowSchema).check(z.maxLength(FANSLY_TAB_LIMITS.followerRowsPerChange)),
    }),
    to: TAB,
  },
  /**
   * One request for the relay frame of the tab (FS-NET-4): Fansly's API only, the session's headers, and what the
   * frame checks itself, synchronously, just before its own fetch (§8.6): its tab must still be on this account.
   */
  'fansly.relay.fetch': {
    payload: z.strictObject({
      requestId: UuidSchema,
      method: z.enum(['GET', 'POST']),
      url: z.string().check(z.maxLength(2048), z.startsWith(FANSLY_RELAY_TARGET)),
      headers: HeaderListSchema(FANSLY_TAB_LIMITS.relayRequestHeadersMax),
      body: z.optional(displayText(FANSLY_TAB_LIMITS.relayRequestBodyMaxChars)),
      expect: z.strictObject({ hostAccountId: NativeIdSchema }),
    }),
    to: RELAY,
  },
  'fansly.relay.abort': { payload: z.strictObject({ requestId: UuidSchema }), to: RELAY },
} as const satisfies Record<`fansly.${string}`, TabEventSpec>;

export type FanslyTabEventType = keyof typeof FANSLY_TAB_EVENTS;
export const FANSLY_TAB_EVENT_TYPES = Object.keys(FANSLY_TAB_EVENTS) as FanslyTabEventType[];
export type FanslyTabEventPayload<T extends FanslyTabEventType> = z.infer<(typeof FANSLY_TAB_EVENTS)[T]['payload']>;

export function isFanslyTabRequestType(type: string): type is FanslyTabRequestType {
  return Object.prototype.hasOwnProperty.call(FANSLY_TAB_REQUESTS, type);
}

export function isFanslyTabEventType(type: string): type is FanslyTabEventType {
  return Object.prototype.hasOwnProperty.call(FANSLY_TAB_EVENTS, type);
}

/** Second stage, in the `bg/fansly` chunk and the Fansly tab: the payload of a request, a response or an event of this registry. */
export function parseFanslyTabPayload(kind: 'req' | 'res' | 'evt', type: string, payload: unknown): TabPayloadCheck {
  let schema: z.ZodMiniType;
  if (kind === 'evt') {
    if (!isFanslyTabEventType(type)) return { ok: false };
    schema = FANSLY_TAB_EVENTS[type].payload;
  } else {
    if (!isFanslyTabRequestType(type)) return { ok: false };
    schema = kind === 'req' ? FANSLY_TAB_REQUESTS[type].req : FANSLY_TAB_REQUESTS[type].res;
  }
  const parsed = schema.safeParse(payload);
  return parsed.success ? { ok: true, payload: parsed.data } : { ok: false };
}

/** The sender rules of this registry (`senderAllowed`): every type is the site's (`hosts`). */
export function mayRequestFansly(type: FanslyTabRequestType, sender: TabSender, page: ExtensionPage | null, host: HostKind | null): boolean {
  return senderAllowed(FANSLY_TAB_REQUESTS[type], sender, page, host);
}

/** Who an event of this registry goes to. */
export function fanslyEventTargets(type: FanslyTabEventType): readonly TabSender[] {
  return FANSLY_TAB_EVENTS[type].to;
}
