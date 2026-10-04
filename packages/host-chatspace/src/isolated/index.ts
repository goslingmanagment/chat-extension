// host-chatspace/isolated — the isolated-world side of the ChatSpace host
// (architecture.md §4, §6): bridge client, HostPort, contract check, mounting,
// guarded insertion, navigation. Imports only @cg/contracts (and may use
// @cg/core/domain/text). Never receives the hub token, never touches the
// network or page storage itself (the draft key comes through a port).

export { BridgeCallError, connectMainBridge, loadValidation, type BridgeEvent, type BridgeFailure, type BridgeStats, type MainBridgeClient } from './bridge-client';
export { buildContractReport, type ContractInput } from './contract';
export { readStoredDraft, storedDraftAgrees, tiptapText, type DraftStorage, type StoredDraft } from './draft-store';
export { aiGeneratedMark, bigramSimilarity } from './ai-mark';
export { ADAPTER_VERSION, createChatSpaceHostPort, HostContractError, type ChatSpaceHostOptions, type ChatSpaceHostPort, type ChatSpaceLiveConfig, type HostDiagnostic, type TokenRedeemer } from './host-port';
export { loadedScriptUrls, matchReceiptProfile, receiptModules } from './receipt-profile';
export {
  activeSlots,
  COMPOSER_SLOT_SELECTOR,
  createMountManager,
  findComposerMount,
  mountClosedHost,
  OVERLAY_Z,
  removeStaleHosts,
  waitForComposerMount,
  type ClosedHost,
  type MountDiagnostic,
  type MountManager,
  type MountManagerOptions,
  type OverlayLayer,
  type WaitForComposerOptions,
} from './mount';
export { CHAT_PATH_PATTERN, DELIVERED_KEY_MARK, KEY_PENDING_ATTRIBUTE, NATIVE_OVERLAY_SELECTOR, createKeyPendingMark, createKeyboardProbe, isTypingTarget, routeOfLocation, type KeyFocus, type KeyboardProbe } from './keyboard';
export { createShadowRootRegistry, type ShadowRootRegistry } from './shadow-registry';
export { startChatSpaceHost, type StartChatSpaceHostOptions, type StartedChatSpaceHost } from './start';
export { createThemeReader, readTheme, type ThemeReader } from './theme';
