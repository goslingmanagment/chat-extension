// R20 P8c, part B: Recap, Review and Coach on Fansly (docs/project-unite/spec.md FS-AI-1, FS-TAIL-1, FS-TAIL-8,
// FS-TAIL-10; architecture §5.8, §7.24, §7.25, §12). Each of them starts through Fansly's policy as every start does —
// MAIN's snapshot as its proof, no page text — and:
// - the verdict over what it made: the analysis surfaces draw their own models, so the shared result's mark reaches
//   them through their own fields (`RecapViewVM.stale`, `ReviewVM.stale`, `CoachTurnVM.stale`), with «Ещё раз»;
//   what the fan wrote after it stays their archive-lag line, never a mark;
// - the deep window: the person's depth above 3000 from Fansly's `settings.ext`, asked by a start of the deep
//   window only, capped by the hub's `limits.deepMax`;
// - what the page says of the fan without a text: the archive's lag by the window's `newestAt` (NEW-02), the fan's
//   script by the window (AI-087).
// The whole path is the real one, over the scripted hub of these tests (as ai-start.test.ts).

import { describe, expect, it } from 'vitest';

import { chatKeyOf, type Bootstrap, type ChatRef, type ContextFrame, type FreshnessPort, type FreshnessRequest, type HubFrame, type UiAction } from '@cg/contracts';
import { FanslySnapshotSchema, type FanslySnapshot } from '@cg/contracts/fansly';
import { type SettingsExt } from '@cg/contracts/settings-ext';
import { createFanslyAi } from '@cg/core/application/hosts/fansly/ai';
import { createFakeCatalog, ctxOf } from '@cg/testing/app-client';
import { FakeHostPort, memory, startSnapshot } from '@cg/testing/host';
import { BOOTSTRAP_PILOT_PAGES, meta, resolveHubErrorReference } from '@cg/testing/hub';

import { settingsWithPersona } from '../../support/ai-background';
import { readyHarness, type Harness, type HarnessOptions } from '../../support/ai-harness';
import { FANSLY as FANSLY_SLICE, featuresOfBoth } from '../../support/features';
import { FANSLY, NOW_MS, WORLD, fanslyAccount, fanslyChat, withFanslyPage } from '../../support/world';

const PERSONA = { key: WORLD.persona.key, definitionId: WORLD.persona.definitionId };
const SETTINGS = settingsWithPersona({
  personas: { scope: { hubOrigin: WORLD.hubOrigin, userId: WORLD.user.userId }, byPageId: { [String(WORLD.pages.one.pageId)]: PERSONA, [String(WORLD.pages.fansly.pageId)]: PERSONA } },
});
const WINDOWS = SETTINGS.generation.windows;
const BOOTSTRAP = withFanslyPage(BOOTSTRAP_PILOT_PAGES);
const withDeepMax = (deepMax: number): Bootstrap => ({ ...BOOTSTRAP, limits: { ...BOOTSTRAP.limits, deepMax } });

// ── the chat as the page holds it ───────────────────────────────────────────

interface Held {
  readonly id: string;
  readonly dir: 'fan' | 'model';
}
const idOf = (n: number): string => `80000000000000${String(1000 + n)}`;
const CHAT: readonly Held[] = Array.from({ length: 80 }, (_, n) => ({ id: idOf(n), dir: n % 2 === 0 ? 'fan' : 'model' }));
/** The window of every analysis' snapshot: the last 60 messages (min(60, N), N ≥ 60 for each of them). */
const WINDOW = CHAT.slice(-60);
const NEWEST = WINDOW.at(-1)?.id ?? '';

