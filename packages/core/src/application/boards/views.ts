// View states and texts shared by the board controllers (architecture.md
// §9.5, §10.2 п. 1): a failed read is an error card with its own «Повторить»,
// never an empty list (ER-025, SP-029); a missing right is `forbidden` with
// the way out; a hub that does not answer is `offline` with what was last
// shown. Errors travel as code and facts and are rendered here in the
// current language.

import { type CgCode, type CgErrorView, type CgErrorWire, type I18nKey } from '@cg/contracts/errors';
import { CG_REGISTRY } from '@cg/contracts/errors/registry';
import { type ActionButtonVM, type DataStamp, type HotkeyLabel, type I18n, type I18nParams, type Msg, type PartialGap, type ReasonVM, type UiAction, type VmView } from '@cg/contracts/vm';

import { errorView } from '../../domain/errors/view';
import { type Translator } from '../../domain/i18n/catalogs';

/** The I18n port as the error renderer's translator (texts in the port's current language). */
export function translatorOf(i18n: I18n): Translator {
  return {
    locale: i18n.language,
    text: (key, params) => i18n.t(key, params),
    plural: (key, n, params) => i18n.plural(key, n, params),
  };
}

export function errorOf(wire: CgErrorWire, i18n: I18n): CgErrorView {
  return errorView(wire, translatorOf(i18n));
}

export const msg = (key: I18nKey, params?: I18nParams): Msg => (params === undefined ? { key } : { key, params });

export function button(label: I18nKey | Msg, action: UiAction, patch: Partial<Pick<ActionButtonVM, 'enabled' | 'reason' | 'hotkey'>> = {}): ActionButtonVM {
  return { label: typeof label === 'string' ? msg(label) : label, action, enabled: patch.enabled ?? true, reason: patch.reason ?? null, hotkey: patch.hotkey ?? null };
}

/** A key of our own surfaces (not the vendored scheme): always delivered, no fallback. */
export function localKey(display: string, aria: string): HotkeyLabel {
  return { display, aria, delivery: 'delivered', fallback: null };
}

/** UNAVAILABLE_REASONS of the contracts as the controllers use them: id, text key and code. */
const REASONS = {
  'not-signed-in': { key: 'dock.reason.notSignedIn', code: 'CG-AUTH-REQUIRED' },
  'no-binding': { key: 'dock.reason.noBinding', code: 'CG-BINDING-MISSING' },
  'not-granted': { key: 'dock.reason.notGranted', code: 'CG-BINDING-NOT-GRANTED' },
  'no-persona': { key: 'dock.reason.noPersona', code: 'CG-PERSONA-UNASSIGNED' },
  'hub-down': { key: 'dock.reason.hubDown', code: 'CG-HUB-UNAVAILABLE' },
  'feature-disabled': { key: 'dock.reason.featureDisabled', code: 'CG-FEATURE-DISABLED' },
  'chat-busy': { key: 'dock.reason.chatBusy', code: 'CG-OP-CHAT-BUSY' },
  'needs-draft': { key: 'dock.reason.needsDraft', code: 'CG-GATE-DRAFT' },
  'hi-gate': { key: 'dock.reason.hiGate', code: 'CG-GATE-HI' },
  'hi-greeted': { key: 'dock.reason.hiGreeted', code: 'CG-GATE-HI' },
  'ping-few': { key: 'dock.reason.pingFew', code: 'CG-GATE-HISTORY' },
  'conversation-unknown': { key: 'dock.reason.conversationUnknown', code: 'CG-DATA-NOT-READY' },
  'host-degraded': { key: 'dock.reason.hostDegraded', code: 'CG-HOST-CONTRACT' },
  'claim-busy': { key: 'dock.reason.claimedBy', code: 'CG-CLAIM-BUSY' },
  'locked-during-generation': { key: 'dock.reason.lockedDuringGeneration', code: null },
  'parts-sending': { key: 'result.againBlocked', code: null },
  unparsed: { key: 'result.meta.unparsed', code: null },
  'draft-unverifiable': { key: 'fix.cannotCheck', code: null },
  'send-unavailable': { key: 'send.unavailable', code: null },
  'draft-empty': { key: 'preview.draft.sendEmpty', code: null },
  'chat-open': { key: 'send.reason.activeChat', code: 'CG-SEND-ACTIVE-CHAT' },
} as const satisfies Partial<Record<ReasonVM['id'], { readonly key: I18nKey; readonly code: CgCode | null }>>;

