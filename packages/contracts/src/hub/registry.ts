// Which schema checks each route's request and success answer, by operation
// key. The facade parses raw answers of routes the vendored SDK does not know
// yet with these; the fake hub checks what it receives and serves. Error
// answers of every route are HubErrorBodySchema. `aiFeatureStream` answers
// with SSE: `response` checks each frame.

import type * as z from 'zod/mini';

import { HubFrameSchema, HubStreamRequestSchema, PersonaCatalogSchema } from './ai';
import { DeviceTokenIssueRequestSchema, DeviceTokenIssueResponseSchema, DeviceTokenRevokeResponseSchema, HubAuthStateSchema, HubHealthSchema } from './auth';
import { BootstrapSchema } from './bootstrap';
import { FeedPageSchema, FeedQuerySchema } from './feed';
import { AudienceNewPageSchema, AudienceNewQuerySchema, ClaimOpSchema, ClaimStateSchema } from './newcomers';
import {
  DossierQuerySchema,
  DossierSchema,
  ProfileFromGenerationRequestSchema,
  ProfileFromGenerationResponseSchema,
  RecapStatusQuerySchema,
  RecapStatusSchema,
  SharedRecapsQuerySchema,
  SharedRecapsSchema,
} from './recaps';
import { type HubRouteKey } from './routes';
import {
  AutoListsSchema,
  QueuePageSchema,
  QueueQuerySchema,
  SpenderBatchQuerySchema,
  SpenderBatchSchema,
  SpenderDetailQuerySchema,
  SpenderDetailSchema,
  SpendersPageSchema,
  SpendersQuerySchema,
  SpendersStatsSchema,
  StatsQuerySchema,
} from './spenders';
import { SendAttributionsRequestSchema, SendAttributionsResultSchema } from './attribution';
import { FanNoteAttributionsQuerySchema, FanNoteAttributionsSchema, NoteAttributionsRequestSchema, NoteAttributionsResultSchema } from './note-attribution';
import { ActivityBeatRequestSchema, ActivityBeatResultSchema, InConversationQuerySchema, InConversationResultSchema } from './conversation';
import { HandoffQuerySchema, HandoffSchema, WinBackAttemptRequestSchema, WinBackAttemptResultSchema, WinBackListSchema, WinBackQuerySchema } from './queue';
import { OnlineAttemptRequestSchema, OnlineAttemptResultSchema, OnlineListSchema, OnlinePresenceRequestSchema, OnlinePresenceResultSchema, OnlineProbeRequestSchema, OnlineProbeResultSchema, OnlineQuerySchema } from './online';
import { OnlyfansFeedRequestSchema, OnlyfansFeedResultSchema, OnlyfansPollRequestSchema, OnlyfansPollResultSchema } from './onlyfans-feed';
import { ServerTabStateRequestSchema, ServerTabStateResultSchema } from './server-tab';
import { FanCardQuerySchema, FanCardSchema, FanCustomChangeRequestSchema, FanCustomCreateRequestSchema, FanFactChangeRequestSchema, FanFactChangeResultSchema, FanLinkDecideRequestSchema, FanLinkDecideResultSchema } from './fan-card';
import { FanMarksQuerySchema, FanMarksSchema } from './fan-marks';
import { FanQueueItemDoneRequestSchema, FanQueueItemDoneSchema, FanQueueReleaseRequestSchema, FanQueueReleaseSchema, FanQueuesQuerySchema, FanQueuesSchema, FanQueueTakeRequestSchema, FanQueueTakeSchema } from './fan-queues';
import { AiLimitReportSchema, AiUsageQuerySchema, AiUsageReportSchema, IngestBatchSchema, IngestResultSchema } from './usage';
import { PageFanParamsSchema, PageParamsSchema } from './wire';
import { VoiceAllowanceQuerySchema, VoiceAllowanceSchema, VoiceNoteAudioBytesSchema, VoiceNoteCreateRequestSchema, VoiceNoteRefSchema, VoiceNoteViewSchema } from '../voice';

export interface HubRouteSchemas {
  /** Path params + query or body as the facade takes them; null = the route takes nothing. */
  readonly request: z.ZodMiniType | null;
  readonly response: z.ZodMiniType;
}

