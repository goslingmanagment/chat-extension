// A Fansly-shaped page for the package's Node tests (R20 P7a, P7b): the page's
// WebSocket and XMLHttpRequest as natives look (statics, prototype, an
// instance a test makes receive frames and answers), window messaging over
// Node's MessageChannel (happy-dom sets no `source`), and the isolated side as
// Fansly's starter connects it — the shared client over Fansly's schemas, so
// every batch and answer a test sees passed the checks the isolated side
// makes. Frames and answers as Fansly sends them (fansly-web.md §4, §5).
// Test-only: no bundle imports this file. Firefox's own natives, the stand and
// the FBuddy-like neighbour are the e2e's (suite-fansly-tap).

import type { FanslyBatch, FanslyHealth, FanslyState } from '@cg/contracts/bridge-messages-fansly';
import { connectMainBridge, type MainBridgeClient } from '@cg/host-kit/isolated/bridge-client';

import type { FanslyBridge } from '../isolated/bridge-client';
import { loadValidation } from '../isolated/validation';
import { UNDROPPABLE_EVENTS } from '../isolated/wire';
import { installFanslyMain, type FanslyNetwork } from '../main/index';

export const CREATOR = '700000000000000001';
export const FAN = '700000000000000002';
export const GROUP = '700000000000000010';
export const OTHER_GROUP = '700000000000000011';
export const SOCKET = 'wss://wsv3.fansly.com?v=3';
export const API = 'https://apiv3.fansly.com/api/v1';
export const NETWORK: FanslyNetwork = { socketHosts: ['wsv3.fansly.com'], apiOrigins: ['https://apiv3.fansly.com'] };

// ── The page: its socket and its XHR, as natives look ─────────────────────

/** The page's socket: a native-like constructor (statics, prototype); a test makes it receive frames. */
export class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static made: FakeWebSocket[] = [];
  readonly url: string;
  constructor(url: string | URL, protocols?: string | string[]) {
    super();
    if (String(url) === 'wss://throws') throw new SyntaxError('the native refuses this address');
    void protocols;
    this.url = String(url);
    FakeWebSocket.made.push(this);
  }
  send(): void {
    throw new Error('MAIN never sends on the page’s socket');
  }
  receive(data: string | ArrayBuffer): void {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
  drop(): void {
    this.dispatchEvent(new Event('close'));
  }
}

/** The page's XHR: `send()` fires `loadstart` within it; `respond` fires `load`, then `loadend` (after every `load` listener). */
export class FakeXMLHttpRequest extends EventTarget {
  static readonly DONE = 4;
  responseURL = '';
  status = 0;
  responseType: XMLHttpRequestResponseType = '';
  private body = '';
  private address = '';
  open(_method: string, url: string): void {
    this.address = url;
  }
  send(): void {
    this.dispatchEvent(new Event('loadstart'));
  }
  get responseText(): string {
    if (this.responseType !== '' && this.responseType !== 'text') throw new Error('InvalidStateError');
    return this.body;
  }
  respond(status: number, body: string): void {
    this.responseURL = this.address;
    this.status = status;
    this.body = body;
    this.dispatchEvent(new Event('load'));
    this.dispatchEvent(new Event('loadend'));
  }
}

export type PageWindow = Window & typeof globalThis;
type Listener = (event: { source: unknown; data: unknown; ports: readonly MessagePort[] }) => void;

/** What a test does to the page itself, beside its constructors. */
export interface PageControls {
  /** Window listeners now: the page's own world, where a switch of ours would listen. */
  listening(): number;
  /** The page comes back from the back-forward cache (`persisted`), or is shown anew. */
  show(persisted: boolean): void;
}

/** A page-like window: its constructors, and window messaging over Node's MessageChannel; `clock` — its `performance.now`. */
export function page(readyState: DocumentReadyState = 'loading', clock: () => number = () => performance.now()): PageWindow {
  const listeners = new Set<Listener>();
  /** `pageshow`: the back-forward cache (§5.6) — no switch of anything. */
  const shows = new Set<(event: Event) => void>();
  FakeWebSocket.made = [];
  const win = {
    location: { origin: 'https://fansly.com', href: 'https://fansly.com/messages' },
    document: { readyState },
    performance: { now: clock },
    crypto,
    URL,
    // The natives' addEventListener, as MAIN captures it: on the page's instances Node's own, on the window the fake's.
    EventTarget: {
      prototype: {
        addEventListener(this: unknown, type: string, listener: (event: Event) => void) {
          if (this !== win) return EventTarget.prototype.addEventListener.call(this as EventTarget, type, listener);
          if (type === 'pageshow') shows.add(listener);
          else listeners.add(listener as unknown as Listener);
        },
      },
    },
    WebSocket: FakeWebSocket,
    XMLHttpRequest: FakeXMLHttpRequest,
    setTimeout: (callback: () => void, ms?: number) => setTimeout(callback, ms),
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
    listening: () => listeners.size,
    show: (persisted: boolean) => {
      for (const listener of [...shows]) listener(Object.assign(new Event('pageshow'), { persisted }));
    },
    dispatchEvent: (event: Event) => {
      for (const listener of [...listeners]) listener({ source: null, data: (event as CustomEvent).detail, ports: [] });
      return true;
    },
    addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
    postMessage(data: unknown, _origin: string, transfer: MessagePort[] = []) {
      const event = { source: win, data: structuredClone(data), ports: transfer };
      setTimeout(() => {
        for (const listener of [...listeners]) listener(event);
      }, 0);
    },
  };
  return win as unknown as PageWindow;
}

