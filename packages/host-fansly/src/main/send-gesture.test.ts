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
  group,
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

  it('Chat Memory week 1: every message the creator sent from this tab to a direct chat is fx.pageSent — media and no gesture too; another sender, a group chat, the creator’s other device — nothing', async () => {
    const { c, win, socket } = await onChat();
    request(win, `${API}/group/${GROUP}/`).respond(200, ok(group(GROUP, [CREATOR, FAN])));
    request(win, `${API}/group/${OTHER_GROUP}/`).respond(200, ok(group(OTHER_GROUP, [CREATOR, FAN, '700000000000000099'])));
    await settle();
    // A file sent after its upload: no gesture proves it, the receipt says who sent it.
    receipt(post(win), '700000000000000401', { attachments: [{ contentType: 1, contentId: '700000000000000501' }] });
    // A typed send of the person's Enter: both its fx.sent and its fx.pageSent.
    let xhr: FakeXMLHttpRequest | null = null;
    await controls(win).deliver(enter, { target: [() => (xhr = post(win))] });
    receipt(xhr as unknown as FakeXMLHttpRequest, '700000000000000402');
    echo(socket, '700000000000000402');
    // Not the creator's; a group chat; the creator writing from another device (an echo with no request of this tab).
    receipt(post(win), '700000000000000403', { senderId: FAN });
    receipt(post(win), '700000000000000404', { groupId: OTHER_GROUP });
    echo(socket, '700000000000000405');
    await settle();
    const pageSents = c.events().filter((e) => e.t === 'fx.pageSent').map((e) => e.p);
    expect(pageSents).toEqual([
      { groupId: GROUP, msgId: '700000000000000401', fanId: FAN, accountId: CREATOR, media: true },
      { groupId: GROUP, msgId: '700000000000000402', fanId: FAN, accountId: CREATOR, media: false },
    ]);
    expect(sents(c)).toEqual([sentOf('700000000000000402')]);
    expect(JSON.stringify(c.batches)).not.toContain('Привет');
    expect(c.client.stats()).toMatchObject({ invalidEvents: 0, invalidAnswers: 0 });
  });
});
