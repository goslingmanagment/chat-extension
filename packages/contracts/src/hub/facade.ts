// The hub facade (architecture.md §5.8): the background's only door to the
// hub. Implemented by `@cg/hub` over the vendored SDK (R08); core services
// depend on this interface, never on the SDK. Every call is bound to the
// sign-in epoch it started under; a failed call rejects with a HubCallError
// whose facts the core resolver turns into a CG code (error-map.ts), or —
// since 1.1.0 — with a HubCheckError when the hub layer refused it itself.
//
// Changes against the §5.8 sketch, forced by the hub's real routes
// (hub-pr-plan.md §4): queries carry their path params (pageLabel, fanRef);
// `profileFromGeneration` needs pageLabel + fanRef; `audienceNew` needs the
// fixed window; `aiUsage` takes `days` 1–7 and a zone on the page path (H-15).

import { type CgCode } from '../errors';
import { type AcceptanceEvent, type ClientHealthV1 } from '../telemetry';
import { type SessionIdentity } from '../ids';
import { type HubFrame, type HubStreamRequest, type PersonaCatalog } from './ai';
import { type HubHealth, type SignOutOutcome } from './auth';
import { type Bootstrap } from './bootstrap';
import { type HubClientCheck, type HubErrorResolution, type HubFailure } from './error-map';
import { type FeedPage, type FeedQuery } from './feed';
import { type HubClaimOp } from './claim-body';
import { type AudienceNewPage, type AudienceNewQuery, type ClaimState } from './newcomers';
import {
  type Dossier,
  type DossierQuery,
  type ProfileFromGenerationRequest,
  type ProfileSaveOutcome,
  type RecapStatus,
  type RecapStatusQuery,
  type SharedRecaps,
  type SharedRecapsQuery,
} from './recaps';
import { type HubRouteKey } from './routes';
import {
  type AutoLists,
  type QueuePage,
  type QueueQuery,
  type SpenderBatch,
  type SpenderBatchQuery,
  type SpenderDetail,
  type SpenderDetailQuery,
  type SpendersPage,
  type SpendersQuery,
  type SpendersStats,
  type StatsQuery,
} from './spenders';
import { type SendAttributionsRequest, type SendAttributionsResult } from './attribution';
import { type FanNoteAttributions, type FanNoteAttributionsQuery, type NoteAttributionsRequest, type NoteAttributionsResult } from './note-attribution';
import { type ActivityBeatRequest, type ActivityBeatResult, type InConversationQuery, type InConversationResult } from './conversation';
import { type Handoff, type HandoffQuery, type WinBackAttemptRequest, type WinBackAttemptResult, type WinBackList, type WinBackQuery } from './queue';
import { type OnlineAttemptRequest, type OnlineAttemptResult, type OnlineList, type OnlinePresenceRequest, type OnlinePresenceResult, type OnlineProbeRequest, type OnlineProbeResult, type OnlineQuery } from './online';
import { type OnlyfansFeedRequest, type OnlyfansFeedResult, type OnlyfansPollRequest, type OnlyfansPollResult } from './onlyfans-feed';
import { type FanQueueItemDone, type FanQueueItemDoneRequest, type FanQueueRelease, type FanQueueReleaseRequest, type FanQueues, type FanQueuesQuery, type FanQueueTake, type FanQueueTakeRequest } from './fan-queues';
import { type FanCard, type FanCardQuery, type FanCustomChangeRequest, type FanCustomCreateRequest, type FanFactChangeRequest, type FanFactChangeResult, type FanLinkDecideRequest, type FanLinkDecideResult } from './fan-card';
import { type FanMarks, type FanMarksQuery } from './fan-marks';
import { type AiUsageQuery, type AiUsageReport, type IngestResult } from './usage';
import { type NativeId } from '../primitives';
import { type VoiceAllowance, type VoiceAllowanceQuery, type VoiceNoteCreateRequest, type VoiceNoteRef, type VoiceNoteView } from '../voice';

