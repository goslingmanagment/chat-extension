// What a person sees for a key pressed before the lazy part of the tab is
// there (architecture.md §9.1 «показывается загрузка или причина»; HK-024):
// the dispatcher reports early notices from document_start, but nothing can
// draw a toast that early. This buffer keeps what still matters and shows it
// the moment the toasts exist; from then on notices show at once.

import { type ToastId, type ToastPort } from '@cg/contracts/vm';

import { type DispatcherCommandId, type KeyRefusal } from '../../domain/hotkeys';
import { type EarlyNotice } from './dispatcher';

export interface EarlyNoticePresenter {
  readonly toasts: ToastPort;
  /** The reason toast of a refused key (the hotkey runner's `refuse`). */
  refuse(command: DispatcherCommandId, refusal: KeyRefusal): void;
}

export interface EarlyNotices {
  /** The dispatcher's `onEarly`. */
  readonly onEarly: (notice: EarlyNotice) => void;
  /** The toasts exist now. */
  attach(presenter: EarlyNoticePresenter): void;
  /** The lazy part connected and took the kept key over: «загрузка» goes away. */
  settled(): void;
}

/** Refusals remembered before the toasts exist: the newest few are enough to explain what happened. */
const REFUSALS_KEPT = 3;

export function createEarlyNotices(): EarlyNotices {
  let presenter: EarlyNoticePresenter | null = null;
  /** A key is kept for the lazy part and nobody was told yet, or the toast saying so is on screen. */
  let waiting = false;
  let loadingToast: ToastId | null = null;
  let refusals: { readonly command: DispatcherCommandId; readonly refusal: KeyRefusal }[] = [];

  const showLoading = (): void => {
    if (presenter === null || !waiting || loadingToast !== null) return;
    loadingToast = presenter.toasts.show({ kind: 'info', code: null, scope: 'hotkey.early', title: { key: 'common.loading' }, body: null });
  };
  const hideLoading = (): void => {
    waiting = false;
    if (presenter !== null && loadingToast !== null) presenter.toasts.dismiss(loadingToast);
    loadingToast = null;
  };

  return {
    onEarly(notice) {
      if (notice.kind === 'queued') {
        waiting = true;
        showLoading();
        return;
      }
      if (notice.kind === 'dropped') {
        // Replaced by a newer key: that one is still waiting. Otherwise nothing waits any more.
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
    settled: hideLoading,
  };
}
