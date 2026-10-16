// R20 P8a (FS-IDN-6, docs/project-unite/architecture.md §7.23): on Fansly a
// chat is a group whose id is not its fan's, and no surface of the shared code
// puts the fan's id where the group belongs. F6a and F6b carry the group from
// where it is known — the route (the dock, the fan panel), the list that
// resolved the fan (a preview), the operation's target (the toast,
// «Открыть и вставить»). What P8a adds is the other half: where the group is
// NOT known, nothing of that chat is asked at all — no feed, no generation, no
// navigation by the fan's id — and the person is told why. The Spenders board
// is the first list that names the group: the hub's own row
// (`conversation.platformConversationId`). On ChatSpace the conversation is
// the fan, as before (its requests are pinned as recorded on main elsewhere).

import { describe, expect, it, vi } from 'vitest';

import { type ChatRef, type HubRouteKey, type PersonaCatalog, type SettingsV1, type SpenderListItem, type SpendersPage, type Surface } from '@cg/contracts';
import { Surfaces, fanHandle, type BoardSwitch, type ChatNavigator, type PageContextPort, type PageContextState, type PreviewDirectory, type PreviewTargetInfo } from '@cg/core/application/boards';
import { createFanPanelController } from '@cg/core/application/fanpanel';
import { createPreviewController } from '@cg/core/application/preview';
import { createSpendersController, type SpendersSource } from '@cg/core/application/spenders';
import { createI18n } from '@cg/core/domain/i18n';
import { createFakeCatalog, ctxOf } from '@cg/testing/app-client';
import { FakeHostPort, memory, startSnapshot } from '@cg/testing/host';
import { BOOTSTRAP_PILOT_PAGES, SCENARIO_DATA, meta, resolveHubErrorReference, spenderRow } from '@cg/testing/hub';

import { settingsWithPersona } from './support/ai-background';
import { readyHarness } from './support/ai-harness';
import { BoardsBackground } from './support/boards-background';
import { FakeClock, sequentialIds, settle } from './support/clock';
import { FANSLY as FANSLY_SLICE, featuresOfBoth } from './support/features';
import { FANSLY, NOW_MS, WORLD, binding, fanslyAccount, fanslyBinding, fanslyChat, session, uuid, withFanslyPage } from './support/world';

const BOOTSTRAP = withFanslyPage(BOOTSTRAP_PILOT_PAGES);
const PERSONA = { key: WORLD.persona.key, definitionId: WORLD.persona.definitionId };
const SETTINGS: SettingsV1 = settingsWithPersona({
  personas: { scope: { hubOrigin: WORLD.hubOrigin, userId: WORLD.user.userId }, byPageId: { [String(WORLD.pages.one.pageId)]: PERSONA, [String(WORLD.pages.fansly.pageId)]: PERSONA } },
});
const CATALOG: PersonaCatalog = { personas: [{ key: WORLD.persona.key, displayName: 'Model Two', version: 1, definitionId: WORLD.persona.definitionId, status: 'active' }] };
const TAB = uuid(0xa1);
const FANSLY_PAGE = WORLD.pages.fansly.pageId;
const CHATSPACE_PAGE = WORLD.pages.one.pageId;
const i18n = createI18n({ language: 'ru', now: () => NOW_MS, timeZone: 'Europe/Moscow' });

/** A second fan of the Fansly page whose chat no list and no hub row knows. */
const STRANGER = '7109';

function contextOf(state: Pick<PageContextState, 'account' | 'binding'>, pageId: number): PageContextPort {
  const ready: PageContextState = {
    phase: 'ready',
    blocker: null,
    session,
    bootstrap: BOOTSTRAP,
    page: BOOTSTRAP.pages.find((page) => page.pageId === pageId) ?? null,
    settings: SETTINGS,
    persona: { ...PERSONA, label: null },
    epoch: 1,
    ...state,
  };
  return { current: () => ready, subscribe: () => () => undefined, refresh: () => Promise.resolve(), dispose: () => undefined };
}
const fanslyContext = contextOf({ account: fanslyAccount, binding: fanslyBinding }, FANSLY_PAGE);
const chatspaceAccount = { host: 'chatspace', hostAccountId: WORLD.pages.one.hostAccountId, platform: 'onlyfans', platformAccountId: WORLD.pages.one.platformAccountId, username: null, displayName: null } as const;
const chatspaceContext = contextOf({ account: chatspaceAccount, binding }, CHATSPACE_PAGE);