/** Fixed timings of the facade (§7, §8.2, §8.3); the board and «Новые» ones are SPENDERS_BOARD and AUDIENCE_LIMITS. */
export const HUB_FACADE_TIMING = {
  signInTimeoutMs: 20_000,
  /** Sign-out revokes within this, then wipes again whatever the answer. */
  signOutRevokeTimeoutMs: 5_000,
  /** Pauses between failed bootstrap refreshes. */
  bootstrapRetryPausesMs: [5_000, 15_000, 60_000],
  /** A focus refresh at most this often. */
  bootstrapFocusRefreshMinMs: 60_000,
  /** H-5 `not-ready`: idempotent link writes after these delays, then every 3 min up to 30 min while the tab is open. */
  profileSaveDelaysMs: [5_000, 15_000, 60_000],
  profileSaveThenEveryMs: 180_000,
  profileSaveGiveUpMs: 1_800_000,
} as const;

/** What a facade call rejects with: the route and the facts, never the token or a hub message shown as text. */
export interface HubCallError {
  readonly name: 'HubCallError';
  readonly route: HubRouteKey;
  readonly failure: HubFailure;
  /** The sign-in epoch the call ran under (AU-014). */
  readonly epoch: number;
  /**
   * 1.1.0: the facade's own reading of the failure — ResolveHubError over
   * the facts only the facade has (the page in the bootstrap, frames already
   * seen, the AI retry already spent, the claim action, a fan lookup).
   * Consumers use it as is; re-check `epoch` against the current session
   * before acting on `clear-sign-in` (the facade has already done it).
   */
  readonly resolution?: HubErrorResolution;
}

/**
 * 1.1.0: what a facade call rejects with when the hub layer's own check
 * refuses it (HUB_CLIENT_CHECK_CODES) — there is no hub answer to read:
 * a pending sign-in, a full token, no bootstrap, a missing capability, a
 * flag off, a page not granted, a foreign persona in `meta`…
 */
export interface HubCheckError {
  readonly name: 'HubCheckError';
  readonly check: HubClientCheck;
  /** = HUB_CLIENT_CHECK_CODES[check]. */
  readonly code: CgCode;
  /** The operation the check guarded; null for a check outside any route. */
  readonly route: HubRouteKey | null;
  readonly epoch: number;
  /** An open token naming why (a page feature's `reason`: flag_off, platform_unsupported…), when there is one. */
  readonly reason?: string;
}

export function isHubCallError(value: unknown): value is HubCallError {
  return typeof value === 'object' && value !== null && (value as { name?: unknown }).name === 'HubCallError';
}

export function isHubCheckError(value: unknown): value is HubCheckError {
  return typeof value === 'object' && value !== null && (value as { name?: unknown }).name === 'HubCheckError';
}

/** The part of AbortSignal the facade uses (contracts carry no DOM types). */
export interface AbortSignalLike {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void, options?: { readonly once?: boolean }): void;
}

export interface BootstrapOptions {
  /** Skip the cache (sign-in, «Проверить связь»). */
  readonly force?: boolean;
  /** Resolve with the cached bootstrap when its configRevision is this one and it has not expired. */
  readonly ifRevision?: number;
}

/**
 * 1.15.0 (R20 P9d): a site's own strict schema of a request (a zod schema fits): what the facade checks a request by
 * instead of the registry's, and sends as it parsed it. A request that fails it is never sent.
 */
export interface HubRequestCheck {
  safeParse(value: unknown): { readonly success: true; readonly data: unknown } | { readonly success: false };
}