export const controls = (win: PageWindow): PageControls => win as unknown as PageControls;

// ── Frames and answers as Fansly sends them ───────────────────────────────

export const service = (serviceId: number, event: Record<string, unknown>): string => JSON.stringify({ t: 10000, d: JSON.stringify({ serviceId, event: JSON.stringify(event) }) });
export const session = JSON.stringify({ t: 1, d: JSON.stringify({ session: { id: '1', accountId: CREATOR, token: 'secret', deviceId: null } }) });

/** A message as the page's answers and frames carry it. */
export const message = (id: string, senderId = FAN, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  type: 1,
  content: 'hello',
  groupId: GROUP,
  senderId,
  correlationId: null,
  inReplyTo: null,
  createdAt: 1_790_000_000,
  attachments: [],
  totalTipAmount: 0,
  ...over,
});
/** 5/1: a new message. */
export const newMessage = (id: string, senderId = FAN, over: Record<string, unknown> = {}): string => service(5, { type: 1, message: message(id, senderId, over) });
/** 5/10: a message deleted, as it was (its `type` decides the cascade). */
export const deletion = (id: string, over: Record<string, unknown> = {}): string => service(5, { type: 10, message: message(id, FAN, over) });
/** 4/6 a member added, 4/7 removed. */
export const member = (type: 6 | 7, groupId: string, userId: string): string => service(4, { type, groupUser: { groupId, userId } });
export const ok = (response: unknown): string => JSON.stringify({ success: true, response });

/** A group as `/group/<id>/` and the inbox's `aggregationData.groups[]` carry it. */
export const group = (id: string, users: readonly string[], over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  type: 1,
  groupFlags: 0,
  createdBy: CREATOR,
  users: users.map((userId) => ({ groupId: id, userId, type: 0, permissionFlags: 0 })),
  lastMessage: null,
  dmPermissionFlags: [],
  accountDmPermissionFlags: { flags: 0, metadata: '{}' },
  ...over,
});

// ── The isolated side, as Fansly's starter connects it ────────────────────

export interface Connected {
  readonly win: PageWindow;
  readonly main: ReturnType<typeof installFanslyMain>;
  readonly client: MainBridgeClient<FanslyBridge>;
  readonly batches: FanslyBatch[];
  readonly gaps: unknown[];
  /** Acknowledge every batch as it comes (a consumer that keeps up), or none (a blocked one). */
  acking: boolean;
  events(): Array<{ t: string; p: Record<string, unknown> }>;
  state(): Promise<FanslyState>;
  health(): Promise<FanslyHealth>;
}

/** Fansly's MAIN in `win` and the isolated client connected to it; `cleanups` gets what undoes both. */
export async function connect(win: PageWindow, cleanups: Array<() => void>, options: { acking?: boolean; start?: boolean } = {}): Promise<Connected> {
  const main = installFanslyMain(win, NETWORK);
  const client = await connectMainBridge<FanslyBridge>(win, loadValidation, UNDROPPABLE_EVENTS, 1000);
  cleanups.push(() => client.close(), () => main.dispose());
  const connected: Connected = {
    win,
    main,
    client,
    batches: [],
    gaps: [],
    acking: options.acking ?? true,
    events: () => connected.batches.flatMap((batch) => batch.events as Array<{ t: string; p: Record<string, unknown> }>),
    state: (): Promise<FanslyState> => client.request('fx.state', {}),
    health: (): Promise<FanslyHealth> => client.request('fx.health', {}),
  };
  client.onEvent((event) => {
    if (event.t === 'fx.batch') {
      connected.batches.push(event.payload);
      if (connected.acking) void client.request('fx.ack', { n: event.payload.n }).catch(() => undefined);
    } else if (event.t === 'fx.gap') connected.gaps.push(event.payload);
  });
  if (options.start ?? true) await connected.state();
  return connected;
}

/** Lets the port, the timers and the client's lazy schemas run. */
export const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
};

/** The page makes a request: `loadstart` now; the test answers it later (`respond`). */
export function request(win: PageWindow, url: string, method = 'GET'): FakeXMLHttpRequest {
  const xhr = new win.XMLHttpRequest() as unknown as FakeXMLHttpRequest;
  xhr.open(method, url);
  xhr.send();
  return xhr;
}

/** The page's socket of its socket host, as the page makes it. */
export const openSocket = (win: PageWindow): FakeWebSocket => new win.WebSocket(SOCKET) as unknown as FakeWebSocket;
