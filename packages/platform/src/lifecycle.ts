// Lifecycle of the extension and of its event page (architecture.md §7 «Фон и
// выгрузка»; LG-016, LG-018, UP-008): installed or updated, the browser
// started, the event page is about to be unloaded. All four are background
// events and must be wired synchronously at background start: `onInstalled`
// and `onStartup` are delivered once, right after the first run of the
// background script, to the listeners that exist by then.
//
// Firefox unloads an event page after 30 s without an event delivered to it
// (`extensions.background.idle.timeout`); an open port does not hold it, a
// message arriving over the port does. `onSuspend` is the last word: nothing
// asynchronous started there finishes after it — unless the listener returns
// it: Firefox waits for that promise (up to `extensions.webextensions.runtime
// .timeout`, 5 s) before it unloads the page.

import { defaultBrowser, type BrowserApi } from './browser-api';

export const INSTALL_REASONS = ['install', 'update', 'browser_update', 'other'] as const;
export type InstallReason = (typeof INSTALL_REASONS)[number];

export interface InstalledDetails {
  readonly reason: InstallReason;
  /** The version before an update; null otherwise. */
  readonly previousVersion: string | null;
  /** A temporary install (about:debugging, web-ext): it is gone with the browser session. */
  readonly temporary: boolean;
}

export interface LifecyclePort {
  onInstalled(listener: (details: InstalledDetails) => void): () => void;
  /** The browser started with the extension already installed. */
  onStartup(listener: () => void): () => void;
  /** The page is about to be unloaded; a promise the listener returns is waited for by Firefox (at most 5 s). */
  onSuspend(listener: () => void | Promise<void>): () => void;
  /** The unload was called off: an event arrived while the page was suspending. */
  onSuspendCanceled(listener: () => void): () => void;
}

const reasonOf = (reason: string): InstallReason => (INSTALL_REASONS as readonly string[]).includes(reason) ? (reason as InstallReason) : 'other';

export function createLifecycle(api: BrowserApi = defaultBrowser()): LifecyclePort {
  const plain = (event: BrowserApi['runtime']['onStartup']) => (listener: () => void): (() => void) => {
    const wrapped = (): void => listener();
    event.addListener(wrapped);
    return () => event.removeListener(wrapped);
  };
  return {
    onInstalled(listener) {
      const wrapped = (details: { readonly reason: string; readonly previousVersion?: string; readonly temporary?: boolean }): void =>
        listener({ reason: reasonOf(details.reason), previousVersion: details.previousVersion ?? null, temporary: details.temporary === true });
      api.runtime.onInstalled.addListener(wrapped);
      return () => api.runtime.onInstalled.removeListener(wrapped);
    },
    onStartup: plain(api.runtime.onStartup),
    onSuspend(listener) {
      // What the listener returns goes back to Firefox: its `runtime.onSuspend` waits for a promise.
      const wrapped = (): void | Promise<void> => listener();
      api.runtime.onSuspend.addListener(wrapped);
      return () => api.runtime.onSuspend.removeListener(wrapped);
    },
    onSuspendCanceled: plain(api.runtime.onSuspendCanceled),
  };
}
