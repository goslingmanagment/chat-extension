// R20 F6b: the tab's reads by conversation (docs/project-unite/architecture.md
// §11.1, hub HF-10). On Fansly a chat is a group whose id is not the fan's:
// the recaps (their status, the read, the dossier save — the tab's and the
// background saver's) and the archive feed (the Coach's head, a preview's
// pages, the fan panel's coverage) name the group beside the fan; the card
// and the dossier name the fan alone. Two chats of two fans never cross: each
// read names its own pair, and what one chat read is not shown for the other.
// What ChatSpace sends stays as recorded on main («R20 F6b, ChatSpace» tests
// next to each surface's own, support/chatspace-recorded.ts).

import { describe, expect, it } from 'vitest';

import { type ChatRef, type FeedPage, type PersonaCatalog, type RecapBody, type SettingsV1 } from '@cg/contracts';
import { Surfaces, fanHandle, type PageContextPort, type PageContextState, type PreviewDirectory, type PreviewTargetInfo } from '@cg/core/application/boards';
import { createPreviewController } from '@cg/core/application/preview';
import { createI18n } from '@cg/core/domain/i18n';
import { createFakeCatalog, ctxOf } from '@cg/testing/app-client';
import { FakeHostPort, memory, startSnapshot } from '@cg/testing/host';
import { BOOTSTRAP_PILOT_PAGES, meta, resolveHubErrorReference } from '@cg/testing/hub';

import { settingsWithPersona } from './support/ai-background';
import { readyHarness, type Harness } from './support/ai-harness';
import { BoardsBackground } from './support/boards-background';
import { FakeClock, sequentialIds, settle } from './support/clock';
import { FANSLY as FANSLY_SLICE, featuresOfBoth } from './support/features';
import { FANSLY, NOW_MS, WORLD, fanslyAccount, fanslyBinding, fanslyChat, session, uuid, withFanslyPage } from './support/world';

const BOOTSTRAP = withFanslyPage(BOOTSTRAP_PILOT_PAGES);
const PERSONA = { key: WORLD.persona.key, definitionId: WORLD.persona.definitionId };
const SETTINGS: SettingsV1 = settingsWithPersona({
  personas: { scope: { hubOrigin: WORLD.hubOrigin, userId: WORLD.user.userId }, byPageId: { [String(WORLD.pages.one.pageId)]: PERSONA, [String(WORLD.pages.fansly.pageId)]: PERSONA } },
});
const PAGE_ID = WORLD.pages.fansly.pageId;

/** Two chats of two fans on the Fansly page: no id of one is an id of the other, and no group is its fan. */
const A = { chat: fanslyChat, fan: FANSLY.fan, group: FANSLY.group } as const;
const B = { chat: { ...fanslyChat, platformFanId: '7105' }, fan: '7105', group: FANSLY.otherGroup } as const;

// ── the dock: recaps and the Coach's archive head ──────────────────────────

async function fanslyDock(): Promise<Harness> {
  const fake = new FakeHostPort({ start: startSnapshot, memory, checkpoint: null, answers: {}, timeline: [] });
  const h = await readyHarness(
    { baseHost: fake, memory, catalog: createFakeCatalog(ctxOf({ now: NOW_MS })), bootstrap: BOOTSTRAP, resolve: resolveHubErrorReference, meta: (feature) => meta(feature as Parameters<typeof meta>[0]) },
    { settings: SETTINGS, features: FANSLY_SLICE, served: featuresOfBoth },
  );
  h.mount({ of: 'recap.view' });
  h.mount({ of: 'recap.picker' });
  h.mount({ of: 'coach' });
  return h;
}

/** Opens a Fansly chat at its group, as the route of `/messages/<group>` names it. */
async function openFansly(h: Harness, chat: { readonly chat: ChatRef; readonly group: string }): Promise<void> {
  const window = memory.chatWindows[0];
  if (window === undefined) throw new Error('no chat window in the host world');
  h.host.setWindow({ ...window, chat: chat.chat }, chat.chat);
  h.host.openChat(chat.chat, fanslyAccount, chat.group);
  await h.settle();
}

