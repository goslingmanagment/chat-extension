// 2026-10-26: the palette ⌘K on Fansly. Its chats are the hub's rows, each with the chat the hub names for it (the
// group, where a chat has an id of its own); «Идут сейчас» are the generations of this site's chats; «Новые» of the hub
// are asked only where the site's «Новые» are that list. A chosen chat opens the way the site's board opens a fan's
// when the site has no navigation of ours. ChatSpace's handles, requests and route stay as they were.

import { describe, expect, it, vi } from 'vitest';

import { type ChatRef, type HostAccount, type HostKind, type HostPort, type NavigationReceipt, type UiAction } from '@cg/contracts';
import { chatHandle, createNavigationController, createOverlayState, createPaletteController, type TabRpc } from '@cg/core/application/navigation';
import { createActionCatalog } from '@cg/core/domain/hotkeys';
import { createI18n } from '@cg/core/domain/i18n';

import { FakeClock, sequentialIds, settle } from './support/clock';
import { CHATSPACE as CHATSPACE_SLICE, FANSLY as FANSLY_SLICE } from './support/features';
import { FANSLY, NOW_MS, WORLD, fanslyAccount } from './support/world';

const i18n = createI18n({ language: 'ru', now: () => NOW_MS, timeZone: 'Europe/Moscow' });
const OTHER_FAN = '7105';
const OTHER_GROUP = '7206';
const chatspaceAccount: HostAccount = { host: 'chatspace', hostAccountId: WORLD.pages.one.hostAccountId, platform: 'onlyfans', platformAccountId: WORLD.pages.one.platformAccountId, username: 'model_one', displayName: 'Model One' };

/** The host port as the palette and the navigation read it: one account on screen, no list of its own loaded. */
function hostOf(kind: HostKind, account: HostAccount): HostPort & { readonly navigations: unknown[] } {
  const navigations: unknown[] = [];
  const snapshot = { kind, identity: null, route: { epoch: 1, name: 'other', account, chat: null }, composer: null, accounts: [account], contract: { capabilities: { chatList: { state: kind === 'chatspace' ? 'on' : 'off' }, navigate: { state: 'on' } } } };
  return {
    kind,
    navigations,
    current: () => snapshot,
    subscribe: () => () => undefined,
    listCachedChats: () => [],
    fan: () => null,
    navigate: (intent: unknown) => {
      navigations.push(intent);
      return Promise.resolve({ state: 'navigated', routeEpoch: 2, insert: null });
    },
  } as unknown as HostPort & { readonly navigations: unknown[] };
}

/** The background as the palette asks it: the account's page, its queue, its board, «Новые», the running generations. */
function background(account: HostAccount, conversation: (fan: string) => string | null) {
  const asked: string[] = [];
  const answers: Record<string, unknown> = {
    'binding.resolve': { binding: { pageId: 13 } },
    'spenders.queue': {
      items: [
        { fanRef: FANSLY.fan, conversationRef: conversation(FANSLY.fan), username: 'fan_one', displayName: 'Fan One', lifetimeGrossMills: 120_000, lastFanMessageAt: '2026-10-03T09:00:00.000Z' },
        // An older hub names no chat for the fan.
        { fanRef: OTHER_FAN, username: 'fan_two', displayName: 'Fan Two', lifetimeGrossMills: 60_000, lastFanMessageAt: '2026-10-03T08:00:00.000Z' },
      ],
    },
    'spenders.board': { items: [{ fan: { platformUserId: OTHER_FAN, displayName: 'Fan Two', username: 'fan_two' }, metrics: { lifetime: { scopeGrossAmountMills: 60_000 } }, conversation: { platformConversationId: conversation(OTHER_FAN) } }] },
    'newcomers.list': { items: [] },
    'op.list': {
      ops: [
        { opId: 'op-here', feature: 'reply', state: 'streaming', startedAt: NOW_MS, target: { chat: { host: account.host, hostAccountId: account.hostAccountId, platformFanId: FANSLY.fan }, conversationRef: conversation(FANSLY.fan) ?? FANSLY.fan } },
        { opId: 'op-elsewhere', feature: 'fix', state: 'streaming', startedAt: NOW_MS, target: { chat: { host: account.host === 'chatspace' ? 'fansly-web' : 'chatspace', hostAccountId: '1001', platformFanId: '2002' }, conversationRef: '2002' } },
      ],
      truncated: false,
    },
    'token.issue': { actionToken: 'tok_0000000000000071', expiresAt: NOW_MS + 10_000 },
  };
  const rpc = {
    request: (type: string) => {
      asked.push(type);
      const payload = answers[type];
      return Promise.resolve(payload === undefined ? { ok: false, error: { code: 'CG-HUB-UNAVAILABLE' } } : { ok: true, payload });
    },
    onEvent: () => () => undefined,
  } as unknown as TabRpc;
  return { rpc, asked };
}

async function openPalette(kind: HostKind, account: HostAccount, conversation: (fan: string) => string | null, features: typeof FANSLY_SLICE) {
  const host = hostOf(kind, account);
  const { rpc, asked } = background(account, conversation);
  const overlays = createOverlayState();
  const palette = createPaletteController({ host, rpc, i18n, catalog: createActionCatalog('mac'), clock: new FakeClock(NOW_MS), overlays, dock: { get: () => null, subscribe: () => () => undefined }, features });
  overlays.set('palette', true);
  await settle();
  const view = () => palette.getSnapshot({ of: 'palette' }) as { readonly groups: readonly { readonly id: string; readonly items: readonly { readonly action: UiAction }[] }[]; readonly footer: { readonly key: string } | null };
  const handles = (group: string): unknown[] => (view().groups.find((candidate) => candidate.id === group)?.items ?? []).map((item) => (item.action.type === 'Navigate' && item.action.to.kind === 'chat' ? item.action.to.targetHandle : item.action.type));
  return { palette, asked, overlays, view, handles };
}

