// The two MAIN scripts together (architecture.md §6.6–§6.8): the bridge's
// runtime over a ChatSpace-shaped page (testing/fake-page.ts) and the tap
// script with its live port. What the runtime lends (page reads, the draft's
// revision chain, the event channel) and what it gets back (the checkpoint,
// the X8 send port, the flags, the `wsFrames` anchor), whichever script ran
// first. Answers and events are checked with the contracts' own schemas.


import { FROM_MAIN, parseBridgeData } from '@cg/contracts/bridge-messages';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FakeSocket, fakeQueue, frames, scriptedFetch, type FakeQueue, type FetchCall } from '../testing/fake-live';
import { createFakePage, fakeStore, seedCache, type FakeComposer, type FakePage } from '../testing/fake-page';
import { type MainContext, type MainRuntime } from '@cg/host-kit/main/bridge';
import { faultCounter, guardWith } from '@cg/host-kit/main/guard';
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

  it('the page’s own facts refuse: the open chat, a blocked fan from fansMap; a loaded history does not (audit 2026-10-20, row 17); a subscription ChatSpace dropped warns', async () => {
    const h = await start();
    h.call('flags', { wsTap: true, previewSend: true });
    h.socket();
    expect(h.call('previewSendPreflight', sendRequest(h, 11, { fan: OPEN, checkpoint: h.call('checkpoint', { acc: ACC, fan: OPEN }) }))).toEqual({ ok: false, code: 'CG-SEND-ACTIVE-CHAT' });
    const req = sendRequest(h, 12);
    h.page.cache.set(['fansMap', ACC], { [TARGET]: { id: TARGET, isBlocked: true, canReceiveMessages: true, isRestricted: false } });
    expect(h.call('previewSendPreflight', req)).toEqual({ ok: false, code: 'CG-SEND-FAN' });
    h.page.cache.set(['fansMap', ACC], {});
    h.page.cache.set(['chatMessages', ACC, TARGET], { pages: [], pageParams: [] });
    expect(h.call('previewSendPreflight', req)).toEqual({ ok: true });
    // ChatSpace unsubscribes the account (its tab was closed): the store's change reaches the tap at once.
    const accounts = h.page.stores.get('accounts');
    if (accounts) accounts['subscribedAccountIds'] = new Set();
    accounts?.$changed();
    expect(h.of('coverage').at(-1)).toEqual({ acc: ACC, state: 'unknown', reason: 'subscription' });
    expect(h.call('previewSendPreflight', req)).toEqual({ ok: true, warn: 'CG-SEND-FRESHNESS' });
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

  it('the composer of another chat tab, or an editor that cannot be observed, gives no fact at all', async () => {
    const h = await start();
    const socket = h.socket();
    // A send for a chat that is not the route's (its composer is not the visible one).
    h.queue.send({ accountId: ACC, chatId: '2009', platform: 'onlyfans', text: '<p>x</p>', composerContent: { html: '<p>x</p>' } });
    await answer(h, socket, 0, '8106');
    expect(h.of('humanSend')).toEqual([]);
  });
});