const FULL_TEXT = ['## Кто он', 'Марк, 34, Остин.'].join('\n');
const hubRecap = (over: Partial<RecapBody> = {}): RecapBody => ({
  generationRef: uuid(0x700),
  generatedAt: '2026-10-03T09:59:20.000Z',
  personaDefinitionId: WORLD.persona.definitionId,
  coverage: { transcriptCoverage: 'full-history', requestedCount: 3000, keptCount: 40 },
  text: FULL_TEXT,
  ...over,
});

describe('[host:fansly] R20 F6b: the recaps of a Fansly chat are read by its group and its fan', () => {

  it('two chats of two fans do not cross: each reads its own pair, and a recap of one is never the other’s', async () => {
    const h = await fanslyDock();
    h.bg.sharedRecaps = { full: hubRecap(), short: null, fullSavedToProfile: true };
    await openFansly(h, A);
    await h.generate('recap');
    await h.settle();
    expect(h.recapView()).toMatchObject({ markdown: FULL_TEXT });
    // The hub has nothing for the second chat.
    h.bg.sharedRecaps = { full: null, short: null, fullSavedToProfile: false };
    await openFansly(h, B);
    await h.generate('recap');
    await h.settle();
    expect(h.bg.callsOf('recap.read')).toEqual([
      { pageId: PAGE_ID, fanRef: A.fan, conversationRef: A.group, personaDefinitionId: PERSONA.definitionId },
      { pageId: PAGE_ID, fanRef: B.fan, conversationRef: B.group, personaDefinitionId: PERSONA.definitionId },
    ]);
    expect(h.recapView()).toMatchObject({ markdown: null, view: { s: 'empty' } });
    expect(h.recapPicker().slots).toEqual({ short: null, full: null });
    // Back in the first chat its copy is still its own.
    await openFansly(h, A);
    expect(h.recapPicker().slots.full).not.toBeNull();
  });
});

// ── the boards: a preview and the fan panel ────────────────────────────────

const TAB = uuid(0xa1);
const CATALOG: PersonaCatalog = { personas: [{ key: WORLD.persona.key, displayName: 'Model Two', version: 1, definitionId: WORLD.persona.definitionId, status: 'active' }] };
const READY: PageContextState = {
  phase: 'ready',
  blocker: null,
  session,
  bootstrap: BOOTSTRAP,
  account: fanslyAccount,
  binding: fanslyBinding,
  page: BOOTSTRAP.pages.find((page) => page.pageId === PAGE_ID) ?? null,
  settings: SETTINGS,
  persona: { ...PERSONA, label: null },
  epoch: 1,
};
const context: PageContextPort = { current: () => READY, subscribe: () => () => undefined, refresh: () => Promise.resolve(), dispose: () => undefined };
const i18n = createI18n({ language: 'ru', now: () => NOW_MS, timeZone: 'Europe/Moscow' });

/** The hub behind the background, as HF-10 answers a Fansly page: a feed of the group asked for, two pages long. */
function feedHub() {
  const asked: unknown[] = [];
  const call = (route: string, request: unknown) => {
    asked.push({ route, request });
    if (route !== 'clientConversationFeed') return Promise.resolve({ status: 404, body: { error: 'not_found' } });
    const query = request as { readonly fanRef: string; readonly conversationRef?: string; readonly cursor?: string };
    const body: FeedPage = {
      target: { pageLabel: WORLD.pages.fansly.pageLabel, fanRef: query.fanRef, ...(query.conversationRef === undefined ? {} : { conversationRef: query.conversationRef }) },
      source: 'archive',
      snapshotRevision: 'snap-1',
      asOf: '2026-10-03T10:00:00.000Z',
      coverage: 'complete',
      head: null,
      newestKnownAt: null,
      nextOlderCursor: query.cursor === undefined ? `older-of-${query.conversationRef ?? query.fanRef}` : null,
      items: [{ messageId: `${query.conversationRef ?? query.fanRef}0${query.cursor === undefined ? 1 : 2}`, at: null, sender: 'fan', text: 'hey', automatic: null, deleted: false, tipMills: null, priceMills: null, attachmentLabels: [] }],
      summary: null,
    };
    return Promise.resolve({ status: 200, body });
  };
  return { asked, call };
}

