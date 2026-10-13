// The Fansly host (R20, docs/project-unite/architecture.md §5.5–§5.8, §7.7, §7.12): what it knows and offers beyond
// HostPort — the generation snapshot MAIN gives on a click (`FanslySnapshot`), the client's proof of the start of a
// conversation for Hi (`StartProofV1`), the page port of the Fansly adapter (`FanslyPagePort`), and the anchors and
// capabilities of its contract report (`FanslyAnchorId`, `FanslyCapability`).
//
// Fansly ids — creator, fan, group, message, follow — are snowflakes counted from Fansly's epoch, 2019-06-25:
// decimal strings, 18 digits today, 19 from about January 2027, 17 or fewer for what was made before April 2020 (old
// accounts), above 2^53 for anything after July 2019. They are strings everywhere, never numbers: Number() merges
// neighbours (`fansly-web.md` §9). Their order is the snowflake's — the shorter is the older, then the string order
// (`compareFanslyIds`); `createdAt` in seconds does not order the messages of one second (S2 Q1.5).
//
// A site module (1.15.0), like bridge-fansly.ts: imported by its own subpath only, never from the root. It takes
// nothing of host.ts or ids.ts at run time (types only), so they may import from it without a cycle.

import * as z from 'zod/mini';

import { FeatureIdSchema, isFreshTextFeature, type FeatureId } from './features';
import type { Unsubscribe } from './host';
import type { HostIdentity, HumanCause } from './ids';
import { LIVE_TEXT_LIMITS } from './limits';
import { CountSchema, EpochTokenSchema, IsoTimestampSchema, NativeIdSchema, boundedText, type NativeId } from './primitives';

