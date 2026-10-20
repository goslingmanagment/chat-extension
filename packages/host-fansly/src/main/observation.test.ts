// The observation of Fansly's MAIN as a whole (R20 P7b; docs/project-unite/
// architecture.md §5.5–§5.8; FS-TAIL-3…7, FS-IDN-1, FS-IDN-3): the page's
// frames and answers in, `fx.chat`, `fx.coverage`, `fx.windowMeta` and the
// generation snapshot out — every one through the isolated client over
// Fansly's schemas, so each snapshot here passed FanslySnapshotSchema and the
// start proof StartProofV1Schema. Firefox and the stand: suite-fansly-tap.

import type { FanslyChatWire } from '@cg/contracts/bridge-messages-fansly';
import type { FanslySnapshot } from '@cg/contracts/fansly';
import { afterEach, describe, expect, it } from 'vitest';

import {
  API,
  CREATOR,
  FAN,
  GROUP,
  OTHER_GROUP,
  connect as connectTo,
  controls,
  deletion,
  group,
  member,
  message,
  newMessage,
  ok,
  openSocket,
  page,
  request,
  service,
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

/** Message ids of the chat, ascending with `n` (18 digits). */
const id = (n: number): string => `7000000000001${String(n).padStart(5, '0')}`;
const BROADCAST = '700000000000000099';
const THIRD = '700000000000000003';

/** The conversation on the server: messages `from`…`to`, the fan's on odd numbers, the creator's on even ones. */
const conversation = (from: number, to: number, over: (n: number) => Record<string, unknown> = () => ({})): Array<Record<string, unknown>> =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i).map((n) => message(id(n), n % 2 === 1 ? FAN : CREATOR, { content: `line ${n}`, createdAt: 1_790_000_000 + n, ...over(n) }));
/** A history page as Fansly serves it: the newest first. */
const historyPage = (messages: ReadonlyArray<Record<string, unknown>>): string => ok({ messages: [...messages].reverse(), accountMedia: [], tips: [] });
/** The newest `limit` messages, as the server's fresh end. */
const freshEnd = (messages: ReadonlyArray<Record<string, unknown>>, limit = 25): string => historyPage(messages.slice(-limit));
const ids = (messages: ReadonlyArray<Record<string, unknown>>): string[] => messages.map((m) => m['id'] as string);

interface Tab {
  readonly c: Connected;
  readonly socket: FakeWebSocket;
}

const connect = (win: PageWindow, options: { acking?: boolean } = {}): Promise<Connected> => connectTo(win, cleanups, options);

/** A page that knows its creator and the direct group GROUP, with a confirmed socket. */
async function tab(options: { win?: PageWindow; acking?: boolean; members?: readonly string[] } = {}): Promise<Tab> {
  const c = await connect(options.win ?? page(), options);
  request(c.win, `${API}/account/me`).respond(200, ok({ account: { id: CREATOR } }));
  request(c.win, `${API}/group/${GROUP}/`).respond(200, ok(group(GROUP, options.members ?? [CREATOR, FAN])));
  const socket = openSocket(c.win);
  socket.receive(session);
  return { c, socket };
}

/** The page asks the fresh end of a chat (its `limit=25`). */
const fresh = (win: PageWindow, groupId = GROUP): FakeXMLHttpRequest => request(win, `${API}/message?groupId=${groupId}&limit=25&ngsw-bypass=true`);

const meta = (c: Connected, groupId = GROUP): Promise<FanslyChatWire | null> => c.client.request('fx.windowMeta', { groupId });
const snap = (c: Connected, over: Partial<{ groupId: string; feature: 'reply' | 'hi' | 'recap' | 'fix'; window: number; withText: boolean }> = {}): Promise<FanslySnapshot | null> =>
  c.client.request('fx.generationSnapshot', { groupId: GROUP, feature: 'reply', window: 60, withText: true, ...over });
