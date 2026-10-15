// Fansly's MAIN world on its stand in Firefox (R20 P7a; docs/project-unite/
// architecture.md §5.1–§5.4, §5.10, §6; FS-WS-1…5): the test build's own
// `fansly-main.js` at the page's first moment, and an isolated consumer of its
// stream (support/fansly-tap.ts) — Fansly's own starter, whose client checks
// every frame from MAIN with Fansly's schemas.
// - The Proxies over the page's WebSocket and XMLHttpRequest are Firefox's
//   natives to the page but for the residue §5.2 names.
// - Next to the FBuddy-like neighbour in every mode (X34: FBuddy runs for
//   every chatter): the page reads the same frames we do, the neighbour's hook
//   and the server see the same answers we do, and its word filter still
//   swallows a send.
// - A new socket, a damaged frame, a package; a late install (the neighbour
//   `before`, MAIN injected after the page began): every chat unknown with
//   its reason.
// - A blocked consumer: ≤ 8 batches in flight and MAIN's memory within its
//   limit, exactly one `fx.gap`, no `sent`; `fx.state` resumes the stream.
// - The parse of a frame within its budget (≤ 0.1 ms on average), measured by
//   MAIN itself (`frameParseMs`).
// - The observation (R20 P7b): the open chat certified once by the page's own
//   fresh end after `t:1`; the generation snapshot's window is what the page
//   holds — through a new message, a deletion and a new socket the page
//   recovers from by itself; the fan and the avatar from the page's answers;
//   MAIN's step of a snapshot ≤ 5 ms (`snapshotMs`).
// - (P7c) Fansly's own isolated start over that MAIN, as the extension starts
//   it: the route by the page's signals (no timer, no hook on history) through
//   Fansly's real lifecycle — a chat switch, the gallery, back —, the anchors'
//   observers silent while the fan types and writes, the creator of the
//   page's /account/me as the tab's one account, the stream acknowledged to
//   the last batch; each chat's fan as MAIN names it for the route's own epoch
//   and the target's snapshot once MAIN observes chats (P7b), the chat
//   honestly unknown while it cannot (its own word, `fx.focus`).
// No extension is installed: the background and the dock come with a later
// PR (P7d); the real build's start and its budget on the stand are
// suite-fansly-site's.

