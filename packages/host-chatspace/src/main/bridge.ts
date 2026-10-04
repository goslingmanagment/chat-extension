// The MAIN bridge boot (architecture.md §5.3, §11): a dependency-free bundle in
// the page's own world at document_start. On install (≤ 1 ms) it only
// captures natives, mints the document epoch and starts the handshake:
// 1. MAIN posts {cg: 'main-ready', v} and listens for 'iso-hello';
// 2. the isolated script posts 'iso-hello' and listens for 'main-ready';
// 3. whoever comes second, the isolated side sends port2 with {cg: 'connect', v, nonce};
// 4. MAIN accepts only the first valid 'connect' and drops its window listener.
//
// The boot owns the port: the envelope check, write deduplication by request
// id, the answer frames and the event throttle (≤ 50 per second per type,
// latest wins; an unchanged state — route, composer, contract — is not
// repeated, a signal — accounts, chatCache — always goes out; freshness and
// receipt events bypass the throttle). It answers `probe` itself;
// everything else goes to the runtime (runtime.ts) once one is
// attached — before that the answer is `not-ready`. The runtime reads and
// writes ChatSpace and does nothing before DOMContentLoaded, so the work at
// document_start stays the boot's (≤ 1 ms, §11). The extension ships both in
// one bundle (`installMainBridge(win, { runtime: createMainRuntime })`,
// ≤ 10 KiB, decision X11); a second MAIN script calling `attachMainRuntime()`
// stays possible but unused.
//
// The page sees all of this and can post anything on the port, so the
// isolated side checks every frame from MAIN; MAIN checks every request by
// hand and holds no secrets.

import { count, int, is, isPlain, isToken, orNull, shape, type Plain } from './check';
import {
  ERR_BAD_REQUEST,
  ERR_INTERNAL,
  ERR_NOT_READY,
  ERR_STALE_DOCUMENT,
  FRAME_FALLBACK_MS,
  KIND_EVT,
  KIND_RES,
  PROTOCOL_VERSION,
  RUNTIME_KEY,
  STATE_EVENTS,
  TAG_CONNECT,
  TAG_ISO_HELLO,
  TAG_MAIN_READY,
  UI_EVENT_GAP_MS,
  WRITE_MEMORY,
  WRITE_REQUESTS,
  WS_TAP_KEY,
} from './protocol';

/** What the boot lends the runtime: natives captured at load, the epoch and the event channel. */
export interface MainContext {
  readonly win: Window;
  readonly documentEpoch: string;
  /** performance.now as captured at load. */
  readonly now: () => number;
  readonly setTimer: (callback: () => void, ms: number) => unknown;
  /** One frame, or a timer when the tab gets no frames. */
  readonly frame: (callback: () => void) => void;
  /**
   * A UI event: throttled per type, the latest wins (§5.3). A state event
   * (STATE_EVENTS) equal to the last one sent is not repeated; a signal
   * (`accounts`, `chatCache`: «something changed, read again») always goes out.
   */
  readonly emit: (t: string, build: () => Plain) => void;
  /**
   * An event that is never throttled, coalesced or dropped (§5.3 «события
   * свежести и квитанций не отбрасываются никогда»): incoming facts,
   * coverage, human sends and the states of a preview send.
   */
  readonly post: (t: string, payload: Plain) => void;
}

/** The runtime answers a request: data, a promise of data, or a BRIDGE_ERRORS string. */
export interface MainRuntime {
  handle(t: string, payload: unknown): unknown;
  dispose(): void;
}
export type MainRuntimeFactory = (context: MainContext) => MainRuntime;

export interface MainBridgeHandle {
  /** Time spent installing the bridge, ms (§11 budget: ≤ 1 ms at document_start). */
  readonly installMs: number;
  /** Minted once per document; changes on reload. */
  readonly documentEpoch: string;
  /** Whether a port is connected. */
  isConnected(): boolean;
  /** Attaches the runtime; only the first one counts. */
  attach(factory: MainRuntimeFactory): boolean;
  dispose(): void;
}

export interface MainBridgeOptions {
  /** The runtime of the same bundle, attached at once. */
  readonly runtime?: MainRuntimeFactory;
  /**
   * Leave a one-shot hook for a later MAIN script (`attachMainRuntime`) under
   * a non-enumerable Symbol.for key, like the WS tap's hand-off. The page can
   * see it too: at worst it takes the hook first and the bridge stays without
   * a runtime (host not ready) — nothing the page could not do anyway (§14).
   */
  readonly exposeRuntimeHook?: boolean;
}

/** The request envelope (contracts BridgeRequestSchema minus the payload). */
export const isRequestEnvelope = shape({ v: is(1), kind: is('req'), id: int(1), t: (value) => typeof value === 'string', documentEpoch: orNull(isToken), seq: count, payload: () => true });

const HEX = '0123456789abcdef';