/** MAIN's snapshot of the chat (host-fansly main/snapshot.ts): the window, the fan's known ids; never a text for these. */
function snapshotOf(request: FreshnessRequest): FanslySnapshot {
  const window = CHAT.slice(-Math.min(60, request.window)).map((message) => ({ id: message.id, dir: message.dir }));
  return FanslySnapshotSchema.parse({
    feature: request.feature,
    identity: { creatorId: FANSLY.creator, groupId: request.conversationRef, fanId: FANSLY.fan },
    epochs: { document: 'doc1', socket: 1, route: 1 },
    completeness: 'complete',
    window,
    knownFanMessageIds: window.filter((entry) => entry.dir === 'fan').slice(-10).map((entry) => entry.id),
    deletedIds: [],
    truncated: false,
  } satisfies FanslySnapshot);
}

function freshness(): FreshnessPort & { readonly asked: FreshnessRequest[] } {
  const asked: FreshnessRequest[] = [];
  return {
    asked,
    snapshot(_chat: ChatRef, request: FreshnessRequest): Promise<FanslySnapshot | null> {
      asked.push(request);
      return Promise.resolve(snapshotOf(request));
    },
  };
}

// ── the tab on a Fansly chat ────────────────────────────────────────────────

interface FanslyTab {
  readonly h: Harness;
  readonly port: ReturnType<typeof freshness>;
  /** How many times the policy asked for the person's deep window. */
  readonly wishes: { count: number };
}

async function fanslyTab(options: { readonly bootstrap?: Bootstrap; readonly windows?: () => Promise<SettingsExt['windows'] | null>; readonly shared?: HarnessOptions['shared'] } = {}): Promise<FanslyTab> {
  const port = freshness();
  const wishes = { count: 0 };
  const windows = options.windows;
  const policy = createFanslyAi({ now: () => NOW_MS, ...(windows === undefined ? {} : { windows: () => ((wishes.count += 1), windows()) }) });
  const fake = new FakeHostPort({ start: startSnapshot, memory, checkpoint: null, answers: {}, timeline: [] });
  const h = await readyHarness(
    { baseHost: fake, memory, catalog: createFakeCatalog(ctxOf({ now: NOW_MS })), bootstrap: options.bootstrap ?? BOOTSTRAP, resolve: resolveHubErrorReference, meta: (feature) => meta(feature as Parameters<typeof meta>[0]) },
    { settings: SETTINGS, features: FANSLY_SLICE, served: featuresOfBoth, policy, ...(options.shared === undefined ? {} : { shared: options.shared }) },
  );
  const window = memory.chatWindows[0];
  if (window === undefined) throw new Error('no chat window in the host world');
  h.host.freshness = port;
  // Fansly's window as MAIN summarizes it: no times by side, the newest message's time alone (identity.ts).
  h.host.setWindow({ ...window, chat: fanslyChat, loaded: 40, hasOlder: true, lastFanMessageId: null, lastFanMessageAt: null, lastModelMessageAt: null, newestAt: null }, fanslyChat);
  h.host.openChat(fanslyChat, fanslyAccount, FANSLY.group);
  await h.settle();
  if (h.ai.workspace.situation().ready === null) throw new Error('the Fansly chat is not ready');
  return { h, port, wishes };
}

const HEAD_AT = new Date(NOW_MS - 120_000).toISOString();

/** The hub's `context_v1` of a generation: every window id counted, unless `absent` names one the hub has not got. */
function contextOf(hubFeature: string, requested: number, absent: string | null): ContextFrame {
  return {
    type: 'context_v1',
    generationRef: meta(hubFeature as Parameters<typeof meta>[0]).requestId,
    source: 'live_union',
    servedHead: { messageRef: NEWEST, occurredAt: HEAD_AT, isFromFan: false },
    window: { requested, served: WINDOW.length },
    coverage: 'complete',
    coverageCheck: { window: WINDOW.map((message) => ({ id: message.id, state: message.id === absent ? 'absent' : 'included' })), deleted: [] },
    live: { status: 'not_sent', accepted: 0, rejected: 0 },
  };
}