const infoOf = (chat: { readonly fan: string; readonly group: string }): PreviewTargetInfo => ({
  handle: fanHandle('spenders', PAGE_ID, chat.fan),
  source: 'spenders',
  pageId: PAGE_ID,
  fanRef: chat.fan,
  conversationRef: chat.group,
  name: `Fan ${chat.fan}`,
  username: null,
  lifetime: null,
  period30: null,
  weWroteAt: null,
  fanWroteAt: null,
  newcomer: null,
});

describe('[host:fansly] R20 F6b: a preview reads the group its list resolved; its walk keeps that group', () => {
  it('two previews of two fans: each first page and older page names its own group and fan, and shows its own rows', async () => {
    const hub = feedHub();
    const clock = new FakeClock(NOW_MS);
    const bg = new BoardsBackground({ clock, call: hub.call, session, bootstrap: BOOTSTRAP, settings: SETTINGS, catalog: CATALOG, tab: TAB, instanceId: WORLD.instanceId, features: featuresOfBoth });
    const host = new FakeHostPort({ start: startSnapshot, memory, checkpoint: null, answers: {}, timeline: [] }, NOW_MS);
    const infos = [infoOf(A), infoOf(B)];
    const directory: PreviewDirectory = { resolve: (handle) => infos.find((info) => info.handle === handle) ?? null, neighbours: () => ({ previous: null, next: null }), subscribe: () => () => undefined };
    const controller = createPreviewController({
      rpc: bg.rpc,
      host,
      i18n,
      clock,
      ids: sequentialIds(0x9000),
      context,
      surfaces: new Surfaces(),
      navigator: { open: () => Promise.resolve({ state: 'navigated', routeEpoch: 2, insert: null }) },
      directories: { spenders: directory, newcomers: null, palette: null, outreach: null },
      greeting: null,
      sender: null,
      drafts: null,
      clipboard: null,
      notifier: null,
    });
    controller.subscribe({ of: 'preview', from: 'spenders' }, () => undefined);
    for (const info of infos) {
      await controller.dispatch({ type: 'OpenPreview', targetHandle: info.handle });
      await settle(12);
      await controller.dispatch({ type: 'LoadOlder', targetHandle: info.handle });
      await settle(12);
      const shown = controller.getSnapshot({ of: 'preview', from: 'spenders' });
      const group = info.conversationRef ?? '';
      expect(shown.feed.items.map((item) => item.id).sort(), info.fanRef).toEqual([`${group}01`, `${group}02`]);
    }
    const reads = bg.requests.filter((request) => request.type === 'feed.read').map((request) => request.payload as Record<string, unknown>);
    expect(reads.map(({ fanRef, conversationRef, cursor }) => ({ fanRef, conversationRef, cursor }))).toEqual([
      { fanRef: A.fan, conversationRef: A.group, cursor: null },
      { fanRef: A.fan, conversationRef: A.group, cursor: `older-of-${A.group}` },
      { fanRef: B.fan, conversationRef: B.group, cursor: null },
      { fanRef: B.fan, conversationRef: B.group, cursor: `older-of-${B.group}` },
    ]);
    // The card the preview reads is the fan's alone (§11.1).
    expect(bg.requests.filter((request) => request.type === 'fan.card').map((request) => request.payload)).toEqual([
      { pageId: PAGE_ID, fanRef: A.fan, period: '30d' },
      { pageId: PAGE_ID, fanRef: B.fan, period: '30d' },
    ]);
    controller.dispose();
    host.dispose();
  });
});

