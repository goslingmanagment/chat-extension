// The two MAIN scripts together (architecture.md §6.6–§6.8): the bridge's
// runtime over a ChatSpace-shaped page (testing/fake-page.ts) and the tap
// script with its live port. What the runtime lends (page reads, the draft's
// revision chain, the event channel) and what it gets back (the checkpoint,
// the X8 send port, the flags, the `wsFrames` anchor), whichever script ran
// first. Answers and events are checked with the contracts' own schemas.

/* eslint-disable @typescript-eslint/unbound-method -- the tests compare the page's `fetch` by identity */

import { FROM_MAIN, parseBridgeData } from '@cg/contracts/bridge-messages';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FakeSocket, fakeLive, fakeQueue, frames, scriptedFetch, type FakeQueue, type FetchCall } from '../testing/fake-live';
import { createFakePage, fakeStore, seedCache, type FakeComposer, type FakePage } from '../testing/fake-page';
import { type MainContext, type MainRuntime } from './bridge';
import { faultCounter, guardWith } from './guard';
import { createMainRuntime } from './runtime';
import { installWsTap } from './ws-tap';

const ACC = '1001';
const OPEN = '2002';
const TARGET = '2003';
const URL_OK = 'wss://chat.example.test/api/chat-space/ws';
const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

interface Harness {
  readonly page: FakePage;
  readonly runtime: MainRuntime;
  readonly queue: FakeQueue;
  readonly calls: FetchCall[];
  readonly composer: FakeComposer;
  readonly events: Array<{ t: string; payload: Record<string, unknown> }>;
  frame(): void;
  call(t: string, payload: unknown): unknown;
  socket(): FakeSocket;
  of(t: string): Array<Record<string, unknown>>;
  settle(): Promise<void>;
}

const nativeSocket = window.WebSocket;
const nativeFetch = window.fetch;
let cleanup: Array<() => void> = [];

/** `order`: which of the two document_start scripts ran first; `early` — what reaches the runtime between the two (`bridge-first`). */
async function start(order: 'tap-first' | 'bridge-first' | 'no-tap' = 'tap-first', early?: (runtime: MainRuntime) => void): Promise<Harness> {
  FakeSocket.made = [];
  const net = scriptedFetch();
  window.WebSocket = FakeSocket as unknown as typeof WebSocket;
  window.fetch = net.fetch;
  if (order === 'tap-first') installWsTap(window);

  const page = createFakePage(document);
  seedCache(page.cache);
  page.cache.set(['mimicChats'], {});
  const composer = page.addComposer(ACC, OPEN);
  const queue = fakeQueue(window);
  const settings: Record<string, unknown> = {};
  page.addStore(queue.store);
  page.addStore(fakeStore('accounts', { subscribedAccountIds: new Set([ACC]) }));
  page.addStore(fakeStore('composerTranslator', { settings, getAccountSettings: (acc: string) => ({ value: { enabled: false, autoTranslate: true, ...(settings[acc] as object | undefined) } }) }));

  const events: Harness['events'] = [];
  let frames_: Array<() => void> = [];
  const fail = faultCounter((source, count) => events.push({ t: 'fault', payload: { source, count } }));
  const guard = guardWith(fail);
  const context: MainContext = {
    win: window,
    documentEpoch: 'doc1',
    now: () => performance.now(),
    setTimer: (callback, ms) => setTimeout(callback, ms),
    frame: (callback) => frames_.push(callback),
    guard,
    fault: fail,
    emit: (t, build) => events.push({ t, payload: build() }),
    post: (t, payload) => events.push({ t, payload }),
  };
  const runtime = createMainRuntime(context);
  early?.(runtime);
  if (order === 'bridge-first') installWsTap(window);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const frame = (): void => {
    const now = frames_;
    frames_ = [];
    for (const callback of now) callback();
  };
  frame();
  cleanup.push(() => runtime.dispose());
  return {
    page,
    runtime,
    queue,
    calls: net.calls,
    composer,
    events,
    frame,
    call: (t, payload) => runtime.handle(t, payload),
    socket: () => {
      const socket = new window.WebSocket(URL_OK) as unknown as FakeSocket;
      socket.receive(frames.authenticated);
      socket.receive(frames.summary(ACC));
      return socket;
    },
    of: (t) => events.filter((event) => event.t === t).map((event) => event.payload),
    settle: () => new Promise((resolve) => setTimeout(resolve, 5)),
  };
}

