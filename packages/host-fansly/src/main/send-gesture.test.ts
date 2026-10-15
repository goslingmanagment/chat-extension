// The person's send on Fansly, attributed by MAIN (R20 P7f; docs/project-unite/architecture.md §5.9; FS-SEND-1,
// FS-SEND-2; spike P3a §3): the whole runtime over a page-like window (testing/fake-page.ts), whose `deliver` hands
// an event to its listeners the way the browser delivers its own — MAIN's capture listener on the window, the page's
// listeners on the target, a page's bubbling one on the window — with a microtask checkpoint after every listener.
// Every `fx.sent` here passed Fansly's schemas on the isolated client. Firefox's own delivery — trusted clicks and
// Enter by geckodriver — is the e2e's (suite-fansly-send-observe).

import { digest, normalize } from '@cg/host-kit/common/digest';
import { afterEach, describe, expect, it } from 'vitest';

import {
  API,
  CREATOR,
  FAN,
  GROUP,
  OTHER_GROUP,
  FakeElement,
  composer,
  connect as connectTo,
  controls,
  newMessage,
  ok,
  openSocket,
  page,
  request,
  session,
  settle,
  type Connected,
  type FakeWebSocket,
  type FakeXMLHttpRequest,
  type PageWindow,
} from '../testing/fake-page';
import { GESTURE_SEND_MS, SEND_WAIT_MS } from './send-gesture';
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const MAIN = composer('main');
const TEXT = '  Привет!  Как\r\nдела? ';
const sentOf = (msgId: string, text = TEXT, groupId = GROUP): Record<string, unknown> => ({ groupId, msgId, contentDigest: digest(normalize(text)) });

interface Chat {
  readonly c: Connected;
  readonly win: PageWindow;
  readonly socket: FakeWebSocket;
}

/** The page on its chat: the creator known, its socket confirmed — what the page has before a person sends. */
async function onChat(clock?: () => number): Promise<Chat> {
  const c = await connectTo(clock === undefined ? page() : page('loading', clock), cleanups);
  request(c.win, `${API}/account/me?ngsw-bypass=true`).respond(200, ok({ account: { id: CREATOR } }));
  const socket = openSocket(c.win);
  socket.receive(session);
  await settle();
  return { c, win: c.win, socket };
}

/** The page's `POST /message` (or another path): created and sent now — its `loadstart` comes inside `send()`. */
const post = (win: PageWindow, path = '/message'): FakeXMLHttpRequest => request(win, `${API}${path}?ngsw-bypass=true`, 'POST');
/** The server's answer to a send: the new message, as Fansly's answer carries it. */
const receipt = (xhr: FakeXMLHttpRequest, id: string, over: Record<string, unknown> = {}): void =>
  xhr.respond(200, ok({ id, groupId: GROUP, senderId: CREATOR, content: TEXT, type: 1, createdAt: 1_790_000_000, attachments: [], ...over }));
/** The socket's `5/1` of the creator's own message. */
const echo = (socket: FakeWebSocket, id: string, over: Record<string, unknown> = {}): void => socket.receive(newMessage(id, CREATOR, { content: TEXT, ...over }));

const enter = { type: 'keydown', key: 'Enter', target: MAIN.field } as const;
const click = { type: 'click', target: MAIN.icon } as const;
/** The sends MAIN said, without the gesture's name (`sentAt` reads it). */
const sents = (c: Connected): unknown[] =>
  c
    .events()
    .filter((e) => e.t === 'fx.sent')
    .map(({ p }) => {
      const { gestureAt: _at, ...rest } = p;
      return rest;
    });
/** The gesture each send names (`fx.sent.gestureAt`). */
const sentAt = (c: Connected): unknown[] => c.events().filter((e) => e.t === 'fx.sent').map((e) => e.p['gestureAt']);
const counts = async (c: Connected): Promise<Record<string, number>> => (await c.health()).sends;