export const HUB_ROUTE_SCHEMAS = {
  authIssueDeviceTokenWithPassword: { request: DeviceTokenIssueRequestSchema, response: DeviceTokenIssueResponseSchema },
  authRevokeCurrentDeviceToken: { request: null, response: DeviceTokenRevokeResponseSchema },
  health: { request: null, response: HubHealthSchema },
  me: { request: null, response: HubAuthStateSchema },
  clientBootstrap: { request: null, response: BootstrapSchema },
  aiPersonaCatalog: { request: null, response: PersonaCatalogSchema },
  aiFeatureStream: { request: HubStreamRequestSchema, response: HubFrameSchema },
  aiRecapStatus: { request: RecapStatusQuerySchema, response: RecapStatusSchema },
  pageConversationProfile: { request: DossierQuerySchema, response: DossierSchema },
  pageFanProfile: { request: DossierQuerySchema, response: DossierSchema },
  spenders: { request: SpendersQuerySchema, response: SpendersPageSchema },
  spenderDetail: { request: SpenderDetailQuerySchema, response: SpenderDetailSchema },
  spenderBatch: { request: SpenderBatchQuerySchema, response: SpenderBatchSchema },
  pageSpenderAutoLists: { request: PageParamsSchema, response: AutoListsSchema },
  ingestObservations: { request: IngestBatchSchema, response: IngestResultSchema },
  clientConversationRecaps: { request: SharedRecapsQuerySchema, response: SharedRecapsSchema },
  clientFanProfileFromGeneration: { request: ProfileFromGenerationRequestSchema, response: ProfileFromGenerationResponseSchema },
  clientConversationFeed: { request: FeedQuerySchema, response: FeedPageSchema },
  clientSpenderStats: { request: StatsQuerySchema, response: SpendersStatsSchema },
  clientSpenderAwaitingReply: { request: QueueQuerySchema, response: QueuePageSchema },
  clientFanClaim: { request: ClaimOpSchema, response: ClaimStateSchema },
  clientFanClaimStatus: { request: PageFanParamsSchema, response: ClaimStateSchema },
  clientAudienceNew: { request: AudienceNewQuerySchema, response: AudienceNewPageSchema },
  clientAiUsageDaily: { request: AiUsageQuerySchema, response: AiUsageReportSchema },
  clientAiLimit: { request: null, response: AiLimitReportSchema },
  clientSendAttributions: { request: SendAttributionsRequestSchema, response: SendAttributionsResultSchema },
  clientNoteAttributions: { request: NoteAttributionsRequestSchema, response: NoteAttributionsResultSchema },
  clientFanNoteAttributions: { request: FanNoteAttributionsQuerySchema, response: FanNoteAttributionsSchema },
  clientActivity: { request: ActivityBeatRequestSchema, response: ActivityBeatResultSchema },
  clientInConversation: { request: InConversationQuerySchema, response: InConversationResultSchema },
  clientFanCard: { request: FanCardQuerySchema, response: FanCardSchema },
  clientFanLinkDecide: { request: FanLinkDecideRequestSchema, response: FanLinkDecideResultSchema },
  clientFanFactChange: { request: FanFactChangeRequestSchema, response: FanFactChangeResultSchema },
  clientFanMarks: { request: FanMarksQuerySchema, response: FanMarksSchema },
  clientWinBack: { request: WinBackQuerySchema, response: WinBackListSchema },
  clientWinBackAttempt: { request: WinBackAttemptRequestSchema, response: WinBackAttemptResultSchema },
  clientHandoff: { request: HandoffQuerySchema, response: HandoffSchema },
  clientOnline: { request: OnlineQuerySchema, response: OnlineListSchema },
  clientOnlinePresence: { request: OnlinePresenceRequestSchema, response: OnlinePresenceResultSchema },
  clientOnlineProbe: { request: OnlineProbeRequestSchema, response: OnlineProbeResultSchema },
  clientOnlyfansFeed: { request: OnlyfansFeedRequestSchema, response: OnlyfansFeedResultSchema },
  clientOnlyfansPoll: { request: OnlyfansPollRequestSchema, response: OnlyfansPollResultSchema },
  clientChatspaceTabState: { request: ServerTabStateRequestSchema, response: ServerTabStateResultSchema },
  clientOnlineAttempt: { request: OnlineAttemptRequestSchema, response: OnlineAttemptResultSchema },
  clientFanQueues: { request: FanQueuesQuerySchema, response: FanQueuesSchema },
  clientFanQueueTake: { request: FanQueueTakeRequestSchema, response: FanQueueTakeSchema },
  clientFanQueueItemDone: { request: FanQueueItemDoneRequestSchema, response: FanQueueItemDoneSchema },
  clientFanQueueRelease: { request: FanQueueReleaseRequestSchema, response: FanQueueReleaseSchema },
  clientFanCustomCreate: { request: FanCustomCreateRequestSchema, response: FanFactChangeResultSchema },
  clientFanCustomChange: { request: FanCustomChangeRequestSchema, response: FanFactChangeResultSchema },
  voiceNoteCreate: { request: VoiceNoteCreateRequestSchema, response: VoiceNoteViewSchema },
  voiceNoteStatus: { request: VoiceNoteRefSchema, response: VoiceNoteViewSchema },
  voiceNoteAudio: { request: VoiceNoteRefSchema, response: VoiceNoteAudioBytesSchema },
  voiceNoteAllowance: { request: VoiceAllowanceQuerySchema, response: VoiceAllowanceSchema },
} as const satisfies Record<HubRouteKey, HubRouteSchemas>;
