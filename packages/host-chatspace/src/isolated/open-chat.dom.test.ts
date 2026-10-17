// The open chat's messages from ChatSpace's API through the HostPort (decision
// X51) over a scripted bridge client: only the chat on the route, one request
// for callers that ask at once, the newest page kept until the chat moves.

import type { ToMainType } from '@cg/contracts/bridge';
import type { ComposerState, HostTheme, MountPoints, OpenChatPage } from '@cg/contracts/host';
import { OPEN_CHAT_LIMITS } from '@cg/contracts/limits';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BridgeCallError, type BridgeEvent, type MainBridgeClient } from './bridge-client';
import { createChatSpaceHostPort, HostContractError } from './host-port';
import type { MountManager } from './mount';
import type { ThemeReader } from './theme';
import { loadValidation } from './validation';

const ACC = '1001';
const OPEN = '2099';
const OTHER = '2100';
const account = { host: 'chatspace' as const, hostAccountId: ACC, platform: 'onlyfans' as const, platformAccountId: '3003', username: 'one', displayName: 'One' };
const chatOf = (fan: string) => ({ host: 'chatspace' as const, hostAccountId: ACC, platformFanId: fan });
const composer: ComposerState = { chat: chatOf(OPEN), instanceId: 'c1', ready: true, hidden: false, draft: { revision: 3, provenance: 'empty' } };
const route = (fan: string, epoch: number) => ({ epoch, name: 'chat' as const, account, chat: chatOf(fan) });
const contract = { build: 'index-0000fake', missing: [], shape: [], receiptModules: {} };

const message = (id: string) => ({ platformMessageId: id, direction: 'model' as const, sentAt: '2026-10-17T06:00:00.000Z', text: '', price: 25, isFree: false, isOpened: true, mediaCount: 1, tip: false, automatic: false });
const page = (ids: readonly string[], hasMore = false): OpenChatPage => ({ capturedAt: '2026-10-17T06:00:01.000Z', items: ids.map(message), hasMore, cursor: ids.at(-1) ?? null });

const mounts = {
  update: () => undefined,
  refresh: () => undefined,
  points: (): MountPoints => ({ dock: { kind: 'in-flow', composerInstanceId: 'c1', width: 700 }, overlay: { ready: true, container: null } }),
  onChange: () => () => undefined,
  onRenewed: () => () => undefined,
  frameAnchor: () => 'ok',
  dispose: () => undefined,
} as unknown as MountManager;
const theme: ThemeReader = { current: (): HostTheme => ({ scheme: 'dark', tokens: {}, fixedWidth: false }), onChange: () => () => undefined, anchor: () => 'ok', dispose: () => undefined };
const pageWindow = { document: { querySelectorAll: () => [] }, performance: { getEntriesByType: () => [] }, location: { origin: 'https://chat.example.test' } } as unknown as Window;

type Answer = (payload: Record<string, unknown>) => unknown;

async function start(openChat: Answer) {
  const listeners = new Set<(event: BridgeEvent) => void>();
  const calls: Array<{ t: ToMainType; payload: Record<string, unknown>; timeoutMs: number | undefined }> = [];
  const answers: Partial<Record<ToMainType, Answer>> = {
    snapshot: () => ({ route: route(OPEN, 4), hostLoginEpoch: 'L1', composer, accounts: [account], contract }),
    listAccounts: () => [account],
    chatWindow: () => null,
    fan: () => null,
    listChats: () => [],
    openChatMessages: openChat,
  };
  const client: MainBridgeClient = {
    documentEpoch: 'doc1',
    probe: () => Promise.resolve({ v: 1, readyStateAtStart: 'loading', installMs: 0, wsTap: false }),
    request: (t, payload, timeoutMs) => {
      calls.push({ t, payload: payload, timeoutMs });
      const answer = answers[t];
      if (!answer) return Promise.reject(new BridgeCallError('not-ready', t));
      try {
        return Promise.resolve(answer(payload as Record<string, unknown>)) as never;
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error('failed'));
      }
    },
    onEvent: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stats: () => ({ rejected: {}, invalidAnswers: 0, invalidEvents: 0, stale: 0, late: 0, timeouts: 0, coalesced: 0 }),
    close: () => undefined,
  };
  const host = createChatSpaceHostPort({ win: pageWindow, bridge: client, redeem: () => Promise.resolve(true), mounts, theme, validation: loadValidation });
  await host.ready;
  const reads = () => calls.filter((call) => call.t === 'openChatMessages');
  return { host, reads, emit: (event: BridgeEvent) => listeners.forEach((listener) => listener(event)) };
}

