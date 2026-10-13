// R20 F6a: the site and the conversation travel through shared code from where
// they are known — the site from the binding, the conversation from the route
// (the dock) or from the list that resolved the fan (a preview, a row, a card),
// and from the operation's target afterwards (a toast, «Открыть и вставить»,
// «Открыть чат для проверки») — never as a ChatSpace literal and never as «the
// conversation is the fan». A Fansly chat has a group id that is not the fan's
// id on purpose: every surface must carry both, each in its own place. What
// ChatSpace sends stays byte for byte as recorded on main (the «R20 F6a,
// ChatSpace» tests next to each surface's own tests, support/chatspace-recorded.ts).

import { describe, expect, it } from 'vitest';

import { TAB_EVENTS, type ActionReceipt, type BackgroundToast, type ChatRef, type HubFrame, type NavigationIntent, type PersonaCatalog, type SettingsV1, type Surface, type UiAction } from '@cg/contracts';
import {
  createChatNavigator,
  fanHandle,
  Surfaces,
  type BoardSwitch,
  type ChatNavigator,
  type PageContextPort,
  type PageContextState,
  type PreviewDirectory,
  type PreviewTargetInfo,
  type TabRpc,
} from '@cg/core/application/boards';
import { chatHandle, createNavigationController, createOverlayState } from '@cg/core/application/navigation';
import { createNewcomersController } from '@cg/core/application/newcomers';
import { createPreviewController, type PreviewController } from '@cg/core/application/preview';
import { createShellController } from '@cg/core/application/shell';
import { createSpendersController } from '@cg/core/application/spenders';
import { createI18n } from '@cg/core/domain/i18n';
import { buildOpenAndInsert } from '@cg/core/domain/insert';
import { createFakeCatalog, ctxOf } from '@cg/testing/app-client';
import { DOCUMENT, FakeHostPort, memory, startSnapshot, type HostAnswers } from '@cg/testing/host';
import { BOOTSTRAP_PILOT_PAGES, contextFrame, meta, resolveHubErrorReference } from '@cg/testing/hub';

import { settingsWithPersona } from './support/ai-background';
import { readyHarness } from './support/ai-harness';
import { BoardsBackground } from './support/boards-background';
import { FakeClock, sequentialIds, settle } from './support/clock';
import { FANSLY as FANSLY_SLICE, featuresOfBoth } from './support/features';
import { type ScriptStep } from './support/fake-hub';
import { FANSLY, NOW_MS, WORLD, fanslyAccount, fanslyBinding, fanslyChat, fanslyTarget, session, uuid, withFanslyPage } from './support/world';

const BOOTSTRAP = withFanslyPage(BOOTSTRAP_PILOT_PAGES);
const PERSONA = { key: WORLD.persona.key, definitionId: WORLD.persona.definitionId };
const SETTINGS: SettingsV1 = settingsWithPersona({
  personas: { scope: { hubOrigin: WORLD.hubOrigin, userId: WORLD.user.userId }, byPageId: { [String(WORLD.pages.one.pageId)]: PERSONA, [String(WORLD.pages.fansly.pageId)]: PERSONA } },
});

