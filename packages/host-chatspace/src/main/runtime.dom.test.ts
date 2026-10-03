// The MAIN runtime against a ChatSpace-shaped page (src/testing/fake-page.ts),
// driven through its request handler with a hand-made boot context: frames are
// flushed by the test, events are recorded. Answers are checked with the
// contracts' own schemas (what the isolated side will check).

import { ChatWindowSchema, HostFanSchema, InsertReceiptSchema, NavigationItemSchema, NavigationReceiptSchema, TailSnapshotSchema } from '@cg/contracts/host';
import { DraftWireSchema, MainSnapshotSchema } from '@cg/contracts/bridge-messages';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFakePage, fakeStore, seedCache, type FakeComposer, type FakePage } from '../testing/fake-page';
import { type MainContext, type MainRuntime } from './bridge';
import { createMainRuntime } from './runtime';

const ACC = '1001';
const FAN = '2002';
const OTHER = '2003';
const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

interface Harness {
  readonly page: FakePage;
  readonly runtime: MainRuntime;
  readonly events: Array<{ t: string; payload: Record<string, unknown> }>;
  /** Runs the frames queued so far (and only those). */
  frame(): void;
  call(t: string, payload: unknown): Promise<unknown>;
  dispose(): void;
}

let harness: Harness | null = null;

async function start(setup?: (page: FakePage) => void): Promise<Harness> {
  const page = createFakePage(document);
  seedCache(page.cache);
  setup?.(page);
  const events: Harness['events'] = [];
  let frames: Array<() => void> = [];
  const context: MainContext = {
    win: window,
    documentEpoch: 'doc1',
    now: () => performance.now(),
    setTimer: (callback, ms) => setTimeout(callback, ms),
    frame: (callback) => frames.push(callback),
    emit: (t, build) => events.push({ t, payload: build() }),
  };
  const runtime = createMainRuntime(context);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const frame = (): void => {
    const now = frames;
    frames = [];
    for (const callback of now) callback();
  };
  frame();
  harness = {
    page,
    runtime,
    events,
    frame,
    call: (t, payload) => Promise.resolve(runtime.handle(t, payload)),
    dispose: () => runtime.dispose(),
  };
  return harness;
}

afterEach(() => {
  harness?.dispose();
  harness = null;
});

const identity = (h: Harness, over: Record<string, unknown> = {}) => {
  const snapshot = h.runtime.handle('snapshot', {}) as { route: { epoch: number }; hostLoginEpoch: string; composer: { instanceId: string } | null };
  return {
    host: 'chatspace',
    documentEpoch: 'doc1',
    hostLoginEpoch: snapshot.hostLoginEpoch,
    hostAccountId: ACC,
    platformAccountId: '3003',
    chat: { host: 'chatspace', hostAccountId: ACC, platformFanId: FAN },
    routeEpoch: snapshot.route.epoch,
    composerInstanceId: snapshot.composer?.instanceId ?? null,
    ...over,
  };
};

const draft = async (h: Harness) => DraftWireSchema.parse(await h.call('readDraft', { expected: identity(h) }));

async function openIntent(h: Harness, over: Record<string, unknown> = {}, text = 'Hello there') {
  const id = identity(h);
  const current = await draft(h);
  return {
    intentId: uuid(Math.floor(Math.random() * 1e9)),
    operationId: uuid(7),
    part: { index: 0 },
    target: { host: 'chatspace', hostAccountId: ACC, platformFanId: FAN },
    expected: { kind: 'open', documentEpoch: 'doc1', routeEpoch: id.routeEpoch, composerInstanceId: id.composerInstanceId, draftRevision: current.revision, draftDigest: current.digest },
    mode: 'replace',
    text,
    confirmationId: null,
    createdAt: Date.now() - 10,
    expiresAt: Date.now() + 20_000,
    ...over,
  };
}

/** Lets the write's verification run: a microtask, then the frame the test flushes. */
async function settleWrite<T>(h: Harness, pending: unknown): Promise<T> {
  await Promise.resolve();
  await Promise.resolve();
  h.frame();
  return (await pending) as T;
}

let composer: FakeComposer;

