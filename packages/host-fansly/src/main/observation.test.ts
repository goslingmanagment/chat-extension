// The observation of Fansly's MAIN as a whole (R20 P7b; docs/project-unite/
// architecture.md §5.5–§5.8; FS-TAIL-3…7, FS-IDN-1, FS-IDN-3): the page's
// frames and answers in, `fx.chat`, `fx.coverage`, `fx.windowMeta` and the
// generation snapshot out — every one through the isolated client over
// Fansly's schemas, so each snapshot here passed FanslySnapshotSchema and the
// start proof StartProofV1Schema. The memory account is tested on its module
// (an accelerated run of the limits). Firefox and the stand: suite-fansly-tap.

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
import { createAutomation } from './automation';
import { frameMessage, type FrameMessage } from './frame-parse';
import { createIdentity } from './identity';
import { createMemory } from './memory';
import { createObservation } from './observation';
import { MAX_CHATS, MEMORY_MAX_BYTES, TEXT_CHATS, TEXT_MAX_BYTES, UNSEEN_GRACE_MS } from './protocol';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** Message ids of the chat, ascending with `n` (18 digits). */
const id = (n: number): string => `7000000000001${String(n).padStart(5, '0')}`;
/** A mass send's parent (`type 3`), in the creator's broadcast group. */
const PARENT = '700000000000200001';
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

  it('[FS-IDN-3] the DM rules by Fansly’s own reading: a rule unmet — copy only; a paid DM paid, or no rule — the model may write', async () => {
    const { c } = await tab();
    const follow = { id: 1, accountId: FAN, type: 1, flags: 2, metadata: '{}', verificationFlags: 0, verificationMetadata: '{}' };
    const paid = { ...follow, flags: 1, metadata: JSON.stringify({ 1: JSON.stringify({ price: 5000 }) }) };
    const cases: Array<[unknown[], unknown, boolean]> = [
      [[], { flags: 0, metadata: '{}' }, true],
      [[follow], { flags: 0, metadata: '{}' }, false],
      [[follow, { ...follow, flags: 0 }], { flags: 0, metadata: '{}' }, true],
      [[paid], { flags: 0, metadata: '{}' }, false],
      [[paid], { flags: 1, metadata: JSON.stringify({ 1: JSON.stringify({ price: 5000 }) }) }, true],
      [[{ ...paid, metadata: '{"1":"not json"}' }], { flags: 0, metadata: '{}' }, false],
    ];
    for (const [rules, account, allowed] of cases) {
      request(c.win, `${API}/group/${GROUP}/`).respond(200, ok(group(GROUP, [CREATOR, FAN], { dmPermissionFlags: rules, accountDmPermissionFlags: account })));
      await settle();
      expect((await meta(c))?.dmAllowed, JSON.stringify(rules)).toBe(allowed);
    }
    // An answer without the rules leaves them as known.
    request(c.win, `${API}/group/${GROUP}/`).respond(200, ok(group(GROUP, [CREATOR, FAN], { dmPermissionFlags: undefined })));
    await settle();
    expect((await meta(c))?.dmAllowed).toBe(false);
  });

  it('[FX-018] the fan’s avatar is an address of the page’s own answers — the inbox’s accounts, /account?ids= — by the hub’s rule; only Hi gets it, nobody loads it', async () => {
    const { c } = await tab();
    const location = (url: string, metadata?: Record<string, string>): Record<string, unknown> => ({ locationId: '1', location: url, ...(metadata === undefined ? {} : { metadata }) });
    const avatar = {
      id: '700000000000000500',
      location: `/${FAN}/700000000000000500.jpeg`,
      width: 800,
      locations: [location(`https://cdn3.fansly.com/${FAN}/700000000000000500.jpeg`)],
      variants: [
        { width: 1080, locations: [location('https://cdn3.fansly.com/big.jpeg')] },
        { width: 400, locations: [location(`https://cdn3.fansly.com/${FAN}/700000000000000501.jpeg?ngsw-bypass=true`, { 'Key-Pair-Id': 'K1', Signature: 'S~1', Policy: 'P_1', Other: 'x' })] },
        { width: 200, locations: [location('https://cdn3.fansly.com/small.jpeg')] },
      ],
    };
    const inbox = { data: [{ groupId: GROUP, partnerAccountId: FAN, lastMessageId: null }], aggregationData: { accounts: [{ id: FAN, avatar }], groups: [group(GROUP, [CREATOR, FAN])] } };
    request(c.win, `${API}/messaging/groups?limit=20`).respond(200, ok(inbox));
    fresh(c.win).respond(200, freshEnd(conversation(1, 2)));
    await settle();
    const hi = await snap(c, { feature: 'hi', window: 25 });
    expect(hi?.fanAvatarUrl).toBe(`https://cdn3.fansly.com/${FAN}/700000000000000501.jpeg?ngsw-bypass=true&Key-Pair-Id=K1&Policy=P_1&Signature=S%7E1`);
    expect((await snap(c))?.fanAvatarUrl).toBeUndefined();
    // The page's account cache: a newer address wins; one off Fansly's CDN, plain http, or a path is never taken.
    request(c.win, `${API}/account?ids=${FAN}`).respond(200, ok([{ id: FAN, avatar: { locations: [location('https://cdn2.fansly.com/new.jpeg')] } }]));
    await settle();
    expect((await snap(c, { feature: 'hi', window: 25 }))?.fanAvatarUrl).toBe('https://cdn2.fansly.com/new.jpeg');
    for (const bad of ['https://cdn.evil.example/a.jpeg', 'http://cdn3.fansly.com/a.jpeg', '/relative/a.jpeg', 'https://user:pw@cdn3.fansly.com/a.jpeg', 'https://cdn3.fansly.com:8443/a.jpeg']) {
      request(c.win, `${API}/account?ids=${FAN}`).respond(200, ok([{ id: FAN, avatar: { location: bad, locations: [location(bad)] } }]));
    }
    await settle();
    expect((await snap(c, { feature: 'hi', window: 25 }))?.fanAvatarUrl).toBe('https://cdn2.fansly.com/new.jpeg');
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

  it('[FS-TAIL-4] an older page, messages by id and an answer that saw a loss between its loadstart and loadend certify nothing', async () => {
    const { c, socket } = await tab();
    const server = conversation(1, 60);
    request(c.win, `${API}/message?groupId=${GROUP}&before=${id(36)}&limit=25`).respond(200, historyPage(server.slice(10, 35)));
    request(c.win, `${API}/messages?ids=${id(59)},${id(60)}`).respond(200, historyPage(server.slice(-2)));
    // A frame of this chat lost while the request was in flight.
    const lossy = fresh(c.win);
    socket.receive(JSON.stringify({ t: 10000, d: JSON.stringify({ serviceId: 5, event: JSON.stringify({ type: 1, message: { groupId: GROUP } }) }) }));
    lossy.respond(200, freshEnd(server));
    // A new socket while the request was in flight.
    const crossed = fresh(c.win);
    const next = openSocket(c.win);
    next.receive(session);
    crossed.respond(200, freshEnd(server));
    await settle();
    expect(certified(c)).toBe(false);
    expect((await snap(c))?.completeness).toBe('unknown');
    // The next request on the new socket: the first certificate.
    fresh(c.win).respond(200, freshEnd(server));
    await settle();
    expect(certified(c)).toBe(true);
  });

  it('[FS-TAIL-4] recovery after the page’s regular re-request: a new socket loses every chat; after its t:1 the page’s fresh end makes it complete again, its interval starting anew at that answer', async () => {
    const { c, socket } = await tab();
    const server = conversation(1, 40);
    fresh(c.win).respond(200, freshEnd(server));
    socket.receive(newMessage(id(41), FAN, { content: 'line 41', createdAt: 1_790_000_041 }));
    server.push(message(id(41), FAN, { content: 'line 41', createdAt: 1_790_000_041 }));
    await settle();
    expect((await snap(c))?.completeness).toBe('complete');
    socket.drop();
    // Unseen by us while the socket was gone.
    server.push(...conversation(42, 50));
    const next = openSocket(c.win);
    await settle();
    expect(await snap(c)).toMatchObject({ completeness: 'unknown', gap: 'socket' });
    next.receive(session);
    fresh(c.win).respond(200, freshEnd(server));
    await settle();
    const s = await snap(c);
    expect(s).toMatchObject({ completeness: 'complete' });
    // What was held before the loss is not joined to it: a deletion during the gap would never be told (§5.12).
    expect(windowIds(s)).toEqual(ids(server.slice(-25)));
    expect(coverage(c).filter((p) => JSON.stringify(p).includes('certificate'))).toHaveLength(2);
  });

  it('[FS-TAIL-4] after a loss neither more than a page of news nor a deleted last message keeps the chat unknown: one fresh end of the page restores it (liveness, §5.12)', async () => {
    for (const gap of ['a page of news', 'the last message deleted'] as const) {
      const { c, socket } = await tab();
      const server = conversation(1, 40);
      fresh(c.win).respond(200, freshEnd(server));
      socket.drop();
      if (gap === 'a page of news') server.push(...conversation(41, 70));
      else server.pop();
      const next = openSocket(c.win);
      next.receive(session);
      fresh(c.win).respond(200, freshEnd(server));
      await settle();
      const s = await snap(c);
      expect(s?.completeness, gap).toBe('complete');
      expect(windowIds(s), gap).toEqual(ids(server.slice(-25)));
      expect(windowIds(s)).not.toContain(id(40 + (gap === 'a page of news' ? 100 : 0)));
      for (const cleanup of cleanups.splice(0)) cleanup();
    }
  });

  it('[FS-TAIL-4] permutations of the answer, an incoming message, a deletion and a cascade around the request give one and the same window', async () => {
    type When = 'before' | 'during, in the answer' | 'during, not in it' | 'after';
    const WHEN: readonly When[] = ['before', 'during, in the answer', 'during, not in it', 'after'];
    const results = new Map<string, string>();
    for (const incoming of WHEN) {
      for (const removal of WHEN) {
        for (const cascade of WHEN) {
          const { c, socket } = await tab();
          // The chat as the server has it: 1…20, message 15 a copy of a mass send (its parent PARENT).
          let server = conversation(1, 20, (n) => (n === 15 ? { correlationId: PARENT, content: 'promo' } : {}));
          // The socket brought 18…20 before the page asked anything.
          for (const m of server.slice(17)) socket.receive(service(5, { type: 1, message: m }));
          const events: Record<string, { readonly when: When; readonly frame: string; readonly server: () => void }> = {
            incoming: { when: incoming, frame: newMessage(id(21), FAN, { content: 'line 21', createdAt: 1_790_000_021 }), server: () => server.push(message(id(21), FAN, { content: 'line 21', createdAt: 1_790_000_021 })) },
            removal: { when: removal, frame: deletion(id(10)), server: () => (server = server.filter((m) => m['id'] !== id(10))) },
            cascade: { when: cascade, frame: deletion(PARENT, { type: 3, groupId: BROADCAST, senderId: CREATOR }), server: () => (server = server.filter((m) => m['correlationId'] !== PARENT)) },
          };
          const run = (phase: When): void => {
            for (const event of Object.values(events)) {
              if (event.when !== phase) continue;
              socket.receive(event.frame);
              // What the server had done by the time it made the answer.
              if (phase === 'before' || phase === 'during, in the answer') event.server();
            }
          };
          run('before');
          const xhr = fresh(c.win);
          run('during, in the answer');
          const answered = freshEnd(server);
          run('during, not in it');
          xhr.respond(200, answered);
          run('after');
          await settle();
          const s = await snap(c);
          const label = `${incoming} / ${removal} / ${cascade}`;
          expect(s?.completeness, label).toBe('complete');
          expect(s?.deletedIds, label).toContain(id(10));
          const window = windowIds(s);
          expect(window, label).toEqual([...Array.from({ length: 21 }, (_, i) => id(i + 1))].filter((m) => m !== id(10) && m !== id(15)));
          results.set(label, JSON.stringify({ window, fan: s?.knownFanMessageIds, tail: s?.tail?.map((t) => t.text) }));
          for (const cleanup of cleanups.splice(0)) cleanup();
        }
      }
    }
    expect(results.size).toBe(64);
    expect(new Set(results.values()).size).toBe(1);
  });

  it('[FS-TAIL-3] a source naming a message the observation lacks lowers the chat once the socket had its chance; one the socket brings in time lowers nothing', async () => {
    let skew = 0;
    const { c, socket } = await tab({ win: page('loading', () => performance.now() + skew) });
    const server = conversation(1, 10);
    fresh(c.win).respond(200, freshEnd(server));
    await settle();
    // The inbox already has message 11; the socket brings it a moment later.
    request(c.win, `${API}/messaging/groups`).respond(200, ok({ data: [{ groupId: GROUP, lastMessageId: id(11) }], aggregationData: { groups: [] } }));
    expect(await snap(c)).toMatchObject({ completeness: 'unknown', gap: 'unseen' });
    socket.receive(newMessage(id(11)));
    expect((await snap(c))?.completeness).toBe('complete');
    // The group's `lastMessage` names 12, the unread list 13 — the socket never brings them.
    request(c.win, `${API}/group/${GROUP}/`).respond(200, ok(group(GROUP, [CREATOR, FAN], { lastMessage: message(id(12)) })));
    request(c.win, `${API}/message/unread?limit=100`).respond(200, ok({ messageInteractions: [{ messageId: id(13), groupId: GROUP, deletedAt: null }, { messageId: id(14), groupId: GROUP, deletedAt: 1_790_000_100 }] }));
    // An older message the observation never had, older than its interval: nothing to say.
    request(c.win, `${API}/messages?ids=${id(1)}`).respond(200, historyPage([message(id(1))]));
    skew += UNSEEN_GRACE_MS + 1;
    const s = await snap(c);
    expect(s).toMatchObject({ completeness: 'unknown', gap: 'unseen' });
    await settle();
    expect(coverage(c).filter((p) => JSON.stringify(p).includes('unseen'))).toEqual([{ groupIds: [GROUP], state: 'unknown', reason: 'unseen' }]);
  });

  it('[FS-TAIL-3] [FS-TAIL-4] a fresh end started before lastMessage becomes a loss cannot recover it; a request after that loss can', async () => {
    let skew = 0;
    const { c } = await tab({ win: page('loading', () => performance.now() + skew) });
    const server = conversation(1, 11);
    fresh(c.win).respond(200, freshEnd(server.slice(0, 10)));
    request(c.win, `${API}/group/${GROUP}/`).respond(200, ok(group(GROUP, [CREATOR, FAN], { lastMessage: server.at(-1) })));
    const held = fresh(c.win);
    skew += UNSEEN_GRACE_MS + 1;
    expect(await snap(c)).toMatchObject({ completeness: 'unknown', gap: 'unseen' });
    held.respond(200, freshEnd(server));
    expect(await snap(c)).toMatchObject({ completeness: 'unknown', gap: 'unseen' });
    fresh(c.win).respond(200, freshEnd(server));
    const recovered = await snap(c);
    expect(recovered?.completeness).toBe('complete');
    expect(windowIds(recovered)).toEqual(ids(server));
  });

  it('[FS-TAIL-4] merge order: the certificate of the later request governs — a late answer to an earlier one adds nothing; a socket deletion wins over any answer', async () => {
    const { c, socket } = await tab();
    const server = conversation(1, 12);
    const first = fresh(c.win);
    const second = fresh(c.win);
    const late = request(c.win, `${API}/message?groupId=${GROUP}&before=${id(13)}&limit=25`);
    // Message 5 was deleted between the two requests, unseen: the later one shows it gone, the earlier one answers last.
    const without5 = server.filter((m) => m['id'] !== id(5));
    second.respond(200, freshEnd(without5));
    first.respond(200, freshEnd(server));
    // Message 7 is deleted while the third request is in flight; its answer still has it.
    socket.receive(deletion(id(7)));
    late.respond(200, historyPage(without5));
    await settle();
    const s = await snap(c);
    // Message 5: the later request's answer lacks it — with no frame of it since, it was gone by then (§5.12).
    expect(windowIds(s)).not.toContain(id(5));
    expect(s?.completeness).toBe('complete');
    // Message 7: the socket said deleted — that wins over any answer.
    expect(windowIds(s)).not.toContain(id(7));
    expect(s?.deletedIds).toEqual([id(7)]);
    expect(s?.tail?.map((t) => t.platformMessageId)).not.toContain(id(7));
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

  it('fx.incoming names the group’s fan and the welcome texts of /message/automated; fx.deleted lists the focused chat’s deletions, the cascade’s too', async () => {
    const { c, socket } = await tab();
    await c.client.request('fx.focus', { groupId: GROUP, routeEpoch: 1 });
    request(c.win, `${API}/message/automated`).respond(
      200,
      ok([{ id: '1', messageTemplate: JSON.stringify({ type: 1, content: '  Thanks for\nthe follow!  ' }) }, { id: '2', messageTemplate: { content: null } }, { id: '3', messageTemplate: 'not json' }]),
    );
    socket.receive(newMessage(id(1), FAN));
    socket.receive(newMessage(id(2), CREATOR, { content: 'Thanks for the follow!' }));
    socket.receive(newMessage(id(3), CREATOR, { content: 'Thanks for the follow, dear' }));
    socket.receive(newMessage(id(4), CREATOR, { correlationId: PARENT, content: 'promo' }));
    socket.receive(newMessage(id(5), CREATOR, { correlationId: PARENT, inReplyTo: id(1), content: 'a reply' }));
    socket.receive(newMessage('700000000000700001', FAN, { groupId: OTHER_GROUP }));
    await settle();
    const incoming = c.events().filter((e) => e.t === 'fx.incoming').map((e) => [e.p['msgId'], e.p['fanId'], e.p['fromFan'], e.p['automated']]);
    expect(incoming).toEqual([
      [id(1), FAN, true, false],
      [id(2), FAN, false, true],
      [id(3), FAN, false, false],
      [id(4), FAN, false, true],
      [id(5), FAN, false, false],
      ['700000000000700001', null, true, false],
    ]);
    socket.receive(deletion(id(3), { senderId: CREATOR }));
    socket.receive(deletion(PARENT, { type: 3, groupId: BROADCAST, senderId: CREATOR }));
    socket.receive(deletion('700000000000700001', { groupId: OTHER_GROUP }));
    await settle();
    expect(c.events().filter((e) => e.t === 'fx.deleted').map((e) => e.p)).toEqual([
      { groupId: GROUP, ids: [id(3)] },
      // The page's own cascade: every message whose `correlationId` is the parent's, a reply among them.
      { groupId: GROUP, ids: [id(4), id(5)] },
    ]);
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
    // Recap: no text at all; its window is the last 60 at most.
    const recap = await snap(c, { feature: 'recap', window: 3000, withText: false });
    expect(recap?.tail).toBeUndefined();
    expect(windowIds(recap)).toEqual(live);
    // A deletion older than a small window's span is not in it.
    const small = await snap(c, { window: 2 });
    expect(windowIds(small)).toEqual(live.slice(-2));
    expect(small?.deletedIds).toEqual([]);
  });

  it('[FS-TAIL-6] the frame stays ≤ 128 KiB of UTF-8: the oldest texts go first, `truncated`; one text over the hub’s 5000 characters is cut to them', async () => {
    const { c } = await tab();
    const server = conversation(1, 25, (n) => ({ content: (n === 25 ? 'я'.repeat(6000) : 'ж'.repeat(4000)) + n }));
    fresh(c.win).respond(200, freshEnd(server));
    await settle();
    const s = await snap(c);
    expect(s?.truncated).toBe(true);
    expect(s?.completeness).toBe('complete');
    const tail = s?.tail ?? [];
    // 4000 Cyrillic characters are 8 KB: about 15 of them fit, the newest ones.
    expect(tail.length).toBeGreaterThan(10);
    expect(tail.length).toBeLessThan(25);
    expect(tail.at(-1)?.platformMessageId).toBe(id(25));
    expect(tail.at(-1)?.text).toHaveLength(5000);
    expect(new TextEncoder().encode(JSON.stringify(s)).length).toBeLessThanOrEqual(128 * 1024 - 512);
    // Without texts it is whole.
    expect((await snap(c, { feature: 'recap', withText: false }))?.truncated).toBe(false);
  });

  it('[FS-TAIL-6] several 115 KB answers in the queue — real inbox pages, read by the snapshot itself; what does not fit its step says `pending-parse`; no tenfold regression of its 5 ms (the budget itself in e2e)', async () => {
    // The page's idle moments come when the test says: the snapshot, not an idle callback, meets the queue.
    const idle: Array<(deadline: IdleDeadline) => void> = [];
    const { c } = await tab({ win: page('loading', () => performance.now(), (callback) => idle.push(callback)) });
    fresh(c.win).respond(200, freshEnd(conversation(1, 25)));
    await settle();
    // An inbox page as Fansly serves it: rows, their groups with members, rules and last messages, the fans' accounts.
    const inbox = (n: number): string => {
      const rows = Array.from({ length: 120 }, (_, i) => ({ fan: `7000000000006${String(n * 1000 + i).padStart(5, '0')}`, group: `7000000000007${String(n * 1000 + i).padStart(5, '0')}` }));
      return ok({
        data: rows.map((row) => ({ groupId: row.group, partnerAccountId: row.fan, unreadCount: 0, lastMessageId: `${row.group.slice(0, 13)}99999` })),
        aggregationData: {
          groups: rows.map((row) => group(row.group, [CREATOR, row.fan], { lastMessage: message(`${row.group.slice(0, 13)}99999`, row.fan, { groupId: row.group, content: 'привет, как дела? '.repeat(3) }) })),
          accounts: rows.map((row) => ({ id: row.fan, username: `fan${row.fan.slice(-4)}`, avatar: { width: 800, locations: [{ location: `https://cdn3.fansly.com/${row.fan}/a.jpeg` }], variants: [{ width: 400, locations: [{ location: `https://cdn3.fansly.com/${row.fan}/b.jpeg` }] }] } })),
        },
      });
    };
    expect(inbox(1).length).toBeGreaterThan(100_000);
    expect(inbox(1).length).toBeLessThan(150_000);
    const times: number[] = [];
    let drained = 0;
    for (let round = 0; round < 5; round += 1) {
      for (let i = 0; i < 4; i += 1) request(c.win, `${API}/messaging/groups?offset=${round * 4 + i}`).respond(200, inbox(round * 4 + i));
      const before = (await c.health()).responses.parsed;
      const started = performance.now();
      const s = await snap(c);
      times.push(performance.now() - started);
      const read = (await c.health()).responses.parsed - before;
      // The snapshot read what fit its step — at least the first — and says whether it read them all.
      expect(read).toBeGreaterThanOrEqual(1);
      expect(s?.completeness).toBe(read === 4 ? 'complete' : 'unknown');
      if (read < 4) expect(s?.gap).toBe('pending-parse');
      drained += read;
      for (const callback of idle.splice(0)) callback({ didTimeout: true, timeRemaining: () => 0 });
    }
    const { perf, responses } = await c.health();
    expect(responses.deferred).toBe(20);
    expect(perf.snapshotMs.count).toBe(5);
    console.log(
      `snapshotMs with four 115 KB inbox pages queued: max ${perf.snapshotMs.max.toFixed(2)} ms, mean ${(perf.snapshotMs.sum / 5).toFixed(2)} ms; ${drained} of 20 read by the snapshots; round trip max ${Math.max(...times).toFixed(1)} ms`,
    );
    // On a busy machine a unit test only catches a tenfold regression; the budget itself is measured in e2e.
    expect(perf.snapshotMs.max).toBeLessThan(50);
    // 2400 groups went by (≤ 600 kept): the observed chat's own group is the last one forgotten.
    expect(await meta(c)).toMatchObject({ fanId: FAN, kind: 'direct' });

    // A slow page: every look at the clock is a millisecond — the drain stops at its budget, the rest waits.
    let clock = 0;
    const slow = await tab({ win: page('loading', () => (clock += 1)) });
    fresh(slow.c.win).respond(200, freshEnd(conversation(1, 5)));
    for (let i = 0; i < 6; i += 1) request(slow.c.win, `${API}/messaging/groups?offset=${i}`).respond(200, inbox(i));
    const pending = await snap(slow.c);
    expect(pending).toMatchObject({ completeness: 'unknown', gap: 'pending-parse' });
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

  it('[FS-TAIL-6] [NF-033] Hi: the tab’s start proof by a short certificate — personal messages over the whole proven history (automated: type 2, a correlation without a reply, a welcome text); never a zero count in place of a proof', async () => {
    const { c, socket } = await tab();
    request(c.win, `${API}/message/automated`).respond(200, ok([{ messageTemplate: JSON.stringify({ content: 'Welcome!' }) }]));
    // (б) a short certificate: 1 the welcome text, 2 a mass send's copy, 3 type 2, 4 the fan, 5 the model in person.
    const server = [
      message(id(1), CREATOR, { content: 'Welcome!' }),
      message(id(2), CREATOR, { correlationId: PARENT, content: 'promo' }),
      message(id(3), CREATOR, { type: 2, content: 'auto' }),
      message(id(4), FAN, { content: 'hi' }),
      message(id(5), CREATOR, { correlationId: PARENT, inReplyTo: id(4), content: 'hey you' }),
    ];
    fresh(c.win).respond(200, freshEnd(server));
    // Then 36 more by the socket — 41 in all — the fan's are personal, the model's welcome text too is automated.
    for (let n = 6; n <= 41; n += 1) socket.receive(newMessage(id(n), n % 4 === 0 ? FAN : CREATOR, { content: n % 4 === 0 ? `fan ${n}` : 'Welcome!' }));
    await settle();
    const hi = await snap(c, { feature: 'hi', window: 25 });
    const automated = [id(1), id(2), id(3), ...Array.from({ length: 36 }, (_, i) => i + 6).filter((n) => n % 4 !== 0).map(id)];
    expect(hi?.startProof).toEqual({ v: 1, source: 'tab-short-page', groupId: GROUP, startWitnessId: id(1), coveredCount: 41, personalCount: 41 - automated.length, automatedIds: automated });
    expect(hi?.startProof?.personalCount).toBe(11);
    expect((await meta(c))?.window.startProven).toBe(true);
    // Not for another function.
    expect((await snap(c))?.startProof).toBeUndefined();
    // The ring rolls over the start (120 messages): the base is gone with it.
    for (let n = 42; n <= 121; n += 1) socket.receive(newMessage(id(n), CREATOR, { content: 'Welcome!' }));
    await settle();
    expect((await snap(c, { feature: 'hi', window: 25 }))?.startProof).toBeUndefined();
    expect((await meta(c))?.window).toMatchObject({ loaded: 120, startProven: false, completeness: 'complete' });
  });

  it('[FS-TAIL-6] a loss ends the start proof: what was held before it cannot be counted on (a deletion during the gap is never told); only a short page of the next segment proves the start again', async () => {
    const { c, socket } = await tab();
    const server = conversation(1, 10);
    fresh(c.win).respond(200, freshEnd(server));
    await settle();
    expect((await snap(c, { feature: 'hi', window: 25 }))?.startProof).toMatchObject({ coveredCount: 10 });
    socket.drop();
    // During the gap message 3 is deleted: nobody tells the tab.
    server.splice(2, 1);
    const next = openSocket(c.win);
    next.receive(session);
    expect((await snap(c, { feature: 'hi', window: 25 }))?.startProof).toBeUndefined();
    // The page's fresh end after the new t:1 is short: it proves the start again, and counts what is there now.
    fresh(c.win).respond(200, freshEnd(server));
    await settle();
    const hi = await snap(c, { feature: 'hi', window: 25 });
    expect(hi?.startProof).toMatchObject({ coveredCount: 9, startWitnessId: id(1) });
    expect(windowIds(hi)).not.toContain(id(3));
  });

  it('[FS-TAIL-6] Hi on the first open of a 41-message chat: the fresh end is whole (25), the start is not proven — no proof (§5.8 а)', async () => {
    const { c } = await tab();
    fresh(c.win).respond(200, freshEnd(conversation(1, 41)));
    await settle();
    const hi = await snap(c, { feature: 'hi', window: 25 });
    expect(hi).toMatchObject({ completeness: 'complete' });
    expect(hi?.startProof).toBeUndefined();
    expect((await meta(c))?.window.startProven).toBe(false);
  });
});

describe('[host:fansly] the memory account (FS-TAIL-5, §5.5)', () => {
  /** The observation on its own, its account and what it said. */
  function observed(held = 0): {
    observation: ReturnType<typeof createObservation>;
    memory: ReturnType<typeof createMemory>;
    identity: ReturnType<typeof createIdentity>;
    said: Array<Record<string, unknown>>;
  } {
    let seq = 0;
    const memory = createMemory(() => held);
    const identity = createIdentity(memory, JSON.parse, URL);
    identity.creator = CREATOR;
    const said: Array<Record<string, unknown>> = [];
    const observation = createObservation({
      memory,
      identity,
      automation: createAutomation(JSON.parse),
      event: (_t, p) => said.push(p),
      now: () => 0,
      wake: () => undefined,
      tick: () => (seq += 1),
      seq: () => seq,
    });
    return { observation, memory, identity, said };
  }
  const chatId = (k: number): string => `7000000000003${String(k).padStart(5, '0')}`;
  /** Message `n` of chat `k`: 18 digits, unique, ascending with `n`. */
  const live = (k: number, n: number, text: string): FrameMessage =>
    frameMessage(message(`8${String(k).padStart(5, '0')}${String(n).padStart(12, '0')}`, n % 2 === 0 ? CREATOR : FAN, { groupId: chatId(k), content: text })) as FrameMessage;

  it('[FS-TAIL-5] an accelerated run of the limits: 400 chats × 130 messages with long texts — within 4 MiB, texts within 2 MiB, ≤ 300 chats and ≤ 20 with texts; the evicted are unknown, the focused one stays', () => {
    const { observation, memory, said } = observed(512 * 1024);
    observation.focus = chatId(0);
    // The focused chat is certified first, then everything else floods in.
    observation.history(chatId(0), [live(0, 1, 'x')], 1, { seq: 1, epoch: 1, confirmed: true }, { epoch: 1, confirmed: true }, 25);
    let peak = 0;
    let peakTexts = 0;
    for (let k = 1; k <= 400; k += 1) {
      const group = chatId(k);
      for (let n = 1; n <= 130; n += 1) observation.live(live(k, n, `${'ж'.repeat(1500)} ${k}/${n}`));
      // Every 20th chat certified (a page of its newest message, not short): its eviction must say so.
      if (k % 20 === 0) observation.history(group, [live(k, 130, 'z')], 1, { seq: 2 ** 31, epoch: 1, confirmed: true }, { epoch: 1, confirmed: true }, null);
      observation.touch(chatId(0));
      observation.enforce(() => false);
      peak = Math.max(peak, memory.total());
      peakTexts = Math.max(peakTexts, memory.texts);
    }
    console.log(`memory account at its peak: ${(peak / 1024 / 1024).toFixed(2)} MiB, texts ${(peakTexts / 1024 / 1024).toFixed(2)} MiB; chats ${observation.size()}`);
    expect(peak).toBeLessThanOrEqual(MEMORY_MAX_BYTES);
    expect(peakTexts).toBeLessThanOrEqual(TEXT_MAX_BYTES);
    expect(observation.size()).toBeLessThanOrEqual(MAX_CHATS);
    let texts = 0;
    for (let k = 0; k <= 400; k += 1) if (observation.chat(chatId(k))?.texts) texts += 1;
    expect(texts).toBeLessThanOrEqual(TEXT_CHATS);
    // A ring holds its last 120.
    expect(observation.chat(chatId(400))?.ids).toHaveLength(120);
    // The focused chat stayed, and still holds its text.
    expect(observation.chat(chatId(0))?.complete).toBe(true);
    // The certified chats evicted since — their texts, then the chats themselves — said so; no other chat did.
    const evicted = said.filter((p) => p['reason'] === 'evicted').map((p) => (p['groupIds'] as string[])[0] as string);
    expect(evicted.length).toBeGreaterThan(0);
    for (const g of evicted) expect(Number(g.slice(-5)) % 20).toBe(0);
    expect(evicted).not.toContain(chatId(0));
  });

  it('[FS-TAIL-5] avatars are in the account and go too: 300 addresses of 4096 characters beside a full deferred queue stay within 4 MiB', () => {
    const { observation, memory, identity } = observed(2 * 1024 * 1024);
    for (let k = 0; k < 300; k += 1) identity.readAccount({ id: chatId(k), avatar: { locations: [{ location: `https://cdn3.fansly.com/${String(k).padStart(4, '0')}${'a'.repeat(4096 - 28)}` }] } });
    expect(memory.total()).toBeGreaterThan(MEMORY_MAX_BYTES);
    observation.enforce(() => false);
    expect(memory.total()).toBeLessThanOrEqual(MEMORY_MAX_BYTES);
  });

  it('[FS-TAIL-5] over the limit with nothing of the observation left to drop, the stream’s queue goes (`fx.gap {memory}`)', () => {
    const { observation, memory } = observed(MEMORY_MAX_BYTES + 1);
    let dropped = 0;
    observation.live(live(1, 1, 'x'));
    observation.enforce(() => {
      dropped += 1;
      return false;
    });
    expect(dropped).toBe(1);
    expect(memory.texts).toBe(0);
  });
});

describe('[host:fansly] the review of P7b: six cases that must hold (FS-TAIL-4…6, FS-IDN-3)', () => {
  it('[FS-TAIL-6] a short answer proves the start only if the ring still holds all of it: 121 messages that came while it was in flight leave no proof', async () => {
    const { c, socket } = await tab();
    const xhr = fresh(c.win);
    // Eleven personal messages on the server when it made the answer; 121 automated ones arrive before it does.
    for (let n = 12; n <= 132; n += 1) socket.receive(newMessage(id(n), CREATOR, { type: 2, content: 'auto', createdAt: 1_790_000_000 + n }));
    xhr.respond(200, freshEnd(conversation(1, 11)));
    await settle();
    const hi = await snap(c, { feature: 'hi', window: 25 });
    expect(hi?.completeness).toBe('complete');
    expect(hi?.startProof).toBeUndefined();
    expect((await meta(c))?.window.startProven).toBe(false);
    // The ring holds the newest 120, all after the answer: the window is theirs.
    expect(windowIds(hi)).toEqual(Array.from({ length: 25 }, (_, i) => id(108 + i)));
  });

  it('[FS-TAIL-4] two overlapping fresh ends give one history and one verdict whatever order they answer in: the later request’s certificate governs', async () => {
    const windows: string[][] = [];
    for (const order of ['A first', 'B first']) {
      const { c } = await tab();
      const a = fresh(c.win);
      const b = fresh(c.win);
      // Message 2 was deleted between the two requests, unseen: B, asked later, no longer has it.
      const older = historyPage(conversation(1, 3));
      const newer = historyPage(conversation(1, 3).filter((m) => m['id'] !== id(2)));
      if (order === 'A first') {
        a.respond(200, older);
        b.respond(200, newer);
      } else {
        b.respond(200, newer);
        a.respond(200, older);
      }
      await settle();
      const s = await snap(c);
      // B's request began later: it governs. Message 2, with no frame of it since B began, was gone by then.
      expect(s?.completeness, order).toBe('complete');
      windows.push(windowIds(s));
      for (const cleanup of cleanups.splice(0)) cleanup();
    }
    expect(windows).toEqual([
      [id(1), id(3)],
      [id(1), id(3)],
    ]);
  });

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

  it('[FS-TAIL-4] an answer with a message MAIN cannot read is not read whole: no certificate, no proof of the start from a page that only looks short', async () => {
    const { c } = await tab();
    const server = conversation(1, 25);
    const broken = server.map((m) => (m['id'] === id(13) ? { ...m, senderId: undefined } : m));
    fresh(c.win).respond(200, freshEnd(broken));
    await settle();
    const hi = await snap(c, { feature: 'hi', window: 25 });
    // Never certified: its observation has no interval at all.
    expect(hi).toMatchObject({ completeness: 'unknown', gap: 'not-certified' });
    expect(hi?.startProof).toBeUndefined();
    expect(certified(c)).toBe(false);
    expect(coverage(c).at(-1)).toEqual({ groupIds: [GROUP], state: 'unknown', reason: 'parse-limit' });
    // Messages by id the same: the chat the unreadable one names becomes unknown.
    fresh(c.win).respond(200, freshEnd(server));
    await settle();
    expect(certified(c)).toBe(true);
    request(c.win, `${API}/messages?ids=${id(26)}`).respond(200, historyPage([{ ...message(id(26)), senderId: 'x' }]));
    await settle();
    expect((await snap(c))?.gap).toBe('parse-limit');
  });

  it('[FS-TAIL-6] a snapshot never starts a parse it cannot finish within its step: one ~1 MB answer of 190 messages waits (`pending-parse`) and is read when the page is idle; no tenfold regression of its 5 ms (the budget itself in e2e)', async () => {
    // The page's idle moments come when the test says.
    const idle: Array<(deadline: IdleDeadline) => void> = [];
    const { c } = await tab({ win: page('loading', () => performance.now(), (callback) => idle.push(callback)) });
    fresh(c.win).respond(200, freshEnd(conversation(1, 25)));
    await settle();
    const big = historyPage(Array.from({ length: 190 }, (_, i) => message(`70000000000050${String(i).padStart(4, '0')}`, FAN, { groupId: OTHER_GROUP, content: `${'слово '.repeat(860)}${i}` })));
    expect(big.length).toBeGreaterThan(950_000);
    request(c.win, `${API}/messages?ids=1`).respond(200, big);
    const before = (await c.health()).responses.parsed;
    const s = await snap(c);
    expect(s).toMatchObject({ completeness: 'unknown', gap: 'pending-parse' });
    const health = await c.health();
    expect(health.responses.parsed).toBe(before);
    // On a busy machine a unit test only catches a tenfold regression; the budget itself is measured in e2e.
    expect(health.perf.snapshotMs.max).toBeLessThan(50);
    // The page's idle time reads it.
    for (const callback of idle.splice(0)) callback({ didTimeout: true, timeRemaining: () => 0 });
    expect((await c.health()).responses.parsed).toBe(before + 1);
    expect((await snap(c))?.completeness).toBe('complete');
  });
});

describe('[host:fansly] the re-check of P7b: an absence never outranks a presence; an unknown membership change (FS-TAIL-4, FS-IDN-3)', () => {
  it('[FS-TAIL-4] an answer that lacks a message another answer has never deletes it for good: B, asked later and made earlier, governs until the message’s frame comes and brings it back; the proof counts it', async () => {
    const { c, socket } = await tab();
    const a = fresh(c.win);
    const b = fresh(c.win);
    // The server makes B first ([1]); message 2 is made; A, made after, has [1, 2]; its frame is late. A comes, then B.
    const one = message(id(1), FAN, { content: 'hi' });
    const two = message(id(2), CREATOR, { content: 'hello you' });
    a.respond(200, historyPage([one, two]));
    b.respond(200, historyPage([one]));
    await settle();
    // B began later and governs: the state when the server made it — a true one, message 2 not made yet.
    expect(windowIds(await snap(c))).toEqual([id(1)]);
    expect((await snap(c))?.completeness).toBe('complete');
    // Its frame came after B began: it is held again — no tombstone stood in the way.
    socket.receive(service(5, { type: 1, message: two }));
    await settle();
    expect(windowIds(await snap(c))).toEqual([id(1), id(2)]);
    fresh(c.win).respond(200, historyPage([one, two]));
    await settle();
    const hi = await snap(c, { feature: 'hi', window: 25 });
    expect(hi?.completeness).toBe('complete');
    expect(windowIds(hi)).toEqual([id(1), id(2)]);
    expect(hi?.startProof).toMatchObject({ coveredCount: 2, personalCount: 2, startWitnessId: id(1) });
  });

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

describe('[host:fansly] the fourth review of P7b: a send’s late answer, a socket behind the answers (FS-TAIL-4, §5.12)', () => {
  it('[FS-TAIL-4] the answer of our own send obeys the rule: one asked before a loss brings back nothing that was deleted in the gap', async () => {
    const { c, socket } = await tab();
    fresh(c.win).respond(200, historyPage([message(id(1), FAN, { content: 'hi' })]));
    // Our send: its request begins, the server makes message 2 — and the socket breaks before its echo.
    const send = request(c.win, `${API}/message`, 'POST');
    socket.drop();
    // During the gap message 2 is deleted and the fan writes message 3.
    const next = openSocket(c.win);
    next.receive(session);
    const recovery = [message(id(1), FAN, { content: 'hi' }), message(id(3), FAN, { content: 'again' })];
    fresh(c.win).respond(200, historyPage(recovery));
    await settle();
    expect(windowIds(await snap(c))).toEqual([id(1), id(3)]);
    // The send's answer arrives at last: message 2 as the server made it.
    send.respond(200, ok(message(id(2), CREATOR, { content: 'deleted since' })));
    await settle();
    const hi = await snap(c, { feature: 'hi', window: 25 });
    expect(windowIds(hi)).toEqual([id(1), id(3)]);
    expect(hi?.completeness).toBe('complete');
    expect(hi?.startProof).toMatchObject({ coveredCount: 2, personalCount: 2 });
  });

  it('[FS-TAIL-4] a socket behind the answers: the late frame of a message the certificate shows deleted (made before its newest) is a conflict — unknown, never an impossible history', async () => {
    const { c, socket } = await tab();
    // On the server: 1; 2 made and deleted; 3 made. The answer comes before the socket says any of it.
    fresh(c.win).respond(200, historyPage([message(id(1), FAN, { content: 'hi' }), message(id(3), FAN, { content: 'again' })]));
    await settle();
    expect(windowIds(await snap(c))).toEqual([id(1), id(3)]);
    socket.receive(newMessage(id(2), CREATOR, { content: 'made and deleted' }));
    await settle();
    const behind = await snap(c);
    expect(windowIds(behind)).not.toContain(id(2));
    expect(behind?.completeness).toBe('unknown');
    socket.receive(deletion(id(2), { senderId: CREATOR }));
    socket.receive(newMessage(id(3), FAN, { content: 'again' }));
    // The next certificate of the page settles it.
    fresh(c.win).respond(200, historyPage([message(id(1), FAN, { content: 'hi' }), message(id(3), FAN, { content: 'again' })]));
    await settle();
    expect(await snap(c)).toMatchObject({ completeness: 'complete' });
    expect(windowIds(await snap(c))).toEqual([id(1), id(3)]);
  });
});

describe('[host:fansly] the final check of P7b: deletion knowledge is never forgotten silently (FS-TAIL-4, FS-TAIL-5)', () => {
  const parent = (k: number): string => `7000000000009${String(k).padStart(5, '0')}`;

  it('[FS-TAIL-4] 257 deleted mass sends: the first is forgotten — and every chat is unknown until a certificate asked after it, so a late answer cannot bring its copy back', async () => {
    const { c, socket } = await tab();
    const copy = message(id(2), CREATOR, { correlationId: parent(0), content: 'promo' });
    // The server makes the answer with the copy; it arrives after the parent and 256 more mass sends are deleted.
    const late = fresh(c.win);
    for (let k = 0; k <= 256; k += 1) socket.receive(deletion(parent(k), { type: 3, groupId: '700000000000000099', senderId: CREATOR }));
    late.respond(200, historyPage([message(id(1), FAN, { content: 'hi' }), copy]));
    await settle();
    const s = await snap(c, { feature: 'hi', window: 25 });
    expect(s?.completeness).toBe('unknown');
    expect(s?.startProof).toBeUndefined();
    // A request asked after the eviction settles it: the copy is gone.
    fresh(c.win).respond(200, historyPage([message(id(1), FAN, { content: 'hi' })]));
    await settle();
    const after = await snap(c, { feature: 'hi', window: 25 });
    expect(after).toMatchObject({ completeness: 'complete', startProof: { coveredCount: 1, personalCount: 1 } });
    expect(windowIds(after)).toEqual([id(1)]);
  });

  it('[FS-TAIL-5] the 2049th deletion forgets the first tombstone: its chat is unknown until a certificate asked after it', async () => {
    const { c, socket } = await tab();
    fresh(c.win).respond(200, freshEnd(conversation(1, 3)));
    await settle();
    socket.receive(deletion(id(3)));
    // Deletions in other chats, enough to push the first tombstone out.
    for (let k = 0; k < 2048; k += 1) socket.receive(deletion(`7000000000008${String(k).padStart(5, '0')}`, { groupId: OTHER_GROUP }));
    await settle();
    expect((await snap(c))?.completeness).toBe('unknown');
    fresh(c.win).respond(200, freshEnd(conversation(1, 2)));
    await settle();
    expect(await snap(c)).toMatchObject({ completeness: 'complete' });
  });
});
