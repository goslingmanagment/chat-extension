// Chat navigation over the real ChatSpace adapter (R09 `createChatSpaceHostPort`),
// not the scripted port: the adapter answers `listCachedChats` from its own
// copy and re-reads ChatSpace's list only when asked after the copy went
// stale — nothing tells it that a chat moved up. The scripted port of
// @cg/testing/host always answers the list as it is now, so only this file
// sees whether a key walks the list the person looks at (architecture.md
// §6.9; opening a chat marks it read on OnlyFans). The page side is a
// scripted bridge: what MAIN would answer from ChatSpace's memory.

import { type ChatRef, type HostAccount, type HostTheme, type MountPoints, type NavigationItem, type TabEventPayload, type TabEventType, type UiAction } from '@cg/contracts';
import { createCauseHint, createNavigationController, createOverlayState, createQuickJumpController, LIST_SETTLE_MS, type RpcAnswer, type TabRpc } from '@cg/core/application/navigation';
import { createI18n } from '@cg/core/domain/i18n';
import { createChatSpaceHostPort, type BridgeEvent, type MainBridgeClient, type MountManager, type ThemeReader } from '@cg/host-chatspace/isolated';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeToasts } from '../scenarios/app-client';

const NOW = Date.parse('2026-10-03T10:00:00.000Z');
const ACC = '1001';
const account: HostAccount = { host: 'chatspace', hostAccountId: ACC, platform: 'onlyfans', platformAccountId: '3003', username: 'one', displayName: 'One' };
const chat = (fan: string): ChatRef => ({ host: 'chatspace', hostAccountId: ACC, platformFanId: fan });
const row = (fan: string, position: number, unreadCount: number | null = 0): NavigationItem => ({ chat: chat(fan), position, displayName: `Fan ${fan}`, username: `fan_${fan}`, unreadCount, isOnline: null });

/** ChatSpace's own list when the chat (2002) was opened, and after a fan wrote: his chat moved up, unread. */
const OPENED = [row('2001', 0), row('2002', 1), row('2003', 2), row('2004', 3)];
const MOVED = [row('2001', 0), row('2002', 1), row('2004', 2, 3), row('2003', 3)];

function page(initial: readonly NavigationItem[]) {
  let list = initial;
  let open = '2002';
  let epoch = 4;
  const listeners = new Set<(event: BridgeEvent) => void>();
  const calls: { t: string; payload: Record<string, unknown> }[] = [];
  const route = () => ({ epoch, name: 'chat' as const, account, chat: chat(open) });
  const answers: Record<string, (payload: Record<string, unknown>) => unknown> = {
    snapshot: () => ({ route: route(), hostLoginEpoch: 'L1', composer: null, accounts: [account], contract: { build: 'index-0000fake', missing: [], shape: [], receiptModules: {} } }),
    listAccounts: () => [account],
    chatWindow: () => null,
    fan: () => null,
    listChats: () => list,
    // ChatSpace's router: the chat opens, and MAIN reports the new route.
    navigate: (payload) => {
      const intent = payload['intent'] as { fan: string | null };
      if (intent.fan !== null) open = intent.fan;
      epoch += 1;
      queueMicrotask(() => listeners.forEach((listener) => listener({ t: 'route', payload: { route: route(), hostLoginEpoch: 'L1' } })));
      return { state: 'navigated', routeEpoch: epoch, insert: null };
    },
  };
  const bridge: MainBridgeClient = {
    documentEpoch: 'doc1',
    probe: () => Promise.resolve({ v: 1, readyStateAtStart: 'loading', installMs: 0, wsTap: false }),
    request: (t, payload) => {
      calls.push({ t, payload: payload });
      const answer = answers[t];
      return (answer === undefined ? Promise.reject(new Error(`no answer for ${t}`)) : Promise.resolve(answer(payload as Record<string, unknown>))) as never;
    },
    onEvent: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stats: () => ({ rejected: {}, invalidAnswers: 0, invalidEvents: 0, stale: 0, late: 0, timeouts: 0, coalesced: 0 }),
    close: () => undefined,
  };
  return {
    bridge,
    calls,
    /** A fan wrote, a chat was read elsewhere: ChatSpace's own list changes; nobody tells the adapter. */
    setList: (next: readonly NavigationItem[]) => (list = next),
    opened: (): (string | null)[] => calls.filter((call) => call.t === 'navigate').map((call) => (call.payload['intent'] as { fan: string | null }).fan),
    listReads: (): number => calls.filter((call) => call.t === 'listChats').length,
  };
}

const points: MountPoints = { dock: { kind: 'in-flow', composerInstanceId: 'c1', width: 700 }, overlay: { ready: true, container: null } };
const mounts = { update: () => undefined, refresh: () => undefined, points: () => points, onChange: () => () => undefined, frameAnchor: () => 'ok', dispose: () => undefined } as unknown as MountManager;
const theme: ThemeReader = {
  current: (): HostTheme => ({ scheme: 'dark', tokens: { '--color-om-neutral-0': '255 255 255' }, fixedWidth: false }),
  onChange: () => () => undefined,
  anchor: () => 'ok',
  dispose: () => undefined,
};

class Rpc implements TabRpc {
  private tokens = 0;
  request(type: string): Promise<never> {
    const answer: RpcAnswer<unknown> = type === 'token.issue' ? { ok: true, payload: { actionToken: `tok_nav_${String(++this.tokens).padStart(16, '0')}`, expiresAt: Date.now() + 10_000 } } : { ok: false, error: { code: 'CG-HUB-UNAVAILABLE' } as never };
    return Promise.resolve(answer) as Promise<never>;
  }
  onEvent<T extends TabEventType>(_type: T, _listener: (payload: TabEventPayload<T>) => void): () => void {
    return () => undefined;
  }
}