describe('[FS-SEND-2] [UI-033] [host:fansly] the person’s send, attributed by MAIN (§5.9)', () => {
  it('[FS-SEND-1] a trusted Enter in the main field: the page’s POST inside the keydown is marked; its receipt and its echo — in either order — are one fx.sent with the digest of the sent text, never the text', async () => {
    const { c, win, socket } = await onChat();
    let xhr: FakeXMLHttpRequest | null = null;
    const first = await controls(win).deliver(enter, { target: [() => (xhr = post(win))] });
    receipt(xhr as unknown as FakeXMLHttpRequest, '700000000000000301');
    echo(socket, '700000000000000301');
    // The echo first: it waits while the request is in flight, its receipt finds it.
    const second = await controls(win).deliver(enter, { target: [() => (xhr = post(win))] });
    echo(socket, '700000000000000302');
    receipt(xhr as unknown as FakeXMLHttpRequest, '700000000000000302');
    await settle();
    expect(sents(c)).toEqual([sentOf('700000000000000301'), sentOf('700000000000000302')]);
    // Each send names its own gesture: the timeStamp of the very event, which the isolated side reads too.
    expect(sentAt(c)).toEqual([first.timeStamp, second.timeStamp]);
    expect(JSON.stringify(c.batches)).not.toContain('Привет');
    expect(await counts(c)).toEqual({ gestures: 2, receipts: 2, ambiguous: 0, media: 0, sent: 2, echoFirst: 1, receiptFirst: 1 });
    expect(c.client.stats()).toMatchObject({ invalidEvents: 0, invalidAnswers: 0 });
  });

  it('[FS-SEND-1] a trusted click on the main composer’s Send — on its icon — is a gesture too', async () => {
    const { c, win, socket } = await onChat();
    let xhr: FakeXMLHttpRequest | null = null;
    await controls(win).deliver(click, { target: [() => (xhr = post(win))] });
    receipt(xhr as unknown as FakeXMLHttpRequest, '700000000000000303');
    echo(socket, '700000000000000303');
    await settle();
    expect(sents(c)).toEqual([sentOf('700000000000000303')]);
  });

  it('microtasks between listeners keep the delivery going: a send in a microtask, after three awaits, from a bubbling listener in its microtask — each marked', async () => {
    const { c, win, socket } = await onChat();
    const ids = ['700000000000000311', '700000000000000312', '700000000000000313'];
    const ways: Array<{ target?: Array<() => void>; window?: Array<() => void> }> = [
      { target: [() => queueMicrotask(() => sendAs(ids[0] as string))] },
      {
        target: [
          () =>
            void (async () => {
              await Promise.resolve();
              await Promise.resolve();
              await Promise.resolve();
              sendAs(ids[1] as string);
            })(),
        ],
      },
      // The page's listener runs last, on the window as the event bubbles, and sends in its microtask: phase 3.
      { target: [() => undefined], window: [() => queueMicrotask(() => sendAs(ids[2] as string))] },
    ];
    const requests = new Map<string, FakeXMLHttpRequest>();
    const sendAs = (id: string): void => void requests.set(id, post(win));
    for (const way of ways) await controls(win).deliver(enter, way);
    for (const id of ids) {
      receipt(requests.get(id) as FakeXMLHttpRequest, id);
      echo(socket, id);
    }
    await settle();
    expect(sents(c)).toEqual(ids.map((id) => sentOf(id)));
  });

  it('a send begun after the delivery — a timer, a message channel — sees NONE: not marked, no fx.sent', async () => {
    const { c, win, socket } = await onChat();
    const requests: FakeXMLHttpRequest[] = [];
    await controls(win).deliver(enter, { target: [() => void setTimeout(() => requests.push(post(win)), 0)] });
    const channel = new MessageChannel();
    channel.port1.onmessage = () => requests.push(post(win));
    cleanups.push(() => channel.port1.close());
    await controls(win).deliver(click, { target: [() => channel.port2.postMessage(0)] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(requests).toHaveLength(2);
    requests.forEach((xhr, i) => {
      receipt(xhr, `70000000000000032${String(i)}`);
      echo(socket, `70000000000000032${String(i)}`);
    });
    await settle();
    expect(sents(c)).toEqual([]);
    expect(await counts(c)).toMatchObject({ gestures: 2, receipts: 0, sent: 0 });
  });

  it('[FS-SEND-1] not the person’s send: a script’s event, Shift+Enter, Enter inside an IME composition, another key, the mini-chat’s field and Send, a click beside Send — the request that follows is not attributed', async () => {
    const { c, win, socket } = await onChat();
    const mini = composer('mini');
    const beside = new FakeElement('div', MAIN.input);
    const events = [
      { ...enter, isTrusted: false },
      { ...enter, shiftKey: true },
      { ...enter, isComposing: true },
      { ...enter, key: 'a' },
      { ...enter, target: mini.field },
      { ...click, target: mini.icon },
      { ...click, target: beside },
      { ...click, target: null },
    ] as const;
    let n = 330;
    for (const event of events) {
      let xhr: FakeXMLHttpRequest | null = null;
      await controls(win).deliver(event, { target: [() => (xhr = post(win))] });
      n += 1;
      receipt(xhr as unknown as FakeXMLHttpRequest, `700000000000000${String(n)}`);
      echo(socket, `700000000000000${String(n)}`);
    }
    await settle();
    expect(sents(c)).toEqual([]);
    expect(await counts(c)).toMatchObject({ gestures: 0, sent: 0 });
  });

  it('[FS-SEND-2] two POST /message in one gesture: two candidates — not attributed; the page’s ack and typing beside the send are no candidates — attributed', async () => {
    const { c, win, socket } = await onChat();
    const two: FakeXMLHttpRequest[] = [];
    await controls(win).deliver(enter, { target: [() => two.push(post(win)), () => two.push(post(win))] });
    receipt(two[0] as FakeXMLHttpRequest, '700000000000000341');
    receipt(two[1] as FakeXMLHttpRequest, '700000000000000342');
    echo(socket, '700000000000000341');
    echo(socket, '700000000000000342');
    const beside: FakeXMLHttpRequest[] = [];
    await controls(win).deliver(enter, { target: [() => beside.push(post(win, '/message/ack')), () => beside.push(post(win)), () => beside.push(post(win, '/message/typing'))] });
    beside[0]?.respond(200, ok({}));
    receipt(beside[1] as FakeXMLHttpRequest, '700000000000000343');
    echo(socket, '700000000000000343');
    beside[2]?.respond(200, ok({}));
    await settle();
    expect(sents(c)).toEqual([sentOf('700000000000000343')]);
    expect(await counts(c)).toMatchObject({ gestures: 2, receipts: 3, ambiguous: 1, sent: 1 });
  });

  it('[FS-SEND-2] the receipt is the creator’s answer in the gesture’s chat: another sender, another chat, a refusal, `success: false`, no id — not attributed; media — not attributed, by rule, and counted', async () => {
    const { c, win, socket } = await onChat();
    const answers: Array<(xhr: FakeXMLHttpRequest, id: string) => void> = [
      (xhr, id) => receipt(xhr, id, { senderId: FAN }),
      (xhr, id) => receipt(xhr, id, { groupId: OTHER_GROUP }),
      (xhr) => xhr.respond(429, ok({})),
      (xhr, id) => xhr.respond(200, JSON.stringify({ success: false, response: { id, groupId: GROUP, senderId: CREATOR } })),
      (xhr) => xhr.respond(200, ok({ groupId: GROUP, senderId: CREATOR, content: TEXT })),
      (xhr, id) => receipt(xhr, id, { attachments: [{ contentType: 1, contentId: '700000000000000999', pos: 0 }] }),
    ];
    let n = 350;
    for (const answer of answers) {
      let xhr: FakeXMLHttpRequest | null = null;
      await controls(win).deliver(enter, { target: [() => (xhr = post(win))] });
      n += 1;
      answer(xhr as unknown as FakeXMLHttpRequest, `700000000000000${String(n)}`);
      echo(socket, `700000000000000${String(n)}`);
    }
    await settle();
    expect(sents(c)).toEqual([]);
    expect(await counts(c)).toMatchObject({ gestures: 6, receipts: 1, media: 1, sent: 0 });
  });

  it('[FS-SEND-2] the address: changed inside the event before the request — not marked; changed after it while the answer is slow — attributed to the gesture’s chat', async () => {
    const { c, win, socket } = await onChat();
    const location = win.location as unknown as { pathname: string };
    let xhr: FakeXMLHttpRequest | null = null;
    await controls(win).deliver(enter, {
      target: [
        () => {
          location.pathname = `/messages/${OTHER_GROUP}`;
          xhr = post(win);
        },
      ],
    });
    location.pathname = `/messages/${GROUP}`;
    receipt(xhr as unknown as FakeXMLHttpRequest, '700000000000000361');
    echo(socket, '700000000000000361');
    await controls(win).deliver(enter, { target: [() => (xhr = post(win))] });
    location.pathname = `/messages/${OTHER_GROUP}`;
    receipt(xhr as unknown as FakeXMLHttpRequest, '700000000000000362');
    echo(socket, '700000000000000362');
    await settle();
    expect(sents(c)).toEqual([sentOf('700000000000000362')]);
  });

  it('[FS-SEND-2] a send the neighbour’s word filter swallowed starts no request: nothing; the next gesture’s send is attributed', async () => {
    const { c, win, socket } = await onChat();
    // FBuddy's guard returns from `send()` without calling the native: no `loadstart`, the request stays opened.
    await controls(win).deliver(enter, { target: [() => void new win.XMLHttpRequest().open('POST', `${API}/message`)] });
    let xhr: FakeXMLHttpRequest | null = null;
    await controls(win).deliver(enter, { target: [() => (xhr = post(win))] });
    receipt(xhr as unknown as FakeXMLHttpRequest, '700000000000000371');
    echo(socket, '700000000000000371');
    await settle();
    expect(sents(c)).toEqual([sentOf('700000000000000371')]);
    expect(await counts(c)).toMatchObject({ gestures: 2, receipts: 1, sent: 1 });
  });

  it('two quick gestures, each with its own send, answered out of order: each attributed to its own', async () => {
    const { c, win, socket } = await onChat();
    const first: FakeXMLHttpRequest[] = [];
    const second: FakeXMLHttpRequest[] = [];
    await controls(win).deliver(enter, { target: [() => first.push(post(win))] });
    await controls(win).deliver(click, { target: [() => second.push(post(win))] });
    echo(socket, '700000000000000382', { content: 'second' });
    receipt(second[0] as FakeXMLHttpRequest, '700000000000000382', { content: 'second' });
    receipt(first[0] as FakeXMLHttpRequest, '700000000000000381');
    echo(socket, '700000000000000381');
    await settle();
    expect(sents(c)).toEqual([sentOf('700000000000000382', 'second'), sentOf('700000000000000381')]);
  });

  it('[FS-SEND-2] no echo — no fx.sent; an echo of another message or of the fan never pairs; a creator’s 5/1 with no send in flight is not kept', async () => {
    const { c, win, socket } = await onChat();
    // The creator wrote from another device: nothing in flight, nothing kept for a later receipt.
    echo(socket, '700000000000000391');
    let xhr: FakeXMLHttpRequest | null = null;
    await controls(win).deliver(enter, { target: [() => (xhr = post(win))] });
    receipt(xhr as unknown as FakeXMLHttpRequest, '700000000000000391');
    socket.receive(newMessage('700000000000000392', FAN));
    echo(socket, '700000000000000393');
    await settle();
    expect(sents(c)).toEqual([]);
    // Its own echo, late: the pair at last.
    echo(socket, '700000000000000391');
    await settle();
    expect(sents(c)).toEqual([sentOf('700000000000000391')]);
  });

  it('a request that ends inside the delivery (a synchronous one) is settled a turn later: a second send of the same delivery still makes it ambiguous; alone, it is attributed', async () => {
    const { c, win, socket } = await onChat();
    const later: FakeXMLHttpRequest[] = [];
    await controls(win).deliver(enter, {
      target: [
        () => receipt(post(win), '700000000000000401'),
        () => later.push(post(win)),
      ],
    });
    receipt(later[0] as FakeXMLHttpRequest, '700000000000000402');
    echo(socket, '700000000000000401');
    echo(socket, '700000000000000402');
    await controls(win).deliver(enter, { target: [() => receipt(post(win), '700000000000000403')] });
    echo(socket, '700000000000000403');
    await settle();
    expect(sents(c)).toEqual([sentOf('700000000000000403')]);
    expect(await counts(c)).toMatchObject({ ambiguous: 1, sent: 1 });
  });

  it('before `/account/me` nobody is the creator: no receipt is the person’s; the gesture’s listeners are on the window from document_start, in its capture phase, and nothing else of MAIN is', async () => {
    const c = await connectTo(page(), cleanups);
    expect(controls(c.win).gestureListeners()).toBe(2);
    expect(controls(c.win).listening()).toBe(0);
    const socket = openSocket(c.win);
    socket.receive(session);
    let xhr: FakeXMLHttpRequest | null = null;
    await controls(c.win).deliver(enter, { target: [() => (xhr = post(c.win))] });
    receipt(xhr as unknown as FakeXMLHttpRequest, '700000000000000411');
    echo(socket, '700000000000000411');
    await settle();
    expect(sents(c)).toEqual([]);
    expect(await counts(c)).toMatchObject({ gestures: 1, receipts: 0 });
  });

  it('[FS-SEND-2] an expired wait confirms nothing: a receipt whose echo comes past its wait, an echo whose receipt comes past it — no fx.sent', async () => {
    let now = 1000;
    const { c, win, socket } = await onChat(() => now);
    let xhr: FakeXMLHttpRequest | null = null;
    await controls(win).deliver(enter, { target: [() => (xhr = post(win))] });
    receipt(xhr as unknown as FakeXMLHttpRequest, '700000000000000431');
    now += SEND_WAIT_MS + 1000;
    echo(socket, '700000000000000431');
    // The echo first, kept while its request is in flight — and its receipt only past the wait.
    await controls(win).deliver(enter, { target: [() => (xhr = post(win))] });
    echo(socket, '700000000000000432');
    now += SEND_WAIT_MS + 1000;
    receipt(xhr as unknown as FakeXMLHttpRequest, '700000000000000432');
    await settle();
    expect(sents(c)).toEqual([]);
    expect(await counts(c)).toMatchObject({ gestures: 2, receipts: 2, sent: 0 });
  });

  it('[FS-SEND-2] two gestures sharing a name (Firefox reduces the precision of `timeStamp`): neither send is said — the isolated side could not tell their drafts apart', async () => {
    const { c, win, socket } = await onChat();
    const sends: FakeXMLHttpRequest[] = [];
    await controls(win).deliver({ ...enter, timeStamp: 5000.5 }, { target: [() => sends.push(post(win))] });
    await controls(win).deliver({ ...click, timeStamp: 5000.5 }, { target: [() => sends.push(post(win))] });
    receipt(sends[0] as FakeXMLHttpRequest, '700000000000000451');
    echo(socket, '700000000000000451');
    receipt(sends[1] as FakeXMLHttpRequest, '700000000000000452');
    echo(socket, '700000000000000452');
    await settle();
    expect(sents(c)).toEqual([]);
    expect(await counts(c)).toMatchObject({ gestures: 2, receipts: 2, ambiguous: 2, sent: 0 });
  });

  it('[FS-SEND-2] a send proven too long after its gesture is not said: the gesture’s name may be another one’s by then', async () => {
    let now = 1000;
    const { c, win, socket } = await onChat(() => now);
    let xhr: FakeXMLHttpRequest | null = null;
    await controls(win).deliver(enter, { target: [() => (xhr = post(win))] });
    now += GESTURE_SEND_MS + 1000;
    receipt(xhr as unknown as FakeXMLHttpRequest, '700000000000000461');
    echo(socket, '700000000000000461');
    await settle();
    expect(sents(c)).toEqual([]);
  });

  it('[FS-CO-1] the old extension shows up between the receipt and the echo: MAIN stands down, and the echo says nothing', async () => {
    const { c, win, socket } = await onChat();
    let xhr: FakeXMLHttpRequest | null = null;
    await controls(win).deliver(enter, { target: [() => (xhr = post(win))] });
    receipt(xhr as unknown as FakeXMLHttpRequest, '700000000000000441');
    // Its tap marker only — no event of the page tells MAIN of it.
    Reflect.set(win, Symbol.for('chatgoose.socketTap'), true);
    echo(socket, '700000000000000441');
    await settle();
    expect(sents(c)).toEqual([]);
    expect((await c.state()).identity.legacy).toBe(true);
  });

  it('the window’s gesture listeners go when MAIN stands down and when it is disposed', async () => {
    const standing = await onChat();
    expect(controls(standing.win).gestureListeners()).toBe(2);
    Reflect.set(standing.win, Symbol.for('chatgoose.socketTap'), true);
    standing.win.document.dispatchEvent(new Event('DOMContentLoaded'));
    expect(controls(standing.win).gestureListeners()).toBe(0);
    const disposed = await onChat();
    expect(controls(disposed.win).gestureListeners()).toBe(2);
    disposed.c.main.dispose();
    expect(controls(disposed.win).gestureListeners()).toBe(0);
  });

  it('[FS-CO-1] standing down for the old extension: present at the start — no gesture listener at all; seen later — a gesture in flight and every one after it are nothing', async () => {
    const before = page();
    Reflect.set(before, Symbol.for('chatgoose.socketTap'), true);
    const old = await connectTo(before, cleanups);
    expect(controls(old.win).gestureListeners()).toBe(0);

    const { c, win, socket } = await onChat();
    let xhr: FakeXMLHttpRequest | null = null;
    await controls(win).deliver(enter, { target: [() => (xhr = post(win))] });
    // The old extension shows up while the send is in flight: MAIN stands down, its receipt and echo say nothing.
    Reflect.set(win, Symbol.for('chatgoose.socketTap'), true);
    win.document.dispatchEvent(new Event('DOMContentLoaded'));
    receipt(xhr as unknown as FakeXMLHttpRequest, '700000000000000421');
    echo(socket, '700000000000000421');
    await controls(win).deliver(enter, { target: [() => (xhr = post(win))] });
    receipt(xhr as unknown as FakeXMLHttpRequest, '700000000000000422');
    echo(socket, '700000000000000422');
    await settle();
    expect(sents(c)).toEqual([]);
    expect((await c.state()).identity.legacy).toBe(true);
  });
});
