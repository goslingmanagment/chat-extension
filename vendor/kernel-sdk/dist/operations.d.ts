export declare const kernelOperations: {
    readonly accountShiftReport: {
        readonly method: "GET";
        readonly path: "/api/v1/account/shift-report";
    };
    readonly accountShiftReportConfirm: {
        readonly method: "POST";
        readonly path: "/api/v1/account/shift-report/confirm";
    };
    readonly accountShiftReportMark: {
        readonly method: "POST";
        readonly path: "/api/v1/account/shift-report/marks";
    };
    readonly adminAiAccountUpdate: {
        readonly method: "PATCH";
        readonly path: "/api/v1/admin/ai/accounts/:accountId";
    };
    readonly adminAiAccountsList: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/ai/accounts";
    };
    readonly adminAiChatterLimitUpdate: {
        readonly method: "PUT";
        readonly path: "/api/v1/admin/ai/chatter-limits/:userId";
    };
    readonly adminAiChatterLimits: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/ai/chatter-limits";
    };
    readonly adminAiPersonaArchive: {
        readonly method: "DELETE";
        readonly path: "/api/v1/admin/ai/personas/:key";
    };
    readonly adminAiPersonaCreate: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ai/personas";
    };
    readonly adminAiPersonaOpenerCreate: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ai/personas/:key/openers";
    };
    readonly adminAiPersonaOpenerUpdate: {
        readonly method: "PATCH";
        readonly path: "/api/v1/admin/ai/personas/:key/openers/:id";
    };
    readonly adminAiPersonaOpenersList: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/ai/personas/:key/openers";
    };
    readonly adminAiPersonaUpdate: {
        readonly method: "PUT";
        readonly path: "/api/v1/admin/ai/personas/:key";
    };
    readonly adminAiPersonasList: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/ai/personas";
    };
    readonly adminAiReconciliation: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/ai/reconciliation";
    };
    readonly adminAiReconciliationImport: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ai/reconciliation/import";
    };
    readonly adminAiReconciliationKeyUpdate: {
        readonly method: "PUT";
        readonly path: "/api/v1/admin/ai/reconciliation/keys";
    };
    readonly adminAiSpend: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/ai/spend";
    };
    readonly adminAssignPage: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/users/by-id/:userId/pages";
    };
    readonly adminChatterUsage: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/usage/chatters";
    };
    readonly adminClientHealth: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/client-health";
    };
    readonly adminConfig: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/config";
    };
    readonly adminConfigClear: {
        readonly method: "DELETE";
        readonly path: "/api/v1/admin/config/:key";
    };
    readonly adminConfigUpdate: {
        readonly method: "PATCH";
        readonly path: "/api/v1/admin/config";
    };
    readonly adminConnections: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/connections";
    };
    readonly adminCreateAccountLink: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/users/by-id/:userId/links";
    };
    readonly adminCreateInvite: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/invites";
    };
    readonly adminCreateModel: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/models";
    };
    readonly adminCreatePage: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/pages";
    };
    readonly adminDbStats: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/db/stats";
    };
    readonly adminDeactivateUser: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/users/by-id/:userId/deactivate";
    };
    readonly adminDeleteModel: {
        readonly method: "DELETE";
        readonly path: "/api/v1/admin/models/:modelSlug";
    };
    readonly adminDeletePage: {
        readonly method: "DELETE";
        readonly path: "/api/v1/admin/pages/:pageLabel";
    };
    readonly adminDeleteUser: {
        readonly method: "DELETE";
        readonly path: "/api/v1/admin/users/by-id/:userId";
    };
    readonly adminDeviceTokenAdoption: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/device-token-adoption";
    };
    readonly adminFollowersReconcileOverrideApply: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/sync/followers-reconcile/blast-radius/apply";
    };
    readonly adminFollowersReconcileOverridePreview: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/sync/followers-reconcile/blast-radius/preview";
    };
    readonly adminFollowersReconcileReset: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/sync/followers-reconcile/reset";
    };
    readonly adminIncidents: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/incidents";
    };
    readonly adminListAccountLinks: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/users/by-id/:userId/links";
    };
    readonly adminListDeviceTokens: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/users/by-id/:userId/device-tokens";
    };
    readonly adminListUsers: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/users";
    };
    readonly adminLogs: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/logs";
    };
    readonly adminModels: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/models";
    };
    readonly adminOfapiBindingRefresh: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/webhook/bindings";
    };
    readonly adminOfapiCaptureAttemptResolve: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/capture/attempts/:attemptId/resolve";
    };
    readonly adminOfapiCaptureControl: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/capture/controls";
    };
    readonly adminOfapiCaptureJobCancel: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/capture/jobs/:jobId/cancel";
    };
    readonly adminOfapiCaptureJobReplay: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/capture/jobs/:jobId/replay";
    };
    readonly adminOfapiCaptureJobsSeed: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/capture-jobs/seed";
    };
    readonly adminOfapiCaptureOperatorStatus: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/ofapi/capture/operator";
    };
    readonly adminOfapiCoverageRevoke: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/capture/coverage/:pageId/:chatId/revoke";
    };
    readonly adminOfapiCredentialPreflight: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/ofapi/webhook/preflight";
    };
    readonly adminOfapiCreditsDaily: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/ofapi/credits/daily";
    };
    readonly adminOfapiCreditsLedger: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/ofapi/credits/ledger";
    };
    readonly adminOfapiCreditsLedgerCsv: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/ofapi/credits/ledger.csv";
    };
    readonly adminOfapiCreditsSummary: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/ofapi/credits/summary";
    };
    readonly adminOfapiDmColdArchiveStatus: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/ofapi/dm-archive/status";
    };
    readonly adminOfapiExportArtifactCapture: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/export-quotes/:jobId/capture-artifact";
    };
    readonly adminOfapiExportCreateReconcile: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/export-quotes/:jobId/reconcile-create";
    };
    readonly adminOfapiExportPilotApprove: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/export-quotes/:jobId/approve-pilot";
    };
    readonly adminOfapiExportQuoteCancel: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/export-quotes/:jobId/cancel";
    };
    readonly adminOfapiExportQuoteStatus: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/ofapi/export-quotes/:jobId";
    };
    readonly adminOfapiExportQuotesCreate: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/export-quotes";
    };
    readonly adminOfapiSpendComparison: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/ofapi/spend/comparison";
    };
    readonly adminOfapiWebhookCollectionPolicy: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/ofapi/webhook/collection-policy";
    };
    readonly adminOfapiWebhookCollectionPolicyApply: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/webhook/collection-policy/apply";
    };
    readonly adminOfapiWebhookCollectionPolicySave: {
        readonly method: "PUT";
        readonly path: "/api/v1/admin/ofapi/webhook/collection-policy";
    };
    readonly adminOfapiWebhookDeliveries: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/ofapi/webhook/deliveries";
    };
    readonly adminOfapiWebhookDeliverySync: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/webhook/deliveries/sync";
    };
    readonly adminOfapiWebhookEventCatalog: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/ofapi/webhook/event-catalog";
    };
    readonly adminOfapiWebhookEventCatalogRefresh: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/webhook/event-catalog/refresh";
    };
    readonly adminOfapiWebhookReconcile: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/webhook/reconcile";
    };
    readonly adminOfapiWebhookRedeliver: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/webhook/deliveries/redeliver";
    };
    readonly adminOfapiWebhookRegister: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/webhook";
    };
    readonly adminOfapiWebhookReplay: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/webhook/replay";
    };
    readonly adminOfapiWebhookStatus: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/ofapi/webhook";
    };
    readonly adminPages: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/pages";
    };
    readonly adminPublicationApprove: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/publications/approve";
    };
    readonly adminPublicationCancel: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/publications/:id/cancel";
    };
    readonly adminPublicationCreate: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/publications";
    };
    readonly adminPublicationDeletePost: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/publications/:id/delete-post";
    };
    readonly adminPublicationFileGet: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/publications/files/:fileId";
    };
    readonly adminPublicationFileList: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/publications/files";
    };
    readonly adminPublicationFileUpload: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/publications/files";
    };
    readonly adminPublicationGet: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/publications/:id";
    };
    readonly adminPublicationList: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/publications";
    };
    readonly adminPublicationQueueList: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/publications/queue";
    };
    readonly adminPublicationQueueRefresh: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/publications/queue/refresh";
    };
    readonly adminPublicationReplace: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/publications/:id/replace";
    };
    readonly adminPublicationResolve: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/publications/:id/resolve";
    };
    readonly adminPublicationSettingsList: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/publications/settings";
    };
    readonly adminPublicationSettingsUpdate: {
        readonly method: "PUT";
        readonly path: "/api/v1/admin/publications/settings/:pageLabel";
    };
    readonly adminPublicationUpdate: {
        readonly method: "PUT";
        readonly path: "/api/v1/admin/publications/:id";
    };
    readonly adminPublicationWithdraw: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/publications/:id/withdraw";
    };
    readonly adminPublicationWithdrawPage: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/publications/withdraw-page";
    };
    readonly adminQueueJobs: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/queue/jobs";
    };
    readonly adminReactivateUser: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/users/by-id/:userId/reactivate";
    };
    readonly adminRevokeAccountLink: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/users/by-id/:userId/links/:linkId/revoke";
    };
    readonly adminRevokeDeviceToken: {
        readonly method: "DELETE";
        readonly path: "/api/v1/admin/users/by-id/:userId/device-tokens/:tokenId";
    };
    readonly adminRevokeDeviceTokens: {
        readonly method: "DELETE";
        readonly path: "/api/v1/admin/users/by-id/:userId/device-tokens";
    };
    readonly adminSetDeviceTokenHarvestCapability: {
        readonly method: "PATCH";
        readonly path: "/api/v1/admin/users/by-id/:userId/device-tokens/:tokenId/harvest-capability";
    };
    readonly adminSyncBlockPause: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/sync/blocks/pause";
    };
    readonly adminSyncBlockReset: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/sync/blocks/reset";
    };
    readonly adminSyncBlockResume: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/sync/blocks/resume";
    };
    readonly adminSyncBlockTrigger: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/sync/blocks/trigger";
    };
    readonly adminSyncRunDetail: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/sync/runs/:runId";
    };
    readonly adminSyncRuns: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/sync/runs";
    };
    readonly adminSyncTrigger: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/sync/trigger";
    };
    readonly adminSyncTriggerAll: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/sync/trigger-all";
    };
    readonly adminTerminateAllAccess: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/users/by-id/:userId/terminate-access";
    };
    readonly adminTestProxy: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/proxy/test";
    };
    readonly adminUnassignPage: {
        readonly method: "DELETE";
        readonly path: "/api/v1/admin/users/by-id/:userId/pages/:pageLabel";
    };
    readonly adminUpdateModel: {
        readonly method: "PATCH";
        readonly path: "/api/v1/admin/models/:modelSlug";
    };
    readonly adminUpdatePage: {
        readonly method: "PATCH";
        readonly path: "/api/v1/admin/pages/:pageLabel";
    };
    readonly adminVerifyCredentials: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/credentials/verify";
    };
    readonly adminVerifyPage: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/pages/:pageLabel/verify";
    };
    readonly adminVoiceAccount: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/ai/voice-account";
    };
    readonly agentCapabilities: {
        readonly method: "GET";
        readonly path: "/api/v1/agent/capabilities";
    };
    readonly agentCoverage: {
        readonly method: "GET";
        readonly path: "/api/v1/agent/coverage";
    };
    readonly agentCrossSpenders: {
        readonly method: "GET";
        readonly path: "/api/v1/agent/pages/:pageLabel/cross-spenders";
    };
    readonly agentDatasetQuery: {
        readonly method: "POST";
        readonly path: "/api/v1/agent/pages/:pageLabel/datasets/:dataset/query";
    };
    readonly agentFanQueueAppend: {
        readonly method: "POST";
        readonly path: "/api/v1/agent/fan-queues/:queueId/fans";
    };
    readonly agentFanQueueCreate: {
        readonly method: "POST";
        readonly path: "/api/v1/agent/pages/:pageLabel/fan-queues";
    };
    readonly agentFanQueueGet: {
        readonly method: "GET";
        readonly path: "/api/v1/agent/fan-queues/:queueId";
    };
    readonly agentFanQueueList: {
        readonly method: "GET";
        readonly path: "/api/v1/agent/fan-queues";
    };
    readonly agentFanQueuePreview: {
        readonly method: "POST";
        readonly path: "/api/v1/agent/pages/:pageLabel/fan-queues/preview";
    };
    readonly agentFanQueueUpdate: {
        readonly method: "PATCH";
        readonly path: "/api/v1/agent/fan-queues/:queueId";
    };
    readonly agentHistoryRequestCancel: {
        readonly method: "POST";
        readonly path: "/api/v1/agent/history-requests/:requestRef/cancel";
    };
    readonly agentHistoryRequestCreate: {
        readonly method: "POST";
        readonly path: "/api/v1/agent/pages/:pageLabel/history-requests";
    };
    readonly agentHistoryRequestGet: {
        readonly method: "GET";
        readonly path: "/api/v1/agent/history-requests/:requestRef";
    };
    readonly agentHistoryRequestList: {
        readonly method: "GET";
        readonly path: "/api/v1/agent/history-requests";
    };
    readonly agentHydrationRequestCreate: {
        readonly method: "POST";
        readonly path: "/api/v1/agent/pages/:pageLabel/threads/:conversationRef/hydration-requests";
    };
    readonly agentHydrationRequestDecide: {
        readonly method: "POST";
        readonly path: "/api/v1/agent/hydration-requests/:requestRef/decision";
    };
    readonly agentHydrationRequestGet: {
        readonly method: "GET";
        readonly path: "/api/v1/agent/hydration-requests/:requestRef";
    };
    readonly agentHydrationRequestList: {
        readonly method: "GET";
        readonly path: "/api/v1/agent/hydration-requests";
    };
    readonly agentKeyCreate: {
        readonly method: "POST";
        readonly path: "/api/v1/agent/keys";
    };
    readonly agentKeyList: {
        readonly method: "GET";
        readonly path: "/api/v1/agent/keys";
    };
    readonly agentKeyRevoke: {
        readonly method: "POST";
        readonly path: "/api/v1/agent/keys/:id/revoke";
    };
    readonly agentKeyUpdate: {
        readonly method: "PATCH";
        readonly path: "/api/v1/agent/keys/:id";
    };
    readonly agentObservationPayload: {
        readonly method: "GET";
        readonly path: "/api/v1/agent/observations/:observationRef/payload";
    };
    readonly agentObservations: {
        readonly method: "GET";
        readonly path: "/api/v1/agent/observations";
    };
    readonly agentPerson: {
        readonly method: "GET";
        readonly path: "/api/v1/agent/people/:platform/:platformUserId";
    };
    readonly agentPersonTimeline: {
        readonly method: "GET";
        readonly path: "/api/v1/agent/people/:platform/:platformUserId/timeline";
    };
    readonly agentPublicationApprove: {
        readonly method: "POST";
        readonly path: "/api/v1/agent/publications/approve";
    };
    readonly agentPublicationCancel: {
        readonly method: "POST";
        readonly path: "/api/v1/agent/publications/:id/cancel";
    };
    readonly agentPublicationChanges: {
        readonly method: "GET";
        readonly path: "/api/v1/agent/publications/changes";
    };
    readonly agentPublicationCreate: {
        readonly method: "POST";
        readonly path: "/api/v1/agent/pages/:pageLabel/publications";
    };
    readonly agentPublicationFileUpload: {
        readonly method: "POST";
        readonly path: "/api/v1/agent/pages/:pageLabel/publication-files";
    };
    readonly agentPublicationGet: {
        readonly method: "GET";
        readonly path: "/api/v1/agent/publications/:id";
    };
    readonly agentPublicationList: {
        readonly method: "GET";
        readonly path: "/api/v1/agent/pages/:pageLabel/publications";
    };
    readonly agentPublicationMedia: {
        readonly method: "GET";
        readonly path: "/api/v1/agent/pages/:pageLabel/publication-media";
    };
    readonly agentPublicationTargets: {
        readonly method: "GET";
        readonly path: "/api/v1/agent/pages/:pageLabel/publication-targets";
    };
    readonly agentPublicationUpdate: {
        readonly method: "PUT";
        readonly path: "/api/v1/agent/publications/:id";
    };
    readonly agentResolve: {
        readonly method: "POST";
        readonly path: "/api/v1/agent/resolve";
    };
    readonly agentSearchMessages: {
        readonly method: "POST";
        readonly path: "/api/v1/agent/search/messages";
    };
    readonly agentSyncStatus: {
        readonly method: "GET";
        readonly path: "/api/v1/agent/sync/pages";
    };
    readonly agentSyncWhy: {
        readonly method: "GET";
        readonly path: "/api/v1/agent/pages/:pageLabel/sync/work";
    };
    readonly agentThreadAvailability: {
        readonly method: "GET";
        readonly path: "/api/v1/agent/pages/:pageLabel/threads/:conversationRef/availability";
    };
    readonly agentThreadMessages: {
        readonly method: "GET";
        readonly path: "/api/v1/agent/pages/:pageLabel/threads/:conversationRef/messages";
    };
    readonly agentThreads: {
        readonly method: "GET";
        readonly path: "/api/v1/agent/threads";
    };
    readonly aiFeatureStream: {
        readonly method: "POST";
        readonly path: "/api/v1/ai/features/:feature";
    };
    readonly aiGatewayStream: {
        readonly method: "POST";
        readonly path: "/api/v1/ai/gateway/stream";
    };
    readonly aiPersonaArchive: {
        readonly method: "DELETE";
        readonly path: "/api/v1/ai/personas/:key";
    };
    readonly aiPersonaCatalog: {
        readonly method: "GET";
        readonly path: "/api/v1/ai/persona-catalog";
    };
    readonly aiPersonaUpsert: {
        readonly method: "PUT";
        readonly path: "/api/v1/ai/personas/:key";
    };
    readonly aiPersonasList: {
        readonly method: "GET";
        readonly path: "/api/v1/ai/personas";
    };
    readonly aiRecapStatus: {
        readonly method: "GET";
        readonly path: "/api/v1/ai/recap-status";
    };
    readonly aiRestrictedGenerationDetail: {
        readonly method: "GET";
        readonly path: "/api/v1/ai/restricted/generations/:generationRef";
    };
    readonly aiRestrictedGenerations: {
        readonly method: "GET";
        readonly path: "/api/v1/ai/restricted/generations";
    };
    readonly aiUsageBatch: {
        readonly method: "POST";
        readonly path: "/api/v1/ai-usage/batch";
    };
    readonly archiveConversationMessages: {
        readonly method: "GET";
        readonly path: "/api/v1/archive/conversations/:ref/messages";
    };
    readonly archiveSearch: {
        readonly method: "GET";
        readonly path: "/api/v1/archive/search";
    };
    readonly authActivateDeviceToken: {
        readonly method: "POST";
        readonly path: "/api/v1/auth/device-tokens/activate";
    };
    readonly authChangePassword: {
        readonly method: "POST";
        readonly path: "/api/v1/auth/change-password";
    };
    readonly authInspectAccountLink: {
        readonly method: "POST";
        readonly path: "/api/v1/auth/links/inspect";
    };
    readonly authIssueDeviceTokenWithPassword: {
        readonly method: "POST";
        readonly path: "/api/v1/auth/device-tokens/password";
    };
    readonly authListDevices: {
        readonly method: "GET";
        readonly path: "/api/v1/auth/devices";
    };
    readonly authMyUsage: {
        readonly method: "GET";
        readonly path: "/api/v1/auth/usage";
    };
    readonly authRedeemAccountLink: {
        readonly method: "POST";
        readonly path: "/api/v1/auth/links/redeem";
    };
    readonly authRevokeAllDevices: {
        readonly method: "POST";
        readonly path: "/api/v1/auth/devices/revoke-all";
    };
    readonly authRevokeCurrentDeviceToken: {
        readonly method: "DELETE";
        readonly path: "/api/v1/auth/device-tokens/current";
    };
    readonly authRevokeDevice: {
        readonly method: "DELETE";
        readonly path: "/api/v1/auth/devices/:deviceId";
    };
    readonly cancelOfapiCommand: {
        readonly method: "POST";
        readonly path: "/api/v1/ofapi/commands/:commandId/cancel";
    };
    readonly clientActivity: {
        readonly method: "POST";
        readonly path: "/api/v1/client/activity";
    };
    readonly clientAiLimit: {
        readonly method: "GET";
        readonly path: "/api/v1/client/ai/limit";
    };
    readonly clientAiUsageDaily: {
        readonly method: "GET";
        readonly path: "/api/v1/client/pages/:pageLabel/ai-usage";
    };
    readonly clientAudienceNew: {
        readonly method: "GET";
        readonly path: "/api/v1/client/pages/:pageLabel/audience-new";
    };
    readonly clientBootstrap: {
        readonly method: "GET";
        readonly path: "/api/v1/client/bootstrap";
    };
    readonly clientConversationFeed: {
        readonly method: "GET";
        readonly path: "/api/v1/client/pages/:pageLabel/conversations/:fanRef/feed";
    };
    readonly clientConversationRecaps: {
        readonly method: "GET";
        readonly path: "/api/v1/client/pages/:pageLabel/conversations/:fanRef/recaps";
    };
    readonly clientFanCard: {
        readonly method: "GET";
        readonly path: "/api/v1/client/pages/:pageLabel/fans/:fanRef/card";
    };
    readonly clientFanClaim: {
        readonly method: "POST";
        readonly path: "/api/v1/client/pages/:pageLabel/fans/:fanRef/claim";
    };
    readonly clientFanClaimStatus: {
        readonly method: "GET";
        readonly path: "/api/v1/client/pages/:pageLabel/fans/:fanRef/claim";
    };
    readonly clientFanCustomChange: {
        readonly method: "POST";
        readonly path: "/api/v1/client/pages/:pageLabel/fans/:fanRef/customs/:customId";
    };
    readonly clientFanCustomCreate: {
        readonly method: "POST";
        readonly path: "/api/v1/client/pages/:pageLabel/fans/:fanRef/customs";
    };
    readonly clientFanFactChange: {
        readonly method: "POST";
        readonly path: "/api/v1/client/pages/:pageLabel/fans/:fanRef/facts/:factId";
    };
    readonly clientFanLinkDecide: {
        readonly method: "POST";
        readonly path: "/api/v1/client/pages/:pageLabel/fans/:fanRef/links";
    };
    readonly clientFanMarks: {
        readonly method: "GET";
        readonly path: "/api/v1/client/pages/:pageLabel/fans/:fanRef/marks";
    };
    readonly clientFanNoteAttributions: {
        readonly method: "GET";
        readonly path: "/api/v1/client/pages/:pageLabel/fans/:fanRef/note-attributions";
    };
    readonly clientFanProfileFromGeneration: {
        readonly method: "POST";
        readonly path: "/api/v1/client/pages/:pageLabel/fans/:fanRef/profile/from-generation";
    };
    readonly clientFanQueueItemDone: {
        readonly method: "POST";
        readonly path: "/api/v1/client/pages/:pageLabel/fan-queues/items/:itemId/done";
    };
    readonly clientFanQueueRelease: {
        readonly method: "POST";
        readonly path: "/api/v1/client/pages/:pageLabel/fan-queues/:queueId/release";
    };
    readonly clientFanQueueTake: {
        readonly method: "POST";
        readonly path: "/api/v1/client/pages/:pageLabel/fan-queues/:queueId/take";
    };
    readonly clientFanQueues: {
        readonly method: "GET";
        readonly path: "/api/v1/client/pages/:pageLabel/fan-queues";
    };
    readonly clientHandoff: {
        readonly method: "GET";
        readonly path: "/api/v1/client/pages/:pageLabel/handoff";
    };
    readonly clientInConversation: {
        readonly method: "GET";
        readonly path: "/api/v1/client/pages/:pageLabel/in-conversation";
    };
    readonly clientNoteAttributions: {
        readonly method: "POST";
        readonly path: "/api/v1/client/pages/:pageLabel/note-attributions";
    };
    readonly clientOnline: {
        readonly method: "GET";
        readonly path: "/api/v1/client/pages/:pageLabel/online";
    };
    readonly clientOnlineAttempt: {
        readonly method: "POST";
        readonly path: "/api/v1/client/pages/:pageLabel/online/attempts";
    };
    readonly clientOnlinePresence: {
        readonly method: "POST";
        readonly path: "/api/v1/client/pages/:pageLabel/online/presence";
    };
    readonly clientOnlineProbe: {
        readonly method: "POST";
        readonly path: "/api/v1/client/pages/:pageLabel/online/probe";
    };
    readonly clientSendAttributions: {
        readonly method: "POST";
        readonly path: "/api/v1/client/pages/:pageLabel/send-attributions";
    };
    readonly clientSendCustodyList: {
        readonly method: "GET";
        readonly path: "/api/v1/client-send-custody";
    };
    readonly clientSendCustodyResolve: {
        readonly method: "POST";
        readonly path: "/api/v1/pages/:pageLabel/client-send-custody/:attemptId/resolve";
    };
    readonly clientSpenderAwaitingReply: {
        readonly method: "GET";
        readonly path: "/api/v1/client/pages/:pageLabel/spenders/awaiting-reply";
    };
    readonly clientSpenderStats: {
        readonly method: "GET";
        readonly path: "/api/v1/client/pages/:pageLabel/spenders/stats";
    };
    readonly clientWinBack: {
        readonly method: "GET";
        readonly path: "/api/v1/client/pages/:pageLabel/win-back";
    };
    readonly clientWinBackAttempt: {
        readonly method: "POST";
        readonly path: "/api/v1/client/pages/:pageLabel/win-back/attempts";
    };
    readonly contentComments: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/content/comments";
    };
    readonly contentMedia: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/content/media";
    };
    readonly createFanNote: {
        readonly method: "POST";
        readonly path: "/api/v1/pages/:pageLabel/fans/:platformUserId/notes";
    };
    readonly createOfapiCommand: {
        readonly method: "POST";
        readonly path: "/api/v1/ofapi/commands";
    };
    readonly creatorStatsAudience: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/stats/creator/audience";
    };
    readonly creatorStatsContent: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/stats/creator/content";
    };
    readonly creatorStatsMedia: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/stats/creator/media/:mediaOfferId";
    };
    readonly creatorStatsOverview: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/stats/creator";
    };
    readonly crossPageFanDetail: {
        readonly method: "GET";
        readonly path: "/api/v1/fans/:platform/:platformUserId";
    };
    readonly crossPageFanTransactions: {
        readonly method: "GET";
        readonly path: "/api/v1/fans/:platform/:platformUserId/transactions";
    };
    readonly crossPageTransactions: {
        readonly method: "GET";
        readonly path: "/api/v1/transactions";
    };
    readonly eventsSnapshot: {
        readonly method: "GET";
        readonly path: "/api/v1/events/snapshot";
    };
    readonly eventsStream: {
        readonly method: "GET";
        readonly path: "/api/v1/events/stream";
    };
    readonly eventsV2Facts: {
        readonly method: "GET";
        readonly path: "/api/v1/events/v2/facts";
    };
    readonly eventsV2Snapshot: {
        readonly method: "GET";
        readonly path: "/api/v1/events/v2/snapshot";
    };
    readonly eventsV2Stream: {
        readonly method: "GET";
        readonly path: "/api/v1/events/v2/stream";
    };
    readonly fansSearch: {
        readonly method: "GET";
        readonly path: "/api/v2/fans/search";
    };
    readonly followerOutreachAttempt: {
        readonly method: "POST";
        readonly path: "/api/v1/pages/:pageLabel/follower-outreach/attempt";
    };
    readonly getOfapiCommand: {
        readonly method: "GET";
        readonly path: "/api/v1/ofapi/commands/:commandId";
    };
    readonly health: {
        readonly method: "GET";
        readonly path: "/api/v1/health";
    };
    readonly healthSync: {
        readonly method: "GET";
        readonly path: "/api/v1/health/sync";
    };
    readonly ingestObservations: {
        readonly method: "POST";
        readonly path: "/api/v1/ingest/observations";
    };
    readonly login: {
        readonly method: "POST";
        readonly path: "/api/v1/auth/login";
    };
    readonly logout: {
        readonly method: "POST";
        readonly path: "/api/v1/auth/logout";
    };
    readonly me: {
        readonly method: "GET";
        readonly path: "/api/v1/auth/me";
    };
    readonly modelRevenue: {
        readonly method: "GET";
        readonly path: "/api/v1/models/:modelSlug/revenue";
    };
    readonly modelRevenueDaily: {
        readonly method: "GET";
        readonly path: "/api/v1/models/:modelSlug/revenue/daily";
    };
    readonly models: {
        readonly method: "GET";
        readonly path: "/api/v1/models";
    };
    readonly moneyPayouts: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/money/payouts";
    };
    readonly moneyRevenueMix: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/money/revenue-mix";
    };
    readonly notificationsDiscoverChats: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/notifications/discover-chats";
    };
    readonly notificationsIncidents: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/notifications/incidents";
    };
    readonly notificationsReportHistory: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/notifications/reports/history";
    };
    readonly notificationsReportPreview: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/notifications/reports/preview";
    };
    readonly notificationsReportSend: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/notifications/reports/send";
    };
    readonly notificationsResolveIncident: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/notifications/incidents/:incidentId/resolve";
    };
    readonly notificationsSettings: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/notifications/settings";
    };
    readonly notificationsSettingsUpdate: {
        readonly method: "PATCH";
        readonly path: "/api/v1/admin/notifications/settings";
    };
    readonly notificationsTestMessage: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/notifications/test";
    };
    readonly ofLinksChannelsGet: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/of-links/channels";
    };
    readonly ofLinksGet: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/of-links";
    };
    readonly ofLinksHistoryGet: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/of-links/history";
    };
    readonly ofapiActionCancel: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/actions/:id/cancel";
    };
    readonly ofapiActionDispatch: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/actions/:id/dispatch";
    };
    readonly ofapiActionGet: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/ofapi/actions/:id";
    };
    readonly ofapiActionList: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/ofapi/actions";
    };
    readonly ofapiActionPrepare: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/actions";
    };
    readonly ofapiActionRepair: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/actions/:id/repair";
    };
    readonly ofapiBannedWordsAdminGet: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/ofapi/banned-words";
    };
    readonly ofapiBannedWordsGet: {
        readonly method: "GET";
        readonly path: "/api/v1/ofapi/banned-words";
    };
    readonly ofapiBannedWordsPreview: {
        readonly method: "POST";
        readonly path: "/api/v1/ofapi/banned-words/preview";
    };
    readonly ofapiBannedWordsRefresh: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/banned-words/refresh";
    };
    readonly ofapiCollectionApply: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/collection/apply";
    };
    readonly ofapiCollectionGet: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/ofapi/collection";
    };
    readonly ofapiCollectionJobCreate: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/collection/jobs";
    };
    readonly ofapiCollectionJobFinishIncomplete: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/collection/jobs/:id/finish-incomplete";
    };
    readonly ofapiCollectionJobResume: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/collection/jobs/:id/resume";
    };
    readonly ofapiCollectionPreview: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/collection/preview";
    };
    readonly ofapiContentEventsGet: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/ofapi/content/events";
    };
    readonly ofapiCreditsChatterSummary: {
        readonly method: "GET";
        readonly path: "/api/v1/ofapi/credits/summary";
    };
    readonly ofapiExportInventoryGet: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/ofapi/export-inventory";
    };
    readonly ofapiExportInventoryRefresh: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/export-inventory/refresh";
    };
    readonly ofapiKeyScopeApply: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/key-scope";
    };
    readonly ofapiKeyScopeGet: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/ofapi/key-scope";
    };
    readonly ofapiMarketingDispatch: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/marketing/intents/:id/dispatch";
    };
    readonly ofapiMarketingGet: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/ofapi/marketing";
    };
    readonly ofapiMarketingPostbacksRefresh: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/marketing/postbacks/refresh";
    };
    readonly ofapiMarketingPrepare: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/marketing/intents";
    };
    readonly ofapiMarketingRebuild: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/marketing/rebuild";
    };
    readonly ofapiMediaGet: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/ofapi/media";
    };
    readonly ofapiMediaHandoff: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/media/handoff";
    };
    readonly ofapiMediaReports: {
        readonly method: "POST";
        readonly path: "/api/v1/ofapi/media/reports";
    };
    readonly ofapiMediaResolve: {
        readonly method: "POST";
        readonly path: "/api/v1/ofapi/media/resolve";
    };
    readonly ofapiMediaSourceCreate: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/media/sources";
    };
    readonly ofapiMediaUploadCreate: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/media/uploads";
    };
    readonly ofapiMediaUploadResume: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/media/uploads/:jobId/resume";
    };
    readonly ofapiProfileVisitorsGet: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/ofapi/profile-visitors";
    };
    readonly ofapiReadCollectionsGet: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/ofapi/collection/results";
    };
    readonly ofapiReadGateway: {
        readonly method: "GET";
        readonly path: "/api/v1/ofapi/read/*";
    };
    readonly ofapiTypedExportApprove: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/exports/:jobId/approve";
    };
    readonly ofapiTypedExportArtifact: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/exports/:jobId/artifact";
    };
    readonly ofapiTypedExportControl: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/exports/:jobId/control";
    };
    readonly ofapiTypedExportCreate: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/exports";
    };
    readonly ofapiTypedExportList: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/ofapi/exports";
    };
    readonly ofapiTypedExportResume: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/exports/:jobId/resume";
    };
    readonly ofapiTypedExportRows: {
        readonly method: "GET";
        readonly path: "/api/v1/admin/ofapi/exports/:jobId/rows";
    };
    readonly ofapiVendorUsageRefresh: {
        readonly method: "POST";
        readonly path: "/api/v1/admin/ofapi/vendor-usage";
    };
    readonly ofapiWebhookReceive: {
        readonly method: "POST";
        readonly path: "/api/v1/ofapi/webhook";
    };
    readonly openApiJson: {
        readonly method: "GET";
        readonly path: "/api/v1/openapi.json";
    };
    readonly opsLive: {
        readonly method: "GET";
        readonly path: "/api/v1/ops/live";
    };
    readonly opsMetrics: {
        readonly method: "GET";
        readonly path: "/api/v1/ops/metrics";
    };
    readonly overview: {
        readonly method: "GET";
        readonly path: "/api/v1/overview";
    };
    readonly overviewGrowth: {
        readonly method: "GET";
        readonly path: "/api/v1/overview/growth";
    };
    readonly overviewRevenue: {
        readonly method: "GET";
        readonly path: "/api/v1/overview/revenue";
    };
    readonly overviewRevenueByModel: {
        readonly method: "GET";
        readonly path: "/api/v1/overview/revenue/by-model";
    };
    readonly overviewRevenueDaily: {
        readonly method: "GET";
        readonly path: "/api/v1/overview/revenue/daily";
    };
    readonly pageBrowserDraftDelete: {
        readonly method: "DELETE";
        readonly path: "/api/v1/page-browser/drafts/:name";
    };
    readonly pageBrowserDraftSave: {
        readonly method: "PUT";
        readonly path: "/api/v1/page-browser/drafts/:name";
    };
    readonly pageBrowserDrafts: {
        readonly method: "GET";
        readonly path: "/api/v1/page-browser/drafts";
    };
    readonly pageBrowserLoginCode: {
        readonly method: "POST";
        readonly path: "/api/v1/page-browser/pages/:pageLabel/login/code";
    };
    readonly pageBrowserLoginFinish: {
        readonly method: "POST";
        readonly path: "/api/v1/page-browser/pages/:pageLabel/login/finish";
    };
    readonly pageBrowserLoginGet: {
        readonly method: "GET";
        readonly path: "/api/v1/page-browser/pages/:pageLabel/login";
    };
    readonly pageBrowserLoginOpen: {
        readonly method: "POST";
        readonly path: "/api/v1/page-browser/pages/:pageLabel/login/open";
    };
    readonly pageBrowserLoginScreenshot: {
        readonly method: "GET";
        readonly path: "/api/v1/page-browser/pages/:pageLabel/login/screenshot";
    };
    readonly pageBrowserLoginStart: {
        readonly method: "POST";
        readonly path: "/api/v1/page-browser/pages/:pageLabel/login/start";
    };
    readonly pageBrowserLoginSubmit: {
        readonly method: "POST";
        readonly path: "/api/v1/page-browser/pages/:pageLabel/login/submit";
    };
    readonly pageBrowserProfileClose: {
        readonly method: "POST";
        readonly path: "/api/v1/page-browser/profiles/:profileId/close";
    };
    readonly pageBrowserProfileGet: {
        readonly method: "GET";
        readonly path: "/api/v1/page-browser/profiles/:profileId";
    };
    readonly pageBrowserProfileLoginCode: {
        readonly method: "POST";
        readonly path: "/api/v1/page-browser/profiles/:profileId/login/code";
    };
    readonly pageBrowserProfileLoginFinish: {
        readonly method: "POST";
        readonly path: "/api/v1/page-browser/profiles/:profileId/login/finish";
    };
    readonly pageBrowserProfileLoginOpen: {
        readonly method: "POST";
        readonly path: "/api/v1/page-browser/profiles/:profileId/login/open";
    };
    readonly pageBrowserProfileLoginScreenshot: {
        readonly method: "GET";
        readonly path: "/api/v1/page-browser/profiles/:profileId/login/screenshot";
    };
    readonly pageBrowserProfileLoginStart: {
        readonly method: "POST";
        readonly path: "/api/v1/page-browser/profiles/:profileId/login/start";
    };
    readonly pageBrowserProfileLoginSubmit: {
        readonly method: "POST";
        readonly path: "/api/v1/page-browser/profiles/:profileId/login/submit";
    };
    readonly pageBrowserProfilePin: {
        readonly method: "POST";
        readonly path: "/api/v1/page-browser/profiles/:profileId/pin";
    };
    readonly pageBrowserProfileProxy: {
        readonly method: "POST";
        readonly path: "/api/v1/page-browser/profiles/:profileId/proxy";
    };
    readonly pageBrowserProfileScreen: {
        readonly method: "GET";
        readonly path: "/api/v1/page-browser/profiles/:profileId/screen/*";
    };
    readonly pageBrowserProfiles: {
        readonly method: "GET";
        readonly path: "/api/v1/page-browser/profiles";
    };
    readonly pageBrowserProxyCheck: {
        readonly method: "POST";
        readonly path: "/api/v1/page-browser/proxy-check";
    };
    readonly pageBrowserScreen: {
        readonly method: "GET";
        readonly path: "/api/v1/page-browser/pages/:pageLabel/screen/*";
    };
    readonly pageConversationMessages: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/conversations/:conversationId/messages";
    };
    readonly pageConversationPreview: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/conversations/:platformConversationId/preview";
    };
    readonly pageConversationProfile: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/conversations/:conversationId/profile";
    };
    readonly pageDeletedFans: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/deleted-fans";
    };
    readonly pageFanDetail: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/fans/:platformUserId";
    };
    readonly pageFanProfile: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/fans/:platformUserId/profile";
    };
    readonly pageFanProfileVersion: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/fans/:platformUserId/profile/versions/:version";
    };
    readonly pageFanProfileVersions: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/fans/:platformUserId/profile/versions";
    };
    readonly pageFanTransactions: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/fans/:platformUserId/transactions";
    };
    readonly pageFans: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/fans";
    };
    readonly pageFollowers: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/followers";
    };
    readonly pageFollowersDaily: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/followers/daily";
    };
    readonly pageMassMessages: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/mass-messages";
    };
    readonly pageMessagesBlock: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/sync/blocks/messages";
    };
    readonly pageProfile: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/profile";
    };
    readonly pagePromo: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/promo";
    };
    readonly pageRevenue: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/revenue";
    };
    readonly pageRevenueDaily: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/revenue/daily";
    };
    readonly pageSettings: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/settings";
    };
    readonly pageSpenderAutoListDetail: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/spender-autolists/:bucketKey";
    };
    readonly pageSpenderAutoLists: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/spender-autolists";
    };
    readonly pageSubscribers: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/subscribers";
    };
    readonly pageSubscribersDaily: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/subscribers/daily";
    };
    readonly pageSyncBlocks: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/sync/blocks";
    };
    readonly pageTopSpenders: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/top-spenders";
    };
    readonly pageTransactions: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/transactions";
    };
    readonly pages: {
        readonly method: "GET";
        readonly path: "/api/v1/pages";
    };
    readonly setFanFlags: {
        readonly method: "PATCH";
        readonly path: "/api/v1/fans/:platform/:platformUserId/flags";
    };
    readonly spenderBatch: {
        readonly method: "POST";
        readonly path: "/api/v2/spenders:batch";
    };
    readonly spenderDetail: {
        readonly method: "GET";
        readonly path: "/api/v2/spenders/:platform/:platformUserId";
    };
    readonly spenderSeries: {
        readonly method: "GET";
        readonly path: "/api/v2/spenders/:platform/:platformUserId/series";
    };
    readonly spenders: {
        readonly method: "GET";
        readonly path: "/api/v2/spenders";
    };
    readonly statsCoverage: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/stats/coverage";
    };
    readonly statsMedia: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/stats/media";
    };
    readonly statsTags: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/stats/tags";
    };
    readonly statsTraffic: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/stats/traffic";
    };
    readonly syncHistoryRequestCancel: {
        readonly method: "POST";
        readonly path: "/api/v1/sync/history-requests/:requestRef/cancel";
    };
    readonly syncHistoryRequestCreate: {
        readonly method: "POST";
        readonly path: "/api/v1/sync/pages/:pageLabel/history-requests";
    };
    readonly syncHistoryRequestGet: {
        readonly method: "GET";
        readonly path: "/api/v1/sync/history-requests/:requestRef";
    };
    readonly syncHistoryRequests: {
        readonly method: "GET";
        readonly path: "/api/v1/sync/history-requests";
    };
    readonly syncOverview: {
        readonly method: "GET";
        readonly path: "/api/v1/sync/overview";
    };
    readonly syncPageRefresh: {
        readonly method: "POST";
        readonly path: "/api/v1/sync/pages/:pageLabel/refresh";
    };
    readonly syncPageWork: {
        readonly method: "GET";
        readonly path: "/api/v1/sync/pages/:pageLabel/work";
    };
    readonly syncPageWorkGet: {
        readonly method: "GET";
        readonly path: "/api/v1/sync/pages/:pageLabel/work/:workId";
    };
    readonly syncPages: {
        readonly method: "GET";
        readonly path: "/api/v1/sync/pages";
    };
    readonly syncRequests: {
        readonly method: "GET";
        readonly path: "/api/v1/sync/requests";
    };
    readonly syncStatus: {
        readonly method: "GET";
        readonly path: "/api/v1/sync/status";
    };
    readonly teamAuthorship: {
        readonly method: "GET";
        readonly path: "/api/v1/team/authorship";
    };
    readonly teamChatterNumbers: {
        readonly method: "GET";
        readonly path: "/api/v1/team/chatter-numbers";
    };
    readonly teamCustoms: {
        readonly method: "GET";
        readonly path: "/api/v1/team/customs";
    };
    readonly teamEmptyHours: {
        readonly method: "GET";
        readonly path: "/api/v1/team/empty-hours";
    };
    readonly teamGreetings: {
        readonly method: "GET";
        readonly path: "/api/v1/team/greetings";
    };
    readonly teamSalesPpv: {
        readonly method: "GET";
        readonly path: "/api/v1/team/sales/ppv";
    };
    readonly teamSalesReplies: {
        readonly method: "GET";
        readonly path: "/api/v1/team/sales/replies";
    };
    readonly teamShiftDisputes: {
        readonly method: "GET";
        readonly path: "/api/v1/team/shift-reports/disputes";
    };
    readonly teamShiftExport: {
        readonly method: "GET";
        readonly path: "/api/v1/team/shift-reports/export";
    };
    readonly teamShiftResolve: {
        readonly method: "POST";
        readonly path: "/api/v1/team/shift-reports/disputes/:saleRef";
    };
    readonly teamShifts: {
        readonly method: "GET";
        readonly path: "/api/v1/team/shifts";
    };
    readonly teamWinBackApproachSave: {
        readonly method: "POST";
        readonly path: "/api/v1/team/win-back/approaches";
    };
    readonly teamWinBackApproaches: {
        readonly method: "GET";
        readonly path: "/api/v1/team/win-back/approaches";
    };
    readonly teamWinBackResults: {
        readonly method: "GET";
        readonly path: "/api/v1/team/win-back/results";
    };
    readonly upsertFanProfile: {
        readonly method: "PUT";
        readonly path: "/api/v1/pages/:pageLabel/fans/:platformUserId/profile";
    };
    readonly voiceNoteAllowance: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/voice-notes/allowance";
    };
    readonly voiceNoteAudio: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/voice-notes/:id/audio";
    };
    readonly voiceNoteCreate: {
        readonly method: "POST";
        readonly path: "/api/v1/pages/:pageLabel/voice-notes";
    };
    readonly voiceNoteStatus: {
        readonly method: "GET";
        readonly path: "/api/v1/pages/:pageLabel/voice-notes/:id";
    };
};
