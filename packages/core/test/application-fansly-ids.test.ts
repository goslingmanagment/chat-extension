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

import { describe, expect, it } from 'vitest';

import { type ChatRef, type HubRouteKey, type PersonaCatalog, type SettingsV1, type SpenderListItem, type SpendersPage, type Surface } from '@cg/contracts';
import { Surfaces, fanHandle, type BoardSwitch, type ChatNavigator, type PageContextPort, type PageContextState, type PreviewDirectory, type PreviewTargetInfo } from '@cg/core/application/boards';
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
import { FANSLY, NOW_MS, WORLD, fanslyAccount, fanslyBinding, fanslyChat, session, uuid, withFanslyPage } from './support/world';

const BOOTSTRAP = withFanslyPage(BOOTSTRAP_PILOT_PAGES);
const PERSONA = { key: WORLD.persona.key, definitionId: WORLD.persona.definitionId };
const SETTINGS: SettingsV1 = settingsWithPersona({
  personas: { scope: { hubOrigin: WORLD.hubOrigin, userId: WORLD.user.userId }, byPageId: { [String(WORLD.pages.one.pageId)]: PERSONA, [String(WORLD.pages.fansly.pageId)]: PERSONA } },
});
const CATALOG: PersonaCatalog = { personas: [{ key: WORLD.persona.key, displayName: 'Model Two', version: 1, definitionId: WORLD.persona.definitionId, status: 'active' }] };
const TAB = uuid(0xa1);
const FANSLY_PAGE = WORLD.pages.fansly.pageId;
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
});