describe('MAIN runtime — reads (§6.1)', () => {
  beforeEach(async () => {
    await start((page) => {
      composer = page.addComposer(ACC, FAN);
    });
  });

  it('[EX-007] [BG-002] the snapshot rebuilds the tab state from page memory: route, accounts with platformAccountId, composer, contract', () => {
    const h = harness as Harness;
    const snapshot = MainSnapshotSchema.parse(h.runtime.handle('snapshot', {}));
    expect(snapshot.route).toMatchObject({ epoch: 1, name: 'chat', chat: { hostAccountId: ACC, platformFanId: FAN }, account: { hostAccountId: ACC, platformAccountId: '3003' } });
    expect(snapshot.hostLoginEpoch).toBe('L1');
    expect(snapshot.composer).toMatchObject({ chat: { platformFanId: FAN }, ready: true, hidden: false, draft: { revision: 0, provenance: 'empty' } });
    expect(snapshot.accounts).toEqual([{ host: 'chatspace', hostAccountId: ACC, platform: 'onlyfans', platformAccountId: '3003', username: 'model_one', displayName: 'Model One' }]);
    expect(snapshot.contract).toMatchObject({ missing: ['pendingMessages', 'composerTranslator'], shape: [] });
    expect(h.events.map((event) => event.t)).toEqual(expect.arrayContaining(['route', 'accounts', 'contract', 'composer']));
  });

  it('[AU-034] [AU-035] lists the accounts ChatSpace has loaded, bound by platformAccountId only', async () => {
    const h = harness as Harness;
    h.page.cache.set(['accounts'], [
      { id: 1001, platformAccountId: '3003', platform: 'onlyfans', username: 'one', name: 'One', customLabel: 'Label' },
      { id: 1002, platformAccountId: null, platform: 'onlyfans', username: 'two', name: 'Two' },
      { id: 1003, platformAccountId: '3004', platform: 'fansly', username: 'three' },
      { id: 'x', platformAccountId: '1' },
    ]);
    expect(await h.call('listAccounts', {})).toEqual([
      { host: 'chatspace', hostAccountId: '1001', platform: 'onlyfans', platformAccountId: '3003', username: 'one', displayName: 'Label' },
      { host: 'chatspace', hostAccountId: '1002', platform: 'onlyfans', platformAccountId: null, username: 'two', displayName: 'Two' },
    ]);
    expect(h.events.some((event) => event.t === 'accounts')).toBe(true);
  });

  it('chat window: confirmed messages only, newest first, counts and older history (prechecks)', async () => {
    const window = ChatWindowSchema.parse(await (harness as Harness).call('chatWindow', { acc: ACC, fan: FAN, max: 200 }));
    expect(window).toEqual({
      chat: { host: 'chatspace', hostAccountId: ACC, platformFanId: FAN },
      state: 'ready',
      loaded: 2,
      fanMessages: 1,
      modelMessages: 1,
      lastFanMessageId: '4004',
      lastFanMessageAt: '2026-10-03T10:00:04.000Z',
      lastModelMessageAt: '2026-10-03T10:00:05.000Z',
      hasOlder: true,
    });
    expect(await (harness as Harness).call('chatWindow', { acc: ACC, fan: '2999', max: 10 })).toBeNull();
  });

  it('[UI-016] fresh tail (D-14): plain text, oldest first, never queued or non-numeric messages', async () => {
    const h = harness as Harness;
    const tail = TailSnapshotSchema.parse(await h.call('readTail', { expected: identity(h), max: 60 }));
    expect(tail.messages).toEqual([
      { platformMessageId: '4004', direction: 'fan', sentAt: '2026-10-03T10:00:04.000Z', text: 'hey\nthere' },
      { platformMessageId: '4005', direction: 'model', sentAt: '2026-10-03T10:00:05.000Z', text: 'newest from me' },
    ]);
    expect(TailSnapshotSchema.parse(await h.call('readTail', { expected: identity(h), max: 1 })).messages.map((m) => m.platformMessageId)).toEqual(['4005']);
    expect(await h.call('readTail', { expected: identity(h, { routeEpoch: 9 }), max: 5 })).toBe('identity-mismatch');
  });

  it('fan and chat list come from what ChatSpace already holds; nothing is loaded for them', async () => {
    const h = harness as Harness;
    h.page.addStore(fakeStore('chats', { isFanOnline: (fan: string) => fan === FAN }));
    const fan = HostFanSchema.parse(await h.call('fan', { acc: ACC, fan: FAN }));
    expect(fan).toMatchObject({ username: 'fan_two', displayName: 'Fan Two', isBlocked: false, isOnline: true, lastSeenAt: '2026-10-03T09:59:00.000Z', bio: 'bio' });
    expect(await h.call('fan', { acc: ACC, fan: '2999' })).toBeNull();
    const list = (await h.call('listChats', { acc: ACC, limit: 10 })) as unknown[];
    expect(list.map((row) => NavigationItemSchema.parse(row))).toEqual([
      { chat: { host: 'chatspace', hostAccountId: ACC, platformFanId: FAN }, position: 0, displayName: 'Fan Two', username: 'fan_two', unreadCount: 0, isOnline: true },
      { chat: { host: 'chatspace', hostAccountId: ACC, platformFanId: OTHER }, position: 1, displayName: 'Three', username: 'fan_three', unreadCount: 2, isOnline: false },
    ]);
    expect(await h.call('listChats', { acc: ACC, limit: 1 })).toHaveLength(1);
  });

  it('[RB-022] reads never write: no store or cache action of ours but reads, nothing marks a chat read', async () => {
    const h = harness as Harness;
    const seen: string[] = [];
    h.page.cache.store.$onAction(({ name }) => seen.push(name));
    for (const t of ['snapshot', 'listAccounts']) await h.call(t, {});
    await h.call('chatWindow', { acc: ACC, fan: FAN, max: 50 });
    await h.call('fan', { acc: ACC, fan: OTHER });
    await h.call('listChats', { acc: ACC, limit: 50 });
    await h.call('readTail', { expected: identity(h), max: 10 });
    expect(new Set(seen)).toEqual(new Set(['getQueryData', 'getEntries']));
  });

  it('[RB-008] the contract reports missing and misshaped anchors; a late store arrives through pinia.use', () => {
    const h = harness as Harness;
    h.page.cache.set(['accounts'], [{ id: 1001, platformAccountId: 3003 }]);
    let contract = (h.runtime.handle('snapshot', {}) as { contract: { missing: string[]; shape: string[] } }).contract;
    expect(contract.shape).toContain('accounts');
    expect(contract.missing).toContain('pendingMessages');
    h.page.addStore(fakeStore('pendingMessages', { enqueue: () => null, messagesByAccountId: {} }, ['enqueue']));
    h.page.addStore(fakeStore('composerTranslator', {}));
    contract = (h.runtime.handle('snapshot', {}) as { contract: { missing: string[]; shape: string[] } }).contract;
    expect(contract.missing).not.toContain('pendingMessages');
    expect(contract.missing).not.toContain('composerTranslator');
    expect(h.events.filter((event) => event.t === 'contract').length).toBeGreaterThan(1);
  });

  it('[RB-015] route epochs grow on every navigation; [BG-002] the route event carries the account and chat', () => {
    const h = harness as Harness;
    h.page.go(ACC, OTHER);
    h.page.go(ACC);
    const routes = h.events.filter((event) => event.t === 'route').map((event) => event.payload['route'] as { epoch: number; chat: unknown });
    expect(routes.at(-1)).toMatchObject({ epoch: 3, chat: null });
    expect(routes.at(-2)).toMatchObject({ epoch: 2, chat: { platformFanId: OTHER } });
  });

  it('a sign-out (the queue reset) starts a new host login epoch', () => {
    const h = harness as Harness;
    const queue = fakeStore('pendingMessages', { enqueue: () => null, resetAll: () => undefined, messagesByAccountId: {} }, ['resetAll']);
    h.page.addStore(queue);
    (queue['resetAll'] as () => void)();
    expect((h.runtime.handle('snapshot', {}) as { hostLoginEpoch: string }).hostLoginEpoch).toBe('L2');
  });
});

