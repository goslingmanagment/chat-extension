// The vault reads of a preview's media picker through the HostPort (decision
// X53) over a scripted bridge client: each kind is one `media` request with its
// own deadline, MAIN's failure is the answer's reason, a dead bridge is
// `unavailable`, and an answer of another kind is `invalid`.

import type { ToMainType } from '@cg/contracts/bridge';
import type { ComposerState, HostTheme, MountPoints } from '@cg/contracts/host';
import { MEDIA_LIMITS } from '@cg/contracts/limits';
import { describe, expect, it } from 'vitest';

import { BridgeCallError, type BridgeEvent, type MainBridgeClient } from './bridge-client';
import { createChatSpaceHostPort } from './host-port';
import type { MountManager } from './mount';
import type { ThemeReader } from './theme';
import { loadValidation } from './validation';

const ACC = '1001';
const OPEN = '2099';
const account = { host: 'chatspace' as const, hostAccountId: ACC, platform: 'onlyfans' as const, platformAccountId: '3003', username: 'one', displayName: 'One' };
const chatOf = (fan: string) => ({ host: 'chatspace' as const, hostAccountId: ACC, platformFanId: fan });
const composer: ComposerState = { chat: chatOf(OPEN), instanceId: 'c1', ready: true, hidden: false, draft: { revision: 3, provenance: 'empty' } };
const route = (fan: string, epoch: number) => ({ epoch, name: 'chat' as const, account, chat: chatOf(fan) });
const contract = { build: 'index-0000fake', missing: [], shape: [], receiptModules: {} };


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

async function start(media: Answer) {
  const listeners = new Set<(event: BridgeEvent) => void>();
  const calls: Array<{ t: ToMainType; payload: Record<string, unknown>; timeoutMs: number | undefined }> = [];
  const answers: Partial<Record<ToMainType, Answer>> = {
    snapshot: () => ({ route: route(OPEN, 4), hostLoginEpoch: 'L1', composer, accounts: [account], contract }),
    listAccounts: () => [account],
    chatWindow: () => null,
    fan: () => null,
    listChats: () => [],
    media,
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
  const reads = () => calls.filter((call) => call.t === 'media');
  return { host, reads, emit: (event: BridgeEvent) => listeners.forEach((listener) => listener(event)) };
}

const folder = { id: '880002', name: 'SET', kind: 'custom', photos: 14, videos: 0, other: 0 };

describe('[X53] HostPort.media — the vault of a preview’s media picker from ChatSpace’s API', () => {
  it('each read is one `media` request of its kind, with the media deadline; the answer is MAIN’s', async () => {
    const { host, reads } = await start((payload) =>
      payload['of'] === 'folders' ? { ok: true, value: { items: [folder], hasMore: false } } : payload['of'] === 'tags' ? { ok: true, value: { users: ['77'], guests: [] } } : payload['of'] === 'states' ? { ok: true, value: [] } : { ok: true, value: { items: [], hasMore: false } },
    );
    expect(await host.media?.folders(ACC, 0)).toEqual({ ok: true, value: { items: [folder], hasMore: false } });
    expect(await host.media?.items(ACC, 'all', 40)).toEqual({ ok: true, value: { items: [], hasMore: false } });
    expect(await host.media?.fanStates(chatOf('2200'), ['11'])).toEqual({ ok: true, value: [] });
    expect(await host.media?.tags(ACC, ['11', '12'])).toEqual({ ok: true, value: { users: ['77'], guests: [] } });
    expect(reads()).toEqual([
      { t: 'media', payload: { of: 'folders', acc: ACC, offset: 0 }, timeoutMs: MEDIA_LIMITS.bridgeMs },
      { t: 'media', payload: { of: 'items', acc: ACC, folder: 'all', offset: 40 }, timeoutMs: MEDIA_LIMITS.bridgeMs },
      { t: 'media', payload: { of: 'states', acc: ACC, fan: '2200', ids: ['11'] }, timeoutMs: MEDIA_LIMITS.bridgeMs },
      { t: 'media', payload: { of: 'tags', acc: ACC, ids: ['11', '12'] }, timeoutMs: MEDIA_LIMITS.bridgeMs },
    ]);
  });

  it('MAIN’s failure is the reason; no answer is `unavailable`; an answer of another kind is `invalid` — never a throw', async () => {
    const failing = await start(() => ({ ok: false, failure: 'session', status: null }));
    expect(await failing.host.media?.folders(ACC, 0)).toEqual({ ok: false, reason: 'session', status: null });
    const dead = await start(() => {
      throw new BridgeCallError('timeout', 'media');
    });
    expect(await dead.host.media?.items(ACC, 'all', 0)).toEqual({ ok: false, reason: 'unavailable', status: null });
    const other = await start(() => ({ ok: true, value: { users: [], guests: [] } }));
    expect(await other.host.media?.folders(ACC, 0)).toEqual({ ok: false, reason: 'invalid', status: null });
  });
});
