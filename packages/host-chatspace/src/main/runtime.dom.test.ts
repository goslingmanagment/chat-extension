// The MAIN runtime against a ChatSpace-shaped page (src/testing/fake-page.ts),
// driven through its request handler with a hand-made boot context: frames are
// flushed by the test, events are recorded. Answers are checked with the
// contracts' own schemas (what the isolated side will check).

import { ChatWindowSchema, HostFanSchema, InsertReceiptSchema, NavigationItemSchema, NavigationReceiptSchema, TailSnapshotSchema } from '@cg/contracts/host';
import { DraftWireSchema, MainSnapshotSchema } from '@cg/contracts/bridge-messages';
import { BRIDGE_LIMITS } from '@cg/contracts/limits';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakePage, fakeStore, seedCache, type FakeComposer, type FakeEditor, type FakePage } from '../testing/fake-page';
import { type MainContext, type MainRuntime } from './bridge';
import { faultCounter, guardWith } from './guard';
import { createMainRuntime } from './runtime';

/** The boot's guard and fault counter as MainContext takes them. */
const guards = (fail: (site: string) => void) => ({ guard: guardWith(fail), fault: fail });

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
  const fail = faultCounter((source, count) => events.push({ t: 'fault', payload: { source, count } }));
  const guard = guardWith(fail);
  const context: MainContext = {
    win: window,
    documentEpoch: 'doc1',
    now: () => performance.now(),
    setTimer: (callback, ms) => setTimeout(callback, ms),
    frame: (callback) => frames.push(callback),
    guard,
    fault: fail,
    emit: (t, build) => events.push({ t, payload: build() }),
    post: (t, payload) => events.push({ t, payload }),
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

const chatOf = (fan: string) => ({ host: 'chatspace', hostAccountId: ACC, platformFanId: fan });
const draft = async (h: Harness, fan = FAN) => DraftWireSchema.parse(await h.call('readDraft', { expected: identity(h, { chat: chatOf(fan) }) }));

async function openIntent(h: Harness, over: Record<string, unknown> = {}, text = 'Hello there', fan = FAN) {
  const id = identity(h, { chat: chatOf(fan) });
  const current = await draft(h, fan);
  return {
    intentId: uuid(Math.floor(Math.random() * 1e9)),
    operationId: uuid(7),
    part: { index: 0 },
    target: chatOf(fan),
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
    // No tap script here: `wsFrames` is missing with it.
    expect(snapshot.contract).toMatchObject({ missing: ['pendingMessages', 'composerTranslator', 'wsFrames'], shape: [] });
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

  it('[AU-034] [AU-035] one odd account (no or a numeric platformAccountId, another platform) leaves only itself unbound', () => {
    const h = harness as Harness;
    h.page.cache.set(['accounts'], [
      { id: 1001, platformAccountId: 3003, platform: 'onlyfans', username: 'one' },
      { id: 1002, platformAccountId: null, platform: 'onlyfans', username: 'two' },
      { id: 1003, platform: 'fansly', username: 'three' },
    ]);
    const snapshot = h.runtime.handle('snapshot', {}) as { contract: { shape: string[]; missing: string[] }; accounts: Array<{ hostAccountId: string; platformAccountId: string | null }> };
    expect(snapshot.contract.shape).not.toContain('accounts');
    expect(snapshot.contract.missing).not.toContain('accounts');
    expect(snapshot.accounts.map((account) => [account.hostAccountId, account.platformAccountId])).toEqual([
      ['1001', '3003'],
      ['1002', null],
    ]);
  });

  it('online as ChatSpace decides it: its presence map, else the fan’s lastSeen', async () => {
    const h = harness as Harness;
    const asked: unknown[][] = [];
    h.page.addStore(fakeStore('chats', { isFanOnline: (...args: unknown[]) => (asked.push(args), args[1] !== null) }));
    expect(HostFanSchema.parse(await h.call('fan', { acc: ACC, fan: FAN })).isOnline).toBe(true);
    expect(HostFanSchema.parse(await h.call('fan', { acc: ACC, fan: OTHER })).isOnline).toBe(false);
    expect(asked.slice(0, 2)).toEqual([
      [FAN, '2026-10-03T09:59:00.000Z'],
      [OTHER, null],
    ]);
  });

  it('a fresh tail or a chat list never outgrows one frame: MAIN stops before the byte budget', async () => {
    const h = harness as Harness;
    const long = 'я'.repeat(5000);
    const items = Array.from({ length: 60 }, (_, i) => ({ id: String(5000 + i), text: long, createdAt: new Date(Date.UTC(2026, 9, 3, 10, 0, i)).toISOString(), isOutgoing: false, platformMetadata: {} }));
    h.page.cache.set(['chatMessages', ACC, FAN], { pages: [{ items, hasMore: false }], pageParams: [null] });
    const tail = TailSnapshotSchema.parse(await h.call('readTail', { expected: identity(h), max: 60 }));
    expect(tail.messages.length).toBeGreaterThan(0);
    expect(tail.messages.length).toBeLessThan(60);
    expect(tail.messages.at(-1)?.platformMessageId).toBe('5059');
    expect(new TextEncoder().encode(JSON.stringify(tail)).length).toBeLessThan(BRIDGE_LIMITS.maxFrameBytes - 1024);
    const fans = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [String(3000 + i), { id: String(3000 + i), name: 'ж'.repeat(256), username: 'u'.repeat(128) }]));
    h.page.cache.set(['fansMap', ACC], fans);
    h.page.cache.set(['chatList', ACC, 'all'], { pages: [{ items: Object.keys(fans).map((id) => ({ id, unreadMessagesCount: 1 })) }] });
    const rows = (await h.call('listChats', { acc: ACC, limit: 1000 })) as unknown[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(1000);
    expect(new TextEncoder().encode(JSON.stringify(rows)).length).toBeLessThan(BRIDGE_LIMITS.maxFrameBytes - 1024);
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

  it('fresh tail (D-14): plain text, oldest first, never queued or non-numeric messages', async () => {
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
    // No OnlyFans account can be bound any more (the field changed its meaning in a new build): the anchor is broken.
    h.page.cache.set(['accounts'], [{ id: 1001, platformAccountId: 'acct_3003' }]);
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

  it('[RB-008] history that lands after the route settled is judged again: its anchor turns ok without a navigation', () => {
    const h = harness as Harness;
    const lastContract = () => h.events.filter((event) => event.t === 'contract').at(-1)?.payload as { missing: string[] };
    h.page.go(ACC, OTHER);
    h.frame();
    expect(lastContract().missing).toContain('chatMessages');
    const before = h.events.length;
    h.page.cache.set(['chatMessages', ACC, OTHER], { pages: [{ items: [], hasMore: false }], pageParams: [null] });
    expect(h.events.slice(before).map((event) => event.t)).toEqual(expect.arrayContaining(['contract', 'chatCache']));
    expect(lastContract().missing).not.toContain('chatMessages');
    // Another chat's history is no anchor of the open one.
    const quiet = h.events.length;
    h.page.cache.set(['chatMessages', ACC, '2999'], { pages: [] });
    expect(h.events.slice(quiet).filter((event) => event.t === 'contract')).toEqual([]);
  });

  it('[RB-008] [AU-034] accounts that arrive after the app was found are judged again, and announced', async () => {
    const h = await start((page) => {
      page.cache.delete(['accounts']);
      composer = page.addComposer(ACC, FAN);
    });
    const lastContract = () => h.events.filter((event) => event.t === 'contract').at(-1)?.payload as { missing: string[] };
    expect(lastContract().missing).toContain('accounts');
    const before = h.events.length;
    h.page.cache.set(['accounts'], [{ id: 1001, platformAccountId: '3003', platform: 'onlyfans', username: 'one', name: 'One' }]);
    expect(lastContract().missing).not.toContain('accounts');
    expect(h.events.slice(before).map((event) => event.t)).toEqual(expect.arrayContaining(['contract', 'accounts', 'route']));
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

describe('MAIN runtime — the composer translator store: not yet before the first composer, missing after one (§6.2)', () => {
  type Wire = { missing: string[]; shape: string[]; notYet: string[] };
  const contracts = (h: Harness): Wire[] => h.events.filter((event) => event.t === 'contract').map((event) => event.payload as unknown as Wire);
  const snapshotWire = (h: Harness): Wire => (h.runtime.handle('snapshot', {}) as { contract: Wire }).contract;

  it('[DB-031] [ST-025] a page loaded with no chat open: ChatSpace has not created the store yet — `notYet`, not missing; it comes with the first chat and stays after it closes', async () => {
    // ChatSpace's own order: a chat's composer creates the store in its setup, then renders.
    const h = await start((page) => page.go(ACC));
    expect(snapshotWire(h)).toMatchObject({ notYet: ['composerTranslator'] });
    expect(snapshotWire(h).missing).not.toContain('composerTranslator');
    expect(contracts(h).at(-1)?.notYet).toEqual(['composerTranslator']);

    h.page.addStore(fakeStore('composerTranslator', { getAccountSettings: () => ({ value: { enabled: false, autoTranslate: true } }) }));
    const first = h.page.addComposer(ACC, FAN);
    h.page.go(ACC, FAN);
    h.frame();
    expect(contracts(h).at(-1)).toMatchObject({ notYet: [] });
    expect(contracts(h).at(-1)?.missing).not.toContain('composerTranslator');

    // The person closes the chat: ChatSpace keeps the store until the page reloads.
    first.tab.remove();
    h.page.go(ACC);
    h.frame();
    expect(snapshotWire(h)).toMatchObject({ notYet: [] });
    expect(snapshotWire(h).missing).not.toContain('composerTranslator');
  });

  it('[DB-031] [RB-008] a composer mounted and the store is still not there: missing, as before — and it stays missing after the chat closes', async () => {
    const h = await start((page) => page.go(ACC));
    expect(snapshotWire(h).notYet).toEqual(['composerTranslator']);
    const composer = h.page.addComposer(ACC, FAN);
    const before = h.events.length;
    h.page.go(ACC, FAN);
    h.frame();
    // The search that found the first composer judges the contract again, without waiting for another change.
    const after = h.events.slice(before).filter((event) => event.t === 'contract').map((event) => event.payload as unknown as Wire);
    expect(after.at(-1)?.missing).toContain('composerTranslator');
    expect(after.at(-1)?.notYet).toEqual([]);

    composer.tab.remove();
    h.page.go(ACC);
    h.frame();
    expect(snapshotWire(h).missing).toContain('composerTranslator');
    expect(snapshotWire(h).notYet).toEqual([]);
  });

  it('[DB-031] a page loaded straight on a chat whose composer is there without the store: missing at once', async () => {
    const h = await start((page) => {
      page.addComposer(ACC, FAN);
    });
    expect(snapshotWire(h).missing).toContain('composerTranslator');
    expect(snapshotWire(h).notYet).toEqual([]);
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

  it('[RB-009] [NEW-06] the person sends the draft before the write is verified: the receipt is the write’s own — applied, never «nothing written»', async () => {
    const h = harness as Harness;
    const intent = await openIntent(h);
    const pending = h.call('insertGuarded', { intent });
    expect(composer.calls).toEqual(['setText']);
    // ChatSpace's Send in the same frame as the write: the queue took the draft, and the field is empty before
    // MAIN's verification runs. The text was written — the editor's own transactions inside the call say so.
    (composer.editor as FakeEditor).type('');
    const receipt = InsertReceiptSchema.parse(await settleWrite(h, pending));
    expect(receipt).toMatchObject({ state: 'applied', draftRevision: 2 });
    // What the person did after the write stays theirs: the draft is empty now, no longer our insert.
    expect(await draft(h)).toMatchObject({ provenance: 'empty', revision: 3 });
  });

  it('[RB-009] the person types over the write before it is verified: applied as written; the draft is theirs from then on', async () => {
    const h = harness as Harness;
    const pending = h.call('insertGuarded', { intent: await openIntent(h) });
    (composer.editor as FakeEditor).type('Hello there, and my own words');
    expect(InsertReceiptSchema.parse(await settleWrite(h, pending))).toMatchObject({ state: 'applied', draftRevision: 2 });
    expect(await draft(h)).toMatchObject({ provenance: 'human-or-unknown', revision: 3 });
  });

  it('[UI-019] a text with Windows line ends is written with plain ones: ChatSpace’s bridge turns only \\n into a line break', async () => {
    const h = harness as Harness;
    const intent = await openIntent(h, {}, 'first line\r\nsecond line\rthird');
    expect(await settleWrite(h, h.call('insertGuarded', { intent }))).toMatchObject({ state: 'applied' });
    expect(composer.editor?.text).toBe('first line\nsecond line\nthird');
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

  it('[UI-020] [NEW-05] an append keeps the human’s text in the draft: a later plain insert asks again, never wipes it', async () => {
    const h = harness as Harness;
    composer.editor?.type('my words');
    const append = await openIntent(h, { mode: 'append', confirmationId: uuid(91) }, 'and more');
    expect(await settleWrite(h, h.call('insertGuarded', { intent: append }))).toMatchObject({ state: 'applied' });
    expect((await draft(h)).provenance).toBe('human-or-unknown');
    expect(await h.call('insertGuarded', { intent: await openIntent(h, {}, 'second part') })).toEqual({ state: 'rejected', code: 'CG-DRAFT-CHANGED', needs: 'confirm-human-draft' });
    expect(composer.editor?.text).toBe('my words\nand more');
  });

  it('[UI-023] an append to our own unchanged insert keeps the whole draft ours (the next part replaces it without asking)', async () => {
    const h = harness as Harness;
    await settleWrite(h, h.call('insertGuarded', { intent: await openIntent(h, {}, 'part one') }));
    expect(await settleWrite(h, h.call('insertGuarded', { intent: await openIntent(h, { mode: 'append' }, 'part two') }))).toMatchObject({ state: 'applied' });
    expect(composer.editor?.text).toBe('part one\npart two');
    expect((await draft(h)).provenance).toBe('our-insert');
    expect(await settleWrite(h, h.call('insertGuarded', { intent: await openIntent(h, {}, 'variant b') }))).toMatchObject({ state: 'applied' });
    expect(composer.editor?.text).toBe('variant b');
  });

  it('[RB-009] an append that changed nothing is not applied, even when the draft already ended with the text', async () => {
    const h = harness as Harness;
    composer.editor?.type('hello again');
    const bridge = (composer.slot as unknown as { __omComposerBridge: Record<string, unknown> }).__omComposerBridge;
    Object.defineProperty(composer.slot, '__omComposerBridge', { configurable: true, value: { ...bridge, insertText: () => undefined } });
    const append = await openIntent(h, { mode: 'append', confirmationId: uuid(92) }, 'again');
    expect(await settleWrite(h, h.call('insertGuarded', { intent: append }))).toEqual({ state: 'rejected', code: 'CG-INSERT-FAILED' });
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

  it('[RB-014] [RB-015] a tab switch the route has not followed yet: the new tab’s composer is never taken for the old chat', async () => {
    const h = harness as Harness;
    const other = h.page.all.find((item) => item.fan === OTHER) as FakeComposer;
    // A tab restored from storage and activated for the first time: its composer appears with the click.
    const restored = h.page.addComposer(ACC, '2004', { shown: false });
    const before = identity(h);
    const intent = await openIntent(h);
    for (const [fan, target] of [
      [OTHER, other],
      ['2004', restored],
    ] as const) {
      // ChatSpace activates the tab and shows its composer; the route waits on async router guards (still FAN).
      h.page.showOnly(ACC, fan);
      h.frame();
      expect((h.events.filter((event) => event.t === 'composer').at(-1)?.payload as { state: unknown }).state).toBeNull();
      expect((h.runtime.handle('snapshot', {}) as { composer: unknown }).composer).toBeNull();
      expect(await h.call('readDraft', { expected: before })).toBe('identity-mismatch');
      expect(await h.call('focus', { expected: before })).toBe('identity-mismatch');
      expect(await h.call('insertGuarded', { intent: { ...intent, intentId: uuid(60 + Number(fan.slice(-1))) } })).toEqual({ state: 'rejected', code: 'CG-INSERT-CHAT-CHANGED' });
      expect(target.calls).toEqual([]);
      expect(target.editor?.text).toBe('');
      h.page.showOnly(ACC, FAN);
      h.frame();
    }
    // The route follows: the composer serves its own chat, with an id of its own.
    h.page.showOnly(ACC, OTHER);
    h.page.go(ACC, OTHER);
    h.frame();
    const snapshot = h.runtime.handle('snapshot', {}) as { composer: { chat: { platformFanId: string }; instanceId: string; ready: boolean } };
    expect(snapshot.composer).toMatchObject({ chat: { platformFanId: OTHER }, ready: true });
    expect(snapshot.composer.instanceId).not.toBe(before.composerInstanceId);
    const receipt = await settleWrite(h, h.call('insertGuarded', { intent: await openIntent(h, {}, 'for other', OTHER) }));
    expect(receipt).toMatchObject({ state: 'applied' });
    expect(other.editor?.text).toBe('for other');
    expect(composer.editor?.text).toBe('');
  });

  it('[RB-008] [UI-027] ChatSpace’s chat tabs unreadable (a new build): copy only — the dock may sit there, nothing reads or writes', async () => {
    const h = await start((page) => {
      composer = page.addComposer(ACC, FAN);
      page.stores.delete('chatTabEntries');
    });
    const snapshot = h.runtime.handle('snapshot', {}) as { composer: { instanceId: string; ready: boolean; hidden: boolean }; contract: { missing: string[] } };
    expect(snapshot.composer).toMatchObject({ ready: false, hidden: false });
    expect(snapshot.contract.missing).toContain('composerBridge');
    const expected = identity(h);
    expect(await h.call('readDraft', { expected })).toBe('identity-mismatch');
    const intent = { intentId: uuid(80), operationId: uuid(7), part: { index: 0 }, target: chatOf(FAN), expected: { kind: 'open', documentEpoch: 'doc1', routeEpoch: expected.routeEpoch, composerInstanceId: snapshot.composer.instanceId, draftRevision: 0, draftDigest: '0000000000000000' }, mode: 'replace', text: 'x', confirmationId: null, createdAt: Date.now() - 1, expiresAt: Date.now() + 5000 };
    expect(await h.call('insertGuarded', { intent })).toEqual({ state: 'rejected', code: 'CG-INSERT-CHAT-CHANGED' });
    expect(composer.calls).toEqual([]);
  });

  it('typing re-reads the draft of the composer last found without searching the page again; a tab action searches again', () => {
    const h = harness as Harness;
    h.frame();
    h.runtime.handle('snapshot', {});
    const searches = vi.spyOn(document, 'querySelectorAll');
    const slotSearches = (): number => searches.mock.calls.filter(([selector]) => selector === '[data-id="browser-composer-translator"]').length;
    composer.editor?.type('a');
    composer.editor?.type('ab');
    h.frame();
    const last = h.events.filter((event) => event.t === 'composer').at(-1)?.payload as { state: { draft: { revision: number; provenance: string } } };
    expect(last.state.draft).toEqual({ revision: 2, provenance: 'human-or-unknown' });
    expect(slotSearches()).toBe(0);
    h.page.showOnly(ACC, FAN);
    h.frame();
    expect(slotSearches()).toBeGreaterThan(0);
    searches.mockRestore();
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

describe('MAIN runtime — every guard of the one synchronous step', () => {
  beforeEach(async () => {
    await start((page) => {
      composer = page.addComposer(ACC, FAN);
      page.addComposer(ACC, OTHER, { shown: false });
    });
  });

  it('[AI-022] the digest half of the CAS: the same revision with another document is refused (confirm-changed-draft)', async () => {
    const h = harness as Harness;
    composer.editor?.type('typed');
    const intent = await openIntent(h, { confirmationId: uuid(100) });
    const forged = { ...intent, expected: { ...intent.expected, draftDigest: 'ffffffffffffffff' } };
    expect(await h.call('insertGuarded', { intent: forged })).toEqual({ state: 'rejected', code: 'CG-DRAFT-CHANGED', needs: 'confirm-changed-draft' });
    expect(composer.calls).toEqual([]);
  });

  it('[RB-015] A→B→A: an intent made before the switch is refused at MAIN by its route epoch, though chat and composer match again', async () => {
    const h = harness as Harness;
    const intent = await openIntent(h);
    h.page.showOnly(ACC, OTHER);
    h.page.go(ACC, OTHER);
    h.frame();
    h.page.showOnly(ACC, FAN);
    h.page.go(ACC, FAN);
    h.frame();
    // Same chat, same composer node, same draft — only the epoch tells that the person left and came back.
    expect(identity(h).composerInstanceId).toBe(intent.expected.composerInstanceId);
    expect(await h.call('insertGuarded', { intent })).toEqual({ state: 'rejected', code: 'CG-INSERT-CHAT-CHANGED' });
    expect(composer.calls).toEqual([]);
  });

  it('[RB-015] a sign-out (the queue reset) makes every identity from before fail: readDraft, readTail, focus', async () => {
    const h = harness as Harness;
    const queue = fakeStore('pendingMessages', { enqueue: () => null, resetAll: () => undefined, messagesByAccountId: {} }, ['resetAll']);
    h.page.addStore(queue);
    const before = identity(h);
    expect(await h.call('readDraft', { expected: before })).toMatchObject({ composerInstanceId: before.composerInstanceId });
    (queue['resetAll'] as () => void)();
    expect(await h.call('readDraft', { expected: before })).toBe('identity-mismatch');
    expect(await h.call('readTail', { expected: before, max: 5 })).toBe('identity-mismatch');
    expect(await h.call('focus', { expected: before })).toBe('identity-mismatch');
    expect(await h.call('readDraft', { expected: identity(h) })).toMatchObject({ composerInstanceId: before.composerInstanceId });
  });

  it('[AU-030] an identity of another page (platformAccountId) or another document is refused', async () => {
    const h = harness as Harness;
    for (const over of [{ platformAccountId: '9999' }, { documentEpoch: 'doc0' }, { hostAccountId: '1009' }, { chat: chatOf(OTHER) }, { chat: null }]) {
      const expected = identity(h, over);
      expect([over, await h.call('readDraft', { expected })]).toEqual([over, 'identity-mismatch']);
      expect([over, await h.call('readTail', { expected, max: 5 })]).toEqual([over, 'identity-mismatch']);
      expect([over, await h.call('focus', { expected })]).toEqual([over, 'identity-mismatch']);
    }
    expect(composer.calls).toEqual([]);
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

  it('[RB-008] without the frame the editor is found next to the slot; typing (input events) moves the revision when the editor is not observed', async () => {
    const h = await start((page) => {
      composer = page.addComposer(ACC, FAN, { frame: false, editor: false });
      let text = '';
      Object.defineProperty(composer.prose, 'innerText', { configurable: true, get: () => text });
      Object.defineProperty(composer.slot, '__omComposerBridge', {
        configurable: true,
        value: { setText: (value: string) => (text = value), insertText: (value: string) => (text += value), focus: () => undefined },
      });
    });
    const before = await draft(h);
    expect(before.provenance).toBe('empty');
    composer.prose.textContent = 'x';
    Object.defineProperty(composer.prose, 'innerText', { configurable: true, get: () => 'typed' });
    composer.frame.className = 'composer-frame';
    composer.prose.dispatchEvent(new Event('input', { bubbles: true }));
    composer.frame.className = 'composer-shell';
    const after = await draft(h);
    expect(after.revision).toBeGreaterThan(before.revision);
    expect(after.provenance).toBe('human-or-unknown');
  });

  /** Every composer state MAIN has put on its event stream (the harness keeps equal ones too; the bridge sends only a changed one). */
  const composerEvents = (h: Harness) => h.events.filter((event) => event.t === 'composer').map((event) => event.payload['state'] as { instanceId: string; ready: boolean } | null);
  /** The composer events told since `from`, and the anchors the last contract event names as misshaped. */
  const told = (h: Harness, from: number) => ({
    ready: h.events.slice(from).filter((event) => event.t === 'composer').map((event) => (event.payload['state'] as { ready: boolean } | null)?.ready ?? null),
    shape: (h.events.slice(from).filter((event) => event.t === 'contract').at(-1)?.payload['shape'] as string[] | undefined) ?? null,
  });
  /** TipTap's chunk loads after the composer: its element is put into the page now, with nothing else happening there. */
  const editorArrives = async (h: Harness, late: FakeComposer): Promise<void> => {
    late.frame.append(late.prose);
    // The observer's callback, then the frame it asks for.
    await new Promise((resolve) => setTimeout(resolve, 0));
    h.frame();
  };

  it('[RB-008] the editor arrives after the composer: the composer turns ready with no other event of the page', async () => {
    const h = await start((page) => {
      composer = page.addComposer(ACC, FAN);
      composer.prose.remove();
    });
    const from = h.events.length;
    expect(h.events.filter((event) => event.t === 'composer').at(-1)?.payload['state']).toMatchObject({ ready: false });
    await editorArrives(h, composer);
    expect(told(h, from).ready).toEqual([true]);
  });

  it('[RB-008] without the frame a late editor is noticed too: the watch sits on the slot’s own ancestors, and the composer turns ready', async () => {
    const h = await start((page) => {
      composer = page.addComposer(ACC, FAN, { frame: false });
      composer.prose.remove();
    });
    const from = h.events.length;
    expect(h.events.filter((event) => event.t === 'composer').at(-1)?.payload['state']).toMatchObject({ ready: false });
    await editorArrives(h, composer);
    expect(told(h, from).ready).toEqual([true]);
  });

  it('[RB-008] ChatSpace renders the composer again while its editor still loads: asked, MAIN tells of the new composer by its event, the watch moves to the new nodes, and the new composer turns ready', async () => {
    const h = await start((page) => {
      composer = page.addComposer(ACC, FAN);
      composer.prose.remove();
    });
    const first = h.runtime.handle('snapshot', {}) as { composer: { instanceId: string; ready: boolean } };
    expect(first.composer.ready).toBe(false);
    h.frame();
    // New nodes of the same chat's composer, its editor not there yet; nothing of the stores moves.
    const again = h.page.renderAgain(composer);
    again.prose.remove();
    h.frame();
    expect(composerEvents(h).at(-1)).toMatchObject({ instanceId: first.composer.instanceId });
    // The dock stands over the new nodes and the isolated side asks MAIN to look again (host-port `onRenewed`).
    const renewed = h.runtime.handle('snapshot', {}) as { composer: { instanceId: string; ready: boolean } };
    expect(renewed.composer.ready).toBe(false);
    expect(renewed.composer.instanceId).not.toBe(first.composer.instanceId);
    // What the question found goes out as the composer event a frame later: the isolated side takes no answer.
    h.frame();
    expect(composerEvents(h).at(-1)).toMatchObject({ instanceId: renewed.composer.instanceId, ready: false });
    const from = h.events.length;
    await editorArrives(h, again);
    expect(told(h, from).ready).toEqual([true]);
  });

  it('[RB-008] asked after a re-render, MAIN tells of the new composer by its event even when nothing else would: an editor without a handle is never attached, so no draft event follows', async () => {
    /** A field whose editor object cannot be taken (a new build): the bridge writes, nothing of its document is observed. */
    const handleless = (target: FakeComposer): void => {
      let text = '';
      Object.defineProperty(target.prose, 'innerText', { configurable: true, get: () => text });
      Object.defineProperty(target.slot, '__omComposerBridge', { configurable: true, value: { setText: (value: string) => (text = value), insertText: (value: string) => (text += value), focus: () => undefined } });
    };
    const h = await start((page) => {
      composer = page.addComposer(ACC, FAN, { editor: false });
      handleless(composer);
    });
    const first = h.runtime.handle('snapshot', {}) as { composer: { instanceId: string; ready: boolean } };
    expect(first.composer.ready).toBe(true);
    h.frame();
    const again = h.page.renderAgain(composer, { editor: false });
    handleless(again);
    // Nothing tells MAIN: no store moved, and there is no editor object whose arrival it would watch.
    await new Promise((resolve) => setTimeout(resolve, 0));
    h.frame();
    expect(composerEvents(h).at(-1)).toMatchObject({ instanceId: first.composer.instanceId });
    const renewed = h.runtime.handle('snapshot', {}) as { composer: { instanceId: string } };
    h.frame();
    expect(composerEvents(h).at(-1)).toMatchObject({ instanceId: renewed.composer.instanceId, ready: true });
    expect(renewed.composer.instanceId).not.toBe(first.composer.instanceId);
    // The first «Вставить» after that: the draft read with the new identity, the guarded write into the new field.
    expect(await settleWrite(h, h.call('insertGuarded', { intent: await openIntent(h) }))).toMatchObject({ state: 'applied' });
  });

  /** The nodes MAIN puts an observer on while `run` runs (its only observer is the one that waits for an editor). */
  const watchedIn = async (run: (watched: Node[]) => Promise<void>): Promise<void> => {
    const watched: Node[] = [];
    const Native = window.MutationObserver;
    class Recording extends Native {
      override observe(target: Node, options?: MutationObserverInit): void {
        watched.push(target);
        super.observe(target, options);
      }
    }
    window.MutationObserver = Recording;
    try {
      await run(watched);
    } finally {
      window.MutationObserver = Native;
    }
  };

  it('[RB-008] [RB-022] without the frame the watch stays on the composer’s own nodes: never an ancestor that holds another composer (§6.10)', async () => {
    await watchedIn(async (watched) => {
      let hidden: FakeComposer | null = null;
      const h = await start((page) => {
        hidden = page.addComposer(ACC, OTHER, { frame: false, shown: false });
        composer = page.addComposer(ACC, FAN, { frame: false });
        // A build whose slot sits right in the composer's shell: its fourth ancestor is the container of all composers.
        composer.frame.prepend(composer.slot);
        composer.prose.remove();
      });
      const other = hidden as unknown as FakeComposer;
      expect(watched).toEqual([composer.tab]);
      expect(composer.tab.contains(other.slot)).toBe(false);
      const from = h.events.length;
      // Another chat's composer gets an editor: not a change of the open chat's composer, nothing is read for it.
      other.prose.remove();
      other.frame.append(other.prose);
      await new Promise((resolve) => setTimeout(resolve, 0));
      h.frame();
      expect(told(h, from).ready).toEqual([]);
      await editorArrives(h, composer);
      expect(told(h, from).ready).toEqual([true]);
    });
  });

  it('[RB-008] [RB-022] without the frame the watch never sits on the body, however shallow the page (§6.10)', async () => {
    await watchedIn(async (watched) => {
      const h = await start((page) => {
        composer = page.addComposer(ACC, FAN, { frame: false });
        // The one composer of a page two levels deep: slot → shell → body.
        composer.frame.prepend(composer.slot);
        document.body.append(composer.frame);
        composer.prose.remove();
      });
      expect(watched).toEqual([composer.frame]);
      const from = h.events.length;
      await editorArrives(h, composer);
      expect(told(h, from).ready).toEqual([true]);
    });
  });

  it('[RB-008] an editor without a handle that arrives late is still told: the composer is ready and the anchor says «shape» (no CAS promise)', async () => {
    const h = await start((page) => {
      composer = page.addComposer(ACC, FAN, { editor: false });
      composer.prose.remove();
    });
    const from = h.events.length;
    expect(h.events.filter((event) => event.t === 'contract').at(-1)?.payload['shape']).toEqual([]);
    await editorArrives(h, composer);
    expect(told(h, from)).toEqual({ ready: [true], shape: ['composerBridge'] });
    // One reading for the arrival: later changes inside the frame do not read the composer again.
    const after = h.events.length;
    composer.frame.append(document.createElement('span'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    h.frame();
    expect(told(h, after).ready).toEqual([]);
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

  it('[NEW-01] the deferred insert waits for two stable observations of the ready composer, not one', async () => {
    const h = harness as Harness;
    const target = h.page.all.find((item) => item.fan === OTHER) as FakeComposer;
    const pending = h.call('navigate', { intent: { intentId: uuid(11), acc: ACC, fan: OTHER, thenInsert: deferred() } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The route settles and the composer is seen ready once: nothing yet.
    h.frame();
    expect(target.calls).toEqual([]);
    // The same composer seen ready again: now it is written.
    h.frame();
    await new Promise((resolve) => setTimeout(resolve, 0));
    h.frame();
    expect(NavigationReceiptSchema.parse(await pending)).toMatchObject({ state: 'navigated', insert: { state: 'applied' } });
    expect(target.calls).toEqual(['setText']);
  });

  it('[NEW-01] [RB-009] the person presses Send before the deferred insert is verified: the receipt says applied, so the send of that draft can be attributed', async () => {
    const h = harness as Harness;
    const target = h.page.all.find((item) => item.fan === OTHER) as FakeComposer;
    const pending = h.call('navigate', { intent: { intentId: uuid(12), acc: ACC, fan: OTHER, thenInsert: deferred() } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    h.frame();
    h.frame();
    expect(target.calls).toEqual(['setText']);
    // ChatSpace's Send between the write and the frame of its verification: the field is emptied.
    (target.editor as FakeEditor).type('');
    await new Promise((resolve) => setTimeout(resolve, 0));
    h.frame();
    expect(NavigationReceiptSchema.parse(await pending)).toMatchObject({ state: 'navigated', insert: { state: 'applied' } });
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

  it('[NEW-01] canceled by the isolated side (sign-out, persona or binding change): nothing written, the navigation stays', async () => {
    const h = harness as Harness;
    const target = h.page.all.find((item) => item.fan === OTHER) as FakeComposer;
    const then = deferred();
    const pending = h.call('navigate', { intent: { intentId: uuid(21), acc: ACC, fan: OTHER, thenInsert: then } });
    // Sent right behind its navigation: it lands while router.push is still in flight.
    expect(await h.call('cancelInsert', { intentId: then.intentId })).toEqual({ canceled: true });
    await frames(h, 4);
    expect(NavigationReceiptSchema.parse(await pending)).toEqual({ state: 'navigated', routeEpoch: 2, insert: { state: 'rejected', code: 'CG-INSERT-CANCELED' } });
    expect(target.calls).toEqual([]);
    expect(h.page.pushes).toHaveLength(1);
  });

  it('[NEW-01] a cancel while MAIN waits for the composer drops the insert; a cancel after it was written changes nothing', async () => {
    const h = harness as Harness;
    const target = h.page.all.find((item) => item.fan === OTHER) as FakeComposer;
    Object.defineProperty(target.prose, 'editor', { configurable: true, value: undefined });
    const editor = target.editor;
    target.editor = null;
    const waiting = deferred();
    const first = h.call('navigate', { intent: { intentId: uuid(22), acc: ACC, fan: OTHER, thenInsert: waiting } });
    await frames(h, 3);
    expect(await h.call('cancelInsert', { intentId: waiting.intentId })).toEqual({ canceled: true });
    expect(await first).toMatchObject({ state: 'navigated', insert: { state: 'rejected', code: 'CG-INSERT-CANCELED' } });
    // The editor arrives; another «Открыть и вставить» writes; its late cancel is refused.
    target.editor = editor;
    Object.defineProperty(target.prose, 'editor', { configurable: true, value: editor });
    h.page.showOnly(ACC, FAN);
    h.page.go(ACC, FAN);
    h.frame();
    const written = deferred();
    const second = h.call('navigate', { intent: { intentId: uuid(23), acc: ACC, fan: OTHER, thenInsert: written } });
    await frames(h, 5);
    expect(await second).toMatchObject({ state: 'navigated', insert: { state: 'applied' } });
    expect(await h.call('cancelInsert', { intentId: written.intentId })).toEqual({ canceled: false });
    expect(target.calls).toEqual(['setText']);
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
    const bare = createMainRuntime({ win: window, documentEpoch: 'doc2', now: () => 0, setTimer: (cb, ms) => setTimeout(cb, ms), frame: (cb) => cb(), ...guards(() => undefined), emit: (t) => events.push(t), post: (t) => events.push(t) });
    expect(bare.handle('fan', { acc: ACC, fan: FAN })).toBe('not-ready');
    expect(bare.handle('listAccounts', {})).toEqual([]);
    // While #app is not there (still searching or given up), only `app` is reported, as missing.
    expect((bare.handle('snapshot', {}) as { contract: unknown }).contract).toEqual({ build: null, missing: ['app'], shape: [], notYet: [], receiptModules: {} });
    bare.dispose();
  });
});