describe('MAIN runtime — guarded insert (§6.4)', () => {
  beforeEach(async () => {
    await start((page) => {
      composer = page.addComposer(ACC, FAN);
      page.addComposer(ACC, OTHER, { shown: false });
    });
  });

  it('[UI-019] replace into an empty draft: one synchronous CAS step, setText, verified → applied with the new revision and digest', async () => {
    const h = harness as Harness;
    const intent = await openIntent(h);
    const receipt = InsertReceiptSchema.parse(await settleWrite(h, h.call('insertGuarded', { intent })));
    expect(receipt).toMatchObject({ state: 'applied', draftRevision: 2 });
    expect(composer.calls).toEqual(['setText']);
    expect(composer.editor?.text).toBe('Hello there');
    const after = await draft(h);
    expect(after).toMatchObject({ provenance: 'our-insert', revision: 2, plainText: 'Hello there' });
    expect(receipt.state === 'applied' && receipt.draftDigest).toBe(after.digest);
  });

  it('[NEW-05] [UI-020] a human draft needs one-time consent for its revision; replace and append', async () => {
    const h = harness as Harness;
    composer.editor?.type('my words');
    const refused = InsertReceiptSchema.parse(await h.call('insertGuarded', { intent: await openIntent(h) }));
    expect(refused).toEqual({ state: 'rejected', code: 'CG-DRAFT-CHANGED', needs: 'confirm-human-draft' });
    const consent = uuid(99);
    const append = await openIntent(h, { mode: 'append', confirmationId: consent }, 'and more');
    expect(await settleWrite(h, h.call('insertGuarded', { intent: append }))).toMatchObject({ state: 'applied' });
    expect(composer.editor?.text).toBe('my words\nand more');
    expect(composer.calls).toEqual(['insertText']);
    composer.editor?.type('typed again');
    const reused = await openIntent(h, { confirmationId: consent });
    expect(await h.call('insertGuarded', { intent: reused })).toEqual({ state: 'rejected', code: 'CG-DRAFT-CHANGED', needs: 'confirm-human-draft' });
  });

  it('our unchanged insert is replaced without consent; once the person edits it, consent again', async () => {
    const h = harness as Harness;
    await settleWrite(h, h.call('insertGuarded', { intent: await openIntent(h) }));
    expect(await settleWrite(h, h.call('insertGuarded', { intent: await openIntent(h, {}, 'second') }))).toMatchObject({ state: 'applied' });
    composer.editor?.type('second, edited');
    expect(await h.call('insertGuarded', { intent: await openIntent(h, {}, 'third') })).toMatchObject({ state: 'rejected', needs: 'confirm-human-draft' });
  });

  it('[AI-022] A→B→A, formatting and restores change the revision: a stale CAS is refused (confirm-changed-draft)', async () => {
    const h = harness as Harness;
    composer.editor?.type('A');
    const stale = await openIntent(h, { confirmationId: uuid(5) });
    composer.editor?.type('B');
    composer.editor?.type('A');
    expect(await h.call('insertGuarded', { intent: stale })).toEqual({ state: 'rejected', code: 'CG-DRAFT-CHANGED', needs: 'confirm-changed-draft' });
    const before = await openIntent(h, { confirmationId: uuid(6) });
    composer.editor?.format();
    expect(await h.call('insertGuarded', { intent: before })).toMatchObject({ needs: 'confirm-changed-draft' });
    const selection = await openIntent(h, { confirmationId: uuid(8) });
    composer.editor?.select();
    expect(await settleWrite(h, h.call('insertGuarded', { intent: selection }))).toMatchObject({ state: 'applied' });
  });

  it('[RB-014] [RB-015] the route chat, its epoch and the composer instance must equal the intent; one use per intent; deadline', async () => {
    const h = harness as Harness;
    const wrongChat = await openIntent(h, { target: { host: 'chatspace', hostAccountId: ACC, platformFanId: OTHER } });
    expect(await h.call('insertGuarded', { intent: wrongChat })).toEqual({ state: 'rejected', code: 'CG-INSERT-CHAT-CHANGED' });
    const intent = await openIntent(h);
    const wrongComposer = { ...intent, intentId: uuid(31), expected: { ...intent.expected, composerInstanceId: 'c999' } };
    expect(await h.call('insertGuarded', { intent: wrongComposer })).toEqual({ state: 'rejected', code: 'CG-INSERT-CHAT-CHANGED' });
    const expired = await openIntent(h, { createdAt: Date.now() - 100, expiresAt: Date.now() - 1 });
    expect(await h.call('insertGuarded', { intent: expired })).toEqual({ state: 'rejected', code: 'CG-INSERT-FAILED' });
    const once = await openIntent(h);
    h.page.go(ACC, OTHER);
    expect(await h.call('insertGuarded', { intent: once })).toEqual({ state: 'rejected', code: 'CG-INSERT-CHAT-CHANGED' });
    expect(await h.call('insertGuarded', { intent: once })).toEqual({ state: 'rejected', code: 'CG-INSERT-FAILED' });
    expect(composer.calls).toEqual([]);
  });

  it('a route that has not stood one frame is not written to', async () => {
    const h = harness as Harness;
    const intent = await openIntent(h);
    h.page.go(ACC, FAN);
    const sameChatNewEpoch = { ...intent, intentId: uuid(41), expected: { ...intent.expected, routeEpoch: 2 } };
    expect(await h.call('insertGuarded', { intent: sameChatNewEpoch })).toEqual({ state: 'rejected', code: 'CG-INSERT-CHAT-CHANGED' });
    h.frame();
    expect(await settleWrite(h, h.call('insertGuarded', { intent: { ...sameChatNewEpoch, intentId: uuid(42) } }))).toMatchObject({ state: 'applied' });
  });

  it('[NEW-06] misplaced only on exact evidence: a transaction of another composer inside our call', async () => {
    const h = harness as Harness;
    const other = h.page.all.find((item) => item.fan === OTHER) as FakeComposer;
    // Bind the hidden composer to its chat (as after a visit), then make our bridge write into it.
    h.page.showOnly(ACC, OTHER);
    h.page.go(ACC, OTHER);
    h.frame();
    await draft(h).catch(() => undefined);
    h.runtime.handle('snapshot', {});
    h.page.showOnly(ACC, FAN);
    h.page.go(ACC, FAN);
    h.frame();
    const bridge = (composer.slot as unknown as { __omComposerBridge: { setText: (text: string) => void } }).__omComposerBridge;
    Object.defineProperty(composer.slot, '__omComposerBridge', {
      configurable: true,
      value: { ...bridge, setText: (text: string) => other.editor?.type(text) },
    });
    expect(await h.call('insertGuarded', { intent: await openIntent(h) })).toEqual({ state: 'uncertain', code: 'CG-INSERT-MISPLACED' });
  });

  it('[RB-009] verification: nothing written → rejected; something else written → uncertain (never retried)', async () => {
    const h = harness as Harness;
    const bridge = (composer.slot as unknown as { __omComposerBridge: Record<string, unknown> }).__omComposerBridge;
    Object.defineProperty(composer.slot, '__omComposerBridge', { configurable: true, value: { ...bridge, setText: () => undefined } });
    expect(await settleWrite(h, h.call('insertGuarded', { intent: await openIntent(h) }))).toEqual({ state: 'rejected', code: 'CG-INSERT-FAILED' });
    Object.defineProperty(composer.slot, '__omComposerBridge', { configurable: true, value: { ...bridge, setText: () => composer.editor?.type('garbled') } });
    expect(await settleWrite(h, h.call('insertGuarded', { intent: await openIntent(h) }))).toEqual({ state: 'uncertain', code: 'CG-INSERT-UNCERTAIN' });
  });

  it('[UI-027] a blocked fan: the composer is reported hidden and nothing is written (copy only)', async () => {
    const h = harness as Harness;
    const intent = await openIntent(h);
    h.page.cache.set(['fansMap', ACC], { [FAN]: { id: FAN, isBlocked: true } });
    h.frame();
    expect((h.runtime.handle('snapshot', {}) as { composer: { hidden: boolean } }).composer.hidden).toBe(true);
    expect(await h.call('insertGuarded', { intent })).toEqual({ state: 'rejected', code: 'CG-GATE-FAN-BLOCKED' });
    expect(h.events.filter((event) => event.t === 'chatCache').length).toBeGreaterThan(0);
  });

  it('two visible composers are ambiguous: no composer state, no write', async () => {
    const h = harness as Harness;
    const intent = await openIntent(h);
    for (const item of h.page.all) h.page.show(item, true);
    expect((h.runtime.handle('snapshot', {}) as { composer: unknown }).composer).toBeNull();
    expect(await h.call('insertGuarded', { intent })).toEqual({ state: 'rejected', code: 'CG-INSERT-CHAT-CHANGED' });
  });

  it('focus goes through ChatSpace’s bridge into the composer', async () => {
    const h = harness as Harness;
    expect(await h.call('focus', { expected: identity(h) })).toEqual({ focused: true });
    expect(await h.call('focus', { expected: identity(h, { composerInstanceId: 'c77' }) })).toBe('identity-mismatch');
  });
});

