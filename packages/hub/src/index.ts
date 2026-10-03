// @cg/hub — the hub facade over the vendored @kernel/sdk (architecture.md §5.8,
// §8). Used ONLY by the background (§4): the token, the network and the SDK
// never reach a content script, a page or a lazy chunk.
//
// - ChatExtensionHub implements the frozen HubFacade (contracts hub/facade.ts)
//   plus what the background services need around it: sign-in custody with
//   epochs and events, bootstrap cache and binding, the persona catalog, the
//   AI stream with the prompt echo and the quota snapshot, the Spenders board.
// - Two transports: the vendored SDK for the operations it has, and the
//   RouteTransport (route-transport.ts) for the client/* routes of hub PRs
//   #414… until they are re-vendored.
// - DEV-ONLY compat mode for a hub without those routes: docs/hub-layer.md.

import { KERNEL_CONTRACT_HASH, KERNEL_SDK_VERSION } from '@kernel/sdk';

/** Contract hash of the vendored SDK — the release gate compares it with prod (§13, H-1). */
export const VENDORED_CONTRACT_HASH: string = KERNEL_CONTRACT_HASH;
export const VENDORED_SDK_VERSION: string = KERNEL_SDK_VERSION;

/** Production hub origin (D-13); a custom address needs an optional host permission (§3). */
export const DEFAULT_HUB_ORIGIN = 'https://gosling-agency.ru';

export {
  ChatExtensionHub,
  errorWireOf,
  stableEventId,
  type CheckResult,
  type ConnectionReport,
  type HubFacadeOptions,
  type HubState,
  type HubStatus,
  type IngestOutcome,
} from './facade';
export {
  SILENT_LOG,
  SYSTEM_CLOCK,
  type FetchLike,
  type HubClock,
  type HubEnvironment,
  type HubKeyValueStore,
  type HubLog,
  type HubLogFields,
  type HubLogLevel,
  type HubOs,
  type HubStorageFailureCode,
  type HubStorageResult,
  type UuidSource,
} from './ports';
export {
  AuthMetaSchema,
  END_REASONS,
  StoredAuthSchema,
  type AuthMeta,
  type AuthState,
  type EndReason,
  type LastEnd,
  type SessionChange,
  type SessionChangeReason,
  type StoredAuth,
  type TokenMeta,
  type Unsubscribe,
} from './auth';
export { type BootstrapEntry, type BootstrapSource } from './bootstrap';
export {
  COMPAT_LIMITS,
  belowMinVersion,
  bindingStillHolds,
  compareVersions,
  compatFlagAvailable,
  flagState,
  pageOf,
  protocolSupported,
  resolveBinding,
  synthesizeCompatBootstrap,
  type BindingResolution,
  type CompatPage,
  type FlagState,
} from './bootstrap-rules';
export { CATALOG_TTL_MS, type PersonaVerdict } from './catalog';
export { buildStreamRequest, type StreamRequestContext, type StreamRequestResult } from './ai-request';
export { SDK_STREAM_CAPABILITIES, sdkStreamTransport, type AiStreamOpen, type AiStreamTransport } from './ai-stream-transport';
export { STREAM_RETRY_DELAY_MS, type StreamNotice } from './stream';
export { featureOfHub, type EchoTicket } from './debug-echo';
export { BOARD_SESSION_KEY, mergePages, type BoardOptions, type BoardRequest } from './spenders-board';
export { CLIENT_ROUTE_KEYS, CLIENT_ROUTE_PATHS, clientWireRequest, isClientRoute, type ClientRouteKey, type WireRequest } from './route-transport';
export { SDK_ALLOWED_OPERATIONS, type SdkOperation } from './sdk-transport';
export { FacadeCallError, FacadeCheckError, failureDetail } from './errors';
export { CLIENT_NAME, CLIENT_VERSION_HEADER, REQUEST_TIMEOUT_MS, clientVersionHeaders, retryAfterMs } from './wire';
