// What the person can do about an error (architecture.md §5.7 `recovery` and
// `retry`, §9.5; ER-006, ER-009…ER-011). Nothing here repeats anything by
// itself: every retry is a human click, a deadline only enables the button,
// and codes whose outcome is unknown (`never`) can not be retried at all.
// The only automatic repeat in the extension is the hub layer's single
// transparent `retry-once` of an AI stream before its first frame (R08).

import { type CgCode, type CgErrorWire, type SettingsRoute } from '@cg/contracts/errors';
import { CG_P1_CODES, CG_REGISTRY } from '@cg/contracts/errors/registry';
import { type UiTextKey } from '@cg/contracts/i18n/keys';
import { type VmViewState } from '@cg/contracts/vm';

import { normalizeCode } from './view';

export type RetryVerdict =
  /** A safe read or a new human click may repeat it now. */
  | { readonly allowed: true; readonly why: 'manual' }
  /** A deadline is set and not reached; the button waits for it. */
  | { readonly allowed: false; readonly why: 'wait'; readonly at: number }
  /** The outcome may already have happened (an insert, a send): never again (Appendix A «никогда»). */
  | { readonly allowed: false; readonly why: 'never' }
  /** There is nothing to repeat (Appendix A «—»). */
  | { readonly allowed: false; readonly why: 'nothing' };

/** ER-006: may the person repeat now? Never automatic — `allowed` enables a button, nothing more. */
export function retryVerdict(wire: CgErrorWire, now: number): RetryVerdict {
  const entry = CG_REGISTRY[normalizeCode(wire.code)];
  switch (entry.retry) {
    case 'never':
      return { allowed: false, why: 'never' };
    case 'none':
      return { allowed: false, why: 'nothing' };
    case 'after-deadline':
      if (wire.retryAt !== undefined && now < wire.retryAt) return { allowed: false, why: 'wait', at: wire.retryAt };
      return { allowed: true, why: 'manual' };
    case 'safe-read':
    case 'new-click':
      return { allowed: true, why: 'manual' };
  }
}

/** Nothing is retried automatically by an error card, a toast or a list (only R08's `retry-once`). */
export function mayRetryAutomatically(_code: CgCode): false {
  return false;
}

export type RecoveryActionKind = 'retry' | 'again' | 'sign-in' | 'open-settings' | 'reload-tab' | 'open-chat' | 'update-extension' | 'copy-code';

export interface RecoveryAction {
  readonly kind: RecoveryActionKind;
  /** Catalog key of the button; null — the card's text says what to do (update the extension). */
  readonly label: UiTextKey | null;
  readonly enabled: boolean;
  /** The deadline the button waits for (the countdown runs from it). */
  readonly availableAt: number | null;
  readonly settings: SettingsRoute | null;
}

function action(kind: RecoveryActionKind, label: UiTextKey | null, extra: Partial<Pick<RecoveryAction, 'enabled' | 'availableAt' | 'settings'>> = {}): RecoveryAction {
  return { kind, label, enabled: extra.enabled ?? true, availableAt: extra.availableAt ?? null, settings: extra.settings ?? null };
}

/**
 * The card's buttons by the registry entry (ui-design §4.8): the recovery
 * first («Повторить», «Ещё раз», «Войти», «Настройки», «Перезагрузить
 * вкладку», «Открыть чат»), then «Настройки» when the code deep-links to a
 * section and the first button is not it, then «Скопировать код» always.
 */
export function recoveryActions(wire: CgErrorWire, now: number): RecoveryAction[] {
  const code = normalizeCode(wire.code);
  const entry = CG_REGISTRY[code];
  const verdict = retryVerdict(wire, now);
  const settings = entry.settings ?? null;
  const out: RecoveryAction[] = [];
  const waitFields = verdict.why === 'wait' ? { enabled: false, availableAt: verdict.at } : { enabled: verdict.allowed };
  switch (entry.recovery) {
    case 'retry':
    case 'wait-until':
      if (verdict.why !== 'never' && verdict.why !== 'nothing') out.push(action('retry', 'common.retry', waitFields));
      break;
    case 'new-generation':
      // A new generation is a new click even when the failed step itself has nothing to repeat (CG-SEND-PART).
      if (verdict.why !== 'never') out.push(action('again', 'common.again', verdict.why === 'wait' ? waitFields : {}));
      break;
    case 'sign-in':
      out.push(action('sign-in', 'common.signIn'));
      break;
    case 'open-settings':
      out.push(action('open-settings', 'common.settings', { settings }));
      break;
    case 'reload-tab':
      out.push(action('reload-tab', 'common.reloadTab'));
      break;
    case 'open-chat':
      out.push(action('open-chat', 'common.openChat'));
      break;
    case 'update-extension':
      out.push(action('update-extension', null));
      break;
    case 'contact-owner':
    case 'none':
      break;
  }
  if (settings !== null && !out.some((a) => a.kind === 'open-settings')) out.push(action('open-settings', 'common.settings', { settings }));
  out.push(action('copy-code', 'common.copyCode'));
  return out;
}

// ── Toasts and the card's dot (ER-009…ER-011, ui-design §4.8) ─────────────

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

/** Toast kind by severity. */
export function toastKindOf(code: CgCode): Exclude<ToastKind, 'success'> {
  const severity = CG_REGISTRY[code].severity;
  return severity === 'error' ? 'error' : severity === 'warn' ? 'warning' : 'info';
}

/** 4.5 s; errors 6.5 s; up to three on screen. */
export const TOAST_TIMING = { lifetimeMs: 4500, errorLifetimeMs: 6500, maxVisible: 3 } as const;

/**
 * Warnings the person must not miss stay as long as errors: the shared
 * recap that did not reach the hub (ER-012, the old CG-HUB-08 at 6.5 s).
 */
export const LONG_TOASTS: readonly CgCode[] = ['CG-RECAP-SAVE'];

export function toastLifetimeMs(kind: ToastKind, code: CgCode | null = null): number {
  return kind === 'error' || (code !== null && LONG_TOASTS.includes(code)) ? TOAST_TIMING.errorLifetimeMs : TOAST_TIMING.lifetimeMs;
}

/** Toasts with the same code and scope replace each other. */
export function toastKey(code: CgCode | null, scope: string): string {
  return `${code ?? 'none'}|${scope}`;
}

/** Red dot — our work failed; ring — a state, not a failure (quota 0, no sign-in, ChatSpace updated…). */
export function errorTone(code: CgCode): 'failure' | 'state' {
  return CG_REGISTRY[code].severity === 'error' ? 'failure' : 'state';
}

/** P1 incidents (§0.4): counted apart in diagnostics and client_health. */
export function isP1(code: CgCode): boolean {
  return CG_P1_CODES.includes(code);
}

// ── Lists: an error is never an empty list (ER-025, SP-029) ────────────────

export type ListOutcome<T> = { readonly ok: true; readonly items: readonly T[] } | { readonly ok: false; readonly error: CgErrorWire };

/** A failed read is `error` with its own «Повторить», an answered empty read is `empty`. */
export function listViewState<T>(outcome: ListOutcome<T>): Extract<VmViewState, 'ready' | 'empty' | 'error'> {
  if (!outcome.ok) return 'error';
  return outcome.items.length === 0 ? 'empty' : 'ready';
}
