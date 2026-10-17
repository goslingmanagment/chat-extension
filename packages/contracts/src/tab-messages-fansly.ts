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
// Families. `fansly.ops.*` — site generations through the shared scheduler (P12a):
// start, read, list, cancel and the kept terminal view;
// `fansly.followers.*` — «Новые» by the background's pass (Б17,
// FS-NEW-*) and its greeting send (`fansly.followers.send`, send-fansly.ts);
// `fansly.notes.*` — the fan's native notes (FS-NOTE-*);
// `fansly.voice.*` — paid voice notes over the hub (HF-4, FS-VOI-*; the script
// is the site's `voice-script` operation, ops-fansly.ts, admitted by the shared
// scheduler — its start is not a shared `StartOp`);
// `fansly.vault.*` — upload checkpoints (FS-VLT-*); `fansly.relay.*` — «Fansly
// через вкладку» (FS-NET-4, port `cg-relay`); `fansly.settings.*` and
// `fansly.accounts.*` — the settings page (R20 P14b1: Fansly's part of
// `settings.ext`, its sessions and tabs for «Аккаунты»), the only types a page
// sends here; the core routes them to the module while Fansly is on. A
// family's own PR (P10*, P11b, P12b*, P13a, P9c) may add fields and types to
// it, additively.

import * as z from 'zod/mini';
import { SoundBatchSchema } from './sound';

import { CgAnyErrorWireSchema } from './errors-fansly';
import { FanslyOpViewSchema, FanslyStartOpSchema } from './ops-fansly';
import { AdmissionSchema, CoverageWindowSchema, GreetingDraftGenerationSchema, OpStateSchema } from './ops';
import { HiFanAvatarUrlSchema, StartProofV1Schema } from './hi-start-proof';
import { ChatKeySchema } from './ids';
import { SEND_LIMITS, STORAGE_LIMITS } from './limits';
import { type HostKind } from './hosts';
import { CountSchema, EpochMsSchema, GenerationRefSchema, HubIntIdSchema, IsoTimestampSchema, MoneyMillsSchema, NativeIdSchema, OpenTokenSchema, UuidSchema, boundedText, displayText } from './primitives';
import { FANSLY_SEND_LIMITS, FanslyGreetingAdmissionSchema, FanslyGreetingRequestSchema, FanslySendViewSchema } from './send-fansly';
import { FANSLY_NOTES_VIEWS, SettingsExtPatchSchema, SettingsExtSchema, SettingsExtStateSchema } from './settings-ext';
import type { TabPayloadCheck } from './tab-messages';
import { senderAllowed, type ExtensionPage, type TabEventSpec, type TabRequestSpec, type TabSender } from './tab-protocol';
import { NEWCOMER_CHECK_FILTERS, NEWCOMERS_TABS } from './vm/actions';

/** Every type of this registry starts with it; no shared type does. */
export const FANSLY_TAB_TYPE_PREFIX = 'fansly.';

const FANSLY = ['fansly-web'] as const satisfies readonly HostKind[];
const TAB = ['tab'] as const satisfies readonly TabSender[];
const RELAY = ['relay'] as const satisfies readonly TabSender[];
/** R20 P14b1: the settings page speaks to Fansly's module too (its part of the settings and «Аккаунты»). */
const PAGE = ['page'] as const satisfies readonly TabSender[];
const OPTIONS = ['options'] as const satisfies readonly ExtensionPage[];
const Empty = z.strictObject({});

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
  /** A fan's «about» in the «Новые» card (NF-009); Fansly states no limit, ours sits far above a real one. */
  bioMaxChars: 4_000,
  notesPerFan: 200,
  /** A sanity cap: the hub validates the script itself (`voice_script_invalid`); the editor holds about 600. */
  voiceScriptMaxChars: 5_000,
  voiceAttemptsPerChat: 20,
  /** One MP3 voice note, as base64 in `fansly.voice.audio` (4 characters a 3 bytes). */
  voiceAudioMaxBytes: 8 * 1024 * 1024,
  vaultFilesPerUpload: 500,
  /** Full URL: up to 7 query values × 2048 UTF-16 units × 9 percent-encoded chars, plus base, path and keys. */
  relayRequestUrlMaxChars: 128 * 1024,
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

