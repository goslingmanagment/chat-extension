// Isolated half of the MAIN ↔ isolated handshake (architecture.md §5.3).
// MAIN is untrusted: every frame first passes checkBridgeFrame (plain JSON
// within the limits), then the envelope schema, and an answer must carry the
// pending request's own type before its data meets that type's schema.
// Requests time out after BRIDGE_LIMITS.callTimeoutMs. R09 adds events,
// the remaining request types, and rejection counters.

import {
  BRIDGE_LIMITS,
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_TAGS,
  BridgeResponseSchema,
  MainProbeSchema,
  checkBridgeFrame,
  type MainProbe,
  type ToMainType,
} from '@cg/contracts';

export interface MainBridgeClient {
  probe(): Promise<MainProbe>;
  close(): void;
}

interface Pending {
  readonly t: ToMainType;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function randomNonce(win: Window): string {
  const bytes = new Uint8Array(16);
  win.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Resolves once the MAIN bridge accepted our port; rejects after `timeoutMs`. */
export function connectMainBridge(win: Window, timeoutMs: number = BRIDGE_LIMITS.callTimeoutMs): Promise<MainBridgeClient> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const targetOrigin = win.location.origin === 'null' ? '*' : win.location.origin;

    const onWindowMessage = (event: MessageEvent): void => {
      if (settled || event.source !== win) return;
      const data: unknown = event.data;
      if (!isRecord(data) || data['cg'] !== BRIDGE_TAGS.mainReady || data['v'] !== BRIDGE_PROTOCOL_VERSION) return;
      settled = true;
      win.removeEventListener('message', onWindowMessage, true);
      clearTimeout(timer);
      const channel = new MessageChannel();
      win.postMessage(
        { cg: BRIDGE_TAGS.connect, v: BRIDGE_PROTOCOL_VERSION, nonce: randomNonce(win) },
        targetOrigin,
        [channel.port2],
      );
      resolve(createClient(channel.port1, timeoutMs));
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      win.removeEventListener('message', onWindowMessage, true);
      reject(new Error('main-bridge-timeout'));
    }, timeoutMs);

    win.addEventListener('message', onWindowMessage, true);
    win.postMessage({ cg: BRIDGE_TAGS.isoHello, v: BRIDGE_PROTOCOL_VERSION }, targetOrigin);
  });
}

function createClient(port: MessagePort, timeoutMs: number): MainBridgeClient {
  let nextId = 1;
  let seq = 0;
  let documentEpoch: string | null = null;
  const pending = new Map<number, Pending>();

  port.onmessage = (event: MessageEvent) => {
    const data: unknown = event.data;
    if (!checkBridgeFrame(data).ok) return;
    const frame = BridgeResponseSchema.safeParse(data);
    if (!frame.success) return;
    const entry = pending.get(frame.data.id);
    if (!entry || entry.t !== frame.data.t) return;
    pending.delete(frame.data.id);
    clearTimeout(entry.timer);
    documentEpoch = frame.data.documentEpoch;
    if (frame.data.ok) entry.resolve(frame.data.data);
    else entry.reject(new Error(`main-error:${frame.data.err}`));
  };

  const request = (t: ToMainType, payload: Record<string, unknown>): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('main-call-timeout'));
      }, timeoutMs);
      pending.set(id, { t, resolve, reject, timer });
      port.postMessage({ v: BRIDGE_PROTOCOL_VERSION, kind: 'req', id, t, documentEpoch, seq: seq++, payload });
    });

  return {
    async probe() {
      const probe = MainProbeSchema.safeParse(await request('probe', {}));
      if (!probe.success) throw new Error('main-probe-invalid');
      return probe.data;
    },
    close() {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error('main-bridge-closed'));
      }
      pending.clear();
      port.close();
    },
  };
}
