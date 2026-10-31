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

import { FeatureIdSchema } from './features';
import { HiFanAccountSchema, HiFanAvatarUrlSchema as FanslyAvatarUrlSchema, START_PROOF_LIMITS, StartProofV1Schema } from './hi-start-proof';
import type { Unsubscribe } from './host';
import { LIVE_TEXT_LIMITS } from './limits';
import type { FanslyInboxMark } from './settings-ext';
import { nativeIdsAscending as ascending, CountSchema, EpochTokenSchema, IsoTimestampSchema, NativeIdSchema, boundedText, type NativeId } from './primitives';

// Preserve the site's public name; schemas share the host-neutral numeric order.
export { compareNativeIds as compareFanslyIds } from './primitives';

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
  passPersonalWindow: START_PROOF_LIMITS.passPersonalWindow,
  /** Automated message ids in a start proof: the newest, the ring's capacity. */
  automatedIdsMax: START_PROOF_LIMITS.automatedIdsMax,
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
 * the sound; `headerSlot` — «Регистрация» and «Заметки» in the chat header; `vault` — a file into the open vault
 * album; `relay` — «Fansly через вкладку». A file into the composer (the voice note) is the shared `fileAttach`
 * since 1.47.0.
 */
export const FANSLY_CAPABILITIES = ['freshness', 'follows', 'headerSlot', 'vault', 'relay'] as const;
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

// The page and the shared wire use the same Hi schemas. Preserve the site's subpath API from P4a2.
export { HI_FAN_AVATAR_URL_PATTERN as FANSLY_AVATAR_URL_PATTERN, HiFanAvatarUrlSchema as FanslyAvatarUrlSchema, START_PROOF_SOURCES, StartProofV1Schema } from './hi-start-proof';
export type { HiFanAccount, StartProofSource, StartProofV1 } from './hi-start-proof';
export { HI_FAN_ACCOUNT_LIMITS, HiFanAccountSchema, hiFanAccountOf } from './hi-start-proof';

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

export const FanslySnapshotFeatureSchema = z.union([FeatureIdSchema, z.enum(['voice-script', 'notes-fill'])]);
export type FanslySnapshotFeature = z.infer<typeof FanslySnapshotFeatureSchema>;

const snapshotShape = {
  /** The function the snapshot is for: it decides whether a tail and a start proof may be in it. */
  feature: FanslySnapshotFeatureSchema,
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
  /** Hi only (2026-10-26): the fan's names and «about», when the page loaded the account. */
  fanAccount: z.optional(HiFanAccountSchema),
  /**
   * The texts of the window, oldest first, for a start admitted to fresh text.
   * Empty is a lawful tail (a chat without a text); absent — not requested or no texts held.
   */
  tail: z.optional(z.array(FanslyTailMessageSchema).check(z.maxLength(FANSLY_LIMITS.tailMax))),
  /** Old texts were dropped to keep the frame within its limit (FANSLY_BRIDGE_LIMITS.maxSnapshotBytes). */
  truncated: z.boolean(),
};
type SnapshotShape = {
  readonly feature: FanslySnapshotFeature;
  readonly identity: { readonly creatorId: string; readonly groupId: string; readonly fanId: string };
  readonly completeness: FanslyCompleteness;
  readonly gap?: FanslyCoverageReason | undefined;
  readonly window: readonly FanslyWindowEntry[];
  readonly knownFanMessageIds: readonly string[];
  readonly deletedIds: readonly string[];
  readonly startProof?: { readonly groupId: string } | undefined;
  readonly fanAvatarUrl?: string | undefined;
  readonly fanAccount?: object | undefined;
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

/** The start proof, the avatar and the fan's account are only for Hi, of this very chat. */
function snapshotFeatureHolds(s: SnapshotShape): boolean {
  if ((s.startProof !== undefined || s.fanAvatarUrl !== undefined || s.fanAccount !== undefined) && s.feature !== 'hi') return false;
  if (s.startProof !== undefined && s.startProof.groupId !== s.identity.groupId) return false;
  return s.identity.creatorId !== s.identity.fanId;
}

/**
 * MAIN's answer to `fx.generationSnapshot` (§5.8, FS-TAIL-6): taken in one synchronous step after a bounded drain of
 * the deferred parse, so the tail and the check come from the same instant. Metadata for every function; texts for
 * admitted AI starts; within FANSLY_BRIDGE_LIMITS.maxSnapshotBytes, the oldest texts dropped first. Never on disk;
 * the background keeps no copy of the tail (FS-PRIV-1).
 */
export const FanslySnapshotSchema = z
  .strictObject(snapshotShape)
  .check(
    z.refine(snapshotIdsHold, { message: 'every id of the check comes from the window, in snowflake order' }),
    z.refine(snapshotStateHolds, { message: 'a gap exactly when unknown, never «certificate»; only a tail is truncated' }),
    z.refine(snapshotFeatureHolds, { message: 'a start proof and an avatar for Hi of this chat only' }),
  );
export type FanslySnapshot = z.infer<typeof FanslySnapshotSchema>;

// ── FanslyPagePort (§7.4, §7.11, §8.5) ─────────────────────────────────────

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
 * How a file reached the page's input (§7.10, §7.11, S6 Q7): a DataTransfer of the isolated world, or the page world's
 * copy through `wrappedJSObject` + `cloneInto`. client_health counts which one worked. The voice note's MP3 takes the
 * same two paths into the composer: the shared `HostPort.attachFile` (1.47.0).
 */
export const FANSLY_HANDOFF_PATHS = ['data-transfer', 'clone-into'] as const;
export type FanslyHandoffPath = (typeof FANSLY_HANDOFF_PATHS)[number];

/**
 * The outcome of handing a file to the vault's input (§7.11). The port never hands the same file again by itself: only
 * the person's answer decides what happens to one not confirmed (VA-004).
 */
export type FanslyHandoffReceipt =
  /** Fansly took it: the vault confirmed it. */
  | { readonly state: 'done'; readonly path: FanslyHandoffPath }
  /** Nothing was handed over: another account, no album or input, a file of the page's own in progress. */
  | { readonly state: 'refused'; readonly reason: 'identity' | 'cause' | 'anchor-missing' | 'busy' }
  /** Handed over, the outcome not seen: Fansly gave it up, another album loaded, the time ran out. */
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
   * §7.11: one file into the upload input of the vault album open on the page (one file per `change`), as a step of
   * a run the person started; the run's checkpoint names the album. Done after `fx.vaultAdded` and the album's reload.
   */
  uploadToVault(file: FanslyFile): Promise<FanslyHandoffReceipt>;
  /** §8.5: the relay frame, lazily, for a batch of work and 60 s after. */
  readonly relay: FanslyRelayFrame;
  /**
   * 2026-10-29: the mark of a chat waiting for a reply in Fansly's own list of chats, as the person chose it. Until the
   * application says it, the list stays Fansly's own; `off` takes every mark away.
   */
  setInboxMark(mark: FanslyInboxMark): void;
  /**
   * 2026-10-31: the hub's label of the page this tab works under, in front of the tab's title («lora-2 · Fansly») — one
   * model's pages in several tabs are told apart in the browser's strip; null — Fansly's own title again.
   */
  setTabLabel(label: string | null): void;
}