describe('R20 F6a, Fansly: the dock — the conversation comes from the route', () => {
  it('a Reply in a Fansly chat starts on the group as the conversation and the fan as the fan, and the hub gets both', async () => {
    const fake = new FakeHostPort({ start: startSnapshot, memory, checkpoint: null, answers: {}, timeline: [] });
    const h = await readyHarness(
      { baseHost: fake, memory, catalog: createFakeCatalog(ctxOf({ now: NOW_MS })), bootstrap: BOOTSTRAP, resolve: resolveHubErrorReference, meta: (feature) => meta(feature as Parameters<typeof meta>[0]) },
      // The tab runs Fansly's slice of the feature manifest, the background serves both sites.
      { settings: SETTINGS, features: FANSLY_SLICE, served: featuresOfBoth },
    );
    const window = memory.chatWindows[0];
    if (window === undefined) throw new Error('no chat window in the host world');
    h.host.setWindow({ ...window, chat: fanslyChat }, fanslyChat);
    h.host.openChat(fanslyChat, fanslyAccount, FANSLY.group);
    await h.settle();
    expect(h.ai.workspace.situation().chat?.conversationRef).toBe(FANSLY.group);
    expect(h.ai.workspace.situation().ready?.target).toEqual(fanslyTarget);

    h.script(h.streamOf('fast-reply', ['hey you']));
    expect(await h.generate('reply')).toMatchObject({ ok: true });
    expect(h.bg.callsOf('op.start')).toMatchObject([{ target: fanslyTarget }]);
    expect(h.bg.hub.streams.map((request) => request.body)).toMatchObject([{ platform: 'fansly', pageLabel: WORLD.pages.fansly.pageLabel, conversationRef: FANSLY.group, fanRef: FANSLY.fan }]);
  });
});

// ── the boards: a preview, a Spenders row, a card of «Новые» ────────────────

const TAB = uuid(0xa1);
const CATALOG: PersonaCatalog = { personas: [{ key: WORLD.persona.key, displayName: 'Model Two', version: 1, definitionId: WORLD.persona.definitionId, status: 'active' }] };
const FANSLY_PAGE = BOOTSTRAP.pages.find((page) => page.pageId === WORLD.pages.fansly.pageId) ?? null;
const READY: PageContextState = {
  phase: 'ready',
  blocker: null,
  session,
  bootstrap: BOOTSTRAP,
  account: fanslyAccount,
  binding: fanslyBinding,
  page: FANSLY_PAGE,
  settings: SETTINGS,
  persona: { ...PERSONA, label: null },
  epoch: 1,
};
/** The boards of a tab on the Fansly page, read and settled: what they show is not this test's subject. */
const context: PageContextPort = { current: () => READY, subscribe: () => () => undefined, refresh: () => Promise.resolve(), dispose: () => undefined };
const i18n = createI18n({ language: 'ru', now: () => NOW_MS, timeZone: 'Europe/Moscow' });
/** The hub behind the background: the fan's archive and card are not read here (a Fansly page reads `platform_unsupported` on the hub until R20's hub work). */
const hubCall = () => Promise.resolve({ status: 409, body: { error: 'client_feature_disabled', reason: 'platform_unsupported' } });

/** A list that resolved its Fansly fan to a group (FS-SPD-2): the info a preview opens with. */
const infoOf = (source: PreviewTargetInfo['source'], conversationRef: string | undefined = FANSLY.group): PreviewTargetInfo => ({
  handle: fanHandle(source, WORLD.pages.fansly.pageId, FANSLY.fan),
  source,
  pageId: WORLD.pages.fansly.pageId,
  fanRef: FANSLY.fan,
  ...(conversationRef === undefined ? {} : { conversationRef }),
  name: 'Fan of Fansly',
  username: null,
  lifetime: null,
  period30: null,
  weWroteAt: null,
  fanWroteAt: null,
  newcomer: null,
});
const directoryOf = (info: PreviewTargetInfo): PreviewDirectory => ({
  resolve: (handle) => (handle === info.handle ? info : null),
  neighbours: () => ({ previous: null, next: null }),
  subscribe: () => () => undefined,
});

function boards(answers: HostAnswers = {}) {
  const clock = new FakeClock(NOW_MS);
  const bg = new BoardsBackground({ clock, call: hubCall, session, bootstrap: BOOTSTRAP, settings: SETTINGS, catalog: CATALOG, tab: TAB, instanceId: WORLD.instanceId, features: featuresOfBoth });
  const host = new FakeHostPort({ start: startSnapshot, memory, checkpoint: null, answers, timeline: [] }, NOW_MS);
  const ids = sequentialIds(0x9000);
  const surfaces = new Surfaces();
  const navigator = createChatNavigator({ rpc: bg.rpc, host, ids, context });
  return { clock, bg, host, ids, surfaces, navigator };
}

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

