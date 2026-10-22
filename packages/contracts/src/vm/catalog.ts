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
  /** 1.15.0 (R20 P11b): ⌘⇧K / Ctrl+Alt+K — «Заметки» of a Fansly chat; a site without the feature has no such row. */
  'notes',
  /**
   * 1.33.0 (X58): ⌘↵ / Ctrl+Enter in the message field — the Fix on screen goes into the field in place of the draft.
   * The key is the site's own (send, a line break) whenever no Fix waits in the open chat.
   */
  'apply-fix',
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
  /**
   * 1.5.0. The tab's port to the background is lost while the extension itself is the same instance (nothing
   * was updated): the tab reconnects by itself, and until it does nothing can start. Not `reload-needed`.
   */
  'runtime-unreachable': { key: 'dock.reason.runtimeUnreachable', code: 'CG-RUNTIME-UNREACHABLE' },
  'quota-zero': { key: 'dock.reason.quotaZero', code: 'CG-QUOTA-DAILY' },
  'feature-disabled': { key: 'dock.reason.featureDisabled', code: 'CG-FEATURE-DISABLED' },
  /** A generation runs in this chat (here or in another tab): only its own button works (UI-008). */
  'chat-busy': { key: 'dock.reason.chatBusy', code: 'CG-OP-CHAT-BUSY' },
  'coach-busy': { key: 'dock.reason.coachBusy', code: 'CG-OP-COACH-BUSY' },
  'needs-draft': { key: 'dock.reason.needsDraft', code: 'CG-GATE-DRAFT' },
  'no-history': { key: 'dock.reason.noHistory', code: 'CG-GATE-HISTORY' },
  'hi-gate': { key: 'dock.reason.hiGate', code: 'CG-GATE-HI' },
  /** «Новые»: a part of the fan's greeting is confirmed — no second greeting (owner X5); the rest is Reply's. */
  'hi-greeted': { key: 'dock.reason.hiGreeted', code: 'CG-GATE-HI' },
  'ping-gate': { key: 'dock.reason.pingGate', code: 'CG-GATE-PING' },
  /** Ping is for a conversation of at least ten messages (the owner, 2026-10-21; the hub's `gate_min_messages` on Ping). */
  'ping-few': { key: 'dock.reason.pingFew', code: 'CG-GATE-HISTORY' },
  'language': { key: 'dock.reason.language', code: 'CG-GATE-LANGUAGE' },
  'fan-blocked': { key: 'dock.reason.fanBlocked', code: 'CG-GATE-FAN-BLOCKED' },
  'fan-unknown': { key: 'dock.reason.fanUnknown', code: 'CG-GATE-FAN-UNKNOWN' },
  /**
   * 1.15.0 (R20 P8a, FS-IDN-6): the fan of a preview has no conversation its list knows, on a platform where a chat has
   * an id of its own (Fansly: the group). Nothing of that chat is asked — never by the fan's id instead.
   */
  'conversation-unknown': { key: 'dock.reason.conversationUnknown', code: 'CG-DATA-NOT-READY' },
  'overlay-open': { key: 'dock.reason.overlayOpen', code: 'CG-GATE-OVERLAY' },
  'host-degraded': { key: 'dock.reason.hostDegraded', code: 'CG-HOST-CONTRACT' },
  'composer-missing': { key: 'dock.reason.composerMissing', code: 'CG-HOST-COMPOSER-MISSING' },
  /** Audit 2026-10-20 №15: a conversation is open, but the page has not named its account or fan (old «Аккаунт не определён»). */
  'host-unidentified': { key: 'dock.reason.hostUnidentified', code: 'CG-HOST-ACCOUNT-UNKNOWN' },
  'claim-busy': { key: 'dock.reason.claimedBy', code: 'CG-CLAIM-BUSY' },
  /** Tone and Split are frozen while a generation runs (AI-009). */
  'locked-during-generation': { key: 'dock.reason.lockedDuringGeneration', code: null },
  /** Split for Recap and Review: «это не сообщение фану». */
  'not-a-message': { key: 'dock.option.splitNotMessage', code: null },
  /** «Ещё раз» in a preview while a part is queued, sending or accepted. */
  'parts-sending': { key: 'result.againBlocked', code: null },
  /** The answer did not parse: one copy-only part (UI-032). */
  unparsed: { key: 'result.meta.unparsed', code: null },
  /** «Заменить мой черновик» without a verified editor (`fix.canReplace = false`, §6.4). */
  'draft-unverifiable': { key: 'fix.cannotCheck', code: null },
  'help-removed': { key: 'dock.helpRemoved', code: null },
  /** The browser keeps the combination (§9.1 «Риск зарезервированных сочетаний»). */
  'hotkey-reserved': { key: 'dock.reason.hotkeyReserved', code: null },
  /** «Повторить» before the fixed retry deadline (ER-007). */
  'wait-until': { key: 'cg.retryIn', code: null },
  'send-unavailable': { key: 'send.unavailable', code: null },
  /** «Отправить» of a preview's draft field with nothing in it (audit 2026-10-20, row 1). */
  'draft-empty': { key: 'preview.draft.sendEmpty', code: null },
  /** «Отправить» of a preview's draft field for the chat that is open: its own composer is the place. */
  'chat-open': { key: 'send.reason.activeChat', code: 'CG-SEND-ACTIVE-CHAT' },
  // 1.47.0: the voice studio's buttons.
  /** A preset or «Озвучить» while the script is still being written. */
  'voice-writing': { key: 'voice.reason.writing', code: null },
  /** «Озвучить» with no script to voice. */
  'voice-no-script': { key: 'voice.reason.noScript', code: null },
  /** «Озвучить» of a script the hub would refuse (an unknown tag, too long, markup): said before the paid click. */
  'voice-issue': { key: 'voice.reason.issue', code: 'CG-VOICE-SCRIPT' },
  /** «Прикрепить» of a take that still renders. */
  'voice-working': { key: 'voice.reason.working', code: null },
  /** «Прикрепить» where the site takes no file now (`fileAttach` off): «Скачать MP3» is the way. */
  'voice-attach-off': { key: 'voice.reason.attachOff', code: 'CG-VOICE-ATTACH' },
  /** «Ещё вариант» when the session holds as many takes as it may. */
  'voice-takes-full': { key: 'voice.reason.takesFull', code: null },
  /** «Прикрепить» while a handover of ours is still open. */
  'voice-attaching': { key: 'voice.reason.attaching', code: null },
} as const satisfies Record<string, { readonly key: I18nKey; readonly code: CgCode | null }>;

export type UnavailableReasonId = keyof typeof UNAVAILABLE_REASONS;
export const UNAVAILABLE_REASON_IDS = Object.keys(UNAVAILABLE_REASONS) as UnavailableReasonId[];

/** A reason as a view model carries it: which one, its code, and the text with parameters («Reply недоступен: нужен черновик»). */
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
