// Chat navigation, the palette, the quick jump and the cheatsheet as parts
// of the tab's AppClient (architecture.md §6.9, §10.2): against the scripted
// HostPort of @cg/testing/host and a scripted tab RPC. Test titles carry the
// parity rows; ids are synthetic.

import {
  UiActionSchema,
  type ActionReceipt,
  type CgCode,
  type ChatRef,
  type DockVM,
  type HostAccount,
  type HostSnapshot,
  type NavigationItem,
  type OpView,
  type PaletteItemVM,
  type PaletteVM,
  type QuickJumpVM,
  type TabEventPayload,
  type TabEventType,
  type UiAction,
} from '@cg/contracts';
import {
  LIST_FRESH_MS,
  LIST_SETTLE_MS,
  NAVIGATION_SURFACE,
  accountHandle,
  chatHandle,
  createCauseHint,
  createCheatsheetController,
  createNavigationController,
  createOverlayState,
  createPaletteController,
  createPaletteHub,
  createQuickJumpController,
  parseAccountHandle,
  parseChatHandle,
  type PaletteHubPort,
  type RpcAnswer,
  type TabRpc,
} from '@cg/core/application/navigation';
import { createActionCatalog } from '@cg/core/domain/hotkeys';
import { createI18n } from '@cg/core/domain/i18n';
import { FakeToasts, ctxOf, dock, reason } from '@cg/testing/app-client';
import { FakeHostPort, contractReport, hostAccount, memory, openChat, startSnapshot, type HostAnswers } from '@cg/testing/host';
import { describe, expect, it } from 'vitest';

import { FakeClock, sequentialIds, settle } from './support/clock';
import { WORLD, uuid } from './support/world';

const NOW = Date.parse('2026-10-03T10:00:00.000Z');
const ACC = hostAccount.hostAccountId;
const chat = (fan: string, account = ACC): ChatRef => ({ host: 'chatspace', hostAccountId: account, platformFanId: fan });
const item = (fan: string, position: number, name: string, unreadCount: number | null = 0, isOnline: boolean | null = null): NavigationItem => ({
  chat: chat(fan),
  position,
  displayName: name,
  username: name.toLowerCase().replace(/\s+/g, '_'),
  unreadCount,
  isOnline,
});
/** ChatSpace's loaded list; the open chat (2002) is its second row. */
const LIST = [item('2005', 0, 'Jake Morrison'), item('2002', 1, 'Fan Two', 0, true), item('2003', 2, 'Theodore Whitfield', 2), item('2004', 3, 'Marco Rinaldi', null, true), item('2006', 4, 'Tomasz', 1)];
const OTHER_ACCOUNT: HostAccount = { host: 'chatspace', hostAccountId: '1002', platform: 'onlyfans', platformAccountId: '3004', username: 'model_two', displayName: 'Model Two' };

type Requests = { type: string; payload: unknown }[];

class FakeRpc implements TabRpc {
  readonly requests: Requests = [];
  readonly answers = new Map<string, (payload: unknown) => RpcAnswer<unknown>>();
  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();
  private tokens = 0;

  constructor() {
    this.answers.set('token.issue', () => ({ ok: true, payload: { actionToken: `tok_nav_${String(++this.tokens).padStart(16, '0')}`, expiresAt: NOW + 10_000 } }));
    this.answers.set('op.list', () => ({ ok: true, payload: { ops: [], truncated: false } }));
  }

  request(type: string, payload: unknown): Promise<never> {
    this.requests.push({ type, payload });
    const answer = this.answers.get(type);
    return Promise.resolve(answer === undefined ? { ok: false, error: { code: 'CG-HUB-UNAVAILABLE' } } : answer(payload)) as Promise<never>;
  }

  onEvent<T extends TabEventType>(type: T, listener: (payload: TabEventPayload<T>) => void): () => void {
    const set = this.listeners.get(type) ?? new Set();
    this.listeners.set(type, set);
    set.add(listener as (payload: unknown) => void);
    return () => {
      set.delete(listener as (payload: unknown) => void);
    };
  }

  emit(type: string, payload: unknown = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(payload);
  }

  of(type: string): unknown[] {
    return this.requests.filter((request) => request.type === type).map((request) => request.payload);
  }
}

interface WorldOptions {
  readonly snapshot?: Partial<HostSnapshot>;
  readonly chatList?: readonly NavigationItem[];
  readonly answers?: HostAnswers;
  /** The owner's `navigation` switch as the tab would answer it; a function — an answer that is slow or moves. */
  readonly ownerSwitch?: boolean | null | ((hostAccountId: string | null) => boolean | null | Promise<boolean | null>);
}

function world(options: WorldOptions = {}) {
  const host = new FakeHostPort({
    start: { ...startSnapshot, accounts: [hostAccount, OTHER_ACCOUNT], ...options.snapshot },
    memory: { ...memory, chatList: options.chatList ?? LIST },
    checkpoint: null,
    answers: options.answers ?? {},
    timeline: [],
  });
  const rpc = new FakeRpc();
  const clock = new FakeClock(NOW);
  const overlays = createOverlayState();
  const toasts = new FakeToasts();
  const cause = createCauseHint();
  const i18n = createI18n({ language: 'ru', now: () => clock.now() });
  const navigation = createNavigationController({ host, rpc, i18n, ids: sequentialIds(0x700), clock, overlays, toasts, cause, ownerSwitch: (hostAccountId) => (typeof options.ownerSwitch === 'function' ? options.ownerSwitch(hostAccountId) : (options.ownerSwitch ?? null)) });
  const go = async (action: UiAction): Promise<ActionReceipt | null> => {
    const pending = navigation.dispatch(action);
    if (pending === null) return null;
    // A cold list is asked once more after a short wait: let that timer fire.
    await clock.advance(200);
    return pending;
  };
  const targets = (): string[] => host.calls.navigations.map((intent) => `${intent.target.hostAccountId}/${intent.target.platformFanId ?? '-'}`);
  return { host, rpc, clock, overlays, toasts, cause, i18n, navigation, go, targets };
}

/**
 * R09's `listCachedChats` as it really answers: at once from the adapter's own copy, reading ChatSpace's list
 * again in the background only when that copy is over a second old. Nothing tells the adapter that another
 * chat moved up, so the copy a key meets may be minutes old (the scripted port always answers the list as it is).
 */
function adapterCopy(w: ReturnType<typeof world>, live: () => readonly NavigationItem[]): { reads(): number } {
  let copy = { items: live(), at: w.clock.now() };
  let reads = 0;
  w.host.listCachedChats = (_account, limit) => {
    if (w.clock.now() - copy.at > 1000) {
      void Promise.resolve().then(() => {
        reads += 1;
        copy = { items: live(), at: w.clock.now() };
      });
    }
    return copy.items.slice(0, limit);
  };
  return { reads: () => reads };
}

/** The person moved: ChatSpace's route as the scripted port reports it next. */
function moveRoute(w: ReturnType<typeof world>, route: HostSnapshot['route']): void {
  (w.host as unknown as { script: { timeline: unknown[] } }).script.timeline.push({ kind: 'event', at: 1, event: { type: 'route', route } });
  w.host.run();
}

const step = (direction: 'next' | 'previous'): UiAction => ({ type: 'Navigate', to: { kind: 'chat-step', direction } });
const NEXT_UNREAD: UiAction = { type: 'Navigate', to: { kind: 'next-unread' } };
const slot = (n: number): UiAction => ({ type: 'Navigate', to: { kind: 'chat-slot', slot: n } });
const failed = (receipt: ActionReceipt | null): CgCode | null => (receipt !== null && !receipt.ok ? receipt.code : null);