describe('2026-10-26: the palette on Fansly', () => {
  it('names each hub row’s chat by its group, shows this site’s generations alone, and never asks for «Новые» of the hub', async () => {
    const groups: Record<string, string> = { [FANSLY.fan]: FANSLY.group, [OTHER_FAN]: OTHER_GROUP };
    const p = await openPalette('fansly-web', fanslyAccount, (fan) => groups[fan] ?? null, FANSLY_SLICE);
    // «Ждут ответа»: the queue's group where it names one; an older hub's row stays the fan's (the host finds its group).
    expect(p.handles('waiting')).toEqual([`nav.chat.${FANSLY.creator}.${FANSLY.fan}.${FANSLY.group}`, `nav.chat.${FANSLY.creator}.${OTHER_FAN}`]);
    expect(p.handles('running')).toEqual([`nav.chat.${FANSLY.creator}.${FANSLY.fan}.${FANSLY.group}`]);

    await p.palette.dispatch({ type: 'Search', list: 'palette', query: 'fan two' });
    await settle();
    // The board's row carries its group.
    expect(p.handles('chats')).toEqual([`nav.chat.${FANSLY.creator}.${OTHER_FAN}.${OTHER_GROUP}`]);
    expect(p.asked).not.toContain('newcomers.list');
    expect(p.view().footer?.key).toBe('palette.foot.spenders');
  });

  it('ChatSpace: the handles stay the fan’s and «Новые» of the hub are looked in, as before', async () => {
    const p = await openPalette('chatspace', chatspaceAccount, (fan) => fan, CHATSPACE_SLICE);
    const account = chatspaceAccount.hostAccountId;
    expect(p.handles('waiting')).toEqual([`nav.chat.${account}.${FANSLY.fan}`, `nav.chat.${account}.${OTHER_FAN}`]);
    expect(p.handles('running')).toEqual([`nav.chat.${account}.${FANSLY.fan}`]);
    await p.palette.dispatch({ type: 'Search', list: 'palette', query: 'fan two' });
    await settle();
    expect(p.handles('chats')).toEqual([`nav.chat.${account}.${OTHER_FAN}`]);
    expect(p.asked).toContain('newcomers.list');
    expect(p.view().footer?.key).toBe('palette.foot.chats');
  });
});

describe('2026-10-26: a chat chosen in the palette', () => {
  /** The board's navigator, as a test sees it: navigated unless told otherwise. */
  const boardOf = () => vi.fn((_chat: ChatRef, _conversationRef: string | undefined): Promise<NavigationReceipt> => Promise.resolve({ state: 'navigated', routeEpoch: 2, insert: null }));
  const chosen = (account: string, fan: string, group?: string): UiAction => ({ type: 'Navigate', to: { kind: 'chat', targetHandle: chatHandle({ hostAccountId: account, platformFanId: fan }, group) } });

  it('on a site without our navigation opens the way the board does, never with a token of our navigation', async () => {
    const host = hostOf('fansly-web', fanslyAccount);
    const { rpc, asked } = background(fanslyAccount, () => null);
    const overlays = createOverlayState();
    const board = boardOf();
    const navigation = createNavigationController({ host, rpc, i18n, ids: sequentialIds(0x700), clock: new FakeClock(NOW_MS), overlays, features: FANSLY_SLICE, board });
    overlays.set('palette', true);
    expect(await navigation.dispatch(chosen(FANSLY.creator, FANSLY.fan, FANSLY.group))).toMatchObject({ ok: true, outcome: 'opened' });
    expect(board).toHaveBeenCalledWith({ host: 'fansly-web', hostAccountId: FANSLY.creator, platformFanId: FANSLY.fan }, FANSLY.group);
    expect(asked).not.toContain('token.issue');
    expect(overlays.isOpen('palette')).toBe(false);
    // The board refuses (its switch is off on the page): the palette stays, the code comes back.
    overlays.set('palette', true);
    board.mockResolvedValueOnce({ state: 'failed', code: 'CG-FEATURE-DISABLED', insert: null });
    expect(await navigation.dispatch(chosen(FANSLY.creator, OTHER_FAN))).toMatchObject({ ok: false, code: 'CG-FEATURE-DISABLED' });
    expect(board).toHaveBeenLastCalledWith({ host: 'fansly-web', hostAccountId: FANSLY.creator, platformFanId: OTHER_FAN }, undefined);
    expect(overlays.isOpen('palette')).toBe(true);
  });

  it('ChatSpace: our navigation, its token and its router, as before', async () => {
    const host = hostOf('chatspace', chatspaceAccount);
    const { rpc, asked } = background(chatspaceAccount, (fan) => fan);
    const overlays = createOverlayState();
    const board = boardOf();
    const navigation = createNavigationController({ host, rpc, i18n, ids: sequentialIds(0x700), clock: new FakeClock(NOW_MS), overlays, features: CHATSPACE_SLICE, board });
    overlays.set('palette', true);
    expect(await navigation.dispatch(chosen(chatspaceAccount.hostAccountId, FANSLY.fan))).toMatchObject({ ok: true, outcome: 'opened' });
    expect(board).not.toHaveBeenCalled();
    expect(asked).toEqual(['token.issue']);
    expect(host.navigations).toMatchObject([{ target: { hostAccountId: chatspaceAccount.hostAccountId, platformFanId: FANSLY.fan } }]);
  });
});
