// What a person sees for a key that has to wait (architecture.md §9.1
// «показывается загрузка или причина»; HK-024, HK-025): the dispatcher reports
// early notices from document_start, but nothing can draw a toast that early.
// This buffer keeps what still matters and shows it the moment the toasts
// exist; from then on notices show at once. «Загрузка…» stays up until the
// kept key runs or is dropped — the dispatcher says which.
//
// Before the toasts exist the only thing that can show the wait is the dock
// host itself: `onWaiting` tells the tab's bootstrap, which marks the host
// (`@cg/host-chatspace/isolated` `createKeyPendingMark`).

import { type ToastId, type ToastPort } from '@cg/contracts/vm';

import { type DispatcherCommandId, type KeyRefusal } from '../../domain/hotkeys';
import { type EarlyNotice } from './dispatcher';

export interface EarlyNoticePresenter {
  readonly toasts: ToastPort;
  /** The reason toast of a refused key (the hotkey runner's `refuse`). */
  refuse(command: DispatcherCommandId, refusal: KeyRefusal): void;
}

export interface EarlyNoticesOptions {
  /** A key started or stopped waiting — called at once, from document_start on, before anything of ours can draw. */
  readonly onWaiting?: (waiting: boolean) => void;
}

export interface EarlyNotices {
  /** The dispatcher's `onEarly`. */
  readonly onEarly: (notice: EarlyNotice) => void;
  /** The toasts exist now. */
  attach(presenter: EarlyNoticePresenter): void;
}

/** Refusals remembered before the toasts exist: the newest few are enough to explain what happened. */
const REFUSALS_KEPT = 3;

export function createEarlyNotices(options: EarlyNoticesOptions = {}): EarlyNotices {
  let presenter: EarlyNoticePresenter | null = null;
  /** A key is kept and has neither run nor been dropped yet. */
  let waiting = false;
  let loadingToast: ToastId | null = null;
  let refusals: { readonly command: DispatcherCommandId; readonly refusal: KeyRefusal }[] = [];

  const setWaiting = (next: boolean): void => {
    if (next === waiting) return;
    waiting = next;
    options.onWaiting?.(next);
  };
  const showLoading = (): void => {
    if (presenter === null || !waiting || loadingToast !== null) return;
    loadingToast = presenter.toasts.show({ kind: 'info', code: null, scope: 'hotkey.early', title: { key: 'common.loading' }, body: null });
  };
  const hideLoading = (): void => {
    setWaiting(false);
    if (presenter !== null && loadingToast !== null) presenter.toasts.dismiss(loadingToast);
    loadingToast = null;
  };

  return {
    onEarly(notice) {
      if (notice.kind === 'queued') {
        setWaiting(true);
        showLoading();
        return;
      }
      if (notice.kind === 'ran') {
        hideLoading();
        return;
      }
      if (notice.kind === 'dropped') {
        // Replaced by a newer key that waits in its place: still waiting. Otherwise nothing waits any more.
        if (notice.why !== 'replaced') hideLoading();
        return;
      }
      if (presenter !== null) presenter.refuse(notice.command, notice.refusal);
      else refusals = [...refusals, { command: notice.command, refusal: notice.refusal }].slice(-REFUSALS_KEPT);
    },
    attach(next) {
      presenter = next;
      showLoading();
      for (const item of refusals) next.refuse(item.command, item.refusal);
      refusals = [];
    },
  };
}
