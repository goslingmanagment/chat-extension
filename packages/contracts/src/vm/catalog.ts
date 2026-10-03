// ActionCatalog (architecture.md §10.2 п. 6, §9.1): the exact keys, labels and
// reasons of unavailability the UI shows. Keys come from the vendored
// @chatgoose/hotkeys scheme through the early dispatcher, labelled for the
// OS; the UI never binds a global key itself and never shows a combination
// the browser keeps for itself as working.

import { type CgCode, type I18nKey } from '../errors';
import { type Msg } from './i18n';

/** Platform the labels are written for (⌘ on macOS, Ctrl/Alt elsewhere, UI-006). */
export const HOTKEY_PLATFORMS = ['mac', 'win'] as const;
export type HotkeyPlatform = (typeof HOTKEY_PLATFORMS)[number];

/**
 * Whether the browser hands the combination to the page (R17 measures it on
 * winpc and the Mac): `reserved` is never shown as working; `unverified` is
 * shown with its fallback until measured.
 */
export const HOTKEY_DELIVERY = ['delivered', 'cancelable', 'reserved', 'unverified'] as const;
export type HotkeyDelivery = (typeof HOTKEY_DELIVERY)[number];

export interface HotkeyLabel {
  /** What the button and the cheatsheet print: «⌘E», «Ctrl+E», «⌘⇧S», «Ctrl+Alt+S», «↵», «Esc». */
  readonly display: string;
  /** `aria-keyshortcuts` value: «Meta+E», «Control+E». */
  readonly aria: string;
  readonly delivery: HotkeyDelivery;
  /** The fallback when the browser keeps the main one (Alt+U for ⌘U, Alt+1–9 for ⌘1–9). */
  readonly fallback: Omit<HotkeyLabel, 'fallback'> | null;
}

/** Where a key works (§9.1 «Политика»). */
export const HOTKEY_SCOPES = ['chat', 'global', 'preview', 'result', 'list', 'dialog'] as const;
export type HotkeyScope = (typeof HOTKEY_SCOPES)[number];

/** Everything the catalog names: the seven AI actions and every other command of §9.1. */
export const CATALOG_ACTION_IDS = [
  'reply',
  'fix',
  'hi',
  'ping',
  'review',
  'recap',
  'coach',
  'cancel',
  /** ⌘⇧H: Help is removed (Б3); the key is swallowed in a chat with «пока убран». */
  'help',
  'tone',
  'split',
  'spenders',
  'newcomers',
  'palette',
  'cheatsheet',
  'settings',
  'close',
  'part-step',
  'variant-step',
  'insert-part',
  'copy-part',
  'open-and-insert',
  /** «Отправить» has no key by design (§6.7.4 п. 1); the entry exists to label the button. */
  'send',
  'chat-next',
  'chat-previous',
  'fan-panel',
  'next-unread',
  'quick-jump',
  'search',
] as const;
export type CatalogActionId = (typeof CATALOG_ACTION_IDS)[number];

export interface ActionCatalogEntry {
  readonly id: CatalogActionId;
  readonly label: I18nKey;
  /** Description in the tooltip when `ui.hints` is on; the reason of unavailability shows always. */
  readonly tooltip: I18nKey | null;
  readonly hotkey: HotkeyLabel | null;
  readonly scope: HotkeyScope;
  /** `removed`: still caught in a chat, answered with a reason (⌘⇧H, Б3). */
  readonly status: 'active' | 'removed';
}

/**
 * Why a button or a key does nothing right now. The UI shows the text in the
 * tooltip («Reply недоступен: …») and the dispatcher toasts it for a key in a
 * chat (HK-026); a disabled button is never a toast by itself (§9.5).
 */
