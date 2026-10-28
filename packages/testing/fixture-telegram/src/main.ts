// Boot of the Telegram stand (docs/specs/2026-10-27-telegram-site.md §6.10): a page that imitates Telegram Web A
// (telegram-tt 6002824b) on its own loopback name, `telegram.localhost`, at `/a/`. Our own code and synthetic data,
// no Telegram code. What it reproduces, and from where:
// - the accounts: the URL's `?account=N` picks the slot, `localStorage` `account<N>` holds each slot's session with
//   its `userId`, the legacy `user_auth` another id (accounts.ts; util/accountSlot.ts, util/multiaccount.ts);
// - the open chat: the hash `#<peer id>`, changed by `pushState` with no `hashchange`; the header and the list each in
//   a `Transition` whose previous slide stays hidden, no `-active` slide while they slide (app.ts; ui/Transition.tsx);
// - the list: date groups with Web A's day words, `.Message` / `.ActionMessage`, media kinds by their content
//   classes, `.list-bottom-marker` only at the newest messages (messages.ts; middle/MessageListContent.tsx);
// - the composer: a stub field until the TipTap editor mounts on it, the edit mode, the attachment window that takes
//   the editor (composer.ts, attachment.ts; middle/composer/*);
// - the keys: the `document` listener of MessageInput.tsx (below), verbatim in what it does.

import './styles.css';

import { accountSlot, writeAccountSlots } from './accounts';
import { TelegramApp } from './app';
import { focusAtEnd, isSendShortcut } from './composer';
import { TELEGRAM_STAND_GLOBAL, TELEGRAM_STAND_READY_ATTRIBUTE, type TelegramStandControl } from './protocol';
import { ACCOUNTS, OTHER_ACCOUNT_CHATS, SEED_CHATS } from './world';

/** Keys Web A's listener lets pass without moving the focus into the field (MessageInput.tsx `IGNORE_KEYS`). */
const IGNORE_KEYS = ['Esc', 'Escape', 'Enter', 'PageUp', 'PageDown', 'Meta', 'Alt', 'Ctrl', 'ArrowDown', 'ArrowUp', 'Control', 'Shift'];

/**
 * MessageInput.tsx `handleDocumentKeyDown`, on `document` in the capture phase: a key whose target is not the field,
 * an INPUT, a TEXTAREA or a contenteditable — a button, the body, a host element of a closed shadow root — sends the
 * field on Enter or ⌘/Ctrl+Enter, and moves any other key (not in IGNORE_KEYS) into the field: the focus goes there
 * and the key is dispatched again on it, so the browser's own input of a letter lands in the field.
 */
function installDocumentKeys(app: TelegramApp): void {
  document.addEventListener(
    'keydown',
    (event) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const active = app.activeInput();
      if (active === null || target === null) return;
      const { input } = active;
      if (target === input || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      if (isSendShortcut(event)) {
        event.preventDefault();
        event.stopPropagation();
        active.send();
        return;
      }
      const { key } = event;
      if (IGNORE_KEYS.includes(key)) return;
      const collapsed = document.getSelection()?.isCollapsed;
      if (((key.startsWith('Arrow') || (event.shiftKey && key === 'Shift')) && collapsed !== true) || (event.code === 'KeyC' && (event.ctrlKey || event.metaKey) && target.tagName !== 'INPUT')) return;
      focusAtEnd(input);
      input.dispatchEvent(new KeyboardEvent(event.type, event));
    },
    true,
  );
}

function boot(): void {
  writeAccountSlots(localStorage, Date.now());
  const slot = accountSlot(location.href) ?? 1;
  const account = slot === 2 ? ACCOUNTS[2] : ACCOUNTS[1];
  const root = document.getElementById('root');
  const portals = document.getElementById('portals');
  if (root === null || portals === null) throw new Error('the page has no #root or #portals');
  const app = new TelegramApp(root, portals, slot === 2 ? OTHER_ACCOUNT_CHATS : SEED_CHATS, account, () => new Date());
  installDocumentKeys(app);
  app.followHash();
  const control: TelegramStandControl = {
    chat: () => app.current?.seed.peerId ?? null,
    account: () => account.userId,
    openChat: (peerId) => app.openChat(peerId),
    incoming: (peerId, text) => app.incoming(peerId, text),
    scrollUp: () => app.scroll(true),
    scrollDown: () => app.scroll(false),
    openAttachment: () => app.openAttachment(),
    closeAttachment: () => app.closeAttachment(),
    editLast: () => app.editLast(),
    cancelEdit: () => {
      app.current?.composer?.cancelEdit();
      app.current?.composer?.clear();
    },
    fieldText: () => app.current?.composer?.text() ?? null,
    captionText: () => app.attachment?.text() ?? null,
    typeInField: (text) => {
      const composer = app.current?.composer;
      if (composer === null || composer === undefined) throw new Error('no chat is open');
      composer.insert(text);
    },
    clearField: () => app.current?.composer?.clear(),
    sent: app.sent,
  };
  (window as unknown as Record<string, unknown>)[TELEGRAM_STAND_GLOBAL] = control;
  document.documentElement.setAttribute(TELEGRAM_STAND_READY_ATTRIBUTE, '1');
}

try {
  boot();
} catch (error) {
  document.documentElement.setAttribute(TELEGRAM_STAND_READY_ATTRIBUTE, 'failed');
  throw error;
}
