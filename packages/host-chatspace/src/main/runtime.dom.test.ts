// The MAIN runtime against a ChatSpace-shaped page (src/testing/fake-page.ts),
// driven through its request handler with a hand-made boot context: frames are
// flushed by the test, events are recorded. Answers are checked with the
// contracts' own schemas (what the isolated side will check).

import { InsertReceiptSchema, NavigationReceiptSchema, OpenChatAnswerSchema } from '@cg/contracts/host';
import { DraftWireSchema } from '@cg/contracts/bridge-messages';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakePage, fakeStore, seedCache, type FakeComposer, type FakeEditor, type FakePage } from '../testing/fake-page';
import { type MainContext, type MainRuntime } from '@cg/host-kit/main/bridge';
import { faultCounter, guardWith } from '@cg/host-kit/main/guard';
import { OPEN_CHAT_REQUEST_MS } from './protocol';
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

  it('[RB-015] route epochs grow on every navigation; [BG-002] the route event carries the account and chat', () => {
    const h = harness as Harness;
    h.page.go(ACC, OTHER);
    h.page.go(ACC);
    const routes = h.events.filter((event) => event.t === 'route').map((event) => event.payload['route'] as { epoch: number; chat: unknown });
    expect(routes.at(-1)).toMatchObject({ epoch: 3, chat: null });
    expect(routes.at(-2)).toMatchObject({ epoch: 2, chat: { platformFanId: OTHER } });
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

  it('two visible composers are ambiguous: no composer state, no write', async () => {
    const h = harness as Harness;
    const intent = await openIntent(h);
    for (const item of h.page.all) h.page.show(item, true);
    expect((h.runtime.handle('snapshot', {}) as { composer: unknown }).composer).toBeNull();
    expect(await h.call('insertGuarded', { intent })).toEqual({ state: 'rejected', code: 'CG-INSERT-CHAT-CHANGED' });
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
});

describe('MAIN runtime — our read of the open chat from the API (X54)', () => {
  const API = 'https://api.example.test/api/v0/';
  const raw = (id: string, over: Record<string, unknown> = {}, meta: Record<string, unknown> = {}) => ({
    id,
    content: '<p>for <b>you</b></p>',
    sent_at: '2026-10-17T06:00:00+00:00',
    is_from_fan: false,
    platform_metadata: { price: 0, isFree: true, isOpened: false, mediaCount: 0, media: [], isTip: false, isFromQueue: false, ...meta },
    ...over,
  });
  let token: unknown;
  let entries: Array<{ name: string }>;
  let fetches: Array<{ url: string; auth: string | null }>;
  let reply: () => Promise<Response>;

  beforeEach(async () => {
    token = 'jwt-1';
    entries = [{ name: 'https://chat.example.test/assets/index-abc.js' }, { name: `${API}accounts?limit=10` }];
    fetches = [];
    reply = () => Promise.resolve(new Response(JSON.stringify({ items: [], has_more: false })));
    Object.defineProperty(window, 'Clerk', { configurable: true, value: { session: { getToken: () => Promise.resolve(token) } } });
    vi.spyOn(window.performance, 'getEntriesByType').mockImplementation(() => entries as unknown as PerformanceEntryList);
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      fetches.push({ url: input instanceof Request ? input.url : input instanceof URL ? input.href : input, auth: new Headers(init?.headers).get('authorization') });
      return reply();
    });
    await start();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, 'Clerk');
  });

  it('[X54] only the chat on the route: another chat is refused before any request', async () => {
    const h = harness as Harness;
    expect(await h.call('openChatMessages', { acc: ACC, fan: OTHER, limit: 50 })).toBe('identity-mismatch');
    expect(await h.call('openChatMessages', { acc: '1009', fan: FAN, limit: 50 })).toBe('identity-mismatch');
    h.page.go(ACC, OTHER);
    expect(await h.call('openChatMessages', { acc: ACC, fan: FAN, limit: 50 })).toBe('identity-mismatch');
    h.page.go(ACC, undefined, 'accounts-overview');
    expect(await h.call('openChatMessages', { acc: ACC, fan: OTHER, limit: 50 })).toBe('identity-mismatch');
    expect(fetches).toEqual([]);
    expect(h.runtime.handle('openChatMessages', { acc: ACC, fan: FAN, limit: 101 })).toBe('bad-request');
    expect(h.runtime.handle('openChatMessages', { acc: ACC, fan: FAN, limit: 5, cursor: 'x' })).toBe('bad-request');
  });

  it('[X54] the page’s own address, session and transport; money fields as OnlyFans gives them', async () => {
    const h = harness as Harness;
    reply = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            items: [
              raw('9003', { is_from_fan: true, content: '<p>wow</p><p>thanks</p>' }),
              raw('9002', {}, { price: '25.00', isFree: false, isOpened: true, mediaCount: 2, isFromQueue: true }),
              raw('9001', { content: '' }, { price: 15, isFree: false, isOpened: false, media: [{}, {}, {}], mediaCount: undefined, isTip: true }),
              { id: 'not-an-id', sent_at: '2026-10-17T06:00:00Z', is_from_fan: false },
            ],
            has_more: true,
          }),
        ),
      );
    const answer = OpenChatAnswerSchema.parse(await h.call('openChatMessages', { acc: ACC, fan: FAN, limit: 50, cursor: '9100' }));
    // Past OnlyMonster's own cache (its Refresh): a purchase changes a message, only a fresh read says it.
    expect(fetches).toEqual([{ url: `${API}accounts/${ACC}/chats/${FAN}/messages?limit=50&cursor=9100&force=true`, auth: 'Bearer jwt-1' }]);
    if (!answer.ok) throw new Error('no page');
    expect(Date.parse(answer.page.capturedAt)).not.toBeNaN();
    expect({ ...answer, page: { ...answer.page, capturedAt: null } }).toEqual({
      ok: true,
      page: {
        capturedAt: null,
        items: [
          { platformMessageId: '9003', direction: 'fan', sentAt: '2026-10-17T06:00:00.000Z', text: 'wow\nthanks', price: null, isFree: true, isOpened: false, mediaCount: 0, tip: false, automatic: false },
          { platformMessageId: '9002', direction: 'model', sentAt: '2026-10-17T06:00:00.000Z', text: 'for you', price: 25, isFree: false, isOpened: true, mediaCount: 2, tip: false, automatic: true },
          { platformMessageId: '9001', direction: 'model', sentAt: '2026-10-17T06:00:00.000Z', text: '', price: 15, isFree: false, isOpened: false, mediaCount: 3, tip: true, automatic: false },
        ],
        hasMore: true,
        cursor: '9001',
      },
    });
  });

  it('[X54] the person leaves the chat while the token is fetched: refused before the request, nothing is read', async () => {
    const h = harness as Harness;
    let release: (value: unknown) => void = () => undefined;
    Object.defineProperty(window, 'Clerk', { configurable: true, value: { session: { getToken: () => new Promise((resolve) => (release = resolve)) } } });
    const asked = h.call('openChatMessages', { acc: ACC, fan: FAN, limit: 10 });
    await Promise.resolve();
    h.page.go(ACC, OTHER);
    release('jwt-late');
    expect(await asked).toBe('identity-mismatch');
    expect(fetches).toEqual([]);
  });

  it('[read mark] a loaded row’s unread count forbids nothing; the fan’s message the socket brought does', async () => {
    const h = harness as Harness;
    // The seeded row is a loaded one (OnlyMonster's cached count, 2): the live search decides.
    expect(await h.call('chatReadState', { acc: ACC, fan: OTHER, username: 'fan_three' })).toEqual({ ok: true, last: null });
    expect(fetches.map((fetched) => fetched.url)).toEqual([`${API}accounts/${ACC}/chats?limit=10&query=fan_three&force=true`]);
    h.page.cache.set(['chatList', ACC, 'all'], { pages: [{ items: [{ id: OTHER, unreadMessagesCount: 3, lastMessage: { id: '9100', isOutgoing: false } }] }] });
    expect(await h.call('chatReadState', { acc: ACC, fan: OTHER, username: 'fan_three' })).toEqual({ ok: true, last: null });
    expect(fetches).toHaveLength(1);
  });

  it('[X54] a session token that never comes: the read ends as late within its deadline, nothing is requested', async () => {
    const h = harness as Harness;
    Object.defineProperty(window, 'Clerk', { configurable: true, value: { session: { getToken: () => new Promise(() => undefined) } } });
    // Timers only: the API's address comes from the page's resource timing.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const asked = h.call('openChatMessages', { acc: ACC, fan: FAN, limit: 10 });
      await vi.advanceTimersByTimeAsync(OPEN_CHAT_REQUEST_MS);
      expect(OpenChatAnswerSchema.parse(await asked)).toEqual({ ok: false, failure: 'timeout', status: null });
      expect(fetches).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('[X54] only the page’s own read of its accounts names the API: another `/api/v0/` address carries no token', async () => {
    (harness as Harness).dispose();
    entries = [{ name: 'https://elsewhere.example.test/api/v0/chats/1' }];
    const fresh = await start();
    expect(OpenChatAnswerSchema.parse(await fresh.call('openChatMessages', { acc: ACC, fan: FAN, limit: 10 }))).toEqual({ ok: false, failure: 'endpoint', status: null });
    expect(fetches).toEqual([]);
  });
});
