// host-telegram/isolated — the isolated-world side of the Telegram host (docs/specs/2026-10-27-telegram-site.md §4,
// §6.5): its start, the active account, the open chat and its transcript, the field and the insert, the keys of our
// roots, the dock's place, the theme, the contract report. Imports only @cg/host-kit and @cg/contracts. Never receives
// the hub token, never touches the network; of the page's storage it reads only the active slot's session entry,
// through the entry point's port.

export { accountSlotOf, activeUserIdOf, userIdOf, type SessionRead } from './account';
export { TELEGRAM_ADAPTER_VERSION, buildTelegramReport } from './contract';
export { SERVICE_PEERS, TELEGRAM_SELECTORS, fieldText, peerOfHash, readChatDom } from './dom';
export { createTelegramHostPort, type TelegramDiagnostic, type TelegramPort, type TokenRedeemer } from './host-port';
export { createTelegramField, splitForRules, type InsertionRecord } from './insert';
export { createTelegramKeyboardProbe, isolateOurKeys, isTelegramComposer } from './keys';
export { createTelegramMounts, type TelegramMounts } from './mount';
export { createTelegramTheme, type TelegramTheme } from './theme';
export { NOT_NEWEST_LINE, NO_HISTORY, TRANSLATED_LINE, readTranscript, timeOf, type TranscriptRead } from './transcript';
export { routeOfLocation, startTelegramTab, type StartedTelegramTab, type TelegramStartEnv } from './start';
export { KEY_PENDING_ATTRIBUTE, createKeyPendingMark } from '@cg/host-kit/isolated/keyboard';
