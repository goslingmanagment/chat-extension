// Fansly's MAIN world as a whole against a page-like window (docs/project-unite/
// architecture.md §5.1–§5.4, §6): the boot of host-kit with Fansly's runtime,
// its Proxies over the page's WebSocket and XMLHttpRequest, its listeners on
// the page's own instances, and the stream it sends — received by the shared
// isolated client over Fansly's own schemas (validate.ts), so every batch
// here passed the checks the isolated side makes. The constructors are fakes
// with the natives' shape (Node has no XMLHttpRequest); Firefox's own natives,
// the stand and the FBuddy-like neighbour are the e2e's
// (packages/testing/e2e/specs/suite-fansly-tap.e2e.ts).

import { FANSLY_BRIDGE_REQUEST_FIXTURES } from '@cg/contracts/fixtures';
import type { FanslyBatch, FanslyHealth, FanslyState } from '@cg/contracts/bridge-messages-fansly';
import { connectMainBridge, type BridgeCallError, type MainBridgeClient } from '@cg/host-kit/isolated/bridge-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FanslyBridge } from '../isolated/bridge-client';
import { loadValidation } from '../isolated/validation';
import { UNDROPPABLE_EVENTS } from '../isolated/wire';
import { installFanslyMain, type FanslyNetwork } from './index';
import { FRAMES_UNREAD_SIGN, MAX_UNACKED, QUEUE_MAX_BYTES, RESPONSE_MAX_CHARS, RESPONSE_NOW_CHARS } from './protocol';

const CREATOR = '700000000000000001';
const FAN = '700000000000000002';
const GROUP = '700000000000000010';
const OTHER_GROUP = '700000000000000011';
const SOCKET = 'wss://wsv3.fansly.com?v=3';
const API = 'https://apiv3.fansly.com/api/v1';
const NETWORK: FanslyNetwork = { socketHosts: ['wsv3.fansly.com'], apiOrigins: ['https://apiv3.fansly.com'] };

// ── The page: its socket and its XHR, as natives look ─────────────────────

