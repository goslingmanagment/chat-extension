// The hub operations this client calls (architecture.md §8.1, §8.6; hub
// hub-pr-plan.md §4.9, §4.10.4, §4.12), as data: operation key, method, the
// error-routing class, the hub change that brings it, the owner flag and the
// bootstrap capabilities it needs. Paths are deliberately absent (wire.ts
// header): the background's hub package and the fake hub map keys to paths.

import { type ClientFeatureFlag, type ClientHubCapability } from './wire';

/**
 * How an error of a route is read (Appendix A §3 rules that depend on the
 * route): sign-in turns 401/429 into LOGIN codes, a page route's 404 can mean
 * «not granted», `conflict` on a claim route is CG-CLAIM-BUSY.
 */
export const HUB_ROUTE_CLASSES = ['sign-in', 'sign-out', 'account', 'ai-stream', 'page', 'claim', 'recap-profile', 'ingest'] as const;
export type HubRouteClass = (typeof HUB_ROUTE_CLASSES)[number];

export interface HubRouteSpec {
  readonly method: 'GET' | 'POST' | 'DELETE';
  readonly routeClass: HubRouteClass;
  /** `sdk` = already in the vendored SDK; otherwise the hub change that adds it (§8.6). */
  readonly since: 'sdk' | 'H-2a' | 'H-5' | 'H-7b' | 'H-7c' | 'H-8b' | 'H-8c' | 'H-9c' | 'H-13' | 'H-15';
  /** The owner switch the hub checks on this route (§4.12); null = none or client-only. */
  readonly flag: ClientFeatureFlag | null;
  /** Bootstrap capabilities that must be declared before the client calls it. */
  readonly capabilities: readonly ClientHubCapability[];
  /** In the narrow token's allow-list (H-3); public routes need no principal. */
  readonly narrowToken: boolean;
}

