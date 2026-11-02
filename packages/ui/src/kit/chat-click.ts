// ⌘/Ctrl+click on a way into a chat: what the browser does with a link, a new tab, and the person stays where they are
// (the window, its filters, the outreach on screen). Our «Открыть чат» are buttons with an action, so the click says it.

import { type UiAction } from '@cg/contracts/vm';

/** The click's action: with ⌘/Ctrl held, a way into a chat goes to a new tab; anything else stays what it is. */
export function chatClick(action: UiAction, event: { readonly metaKey: boolean; readonly ctrlKey: boolean }): UiAction {
  if (!event.metaKey && !event.ctrlKey) return action;
  if (action.type === 'Navigate' && action.to.kind === 'chat') return { ...action, to: { ...action.to, newTab: true } };
  if (action.type === 'OpenChatToVerify') return { ...action, newTab: true };
  return action;
}
