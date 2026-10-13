// B. FBuddy's window bridge (S5 §6.2 B; §2.4: `window-bridge.js:20-30`): the
// page side and the «isolated» side talk by `window.postMessage({[marker]:
// true, direction, name, payload}, "*")`, each with a permanent `message`
// listener that checks the marker and the direction. Every Fansly API response
// body crosses it — any page script or content script that listens to window
// `message` deserializes it too (architecture.md А11: we keep no such listener
// past the handshake). On every start FBuddy's WXT context also announces
// itself on the window and on the document (S5 §2.2).

import { BRIDGE_EVENTS, FBUDDY_BRIDGE_MARKER, FBUDDY_KEYS, type BridgeDirection, type BridgeMessage } from './protocol';

type Listener = (payload: unknown) => void;

export interface Bridge {
  post(name: string, payload: unknown): void;
  /** Subscribes; returns the unsubscribe. */
  on(name: string, listener: Listener): () => void;
  /** Takes the window listener down (a disposed context). */
  close(): void;
}

export type BridgeSide = 'page' | 'content';

const isBridgeMessage = (data: unknown): data is BridgeMessage =>
  typeof data === 'object' && data !== null && (data as Record<string, unknown>)[FBUDDY_BRIDGE_MARKER] === true && typeof (data as BridgeMessage).name === 'string';

/** One side of the bridge on `win`. The page side is also published as `window.__FBUDDY_WINDOW_BRIDGE__`. */
export function createBridge(win: Window, side: BridgeSide): Bridge {
  const outgoing: BridgeDirection = side === 'page' ? 'page-to-content' : 'content-to-page';
  const incoming: BridgeDirection = side === 'page' ? 'content-to-page' : 'page-to-content';
  const listeners = new Map<string, Set<Listener>>();
  const registry = side === 'page' ? FBUDDY_KEYS.bridgeListeners : FBUDDY_KEYS.bridgeContentListeners;
  Reflect.set(win, registry, listeners);
  const onMessage = (event: MessageEvent): void => {
    const data: unknown = event.data;
    if (!isBridgeMessage(data) || data.direction !== incoming) return;
    for (const listener of listeners.get(data.name) ?? []) listener(data.payload);
  };
  win.addEventListener('message', onMessage);
  const bridge: Bridge = {
    post: (name, payload) => {
      const message: BridgeMessage = { [FBUDDY_BRIDGE_MARKER]: true, direction: outgoing, name, payload };
      win.postMessage(message, '*');
    },
    on: (name, listener) => {
      const set = listeners.get(name) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(name, set);
      return () => set.delete(listener);
    },
    close: () => win.removeEventListener('message', onMessage),
  };
  if (side === 'page') Reflect.set(win, FBUDDY_KEYS.bridge, bridge);
  return bridge;
}

/** The page bridge if one stands (the hook posts through it), or a bare post with the same shape. */
export function pageBridgePost(win: Window): (name: string, payload: unknown) => void {
  return (name, payload) => {
    const bridge = Reflect.get(win, FBUDDY_KEYS.bridge) as Bridge | undefined;
    if (bridge !== undefined) bridge.post(name, payload);
    else win.postMessage({ [FBUDDY_BRIDGE_MARKER]: true, direction: 'page-to-content', name, payload } satisfies BridgeMessage, '*');
  };
}

/** WXT's start handshake (S5 §2.2: `<id>:main:wxt:content-script-started` on the window and the document). */
export const WXT_STARTED = 'fbuddy-stand:main:wxt:content-script-started';

export function announceStart(win: Window & typeof globalThis): void {
  const messageId = Math.random().toString(36).slice(2);
  win.postMessage({ type: WXT_STARTED, contentScriptName: 'main', messageId }, '*');
  win.document.dispatchEvent(new win.CustomEvent(WXT_STARTED, { detail: { contentScriptName: 'main', messageId } }));
}

/** 200 KB of text: one flood payload, made once. */
let floodText: string | null = null;
const FLOOD_BYTES = 200 * 1024;
const FLOOD_EVERY_MS = 50;

/** S5 §6.3 item 9: 200-KB payloads at 20 a second for `ms` (the isolated side counts what arrives). */
export function startFlood(bridge: Bridge, ms: number): void {
  if (ms <= 0) return;
  floodText ??= 'x'.repeat(FLOOD_BYTES);
  const until = Date.now() + ms;
  const timer = setInterval(() => {
    if (Date.now() >= until) {
      clearInterval(timer);
      return;
    }
    bridge.post(BRIDGE_EVENTS.flood, { body: floodText });
  }, FLOOD_EVERY_MS);
}
