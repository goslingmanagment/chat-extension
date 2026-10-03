// Raw runtime.Port plumbing for the tab ↔ background channel (§5.4), kept for
// the R00 composition roots and the liveness exchange (`tab-liveness`). The
// typed RPC with the full sender rules is rpc-background.ts / rpc-tab.ts /
// rpc-page.ts; the integrator moves the composition onto it.

import { TAB_PORT_NAME } from '@cg/contracts/tab-protocol';

import { defaultBrowser, type BrowserApi, type PortApi } from './browser-api';

export interface TabPortClient {
  post(message: unknown): void;
  onMessage(handler: (message: unknown) => void): void;
  /** Fires when the background goes away or the extension is reloaded under the tab. */
  onDisconnect(handler: () => void): void;
  close(): void;
}

export function connectTabPort(api: BrowserApi = defaultBrowser()): TabPortClient {
  const port = api.runtime.connect({ name: TAB_PORT_NAME });
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
export function onTabPortConnect(handler: (port: TabPortServerSide) => void, api: BrowserApi = defaultBrowser()): void {
  api.runtime.onConnect.addListener((port: PortApi) => {
    if (port.name !== TAB_PORT_NAME) return;
    const sender = port.sender;
    if (sender?.id !== api.runtime.id || sender.frameId !== 0) {
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