async function tab(initial: readonly NavigationItem[] = OPENED) {
  const chatspace = page(initial);
  const host = createChatSpaceHostPort({ win: window, bridge: chatspace.bridge, redeem: () => Promise.resolve(true), mounts, theme, drafts: null });
  await host.ready;
  await vi.advanceTimersByTimeAsync(0);
  const clock = { now: () => Date.now(), setTimer: (ms: number, fn: () => void): unknown => setTimeout(fn, ms), clearTimer: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>) };
  const overlays = createOverlayState();
  const toasts = new FakeToasts();
  const cause = createCauseHint();
  const i18n = createI18n({ language: 'ru', now: () => Date.now() });
  let ids = 0;
  const navigation = createNavigationController({ host, rpc: new Rpc(), i18n, ids: { uuid: () => `00000000-0000-4000-8000-${(++ids).toString(16).padStart(12, '0')}` }, clock, overlays, toasts, cause });
  const quickJump = createQuickJumpController({ host, i18n, overlays, clock });
  /** A key of the person: the runner marks the cause and dispatches; then time passes. */
  const key = async (action: UiAction, ms = LIST_SETTLE_MS) => {
    cause.mark('key');
    const pending = navigation.dispatch(action);
    await vi.advanceTimersByTimeAsync(ms);
    return pending;
  };
  return { ...chatspace, host, navigation, quickJump, overlays, toasts, key };
}

const J: UiAction = { type: 'Navigate', to: { kind: 'chat-step', direction: 'next' } };
const NEXT_UNREAD: UiAction = { type: 'Navigate', to: { kind: 'next-unread' } };
const slot = (n: number): UiAction => ({ type: 'Navigate', to: { kind: 'chat-slot', slot: n } });

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('chat navigation over the real adapter', () => {
  it('[HK-037] three minutes after the chat opened another chat moved up in ChatSpace: J opens the chat that is next on screen, not the one that was next in the adapter\'s copy', async () => {
    const t = await tab();
    // The adapter read the list once, when the chat opened.
    expect([t.listReads(), t.host.listCachedChats(ACC, 10).map((item) => item.chat.platformFanId)]).toEqual([1, ['2001', '2002', '2003', '2004']]);
    await vi.advanceTimersByTimeAsync(180_000);
    t.setList(MOVED);
    // Nothing refreshed it meanwhile: no timer of ours asks ChatSpace anything.
    expect(t.listReads()).toBe(1);
    expect((await t.key(J))?.ok).toBe(true);
    expect(t.opened()).toEqual(['2004']);
    // One read of page memory for the key; the adapter reads once more by itself when the route moves.
    expect(t.listReads()).toBe(3);
  });

  it('[HK-037] ⌘U finds the chat that became unread after the adapter\'s copy was made, and ⌘3 is the third row as it is now', async () => {
    const unread = await tab();
    await vi.advanceTimersByTimeAsync(180_000);
    unread.setList(MOVED);
    expect((await unread.key(NEXT_UNREAD))?.ok).toBe(true);
    expect([unread.opened(), unread.toasts.shown]).toEqual([['2004'], []]);

    const third = await tab();
    await vi.advanceTimersByTimeAsync(180_000);
    third.setList(MOVED);
    expect((await third.key(slot(3)))?.ok).toBe(true);
    expect(third.opened()).toEqual(['2004']);

    // The copy says «unread», ChatSpace no longer does: nothing opens, «нет непрочитанных».
    const read = await tab(MOVED);
    await vi.advanceTimersByTimeAsync(180_000);
    read.setList(OPENED);
    expect(await read.key(NEXT_UNREAD)).toEqual({ ok: true, type: 'Navigate', outcome: 'noop' });
    expect([read.opened(), read.toasts.shown.map((entry) => entry.toast.title)]).toEqual([[], [{ key: 'toast.noUnread' }]]);
  });

  it('[HK-037] J, J, J in a row: each step starts from the chat the last one opened, on the list as it is', async () => {
    const t = await tab();
    await vi.advanceTimersByTimeAsync(180_000);
    t.setList(MOVED);
    for (let i = 0; i < 3; i += 1) await t.key(J, 300);
    // 2002 → 2004 → 2003 → the end of the list: the third J opens nothing.
    expect(t.opened()).toEqual(['2004', '2003']);
  });

  it('[NEW-07] the quick jump shows the list as it is a moment after it opens, and a row opens the chat written in it', async () => {
    const t = await tab();
    await vi.advanceTimersByTimeAsync(180_000);
    t.setList(MOVED);
    const rows = (): (string | null)[] => (t.quickJump.getSnapshot({ of: 'quick-jump' }) as { items: { name: string | null }[] }).items.map((item) => item.name);
    void t.navigation.dispatch({ type: 'Navigate', to: { kind: 'surface', surface: 'quick-jump', open: true } });
    await vi.advanceTimersByTimeAsync(LIST_SETTLE_MS);
    expect(rows()).toEqual(['Fan 2001', 'Fan 2002', 'Fan 2004', 'Fan 2003']);
    // ChatSpace's list moves again under the open popup; row 3 still opens Fan 2004.
    t.setList(OPENED);
    await vi.advanceTimersByTimeAsync(5000);
    const third = (t.quickJump.getSnapshot({ of: 'quick-jump' }) as { items: { action: UiAction }[] }).items[2];
    expect((await t.key(third?.action as UiAction))?.ok).toBe(true);
    expect(t.opened()).toEqual(['2004']);
  });
});
