// Isolated half of the MAIN ↔ isolated bridge (architecture.md §5.3, §14), the
// same for every site (R20 P5: moved here from host-chatspace).
// Handshake: post 'iso-hello', wait for 'main-ready', hand MAIN port2 of a new
// MessageChannel with a nonce; whoever came first, this side connects.
//
// MAIN is untrusted: every frame passes three stages (the host's schema
// module, validation.ts) — plain JSON within the limits, the envelope, the
// schema of its own type — and an answer must carry its pending request's
// type and this document's epoch. A dropped frame bumps a counter by reason.
// Requests time out after 2 s (`callTimeoutMs`) or the deadline the caller
// gives. Events are coalesced to at most 50 per second per type (the latest
// wins) — but for the ones the host names `undroppable`: its freshness and
// receipt events and whatever else must arrive one by one are never
// coalesced or dropped.
//
// The client is generic over the host's registry (`BridgeShape`): the types of
// its requests, answers and events are the host's, and so are its schemas and
// its list of undroppable events. Nothing here names a request or an event
// but `probe`, which the shared boot answers itself.
//
// Only the handshake runs synchronously at document_start; the schemas load
// lazily on the first frame (through the loader the caller hands in:
// validation.ts), so the early start builds none.

import type { BridgeError, BridgeRejectReason, MainProbe } from '@cg/contracts/bridge';
import { BRIDGE_LIMITS } from '@cg/contracts/limits';

import type { BridgeShape, BridgeValidation, EventType, RequestType, ValidationLoader } from './validation';
import { ERRORS_BEFORE_EXECUTION, PROTOCOL_VERSION, TAG_KEY, TAGS } from './wire';

/** Why a call produced no answer: a MAIN refusal, or the transport. */
export type BridgeFailure = BridgeError | 'timeout' | 'closed' | 'invalid-answer';

export class BridgeCallError extends Error {
  constructor(
    readonly failure: BridgeFailure,
    readonly t: string,
  ) {
    super(`bridge ${t}: ${failure}`);
    this.name = 'BridgeCallError';
  }

  /** `no` — MAIN refused before executing anything; `maybe` — a write may have run (§5.3, BRIDGE_WRITE_FAILURES). */
  get executed(): 'no' | 'maybe' {
    return (ERRORS_BEFORE_EXECUTION as readonly string[]).includes(this.failure) ? 'no' : 'maybe';
  }
}

export type BridgeEvent<B extends BridgeShape> = { [T in EventType<B>]: { readonly t: T; readonly payload: B['events'][T] } }[EventType<B>];

export interface BridgeStats {
  /** Frames dropped at the first two stages, by reason (§5.3 «счётчик»). */
  readonly rejected: Readonly<Partial<Record<BridgeRejectReason, number>>>;
  /** Answers whose data failed their type's schema; the call fails with `invalid-answer`. */
  readonly invalidAnswers: number;
  /** Events whose payload failed their type's schema; dropped. */
  readonly invalidEvents: number;
  /** Frames of another document epoch or an old sequence number; dropped. */
  readonly stale: number;
  /** Answers that came after their call had timed out; ignored. */
  readonly late: number;
  readonly timeouts: number;
  /** UI events folded into a later one of the same type. */
  readonly coalesced: number;
}

export interface MainBridgeClient<B extends BridgeShape> {
  /** The document epoch MAIN minted; null until its first frame. */
  readonly documentEpoch: string | null;
  probe(): Promise<MainProbe>;
  /** Rejects with BridgeCallError; `timeoutMs` defaults to the ordinary 2 s. */
  request<T extends RequestType<B>>(t: T, payload: B['requests'][T]['payload'], timeoutMs?: number): Promise<B['requests'][T]['data']>;
  /** Checked events, in order; UI events coalesced. */
  onEvent(listener: (event: BridgeEvent<B>) => void): () => void;
  stats(): BridgeStats;
  close(): void;
}

interface Pending {
  readonly t: string;
  resolve(value: unknown): void;
  reject(error: BridgeCallError): void;
  readonly timer: ReturnType<typeof setTimeout>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

function randomNonce(win: Window): string {
  return Array.from(win.crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Resolves once the MAIN bridge was handed our port; rejects after `timeoutMs` without MAIN. `validation` — where the
 * host's schemas come from (validation.ts); `undroppable` — the host's events that are never coalesced or dropped.
 */
export function connectMainBridge<B extends BridgeShape>(
  win: Window,
  validation: ValidationLoader<BridgeValidation<B>>,
  undroppable: readonly string[],
  timeoutMs: number = BRIDGE_LIMITS.callTimeoutMs,
): Promise<MainBridgeClient<B>> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const targetOrigin = win.location.origin === 'null' ? '*' : win.location.origin;
    const finish = (): void => {
      settled = true;
      win.removeEventListener('message', onWindowMessage, true);
      clearTimeout(timer);
    };
    const onWindowMessage = (event: MessageEvent): void => {
      const data: unknown = event.data;
      if (settled || event.source !== win || !isRecord(data) || data[TAG_KEY] !== TAGS.mainReady || data['v'] !== PROTOCOL_VERSION) return;
      finish();
      const channel = new MessageChannel();
      win.postMessage({ [TAG_KEY]: TAGS.connect, v: PROTOCOL_VERSION, nonce: randomNonce(win) }, targetOrigin, [channel.port2]);
      resolve(createClient(channel.port1, win, validation, undroppable));
    };
    const timer = setTimeout(() => {
      if (settled) return;
      finish();
      reject(new Error('main-bridge-timeout'));
    }, timeoutMs);
    win.addEventListener('message', onWindowMessage, true);
    win.postMessage({ [TAG_KEY]: TAGS.isoHello, v: PROTOCOL_VERSION }, targetOrigin);
  });
}