beforeEach(() => {
  cleanup = [];
});
afterEach(() => {
  for (const step of cleanup.splice(0)) step();
  (Reflect.get(window, Symbol.for('wsTap')) as { dispose(): void } | undefined)?.dispose();
  window.WebSocket = nativeSocket;
  window.fetch = nativeFetch;
});

const sendRequest = (h: Harness, n: number, over: Record<string, unknown> = {}) => ({
  req: {
    attemptId: uuid(n),
    acc: ACC,
    fan: TARGET,
    platformAccountId: '3003',
    part: { index: 0 },
    previewRevision: 0,
    plainText: 'hey you',
    isAiGenerated: true,
    checkpoint: h.call('checkpoint', { acc: ACC, fan: TARGET }),
    expiresAt: Date.now() + 10_000,
    ...over,
  },
});

describe('[X8-04] the runtime and the tap script find each other (§6.8)', () => {
  it.each(['tap-first', 'bridge-first'] as const)('%s: the live port answers the flags and the checkpoint, and `wsFrames` follows the socket', async (order) => {
    const h = await start(order);
    expect(h.call('flags', { wsTap: true, previewSend: true })).toEqual({ wsTap: true, previewSend: true });
    const contract = (): { missing: string[]; shape: string[] } => (h.call('snapshot', {}) as { contract: { missing: string[]; shape: string[] } }).contract;
    // No authenticated socket yet: the frames are not proven.
    expect(contract().missing).toEqual(['wsFrames']);
    const cold = parseBridgeData('checkpoint', h.call('checkpoint', { acc: ACC, fan: TARGET }));
    expect(cold).toMatchObject({ documentEpoch: 'doc1', coverage: 'unknown', fanSequence: 0 });
    const socket = h.socket();
    expect(contract().missing).toEqual([]);
    // The anchor's change reached the isolated side as a contract event.
    expect(h.of('contract').at(-1)).toMatchObject({ missing: [] });
    socket.receive(frames.message(ACC, TARGET, '5001', true));
    expect(parseBridgeData('checkpoint', h.call('checkpoint', { acc: ACC, fan: TARGET }))).toMatchObject({ coverage: 'ok', fanSequence: 1, lastFanMessageId: '5001', knownFanMessageIds: ['5001'], socketEpoch: 1 });
    // Facts and coverage go out undropped, schema-valid, and without any text.
    const incoming = h.of('incoming');
    expect(incoming).toHaveLength(1);
    expect(FROM_MAIN.incoming.safeParse(incoming[0]).success).toBe(true);
    expect(h.of('coverage')).toEqual([{ acc: ACC, state: 'ok', reason: 'armed' }]);
    expect(FROM_MAIN.coverage.safeParse(h.of('coverage')[0]).success).toBe(true);
    expect(JSON.stringify(h.events)).not.toContain('text of');
  });

  it('without the tap script nothing live runs: no checkpoint, a send is refused before execution, both flags read back off', async () => {
    const h = await start('no-tap');
    expect(h.call('flags', { wsTap: true, previewSend: true })).toEqual({ wsTap: false, previewSend: false });
    expect(h.call('checkpoint', { acc: ACC, fan: TARGET })).toBe('disabled');
    const req = { req: { attemptId: uuid(1), acc: ACC, fan: TARGET, platformAccountId: '3003', part: { index: 0 }, previewRevision: 0, plainText: 'hey', isAiGenerated: true, checkpoint: { documentEpoch: 'doc1', socketEpoch: 1, subscriptionEpoch: 1, hostAccountId: ACC, platformFanId: TARGET, fanSequence: 0, lastFanMessageId: null, knownFanMessageIds: [], observedAt: 1, coverage: 'ok' }, expiresAt: Date.now() + 1000 } };
    expect(h.call('previewSendPreflight', req)).toBe('disabled');
    expect(h.call('previewSendCommit', req)).toBe('disabled');
    expect((h.call('snapshot', {}) as { contract: { missing: string[] } }).contract.missing).toEqual(['wsFrames']);
    // A human send is not observed either: fetch stays the page's, no fact goes out.
    h.queue.send({ accountId: ACC, chatId: OPEN, platform: 'onlyfans', text: '<p>x</p>', composerContent: { html: '<p>x</p>' } });
    expect(window.fetch).not.toBe(nativeFetch);
    expect(h.of('humanSend')).toEqual([]);
    expect(h.queue.sends).toHaveLength(1);
  });

  it('a live request that comes before the tap script ran does not shut the tap out: the next one finds it', async () => {
    const answers: unknown[] = [];
    // The isolated side asks while only the bridge's script has run; the dynamically registered tap script comes right after.
    const h = await start('bridge-first', (runtime) => {
      answers.push(runtime.handle('flags', { wsTap: true, previewSend: true }), runtime.handle('checkpoint', { acc: ACC, fan: TARGET }));
    });
    expect(answers).toEqual([{ wsTap: false, previewSend: false }, 'disabled']);
    expect(h.call('flags', { wsTap: true, previewSend: true })).toEqual({ wsTap: true, previewSend: true });
    h.socket();
    expect(parseBridgeData('checkpoint', h.call('checkpoint', { acc: ACC, fan: TARGET }))).toMatchObject({ coverage: 'ok' });
    expect(h.call('previewSendPreflight', sendRequest(h, 5))).toEqual({ ok: true });
  });

  it('only the port’s own accounts are the tap’s: a Telegram account ChatSpace subscribed on the same socket is not ours', async () => {
    const h = await start();
    h.call('flags', { wsTap: true, previewSend: true });
    h.page.cache.set(['accounts'], [
      { id: Number(ACC), platformAccountId: '3003', platform: 'onlyfans' },
      { id: 5555, platformAccountId: 'tg-1', platform: 'telegram_v2' },
    ]);
    const accounts = h.page.stores.get('accounts');
    if (accounts) accounts['subscribedAccountIds'] = new Set([ACC, '5555']);
    accounts?.$changed();
    const socket = h.socket();
    const before = h.call('checkpoint', { acc: ACC, fan: TARGET });
    const telegram = frames.message('5555', TARGET, '1', true);
    socket.receive({ ...telegram, message: { ...telegram.message, chatId: '-100123', id: 'abc' } });
    socket.receive(frames.message('5555', TARGET, '5001', true));
    // Not counted, not forwarded, and the frames of our accounts still read well.
    expect(h.of('incoming')).toEqual([]);
    expect(h.of('coverage')).toEqual([{ acc: ACC, state: 'ok', reason: 'armed' }]);
    expect((h.call('snapshot', {}) as { contract: { missing: string[]; shape: string[] } }).contract).toMatchObject({ missing: [], shape: [] });
    expect(h.call('previewSendPreflight', sendRequest(h, 4, { checkpoint: before }))).toEqual({ ok: true });
  });

  it('every payload is checked by hand before the live port sees it', async () => {
    const h = await start();
    h.call('flags', { wsTap: true, previewSend: true });
    h.socket();
    const good = sendRequest(h, 2);
    expect(h.call('checkpoint', { acc: ACC })).toBe('bad-request');
    expect(h.call('flags', { wsTap: true })).toBe('bad-request');
    for (const broken of [
      { req: { ...good.req, binding: {} } },
      { req: { ...good.req, ticket: 'ticket-1' } },
      { req: { ...good.req, plainText: '' } },
      { req: { ...good.req, plainText: 'x'.repeat(5001) } },
      { req: { ...good.req, attemptId: 'attempt-1' } },
      { req: { ...good.req, fan: '2004' } },
      { req: { ...good.req, checkpoint: { ...(good.req.checkpoint as object), coverage: 'maybe' } } },
      { req: { ...good.req, checkpoint: { ...(good.req.checkpoint as object), knownFanMessageIds: ['5001'] } } },
      { req: { ...good.req, checkpoint: { ...(good.req.checkpoint as object), lastFanMessageId: '5001', knownFanMessageIds: ['5001', '5001'] } } },
    ]) {
      expect([broken, h.call('previewSendPreflight', broken)]).toEqual([broken, 'bad-request']);
      expect(h.call('previewSendCommit', broken)).toBe('bad-request');
    }
    expect(h.queue.sends).toEqual([]);
  });

  it('[NEW-08] `wsTap: false` switches the tap off for this document: the constructor and the handle are gone, nothing is fresh', async () => {
    const h = await start();
    h.call('flags', { wsTap: true, previewSend: true });
    h.socket();
    const req = sendRequest(h, 3);
    expect(h.call('previewSendPreflight', req)).toEqual({ ok: true });
    expect(h.call('flags', { wsTap: false, previewSend: true })).toEqual({ wsTap: false, previewSend: false });
    expect(window.WebSocket).toBe(FakeSocket);
    expect(Reflect.get(window, Symbol.for('wsTap'))).toBeUndefined();
    expect(h.call('checkpoint', { acc: ACC, fan: TARGET })).toBe('disabled');
    expect(h.call('previewSendCommit', req)).toEqual({ state: 'held', code: 'CG-SEND-OFF' });
    expect((h.call('snapshot', {}) as { contract: { missing: string[] } }).contract.missing).toEqual(['wsFrames']);
    expect(h.of('coverage').at(-1)).toEqual({ acc: ACC, state: 'unknown', reason: 'off' });
    expect(h.queue.sends).toEqual([]);
  });

  it('the page takes the port first (MAIN is untrusted): the bridge stays without one, like no tap at all', async () => {
    FakeSocket.made = [];
    window.WebSocket = FakeSocket as unknown as typeof WebSocket;
    const handle = installWsTap(window);
    // The page's own code calls the hand-off before our runtime does.
    expect(handle?.attach(fakeLive().host)).not.toBeNull();
    const h = await start('bridge-first');
    expect(h.call('flags', { wsTap: true, previewSend: true })).toEqual({ wsTap: false, previewSend: false });
    expect(h.call('checkpoint', { acc: ACC, fan: TARGET })).toBe('disabled');
  });
});