/** Runs an action whose generation the hub answers with `text` and `frames`. */
async function run(tab: FanslyTab, hubFeature: string, action: UiAction, text: string, frames: readonly HubFrame[]): Promise<void> {
  // The open surface is subscribed on the page: it starts and follows the policy's current-window check (P8b3).
  const unmount = tab.h.mount({ of: hubFeature === 'chat-review' ? 'review' : hubFeature === 'coach-chat' ? 'coach' : 'recap.view' });
  try {
    tab.h.script(tab.h.streamOf(hubFeature, [text], frames));
    expect(await tab.h.dispatch(action)).toMatchObject({ ok: true });
    await tab.h.finish();
  } finally {
    unmount();
  }
}

const target = (tab: FanslyTab): string => tab.h.dock().targetHandle ?? '';
const review = (tab: FanslyTab, absent: string | null): Promise<void> =>
  run(tab, 'chat-review', { type: 'Generate', targetHandle: target(tab), feature: 'review', options: {} }, 'Rating: 7/10', [contextOf('chat-review', WINDOWS.deep, absent)]);
const recapShort = (tab: FanslyTab, absent: string | null): Promise<void> => run(tab, 'fan-summary', { type: 'RefreshRecap', length: 'short' }, 'A short recap.', [contextOf('fan-summary', 300, absent)]);
const fence = (body: string): string => ['```draft', body, '```'].join('\n');
const coach = (tab: FanslyTab, absent: string | null, answer = 'Ask about the weekend.'): Promise<void> =>
  run(tab, 'coach-chat', { type: 'Generate', targetHandle: target(tab), feature: 'coach', options: { question: 'What now?' } }, answer, [contextOf('coach-chat', WINDOWS.quick, absent)]);
const lastTurn = (tab: FanslyTab) => tab.h.coach().turns.at(-1);