const coverage = (c: Connected): unknown[] => c.events().filter((e) => e.t === 'fx.coverage').map((e) => e.p);
const certified = (c: Connected, groupId = GROUP): boolean => coverage(c).some((p) => JSON.stringify(p) === JSON.stringify({ groupIds: [groupId], state: 'complete', reason: 'certificate' }));
const windowIds = (s: FanslySnapshot | null): string[] => s?.window.map((w) => w.id) ?? [];

describe('[host:fansly] who is who: the creator, the group’s fan, the DM rules, the avatar (FS-IDN-1, FS-IDN-3)', () => {
  it('[FS-IDN-1] [UI-011] the creator is `account.id` of the page’s own /account/me; before it nothing is observed and no snapshot is given', async () => {
    const c = await connect(page());
    request(c.win, `${API}/group/${GROUP}/`).respond(200, ok(group(GROUP, [CREATOR, FAN])));
    const socket = openSocket(c.win);
    socket.receive(session);
    const early = fresh(c.win);
    socket.receive(newMessage(id(1)));
    early.respond(200, freshEnd(conversation(1, 3)));
    await settle();
    // Who the fan is cannot be told without the creator; nothing was kept, no snapshot.
    expect(await meta(c)).toMatchObject({ fanId: null, kind: null, window: { loaded: 0, completeness: 'unknown' } });
    expect(await snap(c)).toBeNull();
    request(c.win, `${API}/account/me?ngsw-bypass=true`).respond(200, ok({ account: { id: CREATOR, username: 'model' } }));
    await settle();
    expect((await c.state()).identity).toMatchObject({ creatorId: CREATOR, accountMeSeen: true });
    expect(await meta(c)).toMatchObject({ fanId: FAN, kind: 'direct' });
    const answer = fresh(c.win);
    answer.respond(200, freshEnd(conversation(1, 3)));
    await settle();
    expect(windowIds(await snap(c))).toEqual([id(1), id(2), id(3)]);
  });

  it('[FS-IDN-3] [AI-122] a direct chat has its one fan; three members are a group chat — no fan, no snapshot; members follow 4/6 and 4/7', async () => {
    const { c, socket } = await tab();
    request(c.win, `${API}/group/${OTHER_GROUP}/`).respond(200, ok(group(OTHER_GROUP, [CREATOR, FAN, THIRD])));
    // A mass send's group: its type says so, whatever its members.
    request(c.win, `${API}/group/${BROADCAST}/`).respond(200, ok(group(BROADCAST, [CREATOR, FAN], { type: 3 })));
    await settle();
    expect(await meta(c)).toMatchObject({ groupId: GROUP, fanId: FAN, kind: 'direct', dmAllowed: true });
    expect(await meta(c, OTHER_GROUP)).toMatchObject({ fanId: null, kind: 'group' });
    expect(await meta(c, BROADCAST)).toMatchObject({ fanId: null, kind: 'group' });
    expect(await snap(c, { groupId: OTHER_GROUP })).toBeNull();
    expect(await meta(c, '700000000000000077')).toBeNull();
    // Certified, then a third member joins: a group chat now, and what was proven of the DM is not any more.
    fresh(c.win).respond(200, freshEnd(conversation(1, 4)));
    socket.receive(member(6, GROUP, THIRD));
    await settle();
    expect(await meta(c)).toMatchObject({ fanId: null, kind: 'group', window: { completeness: 'unknown' } });
    expect(coverage(c).at(-1)).toEqual({ groupIds: [GROUP], state: 'unknown', reason: 'participants' });
    expect(await snap(c)).toBeNull();
    socket.receive(member(7, GROUP, THIRD));
    await settle();
    expect(await meta(c)).toMatchObject({ fanId: FAN, kind: 'direct' });
    // A part of a group (the `POST /group/<id>/` of a group chat answers `users` alone) lowers nothing known.
    request(c.win, `${API}/group/${GROUP}/`, 'POST').respond(200, ok({ users: [{ groupId: GROUP, userId: THIRD }] }));
    await settle();
    expect(await meta(c)).toMatchObject({ fanId: FAN, kind: 'direct' });
  });
});

