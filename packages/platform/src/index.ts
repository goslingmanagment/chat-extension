// @cg/platform — the ONLY package that touches browser.* and IndexedDB
// (architecture.md §4, D-01; R07). Everything else gets these capabilities as
// ports from the composition roots. Every factory takes the browser API as a
// parameter that defaults to the real `browser`, so tests run on a fake.
//
// - storage: storage.local / storage.session with budgets and CG-STORAGE-* results
// - rpc-background / rpc-tab / rpc-page: the typed §5.4 protocol with sender checks
// - alarms, lifecycle (installed, browser start, suspend), permissions (hub
//   host access, technicalAndInteraction consent)
// - idb: a bounded IndexedDB store (logs, R18 owns the record format)
// - audio (event page), clipboard (on a gesture), scripting (MAIN WS tap),
//   env (browser major, OS), download (Blob from an extension page)
// - pages: open our options/debug pages in a tab, reusing the one open; bring a
//   ChatSpace tab to the front; open an https link of ours in a new tab

export { defaultBrowser, type BrowserApi, type MessageSenderApi, type PortApi } from './browser-api';
export { createExtensionPages, createLinkOpener, createTabFocus, type ExtensionPagesPort, type LinkOpenerPort, type OpenPageResult, type TabExtensionPage, type TabFocusPort } from './pages';
export { extensionUrl, extensionId, isExtensionContextAlive } from './runtime';
export { syncDynamicMainScript, mainScriptRegistration, type DynamicMainScriptSpec, type DynamicScriptSync } from './scripting';
export {
  createKeyValueStore,
  DEFAULT_STORAGE_CALL_TIMEOUT_MS,
  isQuotaError,
  jsonBytes,
  DEFAULT_MAX_WRITE_BYTES,
  type KeyValueStore,
  type KeyValueStoreOptions,
  type StorageAreaName,
  type StorageChange,
  type StorageFailureCode,
  type StorageResult,
} from './storage';
export {
  RECONNECT_DELAYS_MS,
  RPC_REJECT_REASONS,
  urlMatchesPattern,
  verifyPageSender,
  verifyRelaySender,
  verifyTabSender,
  type RelayPages,
  type RpcRejectReason,
  type RpcResult,
  type SenderVerdict,
  type TabHostKind,
  type TabHostMatches,
  type TabPayloadValidator,
} from './rpc-common';
export {
  createBackgroundRpc,
  DEFAULT_SITE_WAIT_MS,
  type BackgroundRpc,
  type BackgroundRpcOptions,
  type HandledRequestType,
  type PageSiteRoute,
  type RpcSenderContext,
  type SiteRpc,
  type SiteSenderContext,
  type TabRequestHandler,
  type TabSessionInfo,
} from './rpc-background';
export {
  createTabRpcClient,
  DEFAULT_REGISTER_TIMEOUT_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  type RpcConnectionState,
  type TabClientRequestType,
  type TabRpcClient,
  type TabRpcClientOptions,
} from './rpc-tab';
export { createPageRpcClient, DEFAULT_PAGE_REQUEST_TIMEOUT_MS, type PageEventsState, type PageRpcClient, type PageRpcClientOptions } from './rpc-page';
export { alarmCreateInfo, createAlarms, type AlarmSchedule, type AlarmsPort } from './alarms';
export { createLifecycle, INSTALL_REASONS, type InstalledDetails, type InstallReason, type LifecyclePort } from './lifecycle';
export {
  createConsent,
  createHostPermissions,
  originPermission,
  TECHNICAL_CONSENT,
  type ConsentPort,
  type HostPermissionsPort,
} from './permissions';
export {
  openBoundedStore,
  type BoundedRecord,
  type BoundedRecordInput,
  type BoundedStore,
  type BoundedStoreLimits,
  type BoundedStoreOptions,
  type BoundedStoreStats,
} from './idb';
export {
  AUDIO_RESUME_TIMEOUT_MS,
  createAudioPlayer,
  TONE_BOUNDS,
  type AudioContextLike,
  type AudioPlayer,
  type AudioPlayerOptions,
  type AudioPlayResult,
  type AudioStats,
  type ToneNote,
  type ToneSpec,
  type ToneWave,
} from './audio';
export { writeClipboardText, type ClipboardNavigator, type ClipboardResult } from './clipboard';
export { clientOsOf, extensionVersionOf, majorVersionOf, readClientEnv, type ClientEnv, type ClientOs } from './env';
export { downloadFile, safeFileName, DOWNLOAD_URL_TTL_MS, type DownloadDeps, type DownloadFile } from './download';
export { createPermissionBundle } from './permissions';
export { syncDynamicScripts, createScriptTabs, type DynamicScriptSpec } from './scripting';
export { observeWebRequests, type WebRequestFact } from './web-request';
