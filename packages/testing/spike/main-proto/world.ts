// The shared state of the MAIN prototype: epochs, the store, the emitter, metrics.

import type { Emitter } from './emitter';
import type { Natives } from './natives';
import type { Store } from './observe';

export interface Metrics {
  frames: number;
  frameMs: number;
  frameMax: number;
  xhrs: number;
  xhrParsed: number;
  xhrMs: number;
  xhrMax: number;
  deferred: number;
  deferredMs: number;
  deferredMax: number;
  losses: number;
}

export interface World {
  readonly win: Window & typeof globalThis;
  readonly n: Natives;
  readonly store: Store;
  readonly emit: Emitter;
  readonly guard: <A extends unknown[]>(site: string, fn: (...args: A) => unknown) => (...args: A) => void;
  /** Socket epoch: the number of the page socket instance; confirmed when its t:1 came. */
  socket: { epoch: number; confirmed: boolean; seen: boolean };
  /** Monotonic number of every observation in this document (§5.6 merge order). */
  seq: number;
  routeEpoch: number;
  accountMeSeen: boolean;
  readonly m: Metrics;
  /** Called with own echoes (5/1 from the creator) — the gesture join (§5.9). */
  onEcho: (msgId: string, groupId: string, content: string) => void;
  /** Other service events (participants 4/6–4/8). */
  onService: (sid: number, type: number, e: Record<string, unknown>) => void;
}

export const API_PREFIX_RE = /^https?:\/\/apiv3\.fansly\.(?:com|test)(?::\d+)?\/api\/v1\//;
export const WS_HOST_RE = /^wsv3\.fansly\.(?:com|test)$/;