describe('[host:fansly] R20 P8a: a preview never reuses another group’s archive or cursor', () => {
  async function preview() {
    const hub = feedHub();
    const clock = new FakeClock(NOW_MS);
    const bg = new BoardsBackground({ clock, call: hub.call, session, bootstrap: BOOTSTRAP, settings: SETTINGS, catalog: CATALOG, tab: TAB, instanceId: WORLD.instanceId, features: featuresOfBoth });
    const host = new FakeHostPort({ start: startSnapshot, memory, checkpoint: null, answers: {}, timeline: [] }, NOW_MS);
    let info = infoOf(A);
    const handle = info.handle;
    const directory: PreviewDirectory = { resolve: () => info, neighbours: () => ({ previous: null, next: null }), subscribe: () => () => undefined };
    const controller = createPreviewController({
      rpc: bg.rpc, host, i18n, clock, ids: sequentialIds(0x9000), context, surfaces: new Surfaces(),
      navigator: { open: () => Promise.resolve({ state: 'navigated', routeEpoch: 2, insert: null }) },
      directories: { spenders: directory, newcomers: null, palette: null, outreach: null },
      greeting: null, sender: null, drafts: null, clipboard: null, notifier: null,
    });
    controller.subscribe({ of: 'preview', from: 'spenders' }, () => undefined);
    const open = () => controller.dispatch({ type: 'OpenPreview', targetHandle: handle });
    await open();
    await settle(12);
    const shown = () => controller.getSnapshot({ of: 'preview', from: 'spenders' });
    expect(shown().feed.items.map((item) => item.id)).toEqual([`${A.group}01`]);
    return {
      bg, shown, open,
      close: () => controller.dispatch({ type: 'Navigate', to: { kind: 'surface', surface: 'preview', open: false } }),
      refresh: () => controller.dispatch({ type: 'RefreshArchive', targetHandle: handle }),
      older: () => controller.dispatch({ type: 'LoadOlder', targetHandle: handle }),
      reads: () => bg.requests.filter((request) => request.type === 'feed.read').map((request) => request.payload),
      group: (group: string | null) => {
        const { conversationRef: _previous, ...fan } = info;
        info = group === null ? fan : { ...fan, conversationRef: group };
      },
      dispose: () => { controller.dispose(); host.dispose(); },
    };
  }

  it.each(['success', 'failure'] as const)('P1: reopening the same fan with a different group drops cached rows and cursor before the first page’s %s', async (outcome) => {
    const h = await preview();
    await h.close();
    h.group(B.group);
    const release = h.bg.hold('feed.read');
    await h.open();
    await settle(12);
    expect.soft(h.shown().feed).toMatchObject({ items: [], hasOlder: false });
    await h.older();
    expect.soft(h.reads()).toMatchObject([
      { fanRef: A.fan, conversationRef: A.group, cursor: null },
      { fanRef: A.fan, conversationRef: B.group, cursor: null },
    ]);
    if (outcome === 'failure') h.bg.failNext('feed.read', { code: 'CG-HUB-UNAVAILABLE' });
    release();
    await settle(12);
    if (outcome === 'success') {
      expect(h.shown().feed.items.map((item) => item.id)).toEqual([`${B.group}01`]);
      await h.older();
      expect(h.reads().at(-1)).toMatchObject({ fanRef: A.fan, conversationRef: B.group, cursor: `older-of-${B.group}` });
    } else {
      expect(h.shown().feed).toMatchObject({ items: [], hasOlder: false });
      expect(h.shown().view).toMatchObject({ s: 'offline', error: { code: 'CG-HUB-UNAVAILABLE' } });
    }
    h.dispose();
  });
});
