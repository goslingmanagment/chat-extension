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
  clientBootstrap: { method: 'GET', routeClass: 'account', since: 'H-2a', flag: null, capabilities: [], narrowToken: true },
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
  clientConversationRecaps: { method: 'GET', routeClass: 'page', since: 'H-13', flag: 'recap', capabilities: ['shared-recaps-v1'], narrowToken: true },
  clientFanProfileFromGeneration: {
    method: 'POST',
    routeClass: 'recap-profile',
    since: 'H-5',
    flag: 'recap',
    capabilities: ['recap-profile-v1'],
    narrowToken: true,
  },
  clientConversationFeed: { method: 'GET', routeClass: 'page', since: 'H-9c', flag: 'preview', capabilities: ['archive-feed-v1'], narrowToken: true },
  clientSpenderStats: { method: 'GET', routeClass: 'page', since: 'H-8b', flag: 'stats', capabilities: ['spenders-stats-v1'], narrowToken: true },
  clientSpenderAwaitingReply: { method: 'GET', routeClass: 'page', since: 'H-8c', flag: 'stats', capabilities: ['awaiting-reply-v1'], narrowToken: true },
  /** Flag by action: `newcomers` for claim/renew/dispatch(greeting), `previewSend` for any dispatch; status and registerNativeSend need none. */
  clientFanClaim: { method: 'POST', routeClass: 'claim', since: 'H-7b', flag: null, capabilities: ['preview-send-custody-v1'], narrowToken: true },
  clientFanClaimStatus: { method: 'GET', routeClass: 'claim', since: 'H-7b', flag: null, capabilities: ['preview-send-custody-v1'], narrowToken: true },
  clientAudienceNew: { method: 'GET', routeClass: 'page', since: 'H-7c', flag: 'newcomers', capabilities: ['audience-new-v1'], narrowToken: true },
  clientAiUsageDaily: { method: 'GET', routeClass: 'page', since: 'H-15', flag: null, capabilities: ['ai-usage-v1'], narrowToken: true },
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
 * §4.12: what each owner flag needs from the hub. A flag is usable on a page
 * only when the flag is on, the page's feature is `available`, and every
 * capability below is declared. `serverChecked: false` — a client-only switch
 * (the hub has no action to refuse); turning it off is not API protection.
 * Fresh text also needs `context-v1`: the hub refuses `liveTextContext`
 * without that request header (400 `capability_required`).
 */
export const CLIENT_FLAG_REQUIREMENTS = {
  insertion: { capabilities: [], serverChecked: false },
  navigation: { capabilities: [], serverChecked: false },
  wsTap: { capabilities: [], serverChecked: false },
  sound: { capabilities: [], serverChecked: false },
  fanPanel: { capabilities: [], serverChecked: false },
  previewSendMarkAiGenerated: { capabilities: [], serverChecked: false },
  spenders: { capabilities: [], serverChecked: false },
  freshText: { capabilities: ['context-v1', 'live-text-v1'], serverChecked: true },
  splitAll: { capabilities: ['split-all-v1'], serverChecked: true },
  recap: { capabilities: ['shared-recaps-v1', 'recap-profile-v1'], serverChecked: true },
  review: { capabilities: [], serverChecked: true },
  coach: { capabilities: [], serverChecked: true },
  preview: { capabilities: ['archive-feed-v1'], serverChecked: true },
  stats: { capabilities: ['spenders-stats-v1', 'awaiting-reply-v1'], serverChecked: true },
  newcomers: { capabilities: ['audience-new-v1', 'preview-send-custody-v1'], serverChecked: true },
  previewSend: { capabilities: ['preview-send-custody-v1'], serverChecked: true },
} as const satisfies Record<ClientFeatureFlag, { readonly capabilities: readonly ClientHubCapability[]; readonly serverChecked: boolean }>;