describe('[X8-06] our listeners inside ChatSpace’s own action and state change (§6.10)', () => {
  it('a failure of ours never reaches the page: its send goes on, its state change completes', async () => {
    let asked = 0;
    const fail = (): never => {
      asked += 1;
      throw new Error('ours');
    };
    const key = Symbol.for('wsTap');
    // A tap script whose live port fails on every call.
    Object.defineProperty(window, key, { configurable: true, value: { version: 1, socketCount: () => 0, dispose: () => Reflect.deleteProperty(window, key), attach: () => ({ handle: () => 'disabled', anchor: () => 'missing', sent: fail, sync: fail }) } });
    const h = await start('no-tap');
    asked = 0;
    expect(h.queue.send({ accountId: ACC, chatId: TARGET, platform: 'onlyfans', text: '<p>x</p>' })).toMatchObject({ chatId: TARGET, status: 'sending' });
    expect(asked).toBe(1);
    expect(() => h.page.stores.get('accounts')?.$changed()).not.toThrow();
    expect(asked).toBe(2);
  });
});

describe('[X8-05] a preview send through the whole MAIN side (§6.7)', () => {
  it('[SP-054] reads its conditions from the page’s own memory and makes one queue call; the states are the contract’s', async () => {
    const h = await start();
    h.call('flags', { wsTap: true, previewSend: true });
    const socket = h.socket();
    const req = sendRequest(h, 10);
    const reads: string[] = [];
    h.page.cache.store.$onAction(({ name }) => reads.push(name));
    expect(h.call('previewSendPreflight', req)).toEqual({ ok: true });
    const answer = parseBridgeData('previewSendCommit', h.call('previewSendCommit', req));
    expect(answer).toEqual({ state: 'nativeEnqueued', pendingId: h.queue.entries(ACC)[0]?.id });
    // Reads only: no cache action but lookups, no store was created, the route did not move.
    expect(new Set(reads)).toEqual(new Set(['getQueryData']));
    expect(h.page.pushes).toEqual([]);
    expect(h.queue.sends).toHaveLength(1);
    expect(h.queue.sends[0]).toMatchObject({ accountId: ACC, chatId: TARGET, text: '<p>hey you</p>', isAiGenerated: true, isCopied: false, platformMetadata: {} });
    expect(window.fetch).not.toBe(nativeFetch);
    await h.settle();
    h.calls[0]?.respond(200, { id: '8001' });
    await h.settle();
    socket.receive(frames.message(ACC, TARGET, '8001', false));
    const views = h.of('previewSendState');
    expect(views.map((payload) => (payload['view'] as { state: string }).state)).toEqual(['nativeAccepted', 'sentObserved']);
    for (const payload of views) expect(FROM_MAIN.previewSendState.safeParse(payload).success).toBe(true);
    // The open chat's draft was never touched by the send.
    expect(h.composer.calls).toEqual([]);
  });

  it('the page’s own facts refuse: the open chat, a blocked fan from fansMap, an observed history entry, a subscription ChatSpace dropped', async () => {
    const h = await start();
    h.call('flags', { wsTap: true, previewSend: true });
    h.socket();
    expect(h.call('previewSendPreflight', sendRequest(h, 11, { fan: OPEN, checkpoint: h.call('checkpoint', { acc: ACC, fan: OPEN }) }))).toEqual({ ok: false, code: 'CG-SEND-ACTIVE-CHAT' });
    const req = sendRequest(h, 12);
    h.page.cache.set(['fansMap', ACC], { [TARGET]: { id: TARGET, isBlocked: true, canReceiveMessages: true, isRestricted: false } });
    expect(h.call('previewSendPreflight', req)).toEqual({ ok: false, code: 'CG-SEND-FAN' });
    h.page.cache.set(['fansMap', ACC], {});
    h.page.cache.set(['chatMessages', ACC, TARGET], { pages: [], pageParams: [] });
    expect(h.call('previewSendPreflight', req)).toEqual({ ok: false, code: 'CG-SEND-HISTORY' });
    h.page.cache.delete(['chatMessages', ACC, TARGET]);
    expect(h.call('previewSendPreflight', req)).toEqual({ ok: true });
    // ChatSpace unsubscribes the account (its tab was closed): the store's change reaches the tap at once.
    const accounts = h.page.stores.get('accounts');
    if (accounts) accounts['subscribedAccountIds'] = new Set();
    accounts?.$changed();
    expect(h.of('coverage').at(-1)).toEqual({ acc: ACC, state: 'unknown', reason: 'subscription' });
    expect(h.call('previewSendCommit', req)).toEqual({ state: 'held', code: 'CG-SEND-FRESHNESS' });
    expect(h.queue.sends).toEqual([]);
  });
});