/**
 * What the fast part reads while `scanning` (1.15.0 R20 P10a; NF-008 «фазы скана»): the creator's welcome texts, the
 * list of new followers, their profiles, then the check of each one's chat.
 */
export const FANSLY_PASS_PHASES = ['welcome', 'followers', 'profiles', 'checking'] as const;

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
  /** P10a: the fast part's stage while `scanning`; absent or null — not scanning, or not said. */
  phase: z.optional(z.nullable(z.enum(FANSLY_PASS_PHASES))),
});
export type FanslyPassView = z.infer<typeof FanslyPassViewSchema>;

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
export type FanslyPreviewMessage = z.infer<typeof FanslyPreviewMessageSchema>;

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
  /** 1.15.0 R20 P10b2: the lowest known paid-DM price per message, USD mills; absent or null — unknown. */
  dmPriceMills: z.optional(z.nullable(MoneyMillsSchema.check(z.gte(0)))),
  /** The revision of the history the pass checked in full (FS-NEW-6, FS-NEW-7); null — not checked in full. */
  historyRevision: z.nullable(UuidSchema),
  checkedAt: z.nullable(IsoTimestampSchema),
  // ── 1.15.0 R20 P10a: what the «Новые» window shows of the row (NF-005, NF-007, NF-009); each optional, absent = unknown ──
  /** The creator's own name for the fan: Fansly's «Custom Username» note (12002), read by the pass with the profiles. */
  customName: z.optional(z.nullable(displayText(FANSLY_TAB_LIMITS.customNameMaxChars))),
  /** The fan's «about» from the profile the pass read. */
  bio: z.optional(z.nullable(displayText(FANSLY_TAB_LIMITS.bioMaxChars))),
  /** `ready`, and the fan wrote first with no personal message of the creator's: «Ждёт ответа» (NF-005). */
  fanWrote: z.optional(z.boolean()),
  /** `greeted` — «Уже писали»: the creator's personal message the pass found (the card shows it folded, NF-009). */
  proof: z.optional(z.nullable(FanslyPreviewMessageSchema)),
  /** `failed` — «Не удалось проверить»: why (a Fansly code or a shared one). */
  error: z.optional(z.nullable(CgAnyErrorWireSchema)),
});
export type FanslyFollowerRow = z.infer<typeof FanslyFollowerRowSchema>;

/** P10a: the background filters the WHOLE pass before slicing `offset/limit`, never just the loaded page. */
export const FanslyFollowersQuerySchema = z.strictObject({ search: displayText(200), tab: z.enum(NEWCOMERS_TABS), filter: z.enum(NEWCOMER_CHECK_FILTERS) });

/** Counts after search, before the status filter: tabs over the whole pass, filters over the chosen tab. */
export const FanslyFollowersCountsSchema = z.strictObject({
  tabs: z.strictObject({ todo: CountSchema, all: CountSchema }),
  filters: z.record(z.enum(NEWCOMER_CHECK_FILTERS), CountSchema),
});

const PassRef = { passId: UuidSchema };

/**
 * 1.15.0 R20 P10c (FS-NEW-7, NF-013, NF-034): what a greeting's generation takes of the pass — the proof of the fan's
 * checked history, ids only, never a text: its group, its revision, the window of the coverage check (both directions,
 * the newest 60, oldest first), the fan's newest ids of it (newest first), the proof of the start (`pass-empty-page`)
 * and the avatar of the profile the pass read (FX-018; null — none fit to send).
 */
