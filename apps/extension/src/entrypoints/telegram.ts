// Telegram's isolated world, document_start (docs/specs/2026-10-27-telegram-site.md §4, §6.4): the early bootstrap of
// a Telegram Web A tab, `telegram.js`. Wiring lives in composition/tab.ts; this entry assembles the Telegram adapter
// from the starter of @cg/host-telegram. No MAIN script: the adapter reads the page's DOM and writes only into its
// main field.
//
// NOT in the manifest: the background's sync registers it once Telegram is switched on, on web.telegram.org/a/ and, in
// a test build, on the stand. It starts without WXT's wrapper (build/isolated-entry.ts): `main` is called bare.
//
// The page's storage is read here, the one place allowed to (the packages' lint forbids it): the active slot's session
// entry only, `account<N>` (host-telegram account.ts), never the legacy `user_auth`, never another key.

import { createKeyPendingMark, createTelegramKeyboardProbe, routeOfLocation, startTelegramTab, type TelegramPort } from '@cg/host-telegram/isolated';
import type { UnlistedScriptDefinition } from 'wxt';
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';

import { composeTab, type HostAdapter } from '../composition/tab';
import { TELEGRAM_LAZY_ROOT } from '../hosts/runtime/telegram';

/** One key of the page's storage, or null when it cannot be read (a sandboxed frame, a refused storage). */
const sessionEntry = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

/**
 * The early half of the Telegram adapter: its start brings up Telegram's HostPort and holds the keys of our roots on
 * `window` before the tab's dispatcher (§4.5). Its application's half (`TELEGRAM_APP`,
 * composition/tab/hosts/telegram/app.ts) comes with Telegram's `tab-app` once the dock has a place or a key of ours waits.
 */
/** The port once up: the early key route asks it whether our dock shows (an unbound account keeps Telegram's keys). */
let port: TelegramPort | null = null;

export const TELEGRAM_ADAPTER: HostAdapter<TelegramPort> = {
  kind: 'telegram-web',
  start: (env) => {
    const started = startTelegramTab({ win: env.win, session: sessionEntry, redeem: env.redeem, onDiagnostic: env.onDiagnostic });
    void started.host.then((up) => {
      port = up;
    });
    return started;
  },
  keyProbe: createTelegramKeyboardProbe,
  keyPending: createKeyPendingMark,
  // A person's chat by the address; on an account our dock does not show on, no chat of ours at all (spec §2).
  routeOfLocation: (location) => {
    const route = routeOfLocation(location);
    return port?.dockShown() === false ? { kind: 'other', epoch: route.epoch } : route;
  },
  hotkeyClient: 'extension',
  // Reply ⌘E and Fix ⌘I win over Telegram's code and italic; apply-fix ⌘↵ is ours only while a Fix is on screen, else
  // Telegram's send. Every row of a feature Telegram's slice has not stays the page's and the browser's: ⌘K is
  // Telegram's link, ⌘⇧M its monospace.
  keyRules: {
    absent: ['hi', 'ping', 'help', 'recap', 'review', 'split', 'spenders', 'coach', 'newcomers', 'palette', 'chat-next', 'chat-previous', 'fan-panel', 'next-unread', 'quick-jump', 'notes'],
  },
  lazy: { root: TELEGRAM_LAZY_ROOT },
};

const definition: UnlistedScriptDefinition = defineUnlistedScript(() => {
  composeTab({ win: window }, TELEGRAM_ADAPTER);
});

export default definition;