describe('chat navigation', () => {
  it('[HK-037] J and K open the next and the previous chat of ChatSpace\'s own list, through its router, each with its own one-time token', async () => {
    const w = world();
    expect(await w.go(step('next'))).toEqual({ ok: true, type: 'Navigate', outcome: 'opened' });
    expect(await w.go(step('previous'))).toEqual({ ok: true, type: 'Navigate', outcome: 'opened' });
    // The open chat is the fake's 2002 both times (the fake's route does not move).
    expect(w.targets()).toEqual([`${ACC}/2003`, `${ACC}/2005`]);
    expect(w.rpc.of('token.issue')).toEqual([
      { kind: 'navigate', surface: NAVIGATION_SURFACE },
      { kind: 'navigate', surface: NAVIGATION_SURFACE },
    ]);
    const tokens = w.host.calls.navigations.map((intent) => intent.cause.actionToken);
    expect(new Set(tokens).size).toBe(2);
    expect(w.host.calls.redeemed.map((entry) => entry.kind)).toEqual(['navigate', 'navigate']);
    // A plain navigation: never an insert riding on it.
    for (const intent of w.host.calls.navigations) expect(intent.thenInsert).toBeUndefined();
  });

  it('[HK-037] ⌘U opens the next unread chat; with none it says so and opens nothing', async () => {
    const w = world();
    expect((await w.go(NEXT_UNREAD))?.ok).toBe(true);
    expect(w.targets()).toEqual([`${ACC}/2003`]);
    const none = world({ chatList: [item('2002', 0, 'Fan Two', 0), item('2003', 1, 'Theo', null)] });
    expect(await none.go(NEXT_UNREAD)).toEqual({ ok: true, type: 'Navigate', outcome: 'noop' });
    expect(none.targets()).toEqual([]);
    expect(none.toasts.shown.map((entry) => entry.toast.title)).toEqual([{ key: 'toast.noUnread' }]);
    expect(none.rpc.of('token.issue')).toEqual([]);
  });

  it('[HK-037] ⌘1–9 opens the N-th row; an empty slot, the end of the list and the chat already open do nothing — and ask for no token', async () => {
    const w = world();
    expect((await w.go(slot(4)))?.ok).toBe(true);
    expect(w.targets()).toEqual([`${ACC}/2004`]);
    for (const action of [slot(9), slot(2)]) expect(await w.go(action)).toEqual({ ok: true, type: 'Navigate', outcome: 'noop' });
    const last = world({ chatList: [item('2005', 0, 'Jake'), item('2002', 1, 'Fan Two')] });
    expect(await last.go(step('next'))).toEqual({ ok: true, type: 'Navigate', outcome: 'noop' });
    expect([...w.targets(), ...last.targets()]).toEqual([`${ACC}/2004`]);
    expect(w.rpc.of('token.issue')).toHaveLength(1);
    expect(last.rpc.of('token.issue')).toEqual([]);
  });

  it('[HK-037] navigation happens only as the result of a person\'s action: nothing moves on a host event, a timer or a finished generation', async () => {
    const w = world();
    createPaletteController({ host: w.host, rpc: w.rpc, i18n: w.i18n, catalog: createActionCatalog('mac'), clock: w.clock, overlays: w.overlays, dock: { get: () => null, subscribe: () => () => undefined } });
    createQuickJumpController({ host: w.host, i18n: w.i18n, overlays: w.overlays, clock: w.clock });
    w.overlays.set('palette', true);
    w.overlays.set('quick-jump', true);
    w.rpc.emit('op.done', {});
    w.rpc.emit('toast', {});
    await w.clock.advance(120_000);
    expect(w.host.calls.navigations).toEqual([]);
    expect(w.rpc.of('token.issue')).toEqual([]);
    // The key's cause travels with the intent; a click is the default.
    w.cause.mark('key');
    await w.go(step('next'));
    await w.go(step('next'));
    expect(w.host.calls.navigations.map((intent) => intent.cause.kind)).toEqual(['key', 'click']);
  });

  it('[HK-037] a refused token, a failed router push and a broken chat list are said, never retried', async () => {
    const refused = world({ answers: { redeem: [false] } });
    expect(failed(await refused.go(step('next')))).toBe('CG-NAV-FAILED');
    const timeout = world({ answers: { navigate: [{ state: 'failed', code: 'CG-NAV-TIMEOUT', insert: null }] } });
    const receipt = await timeout.go(step('next'));
    expect(failed(receipt)).toBe('CG-NAV-TIMEOUT');
    expect(receipt).toMatchObject({ error: { code: 'CG-NAV-TIMEOUT' } });
    expect(timeout.host.calls.navigations).toHaveLength(1);
    const noToken = world();
    noToken.rpc.answers.set('token.issue', () => ({ ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE' } }));
    expect(failed(await noToken.go(slot(1)))).toBe('CG-RUNTIME-UNREACHABLE');
    expect(noToken.host.calls.navigations).toEqual([]);
    // §6.2: the `chatList` anchor broke — J/K, ⌘U and ⌘1–9 are off, with the code.
    const broken = world({ snapshot: { contract: contractReport({ chatList: { state: 'contractBroken', code: 'CG-HOST-CONTRACT' } }) } });
    for (const action of [step('next'), NEXT_UNREAD, slot(1)]) expect(failed(await broken.go(action))).toBe('CG-HOST-CONTRACT');
    const noRouter = world({ snapshot: { contract: contractReport({ navigate: { state: 'off' } }) } });
    expect(failed(await noRouter.go(step('next')))).toBe('CG-HOST-CONTRACT');
    // The owner switched navigation off on the server.
    const off = world({ ownerSwitch: false });
    expect(failed(await off.go(step('next')))).toBe('CG-FEATURE-DISABLED');
    for (const w of [broken, noRouter, off]) expect([w.host.calls.navigations, w.rpc.of('token.issue')]).toEqual([[], []]);
  });

  it('[HK-037] with no account on screen there is nothing to walk; a router that throws is a failed navigation; the owner\'s switch covers «перейти» too', async () => {
    const nowhere = world({ snapshot: { route: { epoch: 1, name: 'other', account: null, chat: null }, identity: null, composer: null } });
    expect(await nowhere.go(step('next'))).toEqual({ ok: true, type: 'Navigate', outcome: 'noop' });
    expect(nowhere.navigation.currentAccountId()).toBeNull();
    const throwing = world();
    throwing.host.navigate = () => Promise.reject(new Error('bridge gone'));
    expect(failed(await throwing.go(step('next')))).toBe('CG-NAV-FAILED');
    // The guard is released: the next key navigates.
    const off = world({ ownerSwitch: false });
    expect(failed(await off.go({ type: 'Navigate', to: { kind: 'chat', targetHandle: chatHandle(chat('2004')) } }))).toBe('CG-FEATURE-DISABLED');
    expect(off.rpc.of('token.issue')).toEqual([]);
    expect(off.navigation.getSnapshot({ of: 'palette' })).toBeUndefined();
    expect(off.navigation.subscribe({ of: 'palette' }, () => undefined)()).toBeUndefined();
  });

  it('[HK-037] a cold list is asked once more; a second key while the router still moves is not queued', async () => {
    let reads = 0;
    const w = world();
    const original = w.host.listCachedChats.bind(w.host);
    w.host.listCachedChats = (account, limit) => (++reads === 1 ? [] : original(account, limit));
    expect((await w.go(step('next')))?.ok).toBe(true);
    expect(reads).toBe(2);
    const first = w.navigation.dispatch(step('next'));
    const second = w.navigation.dispatch(step('previous'));
    await w.clock.advance(200);
    expect([(await first)?.ok, await second]).toEqual([true, { ok: true, type: 'Navigate', outcome: 'noop' }]);
    expect(w.targets()).toEqual([`${ACC}/2003`, `${ACC}/2003`]);
  });

  it('[HK-037] a key walks the list ChatSpace shows now, not the adapter\'s older copy: a chat that moved up is the next one, a new unread chat is found, ⌘N is the N-th row as it is', async () => {
    // The copy was filled when the chat opened; three minutes later a fan wrote and his chat moved up, unread.
    const filled = [item('2005', 0, 'Jake Morrison'), item('2002', 1, 'Fan Two'), item('2003', 2, 'Theodore Whitfield'), item('2004', 3, 'Marco Rinaldi')];
    const moved = [item('2005', 0, 'Jake Morrison'), item('2002', 1, 'Fan Two'), item('2004', 2, 'Marco Rinaldi', 3), item('2003', 3, 'Theodore Whitfield')];
    for (const [action, opens] of [
      [step('next'), '2004'],
      [NEXT_UNREAD, '2004'],
      [slot(3), '2004'],
      [slot(4), '2003'],
    ] as const) {
      let live = filled;
      const w = world({ chatList: filled });
      const copy = adapterCopy(w, () => live);
      await w.clock.advance(180_000);
      live = moved;
      expect((await w.go(action))?.ok).toBe(true);
      // Opening a chat marks it read on OnlyFans: the one that opens is the one in that row now.
      expect([action.type === 'Navigate' && action.to.kind, w.targets()]).toEqual([action.type === 'Navigate' && action.to.kind, [`${ACC}/${opens}`]]);
      expect(w.toasts.shown).toEqual([]);
      expect(copy.reads()).toBe(1);
    }
    // And the other way: the copy still has an unread chat ChatSpace no longer shows as unread — «нет непрочитанных», nothing opens.
    let live = moved;
    const read = world({ chatList: moved });
    adapterCopy(read, () => live);
    await read.clock.advance(180_000);
    live = filled;
    expect(await read.go(NEXT_UNREAD)).toEqual({ ok: true, type: 'Navigate', outcome: 'noop' });
    expect([read.targets(), read.toasts.shown.map((entry) => entry.toast.title)]).toEqual([[], [{ key: 'toast.noUnread' }]]);
  });

  it('[HK-037] the list is settled once for keys in a row: the first key waits for the adapter\'s read, the next ones within a second walk at once', async () => {
    const w = world();
    const first = w.navigation.dispatch(step('next'));
    await settle();
    // Nothing moves and no token is asked while the list settles.
    expect([w.targets(), w.rpc.of('token.issue')]).toEqual([[], []]);
    await w.clock.advance(LIST_SETTLE_MS);
    expect((await first)?.ok).toBe(true);
    expect(w.targets()).toEqual([`${ACC}/2003`]);
    // The next key in a row: no timer at all.
    const second = w.navigation.dispatch(slot(4));
    await settle();
    expect([w.targets(), w.clock.pending]).toEqual([[`${ACC}/2003`, `${ACC}/2004`], 0]);
    expect((await second)?.ok).toBe(true);
    // A second later the list may have moved again: it is settled anew.
    await w.clock.advance(LIST_FRESH_MS + 1);
    const third = w.navigation.dispatch(slot(1));
    await settle();
    expect(w.targets()).toHaveLength(2);
    await w.clock.advance(LIST_SETTLE_MS);
    expect((await third)?.ok).toBe(true);
    expect(w.targets()).toEqual([`${ACC}/2003`, `${ACC}/2004`, `${ACC}/2005`]);
  });

  it('[HK-037] where the person is — the account and the open chat — is read after the list settled: a click meanwhile wins', async () => {
    // Another account's list came on screen while the key waited: the key walks nothing.
    const away = world();
    const pending = away.navigation.dispatch(step('next'));
    moveRoute(away, { epoch: 7, name: 'chat', account: OTHER_ACCOUNT, chat: null });
    await away.clock.advance(LIST_SETTLE_MS);
    expect(await pending).toEqual({ ok: true, type: 'Navigate', outcome: 'noop' });
    expect([away.targets(), away.rpc.of('token.issue')]).toEqual([[], []]);
    // Another chat of the same account was opened by a click: J steps from that chat, not from the one the key was pressed in.
    const clicked = world();
    const next = clicked.navigation.dispatch(step('next'));
    moveRoute(clicked, { epoch: 7, name: 'chat', account: hostAccount, chat: chat('2003') });
    await clicked.clock.advance(LIST_SETTLE_MS);
    expect((await next)?.ok).toBe(true);
    expect(clicked.targets()).toEqual([`${ACC}/2004`]);
  });

  it('[HK-037] a key\'s mark is spent by its own navigation whatever came of it: nothing to open, a router still moving, a refusal — the next click is a click', async () => {
    const click: UiAction = { type: 'Navigate', to: { kind: 'chat', targetHandle: chatHandle(chat('2004')) } };
    const causes = (w: ReturnType<typeof world>): string[] => w.host.calls.navigations.map((intent) => intent.cause.kind);
    // The end of the list, the chat already open, an empty slot, no unread chat: nothing opened.
    for (const nothing of [step('next'), slot(2), slot(9), NEXT_UNREAD]) {
      const w = world({ chatList: [item('2005', 0, 'Jake Morrison'), item('2002', 1, 'Fan Two')] });
      w.cause.mark('key');
      expect(await w.go(nothing)).toEqual({ ok: true, type: 'Navigate', outcome: 'noop' });
      await w.go(click);
      expect(causes(w)).toEqual(['click']);
    }
    // A second key while the router still moves is not queued — and its mark is not left behind either.
    const busy = world();
    await busy.go(step('next'));
    busy.cause.mark('key');
    const first = busy.navigation.dispatch(step('next'));
    busy.cause.mark('key');
    const second = busy.navigation.dispatch(step('previous'));
    await settle();
    expect([(await first)?.ok, await second]).toEqual([true, { ok: true, type: 'Navigate', outcome: 'noop' }]);
    await busy.go(click);
    expect(causes(busy)).toEqual(['click', 'key', 'click']);
    // Refused before anything is asked: the owner's switch, a broken list, no account on screen.
    for (const refusing of [world({ ownerSwitch: false }), world({ snapshot: { contract: contractReport({ chatList: { state: 'off' } }) } })]) {
      refusing.cause.mark('key');
      expect((await refusing.go(step('next')))?.ok).toBe(false);
      expect(refusing.cause.take()).toBe('click');
    }
    // A key that opens a chat by its handle (a digit under the quick jump) is a key; `open()` called directly is a click unless told.
    const named = world();
    named.cause.mark('key');
    await named.go(click);
    await named.navigation.open({ hostAccountId: ACC, platformFanId: '2003' });
    await named.navigation.open({ hostAccountId: ACC, platformFanId: '2005' }, 'key');
    expect(causes(named)).toEqual(['key', 'click', 'key']);
  });

  it('[CS-006] a chat or an account is opened by its handle — only by ours; a foreign handle and a foreign surface are not this controller\'s', async () => {
    const w = world();
    w.overlays.set('palette', true);
    expect((await w.go({ type: 'Navigate', to: { kind: 'chat', targetHandle: chatHandle(chat('2004')) } }))?.ok).toBe(true);
    expect((await w.go({ type: 'Navigate', to: { kind: 'account', accountHandle: accountHandle('1002') } }))?.ok).toBe(true);
    expect(w.targets()).toEqual([`${ACC}/2004`, '1002/-']);
    // The window that led to the chat closes.
    expect(w.overlays.isOpen('palette')).toBe(false);
    expect(w.navigation.dispatch({ type: 'Navigate', to: { kind: 'chat', targetHandle: 'dock:f2002' } })).toBeNull();
    expect(w.navigation.dispatch({ type: 'Navigate', to: { kind: 'account', accountHandle: 'acc:1002' } })).toBeNull();
    expect(w.navigation.dispatch({ type: 'Navigate', to: { kind: 'surface', surface: 'spenders', open: true } })).toBeNull();
    expect(w.navigation.dispatch({ type: 'OpenSettings', route: { section: 'status' } })).toBeNull();
    expect(parseChatHandle(chatHandle(chat('2004')))).toEqual({ hostAccountId: ACC, platformFanId: '2004' });
    expect(parseAccountHandle(accountHandle('1002'))).toBe('1002');
    for (const bad of ['nav.chat.1001', 'nav.chat.1001.2004.9', 'nav.chat.0.2004', 'nav.chat.abc.2004', 'x']) expect(parseChatHandle(bad)).toBeNull();
    expect(parseAccountHandle('nav.acc.0')).toBeNull();
    // Our handles are valid handles of the UiAction contract.
    expect(UiActionSchema.safeParse({ type: 'Navigate', to: { kind: 'chat', targetHandle: chatHandle(chat('2004')) } }).success).toBe(true);
    expect(UiActionSchema.safeParse({ type: 'Navigate', to: { kind: 'account', accountHandle: accountHandle('1002') } }).success).toBe(true);
  });

  it('[HK-036] [NEW-07] the palette, the quick jump and the cheatsheet open and close by Navigate; the dispatcher sees them at once', async () => {
    // The quick jump opens only where the owner's `navigation` is on (below); the palette and the cheatsheet ask nothing.
    const w = world({ ownerSwitch: true });
    for (const surface of ['palette', 'quick-jump', 'cheatsheet'] as const) {
      expect(await w.go({ type: 'Navigate', to: { kind: 'surface', surface, open: true } })).toEqual({ ok: true, type: 'Navigate', outcome: 'opened' });
      expect(w.overlays.top()).toBe(surface);
      expect(await w.go({ type: 'Navigate', to: { kind: 'surface', surface, open: true } })).toEqual({ ok: true, type: 'Navigate', outcome: 'noop' });
      expect(await w.go({ type: 'Navigate', to: { kind: 'surface', surface, open: false } })).toEqual({ ok: true, type: 'Navigate', outcome: 'done' });
      expect(w.overlays.isOpen(surface)).toBe(false);
    }
    // Synchronously: the state is set before the receipt's promise settles.
    void w.navigation.dispatch({ type: 'Navigate', to: { kind: 'surface', surface: 'palette', open: true } });
    expect(w.overlays.list()).toEqual(['palette']);
    expect(w.host.calls.navigations).toEqual([]);
  });
});

describe('the quick jump', () => {
  it('[NEW-07] the first nine chats of the visible list, numbered, in our own popup; each row is ⌘N', () => {
    const w = world({ chatList: Array.from({ length: 12 }, (_, index) => item(String(2100 + index), index, `Fan ${index + 1}`, index === 1 ? 3 : null)) });
    const controller = createQuickJumpController({ host: w.host, i18n: w.i18n, overlays: w.overlays, clock: w.clock });
    const view = controller.getSnapshot({ of: 'quick-jump' }) as QuickJumpVM;
    expect(view.view).toEqual({ s: 'ready' });
    expect(view.items).toHaveLength(9);
    // A row names its chat: the action is «open this chat», valid as a UiAction, and the navigation controller's to run.
    expect(view.items[1]).toEqual({ slot: 2, name: 'Fan 2', username: 'fan_2', unread: 3, action: { type: 'Navigate', to: { kind: 'chat', targetHandle: chatHandle(chat('2101')) } } });
    for (const row of view.items) expect(UiActionSchema.safeParse(row.action).success).toBe(true);
    expect(view.items[0]?.unread).toBeNull();
    expect(controller.kinds).toEqual(['quick-jump']);
    expect(controller.getSnapshot({ of: 'palette' })).toBeUndefined();
    expect(controller.dispatch(slot(1))).toBeNull();
    expect(controller.dispatch(view.items[1]?.action as UiAction)).toBeNull();
  });

  it('[NEW-07] [HK-037] the popup opens only where the owner’s `navigation` is definitely on for the account on screen: off, unknown or unread — no popup, no word, nothing to click', async () => {
    const popup: UiAction = { type: 'Navigate', to: { kind: 'surface', surface: 'quick-jump', open: true } };
    const close: UiAction = { type: 'Navigate', to: { kind: 'surface', surface: 'quick-jump', open: false } };
    // Off (the page's own switch, the master switch, a binding that could not be told), and unknown (nobody signed
    // in, the bootstrap not read): the hold opens nothing and says nothing — it is not a command to refuse aloud.
    for (const answer of [false, null] as const) {
      const w = world({ ownerSwitch: answer });
      const seen: boolean[] = [];
      w.overlays.subscribe(() => seen.push(w.overlays.isOpen('quick-jump')));
      expect(await w.go(popup)).toEqual({ ok: true, type: 'Navigate', outcome: 'noop' });
      expect(w.overlays.isOpen('quick-jump')).toBe(false);
      expect(seen).toEqual([]);
      expect(w.toasts.shown).toEqual([]);
      expect([w.host.calls.navigations, w.rpc.of('token.issue')]).toEqual([[], []]);
      // Letting the modifier go is nothing to close.
      expect(await w.go(close)).toEqual({ ok: true, type: 'Navigate', outcome: 'noop' });
    }
    // The switch is asked for the account on screen, each time the popup is asked for.
    const asked: (string | null)[] = [];
    const on = world({ ownerSwitch: (account) => (asked.push(account), true) });
    expect(await on.go(popup)).toEqual({ ok: true, type: 'Navigate', outcome: 'opened' });
    expect(on.overlays.isOpen('quick-jump')).toBe(true);
    expect(asked).toEqual([ACC]);
    expect(await on.go(popup)).toEqual({ ok: true, type: 'Navigate', outcome: 'noop' });
    expect(asked).toEqual([ACC, ACC]);
    // The owner switches it off while the popup is closed: the next hold opens nothing.
    let allowed = true;
    const moving = world({ ownerSwitch: () => allowed });
    expect((await moving.go(popup))?.ok && moving.overlays.isOpen('quick-jump')).toBe(true);
    await moving.go(close);
    allowed = false;
    expect(await moving.go(popup)).toEqual({ ok: true, type: 'Navigate', outcome: 'noop' });
    expect(moving.overlays.isOpen('quick-jump')).toBe(false);
  });

  it('[NEW-07] the switch is read while the hold goes on: a modifier let go meanwhile, or another account on screen by then, and nothing opens late', async () => {
    const popup: UiAction = { type: 'Navigate', to: { kind: 'surface', surface: 'quick-jump', open: true } };
    const close: UiAction = { type: 'Navigate', to: { kind: 'surface', surface: 'quick-jump', open: false } };
    let answer: (allowed: boolean) => void = () => undefined;
    const slow = (): Promise<boolean> => new Promise((resolve) => (answer = resolve));
    // Let go before the switch answered: the answer «on» opens nothing.
    const released = world({ ownerSwitch: slow });
    const opening = released.navigation.dispatch(popup);
    expect(released.overlays.isOpen('quick-jump')).toBe(false);
    void released.navigation.dispatch(close);
    answer(true);
    expect(await opening).toEqual({ ok: true, type: 'Navigate', outcome: 'noop' });
    expect(released.overlays.isOpen('quick-jump')).toBe(false);
    // Held again: only the latest hold counts — the first answer opens nothing, the second opens the popup once.
    const twice = world({ ownerSwitch: slow });
    const first = twice.navigation.dispatch(popup);
    const firstAnswer = answer;
    const second = twice.navigation.dispatch(popup);
    firstAnswer(true);
    expect(await first).toEqual({ ok: true, type: 'Navigate', outcome: 'noop' });
    expect(twice.overlays.isOpen('quick-jump')).toBe(false);
    answer(true);
    expect(await second).toEqual({ ok: true, type: 'Navigate', outcome: 'opened' });
    // The person is in another account by the time the switch of the first one answers: its «on» is not theirs.
    const moved = world({ ownerSwitch: slow });
    const late = moved.navigation.dispatch(popup);
    moveRoute(moved, { epoch: 7, name: 'chat', account: OTHER_ACCOUNT, chat: { host: 'chatspace', hostAccountId: OTHER_ACCOUNT.hostAccountId, platformFanId: '2001' } });
    answer(true);
    expect(await late).toEqual({ ok: true, type: 'Navigate', outcome: 'noop' });
    expect(moved.overlays.isOpen('quick-jump')).toBe(false);
  });

  it('[NEW-07] an open popup is for the account it opened in: another account on screen closes it — its chats are not listed under the first one’s permission', async () => {
    const w = world({ ownerSwitch: true });
    const controller = createQuickJumpController({ host: w.host, i18n: w.i18n, overlays: w.overlays, clock: w.clock });
    await w.go({ type: 'Navigate', to: { kind: 'surface', surface: 'quick-jump', open: true } });
    expect(w.overlays.isOpen('quick-jump')).toBe(true);
    // Another chat of the same account: the popup stays and looks again.
    moveRoute(w, { epoch: 8, name: 'chat', account: hostAccount, chat: chat('2003') });
    expect(w.overlays.isOpen('quick-jump')).toBe(true);
    // Another account: closed at once; the next hold asks that account's own switch.
    moveRoute(w, { epoch: 9, name: 'chat', account: OTHER_ACCOUNT, chat: { host: 'chatspace', hostAccountId: OTHER_ACCOUNT.hostAccountId, platformFanId: '2001' } });
    expect(w.overlays.isOpen('quick-jump')).toBe(false);
    controller.dispose();
  });

  it('[NEW-07] a row of the popup opens the chat the person sees in it, wherever ChatSpace\'s list has moved since; the popup looks again only when it is told to', async () => {
    const shownList = [item('2005', 0, 'Jake Morrison'), item('2002', 1, 'Fan Two'), item('2003', 2, 'Theodore Whitfield'), item('2004', 3, 'Marco Rinaldi')];
    const movedList = [item('2004', 0, 'Marco Rinaldi', 1), item('2005', 1, 'Jake Morrison'), item('2002', 2, 'Fan Two'), item('2003', 3, 'Theodore Whitfield')];
    let live = shownList;
    const w = world({ chatList: shownList, ownerSwitch: true });
    w.host.listCachedChats = (_account, limit) => live.slice(0, limit);
    const controller = createQuickJumpController({ host: w.host, i18n: w.i18n, overlays: w.overlays, clock: w.clock });
    const seen: QuickJumpVM[] = [];
    controller.subscribe({ of: 'quick-jump' }, (view) => seen.push(view as QuickJumpVM));
    const names = (): (string | null)[] => (controller.getSnapshot({ of: 'quick-jump' }) as QuickJumpVM).items.map((row) => row.name);
    await w.go({ type: 'Navigate', to: { kind: 'surface', surface: 'quick-jump', open: true } });
    expect(names()).toEqual(['Jake Morrison', 'Fan Two', 'Theodore Whitfield', 'Marco Rinaldi']);
    const drawn = seen.length;
    // A fan writes: ChatSpace's list moves under the open popup. The popup is not redrawn behind the person's finger…
    live = movedList;
    expect(names()).toEqual(['Jake Morrison', 'Fan Two', 'Theodore Whitfield', 'Marco Rinaldi']);
    expect(seen.length).toBe(drawn);
    // …and row 3 opens Theodore, the chat written in row 3 — not Fan Two, who is third in ChatSpace's list by now.
    const third = (controller.getSnapshot({ of: 'quick-jump' }) as QuickJumpVM).items[2];
    expect((await w.go(third?.action as UiAction))?.ok).toBe(true);
    expect(w.targets()).toEqual([`${ACC}/2003`]);
    // The chat opened and the popup closed; opened again it shows the list as it is now.
    expect(w.overlays.isOpen('quick-jump')).toBe(false);
    await w.go({ type: 'Navigate', to: { kind: 'surface', surface: 'quick-jump', open: true } });
    expect(names()).toEqual(['Marco Rinaldi', 'Jake Morrison', 'Fan Two', 'Theodore Whitfield']);
    // While it is open a route or accounts event makes it look again; a composer event does not.
    live = shownList;
    const before = seen.length;
    (w.host as unknown as { script: { timeline: unknown[] } }).script.timeline.push({ kind: 'event', at: 1, event: { type: 'composer', composer: null } });
    w.host.run();
    expect([seen.length, names()[0]]).toEqual([before, 'Marco Rinaldi']);
    moveRoute(w, { epoch: 9, name: 'chat', account: hostAccount, chat: chat('2003') });
    expect([seen.length, names()[0]]).toEqual([before + 1, 'Jake Morrison']);
    controller.dispose();
  });

  it('[NEW-07] no loaded chats — «Нет загруженных чатов»; a broken list — the error; opening notifies and looks again once the list settled', async () => {
    const empty = world({ chatList: [] });
    const controller = createQuickJumpController({ host: empty.host, i18n: empty.i18n, overlays: empty.overlays, clock: empty.clock });
    expect((controller.getSnapshot({ of: 'quick-jump' }) as QuickJumpVM).view).toEqual({ s: 'empty', why: { key: 'quickJump.empty' } });
    const seen: QuickJumpVM[] = [];
    const unsubscribe = controller.subscribe({ of: 'quick-jump' }, (view) => seen.push(view as QuickJumpVM));
    empty.overlays.set('quick-jump', true);
    await empty.clock.advance(200);
    expect(seen).toHaveLength(2);
    empty.overlays.set('quick-jump', false);
    expect(seen).toHaveLength(3);
    unsubscribe();
    controller.dispose();
    empty.overlays.set('quick-jump', true);
    expect(seen).toHaveLength(3);
    const broken = world({ snapshot: { contract: contractReport({ chatList: { state: 'off' } }) } });
    const view = createQuickJumpController({ host: broken.host, i18n: broken.i18n, overlays: broken.overlays, clock: broken.clock }).getSnapshot({ of: 'quick-jump' }) as QuickJumpVM;
    expect(view).toMatchObject({ view: { s: 'error', error: { code: 'CG-HOST-CONTRACT' }, retry: null }, items: [] });
    const degraded = world({ snapshot: { contract: contractReport({ chatList: { state: 'degraded' } }) } });
    expect((createQuickJumpController({ host: degraded.host, i18n: degraded.i18n, overlays: degraded.overlays, clock: degraded.clock }).getSnapshot({ of: 'quick-jump' }) as QuickJumpVM).view).toEqual({
      s: 'partial',
      gaps: [{ kind: 'host-degraded', capabilities: ['chatList'] }],
    });
  });
});

describe('the cheatsheet', () => {
  it('[HK-034] the view is the catalog in groups, for the system\'s keys; it never changes and needs nothing', () => {
    const controller = createCheatsheetController({ catalog: createActionCatalog('win') });
    const view = controller.getSnapshot({ of: 'cheatsheet' }) as { platform: string; groups: { id: string; rows: { hotkey: { display: string } | null }[] }[] };
    expect(view.platform).toBe('win');
    expect(view.groups.map((group) => group.id)).toEqual(['ai', 'windows', 'before', 'result', 'navigation', 'preview']);
    expect(view.groups[0]?.rows[0]?.hotkey?.display).toBe('Ctrl+E');
    expect(controller.getSnapshot({ of: 'cheatsheet' })).toBe(view);
    expect(controller.getSnapshot({ of: 'dock' })).toBeUndefined();
    expect(controller.dispatch({ type: 'Navigate', to: { kind: 'surface', surface: 'cheatsheet', open: true } })).toBeNull();
    expect(controller.kinds).toEqual(['cheatsheet']);
  });
});

// ── the palette ──

const CTX = ctxOf({ platform: 'mac' });
const HUB: PaletteHubPort = {
  waiting: () =>
    Promise.resolve({
      ok: true,
      rows: [
        { fanRef: '2003', name: 'Theodore Whitfield', username: 'theo_w', lifetimeMills: 12_480_000, waitingSince: '2026-10-03T09:53:00.000Z' },
        { fanRef: '2031', name: null, username: 'quiet_one', lifetimeMills: 90_000, waitingSince: '2026-10-03T09:10:00.000Z' },
      ],
    }),
  fans: () =>
    Promise.resolve({
      spenders: { ok: true, rows: [{ fanRef: '2003', name: 'Theodore Whitfield', username: 'theo_w', lifetimeMills: 12_480_000 }, { fanRef: '2040', name: 'Theo Brandt', username: 'tbrandt', lifetimeMills: 640_000 }] },
      newcomers: { ok: true, rows: [{ fanRef: '2050', name: 'Theodora', username: null, lifetimeMills: null }] },
    }),
};

function paletteWorld(options: WorldOptions & { hub?: PaletteHubPort; dock?: DockVM | null; preview?: boolean } = {}) {
  const w = world(options);
  let dockView: DockVM | null = options.dock === undefined ? dock(CTX, 'ready') : options.dock;
  const dockListeners = new Set<() => void>();
  const previews: ChatRef[] = [];
  const controller = createPaletteController({
    host: w.host,
    rpc: w.rpc,
    i18n: w.i18n,
    catalog: createActionCatalog('mac'),
    clock: w.clock,
    overlays: w.overlays,
    dock: {
      get: () => dockView,
      subscribe: (listener) => {
        dockListeners.add(listener);
        return () => dockListeners.delete(listener);
      },
    },
    hub: options.hub ?? HUB,
    ...(options.preview === false
      ? {}
      : {
          preview: {
            open: (target: ChatRef) => {
              previews.push(target);
              return Promise.resolve<ActionReceipt>({ ok: true, type: 'OpenPreview', outcome: 'opened' });
            },
          },
        }),
  });
  const view = (): PaletteVM => controller.getSnapshot({ of: 'palette' }) as PaletteVM;
  const open = async (): Promise<void> => {
    w.overlays.set('palette', true);
    await settle();
  };
  const search = async (query: string): Promise<void> => {
    await controller.dispatch({ type: 'Search', list: 'palette', query });
    await settle();
  };
  const group = (id: string): readonly PaletteItemVM[] => view().groups.find((entry) => entry.id === id)?.items ?? [];
  const setDock = (next: DockVM | null): void => {
    dockView = next;
    for (const listener of dockListeners) listener();
  };
  return { ...w, controller, view, open, search, group, previews, setDock };
}

const labels = (items: readonly PaletteItemVM[]): (string | { key: string })[] => items.map((entry) => entry.label);

describe('the palette', () => {
  it('[HK-036] in an open chat: the seven functions with their keys and availability, then the windows; every row carries the action a click dispatches', async () => {
    const p = paletteWorld({ dock: dock(CTX, 'ready', { actionsOptions: { gates: { fix: reason('needs-draft') } } }) });
    await p.open();
    const actions = p.group('actions');
    expect(labels(actions)).toEqual(['Reply', 'Fix', 'Hi', 'Ping', 'Review', 'Recap', 'Coach', 'Тон на один ответ', 'Split', 'Панель фана', 'Spenders', 'Новые', 'Шпаргалка клавиш', 'Настройки ChatGoose']);
    expect(p.view().groups[0]?.title).toEqual({ key: 'palette.group.actions', params: { name: 'Fan Two' } });
    expect(actions[0]).toMatchObject({ id: 'action.reply', hotkey: { display: '⌘E' }, enabled: true, action: { type: 'Generate', feature: 'reply', options: {} } });
    expect(actions[1]).toMatchObject({ enabled: false, reason: { id: 'needs-draft', code: 'CG-GATE-DRAFT' } });
    expect(actions[5]?.action).toEqual({ type: 'ShowRecap', length: 'full' });
    expect(actions[6]?.action).toEqual({ type: 'Navigate', to: { kind: 'surface', surface: 'coach', open: true } });
    expect(actions[7]).toMatchObject({ hotkey: { display: '⌘⇧O' }, action: { type: 'SetTone', tone: 'casual' } });
    expect(actions[8]?.action).toEqual({ type: 'SetPreference', key: 'generation.split', value: true });
    expect(actions[10]).toMatchObject({ hotkey: { display: '⌘⇧M' }, action: { type: 'Navigate', to: { kind: 'surface', surface: 'spenders', open: true } } });
    expect(actions[13]?.action).toEqual({ type: 'OpenSettings', route: { section: 'status' } });
    // Every action a row carries is a valid UiAction.
    for (const entry of p.view().groups.flatMap((g) => g.items)) expect([entry.id, UiActionSchema.safeParse(entry.action).success]).toEqual([entry.id, true]);
    expect(p.controller.kinds).toEqual(['palette']);
  });

  it('[HK-036] outside a chat only the windows are offered, under «Переходы»; a search narrows the rows and underlines the match', async () => {
    const p = paletteWorld({ dock: null, snapshot: { route: { epoch: 6, name: 'chat', account: hostAccount, chat: null }, identity: null, composer: null } });
    await p.open();
    expect(p.view().groups[0]).toMatchObject({ id: 'navigation', title: { key: 'palette.group.navigation' } });
    expect(labels(p.group('navigation'))).toEqual(['Spenders', 'Новые', 'Шпаргалка клавиш', 'Настройки ChatGoose']);
    await p.search('шпар');
    expect(p.group('navigation')).toHaveLength(1);
    expect(p.group('navigation')[0]).toMatchObject({ label: 'Шпаргалка клавиш', match: [[0, 4]] });
    expect(p.view().query).toBe('шпар');
  });

  it('[CS-012] «Идут сейчас»: the generations that run in any tab, each with its start and «перейти» to its chat — nothing is drawn into ChatSpace\'s rows', async () => {
    const op = (n: number, fan: string, state: OpView['state'], feature: OpView['feature'] = 'reply'): OpView =>
      ({ opId: uuid(n), feature, surface: 'dock', target: { chat: chat(fan) }, state, phase: 'stream', startedAt: NOW - 14_000, toneUsed: null }) as unknown as OpView;
    const p = paletteWorld();
    p.rpc.answers.set('op.list', () => ({ ok: true, payload: { ops: [op(1, '2003', 'streaming'), op(2, '2004', 'done'), op(3, '2099', 'requesting', 'recap-short')], truncated: false } }));
    await p.open();
    expect(p.rpc.of('op.list')).toEqual([{ scope: 'all' }]);
    const running = p.group('running');
    expect(labels(running)).toEqual(['Reply для Theodore Whitfield', 'Recap для неизвестно']);
    expect(running[0]).toMatchObject({ runningSince: NOW - 14_000, action: { type: 'Navigate', to: { kind: 'chat', targetHandle: chatHandle(chat('2003')) } } });
    // A generation that runs in a chat of another account: «перейти» goes to that account's chat, not to the same fan id under this one.
    p.rpc.answers.set('op.list', () => ({ ok: true, payload: { ops: [{ ...op(4, '2077', 'streaming'), target: { chat: chat('2077', '1002') } } as unknown as OpView], truncated: false } }));
    p.rpc.emit('op.done', {});
    await settle();
    expect(p.group('running')[0]?.action).toEqual({ type: 'Navigate', to: { kind: 'chat', targetHandle: 'nav.chat.1002.2077' } });
    p.rpc.answers.set('op.list', () => ({ ok: true, payload: { ops: [op(1, '2003', 'streaming'), op(2, '2004', 'done'), op(3, '2099', 'requesting', 'recap-short')], truncated: false } }));
    // A generation finished: the list is read again.
    p.rpc.answers.set('op.list', () => ({ ok: true, payload: { ops: [], truncated: false } }));
    p.rpc.emit('op.done', {});
    await settle();
    expect(p.group('running')).toEqual([]);
    // Closed, the palette asks nothing.
    p.overlays.set('palette', false);
    p.rpc.emit('op.done', {});
    await settle();
    expect(p.rpc.of('op.list')).toHaveLength(3);
  });

  it('[CS-006] an empty query shows «Ждут ответа, из Spenders» from the hub, with the money and since when; the footer says where the chats come from', async () => {
    const p = paletteWorld();
    await p.open();
    const waiting = p.group('waiting');
    expect(waiting[0]).toMatchObject({ label: 'Theodore Whitfield', sublabel: '@theo_w', money: 12_480_000, waitingSince: '2026-10-03T09:53:00.000Z', action: { type: 'Navigate', to: { kind: 'chat', targetHandle: chatHandle(chat('2003')) } } });
    expect(waiting[1]).toMatchObject({ label: '@quiet_one', sublabel: '@quiet_one' });
    expect(p.view().groups.find((g) => g.id === 'waiting')?.title).toEqual({ key: 'palette.group.waiting' });
    expect(p.view().footer).toEqual({ key: 'palette.foot.chats', params: { n: 2 } });
    expect(p.view().view).toEqual({ s: 'ready' });
    // With no query the board and «Новые» are not read at all.
    expect(p.group('chats')).toEqual([]);
  });

  it('[CS-006] a query searches ChatSpace\'s loaded list first, then the hub\'s Spenders and «Новые»; a row found only in the hub says where', async () => {
    let fansReads = 0;
    const hub: PaletteHubPort = { waiting: (account) => HUB.waiting(account), fans: (account) => (fansReads++, HUB.fans(account)) };
    const p = paletteWorld({ hub });
    await p.open();
    expect(fansReads).toBe(0);
    await p.search('theo');
    const chats = p.group('chats');
    expect(chats.map((entry) => [entry.label, entry.sublabel])).toEqual([
      ['Theodore Whitfield', '@theodore_whitfield'],
      ['Theo Brandt', '@tbrandt · Spenders'],
      ['Theodora', 'Новые'],
    ]);
    // In both lists: once, as ChatSpace's own row.
    expect(chats.filter((entry) => entry.id === 'chat.2003')).toHaveLength(1);
    expect(chats[0]).toMatchObject({ match: [[0, 4]], money: null });
    expect(chats[1]).toMatchObject({ money: 640_000, action: { type: 'Navigate', to: { kind: 'chat', targetHandle: chatHandle(chat('2040')) } } });
    expect(p.view().groups.find((g) => g.id === 'chats')?.title).toEqual({ key: 'palette.group.chats' });
    expect(p.view().footer).toEqual({ key: 'palette.foot.chats', params: { n: 3 } });
    expect(p.group('waiting')).toEqual([]);
    // The hub rows are read once, not per keystroke.
    await p.search('theod');
    await p.search('theodo');
    expect(fansReads).toBe(1);
    expect(p.group('chats').map((entry) => entry.label)).toEqual(['Theodore Whitfield', 'Theodora']);
    // Nothing matches anywhere: «Ничего не найдено», not an empty window.
    await p.search('zzzz');
    expect(p.view()).toMatchObject({ view: { s: 'empty', why: { key: 'palette.empty' } }, groups: [] });
  });

  it('[CS-006] a source that did not answer is a named gap and the footer says the search covered only ChatSpace\'s lists', async () => {
    const hub: PaletteHubPort = {
      waiting: () => Promise.resolve({ ok: false, code: 'CG-AUTH-REQUIRED' }),
      fans: () => Promise.resolve({ spenders: { ok: false, code: 'CG-HUB-UNAVAILABLE' }, newcomers: { ok: true, rows: [] } }),
    };
    const p = paletteWorld({ hub });
    await p.open();
    expect(p.view().view).toEqual({ s: 'partial', gaps: [{ kind: 'source-failed', source: 'waiting', code: 'CG-AUTH-REQUIRED' }] });
    expect(p.view().footer).toEqual({ key: 'palette.foot.hostOnly' });
    await p.search('theo');
    expect(p.view().view).toEqual({ s: 'partial', gaps: [{ kind: 'source-failed', source: 'spenders', code: 'CG-HUB-UNAVAILABLE' }] });
    // ChatSpace's own rows are still found, and «Новые» (which answered) counts as searched.
    expect(p.group('chats').map((entry) => entry.label)).toEqual(['Theodore Whitfield']);
    expect(p.view().footer).toEqual({ key: 'palette.foot.chats', params: { n: 0 } });
    // A hub port that throws is a gap too, never a broken palette.
    const throwing = paletteWorld({ hub: { waiting: () => Promise.reject(new Error('down')), fans: () => Promise.reject(new Error('down')) } });
    await throwing.open();
    // The queue that threw is «не ответил», never «никто не ждёт»: a gap, and the footer does not claim the hub was searched.
    expect(throwing.view().view).toEqual({ s: 'partial', gaps: [{ kind: 'source-failed', source: 'waiting', code: 'CG-HUB-UNAVAILABLE' }] });
    expect(throwing.view().footer).toEqual({ key: 'palette.foot.hostOnly' });
    await throwing.search('theo');
    expect(throwing.view().view).toMatchObject({ s: 'partial', gaps: [{ source: 'spenders', code: 'CG-HUB-UNAVAILABLE' }, { source: 'newcomers', code: 'CG-HUB-UNAVAILABLE' }] });
    // A broken chat list: the palette still has its actions and says what is missing.
    const broken = paletteWorld({ snapshot: { contract: contractReport({ chatList: { state: 'off' } }) } });
    let listReads = 0;
    const readList = broken.host.listCachedChats.bind(broken.host);
    broken.host.listCachedChats = (account, limit) => (listReads++, readList(account, limit));
    await broken.open();
    expect(broken.view().view).toMatchObject({ s: 'partial', gaps: [{ kind: 'host-degraded', capabilities: ['chatList'] }] });
    // A list whose anchor broke is not read at all (§6.2): no rows of it in the search, no «Онлайн» from it — the hub's rows only.
    await broken.search('theo');
    expect(listReads).toBe(0);
    expect(broken.group('chats').map((entry) => entry.sublabel)).toEqual(['@theo_w · Spenders', '@tbrandt · Spenders', 'Новые']);
    expect(broken.group('online')).toEqual([]);
  });

  it('[CS-006] closed, the palette asks the hub nothing — not on a search action, not on a route change', async () => {
    let waitingReads = 0;
    let fansReads = 0;
    const hub: PaletteHubPort = { waiting: (account) => (waitingReads++, HUB.waiting(account)), fans: (account) => (fansReads++, HUB.fans(account)) };
    const p = paletteWorld({ hub });
    await p.search('theo');
    moveRoute(p, { epoch: 8, name: 'chat', account: hostAccount, chat: chat('2003') });
    await settle();
    expect([waitingReads, fansReads]).toEqual([0, 0]);
    // The query typed while closed is not lost; opening reads what the palette needs then.
    await p.open();
    expect([waitingReads, fansReads]).toEqual([1, 1]);
  });

  it('[CS-006] other accounts ChatSpace has loaded are one click away; the switch itself is a navigation with its own token', async () => {
    const p = paletteWorld();
    await p.open();
    expect(p.group('accounts')).toEqual([expect.objectContaining({ id: 'account.1002', label: 'Model Two', sublabel: '@model_two', action: { type: 'Navigate', to: { kind: 'account', accountHandle: accountHandle('1002') } } })]);
    expect(p.view().groups.find((g) => g.id === 'accounts')?.title).toEqual({ key: 'palette.group.accounts' });
    await p.search('two');
    expect(p.group('accounts').map((entry) => entry.label)).toEqual(['Model Two']);
    await p.search('nobody');
    expect(p.group('accounts')).toEqual([]);
    // Listing accounts moved nothing.
    expect(p.host.calls.navigations).toEqual([]);
  });

  it('[CS-030] «Онлайн»: fans ChatSpace itself shows online open OUR preview — the chat is not opened and nobody is polled', async () => {
    const p = paletteWorld();
    await p.open();
    const online = p.group('online');
    expect(online.map((entry) => entry.label)).toEqual(['Fan Two', 'Marco Rinaldi']);
    expect(online[1]?.action).toEqual({ type: 'OpenPreview', targetHandle: chatHandle(chat('2004')) });
    expect(p.view().groups.find((g) => g.id === 'online')?.title).toEqual({ key: 'palette.group.online' });
    const receipt = await p.controller.dispatch({ type: 'OpenPreview', targetHandle: chatHandle(chat('2004')) });
    expect(receipt).toEqual({ ok: true, type: 'OpenPreview', outcome: 'opened' });
    expect(p.previews).toEqual([chat('2004')]);
    expect(p.overlays.isOpen('palette')).toBe(false);
    // No router push, no token: the fan's chat stays unread.
    expect([p.host.calls.navigations, p.rpc.of('token.issue')]).toEqual([[], []]);
    // A preview handle of another controller is not ours.
    expect(p.controller.dispatch({ type: 'OpenPreview', targetHandle: 'spenders:f2003' })).toBeNull();
    // Without the preview port there is no «Онлайн» group and OpenPreview is nobody's here.
    const bare = paletteWorld({ preview: false });
    await bare.open();
    expect(bare.group('online')).toEqual([]);
    expect(bare.controller.dispatch({ type: 'OpenPreview', targetHandle: chatHandle(chat('2004')) })).toBeNull();
  });

  it('[HK-036] the palette follows the dock and the route while it is open, forgets its query when it closes, and is silent when closed', async () => {
    const p = paletteWorld();
    const seen: PaletteVM[] = [];
    const unsubscribe = p.controller.subscribe({ of: 'palette' }, (view) => seen.push(view as PaletteVM));
    p.setDock(dock(CTX, 'hub-down'));
    expect(seen).toEqual([]);
    await p.open();
    const opened = seen.length;
    expect(opened).toBeGreaterThan(0);
    p.setDock(dock(CTX, 'hub-down'));
    expect(seen.length).toBe(opened + 1);
    expect(p.group('actions')[0]).toMatchObject({ enabled: false, reason: { id: 'hub-down' } });
    await p.search('rep');
    expect(p.view().query).toBe('rep');
    // The same query again changes nothing.
    const before = seen.length;
    await p.search('rep');
    expect(seen.length).toBe(before);
    p.overlays.set('palette', false);
    expect(p.view().query).toBe('');
    // Not this controller's: another list's search, a preview, a navigation.
    expect(p.controller.dispatch({ type: 'Search', list: 'spenders', query: 'x' })).toBeNull();
    expect(p.controller.dispatch({ type: 'Navigate', to: { kind: 'surface', surface: 'palette', open: true } })).toBeNull();
    expect(p.controller.getSnapshot({ of: 'dock' })).toBeUndefined();
    unsubscribe();
    p.controller.dispose();
    const atDispose = seen.length;
    expect(atDispose).toBeGreaterThan(before);
    await p.open();
    p.setDock(dock(CTX, 'ready'));
    expect(seen.length).toBe(atDispose);
  });

  it('[HK-036] the palette is rebuilt when the route or the accounts change and when the language switches; a failed list of generations leaves the old one', async () => {
    const p = paletteWorld();
    const seen: PaletteVM[] = [];
    p.controller.subscribe({ of: 'palette' }, (view) => seen.push(view as PaletteVM));
    // Closed: host events move nothing.
    p.host.subscribe(() => undefined);
    await p.open();
    const base = seen.length;
    const emit = p.host as unknown as { script: { timeline: unknown[] } };
    emit.script.timeline.push({ kind: 'event', at: 1, event: { type: 'accounts', accounts: [hostAccount] } }, { kind: 'event', at: 2, event: { type: 'composer', composer: null } });
    p.host.run();
    await settle();
    // The accounts event rebuilt it (the other account is gone); the composer event did not.
    expect(seen.length).toBe(base + 1);
    expect(p.group('accounts')).toEqual([]);
    p.i18n.setLanguage('en');
    expect(seen.length).toBe(base + 2);
    expect(labels(p.group('actions')).slice(7, 9)).toEqual(['Tone for one answer', 'Split']);
    p.rpc.answers.set('op.list', () => ({ ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE' } }));
    p.rpc.emit('op.done', {});
    await settle();
    expect(seen.length).toBe(base + 2);
    // A chat is open but the dock is not there yet (no sign-in card, the first chunk still loading): only the windows.
    const noDock = paletteWorld({ dock: dock(CTX, 'loading-chat') });
    await noDock.open();
    expect(noDock.view().groups[0]).toMatchObject({ id: 'navigation' });
  });

  it('[CS-006] the default hub port: the page of the account, then «Ждут ответа» on open and the board with «Новые» on the first query', async () => {
    const rpc = new FakeRpc();
    rpc.answers.set('binding.resolve', () => ({ ok: true, payload: { binding: { pageId: WORLD.pages.one.pageId } } }));
    rpc.answers.set('spenders.queue', () => ({
      ok: true,
      payload: { items: [{ fanRef: '2003', username: 'theo_w', displayName: 'Theodore', lifetimeGrossMills: 5000, lastFanMessageAt: '2026-10-03T09:53:00.000Z', lastModelMessageAt: null, unreadCount: 1, readState: 'unread' }], total: 1, loaded: 1, unknown: 0, nextCursor: null, asOf: '2026-10-03T10:00:00.000Z' },
    }));
    rpc.answers.set('spenders.board', () => ({ ok: true, payload: { items: [{ fan: { platformUserId: '2040', displayName: 'Theo Brandt', username: 'tbrandt' }, metrics: { lifetime: { scopeGrossAmountMills: 640_000 } } }] } }));
    rpc.answers.set('newcomers.list', () => ({ ok: false, error: { code: 'CG-FEATURE-DISABLED' } }));
    const hub = createPaletteHub(rpc);
    const listed = (): Promise<unknown> => hub.fans(hostAccount).then((sources) => sources.newcomers);
    expect(await hub.waiting(hostAccount)).toEqual({ ok: true, rows: [{ fanRef: '2003', name: 'Theodore', username: 'theo_w', lifetimeMills: 5000, waitingSince: '2026-10-03T09:53:00.000Z' }] });
    expect(await hub.fans(hostAccount)).toEqual({
      spenders: { ok: true, rows: [{ fanRef: '2040', name: 'Theo Brandt', username: 'tbrandt', lifetimeMills: 640_000 }] },
      newcomers: { ok: false, code: 'CG-FEATURE-DISABLED' },
    });
    expect(rpc.of('spenders.queue')).toEqual([{ pageId: 11, cursor: null, limit: 20 }]);
    expect(rpc.of('spenders.board')).toEqual([{ pageId: 11, period: 'lifetime' }]);
    expect(rpc.of('newcomers.list')).toEqual([{ pageId: 11, windowHours: 48, cursor: null }]);
    rpc.answers.set('newcomers.list', () => ({ ok: true, payload: { items: [{ fanRef: '2050', displayName: 'Theodora', username: null }] } }));
    expect(await listed()).toEqual({ ok: true, rows: [{ fanRef: '2050', name: 'Theodora', username: null, lifetimeMills: null }] });
    // No page for the account (not signed in, not bound): every source says why.
    rpc.answers.set('binding.resolve', () => ({ ok: false, error: { code: 'CG-BINDING-MISSING' } }));
    expect(await hub.waiting(hostAccount)).toEqual({ ok: false, code: 'CG-BINDING-MISSING' });
    expect(await hub.fans(hostAccount)).toEqual({ spenders: { ok: false, code: 'CG-BINDING-MISSING' }, newcomers: { ok: false, code: 'CG-BINDING-MISSING' } });
    rpc.answers.set('binding.resolve', () => ({ ok: true, payload: { binding: { pageId: 11 } } }));
    rpc.answers.delete('spenders.queue');
    expect(await hub.waiting(hostAccount)).toEqual({ ok: false, code: 'CG-HUB-UNAVAILABLE' });
  });
});

// openChat is the fake world's open chat: the navigation tests rely on it being 2002 of account 1001.
it('the scripted world: the open chat is 2002 of account 1001', () => {
  expect(openChat).toEqual(chat('2002'));
});
