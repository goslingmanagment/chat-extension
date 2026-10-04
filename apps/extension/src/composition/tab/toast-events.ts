// The background's toast as this tab shows it (architecture.md §7, §9.5).
//
// The background decides «the tab is elsewhere» by the tab's last presence
// report, and a report follows a chat switch or a return to the tab by its
// coalescing delay. Inside that delay a generation that has just ended is
// toasted for the very chat the person looks at, whose dock already shows the
// result or the error card. The tab knows where it is at the moment the toast
// arrives, so the last word is here:
//
// - «AI готово» / «AI: не получилось» of the chat that is open in a visible
//   tab is not shown: the dock says it;
// - any other toast of the open chat carries no «Открыть чат»;
// - a toast of another chat is named by its fan, as ChatSpace already holds
//   the name in memory (the background knows no names; decoration only).

import type { ChatRef } from '@cg/contracts/ids';
import { chatKeyOf } from '@cg/contracts/ids';
import type { BackgroundToast } from '@cg/contracts/tab-messages';

/** Scopes of the generation's own toasts (core `scheduler`). */
const OP_SCOPES: ReadonlySet<string> = new Set(['op.ready', 'op.failed']);

export interface ToastFacts {
  /** The chat this tab shows now; null — no chat is open. */
  showing(): ChatRef | null;
  /** The tab is the one the person looks at. */
  visible(): boolean;
  /** The fan's name as the page already holds it; null — unknown. */
  fanName(chat: ChatRef): string | null;
}

/** The toast to show, or null when the open chat's dock already says it. */
export function toastOfTab(toast: BackgroundToast, facts: ToastFacts): BackgroundToast | null {
  const chat = toast.chat;
  if (chat === undefined) return toast;
  const showing = facts.showing();
  if (showing !== null && chatKeyOf(showing) === chatKeyOf(chat) && facts.visible()) {
    if (OP_SCOPES.has(toast.scope)) return null;
    const { chat: _open, ...rest } = toast;
    return rest;
  }
  return toast.fanLabel === null ? { ...toast, fanLabel: facts.fanName(chat) } : toast;
}