export interface HubFacade {
  /** Narrow token (`client: 'chat-extension'`, mode active); FIFO with sign-out (AU-009); 20 s. */
  signIn(login: string, password: string): Promise<SessionIdentity>;
  /** Wipe → revoke (5 s) → wipe again (AU-013). */
  signOut(): Promise<SignOutOutcome>;
  session(): SessionIdentity | null;
  /** `contractHash`, `compatibleClientSdks` (H-1). */
  health(): Promise<HubHealth>;
  /** H-2; cached for `ttlSec`. */
  bootstrap(opts?: BootstrapOptions): Promise<Bootstrap>;
  catalog(): Promise<PersonaCatalog>;
  /** Every generation. Frames reach `sink` in order; resolves after `done`, rejects on `error`, EOF or abort. */
  stream(request: HubStreamRequest, sink: (frame: HubFrame) => void, signal: AbortSignalLike): Promise<void>;
  recapStatus(query: RecapStatusQuery): Promise<RecapStatus>;
  /** H-13. */
  recaps(query: SharedRecapsQuery): Promise<SharedRecaps>;
  /** null: the hub knows no such fan on the page. */
  dossier(query: DossierQuery): Promise<Dossier | null>;
  /** H-5: an idempotent server-side link write, never a new generation. */
  profileFromGeneration(request: ProfileFromGenerationRequest): Promise<ProfileSaveOutcome>;
  spenders(query: SpendersQuery): Promise<SpendersPage>;
  /** null: the hub knows no such fan on the page. */
  spenderDetail(query: SpenderDetailQuery): Promise<SpenderDetail | null>;
  spenderBatch(query: SpenderBatchQuery): Promise<SpenderBatch>;
  autoLists(pageLabel: string): Promise<AutoLists>;
  /** H-8b. */
  spendersStats(query: StatsQuery): Promise<SpendersStats>;
  /** H-8c. */
  awaitingReply(query: QueueQuery): Promise<QueuePage>;
  /** H-9c: database only on the hub; never marks a chat read. */
  feed(query: FeedQuery): Promise<FeedPage>;
  /** H-7c. */
  audienceNew(query: AudienceNewQuery): Promise<AudienceNewPage>;
  /**
   * H-7b: lease claim|renew|release, custody dispatch|sent|failed, registerNativeSend. 1.15.0 (R20 P9d): the body the
   * hub takes since HF-3 (`HubClaimOp`: OnlyFans' ClaimOp, or a Fansly greeting's, its group possibly manual). The op is
   * checked strictly before it is sent (HB-006): by `check` when the caller brings its site's own schema (Fansly's
   * `FanslyGreetingClaimOpSchema`, which no shared bundle carries), else by the registry's `ClaimOpSchema`.
   */
  claim(op: HubClaimOp, check?: HubRequestCheck): Promise<ClaimState>;
  /** H-7b GET: the same state, never a ticket. */
  claimStatus(pageLabel: string, fanRef: NativeId): Promise<ClaimState>;
  /** `ai_acceptance` always; `client_health` only under `client-health-perf-v1`, in its own batch. */
  ingest(events: readonly (AcceptanceEvent | ClientHealthV1)[]): Promise<IngestResult>;
  /** H-15, debug only; absent without `ai-usage-v1`. */
  aiUsage?(query: AiUsageQuery): Promise<AiUsageReport>;
  /**
   * 1.21.0 (X48): who sent these messages of the page — the person signed in. Refused locally without
   * `send-attribution-v1` (CG-HUB-CAPABILITY) and for a page the bootstrap does not grant; no owner switch. Never
   * repeated by the facade: the caller's journal owns what is owed.
   */
  sendAttributions(request: SendAttributionsRequest): Promise<SendAttributionsResult>;
  /**
   * Who wrote these Fansly notes of the page — the person signed in. Refused locally without `note-attribution-v1`
   * (CG-HUB-CAPABILITY) and for a page the bootstrap does not grant; no owner switch. Never repeated by the facade: the
   * caller's journal owns what is owed.
   */
  noteAttributions(request: NoteAttributionsRequest): Promise<NoteAttributionsResult>;
  /** 2026-10-29: who created each of a fan's notes and who changed it last (`note-attribution-read-v1`). */
  fanNoteAttributions(query: FanNoteAttributionsQuery): Promise<FanNoteAttributions>;
  /**
   * Chat Memory week 1: the beat of the person signed in. Refused here without `chatter-activity-v1`; no page grant is
   * checked (the hub skips a page that is not theirs). Never repeated: a lost beat is just lost.
   */
  activityBeat(request: ActivityBeatRequest): Promise<ActivityBeatResult>;
  /** Chat Memory week 1: «в разговоре» of a page — refused without `in-conversation-v1` and for a page not granted. */
  inConversation(query: InConversationQuery): Promise<InConversationResult>;
  /** Chat Memory week 2: the fan's card across pages — refused without `fan-card-v1` and for a page not granted. */
  fanCard(query: FanCardQuery): Promise<FanCard>;
  /** A chatter's «Да» or «Нет» on a suggested account; never repeated by itself. */
  fanLinkDecide(request: FanLinkDecideRequest): Promise<FanLinkDecideResult>;
  /** A chatter deletes or corrects a fact; never repeated by itself. */
  fanFactChange(request: FanFactChangeRequest): Promise<FanFactChangeResult>;
  /** The fan's warning marks (lists like «💩 Бомж», FANSLY BLOCKLIST) — refused without `fan-marks-v1` and for a page not granted. */
  fanMarks(query: FanMarksQuery): Promise<FanMarks>;
  /** Chat Memory week 4: a custom written into the fan's card; refused without `fan-customs-v1`. Never repeated by itself. */
  fanCustomCreate(request: FanCustomCreateRequest): Promise<FanFactChangeResult>;
  /** A custom marked paid, delivered, cancelled or edited, by the card's suggestions; never repeated by itself. */
  fanCustomChange(request: FanCustomChangeRequest): Promise<FanFactChangeResult>;
  /** Chat Memory week 3: the win-back list of a page; refused without `win-back-v1`. */
  winBack(query: WinBackQuery): Promise<WinBackList>;
  /** A chatter's approach pick for a fan of the list; never repeated by itself. */
  winBackAttempt(request: WinBackAttemptRequest): Promise<WinBackAttemptResult>;
  /** Chat Memory week 3: the shift handoff of a page; refused without `handoff-v1`. */
  handoff(query: HandoffQuery): Promise<Handoff>;
  /** «Онлайн»: the page's fans seen online within `minutes`, why to write now and with what; refused without `online-v1`. */
  online(query: OnlineQuery): Promise<OnlineList>;
  /** A tab's report of the fans it saw online (Fansly's followers, ChatSpace's online fans); never repeated by itself. */
  onlinePresence(request: OnlinePresenceRequest): Promise<OnlinePresenceResult>;
  /** The page's probe lent to this tab, or when it may be (OnlyFans, the owner's `onlineProbe`); never repeated here. */
  onlineProbe(request: OnlineProbeRequest): Promise<OnlineProbeResult>;
  /** What the page's ChatSpace already received, passed on (hub #953, the page's `ofFeed`); the hub dedups a repeat. */
  onlyfansFeed(request: OnlyfansFeedRequest): Promise<OnlyfansFeedResult>;
  /** hub #955: the page's poll of ChatSpace lent to this tab, or when it may be (the page's `ofPoll`); never repeated here. */
  onlyfansPoll(request: OnlyfansPollRequest): Promise<OnlyfansPollResult>;
  /** What a chatter did in «Онлайн» (a message sent, «Не предлагать», its undo); never repeated by itself. */
  onlineAttempt(request: OnlineAttemptRequest): Promise<OnlineAttemptResult>;
  /** «Очереди»: the caller's fan queues of the page; refused without `fan-queues-v1`. */
  fanQueues(query: FanQueuesQuery): Promise<FanQueues>;
  /** A portion of a queue: never repeated by itself (a take leases fans). */
  fanQueueTake(request: FanQueueTakeRequest): Promise<FanQueueTake>;
  /** A fan's outcome: one call, never repeated by itself. */
  fanQueueItemDone(request: FanQueueItemDoneRequest): Promise<FanQueueItemDone>;
  /** The caller's portion given back. */
  fanQueueRelease(request: FanQueueReleaseRequest): Promise<FanQueueRelease>;
  /**
   * 1.47.0: the paid voicing of a script (`voiceNoteCreate`): idempotent per `clientRequestId` at the hub, never
   * repeated by the facade — the caller wrote the take before it asked. Needs the page's `voice` and `voice-notes-v1`.
   */
  voiceNoteCreate(request: VoiceNoteCreateRequest): Promise<VoiceNoteView>;
  /** 1.47.0: a voice note's state; a read, never a render. */
  voiceNoteStatus(ref: VoiceNoteRef): Promise<VoiceNoteView>;
  /** 1.47.0: a voice note's MP3 as the hub serves it (`fetchVoiceNoteAudio`); the caller checks its sha256 and length. */
  voiceNoteAudio(ref: VoiceNoteRef): Promise<ArrayBuffer>;
  /** 1.49.0: what the page may still voice today; a free read, never a render. The hub still decides every create. */
  voiceNoteAllowance(query: VoiceAllowanceQuery): Promise<VoiceAllowance>;
}