/** A navigator that only says what it was asked to open. */
function recordingNavigator(): ChatNavigator & { readonly opened: { readonly chat: ChatRef; readonly surface: Surface; readonly boards: readonly BoardSwitch[]; readonly conversationRef: string | undefined }[] } {
  const opened: { chat: ChatRef; surface: Surface; boards: readonly BoardSwitch[]; conversationRef: string | undefined }[] = [];
  return {
    opened,
    open(chat, surface, switches, conversationRef) {
      opened.push({ chat, surface, boards: switches, conversationRef });
      return Promise.resolve({ state: 'navigated', routeEpoch: 2, insert: null });
    },
  };
}

/** The hub's Spenders board of one page: its rows, one route; the tiers are not this test's subject. */
function spendersHub(rows: readonly SpenderListItem[]) {
  return (route: HubRouteKey) => {
    if (route !== 'spenders') return Promise.resolve({ status: 404, body: { error: 'not_found' } });
    const body: SpendersPage = {
      scope: { kind: 'page', platform: 'fansly', pageCount: 1, page: null, model: null },
      period: { timeZone: 'Europe/Moscow', fromBusinessDate: '2026-09-04', toBusinessDateInclusive: '2026-10-03', asOf: '2026-10-03T10:00:00.000Z' },
      diagnostics: SCENARIO_DATA.diagnostics,
      items: [...rows],
      limit: 200,
      offset: 0,
      total: rows.length,
    };
    return Promise.resolve({ status: 200, body });
  };
}
/** A row of the hub's board for this fan, naming this conversation of its chat (null — the hub's capture knows none). */
const rowOf = (rank: number, fan: string, platform: 'onlyfans' | 'fansly', conversation: string | null): SpenderListItem => {
  const base = spenderRow(rank);
  return { ...base, fan: { ...base.fan, platform, platformUserId: fan }, conversation: { ...base.conversation, platformConversationId: conversation } };
};