describe('[host:fansly] completeness and certificates (FS-TAIL-4, §5.6)', () => {
  it('[FS-TAIL-4] [AI-032] a fresh end asked before t:1 gives no certificate; the one asked after it — the first, though the group’s metadata came first', async () => {
    const c = await connect(page());
    request(c.win, `${API}/account/me`).respond(200, ok({ account: { id: CREATOR } }));
    const server = conversation(1, 30);
    // The inbox and the group come before the history at a normal load (main:28951-28994).
    request(c.win, `${API}/messaging/groups`).respond(200, ok({ data: [{ groupId: GROUP, lastMessageId: id(30) }], aggregationData: { groups: [group(GROUP, [CREATOR, FAN], { lastMessage: server.at(-1) })] } }));
    const socket = openSocket(c.win);
    const early = fresh(c.win);
    socket.receive(session);
    early.respond(200, freshEnd(server));
    await settle();
    expect(certified(c)).toBe(false);
    expect(await meta(c)).toMatchObject({ window: { loaded: 25, completeness: 'unknown' } });
    expect(await snap(c)).toMatchObject({ completeness: 'unknown', gap: 'not-certified' });
    // `t:1` brings the page's second request: a certificate, the observation continuous from its oldest message.
    fresh(c.win).respond(200, freshEnd(server));
    await settle();
    expect(certified(c)).toBe(true);
    const s = await snap(c);
    expect(s).toMatchObject({ completeness: 'complete', truncated: false });
    expect(s?.gap).toBeUndefined();
    expect(windowIds(s)).toEqual(ids(server.slice(-25)));
    expect(s?.startProof).toBeUndefined();
  });

  it('[FS-TAIL-4] bfcache and a gap of the stream: every chat unknown', async () => {
    const { c } = await tab({ acking: false });
    fresh(c.win).respond(200, freshEnd(conversation(1, 5)));
    await settle();
    expect((await snap(c))?.completeness).toBe('complete');
    controls(c.win).show(false);
    expect((await snap(c))?.completeness).toBe('complete');
    controls(c.win).show(true);
    expect(await snap(c)).toMatchObject({ completeness: 'unknown', gap: 'bfcache' });
    // Recovered, then the isolated side stops taking batches: one fx.gap, every chat unknown.
    const next = openSocket(c.win);
    next.receive(session);
    fresh(c.win).respond(200, freshEnd(conversation(1, 5)));
    await settle();
    expect((await snap(c))?.completeness).toBe('complete');
    for (let i = 0; i < 4000; i += 1) next.receive(newMessage(`7000000000009${String(i).padStart(5, '0')}`, FAN, { groupId: OTHER_GROUP }));
    await settle();
    expect(c.gaps).toEqual([{ reason: 'overflow' }]);
    expect(await snap(c)).toMatchObject({ completeness: 'unknown', gap: 'gap' });
  });
});