export const FanslyGreetingProofSchema = z
  .strictObject({
    groupId: NativeIdSchema,
    historyRevision: UuidSchema,
    window: CoverageWindowSchema,
    knownFanMessageIds: z.array(NativeIdSchema).check(z.maxLength(SEND_LIMITS.knownFanMessagesMax)),
    startProof: StartProofV1Schema,
    fanAvatarUrl: z.nullable(HiFanAvatarUrlSchema),
  })
  .check(
    z.refine((p) => p.startProof.groupId === p.groupId && p.startProof.source === 'pass-empty-page', { message: 'the pass proves the start of this group' }),
    z.refine((p) => p.knownFanMessageIds.every((id) => p.window.some((entry) => entry.id === id && entry.dir === 'fan')), { message: 'known fan ids are of the window' }),
  );
export type FanslyGreetingProof = z.infer<typeof FanslyGreetingProofSchema>;

/** 1.15.0 R20 P10c (NF-012): the card's draft, kept per creator and fan; `historyRevision` — the row's when it was written (NF-018). */
const GreetingDraftSchema = z.strictObject({
  text: z.string().check(z.maxLength(SEND_LIMITS.previewDraftMaxChars)),
  revision: CountSchema,
  historyRevision: z.nullable(UuidSchema),
  generation: z.optional(GreetingDraftGenerationSchema),
  /** Read from the background's durable send journal, including an attempt whose answer the tab lost. */
  attempt: z.optional(FanslySendViewSchema),
});

// ── fansly.notes.* — «Заметки» (FS-NOTE-*) ─────────────────────────────────

/** A regular note (contentType 12000). `foreign` — FBuddy's «FBuddy Notes»: shown read-only, never edited or cleaned.
 * 1.16.0 (R20 P11b2; the Fansly extension 2.13.0, decision 171): `createdAtMs` — when the note was created, Fansly's own
 * `createdAt` (seconds) in ms; null or absent — Fansly gave none (an edit's answer carries none: the panel keeps the
 * time it read). Fansly keeps no edit time. */
export const FanslyNoteSchema = z.strictObject({
  noteId: NativeIdSchema,
  title: displayText(FANSLY_TAB_LIMITS.noteTitleMaxChars),
  text: displayText(FANSLY_TAB_LIMITS.noteTextMaxChars),
  foreign: z.boolean(),
  createdAtMs: z.optional(z.nullable(z.int().check(z.gt(0)))),
});
export type FanslyNote = z.infer<typeof FanslyNoteSchema>;

/** The one «Custom Username» note (contentType 12002): the name for oneself. */
export const FanslyCustomNameSchema = z.strictObject({ noteId: NativeIdSchema, name: displayText(FANSLY_TAB_LIMITS.customNameMaxChars) });

/**
 * Notes are the creator's, about one fan: every request names both, and the background writes only under that
 * creator's session. P11b: and the hub page the tab is bound to — the background admits the request by that page's
 * own switch `notes` (as `fansly.registration.read`).
 */
const NoteTarget = { pageId: HubIntIdSchema, hostAccountId: NativeIdSchema, fanRef: NativeIdSchema };

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

/**
 * Whether `next` is a step a run of `row` takes from it (R20 P13b review; host-fansly isolated/vault/run.ts), as the
 * background checks every write of the same upload: never back; from a row with no file in flight — that file handed
 * over now, or one more file found in the album; from a row with one in flight — its outcome (in the album, or not),
 * or, its confirmation's write lost, the next file. A second file over one in flight, or the same one again, is no
 * step: a second tab's copy of the run would hand it over twice.
 */
export function vaultCheckpointFollows(row: VaultCheckpoint, next: VaultCheckpoint): boolean {
  if (row.pending === null) return next.pending === null ? next.confirmed === row.confirmed || next.confirmed === row.confirmed + 1 : next.confirmed === row.confirmed && next.pending.index >= row.confirmed;
  const landed = row.pending.index + 1;
  return next.pending === null ? next.confirmed === row.confirmed || next.confirmed === landed : next.confirmed === landed && next.pending.index >= landed;
}