describe('[host:fansly] R20 P8a: the Spenders board names the chat of a Fansly fan from the hub’s own row', () => {
  async function board(context: PageContextPort, rows: readonly SpenderListItem[], source?: SpendersSource) {
    const clock = new FakeClock(NOW_MS);
    const bg = new BoardsBackground({ clock, call: spendersHub(rows), session, bootstrap: BOOTSTRAP, settings: SETTINGS, catalog: CATALOG, tab: TAB, instanceId: WORLD.instanceId, features: featuresOfBoth });
    const navigator = recordingNavigator();
    const spenders = createSpendersController({ rpc: bg.rpc, i18n, clock, context, surfaces: new Surfaces(), navigator, timeZone: 'Europe/Moscow', statistics: false, ...(source === undefined ? {} : { source }) });
    spenders.subscribe({ of: 'spenders.board' }, () => undefined);
    await spenders.dispatch({ type: 'Navigate', to: { kind: 'surface', surface: 'spenders', open: true } });
    await settle(20);
    return { spenders, navigator, bg };
  }

  it.each(['Hub alias', FANSLY.fan])('[FS-SPD-1] [SP-012] [SP-032] [SP-040] hub alias precedes display/username; known names and groups ask nothing of the site; no statistics or queue on Fansly (%s)', async (alias) => {
    const row = rowOf(0, FANSLY.fan, 'fansly', FANSLY.group);
    const source = { names: vi.fn(() => Promise.resolve([])), cached: vi.fn(() => Promise.resolve(null)), resolve: vi.fn(() => Promise.resolve(null)) };
    const { spenders, bg } = await board(fanslyContext, [{ ...row, fan: { ...row.fan, pageAlias: alias, displayName: 'Display', username: 'username' } }], source);
    const handle = fanHandle('spenders', FANSLY_PAGE, FANSLY.fan);
    await spenders.directory.prepare?.(handle);
    expect(spenders.directory.resolve(handle)?.name).toBe(alias);
    expect(source.names).not.toHaveBeenCalled();
    expect(source.cached).not.toHaveBeenCalled();
    expect(source.resolve).not.toHaveBeenCalled();
    expect(spenders.getSnapshot({ of: 'spenders.board' }).statistics).toBe(false);
    expect(spenders.command('toggle-stats', null)).toBeNull();
    await spenders.dispatch({ type: 'SetSpendersFilter', filter: 'waiting' });
    expect(bg.requests.filter(({ type }) => type === 'spenders.stats' || type === 'spenders.queue')).toEqual([]);
    spenders.dispose();
  });

  it('[SP-037] passive cache supplies a missing group; only an open-chat click can search; the alias never becomes the search term', async () => {
    const row = rowOf(0, FANSLY.fan, 'fansly', null);
    const source = { names: vi.fn(() => Promise.resolve([])), cached: vi.fn(() => Promise.resolve(null as string | null)), resolve: vi.fn(() => Promise.resolve(FANSLY.group)) };
    const { spenders, navigator } = await board(fanslyContext, [{ ...row, fan: { ...row.fan, pageAlias: 'Alias', displayName: 'Search me', username: 'handle' } }], source);
    const handle = fanHandle('spenders', FANSLY_PAGE, FANSLY.fan);
    await spenders.directory.prepare?.(handle);
    expect(source.resolve).not.toHaveBeenCalled();
    await spenders.dispatch({ type: 'Navigate', to: { kind: 'chat', targetHandle: handle } });
    expect(source.resolve).toHaveBeenCalledWith(fanslyBinding.platformAccountId, { fanRef: FANSLY.fan, displayName: 'Search me', username: 'handle' });
    expect(navigator.opened[0]?.conversationRef).toBe(FANSLY.group);
    expect(spenders.directory.resolve(handle)?.conversationRef).toBe(FANSLY.group);
    spenders.dispose();
    source.cached.mockResolvedValue(FANSLY.group);
    source.resolve.mockClear();
    const cached = await board(fanslyContext, [row], source);
    await cached.spenders.directory.prepare?.(handle);
    expect(cached.spenders.directory.resolve(handle)?.conversationRef).toBe(FANSLY.group);
    expect(source.resolve).not.toHaveBeenCalled();
    cached.spenders.dispose();
  });

  it('an unavailable page context refuses before any passive lookup or site request', async () => {
    let state = fanslyContext.current();
    const context = { ...fanslyContext, current: () => state };
    const source = { names: vi.fn(() => Promise.resolve([])), cached: vi.fn(() => Promise.resolve(null)), resolve: vi.fn(() => Promise.resolve(FANSLY.group)) };
    const { spenders, navigator } = await board(context, [rowOf(0, FANSLY.fan, 'fansly', null)], source);
    state = { ...state, phase: 'blocked', blocker: { code: 'CG-RUNTIME-UNREACHABLE' } };
    expect(await spenders.dispatch({ type: 'Navigate', to: { kind: 'chat', targetHandle: fanHandle('spenders', FANSLY_PAGE, FANSLY.fan) } })).toMatchObject({ ok: false, code: 'CG-RUNTIME-UNREACHABLE' });
    expect(source.cached).not.toHaveBeenCalled();
    expect(source.resolve).not.toHaveBeenCalled();
    expect(navigator.opened).toEqual([]);
    spenders.dispose();
  });

  it('closing the board while a group lookup waits prevents its late navigation', async () => {
    let finish!: (group: string) => void;
    const source: SpendersSource = { names: () => Promise.resolve([]), cached: () => Promise.resolve(null), resolve: () => new Promise((resolve) => { finish = resolve; }) };
    const { spenders, navigator } = await board(fanslyContext, [rowOf(0, FANSLY.fan, 'fansly', null)], source);
    const opening = spenders.dispatch({ type: 'Navigate', to: { kind: 'chat', targetHandle: fanHandle('spenders', FANSLY_PAGE, FANSLY.fan) } });
    await settle(3);
    await spenders.dispatch({ type: 'Navigate', to: { kind: 'surface', surface: 'spenders', open: false } });
    finish(FANSLY.group);
    expect(await opening).toMatchObject({ ok: false, code: 'CG-CONTEXT-CHANGED' });
    expect(navigator.opened).toEqual([]);
    spenders.dispose();
  });

  it('a row with the hub’s group gives the preview that group; a row without one gives none — never the fan’s id; «Открыть чат» opens the group or nothing', async () => {
    const { spenders, navigator } = await board(fanslyContext, [rowOf(0, FANSLY.fan, 'fansly', FANSLY.group), rowOf(1, STRANGER, 'fansly', null)]);
    const known = fanHandle('spenders', FANSLY_PAGE, FANSLY.fan);
    const stranger = fanHandle('spenders', FANSLY_PAGE, STRANGER);
    expect(spenders.directory.resolve(known)).toMatchObject({ fanRef: FANSLY.fan, conversationRef: FANSLY.group });
    const unknown = spenders.directory.resolve(stranger);
    expect(unknown?.fanRef).toBe(STRANGER);
    expect(unknown !== null && 'conversationRef' in unknown).toBe(false);

    expect(await spenders.dispatch({ type: 'Navigate', to: { kind: 'chat', targetHandle: known } })).toMatchObject({ ok: true, outcome: 'opened' });
    expect(await spenders.dispatch({ type: 'Navigate', to: { kind: 'chat', targetHandle: stranger } })).toMatchObject({ ok: false, code: 'CG-DATA-NOT-READY' });
    expect(navigator.opened).toEqual([{ chat: fanslyChat, surface: 'preview', boards: ['spenders'], conversationRef: FANSLY.group }]);
    spenders.dispose();
  });

  it('[host:chatspace] on ChatSpace the conversation is the fan: a row’s own conversation id is never read, and the row opens the fan as before', async () => {
    const fan = WORLD.fan;
    const { spenders, navigator } = await board(chatspaceContext, [rowOf(0, fan, 'onlyfans', '5000')]);
    const handle = fanHandle('spenders', CHATSPACE_PAGE, fan);
    const info = spenders.directory.resolve(handle);
    expect(info?.fanRef).toBe(fan);
    expect(info !== null && 'conversationRef' in info).toBe(false);
    expect(await spenders.dispatch({ type: 'Navigate', to: { kind: 'chat', targetHandle: handle } })).toMatchObject({ ok: true, outcome: 'opened' });
    expect(navigator.opened.map((open) => open.conversationRef)).toEqual([undefined]);
    spenders.dispose();
  });
});