afterEach(() => vi.useRealTimers());

describe('[X51] HostPort.openChatMessages — the open chat from ChatSpace’s API', () => {
  it('only the chat on the route: another chat is `not-open` and MAIN is not asked', async () => {
    const { host, reads } = await start(() => ({ ok: true, page: page(['9002']) }));
    expect(await host.openChatMessages?.(chatOf(OTHER), { limit: 50 })).toEqual({ ok: false, reason: 'not-open', status: null });
    expect(reads()).toEqual([]);
    const read = await host.openChatMessages?.(chatOf(OPEN), { limit: 50 });
    expect(read).toEqual({ ok: true, page: page(['9002']), cached: false });
    expect(reads()).toEqual([{ t: 'openChatMessages', payload: { acc: ACC, fan: OPEN, limit: 50 }, timeoutMs: OPEN_CHAT_LIMITS.bridgeMs }]);
  });

  it('callers that ask at once share one request; the newest page answers again until it is old', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    let release: (value: unknown) => void = () => undefined;
    const { host, reads } = await start(() => new Promise((resolve) => (release = resolve)));
    const first = host.openChatMessages?.(chatOf(OPEN), { limit: 50 });
    const second = host.openChatMessages?.(chatOf(OPEN), { limit: 20 });
    await Promise.resolve();
    release({ ok: true, page: page(Array.from({ length: 50 }, (_, i) => String(9100 - i)), true) });
    const [a, b] = await Promise.all([first, second]);
    expect(reads()).toHaveLength(1);
    expect(a?.ok && a.page.items).toHaveLength(50);
    // Fewer than were read: the newest ones, and the page says there is more.
    expect(b?.ok && b.page.items.map((item) => item.platformMessageId).slice(-1)).toEqual(['9081']);
    expect(b?.ok && [b.page.hasMore, b.page.cursor]).toEqual([true, '9081']);
    const cached = await host.openChatMessages?.(chatOf(OPEN), { limit: 50 });
    expect(cached?.ok && cached.cached).toBe(true);
    expect(reads()).toHaveLength(1);
    // More than the cache holds, an age of 0, or a cache older than its age: a new request.
    const more = host.openChatMessages?.(chatOf(OPEN), { limit: 60 });
    expect(reads()).toHaveLength(2);
    release({ ok: true, page: page(['9100']) });
    await more;
    void host.openChatMessages?.(chatOf(OPEN), { limit: 1, maxAgeMs: 0 });
    expect(reads()).toHaveLength(3);
    release({ ok: true, page: page(['9100']) });
    await Promise.resolve();
    vi.setSystemTime(Date.now() + OPEN_CHAT_LIMITS.cacheMs);
    void host.openChatMessages?.(chatOf(OPEN), { limit: 1 });
    expect(reads()).toHaveLength(4);
  });

  it('a change of the chat’s cache or an incoming message drops the page; a read started before them is not kept', async () => {
    const waiting: Array<(value: unknown) => void> = [];
    const release = (value: unknown): void => waiting.splice(0).forEach((resolve) => resolve(value));
    const { host, reads, emit } = await start(() => new Promise((resolve) => waiting.push(resolve)));
    const before = host.openChatMessages?.(chatOf(OPEN), { limit: 10 });
    await Promise.resolve();
    emit({ t: 'chatCache', payload: { acc: ACC, fan: OPEN } });
    // A caller after the change does not join the read that started before it.
    const after = host.openChatMessages?.(chatOf(OPEN), { limit: 10 });
    expect(reads()).toHaveLength(2);
    release({ ok: true, page: page(['9001']) });
    await Promise.all([before, after]);
    expect((await host.openChatMessages?.(chatOf(OPEN), { limit: 10 }))?.ok).toBe(true);
    const kept = await host.openChatMessages?.(chatOf(OPEN), { limit: 10 });
    expect(kept?.ok && kept.cached).toBe(true);
    emit({ t: 'incoming', payload: { acc: ACC, fan: OPEN, msgId: '9002', fromFan: true, automatic: false, tip: false, sentAt: null, socketEpoch: 1, fanSequence: 1 } });
    const count = reads().length;
    const fresh = host.openChatMessages?.(chatOf(OPEN), { limit: 10 });
    expect(reads()).toHaveLength(count + 1);
    // Another chat's message drops nothing.
    release({ ok: true, page: page(['9003']) });
    await fresh;
    emit({ t: 'incoming', payload: { acc: ACC, fan: OTHER, msgId: '9500', fromFan: true, automatic: false, tip: false, sentAt: null, socketEpoch: 1, fanSequence: 2 } });
    const again = await host.openChatMessages?.(chatOf(OPEN), { limit: 10 });
    expect(again?.ok && again.cached).toBe(true);
  });

  it('a move to another chat: the old one is `not-open`, its page gone', async () => {
    const { host, reads, emit } = await start(() => ({ ok: true, page: page(['9001']) }));
    await host.openChatMessages?.(chatOf(OPEN), { limit: 10 });
    emit({ t: 'route', payload: { route: route(OTHER, 5), hostLoginEpoch: 'L1' } });
    expect(await host.openChatMessages?.(chatOf(OPEN), { limit: 10 })).toEqual({ ok: false, reason: 'not-open', status: null });
    emit({ t: 'route', payload: { route: route(OPEN, 6), hostLoginEpoch: 'L1' } });
    const back = await host.openChatMessages?.(chatOf(OPEN), { limit: 10 });
    expect(back?.ok && back.cached).toBe(false);
    expect(reads()).toHaveLength(2);
  });

  it('older pages go by their cursor and are never kept; failures come back as reasons, never as throws', async () => {
    let answer: () => unknown = () => ({ ok: true, page: page(['8001']) });
    const { host, reads } = await start(() => answer());
    await host.openChatMessages?.(chatOf(OPEN), { limit: 10, cursor: '9001' });
    await host.openChatMessages?.(chatOf(OPEN), { limit: 10, cursor: '9001' });
    expect(reads().map((call) => call.payload)).toEqual([
      { acc: ACC, fan: OPEN, limit: 10, cursor: '9001' },
      { acc: ACC, fan: OPEN, limit: 10, cursor: '9001' },
    ]);
    answer = () => ({ ok: false, failure: 'http', status: 429 });
    expect(await host.openChatMessages?.(chatOf(OPEN), { limit: 10 })).toEqual({ ok: false, reason: 'http', status: 429 });
    answer = () => {
      throw new BridgeCallError('identity-mismatch', 'openChatMessages');
    };
    expect(await host.openChatMessages?.(chatOf(OPEN), { limit: 10 })).toEqual({ ok: false, reason: 'not-open', status: null });
    answer = () => {
      throw new BridgeCallError('timeout', 'openChatMessages');
    };
    expect(await host.openChatMessages?.(chatOf(OPEN), { limit: 10 })).toEqual({ ok: false, reason: 'unavailable', status: null });
    // A failure is not kept: the next call asks again.
    answer = () => ({ ok: true, page: page(['9001']) });
    expect((await host.openChatMessages?.(chatOf(OPEN), { limit: 10 }))?.ok).toBe(true);
    await expect(host.openChatMessages?.(chatOf(OPEN), { limit: 0 })).rejects.toBeInstanceOf(HostContractError);
    await expect(host.openChatMessages?.(chatOf(OPEN), { limit: 10, cursor: 'old' })).rejects.toBeInstanceOf(HostContractError);
  });
});
