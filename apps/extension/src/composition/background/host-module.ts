import type { NetworkSession } from '@cg/core/services/network-session';
// The contract between the background core and a site's background chunk
// (docs/project-unite/architecture.md §3.3): what a chunk `bg/<site>.js`
// exports (`BackgroundHostModule` as its default export), the ports of the
// core it is started with (`BackgroundKit`) and what the core asks of the
// running module (`BackgroundHostHandle`). Types only: a chunk imports this
// file for its types and nothing else of the core composition
// (.dependency-cruiser.cjs `background-chunk-boundaries`); the core builds
// the kit (composition/background.ts) and loads the chunks (./host-modules.ts).
//
// One owner of each thing. The hub layer, the settings, telemetry, the logs,
// the action tokens, the operations and the journal of human sends are the
// core's: a chunk reaches them only through the kit and never makes a second
// owner of any. What a chunk owns is its site's own services and their
// storage keys (bg/chatspace: the X8 custody with its journal and fuse, the
// greeting leases of «Новые»).
//
// The core has already checked a message it hands a module: the sender (a
// registered tab of the site, or one of our pages), the session, the type
// for that sender and the payload by the frozen schema; the answer is checked
// by its schema again on the way out (packages/platform rpc-background).

import type { HostKind } from '@cg/contracts/hosts';
import type { CgCode, CgErrorWire } from '@cg/contracts/errors';
import type { FeatureSlice } from '@cg/contracts/features/types';
import type { Bootstrap, HubFacade, HubRouteKey, ResolveHubError } from '@cg/contracts/hub';
import type { PartRef } from '@cg/contracts/ids';
import type { OpView } from '@cg/contracts/ops';
import type { FreshnessCheckpoint, SendFuseState, SendJournalEntry } from '@cg/contracts/send';
import type { TabPayloadCheck, TabRequestPayload, TabRequestType } from '@cg/contracts/tab-messages';
import type { ExtensionPage, TabSender } from '@cg/contracts/tab-protocol';
import type { AcceptanceEvent } from '@cg/contracts/telemetry';
import type { OpEnvTag, OpsEnvironment } from '@cg/core/domain/ops';
import type { PartPosition, SentProof } from '@cg/core/domain/telemetry';
import type { ActionTokens, Clock, IdSource, KeyValuePort, KeyValueStore, LogSink, NativeSendOutcome, ServiceLog, TabEventSink } from '@cg/core/services';

/** Who asked: a registered tab (its session) or one of our pages. Structurally the platform RPC's sender. */
export type KitSender = { readonly kind: 'tab'; readonly tabSessionId: string } | { readonly kind: 'page' };

/** A granted page of the current bootstrap, or why not (the core's own check of a sender's page). */
export type KitPageLookup =
  | { readonly ok: true; readonly page: { readonly pageId: number; readonly pageLabel: string; readonly platform: string } }
  | { readonly ok: false; readonly code: CgCode };

/** What a module answers a request with: the RPC's result shape. */
export type HostAnswer = { readonly ok: true; readonly payload: unknown } | { readonly ok: false; readonly error: CgErrorWire };

export type HostRequestType = Exclude<TabRequestType, 'tab.register'>;

/** A request of the tab protocol the core checked and routed to the module of its site. */
export type VerifiedTabMessage<T extends HostRequestType = HostRequestType> = {
  readonly [K in T]: { readonly type: K; readonly payload: TabRequestPayload<K>; readonly sender: KitSender };
}[T];

/** The hub as a site's services may use it: through the core's one facade. */
export interface HubPort {
  /** The facade's custody routes, its errors as they are (the greeting leases read their wire form). */
  readonly facade: Pick<HubFacade, 'claim' | 'claimStatus'>;
  /**
   * A facade call as the core's services take it: the facade's own reading of a failure goes with it, and a
   * refusal of the hub layer itself (a flag off, a page not granted…) becomes a failure with its own code.
   */
  call<T>(route: HubRouteKey, run: () => Promise<T>): Promise<T>;
  /** Reads a failure `call` rejected with: the facade's reading first. */
  readonly resolve: ResolveHubError;
  /** The wire form of whatever a facade call rejected with; never a hub message text. */
  errorWire(error: unknown): CgErrorWire;
  /** Who is signed in; null — nobody. */
  session(): { readonly hubOrigin: string; readonly userId: number } | null;
  /** The bootstrap the hub layer holds; null — none yet. */
  bootstrap(): Bootstrap | null;
  /** The page of a `pageId` for a sender: granted, and for a tab one of its own bindings. */
  page(pageId: number, sender: KitSender): Promise<KitPageLookup>;
}

/** The browser's storage areas, in the two dialects the core's services speak. */
export interface StoragePort {
  /** storage.local / storage.session with results, never a throw (R07). */
  readonly local: KeyValuePort;
  readonly session: KeyValuePort;
  /** The same areas one key at a time, a failure rejects with its code (R10, R17). */
  readonly localKeys: KeyValueStore;
  readonly sessionKeys: KeyValueStore;
}

/** The one logger of the background, in the two dialects of the core's services. */
export interface LogPort {
  readonly sink: LogSink;
  readonly service: ServiceLog;
}

/** Telemetry of the core (consent, the queue, the health window): a module reports, the core decides what leaves. */
export interface TelemetryPort {
  /** One lifecycle event of an operation (`ai_acceptance`); true — queued. */
  report(kind: AcceptanceEvent['payload']['lifecycle'], view: OpView | null, opId: string, position: PartPosition, proof?: SentProof): boolean;
  /** One more of a CG code in the `client_health` window. */
  countCode(code: CgCode): void;
}