describe('[host:fansly] R20 P8a: a preview of a Fansly fan whose chat its list does not know asks nothing of that chat', () => {
  const infoOf = (conversationRef: string | null): PreviewTargetInfo => ({
    handle: fanHandle('spenders', FANSLY_PAGE, FANSLY.fan),
    source: 'spenders',
    pageId: FANSLY_PAGE,
    fanRef: FANSLY.fan,
    ...(conversationRef === null ? {} : { conversationRef }),
    name: 'Fan of Fansly',
    username: null,
    lifetime: null,
    period30: null,
    weWroteAt: null,
    fanWroteAt: null,
    newcomer: null,
  });

  it('no feed by the fan’s id, every action off with its reason, «Открыть чат» off; once the list names the group, the card reads it', async () => {
    const asked: { readonly route: string; readonly request: unknown }[] = [];
    const call = (route: HubRouteKey, request: unknown) => {
      asked.push({ route, request });
      return Promise.resolve({ status: 404, body: { error: 'not_found' } });
    };
    const clock = new FakeClock(NOW_MS);
    const bg = new BoardsBackground({ clock, call, session, bootstrap: BOOTSTRAP, settings: SETTINGS, catalog: CATALOG, tab: TAB, instanceId: WORLD.instanceId, features: featuresOfBoth });
    const host = new FakeHostPort({ start: startSnapshot, memory, checkpoint: null, answers: {}, timeline: [] }, NOW_MS);
    let info = infoOf(null);
    const directory: PreviewDirectory = { resolve: (handle) => (handle === info.handle ? info : null), neighbours: () => ({ previous: null, next: null }), subscribe: () => () => undefined };
    const navigator = recordingNavigator();
    const surfaces = new Surfaces();
    const controller = createPreviewController({
      rpc: bg.rpc,
      host,
      i18n,
      clock,
      ids: sequentialIds(0x9000),
      context: fanslyContext,
      surfaces,
      navigator,
      directories: { spenders: directory, newcomers: null, palette: null },
      greeting: null,
      sender: null,
      drafts: null,
      clipboard: null,
      notifier: null,
    });
    controller.subscribe({ of: 'preview', from: 'spenders' }, () => undefined);
    await controller.dispatch({ type: 'OpenPreview', targetHandle: info.handle });
    await settle(12);

    const shown = controller.getSnapshot({ of: 'preview', from: 'spenders' });
    // The card says what is missing, with «Повторить»: the hub was not asked for a feed at all.
    expect(shown.view).toMatchObject({ s: 'error', error: { code: 'CG-DATA-NOT-READY' }, retry: { type: 'RefreshArchive', targetHandle: info.handle } });
    for (const action of Object.values(shown.bar.actions)) expect(action).toMatchObject({ enabled: false, reason: { id: 'conversation-unknown', code: 'CG-DATA-NOT-READY' } });
    expect(shown.openChat).toMatchObject({ enabled: false, reason: { id: 'conversation-unknown' } });
    expect(await controller.dispatch({ type: 'Generate', targetHandle: info.handle, feature: 'reply', options: {} })).toMatchObject({ ok: false, code: 'CG-DATA-NOT-READY' });
    await controller.dispatch({ type: 'RefreshArchive', targetHandle: info.handle });
    await settle(12);
    expect(bg.requests.filter((request) => request.type === 'feed.read' || request.type === 'op.start')).toEqual([]);
    expect(asked.filter((call) => call.route === 'clientConversationFeed' || call.route === 'aiFeatureStream')).toEqual([]);
    // The fan's card is the fan's own (§11.1): it is read by the fan, as it may be — at the open and at «Повторить».
    const cards = bg.requests.filter((request) => request.type === 'fan.card').map((request) => request.payload);
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) expect(card).toEqual({ pageId: FANSLY_PAGE, fanRef: FANSLY.fan, period: '30d' });
    expect(navigator.opened).toEqual([]);

    // The list resolved the fan's group meanwhile: the next read names it, and the actions come on.
    info = infoOf(FANSLY.group);
    await controller.dispatch({ type: 'RefreshArchive', targetHandle: info.handle });
    await settle(12);
    expect(bg.requests.filter((request) => request.type === 'feed.read').map((request) => request.payload)).toMatchObject([{ pageId: FANSLY_PAGE, fanRef: FANSLY.fan, conversationRef: FANSLY.group }]);
    const after = controller.getSnapshot({ of: 'preview', from: 'spenders' });
    expect(after.bar.actions.reply?.reason?.id).not.toBe('conversation-unknown');
    expect(after.openChat.enabled).toBe(true);
    controller.dispose();
    host.dispose();
  });
});