export const HUB_ROUTES = {
  authIssueDeviceTokenWithPassword: { method: 'POST', routeClass: 'sign-in', since: 'sdk', flag: null, capabilities: [], narrowToken: false },
  authRevokeCurrentDeviceToken: { method: 'DELETE', routeClass: 'sign-out', since: 'sdk', flag: null, capabilities: [], narrowToken: true },
  health: { method: 'GET', routeClass: 'account', since: 'sdk', flag: null, capabilities: [], narrowToken: false },
  me: { method: 'GET', routeClass: 'account', since: 'sdk', flag: null, capabilities: [], narrowToken: true },
  clientBootstrap: { method: 'GET', routeClass: 'account', since: 'sdk', flag: null, capabilities: [], narrowToken: true },
  aiPersonaCatalog: { method: 'GET', routeClass: 'account', since: 'sdk', flag: null, capabilities: [], narrowToken: true },
  /** Per-feature flags (coach/recap/review) are checked by the hub for the narrow token. */
  aiFeatureStream: { method: 'POST', routeClass: 'ai-stream', since: 'sdk', flag: null, capabilities: [], narrowToken: true },
  aiRecapStatus: { method: 'GET', routeClass: 'page', since: 'sdk', flag: null, capabilities: [], narrowToken: true },
  pageConversationProfile: { method: 'GET', routeClass: 'page', since: 'sdk', flag: null, capabilities: [], narrowToken: true },
  pageFanProfile: { method: 'GET', routeClass: 'page', since: 'sdk', flag: null, capabilities: [], narrowToken: true },
  spenders: { method: 'GET', routeClass: 'page', since: 'sdk', flag: null, capabilities: [], narrowToken: true },
  spenderDetail: { method: 'GET', routeClass: 'page', since: 'sdk', flag: null, capabilities: [], narrowToken: true },
  spenderBatch: { method: 'POST', routeClass: 'page', since: 'sdk', flag: null, capabilities: [], narrowToken: true },
  pageSpenderAutoLists: { method: 'GET', routeClass: 'page', since: 'sdk', flag: null, capabilities: [], narrowToken: true },
  ingestObservations: { method: 'POST', routeClass: 'ingest', since: 'sdk', flag: null, capabilities: [], narrowToken: true },
  clientConversationRecaps: { method: 'GET', routeClass: 'page', since: 'sdk', flag: 'recap', capabilities: ['shared-recaps-v1'], narrowToken: true },
  clientFanProfileFromGeneration: {
    method: 'POST',
    routeClass: 'recap-profile',
    since: 'sdk',
    flag: 'recap',
    capabilities: ['recap-profile-v1'],
    narrowToken: true,
  },
  clientConversationFeed: { method: 'GET', routeClass: 'page', since: 'sdk', flag: 'preview', capabilities: ['archive-feed-v1'], narrowToken: true },
  clientSpenderStats: { method: 'GET', routeClass: 'page', since: 'sdk', flag: 'stats', capabilities: ['spenders-stats-v1'], narrowToken: true },
  clientSpenderAwaitingReply: { method: 'GET', routeClass: 'page', since: 'sdk', flag: 'stats', capabilities: ['awaiting-reply-v1'], narrowToken: true },
  /** Flag by action: `newcomers` for claim/renew/dispatch(greeting), `previewSend` for any dispatch; status and registerNativeSend need none. */
  clientFanClaim: { method: 'POST', routeClass: 'claim', since: 'sdk', flag: null, capabilities: ['preview-send-custody-v1'], narrowToken: true },
  clientFanClaimStatus: { method: 'GET', routeClass: 'claim', since: 'sdk', flag: null, capabilities: ['preview-send-custody-v1'], narrowToken: true },
  clientAudienceNew: { method: 'GET', routeClass: 'page', since: 'sdk', flag: 'newcomers', capabilities: ['audience-new-v1'], narrowToken: true },
  clientAiUsageDaily: { method: 'GET', routeClass: 'page', since: 'sdk', flag: null, capabilities: ['ai-usage-v1'], narrowToken: true },
  /** The person's own daily AI limit (the owner's, Moscow day, all pages); no page, no owner switch. */
  clientAiLimit: { method: 'GET', routeClass: 'account', since: 'sdk', flag: null, capabilities: ['ai-limit-v1'], narrowToken: true },
  /** 1.21.0 (X48): who sent each outgoing message. No owner switch: the hub takes a send that happened on the page grant alone. */
  clientSendAttributions: { method: 'POST', routeClass: 'page', since: 'sdk', flag: null, capabilities: ['send-attribution-v1'], narrowToken: true },
  /** Who wrote each Fansly note: a confirmed write of our panel. No owner switch: the page grant alone. */
  clientNoteAttributions: { method: 'POST', routeClass: 'page', since: 'sdk', flag: null, capabilities: ['note-attribution-v1'], narrowToken: true },
  /** 2026-10-29: who created a fan's notes and who changed them last, as the hub recorded our writes. No owner switch. */
  clientFanNoteAttributions: { method: 'GET', routeClass: 'page', since: 'sdk', flag: null, capabilities: ['note-attribution-read-v1'], narrowToken: true },
  /** Chat Memory week 1: the beat — the pages open and the person's idle on each; no page in the path, the hub skips a page not theirs. */
  clientActivity: { method: 'POST', routeClass: 'account', since: 'sdk', flag: null, capabilities: ['chatter-activity-v1'], narrowToken: true },
  /** Chat Memory week 1: «в разговоре» — who wrote to which fan of the page in the last 15 minutes. No owner switch. */
  clientInConversation: { method: 'GET', routeClass: 'page', since: 'sdk', flag: null, capabilities: ['in-conversation-v1'], narrowToken: true },
  /** Chat Memory week 2: the fan's card, «Да / Нет» of a suggested account, a fact deleted or corrected. No owner switch. */
  clientFanCard: { method: 'GET', routeClass: 'page', since: 'sdk', flag: null, capabilities: ['fan-card-v1'], narrowToken: true },
  clientFanLinkDecide: { method: 'POST', routeClass: 'page', since: 'sdk', flag: null, capabilities: ['fan-card-v1'], narrowToken: true },
  clientFanFactChange: { method: 'POST', routeClass: 'page', since: 'sdk', flag: null, capabilities: ['fan-card-v1'], narrowToken: true },
  /** The fan's warning marks: the agency's «💩 Бомж» lists on any of its Fansly pages, FANSLY BLOCKLIST's posts. No owner switch. */
  clientFanMarks: { method: 'GET', routeClass: 'page', since: 'sdk', flag: null, capabilities: ['fan-marks-v1'], narrowToken: true },
  /** Chat Memory week 3: «Очередь» — the win-back list, a chatter's approach pick, the shift handoff. No owner switch. */
  clientWinBack: { method: 'GET', routeClass: 'page', since: 'sdk', flag: null, capabilities: ['win-back-v1'], narrowToken: true },
  clientWinBackAttempt: { method: 'POST', routeClass: 'page', since: 'sdk', flag: null, capabilities: ['win-back-v1'], narrowToken: true },
  /** «Онлайн»: the page's fans seen online, why to write now and with what (hub #879). */
  clientOnline: { method: 'GET', routeClass: 'page', since: 'sdk', flag: null, capabilities: ['online-v1'], narrowToken: true },
  /** A tab's report of the fans it saw online (Fansly's followers active lately, ChatSpace's online fans): their presence on the hub. */
  clientOnlinePresence: { method: 'POST', routeClass: 'page', since: 'sdk', flag: null, capabilities: ['online-v1'], narrowToken: true },
  /** The page's probe of who of its known spenders is online, lent to one tab of the team at a time (OnlyFans; hub #952). */
  clientOnlineProbe: { method: 'POST', routeClass: 'page', since: 'sdk', flag: 'onlineProbe', capabilities: ['online-v1'], narrowToken: true },
  /**
   * 2026-11-01 (hub #953): what the page's ChatSpace already received, passed on — the hub's OnlyFans feed once
   * OnlyFansAPI is gone. Behind the page's `ofFeed`; a report the hub may not have heard is said again (the hub dedups).
   */
  clientOnlyfansFeed: { method: 'POST', routeClass: 'page', since: 'sdk', flag: 'ofFeed', capabilities: ['onlyfans-feed-v1'], narrowToken: true },
  /** 2026-11-01 (hub #955): the page's poll of ChatSpace (new subscribers, the sales ledger), lent to one tab of the team. */
  clientOnlyfansPoll: { method: 'POST', routeClass: 'page', since: 'sdk', flag: 'ofPoll', capabilities: ['onlyfans-poll-v1'], narrowToken: true },
  /** The always-on ChatSpace tab's report: its view, the socket's coverage of each account. Kept for the server's user alone. */
  clientChatspaceTabState: { method: 'POST', routeClass: 'account', since: 'sdk', flag: null, capabilities: ['chatspace-tab-state-v1'], narrowToken: true },
  /** A message sent from «Онлайн», «Не предлагать» and its undo: journaled, shared by the team. */
  clientOnlineAttempt: { method: 'POST', routeClass: 'page', since: 'sdk', flag: null, capabilities: ['online-v1'], narrowToken: true },
  /** «Очереди»: the caller's fan queues of a page — progress today, the goal, who answered a message from a queue. No owner switch. */
  clientFanQueues: { method: 'GET', routeClass: 'page', since: 'sdk', flag: null, capabilities: ['fan-queues-v1'], narrowToken: true },
  /** A portion of up to 10 fans, each re-checked by the hub; a 30-minute lease renewed by each take. Nothing is sent. */
  clientFanQueueTake: { method: 'POST', routeClass: 'page', since: 'sdk', flag: null, capabilities: ['fan-queues-v1'], narrowToken: true },
  /** A fan of the portion sent (with what) or skipped (why): journaled, once, never repeated. */
  clientFanQueueItemDone: { method: 'POST', routeClass: 'page', since: 'sdk', flag: null, capabilities: ['fan-queues-v1'], narrowToken: true },
  /** The window closed: the caller's untouched portion goes back to the queue. */
  clientFanQueueRelease: { method: 'POST', routeClass: 'page', since: 'sdk', flag: null, capabilities: ['fan-queues-v1'], narrowToken: true },
  clientHandoff: { method: 'GET', routeClass: 'page', since: 'sdk', flag: null, capabilities: ['handoff-v1'], narrowToken: true },
  /** Chat Memory week 4: a custom written into the fan's card, and its paid / delivered / cancel / edit. No owner switch. */
  clientFanCustomCreate: { method: 'POST', routeClass: 'page', since: 'sdk', flag: null, capabilities: ['fan-customs-v1'], narrowToken: true },
  clientFanCustomChange: { method: 'POST', routeClass: 'page', since: 'sdk', flag: null, capabilities: ['fan-customs-v1'], narrowToken: true },
  /**
   * 1.47.0: the voice notes (the hub's voice-notes lane, HF-4б), on both sites: the paid create (idempotent per
   * `clientRequestId`, never repeated by itself), its status, its MP3 (`fetchVoiceNoteAudio` of the SDK, raw bytes).
   */
  voiceNoteCreate: { method: 'POST', routeClass: 'page', since: 'sdk', flag: 'voice', capabilities: ['voice-notes-v1'], narrowToken: true },
  voiceNoteStatus: { method: 'GET', routeClass: 'page', since: 'sdk', flag: 'voice', capabilities: ['voice-notes-v1'], narrowToken: true },
  voiceNoteAudio: { method: 'GET', routeClass: 'page', since: 'sdk', flag: 'voice', capabilities: ['voice-notes-v1'], narrowToken: true },
  /** 1.49.0: what the page may still voice today — a free read for the studio's line beside «Озвучить». */
  voiceNoteAllowance: { method: 'GET', routeClass: 'page', since: 'sdk', flag: 'voice', capabilities: ['voice-notes-v1'], narrowToken: true },
} as const satisfies Record<string, HubRouteSpec>;