/**
 * The vault's acknowledgement (R20 P13b review): `held` — another tab of this browser holds the album's upload (it
 * wrote the album's checkpoint and is still open), nothing was written; without it, `recorded: false` — not kept for
 * another reason (a write that does not follow the row on disk, the store failed).
 */
const VaultAck = z
  .strictObject({ recorded: z.boolean(), held: z.optional(z.boolean()) })
  .check(z.refine((ack) => ack.held !== true || !ack.recorded, { message: 'a held album keeps nothing' }));

// ── fansly.relay.* — «Fansly через вкладку» (port `cg-relay`) ──────────────

/** The only addresses the relay fetches (FS-NET-1); it checks this itself before any request. */
export const FANSLY_RELAY_TARGET = 'https://apiv3.fansly.com/api/v1/';

const HeaderNameSchema = z.string().check(z.regex(/^[a-z0-9-]{1,64}$/));
const HeaderListSchema = (max: number) => z.array(z.tuple([HeaderNameSchema, displayText(4096)])).check(z.maxLength(max));

/** Why the relay made no request or got no answer; `refused` — its own last check failed: provably no fetch. */
export const FANSLY_RELAY_FAILURES = ['refused', 'network', 'aborted', 'too-large'] as const;

// ── fansly.settings.*, fansly.accounts.* — the settings page (R20 P14b1) ───

/**
 * What the settings page changes in Fansly's part of `settings.ext` (FS-SET-1): «Fansly через вкладку», the tones on
 * Fansly and the Recap depth above v1's 3000. Never `enabled` — «Включить Fansly» goes through `site.access`, with the
 * browser's prompt inside the click (architecture.md §4) — nor the view of «Заметки», which their panel chooses
 * (FS-NOTE-2).
 */
export const FanslySettingsPatchSchema = SettingsExtPatchSchema.check(
  z.refine((patch) => patch.hosts?.['fansly-web']?.enabled === undefined && patch.hosts?.['fansly-web']?.notesView === undefined, {
    message: '«Fansly включён» changes through site.access, the view of «Заметки» in their panel',
  }),
);

/** Captured sessions in one `fansly.accounts.read` (the background keeps no more templates, network-session.ts). */
export const FANSLY_PAGE_SESSIONS_MAX = 128;

/**
 * A live Fansly session this browser captured (architecture.md §8.2): the account its token names (`legacyId`,
 * AU-031) and, once a tab of ours on it said its creator from `/account/me`, that creator (`canonicalId`, AU-032) —
 * the reconciliation of ST-079. Ids, counts and a time only: no header ever leaves the background.
 */
export const FanslyAccountSessionSchema = z.strictObject({
  legacyId: NativeIdSchema,
  /** null — no tab of ours on this session has named its creator yet. */
  canonicalId: z.nullable(NativeIdSchema),
  /** Open Fansly tabs whose requests ride this session now. */
  tabs: CountSchema,
  /** When a request of the page on it last came back 2xx. */
  observedAt: EpochMsSchema,
});
export type FanslyAccountSession = z.infer<typeof FanslyAccountSessionSchema>;

/** «Аккаунты» on Fansly (ST-067, ST-077, ST-079, AU-035): what the background knows beyond its tabs' own reports. */
export const FanslyAccountsViewSchema = z.strictObject({
  sessions: z.array(FanslyAccountSessionSchema).check(z.maxLength(FANSLY_PAGE_SESSIONS_MAX)),
  /** Fansly tabs open in this browser, found by the granted address (no `tabs` right); null — the browser did not answer. */
  openTabs: z.nullable(CountSchema),
  /** Of them, tabs that neither named their creator to us (a registration) nor carry a captured session: «без атрибуции». */
  unattributedTabs: z.nullable(CountSchema),
});
export type FanslyAccountsView = z.infer<typeof FanslyAccountsViewSchema>;