describe('[host:fansly] R20 P8c: the verdict over Recap, Review and Coach — the mark of a result, with «Ещё раз», on their own surfaces', () => {
  it('[FS-TAIL-8] [FS-TAIL-10] Review: every id of its window counted — no mark; a window message the hub has not got (its lag) — «Ответ мог не учесть…», and «Ещё раз» rates the chat anew', async () => {
    const fresh = await fanslyTab();
    await review(fresh, null);
    expect(fresh.h.review()).toMatchObject({ state: 'done', stale: null });

    const missed = await fanslyTab();
    await review(missed, NEWEST);
    const vm = missed.h.review();
    expect(vm).toMatchObject({ state: 'done', stale: { reason: 'window-miss', at: null }, regenerate: { enabled: true, action: { type: 'Regenerate', operationId: vm.opId } } });
    // No page text went with it (FS-TAIL-10): the window was checked by its ids alone.
    expect(missed.h.bg.hub.streams.map(({ body }) => [body.coverageCheck?.window.length, body.liveTextContext])).toEqual([[60, undefined]]);
    await run(missed, 'chat-review', vm.regenerate.action, 'Rating: 8/10', [contextOf('chat-review', WINDOWS.deep, null)]);
    expect(missed.h.review()).toMatchObject({ state: 'done', stale: null });
    expect(missed.h.review().opId).not.toBe(vm.opId);
  });

  it('[FS-TAIL-8] [FS-TAIL-10] recap-short: the copy this tab built carries the verdict — «Ещё раз» builds it anew; a fresh one has none', async () => {
    const tab = await fanslyTab();
    await recapShort(tab, NEWEST);
    const vm = tab.h.recapView();
    expect(vm).toMatchObject({ length: 'short', markdown: 'A short recap.', stale: { reason: 'window-miss', at: null }, refresh: { enabled: true, action: { type: 'RefreshRecap', length: 'short' } } });
    expect(tab.h.bg.hub.streams.map(({ body }) => [body.messageCount, body.coverageCheck?.window.length, body.liveTextContext])).toEqual([[300, 60, undefined]]);
    await recapShort(tab, null);
    expect(tab.h.recapView()).toMatchObject({ length: 'short', stale: null });
  });

  function shareRecap(tab: FanslyTab): void {
    const record = tab.h.ai.workspace.ops.get(tab.h.recapView().opId ?? '');
    const result = record?.view.result;
    if (result?.kind !== 'recap') throw new Error('no generated Recap');
    tab.h.bg.sharedRecaps = {
      full: null,
      short: { generationRef: result.shared.generationRef, generatedAt: tab.h.recapView().generatedAt ?? '', personaDefinitionId: PERSONA.definitionId, text: result.markdown, coverage: { transcriptCoverage: 'window', requestedCount: 300, keptCount: 60 } },
      fullSavedToProfile: false,
    };
  }

  it('[FS-TAIL-8] a window-miss Recap reopened in a second tab without its proof is unverified, with refresh and no generation', async () => {
    const first = await fanslyTab();
    await recapShort(first, NEWEST);
    shareRecap(first);
    const second = await fanslyTab({ shared: { bg: first.h.bg, clock: first.h.clock, tab: '00000000-0000-4000-8000-000000009000' } });
    await second.h.dispatch({ type: 'ShowRecap', length: 'short' });
    await second.h.settle();
    expect(second.h.recapView()).toMatchObject({ markdown: 'A short recap.', stale: { reason: 'unverified', at: null }, refresh: { enabled: true, action: { type: 'RefreshRecap', length: 'short' } } });
    expect(first.h.bg.hub.streams).toHaveLength(1);
  });

  it('[FS-TAIL-8] the saved Recap keeps window-miss after its operation expires and the same artifact is read again', async () => {
    const tab = await fanslyTab();
    await recapShort(tab, NEWEST);
    shareRecap(tab);
    const opId = tab.h.recapView().opId ?? '';
    await tab.h.clock.advance(30 * 60_000);
    await tab.h.ai.workspace.ops.syncChat(chatKeyOf(fanslyChat));
    expect(tab.h.ai.workspace.ops.get(opId)).toBeNull();
    expect(tab.h.recapView()).toMatchObject({ markdown: 'A short recap.', stale: { reason: 'window-miss', at: null } });
    await tab.h.dispatch({ type: 'ShowRecap', length: 'short' });
    await tab.h.settle();
    expect(tab.h.recapView()).toMatchObject({ markdown: 'A short recap.', stale: { reason: 'window-miss', at: null }, refresh: { enabled: true } });
    expect(tab.h.bg.hub.streams).toHaveLength(1);
  });

  it('[FS-TAIL-8] a pending window check updates the Recap copy even after it is reread from the hub, and its verdict survives the operation', async () => {
    const tab = await fanslyTab();
    let checked: ((snapshot: FanslySnapshot) => void) | undefined;
    // The generation's proof answers immediately; the current-window check stays pending.
    const snapshot = tab.port.snapshot.bind(tab.port);
    let calls = 0;
    tab.h.host.freshness = { snapshot: (chat, request) => ++calls === 1 ? snapshot(chat, request) : new Promise((resolve) => { checked = resolve; }) };
    await recapShort(tab, NEWEST);
    expect(tab.h.recapView().stale?.reason).toBe('unverified');
    shareRecap(tab);
    await tab.h.clock.advance(60_001);
    await tab.h.dispatch({ type: 'ShowRecap', length: 'short' });
    await tab.h.settle();
    if (checked === undefined) throw new Error('no current-window check');
    checked(snapshotOf({ feature: 'recap-short', conversationRef: FANSLY.group, window: 60, withText: false }));
    await tab.h.settle();
    expect(tab.h.recapView().stale?.reason).toBe('window-miss');
    await tab.h.clock.advance(30 * 60_000);
    await tab.h.ai.workspace.ops.syncChat(chatKeyOf(fanslyChat));
    expect(tab.h.recapView().stale?.reason).toBe('window-miss');
    expect(tab.h.bg.hub.streams).toHaveLength(1);
  });

  it('[FS-TAIL-8] [FS-TAIL-10] coach: the answer carries the verdict, its «Ещё раз» asks the same question again; a fresh answer has neither', async () => {
    const tab = await fanslyTab();
    await coach(tab, NEWEST);
    expect(lastTurn(tab)).toMatchObject({ state: 'done', stale: { reason: 'window-miss', at: null }, again: { enabled: true, action: { type: 'Generate', feature: 'coach', targetHandle: target(tab), options: { question: 'What now?' } } } });
    expect(tab.h.bg.hub.streams.map(({ body }) => [body.coverageCheck?.window.length, body.liveTextContext])).toEqual([[60, undefined]]);
    const again = lastTurn(tab)?.again?.action;
    if (again === undefined) throw new Error('no «Ещё раз»');
    await run(tab, 'coach-chat', again, 'Ask about the weekend, then offer.', [contextOf('coach-chat', WINDOWS.quick, null)]);
    expect(tab.h.coach().turns.map((turn) => [turn.question, turn.stale?.reason ?? null, turn.again ?? null])).toEqual([
      ['What now?', 'window-miss', expect.objectContaining({ enabled: true })],
      ['What now?', null, null],
    ]);
  });

  it('[FS-TAIL-7] no context frame: «Свежесть не проверена» over the Review — the same words as over a result', async () => {
    const tab = await fanslyTab();
    await run(tab, 'chat-review', { type: 'Generate', targetHandle: target(tab), feature: 'review', options: {} }, 'Rating: 7/10', []);
    expect(tab.h.review().stale).toEqual({ reason: 'unverified', at: null });
  });

  it('the fan wrote after a fresh Review: no mark over it — that is its archive-lag line, as on ChatSpace —, while the dock’s result would say «фан написал новое»', async () => {
    const tab = await fanslyTab();
    await review(tab, null);
    const at = new Date(NOW_MS + 60_000).toISOString();
    tab.h.bg.scheduler.incoming({ host: 'fansly-web', hostAccountId: FANSLY.creator, platformFanId: FANSLY.fan, platformMessageId: idOf(500), fromFan: true, automatic: false, tip: false, sentAt: at, socketEpoch: 1, fanSequence: 1, source: 'ws-tap' }, NOW_MS + 60_000);
    await tab.h.settle();
    const view = tab.h.ai.workspace.ops.get(tab.h.review().opId ?? '')?.view;
    expect(view?.stale).toEqual({ reason: 'fan-wrote', at });
    expect(tab.h.review().stale).toBeNull();
  });
});