export type HubRouteKey = keyof typeof HUB_ROUTES;
export const HUB_ROUTE_KEYS = Object.keys(HUB_ROUTES) as HubRouteKey[];

/** Never called by this client (§8.1 «Никогда»): owner/session routes, the raw gateway, events, OFAPI, full personas. */
export const HUB_FORBIDDEN_OPERATIONS = [
  'aiGatewayStream',
  'aiPersonasList',
  'aiPersonaUpsert',
  'aiPersonaArchive',
  'eventsStream',
  'eventsSnapshot',
  'eventsV2Stream',
  'eventsV2Snapshot',
  'eventsV2Facts',
  'followerOutreachAttempt',
  'pageTopSpenders',
  'clientSendCustodyResolve',
  'clientSendCustodyList',
] as const;

/**
 * What this client's OWN transport needs of the hub for a switch, on top of the hub's decision about the page
 * (1.15.0, R20 F4). The hub has already weighed the platform and what it serves into `pages[].features[flag]`
 * (its `CLIENT_FEATURE_REQUIREMENTS`), and the client does not repeat that table: a switch of a page is read from
 * the page's own feature alone (core `domain/ops/flags.ts`). What is left is one need of the client's own calls:
 * fresh text travels as `liveTextContext`, which the hub refuses without the `context-v1` request header (400
 * `capability_required`). The feature manifest names it as `clientNeeds` of `fresh-text` (features/<site>.ts), and
 * `admission` checks it there. A route's own capabilities are `HUB_ROUTES[route].capabilities`: the hub layer
 * never calls a route the bootstrap did not declare.
 *
 * 1.15.0 (R20 P4b3; architecture §11.1): Fansly's switches add nothing here. What the hub needs to offer them —
 * `voice-notes-v1` and its voice lane for `voice`, `manual-greeting-v1` for `newcomers` on a Fansly page — is the
 * hub's table, already in the page's feature (`hub_not_ready`, `lane_off`). What one of this client's calls needs
 * beyond its route is said where the call is made: the voice-note routes name `voice` and `voice-notes-v1` in
 * `HUB_ROUTES` when the hub layer calls them; a claim with the manual group asks `manual-greeting-v1` of the
 * bootstrap as a need of that request (the hub layer's `needs`), because an AI group needs nothing new.
 */
export const CLIENT_FLAG_REQUIREMENTS = {
  freshText: ['context-v1'],
} as const satisfies Readonly<Partial<Record<ClientFeatureFlag, readonly ClientHubCapability[]>>>;