/** The registered tabs and the events to them. */
export interface TabRouterPort {
  readonly events: TabEventSink;
  /** The registered tab sessions. */
  tabs(): readonly string[];
}

/** The operations of the core's scheduler a site's send comes from. */
export interface OpsPort {
  forSend(opId: string): { readonly view: OpView; readonly checkpoint: FreshnessCheckpoint | null; readonly tag: OpEnvTag } | null;
  view(opId: string): OpView | null;
  environment(): OpsEnvironment;
}

/** This install as the hub's custody knows it. */
export interface InstallPort {
  /** This install's id (H-7 `instanceId`). */
  instanceId(): string;
  /** Who is signed in — `hubOrigin|userId`; null — nobody. What a person holds is theirs. */
  owner(): string | null;
}

/**
 * The registration of a human send (`registerNativeSend`, H-7) and its journal of debts: the core's, one owner for
 * both sites. A module that proves a human send of a part of a preview or a «Новые» card registers it here.
 */
export interface NativeSendPort {
  register(view: OpView | null, part: PartRef, platformMessageId: string): Promise<NativeSendOutcome>;
}

/** Who sent a request of a site's own registry: a tab of the site, or the relay frame of a tab session (platform `SiteSenderContext`). */
export type HostSiteSender =
  | { readonly kind: 'tab'; readonly host: HostKind; readonly tabSessionId: string; readonly tabId: number; readonly url: string }
  | { readonly kind: 'relay'; readonly host: HostKind; readonly tabSessionId: string; readonly tabId: number; readonly frameId: number; readonly url: string };

/**
 * A site's own tab registry as its module plugs it (1.15.0; R20 P13b; architecture.md §1.6, §3.3, §12; platform
 * `BackgroundRpc.site`): the core checked the sender, its tab session, its site and the envelope; the registry's sender
 * rules, schemas (both ways) and handler are the site's — its schemas never enter the core's graph. A failure of the
 * site's own travels in the answer's payload; the error of `HostAnswer` carries shared codes only.
 */
export interface HostSiteRegistry {
  /** Every type of the registry starts with it (`fansly.`); no shared type does. */
  readonly prefix: string;
  isRequestType(type: string): boolean;
  mayRequest(type: string, sender: TabSender, page: ExtensionPage | null, host: HostKind | null): boolean;
  parse(kind: 'req' | 'res' | 'evt', type: string, payload: unknown): TabPayloadCheck;
  /** Who an event of the registry goes to; null — not one of its events. */
  eventTargets(type: string): readonly TabSender[] | null;
  handle(type: string, payload: unknown, sender: HostSiteSender): HostAnswer | Promise<HostAnswer>;
}

/** The core's RPC as a site's module reaches it: its own registry, plugged while the module runs (R20 P13b). */
export interface SitePort {
  /** Requests of the site's types are answered by `registry` from now on; the answer unplugs it. */
  plug(registry: HostSiteRegistry): () => void;
}

/** The ports of the core a site's module is started with. */
export interface BackgroundKit {
  /** R20 P13b: the site's own tab registry (`fansly.*`), plugged by its module. Absent — the core serves no site registry. */
  readonly site?: SitePort;
  /** Passive session/429 state, owned and restored by the core. No site transport here. */
  readonly networkSession?: NetworkSession;
  readonly hub: HubPort;
  readonly storage: StoragePort;
  readonly clock: Clock;
  readonly ids: IdSource;
  readonly log: LogPort;
  readonly telemetry: TelemetryPort;
  readonly router: TabRouterPort;
  readonly ops: OpsPort;
  readonly tokens: Pick<ActionTokens, 'redeem'>;
  readonly install: InstallPort;
  readonly nativeSends: NativeSendPort;
}

/** What the core tells a running module. */
export type HostModuleEvent =
  /** A new bootstrap (flags, limits, page labels). */
  | { readonly kind: 'bootstrap' }
  /** The sign-in changed: `ownerChanged` — another person or nobody; `signedOut` — nobody now. */
  | { readonly kind: 'session'; readonly ownerChanged: boolean; readonly signedOut: boolean }
  /** «Очистить локальные данные» (ST-110): what is finished goes; what holds a fan stays. Rejects — not cleared. */
  | { readonly kind: 'clear-finished' }
  /** A human send of a part the core registered (`op.reportSent`): the module's own records learn of it. */
  | { readonly kind: 'native-sent'; readonly attemptId: string; readonly view: OpView; readonly part: PartRef; readonly platformMessageId: string };

/** What a running module adds to the diagnostics (ids, states and counts, never a text). */
export interface HostModuleFacts {
  readonly sends?: { readonly open: number; readonly uncertain: number; readonly journal: readonly SendJournalEntry[] };
  readonly sendFuse?: SendFuseState;
}

export interface BackgroundHostHandle {
  /**
   * The site's slice of the feature manifest, where the core cannot carry it (R20 P7i; architecture.md §1.4): a site
   * whose slice is a file of its own — Fansly's — is not in the core's graph (`background-core-graph`), so its module
   * brings it, and the core admits the site's generations and insert tokens by it while the module runs. Absent — the
   * core holds the site's slice itself (ChatSpace's).
   */
  readonly features?: FeatureSlice;
  /** A request of the module's own types; the answer is checked by its schema on the way out. */
  onTabMessage(message: VerifiedTabMessage): Promise<HostAnswer>;
  onEvent(event: HostModuleEvent): Promise<void>;
  facts(): HostModuleFacts;
  dispose(): Promise<void>;
}

/** The default export of `bg/<site>.js`. `start` is idempotent: a second call answers the same handle. */
export interface BackgroundHostModule {
  readonly host: HostKind;
  start(kit: BackgroundKit): Promise<BackgroundHostHandle>;
}
