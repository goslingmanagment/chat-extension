// The hub facade (architecture.md §5.8): the background's only door to the
// hub. Implemented by `@cg/hub` over the vendored SDK (R08); core services
// depend on this interface, never on the SDK. Every call is bound to the
// sign-in epoch it started under; a failed call rejects with a HubCallError
// whose facts the core resolver turns into a CG code (error-map.ts).
//
// Changes against the §5.8 sketch, forced by the hub's real routes
// (hub-pr-plan.md §4): queries carry their path params (pageLabel, fanRef);
// `profileFromGeneration` needs pageLabel + fanRef; `audienceNew` needs the
// fixed window; `aiUsage` takes `days` 1–7 and a zone on the page path (H-15).

import { type AcceptanceEvent, type ClientHealthV1 } from '../telemetry';
import { type SessionIdentity } from '../ids';
import { type HubFrame, type HubStreamRequest, type PersonaCatalog } from './ai';
import { type HubHealth, type SignOutOutcome } from './auth';
import { type Bootstrap } from './bootstrap';
import { type HubFailure } from './error-map';
import { type FeedPage, type FeedQuery } from './feed';
import { type AudienceNewPage, type AudienceNewQuery, type ClaimOp, type ClaimState } from './newcomers';
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
import { type AiUsageQuery, type AiUsageReport, type IngestResult } from './usage';
import { type NativeId } from '../primitives';

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
  spenderDetail(query: SpenderDetailQuery): Promise<SpenderDetail>;
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
  /** H-7b: lease claim|renew|release, custody dispatch|sent|failed, registerNativeSend. */
  claim(op: ClaimOp): Promise<ClaimState>;
  /** H-7b GET: the same state, never a ticket. */
  claimStatus(pageLabel: string, fanRef: NativeId): Promise<ClaimState>;
  /** `ai_acceptance` always; `client_health` only under `client-health-perf-v1`, in its own batch. */
  ingest(events: readonly (AcceptanceEvent | ClientHealthV1)[]): Promise<IngestResult>;
  /** H-15, debug only; absent without `ai-usage-v1`. */
  aiUsage?(query: AiUsageQuery): Promise<AiUsageReport>;
}