describe('[host:fansly] R20 P8c: the deep window — the person’s depth above 3000 from settings.ext, never above the hub’s deepMax', () => {
  it('[FS-AI-1] at deepMax 5000 a wish of 5000 is the full Recap’s and the Review’s messageCount; the window check stays 60; no other start asks for it', async () => {
    const tab = await fanslyTab({ bootstrap: withDeepMax(5000), windows: () => Promise.resolve({ deep: 5000 }) });
    const counts: Record<string, number | undefined> = {};
    const steps: [string, string, UiAction][] = [
      ['recap', 'fan-summary', { type: 'RefreshRecap', length: 'full' }],
      ['review', 'chat-review', { type: 'Generate', targetHandle: target(tab), feature: 'review', options: {} }],
      ['recap-short', 'fan-summary', { type: 'RefreshRecap', length: 'short' }],
      ['reply', 'fast-reply', { type: 'Generate', targetHandle: target(tab), feature: 'reply', options: {} }],
      ['coach', 'coach-chat', { type: 'Generate', targetHandle: target(tab), feature: 'coach', options: { question: 'What now?' } }],
    ];
    for (const [feature, hubFeature, action] of steps) {
      const before = tab.h.bg.hub.streams.length;
      await run(tab, hubFeature, action, 'Text.', []);
      const request = tab.h.bg.hub.streams[before];
      counts[feature] = request?.body.messageCount;
      expect(request?.body.summaryMode, feature).toBe(feature === 'recap-short' ? 'short' : undefined);
      expect([feature, request?.body.coverageCheck?.window.length]).toEqual([feature, 60]);
    }
    expect(counts).toEqual({ recap: 5000, review: 5000, 'recap-short': 300, reply: WINDOWS.quick, coach: WINDOWS.quick });
    expect(tab.wishes.count).toBe(2);
  });

  it('[FS-AI-1] the hub’s deepMax caps the wish (3000); no wish, or a read that fails, is the v1 window', async () => {
    const capped = await fanslyTab({ bootstrap: withDeepMax(3000), windows: () => Promise.resolve({ deep: 5000 }) });
    await recapShort(capped, null);
    await run(capped, 'fan-summary', { type: 'RefreshRecap', length: 'full' }, 'Text.', []);
    expect(capped.h.bg.hub.streams.map(({ body }) => [body.summaryMode ?? null, body.messageCount])).toEqual([['short', 300], [null, 3000]]);

    for (const windows of [() => Promise.resolve({ deep: null }), () => Promise.reject(new Error('the background did not answer'))]) {
      const tab = await fanslyTab({ bootstrap: withDeepMax(5000), windows });
      await run(tab, 'fan-summary', { type: 'RefreshRecap', length: 'full' }, 'Text.', []);
      expect(tab.h.bg.hub.streams.map(({ body }) => body.messageCount)).toEqual([WINDOWS.deep]);
      expect(tab.wishes.count).toBe(1);
    }
  });

  it('[FS-AI-1] Coach’s full auto-Recap is built at the wish too', async () => {
    const tab = await fanslyTab({ bootstrap: withDeepMax(5000), windows: () => Promise.resolve({ deep: 4000 }) });
    tab.h.script(tab.h.streamOf('fan-summary', ['Summary']), tab.h.streamOf('coach-chat', ['Advice']));
    expect(await tab.h.ai.workspace.startFeature({ feature: 'coach', surface: 'coach', cause: 'click', options: { question: 'What now?' }, autoRecap: 'full' })).toMatchObject({ kind: 'started' });
    await tab.h.finish();
    expect(tab.h.bg.hub.streams.map(({ feature, body }) => [feature, body.messageCount])).toEqual([
      ['fan-summary', 4000],
      ['coach-chat', WINDOWS.quick],
    ]);
  });
});