/** The page's socket: a native-like constructor (statics, prototype); a test makes it receive frames. */
class WebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static made: WebSocket[] = [];
  readonly url: string;
  constructor(url: string | URL, protocols?: string | string[]) {
    super();
    if (String(url) === 'wss://throws') throw new SyntaxError('the native refuses this address');
    void protocols;
    this.url = String(url);
    WebSocket.made.push(this);
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
class XMLHttpRequest extends EventTarget {
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

type PageWindow = Window & typeof globalThis;
type Listener = (event: { source: unknown; data: unknown; ports: readonly MessagePort[] }) => void;

/** A page-like window: its constructors, and window messaging over Node's MessageChannel (happy-dom sets no `source`). */
function page(readyState: DocumentReadyState = 'loading'): PageWindow {
  const listeners = new Set<Listener>();
  WebSocket.made = [];
  const win = {
    location: { origin: 'https://fansly.com', href: 'https://fansly.com/messages' },
    document: { readyState },
    performance,
    crypto,
    URL,
    EventTarget,
    WebSocket,
    XMLHttpRequest,
    setTimeout: (callback: () => void, ms?: number) => setTimeout(callback, ms),
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
    /** Window listeners now: the page's own world, where a switch of ours would listen. */
    listening: () => listeners.size,
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

// ── Frames and answers as Fansly sends them ───────────────────────────────

const service = (serviceId: number, event: Record<string, unknown>): string => JSON.stringify({ t: 10000, d: JSON.stringify({ serviceId, event: JSON.stringify(event) }) });
const session = JSON.stringify({ t: 1, d: JSON.stringify({ session: { id: '1', accountId: CREATOR, token: 'secret', deviceId: null } }) });
const newMessage = (id: string, senderId = FAN, over: Record<string, unknown> = {}): string =>
  service(5, { type: 1, message: { id, type: 1, content: 'hello', groupId: GROUP, senderId, correlationId: null, inReplyTo: null, createdAt: 1_790_000_000, attachments: [], totalTipAmount: 0, ...over } });
const ok = (response: unknown): string => JSON.stringify({ success: true, response });

// ── The isolated side, as Fansly's starter connects it ────────────────────

interface Connected {
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

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function connect(win: PageWindow, options: { acking?: boolean; start?: boolean } = {}): Promise<Connected> {
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
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
};

const coverage = (c: Connected): unknown[] => c.events().filter((e) => e.t === 'fx.coverage').map((e) => e.p);

function request(win: PageWindow, url: string): XMLHttpRequest {
  const xhr = new win.XMLHttpRequest() as unknown as XMLHttpRequest;
  xhr.open('GET', url);
  xhr.send();
  return xhr;
}

describe('[SN-017] [EX-007] [host:fansly] the Proxies over the page’s constructors (FS-WS-1)', () => {
  it('[FS-WS-1] are invisible but for their source text: the native instance, prototype, statics, name, length, instanceof, subclasses and a call without new', () => {
    const win = page();
    const main = installFanslyMain(win, NETWORK);
    cleanups.push(() => main.dispose());
    for (const [Proxied, Native] of [
      [win.WebSocket, WebSocket],
      [win.XMLHttpRequest, XMLHttpRequest],
    ] as const) {
      expect(Proxied).not.toBe(Native);
      expect(Proxied.prototype).toBe(Native.prototype);
      expect([Proxied.name, Proxied.length]).toEqual([Native.name, Native.length]);
      expect(Object.getOwnPropertyNames(Proxied).sort()).toEqual(Object.getOwnPropertyNames(Native).sort());
      // A call without `new` throws as the native's does.
      expect(() => (Proxied as unknown as () => unknown)()).toThrow(TypeError);
      // The residue §5.2 names: the source text of a Proxy carries no name, and the prototype's constructor is the native.
      expect(Function.prototype.toString.call(Proxied)).toContain('[native code]');
      expect(Proxied.prototype.constructor).toBe(Native);
    }
    expect([win.WebSocket.CONNECTING, win.WebSocket.OPEN, win.WebSocket.CLOSING, win.WebSocket.CLOSED]).toEqual([0, 1, 2, 3]);
    expect(win.XMLHttpRequest.DONE).toBe(4);
    const socket = new win.WebSocket(SOCKET);
    expect(socket).toBeInstanceOf(WebSocket);
    expect(socket).toBeInstanceOf(win.WebSocket);
    expect(Object.getPrototypeOf(socket)).toBe(WebSocket.prototype);
    expect(new win.XMLHttpRequest()).toBeInstanceOf(win.XMLHttpRequest);
    class Page extends win.WebSocket {}
    const sub = new Page(SOCKET);
    expect(sub).toBeInstanceOf(Page);
    expect(WebSocket.made.at(-1)).toBe(sub);
    // What the native throws reaches the page untouched.
    expect(() => new win.WebSocket('wss://throws')).toThrow(SyntaxError);
    main.dispose();
    expect([win.WebSocket, win.XMLHttpRequest]).toEqual([WebSocket, XMLHttpRequest]);
  });

  it('[FS-WS-1] watches only the page’s socket host, parsed — not a look-alike — and never sends on it', async () => {
    const c = await connect(page());
    const other = new c.win.WebSocket('wss://wsv3.fansly.com.example.org') as unknown as WebSocket;
    const neighbour = new c.win.WebSocket('wss://socket.example.org/fansly') as unknown as WebSocket;
    other.receive(session);
    neighbour.receive(newMessage('700000000000000100'));
    await settle();
    expect((await c.health()).frames.seen).toBe(0);
    expect((await c.state()).socket).toEqual({ epoch: 0, confirmed: false });
    const socket = new c.win.WebSocket(SOCKET) as unknown as WebSocket;
    socket.receive(session);
    await settle();
    expect((await c.state()).socket).toEqual({ epoch: 1, confirmed: true });
    expect((await c.health()).frames).toEqual({ seen: 1, parsed: 1, lost: 0 });
  });

  it('[FS-WS-1] our listener stands first on the instance: a page handler that stops the event cannot hide a frame from us', async () => {
    const c = await connect(page());
    const socket = new c.win.WebSocket(SOCKET) as unknown as WebSocket;
    const pageSaw: unknown[] = [];
    socket.addEventListener('message', (event) => {
      pageSaw.push((event as MessageEvent).data);
      event.stopImmediatePropagation();
    });
    socket.receive(session);
    socket.receive(newMessage('700000000000000101'));
    // Binary frames go to a handler of the page that does nothing: not ours to read.
    socket.receive(new ArrayBuffer(4));
    await settle();
    expect(pageSaw).toHaveLength(3);
    expect((await c.health()).frames).toEqual({ seen: 2, parsed: 2, lost: 0 });
    expect(c.events().filter((e) => e.t === 'fx.incoming').map((e) => e.p['msgId'])).toEqual(['700000000000000101']);
  });

  it('[FS-WS-1] the XHR observer never calls the prototype’s open/send/setRequestHeader: a neighbour’s hooks on the prototype still see every request', async () => {
    const c = await connect(page());
    // FBuddy patches the prototype after us (S5 §2.3); its hook must keep seeing the page's requests.
    const proto = c.win.XMLHttpRequest.prototype as unknown as XMLHttpRequest;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- the neighbour's way: the original, called with .call
    const originalSend = proto.send;
    const hooked: string[] = [];
    proto.send = function send(this: XMLHttpRequest) {
      hooked.push('send');
      originalSend.call(this);
    };
    cleanups.push(() => (proto.send = originalSend));
    const xhr = request(c.win, `${API}/account/me?ngsw-bypass=true`);
    xhr.respond(200, ok({ account: { id: CREATOR } }));
    await settle();
    expect(hooked).toEqual(['send']);
    expect((await c.state()).identity).toMatchObject({ creatorId: CREATOR, accountMeSeen: true });
  });
});

describe('[SN-019] [host:fansly] the projections of one parse, through the bridge (FS-WS-2, FS-WS-3)', () => {
  it('[FS-WS-2] every 5/1 as fx.incoming — the fan’s, the creator’s, automated, a tip; 3/2 as fx.follow; typing and receipts never cross', async () => {
    const c = await connect(page());
    request(c.win, `${API}/account/me`).respond(200, ok({ account: { id: CREATOR } }));
    const socket = new c.win.WebSocket(SOCKET) as unknown as WebSocket;
    socket.receive(session);
    socket.receive(newMessage('700000000000000101'));
    socket.receive(newMessage('700000000000000102', CREATOR, { type: 2 }));
    socket.receive(newMessage('700000000000000103', CREATOR, { correlationId: '700000000000000050' }));
    socket.receive(newMessage('700000000000000104', FAN, { attachments: [{ contentType: 7, contentId: '9', pos: 0, messageId: null }], createdAt: 1e15 }));
    socket.receive(service(5, { type: 22, typingAnnounceEvent: { accountId: FAN, groupId: GROUP, lastAnnounce: 1 } }));
    socket.receive(service(4, { type: 2, ackCommand: { type: 2, userId: FAN, messageIds: ['700000000000000101'] } }));
    socket.receive(service(3, { type: 2, follow: { id: '700000000000000201', accountId: CREATOR, followerId: FAN } }));
    socket.receive(JSON.stringify({ t: 10001, d: [newMessage('700000000000000105'), newMessage('700000000000000106', FAN, { groupId: OTHER_GROUP })] }));
    await settle();
    const stream = c.events().filter((e) => e.t === 'fx.incoming' || e.t === 'fx.follow');
    expect(stream).toEqual([
      { t: 'fx.incoming', p: { groupId: GROUP, fanId: null, msgId: '700000000000000101', fromFan: true, automated: false, tip: false, createdAt: '2026-09-21T14:13:20.000Z' } },
      { t: 'fx.incoming', p: { groupId: GROUP, fanId: null, msgId: '700000000000000102', fromFan: false, automated: true, tip: false, createdAt: '2026-09-21T14:13:20.000Z' } },
      { t: 'fx.incoming', p: { groupId: GROUP, fanId: null, msgId: '700000000000000103', fromFan: false, automated: true, tip: false, createdAt: '2026-09-21T14:13:20.000Z' } },
      { t: 'fx.incoming', p: { groupId: GROUP, fanId: null, msgId: '700000000000000104', fromFan: true, automated: false, tip: true, createdAt: null } },
      { t: 'fx.follow', p: { eventId: '700000000000000201', accountId: CREATOR, followerId: FAN } },
      { t: 'fx.incoming', p: expect.objectContaining({ msgId: '700000000000000105' }) as unknown },
      { t: 'fx.incoming', p: expect.objectContaining({ msgId: '700000000000000106', groupId: OTHER_GROUP }) as unknown },
    ]);
    // No text, no receipt, no typing ever crosses.
    expect(JSON.stringify(c.batches)).not.toContain('hello');
    expect(c.events().map((e) => e.t)).not.toContain('fx.sent');
    expect(c.client.stats()).toMatchObject({ rejected: {}, invalidEvents: 0, invalidAnswers: 0 });
    // One batch per listener call at most: 10 frames, an XHR, the session — never more batches than calls.
    expect(c.batches.length).toBeLessThanOrEqual(13);
  });

  it('[FS-WS-2] a frame not read whole lowers the chats it touched — or every chat — with reason `frame`; the rest of the stream goes on', async () => {
    const c = await connect(page());
    const socket = new c.win.WebSocket(SOCKET) as unknown as WebSocket;
    socket.receive(session);
    socket.receive('{"t":10000,"d":');
    socket.receive(service(5, { type: 1, message: { groupId: GROUP, senderId: FAN, type: 1 } }));
    socket.receive(JSON.stringify({ t: 10001, d: 'not an array' }));
    socket.receive(newMessage('700000000000000107'));
    await settle();
    expect(coverage(c).slice(1)).toEqual([
      { groupIds: 'all', state: 'unknown', reason: 'frame' },
      { groupIds: [GROUP], state: 'unknown', reason: 'frame' },
      { groupIds: 'all', state: 'unknown', reason: 'frame' },
    ]);
    expect(c.events().at(-1)?.p['msgId']).toBe('700000000000000107');
    expect((await c.health()).frames).toEqual({ seen: 5, parsed: 4, lost: 3 });
  });
});

describe('[SN-020] [host:fansly] the tap’s counts and completeness (FS-WS-5)', () => {
  it('[FS-WS-5] a new socket and the end of one make every chat unknown; t:1 confirms only the newest socket', async () => {
    const c = await connect(page());
    const first = new c.win.WebSocket(SOCKET) as unknown as WebSocket;
    first.receive(session);
    first.drop();
    const second = new c.win.WebSocket(SOCKET) as unknown as WebSocket;
    // A late frame of the old socket: its message still counts, its t:1 confirms nothing.
    first.receive(session);
    first.receive(newMessage('700000000000000108'));
    await settle();
    expect(coverage(c)).toEqual([
      { groupIds: 'all', state: 'unknown', reason: 'socket' },
      { groupIds: 'all', state: 'unknown', reason: 'socket' },
      { groupIds: 'all', state: 'unknown', reason: 'socket' },
    ]);
    expect((await c.state()).socket).toEqual({ epoch: 2, confirmed: false });
    second.receive(session);
    await settle();
    expect((await c.state()).socket).toEqual({ epoch: 2, confirmed: true });
    expect(c.events().filter((e) => e.t === 'fx.incoming')).toHaveLength(1);
  });

  it('[FS-WS-5] frames seen and none of them read: every chat unknown once, and the `frames` anchor says `shape`', async () => {
    const c = await connect(page());
    const socket = new c.win.WebSocket(SOCKET) as unknown as WebSocket;
    for (let i = 0; i < FRAMES_UNREAD_SIGN + 2; i += 1) socket.receive(JSON.stringify({ t: 99, d: `{"x":${i}}` }));
    await settle();
    expect(coverage(c)).toEqual([
      { groupIds: 'all', state: 'unknown', reason: 'socket' },
      { groupIds: 'all', state: 'unknown', reason: 'socket' },
    ]);
    expect((await c.health()).frames).toEqual({ seen: FRAMES_UNREAD_SIGN + 2, parsed: 0, lost: 0 });
    expect((await c.state()).contract.anchors.frames).toBe('shape');
    expect(c.events().filter((e) => e.t === 'fx.contract').at(-1)?.p).toMatchObject({ anchors: { frames: 'shape', socket: 'ok' } });
  });

  it('[FS-WS-5] a late install — the page began before MAIN — says so first: every chat unknown, `late-install`', async () => {
    const c = await connect(page('interactive'));
    await settle();
    expect(coverage(c)[0]).toEqual({ groupIds: 'all', state: 'unknown', reason: 'late-install' });
    expect((await c.client.probe()).readyStateAtStart).toBe('interactive');
  });

  it('[FS-WS-4] [SN-018] the tap never turns off: no request or page event of the old sound switch stops it; every frame is read', async () => {
    const c = await connect(page());
    const socket = new c.win.WebSocket(SOCKET) as unknown as WebSocket;
    // The old extension's tap went silent on this event when both sounds were off (fansly-chat sound-relay.ts):
    // MAIN listens to nothing on the page's window once connected — no switch of any kind reaches the tap.
    expect((c.win as unknown as { listening(): number }).listening()).toBe(0);
    c.win.dispatchEvent(new CustomEvent('chatgoose:sound-arm', { detail: 'off' }));
    for (let i = 0; i < 20; i += 1) socket.receive(newMessage(`7000000000001${String(i).padStart(5, '0')}`));
    await settle();
    expect((await c.health()).frames).toEqual({ seen: 20, parsed: 20, lost: 0 });
    expect(c.events().filter((e) => e.t === 'fx.incoming')).toHaveLength(20);
  });

  it('the contract’s network anchors (fx.contract, §7.12): not yet, then ok as the page’s socket, frames, answers and creator come', async () => {
    const c = await connect(page());
    expect((await c.state()).contract).toEqual({ anchors: { accountMe: 'notYet', socket: 'notYet', frames: 'notYet', xhr: 'notYet' }, tap: 'ok' });
    request(c.win, `${API}/account/me`).respond(200, ok({ account: { id: CREATOR } }));
    const socket = new c.win.WebSocket(SOCKET) as unknown as WebSocket;
    socket.receive(session);
    await settle();
    expect((await c.state()).contract).toEqual({ anchors: { accountMe: 'ok', socket: 'ok', frames: 'ok', xhr: 'ok' }, tap: 'ok' });
    // Someone stood a constructor of their own over ours: still seen, and said.
    c.win.WebSocket = new Proxy(c.win.WebSocket, {});
    expect((await c.state()).contract.tap).toBe('wrapped');
  });
});

describe('[host:fansly] the XHR observer and its response table (§5.4)', () => {
  it('reads the table’s answers at loadend, the long ones when idle, and loses the ones over the limit explicitly', async () => {
    const c = await connect(page());
    request(c.win, `${API}/account/me?ngsw-bypass=true`).respond(200, ok({ account: { id: CREATOR } }));
    // Outside the table: seen, not read.
    request(c.win, `${API}/message/ack?ngsw-bypass=true`).respond(200, ok({}));
    request(c.win, 'https://cdn3.fansly.com/media.jpg').respond(200, 'x');
    // Not 2xx, or not text: not read, and nothing thrown.
    request(c.win, `${API}/messaging/groups`).respond(429, ok({ data: [] }));
    const json = new c.win.XMLHttpRequest() as unknown as XMLHttpRequest;
    json.responseType = 'json';
    json.open('GET', `${API}/messaging/groups`);
    json.send();
    json.respond(200, ok({ data: [] }));
    // The inbox, 115 KB: deferred to an idle moment.
    const inbox = ok({ data: [], aggregationData: { groups: [], pad: 'x'.repeat(115_000) } });
    expect(inbox.length).toBeGreaterThan(RESPONSE_NOW_CHARS);
    request(c.win, `${API}/messaging/groups?limit=50`).respond(200, inbox);
    // Over the parse limit: an explicit loss of the area its address names.
    request(c.win, `${API}/message?groupId=${GROUP}&limit=25`).respond(200, ok({ messages: [], pad: 'x'.repeat(RESPONSE_MAX_CHARS) }));
    request(c.win, `${API}/message/unread`).respond(200, ok({ messageInteractions: [], pad: 'x'.repeat(RESPONSE_MAX_CHARS) }));
    await settle();
    const health = await c.health();
    expect(health.responses).toEqual({ seen: 7, parsed: 2, deferred: 1, lost: 2 });
    expect(health.perf.xhrParseMs.count).toBe(2);
    expect(coverage(c)).toEqual([
      { groupIds: [GROUP], state: 'unknown', reason: 'parse-limit' },
      { groupIds: 'all', state: 'unknown', reason: 'parse-limit' },
    ]);
  });

  it('a confirmed vault upload is fx.vaultAdded with the observation number of its request; its answer’s body is not read', async () => {
    const c = await connect(page());
    const upload = new c.win.XMLHttpRequest() as unknown as XMLHttpRequest;
    upload.open('POST', `${API}/vault/albums/media?ngsw-bypass=true`);
    upload.send();
    request(c.win, `${API}/account/me`).respond(200, ok({ account: { id: CREATOR } }));
    upload.respond(200, ok(null));
    request(c.win, `${API}/vault/albums/media`).respond(200, JSON.stringify({ success: false, error: { code: 400 } }));
    await settle();
    expect(c.events().filter((e) => e.t === 'fx.vaultAdded').map((e) => e.p)).toEqual([{ seq: 1 }]);
  });

  it('[EX-008] answers its requests by hand, as the contracts’ fixtures have them; the observation’s wait for P7b', async () => {
    const c = await connect(page());
    for (const t of ['fx.state', 'fx.ack', 'fx.health'] as const) {
      for (const payload of FANSLY_BRIDGE_REQUEST_FIXTURES[t].payload.valid) await expect(c.client.request(t, payload as never)).resolves.not.toBeUndefined();
      for (const payload of FANSLY_BRIDGE_REQUEST_FIXTURES[t].payload.invalid) {
        const error = (await c.client.request(t, payload as never).catch((caught: unknown) => caught)) as BridgeCallError;
        expect([t, error.failure]).toEqual([t, 'bad-request']);
      }
    }
    for (const t of ['fx.focus', 'fx.generationSnapshot', 'fx.windowMeta'] as const) {
      const payload = FANSLY_BRIDGE_REQUEST_FIXTURES[t].payload.valid[0];
      const error = (await c.client.request(t, payload as never).catch((caught: unknown) => caught)) as BridgeCallError;
      expect([t, error.failure, error.executed]).toEqual([t, 'not-ready', 'no']);
    }
    expect(c.client.stats().invalidAnswers).toBe(0);
  });
});

describe('[EX-008] [host:fansly] the stream through the bridge (§6)', () => {
  it('starts with fx.state: what came before waits in the queue and follows the answer, after the batch number it names', async () => {
    const c = await connect(page(), { start: false });
    const socket = new c.win.WebSocket(SOCKET) as unknown as WebSocket;
    socket.receive(session);
    socket.receive(newMessage('700000000000000109'));
    await settle();
    expect(c.batches).toEqual([]);
    const state = await c.state();
    expect(state.lastBatch).toBe(0);
    await settle();
    expect(c.batches[0]?.n).toBe(1);
    // The contract went whole in the answer: only what changed since follows.
    expect(c.events().map((e) => e.t)).toEqual(['fx.coverage', 'fx.incoming']);
  });

  it('a blocked consumer: ≤ 8 batches in flight, memory within the limit, exactly one fx.gap, no `sent`; fx.state resumes the stream', async () => {
    const c = await connect(page(), { acking: false });
    request(c.win, `${API}/account/me`).respond(200, ok({ account: { id: CREATOR } }));
    const socket = new c.win.WebSocket(SOCKET) as unknown as WebSocket;
    socket.receive(session);
    // The fan writes, the creator answers — and its echo comes back: thousands of frames, nobody acks.
    for (let i = 0; i < 3000; i += 1) socket.receive(newMessage(`7000000000005${String(i).padStart(5, '0')}`, i % 2 === 0 ? FAN : CREATOR));
    await settle();
    expect(c.batches).toHaveLength(MAX_UNACKED);
    expect(c.gaps).toEqual([{ reason: 'overflow' }]);
    const health = await c.health();
    expect(health.stream).toMatchObject({ batches: MAX_UNACKED, unacked: MAX_UNACKED, queued: 0, gaps: 1 });
    expect(health.stream.heldBytes).toBeLessThanOrEqual(QUEUE_MAX_BYTES);
    expect(health.frames.seen).toBe(3001);
    expect(c.events().map((e) => e.t)).not.toContain('fx.sent');
    // The isolated side catches up: it acks what it got and asks fx.state; the stream goes on after the batch named.
    c.acking = true;
    await c.client.request('fx.ack', { n: MAX_UNACKED });
    const state = await c.state();
    expect(state.lastBatch).toBe(MAX_UNACKED);
    socket.receive(newMessage('700000000000009999'));
    await settle();
    expect(c.batches.at(-1)?.n).toBe(MAX_UNACKED + 1);
    expect(c.batches.at(-1)?.events.map((e) => e.t)).toContain('fx.incoming');
    expect(c.gaps).toHaveLength(1);
    expect((await c.health()).stream).toMatchObject({ gaps: 1, unacked: 0, heldBytes: 0 });
  });

  it('[FS-WS-3] times every frame and answer it reads (frameParseMs, xhrParseMs), with no tenfold regression of 0.1 ms a frame on average', async () => {
    const c = await connect(page());
    const socket = new c.win.WebSocket(SOCKET) as unknown as WebSocket;
    socket.receive(session);
    for (let i = 0; i < 400; i += 1) socket.receive(i % 2 === 0 ? service(5, { type: 22, typingAnnounceEvent: { accountId: FAN, groupId: GROUP, lastAnnounce: i } }) : newMessage(`7000000000006${String(i).padStart(5, '0')}`));
    await settle();
    const { frameParseMs } = (await c.health()).perf;
    expect(frameParseMs.count).toBe(401);
    expect(frameParseMs.counts.reduce((a, b) => a + b, 0)).toBe(401);
    // On a busy machine a unit test only catches a tenfold regression; the budget itself is measured in e2e.
    expect(frameParseMs.sum / frameParseMs.count).toBeLessThan(1);
  });

  it('installs at document_start with no tenfold regression of its budget (1 ms, §3.1; the budget itself in e2e)', () => {
    const times: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const win = page();
      const main = installFanslyMain(win, NETWORK);
      times.push(main.installMs);
      main.dispose();
    }
    times.sort((a, b) => a - b);
    // On a busy machine a unit test only catches a tenfold regression; the budget itself is measured in e2e.
    expect(times[10]).toBeLessThan(10);
    expect(vi.isFakeTimers()).toBe(false);
  });
});