export const UNAVAILABLE_REASONS = {
  'chat-loading': { key: 'dock.reason.chatLoading', code: 'CG-GATE-CHAT-LOADING' },
  'not-signed-in': { key: 'dock.reason.notSignedIn', code: 'CG-AUTH-REQUIRED' },
  'no-binding': { key: 'dock.reason.noBinding', code: 'CG-BINDING-MISSING' },
  'not-granted': { key: 'dock.reason.notGranted', code: 'CG-BINDING-NOT-GRANTED' },
  'no-persona': { key: 'dock.reason.noPersona', code: 'CG-PERSONA-UNASSIGNED' },
  'hub-down': { key: 'dock.reason.hubDown', code: 'CG-HUB-UNAVAILABLE' },
  'reload-needed': { key: 'dock.reason.reloadNeeded', code: 'CG-RUNTIME-RELOADED' },
  'quota-zero': { key: 'dock.reason.quotaZero', code: 'CG-QUOTA-DAILY' },
  'feature-disabled': { key: 'dock.reason.featureDisabled', code: 'CG-FEATURE-DISABLED' },
  /** Another generation of this chat runs: only its own button works (UI-008). */
  'generation-running': { key: 'dock.reason.generationRunning', code: null },
  'chat-busy': { key: 'dock.reason.chatBusy', code: 'CG-OP-CHAT-BUSY' },
  'coach-busy': { key: 'dock.reason.coachBusy', code: 'CG-OP-COACH-BUSY' },
  'needs-draft': { key: 'dock.reason.needsDraft', code: 'CG-GATE-DRAFT' },
  'no-history': { key: 'dock.reason.noHistory', code: 'CG-GATE-HISTORY' },
  'hi-gate': { key: 'dock.reason.hiGate', code: 'CG-GATE-HI' },
  'ping-gate': { key: 'dock.reason.pingGate', code: 'CG-GATE-PING' },
  'language': { key: 'dock.reason.language', code: 'CG-GATE-LANGUAGE' },
  'fan-blocked': { key: 'dock.reason.fanBlocked', code: 'CG-GATE-FAN-BLOCKED' },
  'fan-unknown': { key: 'dock.reason.fanUnknown', code: 'CG-GATE-FAN-UNKNOWN' },
  'overlay-open': { key: 'dock.reason.overlayOpen', code: 'CG-GATE-OVERLAY' },
  'host-degraded': { key: 'dock.reason.hostDegraded', code: 'CG-HOST-CONTRACT' },
  'composer-missing': { key: 'dock.reason.composerMissing', code: 'CG-HOST-COMPOSER-MISSING' },
  'claim-busy': { key: 'dock.reason.claimedBy', code: 'CG-CLAIM-BUSY' },
  'claim-expired': { key: 'dock.reason.claimExpired', code: 'CG-CLAIM-EXPIRED' },
  /** Tone and Split are frozen while a generation runs (AI-009). */
  'locked-during-generation': { key: 'dock.reason.lockedDuringGeneration', code: null },
  /** Split for Recap and Review: «это не сообщение фану». */
  'not-a-message': { key: 'dock.option.splitNotMessage', code: null },
  /** «Ещё раз» in a preview while parts are being sent. */
  'parts-sending': { key: 'result.againBlocked', code: null },
  /** «Заменить мой черновик» without a verified editor (`fix.canReplace = false`, §6.4). */
  'draft-unverifiable': { key: 'fix.cannotCheck', code: null },
  'help-removed': { key: 'dock.helpRemoved', code: null },
  /** The browser keeps the combination (§9.1 «Риск зарезервированных сочетаний»). */
  'hotkey-reserved': { key: 'dock.reason.hotkeyReserved', code: null },
  /** «Повторить» before the fixed retry deadline (ER-007). */
  'wait-until': { key: 'cg.retryIn', code: null },
  'send-unavailable': { key: 'send.unavailable', code: null },
} as const satisfies Record<string, { readonly key: I18nKey; readonly code: CgCode | null }>;

export type UnavailableReasonId = keyof typeof UNAVAILABLE_REASONS;
export const UNAVAILABLE_REASON_IDS = Object.keys(UNAVAILABLE_REASONS) as UnavailableReasonId[];

/** A reason as a view model carries it: which one, its code, and the text with parameters («фан забронирован: Анна»). */
export interface ReasonVM {
  readonly id: UnavailableReasonId;
  readonly code: CgCode | null;
  readonly text: Msg;
}

export interface ActionCatalog {
  readonly platform: HotkeyPlatform;
  entry(id: CatalogActionId): ActionCatalogEntry;
  /** Every entry, in CATALOG_ACTION_IDS order. */
  entries(): readonly ActionCatalogEntry[];
  reason(id: UnavailableReasonId, params?: Msg['params']): ReasonVM;
}