describe('[host:fansly] R20 P8a: a Fansly route that names no group opens no chat for the dock and reads no archive for the fan panel', () => {
  it('the dock: a chat of the route without its group is no chat — no target, nothing to start; a ChatSpace chat is its fan as before', async () => {
    const fake = new FakeHostPort({ start: startSnapshot, memory, checkpoint: null, answers: {}, timeline: [] });
    const h = await readyHarness(
      { baseHost: fake, memory, catalog: createFakeCatalog(ctxOf({ now: NOW_MS })), bootstrap: BOOTSTRAP, resolve: resolveHubErrorReference, meta: (feature) => meta(feature as Parameters<typeof meta>[0]) },
      { settings: SETTINGS, features: FANSLY_SLICE, served: featuresOfBoth },
    );
    const window = memory.chatWindows[0];
    if (window === undefined) throw new Error('no chat window in the host world');
    h.host.setWindow({ ...window, chat: fanslyChat }, fanslyChat);
    h.host.openChat(fanslyChat, fanslyAccount);
    await h.settle();
    expect(h.ai.workspace.situation().chat).toBeNull();
    expect(h.ai.workspace.situation().ready).toBeNull();
    h.host.openChat(fanslyChat, fanslyAccount, FANSLY.group);
    await h.settle();
    expect(h.ai.workspace.situation().chat?.conversationRef).toBe(FANSLY.group);
  });

  it('the fan panel: the card and the dossier are the fan’s; the archive is not read by the fan’s id in the group’s place', async () => {
    const clock = new FakeClock(NOW_MS);
    const call = () => Promise.resolve({ status: 404, body: { error: 'not_found' } });
    const bg = new BoardsBackground({ clock, call, session, bootstrap: BOOTSTRAP, settings: SETTINGS, catalog: CATALOG, tab: TAB, instanceId: WORLD.instanceId, features: featuresOfBoth });
    const host = new FakeHostPort({ start: { ...startSnapshot, route: { ...startSnapshot.route, name: 'chat', chat: fanslyChat, account: fanslyAccount } }, memory, checkpoint: null, answers: {}, timeline: [] }, NOW_MS);
    const panel = createFanPanelController({ rpc: bg.rpc, host, i18n, clock, context: fanslyContext, surfaces: new Surfaces() });
    panel.subscribe({ of: 'fan-panel' }, () => undefined);
    await panel.dispatch({ type: 'Navigate', to: { kind: 'surface', surface: 'fan-panel', open: true } });
    await settle(12);
    expect(bg.requests.filter((request) => ['feed.read', 'fan.card', 'fan.dossier'].includes(request.type))).toEqual([
      { type: 'fan.card', payload: { pageId: FANSLY_PAGE, fanRef: FANSLY.fan, period: 'lifetime' } },
      { type: 'fan.card', payload: { pageId: FANSLY_PAGE, fanRef: FANSLY.fan, period: '30d' } },
      { type: 'fan.dossier', payload: { pageId: FANSLY_PAGE, fanRef: FANSLY.fan } },
    ]);
    panel.dispose();
    host.dispose();
  });
});