describe('MAIN runtime — degraded composers', () => {
  it('without the editor handle the bridge still writes, but a non-empty draft always needs consent', async () => {
    const h = await start((page) => {
      composer = page.addComposer(ACC, FAN, { editor: false });
      const prose = composer.prose;
      let text = '';
      Object.defineProperty(prose, 'innerText', { configurable: true, get: () => text });
      Object.defineProperty(composer.slot, '__omComposerBridge', {
        configurable: true,
        value: { setText: (value: string) => (text = value), insertText: (value: string) => (text += value), focus: () => undefined },
      });
      (composer as { calls: string[] }).calls.push('ready');
    });
    const snapshot = h.runtime.handle('snapshot', {}) as { contract: { shape: string[] } };
    expect(snapshot.contract.shape).toContain('composerBridge');
    expect(await settleWrite(h, h.call('insertGuarded', { intent: await openIntent(h) }))).toMatchObject({ state: 'applied' });
    expect(await h.call('insertGuarded', { intent: await openIntent(h, {}, 'next') })).toMatchObject({ state: 'rejected', needs: 'confirm-human-draft' });
  });

  it('[RB-008] without the bridge the composer is not ready and the anchor is missing', async () => {
    const h = await start((page) => {
      composer = page.addComposer(ACC, FAN, { bridge: false });
    });
    const snapshot = h.runtime.handle('snapshot', {}) as { composer: { ready: boolean }; contract: { missing: string[] } };
    expect(snapshot.composer.ready).toBe(false);
    expect(snapshot.contract.missing).toContain('composerBridge');
    expect(await h.call('insertGuarded', { intent: await openIntent(h) })).toEqual({ state: 'rejected', code: 'CG-HOST-COMPOSER-MISSING' });
  });
});