/** Snowflake order of two Fansly ids: negative — `a` is older. Both are NATIVE_ID_PATTERN strings (no leading zero). */
export function compareFanslyIds(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Strictly ascending in snowflake order: oldest first, no repeats. */
function ascending(ids: readonly string[]): boolean {
  for (let i = 1; i < ids.length; i += 1) if (compareFanslyIds(ids[i - 1] as string, ids[i] as string) >= 0) return false;
  return true;
}

// ── Limits ─────────────────────────────────────────────────────────────────

/**
 * What MAIN holds and gives (§5.5, §5.8) and what the start rule counts (§5.6, P1a). Starting values of the memory
 * account are P7b's; these are the ones a schema or a rule reads. MAIN repeats them as literals, pinned by its tests.
 */
export const FANSLY_LIMITS = {
  /** Records of one chat's ring of metadata. */
  ringRecords: 120,
  /** Chats MAIN observes at once; an evicted chat is unknown. */
  maxChats: 300,
  /** The check window of a function: its last min(60, messageCount) messages (FS-TAIL-1). */
  checkWindowMax: 60,
  /** The fan's newest messages of the check window the hub answers about (`knownFanMessageIds`). */
  knownFanMessagesMax: 10,
  /** Texts in a snapshot's tail: the hub's live text limit. */
  tailMax: LIVE_TEXT_LIMITS.maxItems,
  /** A page of history as Fansly serves it; a fresh end shorter than this proves the start (§5.6, the old rule). */
  historyPage: 25,
  /** The pass of «Новые» counts personal messages among the last 30 of the history it walked (P1a, as the old). */
  passPersonalWindow: 30,
  /** Automated message ids in a start proof: the newest, the ring's capacity. */
  automatedIdsMax: 120,
} as const;

// ── Contract: anchors and capabilities (§7.12, FS-CTR-1, FS-CTR-2) ─────────

/**
 * The anchors of the Fansly contract report (§7.12): DOM anchors of the conversation route, the vault upload input and
 * the page's flags, which the isolated side checks, and the network ones, which MAIN reports (`fx.contract`). The
 * report's Fansly block names every one of them: an absent anchor is `missing`, never «nothing to check».
 */
export const FANSLY_ANCHOR_IDS = [
  'conversationRoute',
  'container',
  'composer',
  'textarea',
  'sendButton',
  'fileInput',
  'headerContact',
  'headerSubRow',
  'attachments',
  'noDmAllowed',
  'modalFlag',
  'themeClass',
  'vaultUpload',
  'accountMe',
  'socket',
  'frames',
  'xhr',
] as const;
export const FanslyAnchorIdSchema = z.enum(FANSLY_ANCHOR_IDS);
export type FanslyAnchorId = z.infer<typeof FanslyAnchorIdSchema>;

/** The network anchors: MAIN's to report, in `fx.contract`. */
export const FANSLY_NETWORK_ANCHORS = ['accountMe', 'socket', 'frames', 'xhr'] as const satisfies readonly FanslyAnchorId[];
export type FanslyNetworkAnchor = (typeof FANSLY_NETWORK_ANCHORS)[number];

/**
 * What the Fansly host can do beyond the shared HOST_CAPABILITIES; each degrades on its own (FS-CTR-2):
 * `freshness` — the generation snapshot (HostPort.freshness); `follows` — new subscribers from the socket (`3/2`) for
 * the sound; `headerSlot` — «Регистрация» and «Заметки» in the chat header; `fileAttach` — a file into the composer
 * (voice); `vault` — a file into the open vault album; `relay` — «Fansly через вкладку».
 */
export const FANSLY_CAPABILITIES = ['freshness', 'follows', 'headerSlot', 'fileAttach', 'vault', 'relay'] as const;
export const FanslyCapabilitySchema = z.enum(FANSLY_CAPABILITIES);
export type FanslyCapability = z.infer<typeof FanslyCapabilitySchema>;

// ── Observation ────────────────────────────────────────────────────────────

/** Completeness of a chat's observation (§5.6, FS-TAIL-4). */
export const FANSLY_COMPLETENESS = ['complete', 'unknown'] as const;
export type FanslyCompleteness = (typeof FANSLY_COMPLETENESS)[number];

/**
 * Why a chat's observation is what it is (§5.4–§5.6, FS-TAIL-4, FS-WS-5): `certificate` — the only reason for
 * `complete`; every other one says why it is `unknown`: `not-certified` (no certificate in this document yet),
 * `late-install` (MAIN came after the page's socket), `socket` (a new socket epoch, a close, frames seen and none
 * parsed), `frame` (a frame over the limits, damaged, or a package not parsed whole), `unseen` (a source named a
 * message the observation lacks), `no-overlap` (a recovery answer does not reach the observation), `evicted` (the
 * memory account dropped the chat), `parse-limit` (a response over the parse limit was dropped), `pending-parse` (the
 * deferred parse did not finish within the snapshot's budget), `participants` (the group's members changed),
 * `bfcache` (the page came back from the back-forward cache), `gap` (the bridge stopped, `fx.gap`).
 */
export const FANSLY_COVERAGE_REASONS = [
  'certificate',
  'not-certified',
  'late-install',
  'socket',
  'frame',
  'unseen',
  'no-overlap',
  'evicted',
  'parse-limit',
  'pending-parse',
  'participants',
  'bfcache',
  'gap',
] as const;
export type FanslyCoverageReason = (typeof FANSLY_COVERAGE_REASONS)[number];

// ── Fan avatar (FX-018) ────────────────────────────────────────────────────

/**
 * The fan's avatar for Hi, as the page already loaded it (decision X37, FX-018): a Fansly CDN address and nothing
 * else — the hub's own rule (`fanslyAvatarUrlSchema`), so a URL MAIN gives is one the hub takes. Only a string of the
 * address; the client never fetches it.
 */
export const FANSLY_AVATAR_URL_PATTERN = /^https:\/\/[a-z0-9-]+\.fansly\.com\//;
export const FanslyAvatarUrlSchema = z.string().check(z.maxLength(4096), z.regex(FANSLY_AVATAR_URL_PATTERN));

// ── StartProofV1 (§5.8, FS-AI-2, HF-5) ─────────────────────────────────────

/**
 * Who proved the start: `tab-short-page` — the tab, by a certified fresh end shorter than a history page and the
 * continuous observation since (§5.6); `pass-empty-page` — the pass of «Новые», by walking the history to its empty
 * page (FS-NEW-7).
 */
export const START_PROOF_SOURCES = ['tab-short-page', 'pass-empty-page'] as const;
export type StartProofSource = (typeof START_PROOF_SOURCES)[number];

const startProofShape = {
  v: z.literal(1),
  source: z.enum(START_PROOF_SOURCES),
  groupId: NativeIdSchema,
  /**
   * The first message of the conversation, as the source saw it. Tab: the oldest message of the short certificate.
   * Pass: the earliest message of the whole history it walked (from the last non-empty page before the confirmed
   * end). Null only when the whole history is empty.
   */
  startWitnessId: z.nullable(NativeIdSchema),
  /** Messages from the start that the tab or the pass saw. */
  coveredCount: CountSchema,
  /**
   * Personal messages (NF-033: the fan's always; the model's unless automated by `type === 2`, a `correlationId`
   * without `inReplyTo`, or a welcome text of `/message/automated`). Tab: over the whole proven history; pass: among
   * the last 30 messages of the history it walked.
   */
  personalCount: CountSchema,
  /** The newest automated messages, oldest first, at most the ring's capacity. */
  automatedIds: z.array(NativeIdSchema).check(z.maxLength(FANSLY_LIMITS.automatedIdsMax)),
};
type StartProofShape = { readonly source: StartProofSource; readonly startWitnessId: string | null; readonly coveredCount: number; readonly personalCount: number; readonly automatedIds: readonly string[] };

/** The witness is there exactly when the history is not empty, and no automated message is older than it. */
function startWitnessHolds(p: StartProofShape): boolean {
  if ((p.startWitnessId === null) !== (p.coveredCount === 0)) return false;
  const first = p.automatedIds[0];
  return p.startWitnessId === null || first === undefined || compareFanslyIds(p.startWitnessId, first) <= 0;
}

/** The counts fit the history they come from: the pass counts personal messages among its last 30 only. */
function startCountsHold(p: StartProofShape): boolean {
  const automated = p.automatedIds.length;
  if (!ascending(p.automatedIds) || automated > p.coveredCount || p.personalCount > p.coveredCount) return false;
  if (p.source === 'pass-empty-page') return p.personalCount <= FANSLY_LIMITS.passPersonalWindow;
  return p.personalCount + automated <= p.coveredCount;
}

/**
 * The client's proof of the start of a conversation and its count of personal messages (§5.8, decision X37): Hi on
 * Fansly is allowed by the hub (`hi-start-proof-v1`) on it; the client refuses by itself only when more than 10 are
 * proven. A missing proof is never a zero count. Ids only, never a text; the hub checks the ids against its history.
 */
export const StartProofV1Schema = z
  .strictObject(startProofShape)
  .check(
    z.refine(startWitnessHolds, { message: 'the witness is null only for an empty history and no automated message is older' }),
    z.refine(startCountsHold, { message: 'counts within the covered history; automated ids ascending; the pass counts its last 30' }),
  );
export type StartProofV1 = z.infer<typeof StartProofV1Schema>;

// ── FanslySnapshot (§5.8, FS-TAIL-6) ───────────────────────────────────────

/** One message of the check window: its id and side, no text. Media-only and automated messages are here too. */
export const FanslyWindowEntrySchema = z.strictObject({ id: NativeIdSchema, dir: z.enum(['fan', 'model']) });
export type FanslyWindowEntry = z.infer<typeof FanslyWindowEntrySchema>;

/**
 * One text of the tail, in the hub's live text form (`LiveTextMessage` of host.ts, the same fields and limits: a test
 * holds them equal). Only messages with a text: the hub takes no empty one.
 */
export const FanslyTailMessageSchema = z.strictObject({
  platformMessageId: NativeIdSchema,
  direction: z.enum(['fan', 'model']),
  sentAt: IsoTimestampSchema,
  text: boundedText(LIVE_TEXT_LIMITS.maxChars),
});

const snapshotShape = {
  /** The function the snapshot is for: it decides whether a tail and a start proof may be in it. */
  feature: FeatureIdSchema,
  /** The chat as MAIN knows it: the creator of `/account/me`, the group of the request, the group's one fan. */
  identity: z.strictObject({ creatorId: NativeIdSchema, groupId: NativeIdSchema, fanId: NativeIdSchema }),
  /** MAIN's document epoch, the socket epoch, and the route epoch of the last `fx.focus`. */
  epochs: z.strictObject({ document: EpochTokenSchema, socket: CountSchema, route: CountSchema }),
  completeness: z.enum(FANSLY_COMPLETENESS),
  /** Why the observation is unknown; there exactly when it is. */
  gap: z.optional(z.enum(FANSLY_COVERAGE_REASONS)),
  /** The check window: the chat's last min(60, messageCount) messages MAIN saw in this document, oldest first. */
  window: z.array(FanslyWindowEntrySchema).check(z.maxLength(FANSLY_LIMITS.checkWindowMax)),
  /** The fan's newest messages of the window, oldest first. */
  knownFanMessageIds: z.array(NativeIdSchema).check(z.maxLength(FANSLY_LIMITS.knownFanMessagesMax)),
  /** Messages of the window's span the tab saw deleted, oldest first; never in `window`. */
  deletedIds: z.array(NativeIdSchema).check(z.maxLength(FANSLY_LIMITS.ringRecords)),
  /** Hi only. */
  startProof: z.optional(StartProofV1Schema),
  /** Hi only: the fan's avatar, when the page loaded it (FX-018). */
  fanAvatarUrl: z.optional(FanslyAvatarUrlSchema),
  /**
   * Reply, Fix, Hi and Ping only (D-14): the texts of the window, oldest first. Empty is a lawful tail (a chat without
   * a text); absent — another function or no texts held.
   */
  tail: z.optional(z.array(FanslyTailMessageSchema).check(z.maxLength(FANSLY_LIMITS.tailMax))),
  /** Old texts were dropped to keep the frame within its limit (FANSLY_BRIDGE_LIMITS.maxSnapshotBytes). */
  truncated: z.boolean(),
};
type SnapshotShape = {
  readonly feature: FeatureId;
  readonly identity: { readonly creatorId: string; readonly groupId: string; readonly fanId: string };
  readonly completeness: FanslyCompleteness;
  readonly gap?: FanslyCoverageReason | undefined;
  readonly window: readonly FanslyWindowEntry[];
  readonly knownFanMessageIds: readonly string[];
  readonly deletedIds: readonly string[];
  readonly startProof?: { readonly groupId: string } | undefined;
  readonly fanAvatarUrl?: string | undefined;
  readonly tail?: ReadonlyArray<{ readonly platformMessageId: string; readonly direction: 'fan' | 'model' }> | undefined;
  readonly truncated: boolean;
};

/**
 * Every id of the check comes from the window (FS-TAIL-1): the window is in snowflake order; the fan's known messages
 * are the window's fan messages; deleted ones are not in it; the tail is the window's messages with a text, on the
 * same side.
 */
function snapshotIdsHold(s: SnapshotShape): boolean {
  const side = new Map<string, 'fan' | 'model'>();
  for (const entry of s.window) side.set(entry.id, entry.dir);
  if (!ascending(s.window.map((entry) => entry.id))) return false;
  if (!ascending(s.knownFanMessageIds) || !s.knownFanMessageIds.every((id) => side.get(id) === 'fan')) return false;
  if (!ascending(s.deletedIds) || s.deletedIds.some((id) => side.has(id))) return false;
  const tail = s.tail ?? [];
  return ascending(tail.map((m) => m.platformMessageId)) && tail.every((m) => side.get(m.platformMessageId) === m.direction);
}

/** A gap names why the observation is unknown — never `certificate`; texts are dropped only from a tail. */
function snapshotStateHolds(s: SnapshotShape): boolean {
  if ((s.completeness === 'unknown') !== (s.gap !== undefined) || s.gap === 'certificate') return false;
  return !s.truncated || s.tail !== undefined;
}

/** Page text only for draft functions (D-14); the start proof and the avatar only for Hi, of this very chat. */
function snapshotFeatureHolds(s: SnapshotShape): boolean {
  if (s.tail !== undefined && !isFreshTextFeature(s.feature)) return false;
  if ((s.startProof !== undefined || s.fanAvatarUrl !== undefined) && s.feature !== 'hi') return false;
  if (s.startProof !== undefined && s.startProof.groupId !== s.identity.groupId) return false;
  return s.identity.creatorId !== s.identity.fanId;
}

/**
 * MAIN's answer to `fx.generationSnapshot` (§5.8, FS-TAIL-6): taken in one synchronous step after a bounded drain of
 * the deferred parse, so the tail and the check come from the same instant. Metadata for every function; texts for
 * draft functions only; within FANSLY_BRIDGE_LIMITS.maxSnapshotBytes, the oldest texts dropped first. Never on disk;
 * the background keeps no copy of the tail (FS-PRIV-1).
 */
export const FanslySnapshotSchema = z
  .strictObject(snapshotShape)
  .check(
    z.refine(snapshotIdsHold, { message: 'every id of the check comes from the window, in snowflake order' }),
    z.refine(snapshotStateHolds, { message: 'a gap exactly when unknown, never «certificate»; only a tail is truncated' }),
    z.refine(snapshotFeatureHolds, { message: 'a tail for draft functions only; a start proof and an avatar for Hi of this chat only' }),
  );
export type FanslySnapshot = z.infer<typeof FanslySnapshotSchema>;

// ── FanslyPagePort (§7.4, §7.10, §7.11, §8.5) ──────────────────────────────

/**
 * Where «Регистрация» and «Заметки» live (§7.4): the header slot of the open chat — the UI mounts its surface there
 * through the mount port — or why there is none: not a chat route, a group chat or the gallery (no contact block), or
 * the anchor is gone in a new Fansly build (FS-REG-4: a broken anchor in «Статус»).
 */
export type FanslyHeaderSlot =
  | { readonly state: 'ready'; readonly groupId: NativeId; readonly fanId: NativeId }
  | { readonly state: 'none'; readonly reason: 'no-chat' | 'group' | 'gallery' | 'anchor-missing' };

/** A file for a page input. Contracts carry no DOM types: the bytes and the two fields the page reads. */
export interface FanslyFile {
  readonly name: string;
  readonly type: string;
  readonly bytes: ArrayBuffer;
}

/**
 * How a file reached the page's input (§7.10, S6 Q7): a DataTransfer of the isolated world, or the page world's copy
 * through `wrappedJSObject` + `cloneInto`. client_health counts which one worked.
 */
export const FANSLY_HANDOFF_PATHS = ['data-transfer', 'clone-into'] as const;
export type FanslyHandoffPath = (typeof FANSLY_HANDOFF_PATHS)[number];

/** A file into the open chat's composer (§7.10): the voice of the chat the person asked it for. */
export interface FanslyAttachRequest {
  /** The chat, document and composer the file is for; another one open — refused before anything is handed over. */
  readonly expected: HostIdentity;
  /** The group of the open route (`RouteState.conversationRef`). */
  readonly conversationRef: NativeId;
  /** The person's click; redeemed before the page is touched (§14). */
  readonly cause: HumanCause;
  readonly file: FanslyFile;
}

/**
 * The outcome of handing a file to the page. The port never hands the same file again by itself: «Прикрепить ещё
 * раз» is a new request the person confirms (§7.10).
 */
export type FanslyHandoffReceipt =
  /** Fansly took it: the attachment is in the main composer (after the person's «Upload»), or the vault confirmed it. */
  | { readonly state: 'done'; readonly path: FanslyHandoffPath }
  /** Nothing was handed over: another chat or document, a spent cause, no input, a handoff already open. */
  | { readonly state: 'refused'; readonly reason: 'identity' | 'cause' | 'anchor-missing' | 'busy' }
  /** Handed over, the outcome not seen: the modal closed without it, two attachments, a mini chat, the time ran out. */
  | { readonly state: 'unknown'; readonly path: FanslyHandoffPath };

/** The hidden relay frame of «Fansly через вкладку» (§8.5), in a closed root of this tab. */
export interface FanslyRelayFrame {
  /** Mounts the frame, or keeps the mounted one; settles when its page has loaded, or failed to. */
  open(): Promise<'open' | 'failed'>;
  /** Removes the frame; nothing mounted — nothing to do. */
  close(): void;
}

/**
 * The page port of the Fansly adapter (`HostPort.fansly`, §7.7): what only fansly.com has. Lives in the isolated
 * world; MAIN is not involved — it writes nothing (§5). A member whose anchor is gone degrades on its own
 * (FANSLY_CAPABILITIES, FS-CTR-2).
 */
export interface FanslyPagePort {
  /** §7.4: the header slot of the open chat, re-made idempotently each time Fansly re-creates the contact block. */
  headerSlot(): FanslyHeaderSlot;
  onHeaderSlot(cb: (slot: FanslyHeaderSlot) => void): Unsubscribe;
  /**
   * §7.10: hands one file to the main composer's file input with one `change`; Fansly attaches it only after the
   * person clicks «Upload» in its modal. Resolves when the attachment appears, or the outcome cannot be seen.
   */
  attachToComposer(request: FanslyAttachRequest): Promise<FanslyHandoffReceipt>;
  /**
   * §7.11: one file into the upload input of the vault album open on the page (one file per `change`), as a step of
   * a run the person started; the run's checkpoint names the album. Done after `fx.vaultAdded` and the album's reload.
   */
  uploadToVault(file: FanslyFile): Promise<FanslyHandoffReceipt>;
  /** §8.5: the relay frame, lazily, for a batch of work and 60 s after. */
  readonly relay: FanslyRelayFrame;
}