async function dispatchTo(controller: { dispatch(action: UiAction): Promise<ActionReceipt> | null }, action: UiAction): Promise<ActionReceipt> {
  const receipt = controller.dispatch(action);
  if (receipt === null) throw new Error(`${action.type} was not taken`);
  const answered = await receipt;
  await settle(12);
  return answered;
}

describe('R20 F6a, Fansly: a preview — the conversation comes from the list that resolved the fan', () => {
  function preview(directories: { spenders?: PreviewDirectory; palette?: PreviewDirectory }, answers: HostAnswers = {}) {
    const world = boards(answers);
    const controller: PreviewController = createPreviewController({
      rpc: world.bg.rpc,
      host: world.host,
      i18n,
      clock: world.clock,
      ids: world.ids,
      context,
      surfaces: world.surfaces,
      navigator: world.navigator,
      directories: { spenders: directories.spenders ?? null, newcomers: null, palette: directories.palette ?? null },
      greeting: null,
      sender: null,
      drafts: null,
      clipboard: null,
      notifier: null,
    });
    controller.subscribe({ of: 'preview', from: 'spenders' }, () => undefined);
    return { ...world, controller };
  }

  /** The scheduler's first operation answers one part and ends. */
  function scriptReply(bg: BoardsBackground, text: string): string {
    const opId = uuid(0x100);
    const generationRef = uuid(0x200);
    const frame = (f: HubFrame, afterMs?: number): ScriptStep => (afterMs === undefined ? { kind: 'frame', frame: f } : { kind: 'frame', frame: f, afterMs });
    bg.streams.streamScript.push({
      kind: 'stream',
      steps: [
        frame(meta('fast-reply', { clientRequestId: opId, requestId: generationRef })),
        frame(contextFrame({ generationRef, knownFanMessages: [], live: { status: 'not_sent', accepted: 0, rejected: 0 } })),
        frame({ type: 'content_delta', text }, 20),
        frame({ type: 'done', stopReason: 'end_turn' }),
      ],
    });
    return opId;
  }

  it('Generate starts on the group the list resolved and the fan, the hub gets both; «Открыть и вставить» opens that group', async () => {
    const info = infoOf('spenders');
    const applied = { state: 'navigated', routeEpoch: 6, insert: { state: 'applied', draftRevision: 1, draftDigest: 'feedbeef0000aaaa', ms: 12 } } as const;
    const p = preview({ spenders: directoryOf(info) }, { navigate: [applied] });
    expect(await dispatchTo(p.controller, { type: 'OpenPreview', targetHandle: info.handle })).toMatchObject({ ok: true });
    const opId = scriptReply(p.bg, 'hey you');
    expect(await dispatchTo(p.controller, { type: 'Generate', targetHandle: info.handle, feature: 'reply', options: {} })).toMatchObject({ ok: true, outcome: 'started', opId });
    await p.clock.advance(200);
    await settle(12);

    const starts = p.bg.requests.filter((request) => request.type === 'op.start').map((request) => request.payload);
    expect(starts).toMatchObject([{ surface: 'preview', target: fanslyTarget }]);
    expect(p.bg.streams.streams.map((request) => request.body)).toMatchObject([{ platform: 'fansly', conversationRef: FANSLY.group, fanRef: FANSLY.fan }]);
    // Its reads by chat name the Fansly chat, not a ChatSpace one.
    expect(p.bg.requests.filter((request) => request.type === 'op.list').map((request) => request.payload)).toContainEqual({ scope: 'tab', chatKey: `fansly-web:${FANSLY.creator}:${FANSLY.fan}` });

    expect(await dispatchTo(p.controller, { type: 'OpenAndInsertPart', operationId: opId, part: 0 })).toMatchObject({ ok: true, outcome: 'opened' });
    const [open] = p.host.calls.navigations;
    expect(open?.target).toEqual({ hostAccountId: FANSLY.creator, platformFanId: FANSLY.fan, conversationRef: FANSLY.group });
    expect(open?.thenInsert).toMatchObject({ target: fanslyChat, text: 'hey you', expected: { kind: 'deferred', documentEpoch: DOCUMENT } });
  });

  it('a fan the list has no group for yet starts on the fan as before, and a group resolved later is taken at the click', async () => {
    let info = infoOf('spenders', undefined);
    const directory: PreviewDirectory = { ...directoryOf(info), resolve: (handle) => (handle === info.handle ? info : null) };
    const p = preview({ spenders: directory });
    await dispatchTo(p.controller, { type: 'OpenPreview', targetHandle: info.handle });
    // The list resolved the fan's group after the preview opened: the next build of the card reads it.
    info = infoOf('spenders');
    p.controller.getSnapshot({ of: 'preview', from: 'spenders' });
    scriptReply(p.bg, 'hey you');
    await dispatchTo(p.controller, { type: 'Generate', targetHandle: info.handle, feature: 'reply', options: {} });
    expect(p.bg.requests.filter((request) => request.type === 'op.start').map((request) => request.payload)).toMatchObject([{ target: { conversationRef: FANSLY.group, fanRef: FANSLY.fan } }]);
  });

  it('«Открыть чат» of a palette fan opens the group its list resolved', async () => {
    const info = infoOf('palette', FANSLY.otherGroup);
    const p = preview({ palette: directoryOf(info) });
    expect(await dispatchTo(p.controller, { type: 'Navigate', to: { kind: 'chat', targetHandle: info.handle } })).toMatchObject({ ok: true, outcome: 'opened' });
    expect(p.host.calls.navigations.map((intent) => intent.target)).toEqual([{ hostAccountId: FANSLY.creator, platformFanId: FANSLY.fan, conversationRef: FANSLY.otherGroup }]);
  });
});