describe('[host:fansly] R20 P8c: what the page says of the fan without a copy of a text — the archive’s lag by `newestAt`, the fan’s script by the window', () => {
  it('[NEW-02] the Review’s archive lags the page when the page’s newest message is after the head it was built on; not when it is the head', async () => {
    const tab = await fanslyTab();
    const setNewest = async (at: string | null): Promise<void> => {
      const window = tab.h.host.chatWindow(fanslyChat);
      if (window === null) throw new Error('no window');
      tab.h.host.setWindow({ ...window, newestAt: at }, fanslyChat);
      tab.h.review();
      await tab.h.settle();
    };
    await review(tab, null);
    await setNewest(HEAD_AT);
    expect(tab.h.review().view).toEqual({ s: 'ready' });
    await setNewest(new Date(NOW_MS + 60_000).toISOString());
    expect(tab.h.review().view).toEqual({ s: 'partial', gaps: [{ kind: 'archive-lag', messages: null, minutes: null }] });
  });

  it('[AI-087] a Coach draft in Cyrillic: held for a fan whose window says another script, offered for one who writes Cyrillic — by MAIN’s word, with no tail in the tab', async () => {
    const tab = await fanslyTab();
    const setScript = async (fanScript: 'cyrillic' | 'other'): Promise<void> => {
      const window = tab.h.host.chatWindow(fanslyChat);
      if (window === null) throw new Error('no window');
      tab.h.host.setWindow({ ...window, fanScript }, fanslyChat);
      await tab.h.settle();
    };
    await setScript('other');
    await coach(tab, null, ['Напиши теплее.', fence('привет, как выходные?')].join('\n'));
    expect(lastTurn(tab)?.answer?.drafts[0]?.parts[0]?.insertBlocked).toMatchObject({ id: 'language', code: 'CG-GATE-LANGUAGE' });
    await setScript('cyrillic');
    expect(lastTurn(tab)?.answer?.drafts[0]?.parts[0]?.insertBlocked).toBeNull();
  });
});