describe('[TL-004] a human send keeps the revision chain of our insert (§6.6)', () => {
  const intentFor = (h: Harness, n: number, text: string, mode = 'replace', confirmationId: string | null = null) => {
    const snapshot = h.call('snapshot', {}) as { route: { epoch: number }; composer: { instanceId: string; draft: { revision: number } } };
    const identity = { host: 'chatspace', documentEpoch: 'doc1', hostLoginEpoch: 'L1', hostAccountId: ACC, platformAccountId: '3003', chat: { host: 'chatspace', hostAccountId: ACC, platformFanId: OPEN }, routeEpoch: snapshot.route.epoch, composerInstanceId: snapshot.composer.instanceId };
    const draft = h.call('readDraft', { expected: identity }) as { revision: number; digest: string };
    return {
      intentId: uuid(n),
      operationId: uuid(7),
      part: { index: 0 },
      target: identity.chat,
      expected: { kind: 'open', documentEpoch: 'doc1', routeEpoch: snapshot.route.epoch, composerInstanceId: snapshot.composer.instanceId, draftRevision: draft.revision, draftDigest: draft.digest },
      mode,
      text,
      confirmationId,
      createdAt: Date.now() - 10,
      expiresAt: Date.now() + 20_000,
    };
  };
  const insert = async (h: Harness, n: number, text: string, mode = 'replace', confirmationId: string | null = null): Promise<unknown> => {
    const pending = h.call('insertGuarded', { intent: intentFor(h, n, text, mode, confirmationId) });
    await Promise.resolve();
    await Promise.resolve();
    h.frame();
    return pending;
  };
  /** The person presses ChatSpace's Send: the composer queues its HTML and clears its field. */
  const pressSend = (h: Harness): { id: string } | null => {
    const editor = h.composer.editor;
    const html = `<p>${editor?.text ?? ''}</p>`;
    const entry = h.queue.send({ accountId: ACC, chatId: OPEN, platform: 'onlyfans', text: html, hasAttachments: false, platformMetadata: {}, composerContent: { html, media: null, gif: null, taggedCreators: [] } });
    if (entry) editor?.type('');
    return entry;
  };
  /** The server accepts the message: the response with its id, then the outgoing echo on ChatSpace's socket. */
  const answer = async (h: Harness, socket: FakeSocket, index: number, id: string): Promise<void> => {
    await h.settle();
    h.calls[index]?.respond(200, { id });
    await h.settle();
    // The receipt alone is not «sent»: the fact goes out with the echo of the same id (§6.6 п. 4).
    expect(h.of('humanSend').some((fact) => fact['platformMessageId'] === id)).toBe(false);
    socket.receive(frames.message(ACC, OPEN, id, false));
  };

  it('unchanged insert → sent, not edited; edited insert → edited; after the send the chain ends', async () => {
    const h = await start();
    const socket = h.socket();
    expect(await insert(h, 0x60, 'Hello there')).toMatchObject({ state: 'applied' });
    const first = pressSend(h);
    await answer(h, socket, 0, '8101');
    const facts = (): Array<Record<string, unknown>> => h.of('humanSend');
    expect(facts()).toHaveLength(1);
    expect(facts()[0]).toMatchObject({ acc: ACC, fan: OPEN, pendingId: first?.id, platformMessageId: '8101', draft: { provenance: 'our-insert', insertIntentId: uuid(0x60), editedSinceInsert: false } });
    expect(FROM_MAIN.humanSend.safeParse(facts()[0]).success).toBe(true);

    // The next send was typed by the person: the field was emptied in between, nothing of ours is in it.
    h.composer.editor?.type('my own words');
    pressSend(h);
    await h.settle();
    expect(facts()[1]).toMatchObject({ platformMessageId: null, draft: { provenance: 'human-or-unknown', insertIntentId: null, editedSinceInsert: null } });
    expect(FROM_MAIN.humanSend.safeParse(facts()[1]).success).toBe(true);
    h.calls[1]?.respond(200, { id: '8102' });
    await h.settle();

    // An insert the person then edits: still our insert's descendant, by the revision chain — not by the text.
    expect(await insert(h, 0x61, 'Second one')).toMatchObject({ state: 'applied' });
    h.composer.editor?.type('Something else entirely');
    pressSend(h);
    await answer(h, socket, 2, '8103');
    expect(facts()[2]).toMatchObject({ platformMessageId: '8103', draft: { provenance: 'human-or-unknown', insertIntentId: uuid(0x61), editedSinceInsert: true } });
    expect(FROM_MAIN.humanSend.safeParse(facts()[2]).success).toBe(true);
    // The digest is of the draft's text as it stood at the send: an integrity check only.
    expect(facts()[2]?.['textDigest']).not.toBe(facts()[0]?.['textDigest']);
  });

  it('an append into the person’s own draft is sent as «edited» of that insert; a formatting change counts as an edit', async () => {
    const h = await start();
    const socket = h.socket();
    h.composer.editor?.type('mine');
    expect(await insert(h, 0x62, 'added', 'append', uuid(0x99))).toMatchObject({ state: 'applied' });
    pressSend(h);
    await answer(h, socket, 0, '8104');
    expect(h.of('humanSend')[0]).toMatchObject({ platformMessageId: '8104', draft: { provenance: 'human-or-unknown', insertIntentId: uuid(0x62), editedSinceInsert: true } });

    expect(await insert(h, 0x63, 'Plain')).toMatchObject({ state: 'applied' });
    h.composer.editor?.format();
    pressSend(h);
    await answer(h, socket, 1, '8105');
    expect(h.of('humanSend')[1]).toMatchObject({ draft: { insertIntentId: uuid(0x63), editedSinceInsert: true } });
  });

  it('the composer of another chat tab, or an editor that cannot be observed, gives no fact at all', async () => {
    const h = await start();
    const socket = h.socket();
    // A send for a chat that is not the route's (its composer is not the visible one).
    h.queue.send({ accountId: ACC, chatId: '2009', platform: 'onlyfans', text: '<p>x</p>', composerContent: { html: '<p>x</p>' } });
    await answer(h, socket, 0, '8106');
    expect(h.of('humanSend')).toEqual([]);
  });
});