describe('R20 F6a, Fansly: a board row or card opens the fan of the binding\'s site', () => {
  it('a Spenders row and a card of «Новые» open the chat on the Fansly host of the binding, not ChatSpace', async () => {
    const world = boards();
    const navigator = recordingNavigator();
    const spenders = createSpendersController({ rpc: world.bg.rpc, i18n, clock: world.clock, context, surfaces: world.surfaces, navigator, timeZone: 'Europe/Moscow' });
    const newcomers = createNewcomersController({ rpc: world.bg.rpc, host: world.host, i18n, clock: world.clock, context, surfaces: world.surfaces, navigator, connectivity: null, random: () => 0.5 });
    expect(await dispatchTo(spenders, { type: 'Navigate', to: { kind: 'chat', targetHandle: fanHandle('spenders', WORLD.pages.fansly.pageId, FANSLY.fan) } })).toMatchObject({ ok: true, outcome: 'opened' });
    expect(await dispatchTo(newcomers, { type: 'Navigate', to: { kind: 'chat', targetHandle: fanHandle('newcomers', WORLD.pages.fansly.pageId, FANSLY.fan) } })).toMatchObject({ ok: true, outcome: 'opened' });
    expect(navigator.opened.map((open) => open.chat)).toEqual([fanslyChat, fanslyChat]);
    spenders.dispose();
    newcomers.dispose();
  });

  it('ChatNavigator.open names the conversation only when it is not the fan', async () => {
    const world = boards();
    const opened = async (conversationRef: string | undefined): Promise<NavigationIntent['target'] | undefined> => {
      const receipt = await world.navigator.open(fanslyChat, 'preview', ['spenders'], conversationRef);
      expect(receipt.state).toBe('navigated');
      return world.host.calls.navigations.at(-1)?.target;
    };
    expect(await opened(FANSLY.group)).toEqual({ hostAccountId: FANSLY.creator, platformFanId: FANSLY.fan, conversationRef: FANSLY.group });
    expect(await opened(undefined)).toEqual({ hostAccountId: FANSLY.creator, platformFanId: FANSLY.fan });
    expect(await opened(FANSLY.fan)).toEqual({ hostAccountId: FANSLY.creator, platformFanId: FANSLY.fan });
  });
});