// ── Requests ───────────────────────────────────────────────────────────────

export const FANSLY_TAB_REQUESTS = {
  /** Site operations share the background's admission with Reply and the other common operations. */
  'fansly.ops.start': { req: FanslyStartOpSchema, res: AdmissionSchema, from: TAB, hosts: FANSLY },
  'fansly.ops.read': { req: z.strictObject({ opId: UuidSchema }), res: z.strictObject({ view: z.nullable(FanslyOpViewSchema) }), from: TAB, hosts: FANSLY },
  'fansly.ops.list': { req: z.strictObject({ chatKey: z.optional(ChatKeySchema) }), res: z.strictObject({ ops: z.array(FanslyOpViewSchema).check(z.maxLength(STORAGE_LIMITS.opListMax)), truncated: z.boolean() }), from: TAB, hosts: FANSLY },
  'fansly.ops.cancel': { req: z.strictObject({ opId: UuidSchema }), res: z.strictObject({ state: z.nullable(OpStateSchema) }), from: TAB, hosts: FANSLY },
  /** P11a: only the open group, by a click, when MAIN has not supplied its fan. */
  'fansly.registration.read': {
    req: z.strictObject({ pageId: HubIntIdSchema, hostAccountId: NativeIdSchema, groupId: NativeIdSchema }),
    res: z.discriminatedUnion('ok', [z.strictObject({ ok: z.literal(true), fanId: NativeIdSchema }), Failure]),
    from: TAB,
    hosts: FANSLY,
  },
  'fansly.sound.batch': { req: z.extend(SoundBatchSchema, { host: z.literal('fansly-web') }), res: Ack, from: TAB, hosts: FANSLY },
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
    req: z.strictObject({ ...PassRef, offset: CountSchema, limit: z.int().check(z.gte(1), z.lte(FANSLY_TAB_LIMITS.followerRowsPerRead)), query: z.optional(FanslyFollowersQuerySchema) }),
    res: z.strictObject({
      pass: z.nullable(FanslyPassViewSchema),
      rows: z.array(FanslyFollowerRowSchema).check(z.maxLength(FANSLY_TAB_LIMITS.followerRowsPerRead)),
      /** With `query`, the number of matches BEFORE pagination; without it, all rows as before. */
      total: CountSchema,
      /** Required by a reader that sent `query`; absent for a legacy, unfiltered read. */
      counts: z.optional(FanslyFollowersCountsSchema),
      /**
       * P10a: the last `fansly.followers.changed` this snapshot already holds (its `seq`): the window applies only the
       * changes after it and reads again on a gap. Absent — not said: the window applies every change it heard meanwhile.
       */
      seq: z.optional(CountSchema),
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
  /**
   * «Отправить» on a card (1.15.0 P4c, FS-NEW-3, FS-NEW-6): one click, one attempt of the background's HTTP send
   * with the hub's custody (send-fansly.ts); never repeated, by the window or the background. The answer is the
   * attempt as it stands when the background stops waiting for it (`refused`, `uncertain`, `receipted`, `sent`);
   * a failure before any attempt (no such pass, another account) is the payload's `ok: false`.
   */
  'fansly.followers.send': {
    req: FanslyGreetingRequestSchema,
    res: z.discriminatedUnion('ok', [z.strictObject({ ok: z.literal(true), attempt: FanslySendViewSchema }), Failure]),
    from: TAB,
    hosts: FANSLY,
  },
  /** 1.15.0 R20 P10c: the pass's proof of a checked fan for «Сгенерировать» (FS-NEW-7); ids only. */
  'fansly.followers.proof': {
    req: z.strictObject({ ...PassRef, fanRef: NativeIdSchema }),
    res: z.discriminatedUnion('ok', [z.strictObject({ ok: z.literal(true), proof: FanslyGreetingProofSchema }), Failure]),
    from: TAB,
    hosts: FANSLY,
  },
  /**
   * 1.15.0 R20 P10c (NF-012, FS-NEW-6): the card's draft — read without `text`, written with it (an empty one clears
   * it). The background keeps it per creator and fan (the shared `newcomers.drafts`, at most 7 days) and knows its revision at
   * the send's final check.
   */
  'fansly.followers.draft': {
    req: z.strictObject({ ...PassRef, fanRef: NativeIdSchema, text: z.optional(z.string().check(z.maxLength(SEND_LIMITS.previewDraftMaxChars))), generation: z.optional(z.strictObject({ opId: UuidSchema, historyRevision: UuidSchema })) }),
    res: z.discriminatedUnion('ok', [z.strictObject({ ok: z.literal(true), draft: GreetingDraftSchema }), Failure]),
    from: TAB,
    hosts: FANSLY,
  },
  /**
   * 1.15.0 R20 P10c (FS-NEW-3): the person sent the card's text with Fansly's own button after «Открыть и вставить»
   * (the tab linked the send to our insert, P7f): the hub registers it (`registerNativeSend`, purpose `greeting`) and
   * the fan is greeted for everyone. A report of what happened, never a send.
   */
  'fansly.followers.sent': {
    req: z.strictObject({
      ...PassRef,
      hostAccountId: NativeIdSchema,
      fanRef: NativeIdSchema,
      groupId: NativeIdSchema,
      platformMessageId: NativeIdSchema,
      text: z.string().check(z.minLength(1), z.maxLength(FANSLY_SEND_LIMITS.greetingMaxChars), z.refine((text) => text.trim() === text, { message: 'trimmed' })),
      admission: FanslyGreetingAdmissionSchema,
    }),
    res: Ack,
    from: TAB,
    hosts: FANSLY,
  },

  // ── Spenders (R20 P9e): only missing names and the person's one chat-resolution click. ──
  'fansly.spenders.names': {
    req: z.strictObject({ hostAccountId: NativeIdSchema, fanRefs: z.array(NativeIdSchema).check(z.minLength(1), z.maxLength(100)) }),
    res: z.discriminatedUnion('ok', [z.strictObject({ ok: z.literal(true), names: z.array(z.strictObject({ fanRef: NativeIdSchema, name: displayText(1000), displayName: z.nullable(displayText(1000)), username: z.nullable(displayText(1000)) })).check(z.maxLength(100)) }), Failure]),
    from: TAB, hosts: FANSLY,
  },
  'fansly.spenders.resolve': {
    req: z.strictObject({ hostAccountId: NativeIdSchema, fanRef: NativeIdSchema, displayName: z.nullable(displayText(1000)), username: z.nullable(displayText(1000)) }),
    res: z.discriminatedUnion('ok', [z.strictObject({ ok: z.literal(true), groupId: z.nullable(NativeIdSchema) }), Failure]),
    from: TAB, hosts: FANSLY,
  },

  // ── «Заметки» ──
  /**
   * Group and `GET /account?ids=` through the pacer, one attempt; `force` — «Обновить» (FS-NOTE-3). P11b: `fanRef`
   * null — MAIN has not named the open group's fan: the background reads the group once and answers whose notes
   * these are (`fanRef`).
   */
  'fansly.notes.read': {
    req: z.strictObject({ ...NoteTarget, fanRef: z.nullable(NativeIdSchema), groupId: z.nullable(NativeIdSchema), force: z.optional(z.boolean()) }),
    res: z.discriminatedUnion('ok', [
      z.strictObject({
        ok: z.literal(true),
        fanRef: NativeIdSchema,
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
      /** The version the editor opened on. Older callers parse, but cannot overwrite without a version. */
      current: z.optional(z.strictObject({ title: displayText(FANSLY_TAB_LIMITS.noteTitleMaxChars), text: displayText(FANSLY_TAB_LIMITS.noteTextMaxChars) })),
    }),
    res: z.discriminatedUnion('ok', [z.strictObject({ ok: z.literal(true), note: FanslyNoteSchema }), Failure]),
    from: TAB,
    hosts: FANSLY,
  },
  /** After the person confirmed it in the panel. P11b: the note as the panel read it — Fansly's delete takes the note. */
  'fansly.notes.delete': {
    req: z.strictObject({
      ...NoteTarget,
      noteId: NativeIdSchema,
      title: displayText(FANSLY_TAB_LIMITS.noteTitleMaxChars),
      text: displayText(FANSLY_TAB_LIMITS.noteTextMaxChars),
    }),
    res: z.discriminatedUnion('ok', [Done, Failure]),
    from: TAB,
    hosts: FANSLY,
  },
  /**
   * The name for oneself (12002 «Custom Username»): an empty name deletes the note. P11b: `current` — the name note
   * the panel read (null — none): it is edited or deleted, a new one is created only where there was none.
   */
  'fansly.notes.name': {
    req: z.strictObject({ ...NoteTarget, name: displayText(FANSLY_TAB_LIMITS.customNameMaxChars), current: z.nullable(FanslyCustomNameSchema) }),
    res: z.discriminatedUnion('ok', [z.strictObject({ ok: z.literal(true), customName: z.nullable(FanslyCustomNameSchema) }), Failure]),
    from: TAB,
    hosts: FANSLY,
  },
  /** P11b: the panel's view as `settings.ext` holds it (FS-NOTE-2: chosen in the panel, the same for every tab). */
  'fansly.notes.view': { req: Empty, res: z.strictObject({ view: z.enum(FANSLY_NOTES_VIEWS) }), from: TAB, hosts: FANSLY },
  /** P11b: the person chose another view in the panel; the answer is the view as stored (the old one if the write failed). */
  'fansly.notes.setView': { req: z.strictObject({ view: z.enum(FANSLY_NOTES_VIEWS) }), res: z.strictObject({ view: z.enum(FANSLY_NOTES_VIEWS) }), from: TAB, hosts: FANSLY },

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
  /**
   * Written before each file is handed to Fansly's form; `recorded: false` — not kept: the file is not handed over. One
   * upload per album and one tab at a time (P13b review): another tab that holds it — `held`; a write that does not
   * follow the row on disk (`vaultCheckpointFollows`) — not kept.
   */
  'fansly.vault.checkpoint': { req: z.strictObject({ checkpoint: VaultCheckpointSchema }), res: VaultAck, from: TAB, hosts: FANSLY },
  /** Where the last upload into this album stopped (FS-PERM-5: it stops at a checkpoint); `held` — another open tab holds it. */
  'fansly.vault.resume': { req: z.strictObject(AlbumRef), res: z.strictObject({ checkpoint: z.nullable(VaultCheckpointSchema), held: z.optional(z.boolean()) }), from: TAB, hosts: FANSLY },
  /** The upload is over or the person dropped it; `held` — another open tab holds it: nothing is cleared. */
  'fansly.vault.clear': { req: z.strictObject({ ...AlbumRef, uploadId: UuidSchema }), res: VaultAck, from: TAB, hosts: FANSLY },

  // ── relay: it is up, and its answers to `fansly.relay.fetch` ──
  /**
   * R20 P9c: the frame is up — its port is open, it serves the account its tab was on when the tab mounted it (the
   * tab tears the frame down when its account changes), under an id of its own that each request names
   * (`fetch.expect.relayId`). Sent on every connect of its port. The route is chosen only once it came (§8.5).
   */
  'fansly.relay.hello': { req: z.strictObject({ hostAccountId: NativeIdSchema, relayId: UuidSchema }), res: Ack, from: RELAY, hosts: FANSLY },
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
  /**
   * R20 P8c: the person's Recap depth above 3000 (`settings.ext` `windows`; FS-AI-1, architecture §12), asked by a start
   * of the deep window — Review, the full Recap, Coach's full auto-Recap; the planner still caps it by `limits.deepMax`.
   * Only the depth: the rest of the key stays the settings page's.
   */
  'fansly.settings.windows': { req: Empty, res: SettingsExtSchema.shape.windows, from: TAB, hosts: FANSLY },

  // ── the settings page (R20 P14b1): its requests reach the module while Fansly is on (platform rpc-background) ──
  /** Fansly's part of `settings.ext` as it is stored, with its revision (FS-SET-1). */
  'fansly.settings.read': { req: Empty, res: SettingsExtStateSchema, from: PAGE, pages: OPTIONS, hosts: FANSLY },
  /** A change of it; «Сохранено» only on this answer with its revision. Read-only or not written — a shared CG-STORAGE-* code. */
  'fansly.settings.write': { req: z.strictObject({ patch: FanslySettingsPatchSchema }), res: SettingsExtStateSchema, from: PAGE, pages: OPTIONS, hosts: FANSLY },
  /** The captured sessions and the tabs no account is known for; reading reconciles a session with the creator its tab named. */
  'fansly.accounts.read': { req: Empty, res: FanslyAccountsViewSchema, from: PAGE, pages: OPTIONS, hosts: FANSLY },
  /** «к вкладке» (ST-076): a Fansly tab of the account to the front, found by its registration or session, without the `tabs` right. */
  'fansly.accounts.focus': { req: z.strictObject({ hostAccountId: NativeIdSchema }), res: z.strictObject({ focused: z.boolean() }), from: PAGE, pages: OPTIONS, hosts: FANSLY },
} as const satisfies Record<`fansly.${string}`, TabRequestSpec>;

export type FanslyTabRequestType = keyof typeof FANSLY_TAB_REQUESTS;
export const FANSLY_TAB_REQUEST_TYPES = Object.keys(FANSLY_TAB_REQUESTS) as FanslyTabRequestType[];
export type FanslyTabRequestPayload<T extends FanslyTabRequestType> = z.infer<(typeof FANSLY_TAB_REQUESTS)[T]['req']>;
export type FanslyTabResponsePayload<T extends FanslyTabRequestType> = z.infer<(typeof FANSLY_TAB_REQUESTS)[T]['res']>;

// ── Events ─────────────────────────────────────────────────────────────────

export const FANSLY_TAB_EVENTS = {
  'fansly.ops.done': { payload: z.strictObject({ view: FanslyOpViewSchema }), to: TAB },
  /** P11b: the view of «Заметки» changed (in a panel of any tab): every Fansly tab follows it. */
  'fansly.notes.viewChanged': { payload: z.strictObject({ view: z.enum(FANSLY_NOTES_VIEWS) }), to: TAB },
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
      url: z.string().check(z.maxLength(FANSLY_TAB_LIMITS.relayRequestUrlMaxChars), z.startsWith(FANSLY_RELAY_TARGET)),
      headers: HeaderListSchema(FANSLY_TAB_LIMITS.relayRequestHeadersMax),
      body: z.optional(displayText(FANSLY_TAB_LIMITS.relayRequestBodyMaxChars)),
      /**
       * R20 P9c: `relayId` — the frame the route was chosen with (its `fansly.relay.hello`): another frame of the same
       * tab session takes no part in this request and answers nothing.
       */
      expect: z.strictObject({ hostAccountId: NativeIdSchema, relayId: z.optional(UuidSchema) }),
    }),
    to: RELAY,
  },
  'fansly.relay.abort': { payload: z.strictObject({ requestId: UuidSchema }), to: RELAY },
  /**
   * R20 P9c: to the tab — mount the relay frame, or keep the mounted one, for 60 s more (FS-NET-4: lazily, for a batch
   * of work and 60 s after). The background says it when it routes a request through the tab and again when it sends
   * one; the tab mounts the frame for the account it is on, and nothing when it is on none.
   */
  'fansly.relay.open': { payload: z.strictObject({}), to: TAB },
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