export function installMainBridge(win: Window = window, options: MainBridgeOptions = {}): MainBridgeHandle {
  const now = win.performance.now.bind(win.performance);
  const startedAt = now();
  const readyStateAtStart = win.document.readyState;
  const post = win.postMessage.bind(win);
  const listen = win.addEventListener.bind(win);
  const unlisten = win.removeEventListener.bind(win);
  const setTimer = win.setTimeout.bind(win);
  const nextFrame = win.requestAnimationFrame.bind(win);
  const stringify = JSON.stringify;
  // eslint-disable-next-line @typescript-eslint/unbound-method -- native captured at load, always invoked with .call
  const hasOwn = Object.prototype.hasOwnProperty;
  const tapKey = Symbol.for(WS_TAP_KEY);
  // Minted on first use, not at install: the first crypto call of a fresh page realm costs ~0.15 ms (§11).
  let epoch = '';
  const documentEpoch = (): string => {
    if (!epoch) for (const byte of win.crypto.getRandomValues(new Uint8Array(12))) epoch += HEX.charAt(byte >> 4) + HEX.charAt(byte & 15);
    return epoch;
  };
  const targetOrigin = win.location.origin === 'null' ? '*' : win.location.origin;

  let port: MessagePort | null = null;
  let installMs = 0;
  let seq = 0;
  let runtime: MainRuntime | null = null;
  let disposed = false;
  const writes = new Map<number, Promise<unknown>>();
  const lastSent: Record<string, string> = {};
  const lastAt: Record<string, number> = {};
  const queued: Record<string, () => Plain> = {};

  const send = (frame: Plain): void => {
    if (!disposed) port?.postMessage({ v: PROTOCOL_VERSION, ...frame, documentEpoch: documentEpoch(), seq: seq++ });
  };

  const context: MainContext = {
    win,
    get documentEpoch() {
      return documentEpoch();
    },
    now,
    setTimer,
    frame: (callback) => {
      let done = false;
      const run = (): void => {
        if (done) return;
        done = true;
        callback();
      };
      setTimer(run, FRAME_FALLBACK_MS);
      nextFrame(run);
    },
    emit: (t, build) => {
      if (!port) return;
      const flush = (): void => {
        const latest = queued[t];
        delete queued[t];
        if (!latest) return;
        const payload = latest();
        if (STATE_EVENTS.includes(t)) {
          const text = stringify(payload);
          if (lastSent[t] === text) return;
          lastSent[t] = text;
        }
        lastAt[t] = now();
        send({ kind: KIND_EVT, t, payload });
      };
      const waiting = t in queued;
      queued[t] = build;
      if (waiting) return;
      const wait = (lastAt[t] ?? -1e9) + UI_EVENT_GAP_MS - now();
      if (wait > 0) setTimer(flush, wait);
      else flush();
    },
    post: (t, payload) => send({ kind: KIND_EVT, t, payload }),
  };

  const onPortMessage = (event: MessageEvent): void => {
    const data: unknown = event.data;
    if (!isRequestEnvelope(data)) return;
    const { id, t, payload, documentEpoch: theirs } = data as { id: number; t: string; payload: unknown; documentEpoch: string | null };
    let outcome: unknown;
    if (theirs !== null && theirs !== documentEpoch()) outcome = ERR_STALE_DOCUMENT;
    else if (writes.has(id)) outcome = writes.get(id);
    else if (t === 'probe') outcome = isPlain(payload) && !Object.keys(payload).length ? { v: PROTOCOL_VERSION, readyStateAtStart, installMs, wsTap: hasOwn.call(win, tapKey) } : ERR_BAD_REQUEST;
    else {
      try {
        outcome = runtime ? runtime.handle(t, payload) : ERR_NOT_READY;
      } catch {
        outcome = ERR_INTERNAL;
      }
      if (WRITE_REQUESTS.includes(t)) {
        writes.set(id, (outcome = Promise.resolve(outcome).catch(() => ERR_INTERNAL)));
        if (writes.size > WRITE_MEMORY) writes.delete(writes.keys().next().value as number);
      }
    }
    void Promise.resolve(outcome).then(
      (value) => send(typeof value === 'string' ? { kind: KIND_RES, id, t, ok: false, err: value } : { kind: KIND_RES, id, t, ok: true, data: value ?? null }),
      () => send({ kind: KIND_RES, id, t, ok: false, err: ERR_INTERNAL }),
    );
  };

  const announce = (): void => post({ cg: TAG_MAIN_READY, v: PROTOCOL_VERSION }, targetOrigin);

  const onWindowMessage = (event: MessageEvent): void => {
    const data: unknown = event.data;
    if (event.source !== win || !isPlain(data) || data['v'] !== PROTOCOL_VERSION) return;
    if (data['cg'] === TAG_ISO_HELLO) return announce();
    const received = event.ports[0];
    if (data['cg'] !== TAG_CONNECT || port || !received || typeof data['nonce'] !== 'string') return;
    port = received;
    unlisten('message', onWindowMessage, true);
    port.onmessage = onPortMessage;
  };

  const attach = (factory: MainRuntimeFactory): boolean => {
    if (runtime || disposed) return false;
    try {
      runtime = factory(context);
    } catch {
      return false;
    }
    return true;
  };

  listen('message', onWindowMessage, true);
  announce();
  if (options.runtime) attach(options.runtime);
  if (options.exposeRuntimeHook) Object.defineProperty(win, Symbol.for(RUNTIME_KEY), { value: attach, configurable: true });
  installMs = now() - startedAt;

  return {
    installMs,
    get documentEpoch() {
      return documentEpoch();
    },
    isConnected: () => port !== null,
    attach,
    dispose: () => {
      runtime?.dispose();
      disposed = true;
      unlisten('message', onWindowMessage, true);
      port?.close();
      port = null;
    },
  };
}

/** A later MAIN script attaches the runtime through the boot's one-shot hook; false when there is none or it was taken. */
export function attachMainRuntime(factory: MainRuntimeFactory, win: Window = window): boolean {
  const key = Symbol.for(RUNTIME_KEY);
  const hook = Reflect.get(win, key) as ((factory: MainRuntimeFactory) => boolean) | undefined;
  Reflect.deleteProperty(win, key);
  return typeof hook === 'function' && hook(factory);
}