import type { FanslyHealth, FanslyState } from '@cg/contracts/bridge-messages-fansly';
import type { FanslyHeaderSlot, FanslySnapshot } from '@cg/contracts/fansly';
import type { FanslyContractReport } from '@cg/contracts/fansly-host';
import type { HostAccount, HostIdentity } from '@cg/contracts/ids';
import type { RouteState } from '@cg/contracts/host';
import { browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';

import { messageCreatedFrame, serviceFrame, type WireMessage } from '../../fixture-fansly/src/wire';
import { GUARD_TOAST } from '../../src/fake-fansly/neighbor/guard';
import type { NeighborConfig } from '../../src/fake-fansly/neighbor/protocol';
import { callNeighbor, neighborState, openWithNeighbor, setFanslyNeighbor } from '../support/fansly-neighbor';
import { FANSLY_MAIN, callFansly, fakeFansly, fanslyIds, fanslyStandServer, waitForFanslyStandIdle } from '../support/fansly-stand';
import { injectFanslyMain, installFanslyTapHarness, tap, waitForFanslyTap, waitForTap, type FanslyTapHarness } from '../support/fansly-tap';
import { useNetworkTrap } from '../support/network-trap';

type Ids = Awaited<ReturnType<typeof fanslyIds>>;
interface Event {
  readonly n: number;
  readonly t: string;
  readonly p: Record<string, unknown>;
}

const health = (): Promise<FanslyHealth> => tap<FanslyHealth>('health');
const state = (): Promise<FanslyState> => tap<FanslyState>('state');
const events = (from = 0): Promise<Event[]> => tap<Event[]>('events', from);
const waitFor = (check: () => Promise<boolean>, what: string, timeout = 10_000): Promise<true> => browser.waitUntil(check, { timeout, interval: 50, timeoutMsg: what });
/** A call as the server answered it, as the neighbour's hook reported it: `METHOD path → status`. */
const line = (method: string, address: string, status: number): string => `${method} ${address} → ${status}`;

/** The page's API answers the neighbour's hook reported since `mark` (its July build hooks every XHR: the API's only). */
async function neighbourSaw(mark: number): Promise<string[]> {
  const api = fakeFansly().apiOrigin;
  return (await callNeighbor('log', mark))
    .filter((entry) => entry.kind === 'xhr' && entry.url.startsWith(`${api}/api/`))
    .map((entry) => line(entry.method, `${new URL(entry.url).pathname}${new URL(entry.url).search}`, entry.status));
}

/** Waits until we have seen as many API answers since `before` as the server journaled since `since`, and says how many. */
async function sameAnswers(before: FanslyHealth, since: number, what: string): Promise<number> {
  const [ours] = await waitForTap(
    async () => [(await health()).responses.seen - before.responses.seen, (await pageCalls(since)).length],
    ([seen, served]) => seen === served,
    what,
  );
  return ours ?? 0;
}

/** The page's own API calls since `since`, as the server journaled them (no CORS preflight: no XHR of the page). */
async function pageCalls(since: number): Promise<string[]> {
  return (await fakeFansly().calls('page', since)).filter((entry) => entry.method !== 'OPTIONS').map((entry) => line(entry.method ?? '', entry.path ?? '', entry.status ?? 0));
}

/** Messages of the creator, automated, to a group nobody has: the page reads each frame and does nothing more. */
function ownAutomated(count: number, creator: string): string[] {
  const now = Math.floor(Date.now() / 1000);
  return Array.from({ length: count }, (_, i) => {
    const message: WireMessage = {
      id: `9000000000${String(i).padStart(8, '0')}`,
      type: 2,
      dataVersion: 1,
      content: 'welcome',
      groupId: '900000000000000001',
      senderId: creator,
      correlationId: '900000000000000002',
      inReplyTo: null,
      inReplyToRoot: null,
      createdAt: now,
      attachments: [],
      embeds: [],
      interactions: [],
      likes: [],
      totalTipAmount: 0,
    };
    return messageCreatedFrame(message);
  });
}

/** The modes of the neighbour our tap must live next to (plan.md §0; X34), but `before` — the late install's — and `+guard`. */
const MODES: ReadonlyArray<{ readonly label: string; readonly config: Partial<NeighborConfig> }> = [
  { label: 'off', config: { mode: 'off' } },
  { label: 'after', config: { mode: 'after' } },
  { label: 'after, its hook after the first answer', config: { mode: 'after', timing: 'first-xhr' } },
  { label: 'reinject', config: { mode: 'reinject', reinjectMs: 1500 } },
  { label: 'legacy', config: { mode: 'legacy' } },
  { label: 'a third party’s Proxy over the constructors', config: { mode: 'after', generic: 'proxy' } },
  { label: 'a third party’s subclass over the constructors', config: { mode: 'off', generic: 'subclass' } },
];

describe('Fansly’s MAIN on its stand: the taps next to the neighbour, the stream and its limits (R20 P7a)', () => {
  useNetworkTrap();
  let ids: Ids;
  let harness: FanslyTapHarness | null = null;
  let journalStart = 0;

  before(async () => {
    await setFanslyNeighbor(null);
    await fakeFansly().command({ op: 'reset' });
    journalStart = await fanslyStandServer.mark();
    await browser.setWindowSize(1440, 900);
    harness = await installFanslyTapHarness({ main: 'start' });
    await openWithNeighbor('/messages', { mode: 'off' });
    ids = await fanslyIds();
  });

  after(async () => {
    await harness?.remove();
    // Nothing but the page's own loads reached the Fansly stand; nothing of ours asked the fake Fansly anything.
    const entries = await fanslyStandServer.journal(journalStart);
    expect(entries.filter((entry) => entry.origin !== 'asset')).toEqual([]);
    expect(await fakeFansly().calls('ours', 0)).toEqual([]);
    await setFanslyNeighbor(null);
    await browser.url('about:blank');
    await fakeFansly().command({ op: 'reset' });
  });

  it('[SN-017] [EX-007] [FS-WS-1] in Firefox the Proxies are the natives to the page — statics, prototype, name, length, instanceof, the native’s own errors — but for their source text and the prototype’s constructor', async () => {
    await openWithNeighbor('/messages', { mode: 'off' });
    await waitForFanslyTap();
    const seen = await browser.execute(() => {
      const names = (fn: object): string => Object.getOwnPropertyNames(fn).sort().join(',');
      let refused = '';
      try {
        // A scheme the native refuses before any connection (a relative address it would resolve and open).
        new WebSocket('ftp://localhost/');
      } catch (error) {
        refused = `${(error as DOMException).name}:${String(error instanceof DOMException)}`;
      }
      let called = '';
      try {
        (XMLHttpRequest as unknown as () => unknown)();
      } catch (error) {
        called = (error as Error).name;
      }
      const xhr = new XMLHttpRequest();
      return {
        ws: [WebSocket.name, WebSocket.length, names(WebSocket), WebSocket.CONNECTING, WebSocket.OPEN, WebSocket.CLOSING, WebSocket.CLOSED],
        xhr: [XMLHttpRequest.name, XMLHttpRequest.length, names(XMLHttpRequest), XMLHttpRequest.DONE],
        instance: [xhr instanceof XMLHttpRequest, Object.getPrototypeOf(xhr) === XMLHttpRequest.prototype, Object.create(WebSocket.prototype) instanceof WebSocket, Object.prototype.toString.call(xhr)],
        refused,
        called,
        // The residue §5.2 names: no name in the source text of a Proxy; the prototype's constructor is the native.
        source: [Function.prototype.toString.call(WebSocket), Function.prototype.toString.call(XMLHttpRequest)],
        constructors: [WebSocket.prototype.constructor === WebSocket, XMLHttpRequest.prototype.constructor === XMLHttpRequest],
      };
    });
    expect(seen.ws).toEqual(['WebSocket', 1, 'CLOSED,CLOSING,CONNECTING,OPEN,length,name,prototype', 0, 1, 2, 3]);
    expect(seen.xhr).toEqual(['XMLHttpRequest', 0, 'DONE,HEADERS_RECEIVED,LOADING,OPENED,UNSENT,length,name,prototype', 4]);
    expect(seen.instance).toEqual([true, true, true, '[object XMLHttpRequest]']);
    expect(seen.refused).toBe('SyntaxError:true');
    expect(seen.called).toBe('TypeError');
    for (const source of seen.source) expect(source).toMatch(/^function \(\) \{\s+\[native code\]\s+\}$/);
    expect(seen.constructors).toEqual([false, false]);
  });

  for (const { label, config } of MODES) {
    it(`[SN-017] [SN-019] [FS-WS-2] [FS-WS-3] next to the neighbour (${label}): the page and we read the same frames, the server, the neighbour and we see the same answers`, async () => {
      const fake = fakeFansly();
      const [a, b] = ids.groups as [string, string];
      await openWithNeighbor('/messages?stand-ack-delay=0', config);
      await waitForFanslyTap();
      await waitForFanslyStandIdle();
      const since = await fake.mark();
      const hooked = config.mode !== 'off';
      const logMark = hooked ? ((await callNeighbor('log')).at(-1)?.seq ?? 0) : 0;
      const before = await health();
      const pageBefore = await callFansly('socket');
      const eventsBefore = (await events()).length;

      await callFansly('open', a);
      await waitFor(async () => (await callFansly('list'))?.groupId === a && ((await callFansly('list'))?.messages ?? 0) > 0, 'the first chat');
      await waitForFanslyStandIdle();
      const fanMessage = (await fake.command({ op: 'message', groupId: b, text: 'a fan writes' })).message?.id;
      const follow = (await fake.command({ op: 'follow' })).follow;
      await fake.command({ op: 'typing', groupId: a });
      await callFansly('open', b);
      await waitFor(async () => (await callFansly('list'))?.groupId === b, 'the second chat');
      await waitForFanslyStandIdle();
      const stream = await waitForTap(
        async () => (await events(eventsBefore)).filter((event) => event.t === 'fx.incoming' || event.t === 'fx.follow'),
        (found) => found.length >= 2,
        'the fan’s message and the follow in our stream',
      );
      expect(stream.map((event) => [event.t, event.p['msgId'] ?? event.p['eventId'], event.p['fromFan'] ?? null])).toEqual([
        ['fx.incoming', fanMessage, true],
        ['fx.follow', follow?.id, null],
      ]);

      const after = await health();
      const pageAfter = await callFansly('socket');
      // The page and we read the same frames: none lost, every one a frame the page reads.
      expect(after.frames.seen - before.frames.seen).toBe((pageAfter?.frames ?? 0) - (pageBefore?.frames ?? 0));
      expect(after.frames.seen - before.frames.seen).toBeGreaterThanOrEqual(3);
      expect([after.frames.parsed - before.frames.parsed, after.frames.lost - before.frames.lost]).toEqual([after.frames.seen - before.frames.seen, 0]);
      expect((await state()).socket).toEqual({ epoch: pageAfter?.created, confirmed: true });
      // The server, the neighbour's hook and we saw the same answers of the page.
      const calls = await pageCalls(since);
      expect(calls.length).toBeGreaterThan(0);
      expect(after.responses.seen - before.responses.seen).toBe(calls.length);
      if (hooked) expect((await neighbourSaw(logMark)).sort()).toEqual([...calls].sort());
      // Every frame of MAIN passed Fansly's schemas; a third party's constructor over ours is said, not hidden.
      expect(await tap('stats')).toMatchObject({ rejected: {}, invalidEvents: 0, invalidAnswers: 0 });
      expect((await state()).contract).toEqual({ anchors: { accountMe: 'ok', socket: 'ok', frames: 'ok', xhr: 'ok' }, tap: config.generic === undefined ? 'ok' : 'wrapped' });
      expect((await state()).identity).toMatchObject({ creatorId: ids.creator, accountMeSeen: true });
      await fake.assertOursClean(since, `next to the neighbour (${label})`);
    });
  }

  it('[SN-017] +guard: next to our Proxy the neighbour’s word filter still swallows a trusted send — no request, so no answer for us either — and the next one goes', async () => {
    const fake = fakeFansly();
    const group = String(ids.groups[2]);
    await openWithNeighbor(`/messages/${group}`, { mode: 'after', guard: ['forbidden'] });
    await waitForFanslyTap();
    await waitFor(async () => (await neighborState()).guard.active, 'its guard');
    await waitForFanslyStandIdle();
    const since = await fake.mark();
    const before = await health();
    await $(FANSLY_MAIN.field).click();
    await browser.keys('this is forbidden');
    await browser.keys(Key.Enter);
    await waitFor(async () => (await neighborState()).guard.restored === 1, 'the text written back');
    await browser.pause(300);
    expect((await fake.calls('page', since)).filter((entry) => entry.route === 'message.send')).toEqual([]);
    expect(await callNeighbor('toasts')).toContain(GUARD_TOAST);
    expect(await $(FANSLY_MAIN.field).getValue()).toBe('this is forbidden');
    // The typing announcement went; the swallowed send never started: we saw only what the server saw (the page
    // never settles again — the swallowed request never ends — so the counts are compared as they come).
    expect(await sameAnswers(before, since, 'our answers and the server’s, the send swallowed')).toBeGreaterThan(0);
    await browser.execute((selector: string) => {
      const field = document.querySelector<HTMLTextAreaElement>(selector);
      if (field === null) throw new Error('no field');
      field.value = '';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }, FANSLY_MAIN.field);
    await $(FANSLY_MAIN.field).click();
    await browser.keys('all clean');
    await browser.keys(Key.Enter);
    await waitFor(async () => (await fake.calls('page', since)).some((entry) => entry.route === 'message.send' && entry.status === 200), 'the clean send');
    await sameAnswers(before, since, 'our answers and the server’s, the clean send');
    // Its echo is an fx.incoming of the creator; no `sent` before P7f, and never one without a gesture's receipt.
    expect((await events()).map((event) => event.t)).not.toContain('fx.sent');
  });

  it('[SN-020] [FS-WS-5] [FS-WS-2] a new socket and its end, a damaged frame, a package: every chat unknown with its reason, the rest read on', async () => {
    const fake = fakeFansly();
    await openWithNeighbor('/messages', { mode: 'after' });
    await waitForFanslyTap();
    await waitForFanslyStandIdle();
    const from = (await events()).length;
    const created = (await callFansly('socket'))?.created ?? 0;
    await fake.command({ op: 'socket', close: true });
    await waitFor(async () => ((await callFansly('socket'))?.created ?? 0) > created && (await callFansly('socket'))?.state === 'connected', 'a new socket of the page', 15_000);
    await waitFor(async () => (await state()).socket.confirmed, 'the new socket confirmed');
    expect((await state()).socket.epoch).toBe((await callFansly('socket'))?.created);
    await fake.command({ op: 'frames', frames: ['{"t":10000,"d":"{\\"serviceId\\":5,'] });
    const [a, b] = ids.groups as [string, string];
    const inside = [
      serviceFrame(5, { type: 1, message: { id: '900000000000000101', type: 1, content: 'x', groupId: a, senderId: ids.fans[a], createdAt: Math.floor(Date.now() / 1000), attachments: [] } }),
      serviceFrame(5, { type: 1, message: { id: '900000000000000102', type: 1, content: 'y', groupId: b, senderId: ids.fans[b], createdAt: Math.floor(Date.now() / 1000), attachments: [] } }),
    ];
    await fake.command({ op: 'frames', frames: inside, batch: true });
    const seen = await waitForTap(
      () => events(from),
      (found) => found.some((event) => event.p['msgId'] === '900000000000000102'),
      'the package’s second message',
    );
    expect(seen.filter((event) => event.t === 'fx.coverage').map((event) => event.p)).toEqual([
      { groupIds: 'all', state: 'unknown', reason: 'socket' },
      { groupIds: 'all', state: 'unknown', reason: 'socket' },
      { groupIds: 'all', state: 'unknown', reason: 'frame' },
    ]);
    expect(seen.filter((event) => event.t === 'fx.incoming').map((event) => event.p['msgId'])).toEqual(['900000000000000101', '900000000000000102']);
    expect((await health()).frames.lost).toBe(1);
    expect(await tap('stats')).toMatchObject({ rejected: {}, invalidEvents: 0 });
  });

  it('[EX-008] [FS-WS-3] a blocked consumer: 8 batches in flight, MAIN’s memory within its limit, exactly one fx.gap, no `sent`; fx.state resumes the stream; every frame parsed within its budget', async () => {
    const fake = fakeFansly();
    await openWithNeighbor('/messages', { mode: 'after' });
    await waitForFanslyTap();
    await waitForFanslyStandIdle();
    await tap('setAcking', false);
    const batchesBefore = (await tap<Array<{ n: number }>>('batches')).length;
    const from = (await events()).length;
    const start = await health();
    const frames = ownAutomated(3000, ids.creator);
    for (let i = 0; i < frames.length; i += 500) await fake.command({ op: 'frames', frames: frames.slice(i, i + 500) });
    const read = await waitForTap(health, (h) => h.frames.seen >= start.frames.seen + frames.length, 'every frame read', 30_000);
    expect(read.frames.lost).toBe(0);
    expect(await tap('gaps')).toEqual([{ reason: 'overflow' }]);
    const batches = await tap<Array<{ n: number }>>('batches');
    expect(batches.length - batchesBefore).toBeLessThanOrEqual(8);
    expect(read.stream).toMatchObject({ unacked: 8, queued: 0, gaps: 1 });
    // After the gap MAIN holds only what is in flight: ≤ 256 KiB.
    expect(read.stream.heldBytes).toBeLessThanOrEqual(256 * 1024);
    expect((await events(from)).map((event) => event.t)).not.toContain('fx.sent');
    // MAIN's own measure of its parse: ≤ 0.1 ms a frame on average (§5.3), printed on every run.
    const { frameParseMs } = read.perf;
    console.log(`suite-fansly-tap: frameParseMs over ${frameParseMs.count} frames: mean ${(frameParseMs.sum / frameParseMs.count).toFixed(4)} ms, max ${frameParseMs.max.toFixed(2)} ms`);
    expect(frameParseMs.sum / frameParseMs.count).toBeLessThanOrEqual(0.1);
    // The consumer catches up: it acks what it got and asks fx.state; the stream goes on after the batch it names.
    await tap('setAcking', true);
    const last = batches.at(-1)?.n ?? 0;
    await tap('ack', last);
    expect((await state()).lastBatch).toBe(last);
    const fan = (await fake.command({ op: 'message', groupId: String(ids.groups[3]), text: 'still here' })).message?.id;
    const resumed = await waitForTap(
      () => events(from),
      (found) => found.some((event) => event.p['msgId'] === fan),
      'the stream after fx.state',
    );
    expect(resumed.find((event) => event.p['msgId'] === fan)?.n).toBe(last + 1);
    expect(await tap('gaps')).toHaveLength(1);
    expect((await health()).stream.gaps).toBe(1);
  });

  it('[FS-TAIL-4] [FS-TAIL-6] [FS-IDN-3] the observation on the stand: one certificate by the page’s own fresh end after t:1; the snapshot’s window is what the page holds through a new message, a deletion and a new socket; ≤ 5 ms a snapshot', async () => {
    const fake = fakeFansly();
    const group = String(ids.groups[4]);
    const fan = ids.fans[group];
    await openWithNeighbor(`/messages/${group}`, { mode: 'after' });
    await waitForFanslyTap();
    await waitForFanslyStandIdle();
    const since = await fake.mark();
    expect(await tap('focus', group, 1)).toBeNull();
    const certificate = JSON.stringify({ groupIds: [group], state: 'complete', reason: 'certificate' });
    const certificates = async (): Promise<number> => (await events()).filter((event) => event.t === 'fx.coverage' && JSON.stringify(event.p) === certificate).length;
    await waitFor(async () => (await certificates()) === 1, 'the certificate of the open chat');
    const held = async (): Promise<string[]> => (await callFansly('list'))?.ids.slice() ?? [];
    const snap = async (feature: 'reply' | 'hi' = 'reply', window = 60): Promise<FanslySnapshot> => {
      const { snapshot } = await tap<{ snapshot: FanslySnapshot | null; roundTripMs: number }>('snapshot', { groupId: group, feature, window, withText: true });
      if (snapshot === null) throw new Error('no snapshot of a direct chat');
      return snapshot;
    };
    const first = await snap();
    expect(first).toMatchObject({ completeness: 'complete', identity: { creatorId: ids.creator, groupId: group, fanId: fan }, truncated: false });
    expect(first.window.map((entry) => entry.id)).toEqual((await held()).slice(-60));
    expect((await state()).chat).toMatchObject({ groupId: group, fanId: fan, kind: 'direct', routeEpoch: 1, window: { completeness: 'complete' } });
    // The fan writes; an earlier message is deleted: the page and the window follow.
    const written = (await fake.command({ op: 'message', groupId: group, text: 'one more' })).message?.id ?? '';
    const target = first.window.at(-2)?.id ?? '';
    await fake.command({ op: 'delete', messageId: target });
    await waitFor(async () => (await held()).includes(written) && !(await held()).includes(target), 'the page shows the new message and drops the deleted one');
    const second = await snap();
    expect(second.completeness).toBe('complete');
    expect(second.window.map((entry) => entry.id)).toEqual((await held()).slice(-60));
    expect(second.deletedIds).toEqual([target]);
    expect(second.tail?.at(-1)).toMatchObject({ platformMessageId: written, direction: 'fan', text: 'one more' });
    // A new socket: every chat unknown, until the page asks the open chat's fresh end after the new t:1 (§5.12).
    const created = (await callFansly('socket'))?.created ?? 0;
    await fake.command({ op: 'socket', close: true });
    await waitFor(async () => ((await callFansly('socket'))?.created ?? 0) > created && (await callFansly('socket'))?.state === 'connected', 'a new socket of the page', 15_000);
    await waitFor(async () => (await certificates()) === 2, 'the chat recovered by the page’s own re-request');
    const third = await snap();
    expect(third.completeness).toBe('complete');
    expect(third.window.map((entry) => entry.id)).toEqual((await held()).slice(-60));
    // Hi: the fan's avatar is an address of the page's own answers, a string only.
    expect((await snap('hi', 25)).fanAvatarUrl).toMatch(/^https:\/\/cdn3\.fansly\.com\//);
    const { perf } = await health();
    console.log(`suite-fansly-tap: snapshotMs over ${perf.snapshotMs.count} snapshots: mean ${(perf.snapshotMs.sum / perf.snapshotMs.count).toFixed(3)} ms, max ${perf.snapshotMs.max.toFixed(2)} ms`);
    expect(perf.snapshotMs.count).toBe(4);
    expect(perf.snapshotMs.max).toBeLessThanOrEqual(5);
    expect(await tap('stats')).toMatchObject({ rejected: {}, invalidEvents: 0, invalidAnswers: 0 });
    await fake.assertOursClean(since, 'the observation on the stand');
  });

  it('[FS-WS-5] [SN-020] a late install — the neighbour first, MAIN after the page began: every chat unknown, the old socket unseen, the answers from then on seen as the neighbour sees them; the next socket is watched', async () => {
    const fake = fakeFansly();
    await harness?.remove();
    harness = await installFanslyTapHarness({ main: 'late' });
    await openWithNeighbor('/messages', { mode: 'before' });
    await waitForFanslyStandIdle();
    await injectFanslyMain();
    await waitForFanslyTap();
    const first = await waitForTap(events, (found) => found.some((event) => event.t === 'fx.coverage'), 'the first coverage after a late install');
    expect(first.find((event) => event.t === 'fx.coverage')?.p).toEqual({ groupIds: 'all', state: 'unknown', reason: 'late-install' });
    expect((await tap<{ readyStateAtStart: string }>('probe')).readyStateAtStart).toBe('complete');
    const since = await fake.mark();
    const logMark = (await callNeighbor('log')).at(-1)?.seq ?? 0;
    await fake.command({ op: 'message', groupId: String(ids.groups[1]), text: 'unseen by us' });
    await callFansly('open', String(ids.groups[0]));
    await waitForFanslyStandIdle();
    const late = await health();
    // The page's socket was made before us: none of its frames; its answers from now on, as the neighbour sees them.
    expect(late.frames.seen).toBe(0);
    expect((await state()).contract.anchors).toMatchObject({ socket: 'notYet', frames: 'notYet', xhr: 'ok' });
    const calls = await pageCalls(since);
    expect(calls.length).toBeGreaterThan(0);
    expect(late.responses.seen).toBe(calls.length);
    expect((await neighbourSaw(logMark)).sort()).toEqual([...calls].sort());
    // The page replaces its socket: that one is ours to watch.
    await fake.command({ op: 'socket', close: true });
    await waitFor(async () => (await state()).socket.confirmed, 'the next socket watched and confirmed', 15_000);
    expect((await state()).socket.epoch).toBe(1);
    expect((await health()).frames.seen).toBeGreaterThan(0);
    await harness.remove();
    harness = await installFanslyTapHarness({ main: 'start' });
  });
});

/** What Fansly's port says on the stand (the harness's `port`): no text, no fan's name. */
interface PortView {
  readonly route: RouteState;
  readonly identity: HostIdentity | null;
  readonly accounts: readonly HostAccount[];
  readonly composer: { readonly instanceId: string; readonly ready: boolean; readonly hidden: boolean } | null;
  readonly slot: FanslyHeaderSlot;
  readonly anchors: { readonly conversation: boolean; readonly container: boolean; readonly textarea: boolean; readonly gallery: boolean };
}
interface PortHealth {
  readonly isolated: {
    readonly route: { readonly changes: number; readonly unsignalled: number; readonly restorations: number };
    readonly anchors: { readonly searches: number; readonly searching: boolean; readonly exhausted: boolean; readonly workCallbacks: number };
    readonly stream: { readonly batches: number; readonly acked: number; readonly gaps: number; readonly refused: number; readonly skipped: number; readonly states: number } | null;
    readonly staleChats: number;
  };
  readonly main: FanslyHealth | null;
}

const portView = (): Promise<PortView> => tap<PortView>('port');
const portHealth = (): Promise<PortHealth> => tap<PortHealth>('portHealth');
const routeIs = (group: string, what: string): Promise<PortView> => waitForTap(portView, (view) => view.route.conversationRef === group && view.anchors.textarea, what);

describe('Fansly’s isolated world over P7a’s MAIN on its stand: the route by signals, the anchors, the identity (R20 P7c)', () => {
  useNetworkTrap();
  let harness: FanslyTapHarness | null = null;

  before(async () => {
    await setFanslyNeighbor(null);
    await fakeFansly().command({ op: 'reset' });
    await browser.setWindowSize(1440, 900);
    harness = await installFanslyTapHarness({ main: 'start', consumer: 'port' });
  });

  after(async () => {
    await harness?.remove();
    expect(await fakeFansly().calls('ours', 0)).toEqual([]);
    await setFanslyNeighbor(null);
    await browser.url('about:blank');
    await fakeFansly().command({ op: 'reset' });
  });

  for (const mode of ['off', 'after'] as const) {
    it(`[FS-RTE-2] [FS-RTE-3] [FS-RTE-4] [FS-PLC-4] next to the neighbour (${mode}): every change of chat seen by a signal — the switch, the gallery as none, back —, each chat’s fan from MAIN for its own epoch, the observers silent while the fan writes, the creator the one account, the stream acknowledged`, async () => {
      await openWithNeighbor('/messages', { mode });
      const ids = await fanslyIds();
      const [first, second] = ids.groups as [string, string];
      await waitForFanslyTap();
      await waitForFanslyStandIdle();
      // The initial binding: the creator of the page's own /account/me, the one account; its platform id is the key.
      const start = await waitForTap(portView, (view) => view.accounts.length === 1, 'the creator from the page’s /account/me');
      expect(start.accounts).toEqual([{ host: 'fansly-web', hostAccountId: ids.creator, platform: 'fansly', platformAccountId: ids.creator, username: null, displayName: null }]);
      expect(start.identity).toMatchObject({ host: 'fansly-web', hostAccountId: ids.creator, platformAccountId: ids.creator, chat: null, routeEpoch: 1 });
      expect(start.route).toMatchObject({ epoch: 1, name: 'other', chat: null });

      // Fansly's router: the address, then the conversation's nodes in the same task — the observers see it.
      await callFansly('open', first);
      expect((await routeIs(first, 'the first chat')).route).toMatchObject({ epoch: 2, name: 'chat', conversationRef: first });
      // Whether MAIN observes chats is its own word, its answer to the focus: P7a's says `not-ready` — the chat stays
      // honestly unknown —; from P7b on it names the group's fan from the page's own answers.
      const report = await waitForTap(() => tap<FanslyContractReport>('report'), (r) => r.capabilities.chatWindow.reason !== 'focus', 'MAIN’s answer to the focus');
      const observing = report.capabilities.chatWindow.state === 'on';
      expect(report.capabilities.identity).toEqual({ state: 'on' });
      expect(report.extensions['fansly-web'].capabilities.freshness).toEqual(observing ? { state: 'on' } : { state: 'off', reason: 'observation', code: 'CG-HOST-NOT-READY' });
      expect(report.extensions['fansly-web'].anchors).toMatchObject({ conversationRoute: 'ok', container: 'ok', composer: 'ok', textarea: 'ok', sendButton: 'ok', fileInput: 'ok', headerContact: 'ok', headerSubRow: 'ok', accountMe: 'ok', xhr: 'ok' });
      const chatOf = (group: string) => (observing ? { host: 'fansly-web', hostAccountId: ids.creator, platformFanId: ids.fans[group] as string } : null);
      /** The route of `group` with its field, and its fan once MAIN can name it. */
      const at = (group: string, what: string): Promise<PortView> => waitForTap(portView, (view) => view.route.conversationRef === group && view.anchors.textarea && (!observing || view.route.chat !== null), what);
      const atFirst = await at(first, 'the first chat');
      expect(atFirst.route).toMatchObject({ epoch: 2, chat: chatOf(first) });
      if (observing) {
        expect(atFirst.route.conversationKind).toBe('direct');
        expect(atFirst.composer).toMatchObject({ ready: true, hidden: false });
        expect(atFirst.slot).toEqual({ state: 'ready', groupId: first, fanId: ids.fans[first] });
        expect(atFirst.identity).toMatchObject({ chat: chatOf(first), routeEpoch: 2, composerInstanceId: atFirst.composer?.instanceId });
        // The target's generation snapshot through the port: its own group and fan; texts for Reply, none for Recap.
        await waitForFanslyStandIdle();
        const reply = await tap<{ group: string; fan: string; window: number; tail: number | null } | null>('portSnapshot', 'reply', true);
        expect(reply).toMatchObject({ group: first, fan: ids.fans[first] });
        expect(reply?.tail).not.toBeNull();
        expect(await tap('portSnapshot', 'recap', true)).toMatchObject({ group: first, fan: ids.fans[first], tail: null });
      } else {
        // No fan named: no composer, no header slot, no snapshot — and the report says why.
        expect([atFirst.composer, atFirst.slot]).toEqual([null, { state: 'none', reason: 'no-chat' }]);
        expect(report.capabilities.chatWindow).toEqual({ state: 'off', reason: 'observation', code: 'CG-HOST-NOT-READY' });
      }

      await callFansly('open', second);
      expect((await at(second, 'the second chat')).route).toMatchObject({ epoch: 3, chat: chatOf(second) });
      // The gallery takes the header and the container away without a change of address: the same route and chat, no field.
      await callFansly('setGallery', true);
      const gallery = await waitForTap(portView, (view) => view.anchors.gallery, 'the gallery');
      expect(gallery).toMatchObject({ route: { epoch: 3, conversationRef: second, chat: chatOf(second) }, anchors: { container: false, textarea: false }, composer: null, slot: { state: 'none', reason: 'gallery' } });
      await callFansly('setGallery', false);
      await waitForTap(portView, (view) => view.anchors.textarea && !view.anchors.gallery, 'back from the gallery');
      // Back: `popstate` before Angular moves, and the nodes after it — A → B → A, the first chat's own fan again.
      await browser.back();
      expect((await at(first, 'back to the first chat')).route).toMatchObject({ epoch: 4, chat: chatOf(first) });
      await waitForFanslyStandIdle();

      // Idle, the observers stay silent: the fan types and writes, the inbox moves — nothing of it is watched.
      const quiet = (await portHealth()).isolated.anchors;
      expect(quiet).toMatchObject({ searching: false, exhausted: false });
      await callFansly('fanTyping', first);
      await callFansly('fanMessage', first, 'hello');
      await waitFor(async () => ((await callFansly('list'))?.messages ?? 0) > 0 && ((await callFansly('list'))?.typing ?? true) === false, 'the fan’s message in the feed');
      await waitForFanslyStandIdle();
      expect((await portHealth()).isolated.anchors.workCallbacks).toBe(quiet.workCallbacks);

      // FS-RTE-3: a verification without a signal finds the address where the signals left it.
      expect(await tap('verify')).toEqual({ changes: 3, unsignalled: 0, restorations: 0 });
      // The stream: every batch acknowledged, nothing lost.
      const health = await waitForTap(portHealth, (h) => h.main !== null && h.main.stream.unacked === 0 && h.isolated.stream?.acked === h.main.stream.batches, 'every batch acknowledged');
      expect(health.isolated.stream).toMatchObject({ gaps: 0, refused: 0, skipped: 0 });
      expect(health.main?.stream.gaps).toBe(0);
      expect((await tap<Array<{ event: string }>>('diagnostics')).filter((d) => d.event !== 'main-missing')).toEqual([]);
    });
  }
});
