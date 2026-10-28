// host-chatspace/isolated — the isolated-world side of the ChatSpace host
// (architecture.md §4, §6): HostPort, contract check, mounting, guarded
// insertion, navigation — over the shared mechanics of the page
// (@cg/host-kit/isolated: the bridge client, our closed hosts and their
// layers, the registry of their roots, keep-bottom, the key probe), whose
// names this entry keeps exporting for the code that starts the ChatSpace
// host. Imports only @cg/host-kit and @cg/contracts (and may use
// @cg/core/domain/text). Never receives the hub token, never touches the
// network or page storage itself (the draft key comes through a port).

export { BridgeCallError, type BridgeEvent, type BridgeFailure, type BridgeStats, type ChatSpaceBridge, type MainBridgeClient } from './bridge-client';
export { loadValidation, type Validation, type ValidationLoader } from './validation';
export { buildContractReport, type ContractInput } from './contract';
export { readStoredDraft, storedDraftAgrees, tiptapText, type DraftStorage, type StoredDraft } from './draft-store';
export { aiGeneratedMark, bigramSimilarity } from './ai-mark';
export { ADAPTER_VERSION, createChatSpaceHostPort, HostContractError, type ChatSpaceHeader, type ChatSpaceHostOptions, type ChatSpaceHostPort, type ChatSpaceLiveConfig, type HostDiagnostic, type TokenRedeemer } from './host-port';
export { createHeaderSlots, findHeaderPlace, type HeaderSlot, type HeaderSlots, type HeaderState } from './header-slot';
export { loadedScriptUrls, matchReceiptProfile, receiptModules, type ReceiptMatch } from './receipt-profile';
export { activeSlots, COMPOSER_SLOT_SELECTOR, createMountManager, findComposerMount, waitForComposerMount, type MountDiagnostic, type MountManager, type MountManagerOptions, type WaitForComposerOptions } from './mount';
export { HOST_ATTRIBUTE, LAYER_ATTRIBUTE, MODE_ATTRIBUTE, mountClosedHost, OVERLAY_Z, removeStaleHosts, type ClosedHost, type OverlayLayer } from '@cg/host-kit/isolated/hosts';
export { CHAT_PATH_PATTERN, NATIVE_OVERLAY_SELECTOR, createKeyboardProbe, routeOfLocation } from './keyboard';
export { DELIVERED_KEY_MARK, KEY_PENDING_ATTRIBUTE, createKeyPendingMark, isTypingTarget, type KeyFocus, type KeyboardProbe } from '@cg/host-kit/isolated/keyboard';
export { createShadowRootRegistry, type ShadowRootRegistry } from '@cg/host-kit/isolated/shadow-registry';
export { startChatSpaceHost, type StartChatSpaceHostOptions, type StartedChatSpaceHost } from './start';
export { startChatSpaceTab, type ChatSpaceStartEnv, type StartedChatSpaceTab } from './starter';
export { createThemeReader, readTheme, type ThemeReader } from './theme';