describe('R20 F6a, Fansly: «Открыть и вставить» and a toast\'s «Открыть чат» open the operation\'s own conversation', () => {
  it('buildOpenAndInsert names the target\'s group beside the fan, and nothing when the conversation is the fan', () => {
    const insert = {
      intentId: uuid(0x31),
      operationId: uuid(0x32),
      part: { index: 0 },
      target: fanslyChat,
      expected: { kind: 'deferred', documentEpoch: DOCUMENT },
      mode: 'replace',
      text: 'hey you',
      confirmationId: null,
      createdAt: NOW_MS,
      expiresAt: NOW_MS + 20_000,
    } as const;
    const cause = { kind: 'click', actionToken: 'tok_0000000000000031' } as const;
    const withGroup = buildOpenAndInsert({ intentId: uuid(0x33), cause, insert, conversationRef: FANSLY.group });
    expect(withGroup.ok && withGroup.intent.target).toEqual({ hostAccountId: FANSLY.creator, platformFanId: FANSLY.fan, conversationRef: FANSLY.group });
    const ofFan = buildOpenAndInsert({ intentId: uuid(0x33), cause, insert, conversationRef: FANSLY.fan });
    expect(ofFan.ok && ofFan.intent.target).toEqual({ hostAccountId: FANSLY.creator, platformFanId: FANSLY.fan });
  });

  it('the toast\'s chat and group become the chat handle, and its «Открыть чат» navigates to the group', async () => {
    const host = new FakeHostPort({ start: startSnapshot, memory, checkpoint: null, answers: {}, timeline: [] }, NOW_MS);
    const clock = new FakeClock(NOW_MS);
    const rpc: Pick<TabRpc, 'request'> = {
      request: (type) => Promise.resolve((type === 'token.issue' ? { ok: true, payload: { actionToken: 'tok_0000000000000041', expiresAt: NOW_MS + 10_000 } } : { ok: false, error: { code: 'CG-HUB-UNAVAILABLE' } }) as never),
    };
    const navigation = createNavigationController({ host, rpc, i18n, ids: sequentialIds(0x700), clock, overlays: createOverlayState() });
    let emit: (payload: { readonly toast: BackgroundToast }) => void = () => undefined;
    const shell = createShellController({
      rpc: {
        onEvent: (_type, listener) => {
          emit = listener;
          return () => undefined;
        },
      },
      i18n,
      clock,
      tab: { reload: () => undefined, reloadSurface: () => false, openSettings: () => Promise.resolve(false) },
      chatHandle,
    });
    shell.subscribe({ of: 'toasts' }, () => undefined);
    const toast: BackgroundToast = { toastId: uuid(0x51), kind: 'success', scope: 'op.ready', opId: uuid(0x100), feature: 'reply', chat: fanslyChat, conversationRef: FANSLY.group, fanLabel: 'Fan of Fansly' };
    expect(TAB_EVENTS.toast.payload.safeParse({ toast }).success).toBe(true);
    emit({ toast });
    const action = shell.getSnapshot({ of: 'toasts' }).toasts[0]?.actions[0]?.action;
    expect(action).toEqual({ type: 'Navigate', to: { kind: 'chat', targetHandle: `nav.chat.${FANSLY.creator}.${FANSLY.fan}.${FANSLY.group}` } });
    if (action === undefined) throw new Error('no «Открыть чат» on the toast');
    expect(await navigation.dispatch(action)).toMatchObject({ ok: true, outcome: 'opened' });
    expect(host.calls.navigations.map((intent) => intent.target)).toEqual([{ hostAccountId: FANSLY.creator, platformFanId: FANSLY.fan, conversationRef: FANSLY.group }]);
  });
});
