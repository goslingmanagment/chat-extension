// The MAIN half of the handshake (architecture.md §5.3):
// 1. on start MAIN posts {cg: 'main-ready', v} and listens for 'iso-hello';
// 2. the isolated script posts 'iso-hello' and listens for 'main-ready';
// 3. whoever comes second, the isolated side creates a MessageChannel and sends
//    port2 with {cg: 'connect', v, nonce};
// 4. MAIN accepts only the first valid 'connect' and drops its window listener.
// Natives are captured at load, before the page can patch them.
//
// Frames on the port follow the contracts envelope (BridgeRequestSchema /
// BridgeResponseSchema): every answer carries the request's id and type, this
// document's epoch and a per-document sequence number.
//
// R00 answers one request, `probe`. R09 adds the rest of ToMain/FromMain.

import { ERR_UNKNOWN_REQUEST, KIND_REQ, KIND_RES, PROTOCOL_VERSION, TAG_CONNECT, TAG_ISO_HELLO, TAG_MAIN_READY, WS_TAP_KEY } from './protocol';

export interface MainBridgeHandle {
  /** Time spent installing the bridge, ms (§11 budget: ≤ 1 ms at document_start). */
  readonly installMs: number;
  /** Minted once per document; changes on reload. */
  readonly documentEpoch: string;
  /** Whether a port is connected. */
  isConnected(): boolean;
  dispose(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function mintDocumentEpoch(crypto: Crypto): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let epoch = '';
  for (const byte of bytes) epoch += byte.toString(16).padStart(2, '0');
  return epoch;
}

export function installMainBridge(win: Window = window): MainBridgeHandle {
  const now = win.performance.now.bind(win.performance);
  const startedAt = now();
  const readyStateAtStart = win.document.readyState;
  const post = win.postMessage.bind(win);
  const addWindowListener = win.addEventListener.bind(win);
  const removeWindowListener = win.removeEventListener.bind(win);
  // eslint-disable-next-line @typescript-eslint/unbound-method -- native captured at load, always invoked with .call
  const hasOwn = Object.prototype.hasOwnProperty;
  const tapKey = Symbol.for(WS_TAP_KEY);
  const documentEpoch = mintDocumentEpoch(win.crypto);
  const origin = win.location.origin;
  const targetOrigin = origin === 'null' ? '*' : origin;

  let port: MessagePort | null = null;
  let installMs = 0;
  let seq = 0;

  const reply = (id: number, t: string, body: Record<string, unknown>): void => {
    port?.postMessage({ v: PROTOCOL_VERSION, kind: KIND_RES, id, t, documentEpoch, seq: seq++, ...body });
  };

  const announce = (): void => {
    post({ cg: TAG_MAIN_READY, v: PROTOCOL_VERSION }, targetOrigin);
  };

  const onPortMessage = (event: MessageEvent): void => {
    const data: unknown = event.data;
    if (!isRecord(data) || data['v'] !== PROTOCOL_VERSION || data['kind'] !== KIND_REQ) return;
    const id = data['id'];
    const t = data['t'];
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1 || typeof t !== 'string') return;
    if (t === 'probe') {
      reply(id, t, {
        ok: true,
        data: {
          v: PROTOCOL_VERSION,
          readyStateAtStart,
          installMs,
          wsTap: hasOwn.call(win, tapKey),
        },
      });
      return;
    }
    reply(id, t, { ok: false, err: ERR_UNKNOWN_REQUEST });
  };

  const onWindowMessage = (event: MessageEvent): void => {
    if (event.source !== win) return;
    const data: unknown = event.data;
    if (!isRecord(data) || data['v'] !== PROTOCOL_VERSION) return;
    if (data['cg'] === TAG_ISO_HELLO) {
      announce();
      return;
    }
    if (data['cg'] !== TAG_CONNECT || port !== null) return;
    const received = event.ports[0];
    if (received === undefined || typeof data['nonce'] !== 'string') return;
    port = received;
    removeWindowListener('message', onWindowMessage, true);
    port.onmessage = onPortMessage;
  };

  addWindowListener('message', onWindowMessage, true);
  announce();
  installMs = now() - startedAt;

  return {
    installMs,
    documentEpoch,
    isConnected: () => port !== null,
    dispose: () => {
      removeWindowListener('message', onWindowMessage, true);
      port?.close();
      port = null;
    },
  };
}