function createClient<B extends BridgeShape>(port: MessagePort, win: Window, validation: ValidationLoader<BridgeValidation<B>>, undroppable: readonly string[]): MainBridgeClient<B> {
  let nextId = 1;
  let seq = 0;
  let documentEpoch: string | null = null;
  let lastSeq = -1;
  let closed = false;
  const pending = new Map<number, Pending>();
  const listeners = new Set<(event: BridgeEvent<B>) => void>();
  const rejected: Partial<Record<BridgeRejectReason, number>> = {};
  const counts = { invalidAnswers: 0, invalidEvents: 0, stale: 0, late: 0, timeouts: 0, coalesced: 0 };
  /** Frames are checked one after another: the schemas load once, the order of events holds. */
  let chain: Promise<void> = Promise.resolve();
  const lastDelivered: Partial<Record<string, number>> = {};
  const held: Partial<Record<string, BridgeEvent<B>>> = {};
  const now = (): number => win.performance.now();

  const deliver = (event: BridgeEvent<B>): void => {
    lastDelivered[event.t] = now();
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch {
        // A listener's failure is its own; the next one still hears the event.
      }
    }
  };

  /** UI events: at most one per type every 20 ms, the latest wins (§5.3). */
  const dispatch = (event: BridgeEvent<B>): void => {
    if (undroppable.includes(event.t)) return deliver(event);
    const gap = 1000 / BRIDGE_LIMITS.uiEventsPerSecond;
    const wait = (lastDelivered[event.t] ?? -Infinity) + gap - now();
    if (wait <= 0 && held[event.t] === undefined) return deliver(event);
    if (held[event.t] !== undefined) counts.coalesced += 1;
    else
      setTimeout(
        () => {
          const latest = held[event.t];
          delete held[event.t];
          if (latest && !closed) deliver(latest);
        },
        Math.max(0, wait),
      );
    held[event.t] = event;
  };

  const handle = (raw: unknown, check: BridgeValidation<B>): void => {
    const frame = check.checkFrame(raw);
    if (frame.kind === 'reject') {
      rejected[frame.reason] = (rejected[frame.reason] ?? 0) + 1;
      return;
    }
    const seqOf = (raw as { seq: number }).seq;
    if ((documentEpoch !== null && frame.documentEpoch !== documentEpoch) || seqOf <= lastSeq) {
      counts.stale += 1;
      return;
    }
    documentEpoch = frame.documentEpoch;
    lastSeq = seqOf;
    if (frame.kind === 'evt') {
      const payload = check.parseEvent(frame.t, frame.payload);
      if (payload === null) counts.invalidEvents += 1;
      else dispatch({ t: frame.t, payload });
      return;
    }
    const entry = pending.get(frame.id);
    if (!entry || entry.t !== frame.t) {
      counts.late += 1;
      return;
    }
    pending.delete(frame.id);
    clearTimeout(entry.timer);
    if (!frame.ok) return entry.reject(new BridgeCallError(frame.err, frame.t));
    // A `null` answer that its schema allows is an answer (`fan`, `chatWindow`, `readTail`: «not there yet»).
    const answer = check.parseAnswer(frame.t, frame.data);
    if (!answer.ok) {
      counts.invalidAnswers += 1;
      return entry.reject(new BridgeCallError('invalid-answer', frame.t));
    }
    entry.resolve(answer.data);
  };

  port.onmessage = (event: MessageEvent) => {
    const raw: unknown = event.data;
    chain = chain.then(async () => {
      if (!closed) handle(raw, await validation());
    });
  };

  const request = <T extends RequestType<B>>(t: T, payload: B['requests'][T]['payload'], timeoutMs: number = BRIDGE_LIMITS.callTimeoutMs): Promise<B['requests'][T]['data']> =>
    new Promise((resolve, reject) => {
      if (closed) return reject(new BridgeCallError('closed', t));
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        counts.timeouts += 1;
        reject(new BridgeCallError('timeout', t));
      }, timeoutMs);
      pending.set(id, { t, resolve: (value) => resolve(value), reject, timer });
      port.postMessage({ v: PROTOCOL_VERSION, kind: 'req', id, t, documentEpoch, seq: seq++, payload });
    });

  return {
    get documentEpoch() {
      return documentEpoch;
    },
    // The one request every registry has: the shared boot answers it itself (contracts MainProbeSchema).
    probe: () => request('probe', {}) as Promise<MainProbe>,
    request,
    onEvent(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    stats: () => ({ rejected: { ...rejected }, ...counts }),
    close() {
      if (closed) return;
      closed = true;
      for (const [id, entry] of pending) {
        clearTimeout(entry.timer);
        pending.delete(id);
        entry.reject(new BridgeCallError('closed', entry.t));
      }
      listeners.clear();
      port.close();
    },
  };
}