describe('[host:fansly] the focused chat and the stream (fx.focus, fx.chat, fx.incoming, fx.deleted)', () => {
  it('fx.focus → fx.chat of that group with its route epoch, again whenever its view changes; the fan’s script by the fan’s own texts', async () => {
    const { c, socket } = await tab();
    expect(await c.client.request('fx.focus', { groupId: GROUP, routeEpoch: 7 })).toBeNull();
    await settle();
    const chats = (): Array<Record<string, unknown>> => c.events().filter((e) => e.t === 'fx.chat').map((e) => e.p);
    expect(chats().at(-1)).toMatchObject({ groupId: GROUP, fanId: FAN, kind: 'direct', routeEpoch: 7, window: { loaded: 0, completeness: 'unknown', fanScript: 'unknown' } });
    fresh(c.win).respond(200, freshEnd(conversation(1, 4)));
    await settle();
    expect(chats().at(-1)).toMatchObject({ routeEpoch: 7, window: { loaded: 4, newestId: id(4), newestAt: new Date((1_790_000_000 + 4) * 1000).toISOString(), completeness: 'complete', startProven: true, fanScript: 'other' } });
    socket.receive(newMessage(id(5), FAN, { content: 'привет' }));
    await settle();
    expect(chats().at(-1)).toMatchObject({ window: { loaded: 5, newestId: id(5), fanScript: 'cyrillic' } });
    // Nothing of the focused chat changed: no new fx.chat.
    const count = chats().length;
    socket.receive(newMessage('700000000000700001', FAN, { groupId: OTHER_GROUP }));
    await settle();
    expect(chats()).toHaveLength(count);
    // fx.state carries it whole.
    expect((await c.state()).chat).toMatchObject({ groupId: GROUP, routeEpoch: 7 });
    await c.client.request('fx.focus', { groupId: null, routeEpoch: 8 });
    expect((await c.state()).chat).toBeNull();
  });
});

describe('[host:fansly] the generation snapshot (FS-TAIL-6, FS-TAIL-7, §5.8)', () => {
  it('[FS-TAIL-6] [AI-142] one step: identity, epochs, the check window of min(60, messageCount) never older than the observation, the fan’s last 10, the deleted of its span; texts for draft functions only, media-only messages in the window and not in the tail', async () => {
    const { c, socket } = await tab();
    await c.client.request('fx.focus', { groupId: GROUP, routeEpoch: 4 });
    const server = conversation(1, 80, (n) => (n === 78 ? { content: '', attachments: [{ contentType: 1, contentId: '1' }] } : {}));
    // The observation starts at the certificate's oldest message: 56…80 — then 81…85 by the socket.
    fresh(c.win).respond(200, freshEnd(server));
    for (let n = 81; n <= 85; n += 1) socket.receive(newMessage(id(n), n % 2 === 1 ? FAN : CREATOR, { content: `line ${n}`, createdAt: 1_790_000_000 + n }));
    socket.receive(deletion(id(83)));
    await settle();
    const reply = await snap(c);
    expect(reply).toMatchObject({ feature: 'reply', identity: { creatorId: CREATOR, groupId: GROUP, fanId: FAN }, epochs: { socket: 1, route: 4 }, completeness: 'complete', truncated: false });
    expect(reply?.epochs.document).toBe(c.main.documentEpoch);
    const live = [...ids(server.slice(55)), id(81), id(82), id(84), id(85)];
    expect(windowIds(reply)).toEqual(live);
    expect(reply?.window.find((w) => w.id === id(81))?.dir).toBe('fan');
    expect(reply?.knownFanMessageIds).toEqual(live.filter((m) => Number(m.slice(-5)) % 2 === 1).slice(-10));
    expect(reply?.deletedIds).toEqual([id(83)]);
    // The media-only message is in the window, not in the tail.
    expect(reply?.tail?.map((t) => t.platformMessageId)).toEqual(live.filter((m) => m !== id(78)));
    expect(reply?.tail?.[0]).toEqual({ platformMessageId: id(56), direction: 'model', sentAt: new Date((1_790_000_000 + 56) * 1000).toISOString(), text: 'line 56' });
    // Hi asks 25: the window is its last 25, the deletion inside its span.
    const hi = await snap(c, { feature: 'hi', window: 25 });
    expect(windowIds(hi)).toEqual(live.slice(-25));
    expect(hi?.deletedIds).toEqual([id(83)]);
    // Recap without a text request: ids only; its window is the last 60 at most.
    const recap = await snap(c, { feature: 'recap', window: 3000, withText: false });
    expect(recap?.tail).toBeUndefined();
    expect(windowIds(recap)).toEqual(live);
    // A deletion older than a small window's span is not in it.
    const small = await snap(c, { window: 2 });
    expect(windowIds(small)).toEqual(live.slice(-2));
    expect(small?.deletedIds).toEqual([]);
  });

  it('[FS-TAIL-7] [SP-055] no snapshot when MAIN does not know the creator, the group or its one fan; an unobserved direct chat gives an empty, unknown one', async () => {
    const c = await connect(page());
    expect(await snap(c)).toBeNull();
    request(c.win, `${API}/account/me`).respond(200, ok({ account: { id: CREATOR } }));
    await settle();
    expect(await snap(c)).toBeNull();
    request(c.win, `${API}/group/${GROUP}/`).respond(200, ok(group(GROUP, [CREATOR, FAN])));
    await settle();
    expect(await snap(c)).toMatchObject({ completeness: 'unknown', gap: 'not-certified', window: [], knownFanMessageIds: [], deletedIds: [], tail: [], truncated: false });
  });
});