export type BoardReasonId = keyof typeof REASONS;

export function reason(id: BoardReasonId, params?: I18nParams): ReasonVM {
  const entry = REASONS[id];
  return { id, code: entry.code, text: msg(entry.key, params) };
}

/** The code a click refused for `why` answers with: the reason's own, or the one its id stands for. */
export function reasonCode(why: ReasonVM): CgCode {
  if (why.code !== null) return why.code;
  if (why.id === 'parts-sending') return 'CG-SEND-BUSY';
  if (why.id === 'unparsed') return 'CG-OUTPUT-UNUSABLE';
  return 'CG-FEATURE-DISABLED';
}

export type FailureClass = 'forbidden' | 'offline' | 'error';

/** The hub or the background does not answer: what was shown stays, with its age. */
const OFFLINE: readonly CgCode[] = ['CG-HUB-UNAVAILABLE', 'CG-HUB-TIMEOUT', 'CG-NETWORK', 'CG-TIMEOUT', 'CG-RUNTIME-UNREACHABLE'];
/** The person may not see this until something is set right: a sign-in, a binding, a right, a switch, an update. */
const FORBIDDEN: readonly CgCode[] = [
  'CG-AUTH-REQUIRED',
  'CG-AUTH-REVOKED',
  'CG-AUTH-EXPIRED',
  'CG-BINDING-MISSING',
  'CG-BINDING-AMBIGUOUS',
  'CG-BINDING-NOT-GRANTED',
  'CG-FEATURE-DISABLED',
  'CG-HUB-FORBIDDEN',
  'CG-HUB-OUTDATED',
  'CG-HUB-CAPABILITY',
  'CG-HUB-URL',
  'CG-HUB-HOST-PERMISSION',
  'CG-PERSONA-NONE',
  'CG-PERSONA-UNASSIGNED',
  'CG-PERSONA-UNAVAILABLE',
  'CG-RUNTIME-RELOADED',
  'CG-HOST-NOT-READY',
];

export function failureClass(code: CgCode): FailureClass {
  if (OFFLINE.includes(code)) return 'offline';
  if (FORBIDDEN.includes(code)) return 'forbidden';
  return 'error';
}

/** The way out of a `forbidden` state: the settings section the code points at, or a tab reload. */
export function remedyOf(code: CgCode): UiAction | null {
  if (code === 'CG-RUNTIME-RELOADED') return { type: 'ReloadTab' };
  const route = CG_REGISTRY[code].settings;
  return route === undefined ? null : { type: 'OpenSettings', route };
}

/**
 * The view of a failed read. `retry` — the safe read to repeat (a human
 * click; nothing repeats by itself). `lastGoodAt` — when the data still on
 * screen was read.
 */
export function failureView(wire: CgErrorWire, i18n: I18n, retry: UiAction | null, lastGoodAt: number | null = null): VmView {
  const error = errorOf(wire, i18n);
  switch (failureClass(error.code)) {
    case 'forbidden':
      return { s: 'forbidden', error, remedy: remedyOf(error.code) };
    case 'offline':
      return { s: 'offline', error, retry, lastGoodAt };
    case 'error':
      return { s: 'error', error, retry };
  }
}

export const READY: VmView = { s: 'ready' };

export function loadingView(since: number | null, stage: Msg | null = null): VmView {
  return { s: 'loading', since, stage };
}

/** `ready` without gaps, `partial` with them. */
export function dataView(gaps: readonly PartialGap[]): VmView {
  return gaps.length === 0 ? READY : { s: 'partial', gaps };
}

export function stamp(asOf: string | null, coverage: DataStamp['coverage']): DataStamp {
  return { asOf, coverage };
}

/** An error that is ours, not the hub's (a gate, a refusal of this click). */
export function localError(code: CgCode, i18n: I18n, detail?: string): CgErrorView {
  return errorOf(detail === undefined ? { code } : { code, detail }, i18n);
}
