// Shapes of the fake hub's scenario scripts (architecture.md §12, R02 serves
// them). A scenario is data: what the client sends, what the hub answers in
// order, and what the client must make of it. The fake hub replays the
// answers and fails on an unexpected request; the tests of this folder check
// every request and answer against the contracts' schemas and every
// expectation against the reference reading (reference.ts).

import {
  type CgCode,
  type HubErrorBody,
  type HubErrorContext,
  type HubErrorDisposition,
  type HubFrame,
  type HubRouteKey,
  type HubStreamRequest,
} from '@cg/contracts';

/** Hub paths of every operation the client calls (the fake hub routes by these; contracts carry none). */
export const HUB_ROUTE_PATHS = {
  authIssueDeviceTokenWithPassword: '/api/v1/auth/device-tokens/password',
  authRevokeCurrentDeviceToken: '/api/v1/auth/device-tokens/current',
  health: '/api/v1/health',
  me: '/api/v1/auth/me',
  clientBootstrap: '/api/v1/client/bootstrap',
  aiPersonaCatalog: '/api/v1/ai/persona-catalog',
  aiFeatureStream: '/api/v1/ai/features/:feature',
  aiRecapStatus: '/api/v1/ai/recap-status',
  pageConversationProfile: '/api/v1/pages/:pageLabel/conversations/:conversationId/profile',
  pageFanProfile: '/api/v1/pages/:pageLabel/fans/:platformUserId/profile',
  spenders: '/api/v2/spenders',
  spenderDetail: '/api/v2/spenders/:platform/:platformUserId',
  spenderBatch: '/api/v2/spenders:batch',
  pageSpenderAutoLists: '/api/v1/pages/:pageLabel/spender-autolists',
  ingestObservations: '/api/v1/ingest/observations',
  clientConversationRecaps: '/api/v1/client/pages/:pageLabel/conversations/:fanRef/recaps',
  clientFanProfileFromGeneration: '/api/v1/client/pages/:pageLabel/fans/:fanRef/profile/from-generation',
  clientConversationFeed: '/api/v1/client/pages/:pageLabel/conversations/:fanRef/feed',
  clientSpenderStats: '/api/v1/client/pages/:pageLabel/spenders/stats',
  clientSpenderAwaitingReply: '/api/v1/client/pages/:pageLabel/spenders/awaiting-reply',
  clientFanClaim: '/api/v1/client/pages/:pageLabel/fans/:fanRef/claim',
  clientFanClaimStatus: '/api/v1/client/pages/:pageLabel/fans/:fanRef/claim',
  clientAudienceNew: '/api/v1/client/pages/:pageLabel/audience-new',
  clientAiUsageDaily: '/api/v1/client/pages/:pageLabel/ai-usage',
  clientSendAttributions: '/api/v1/client/pages/:pageLabel/send-attributions',
  clientActivity: '/api/v1/client/activity',
  clientInConversation: '/api/v1/client/pages/:pageLabel/in-conversation',
  clientFanCard: '/api/v1/client/pages/:pageLabel/fans/:fanRef/card',
  clientFanLinkDecide: '/api/v1/client/pages/:pageLabel/fans/:fanRef/links',
  clientFanFactChange: '/api/v1/client/pages/:pageLabel/fans/:fanRef/facts/:factId',
  // 1.47.0: the voice-notes lane (`:id` is the note's integer id).
  voiceNoteCreate: '/api/v1/pages/:pageLabel/voice-notes',
  voiceNoteStatus: '/api/v1/pages/:pageLabel/voice-notes/:id',
  voiceNoteAudio: '/api/v1/pages/:pageLabel/voice-notes/:id/audio',
  // 1.49.0: the page's day allowance — a literal segment where the status route has `:id` (the router takes the literal).
  voiceNoteAllowance: '/api/v1/pages/:pageLabel/voice-notes/allowance',
} as const satisfies Record<HubRouteKey, string>;

/** What the client must make of an error answer (HubErrorResolution without the clock-dependent parts). */
export interface ErrorExpectation {
  readonly cg: CgCode | null;
  readonly disposition: HubErrorDisposition;
}

/** Facts of the call that some error rules read; the route comes from the exchange. */
export type ExchangeFacts = Partial<Omit<HubErrorContext, 'route' | 'now'>>;

export interface HttpExchange {
  readonly route: HubRouteKey;
  /** The facade-level request (path params + query or body): HUB_ROUTE_SCHEMAS[route].request. */
  readonly request: unknown;
  readonly response: {
    readonly status: number;
    /** 2xx: HUB_ROUTE_SCHEMAS[route].response; otherwise the hub error body. */
    readonly body: unknown;
    readonly retryAfterSec?: number;
  };
  /** Required on an error answer. */
  readonly expect?: ErrorExpectation;
  readonly facts?: ExchangeFacts;
  readonly note?: string;
}

export interface HttpScenario {
  readonly name: string;
  readonly description: string;
  /** Answered in this order. */
  readonly exchanges: readonly HttpExchange[];
}

export type SseStep =
  | { readonly kind: 'frame'; readonly frame: HubFrame; readonly afterMs?: number }
  /** `: keep-alive` comment line. */
  | { readonly kind: 'heartbeat' }
  /** The connection closes here. */
  | { readonly kind: 'eof' };

/** One POST of the AI stream: refused before the stream (HTTP error) or a 200 SSE body. */
export type SseResponse =
  | { readonly kind: 'http-error'; readonly status: number; readonly body: HubErrorBody }
  | { readonly kind: 'stream'; readonly steps: readonly SseStep[] };

export interface SseExpectation {
  readonly outcome: 'done' | 'failed';
  /** How many POSTs the client makes (2 only after the one transparent 503 retry). */
  readonly requests: number;
  readonly cg: CgCode | null;
  readonly disposition: HubErrorDisposition | null;
  /** Deadline, ms after the scenario clock (NOW_MS); null = none. */
  readonly retryAfterMs: number | null;
  /** done: the parsed result, variants × parts (one variant unless Hi). */
  readonly result: readonly (readonly string[])[] | null;
  /** The context_v1 frame's reader and fresh-text status, when the frame came. */
  readonly context: { readonly source: string; readonly live: string } | null;
}

export interface SseScenario {
  readonly name: string;
  readonly description: string;
  readonly request: HubStreamRequest;
  /** One per POST, in order. */
  readonly responses: readonly SseResponse[];
  readonly expect: SseExpectation;
}