describe('[host:fansly] the review of P7b: six cases that must hold (FS-TAIL-4…6, FS-IDN-3)', () => {
  it('[FS-IDN-3] an answer about a group asked before a member frame does not undo it: a third member stays, no fan, no snapshot', async () => {
    const { c, socket } = await tab();
    const stale = request(c.win, `${API}/group/${GROUP}/`);
    socket.receive(member(6, GROUP, THIRD));
    stale.respond(200, ok(group(GROUP, [CREATOR, FAN])));
    fresh(c.win).respond(200, freshEnd(conversation(1, 4)));
    await settle();
    expect(await meta(c)).toMatchObject({ kind: 'group', fanId: null });
    expect(await snap(c)).toBeNull();
    // A group the page never showed: a member frame first, then an answer asked before it — nothing is told.
    const unknown = '700000000000000088';
    const before = request(c.win, `${API}/group/${unknown}/`);
    socket.receive(member(6, unknown, THIRD));
    before.respond(200, ok(group(unknown, [CREATOR, FAN])));
    await settle();
    expect(await meta(c, unknown)).toMatchObject({ kind: null, fanId: null });
    // An answer asked after the frame is the truth.
    request(c.win, `${API}/group/${unknown}/`).respond(200, ok(group(unknown, [CREATOR, FAN, THIRD])));
    await settle();
    expect(await meta(c, unknown)).toMatchObject({ kind: 'group', fanId: null });
  });
});

describe('[host:fansly] the re-check of P7b: an absence never outranks a presence; an unknown membership change (FS-TAIL-4, FS-IDN-3)', () => {
  it('[FS-IDN-3] a membership frame without its member makes the members unknown; an answer then tells — a group is never kept direct', async () => {
    const { c, socket } = await tab();
    fresh(c.win).respond(200, freshEnd(conversation(1, 4)));
    // A `/group` request is in flight when `4/8 {group: {id}}` says the group changed, naming nobody.
    const asked = request(c.win, `${API}/group/${GROUP}/`);
    socket.receive(service(4, { type: 8, group: { id: GROUP } }));
    await settle();
    expect(await meta(c)).toMatchObject({ kind: null, fanId: null });
    expect(await snap(c)).toBeNull();
    // Its answer has three members: a group chat — never discarded for «unknown».
    asked.respond(200, ok(group(GROUP, [CREATOR, FAN, THIRD])));
    await settle();
    expect(await meta(c)).toMatchObject({ kind: 'group', fanId: null });
    expect(await snap(c)).toBeNull();
    // A two-member answer asked before another such frame is no proof of a DM; one asked after it is.
    const stale = request(c.win, `${API}/group/${GROUP}/`);
    socket.receive(service(4, { type: 8, group: { id: GROUP } }));
    stale.respond(200, ok(group(GROUP, [CREATOR, FAN])));
    await settle();
    expect(await meta(c)).toMatchObject({ kind: null, fanId: null });
    request(c.win, `${API}/group/${GROUP}/`).respond(200, ok(group(GROUP, [CREATOR, FAN])));
    await settle();
    expect(await meta(c)).toMatchObject({ kind: 'direct', fanId: FAN });
  });
});
