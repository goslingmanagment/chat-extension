// runtime.Port plumbing for the tab ↔ background channel (§5.4). The
// background trusts only its own senders: same extension id, top frame.
// Message shapes are validated by the callers with @cg/contracts schemas.

import { browser, type Browser } from '@wxt-dev/browser';
import { TAB_PORT_NAME } from '@cg/contracts';

export interface TabPortClient {
  post(message: unknown): void;
  onMessage(handler: (message: unknown) => void): void;
  /** Fires when the background goes away or the extension is reloaded under the tab. */
  onDisconnect(handler: () => void): void;
  close(): void;
}

export function connectTabPort(): TabPortClient {
  const port = browser.runtime.connect({ name: TAB_PORT_NAME });
  return {
    post: (message) => port.postMessage(message),
    onMessage: (handler) => port.onMessage.addListener((message: unknown) => handler(message)),
    onDisconnect: (handler) => port.onDisconnect.addListener(() => handler()),
    close: () => port.disconnect(),
  };
}

export interface TabPortServerSide {
  readonly tabId: number | null;
  readonly url: string | null;
  post(message: unknown): void;
  onMessage(handler: (message: unknown) => void): void;
  onDisconnect(handler: () => void): void;
}

/** Background side: accepts only `cg-tab` ports from this extension's top-frame content scripts. */
export function onTabPortConnect(handler: (port: TabPortServerSide) => void): void {
  browser.runtime.onConnect.addListener((port: Browser.runtime.Port) => {
    if (port.name !== TAB_PORT_NAME) return;
    const sender = port.sender;
    if (sender?.id !== browser.runtime.id || sender.frameId !== 0) {
      port.disconnect();
      return;
    }
    handler({
      tabId: sender.tab?.id ?? null,
      url: sender.url ?? null,
      post: (message) => port.postMessage(message),
      onMessage: (listener) => port.onMessage.addListener((message: unknown) => listener(message)),
      onDisconnect: (listener) => port.onDisconnect.addListener(() => listener()),
    });
  });
}