describe('MAIN runtime — navigation (§6.5, §6.9)', () => {
  beforeEach(async () => {
    await start((page) => {
      composer = page.addComposer(ACC, FAN);
      page.addComposer(ACC, OTHER, { shown: false });
      page.setPush((to) => {
        page.showOnly(to.params['accountId'] ?? '', to.params['chatId'] ?? '');
        page.go(to.params['accountId'] ?? '', to.params['chatId']);
        return Promise.resolve(undefined);
      });
    });
  });

  const deferred = (over: Record<string, unknown> = {}) => ({
    intentId: uuid(Math.floor(Math.random() * 1e9)),
    operationId: uuid(3),
    part: { index: 0 },
    target: { host: 'chatspace', hostAccountId: ACC, platformFanId: OTHER },
    expected: { kind: 'deferred', documentEpoch: 'doc1' },
    mode: 'replace',
    text: 'Open and insert',
    confirmationId: null,
    createdAt: Date.now() - 10,
    expiresAt: Date.now() + 20_000,
    ...over,
  });

  const frames = async (h: Harness, n: number): Promise<void> => {
    for (let i = 0; i < n; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      h.frame();
    }
  };

  it('[SP-035] [NF-011] opens a chat with router.push (a human cause, redeemed on the isolated side)', async () => {
    const h = harness as Harness;
    const receipt = NavigationReceiptSchema.parse(await h.call('navigate', { intent: { intentId: uuid(1), acc: ACC, fan: OTHER } }));
    expect(receipt).toEqual({ state: 'navigated', routeEpoch: 2, insert: null });
    expect(h.page.pushes).toEqual([{ name: 'chat', params: { accountId: ACC, chatId: OTHER } }]);
    expect(NavigationReceiptSchema.parse(await h.call('navigate', { intent: { intentId: uuid(1), acc: ACC, fan: OTHER } }))).toMatchObject({ state: 'failed', code: 'CG-NAV-FAILED' });
  });

  it('opens an account (Б13): only the account must match', async () => {
    const h = harness as Harness;
    expect(await h.call('navigate', { intent: { intentId: uuid(2), acc: ACC, fan: null } })).toMatchObject({ state: 'navigated' });
    expect(h.page.pushes.at(-1)).toEqual({ name: 'chat', params: { accountId: ACC } });
  });

  it('[NEW-01] open and insert: waits for a new route epoch and two stable observations, then writes once', async () => {
    const h = harness as Harness;
    const target = h.page.all.find((item) => item.fan === OTHER) as FakeComposer;
    const pending = h.call('navigate', { intent: { intentId: uuid(3), acc: ACC, fan: OTHER, thenInsert: deferred() } });
    await frames(h, 5);
    const receipt = NavigationReceiptSchema.parse(await pending);
    expect(receipt).toMatchObject({ state: 'navigated', routeEpoch: 2, insert: { state: 'applied' } });
    expect(target.editor?.text).toBe('Open and insert');
    expect(target.calls).toEqual(['setText']);
  });

  it('[NEW-01] a human draft in the target is not replaced: rejected with confirm-human-draft', async () => {
    const h = harness as Harness;
    const target = h.page.all.find((item) => item.fan === OTHER) as FakeComposer;
    target.editor?.type('typed before');
    const pending = h.call('navigate', { intent: { intentId: uuid(4), acc: ACC, fan: OTHER, thenInsert: deferred() } });
    await frames(h, 5);
    expect(await pending).toMatchObject({ state: 'navigated', insert: { state: 'rejected', code: 'CG-DRAFT-CHANGED', needs: 'confirm-human-draft' } });
    expect(target.editor?.text).toBe('typed before');
  });

  it('[NEW-01] deadline: the composer never gets ready → CG-NAV-TIMEOUT, nothing written', async () => {
    const h = harness as Harness;
    const target = h.page.all.find((item) => item.fan === OTHER) as FakeComposer;
    Object.defineProperty(target.prose, 'editor', { configurable: true, value: undefined });
    target.editor = null;
    const pending = h.call('navigate', { intent: { intentId: uuid(5), acc: ACC, fan: OTHER, thenInsert: deferred({ expiresAt: Date.now() + 60 }) } });
    await frames(h, 3);
    await new Promise((resolve) => setTimeout(resolve, 80));
    await frames(h, 2);
    expect(await pending).toEqual({ state: 'failed', code: 'CG-NAV-TIMEOUT', insert: { state: 'rejected', code: 'CG-NAV-TIMEOUT' } });
    expect(target.calls).toEqual([]);
  });

  it('[NEW-01] cancel: a human navigation or another insert intent while waiting → CG-INSERT-CANCELED, nothing written', async () => {
    const h = harness as Harness;
    const target = h.page.all.find((item) => item.fan === OTHER) as FakeComposer;
    const first = h.call('navigate', { intent: { intentId: uuid(6), acc: ACC, fan: OTHER, thenInsert: deferred() } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    h.page.showOnly(ACC, FAN);
    h.page.go(ACC, FAN);
    await frames(h, 4);
    expect(await first).toEqual({ state: 'navigated', routeEpoch: 3, insert: { state: 'rejected', code: 'CG-INSERT-CANCELED' } });
    const second = h.call('navigate', { intent: { intentId: uuid(7), acc: ACC, fan: OTHER, thenInsert: deferred() } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await h.call('insertGuarded', { intent: { ...deferred(), expected: { kind: 'open', documentEpoch: 'doc1', routeEpoch: 4, composerInstanceId: 'c1', draftRevision: 0, draftDigest: '00000000' } } });
    await frames(h, 4);
    expect(await second).toMatchObject({ insert: { state: 'rejected', code: 'CG-INSERT-CANCELED' } });
    expect(target.calls).toEqual([]);
  });

  it('a navigation the router refuses or that lands elsewhere is CG-NAV-FAILED', async () => {
    const h = harness as Harness;
    h.page.setPush(() => Promise.reject(new Error('guard')));
    expect(await h.call('navigate', { intent: { intentId: uuid(8), acc: ACC, fan: OTHER } })).toEqual({ state: 'failed', code: 'CG-NAV-FAILED', insert: null });
  });
});

describe('MAIN runtime — requests', () => {
  it('unknown and malformed requests are refused before anything runs; not ready without #app', async () => {
    const h = await start();
    expect(h.runtime.handle('nope', {})).toBe('unknown-request');
    expect(h.runtime.handle('fan', { acc: ACC })).toBe('bad-request');
    expect(h.runtime.handle('flags', { wsTap: true, previewSend: true })).toEqual({ wsTap: false, previewSend: false });
    h.dispose();
    document.body.replaceChildren();
    const events: string[] = [];
    const bare = createMainRuntime({ win: window, documentEpoch: 'doc2', now: () => 0, setTimer: (cb, ms) => setTimeout(cb, ms), frame: (cb) => cb(), emit: (t) => events.push(t) });
    expect(bare.handle('fan', { acc: ACC, fan: FAN })).toBe('not-ready');
    expect(bare.handle('listAccounts', {})).toEqual([]);
    // While #app is not there (still searching or given up), only `app` is reported, as missing.
    expect((bare.handle('snapshot', {}) as { contract: unknown }).contract).toEqual({ build: null, missing: ['app'], shape: [], receiptModules: {} });
    bare.dispose();
  });
});
