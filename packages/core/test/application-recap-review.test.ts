// The Recap controller over the fake tab RPC (the real scheduler with R11's
// drivers), @cg/testing's FakeHostPort and the fake hub's frames: the Recap
// sheet and picker (shared recaps of the hub as two local copies, «Проверяю
// сохранённые Recap…», builds that are always new, the dossier save and its
// retries, the archive lag) — and what a persona change takes of a Recap and
// of a Review (a turn of Coach since 1.51.0, application-coach.test.ts).

import { describe, expect, it } from 'vitest';

import { chatKeyOf, type HubFrame, type RecapBody, type RecapViewVM } from '@cg/contracts';
import { RECAP_STATUS } from '@cg/core/application/ai';
import { createFakeCatalog, ctxOf } from '@cg/testing/app-client';
import { FakeHostPort, HOST_IDS, memory, openChat, previewChat, startSnapshot } from '@cg/testing/host';
import { BOOTSTRAP_PILOT_PAGES, meta, resolveHubErrorReference } from '@cg/testing/hub';

import { OTHER_TAB } from './support/ai-background';
import { delta, doneStep, readyHarness, type Harness, type HarnessOptions, type HarnessParts } from './support/ai-harness';
import { type ScriptResponse } from './support/fake-hub';
import { NOW_MS, WORLD, uuid } from './support/world';

function parts(): HarnessParts {
  return {
    baseHost: new FakeHostPort({ start: startSnapshot, memory, checkpoint: null, answers: {}, timeline: [] }),
    memory,
    catalog: createFakeCatalog(ctxOf({ now: NOW_MS })),
    bootstrap: BOOTSTRAP_PILOT_PAGES,
    resolve: resolveHubErrorReference,
    meta: (feature) => meta(feature as Parameters<typeof meta>[0]),
  };
}

/** The sheets are mounted, as on the page: they are read again on every change. */
async function start(options: HarnessOptions = {}): Promise<Harness> {
  const h = await readyHarness(parts(), options);
  h.mount({ of: 'recap.view' });
  h.mount({ of: 'recap.picker' });
  h.mount({ of: 'coach' });
  return h;
}

const FULL_TEXT = ['## Кто он', 'Марк, 34, Остин.', '', '## Деньги', 'Купил сет за $30.', '', '## Что дальше', 'Спросить про выходные.'].join('\n');
const SHORT_TEXT = 'Марк из Остина. Купил сет за $30, ждёт фото.';

/** Both saved recaps were made after the newest message of the page: not behind the chat. */
const FULL_AT = '2026-10-03T09:59:20.000Z';

const body = (over: Partial<RecapBody> = {}): RecapBody => ({
  generationRef: uuid(0x700),
  generatedAt: FULL_AT,
  personaDefinitionId: WORLD.persona.definitionId,
  coverage: { transcriptCoverage: 'full-history', requestedCount: 3000, keptCount: 812 },
  text: FULL_TEXT,
  ...over,
});

const saved = { state: 'saved' as const, response: { outcome: 'created' as const, profile: { version: 1, createdAt: '2026-10-03T10:00:01.000Z', sourceGeneratedAt: null } } };

const recapStream = (text: string, extra: readonly HubFrame[] = []): ScriptResponse => ({
  kind: 'stream',
  steps: [{ kind: 'frame', frame: meta('fan-summary') }, ...extra.map((frame) => ({ kind: 'frame' as const, frame })), delta(text.slice(0, 12)), delta(text.slice(12)), doneStep],
});

/** Opens the Recap sheet and lets the check of the saved recaps answer. */
async function openRecap(h: Harness, feature: 'recap' | 'recap-short' = 'recap'): Promise<void> {
  const receipt = await h.generate(feature);
  expect(receipt).toMatchObject({ ok: true, type: 'Generate', outcome: 'opened' });
  await h.settle();
}

const REVIEW = [
  '<rating>7</rating>',
  '',
  '<evaluation>',
  'Коротко о диалоге.',
  'ВЕРДИКТ: Диалог тёплый, но апселл пришёл рано.',
  'ДЕНЬГИ: Сет за $30 куплен после чаевых.',
  'ПЕРСОНА: Голос держится.',
  'ОШИБКИ:',
  '1. Оффер сразу после чаевых: "want more?" — давит. Как надо было (после "[Photo]"): "missed you today, want to see what I saved?" Это мягче.',
  'ЧТО РАБОТАЕТ: Короткие тёплые сообщения.',
  '</evaluation>',
  '',
  '<recommendations>',
  'Общий совет.',
  '1. Вместо оффера в лоб делай разогрев.',
  '</recommendations>',
].join('\n');

const reviewStream = (text: string, extra: readonly HubFrame[] = []): ScriptResponse => ({
  kind: 'stream',
  steps: [{ kind: 'frame', frame: meta('chat-review') }, ...extra.map((frame) => ({ kind: 'frame' as const, frame })), delta(text.slice(0, 40), 100), delta(text.slice(40), 100), doneStep],
});

describe('recap: the sheet and what is saved', () => {
  it('[AI-060] [AI-061] the Recap button opens the sheet and checks what is saved — it never generates', async () => {
    const h = await start();
    h.bg.held.add('recap.read');
    const receipt = await h.generate('recap');
    expect(receipt).toMatchObject({ ok: true, outcome: 'opened' });
    expect(h.dock()).toMatchObject({ analysis: 'recap', result: null });
    expect(h.dock().actions.recap.active).toBe(true);
    // «Проверяю сохранённые Recap…» until the hub answers.
    expect(h.recapView().view).toMatchObject({ s: 'loading', stage: { key: 'recap.checking' } });
    expect(h.recapPicker().view).toMatchObject({ s: 'loading', stage: { key: 'recap.checking' } });
    expect(h.bg.callsOf('recap.read')).toEqual([{ pageId: WORLD.pages.one.pageId, fanRef: HOST_IDS.fan, personaDefinitionId: WORLD.persona.definitionId }]);
    h.bg.release();
    await h.settle();
    expect(h.bg.callsOf('op.start')).toEqual([]);
    expect(h.bg.callsOf('token.issue')).toEqual([]);
  });
});

describe('recap: building one', () => {
  it('[AI-062] [AI-064] «Полный» builds over the deep window — always a new generation, past the cache', async () => {
    const h = await start();
    h.bg.hub.profileScript.push(saved);
    await openRecap(h);
    h.script(recapStream(FULL_TEXT));
    const receipt = await h.dispatch({ type: 'RefreshRecap', length: 'full' });
    expect(receipt).toMatchObject({ ok: true, type: 'RefreshRecap', outcome: 'started' });
    const started = h.bg.callsOf('op.start')[0] as { feature: string; surface: string; force: boolean; window: number; split: boolean; tone: unknown; fresh?: unknown };
    expect(started).toMatchObject({ feature: 'recap', surface: 'dock', force: true, window: 3000, split: false, tone: null });
    // X52: over the hub archive and the open chat's fresh tail, on a hub that keeps such a recap shared.
    expect(started.fresh).toMatchObject({ messages: [{ platformMessageId: '4004', direction: 'fan', text: 'hey' }] });
    expect(h.bg.hub.streams[0]).toMatchObject({ feature: 'fan-summary', body: { messageCount: 3000, liveTextContext: { items: [{ platformMessageId: '4004', text: 'hey' }] } } });
    expect(h.bg.hub.streams[0]?.body.summaryMode).toBeUndefined();
    expect(h.bg.hub.streams[0]?.body.replyMode).toBeUndefined();

    // While it runs: the stage line, a preview without actions, the Recap button busy.
    await h.clock.advance(20);
    const running = h.recapView();
    expect(running.view).toMatchObject({ s: 'loading', since: NOW_MS });
    expect(running).toMatchObject({ state: 'streaming', markdown: null, copyHandle: null, opId: (receipt as { opId: string }).opId });
    expect(running.streamText).toBe(FULL_TEXT.slice(0, 12).trim());
    expect(running.phase?.cancel).toEqual({ type: 'CancelGeneration', operationId: (receipt as { opId: string }).opId });
    expect(h.dock().actions.recap).toMatchObject({ busy: true, active: true });
    expect(h.dock().result).toBeNull();
    expect(running.refresh).toMatchObject({ enabled: false });
    expect(running.refresh.reason?.id).toBe('chat-busy');

    await h.finish();
    const done = h.recapView();
    expect(done.view).toEqual({ s: 'ready' });
    expect(done).toMatchObject({ length: 'full', markdown: FULL_TEXT, state: 'done', phase: null, streamText: null, generatedAt: '2026-10-03T10:00:00.040Z' });
    expect(done.blocks?.map((block) => block.heading)).toEqual(['Кто он', 'Деньги', 'Что дальше']);

    // A second build is a second generation, never the cached one.
    h.bg.hub.profileScript.push(saved);
    h.script(recapStream(`${FULL_TEXT}\n\n## Ещё\nНовое.`));
    expect(await h.dispatch(done.refresh.action)).toMatchObject({ ok: true, outcome: 'started' });
    await h.finish();
    expect(h.bg.hub.streams).toHaveLength(2);
    expect(h.bg.hub.streams[1]?.body.isRegeneration).toBe(true);
    expect(h.recapView().blocks?.map((block) => block.heading)).toEqual(['Кто он', 'Деньги', 'Что дальше', 'Ещё']);
  });
});

describe('recap: a build asked from Coach or the fan panel', () => {
  it('opens no sheet of the dock behind them, fails there too; a Recap sheet open already follows it', async () => {
    const h = await start();
    h.bg.hub.profileScript.push(saved);
    h.script(recapStream(FULL_TEXT));
    expect(await h.dispatch({ type: 'RefreshRecap', length: 'full', panel: true })).toMatchObject({ ok: true, outcome: 'started' });
    await h.clock.advance(20);
    // 2026-10-24: Coach says «Собираю Recap»; the dock behind it shows only its Recap button busy, no sheet streaming.
    expect(h.dock()).toMatchObject({ analysis: null, result: null });
    expect(h.dock().actions.recap.busy).toBe(true);
    expect(h.coach().recapRunning).toBe(true);
    expect(h.recapView()).toMatchObject({ state: 'streaming', expanded: false });
    await h.finish();
    expect(h.dock().analysis).toBeNull();
    expect(h.recapView()).toMatchObject({ state: 'done', markdown: FULL_TEXT, expanded: false });

    // A failed one is said where it was asked (Coach reads the followed build); the dock stays as it was.
    h.script({ kind: 'http-error', status: 500, body: { error: 'internal_error' } });
    await h.dispatch({ type: 'RefreshRecap', length: 'full', panel: true });
    await h.finish();
    expect(h.dock().analysis).toBeNull();
    expect(h.recapView()).toMatchObject({ state: 'failed', refreshFailed: { retry: { type: 'RefreshRecap', length: 'full' } } });

    await openRecap(h);
    h.bg.hub.profileScript.push(saved);
    h.script(recapStream(FULL_TEXT));
    await h.dispatch({ type: 'RefreshRecap', length: 'full', panel: true });
    await h.clock.advance(20);
    expect(h.dock().analysis).toBe('recap');
    expect(h.recapView()).toMatchObject({ state: 'streaming', expanded: false });
    await h.finish();
  });
});

describe('recap: a build that fails over a saved one', () => {
  it('a failed «Обновить» keeps the Recap on screen and its window open: «Не обновилось» with «Повторить» under it', async () => {
    const h = await start();
    h.bg.hub.profileScript.push(saved);
    await openRecap(h);
    h.script(recapStream(FULL_TEXT));
    await h.dispatch({ type: 'RefreshRecap', length: 'full' });
    await h.finish();
    expect(h.recapView()).toMatchObject({ markdown: FULL_TEXT, expanded: true, refreshFailed: null });

    h.script({ kind: 'http-error', status: 500, body: { error: 'internal_error' } });
    await h.dispatch(h.recapView().refresh.action);
    await h.finish();
    const failed = h.recapView();
    expect(failed).toMatchObject({ markdown: FULL_TEXT, expanded: true, refreshFailed: { retry: { type: 'RefreshRecap', length: 'full' } } });
    expect(failed.view.s === 'ready' || failed.view.s === 'partial').toBe(true);
    expect(failed.copyHandle).not.toBeNull();
  });
});

describe('recap: the dossier of a full recap', () => {
  const built = async (h: Harness): Promise<RecapViewVM> => {
    await openRecap(h);
    h.script(recapStream(FULL_TEXT));
    await h.dispatch({ type: 'RefreshRecap', length: 'full' });
    await h.clock.advance(1_000);
    return h.recapView();
  };

  it('[AI-067] [AI-071] a finished full recap is linked as the dossier by its generation — no text is sent; «сохранено в хаб»', async () => {
    const h = await start();
    h.bg.hub.profileScript.push(saved);
    const view = await built(h);
    expect(h.bg.hub.profiles).toEqual([{ pageLabel: WORLD.pages.one.pageLabel, fanRef: HOST_IDS.fan, generationRef: uuid(0x200), clientRequestId: view.opId }]);
    expect(JSON.stringify(h.bg.hub.profiles)).not.toContain('Марк');
    expect(view.saved).toEqual({ s: 'saved', at: '2026-10-03T10:00:00.040Z' });
    expect(h.recapPicker().slots.full?.saved).toMatchObject({ s: 'saved' });
    // UI-010: the strip shows that a recap is ready to open.
    expect(h.dock().actions.recap.badge).toBe('recap-ready');
  });
});

describe('recap: whose recaps they are', () => {
  it('the recaps belong to the page, the fan and the persona: another chat has its own, another persona reads again', async () => {
    const h = await start({ background: (bg) => (bg.sharedRecaps = { full: body(), short: null, fullSavedToProfile: true }) });
    await openRecap(h);
    expect(h.recapView().markdown).toBe(FULL_TEXT);
    h.host.setWindow({ ...(memory.chatWindows[0] as (typeof memory.chatWindows)[number]), chat: previewChat }, previewChat);
    h.host.openChat(previewChat);
    await h.settle();
    // The other chat's sheet is closed and holds nothing of this fan.
    expect(h.dock().analysis).toBeNull();
    expect(h.recapView()).toMatchObject({ markdown: null });
    expect(h.recapPicker().slots).toEqual({ short: null, full: null });
    h.host.openChat(openChat);
    await h.settle();
    expect(h.dock().analysis).toBe('recap');
    expect(h.recapView().markdown).toBe(FULL_TEXT);

    // The page gets another persona: the copies of the old one are not shown for it.
    h.bg.sharedRecaps = { full: null, short: null, fullSavedToProfile: false };
    h.bg.changePersona(WORLD.pages.one.pageId, { key: 'other', definitionId: WORLD.persona.otherDefinitionId });
    await h.settle();
    expect(h.recapPicker().slots).toEqual({ short: null, full: null });
  });
});

describe('recap: a build belongs to its chat', () => {
  it('«Ещё раз» of another chat\'s recap builds nothing for the chat that is open', async () => {
    const h = await start();
    h.bg.hub.profileScript.push(saved);
    await openRecap(h);
    h.script(recapStream(FULL_TEXT));
    const built = await h.dispatch({ type: 'RefreshRecap', length: 'full' });
    await h.finish();
    const opId = (built as { opId: string }).opId;
    h.host.setWindow({ ...(memory.chatWindows[0] as (typeof memory.chatWindows)[number]), chat: previewChat }, previewChat);
    h.host.openChat(previewChat);
    await h.settle();
    expect(await h.dispatch({ type: 'Regenerate', operationId: opId })).toMatchObject({ ok: false, type: 'Regenerate', code: 'CG-CONTEXT-CHANGED' });
    expect(h.bg.callsOf('op.start')).toHaveLength(1);
    expect(h.bg.hub.streams).toHaveLength(1);
    // In its own chat it is a new build of the same length.
    h.host.openChat(openChat);
    await h.settle();
    h.script(recapStream(SHORT_TEXT));
    expect(await h.dispatch({ type: 'Regenerate', operationId: opId })).toMatchObject({ ok: true, outcome: 'started' });
    await h.finish();
    expect(h.bg.callsOf('op.start')[1]).toMatchObject({ feature: 'recap', force: true });
  });

  it('the sheet of a chat that is gone is not opened over another chat', async () => {
    const h = await start();
    const handle = h.dock().targetHandle as string;
    h.host.setWindow({ ...(memory.chatWindows[0] as (typeof memory.chatWindows)[number]), chat: previewChat }, previewChat);
    h.host.openChat(previewChat);
    await h.settle();
    expect(await h.dispatch({ type: 'Generate', targetHandle: handle, feature: 'recap', options: {} })).toMatchObject({ ok: false, code: 'CG-CONTEXT-CHANGED' });
    expect(await h.dispatch({ type: 'Generate', targetHandle: handle, feature: 'review', options: {} })).toMatchObject({ ok: false, code: 'CG-CONTEXT-CHANGED' });
    expect(h.dock().analysis).toBeNull();
    // Nor is Coach's window opened over the other chat for a Review of the one that is gone.
    expect(h.overlays.opened).toEqual([]);
    expect(h.bg.callsOf('recap.read')).toEqual([]);
    expect(h.bg.callsOf('op.start')).toEqual([]);
  });
});

describe('persona change: nothing of the old persona comes back', () => {
  const OTHER_PERSONA = { key: 'other', definitionId: WORLD.persona.otherDefinitionId };
  const A_TEXT = 'Рекап персоны A.';

  /** A full recap and a review (a turn of Coach), both made under the first persona. */
  async function madeUnderFirst(h: Harness): Promise<void> {
    h.bg.hub.profileScript.push(saved);
    await openRecap(h);
    h.script(recapStream(A_TEXT));
    await h.dispatch({ type: 'RefreshRecap', length: 'full' });
    await h.finish();
    h.script(reviewStream(REVIEW));
    await h.generate('review');
    await h.finish();
    expect(h.recapView().markdown).toBe(A_TEXT);
    expect(h.coach().turns.at(-1)?.review?.rating).toBe(7);
  }

  it('[AI-126] the next visit of the chat does not bring the old persona\'s Recap and Review back', async () => {
    const h = await start();
    await madeUnderFirst(h);
    h.bg.changePersona(WORLD.pages.one.pageId, OTHER_PERSONA);
    await h.settle();
    // The sheet of the old persona closed and shows nothing; the Coach dialog with its Review turn is gone.
    expect(h.dock().analysis).toBeNull();
    expect(h.coach().turns).toEqual([]);
    expect(h.recapView().markdown).toBeNull();

    // Another chat and back: the background still lists the old results of this chat (it keeps them half an hour).
    const lists = h.bg.callsOf('op.list').length;
    h.host.setWindow({ ...(memory.chatWindows[0] as (typeof memory.chatWindows)[number]), chat: previewChat }, previewChat);
    h.host.openChat(previewChat);
    await h.settle();
    h.host.openChat(openChat);
    await h.settle();
    expect(h.bg.callsOf('op.list').length).toBeGreaterThan(lists);
    expect(h.bg.scheduler.list(OTHER_TAB, 'tab', chatKeyOf(openChat)).ops.map((op) => op.feature).sort()).toEqual(['recap', 'review']);
    // What the change dropped stays dropped in this tab.
    expect(h.ai.workspace.ops.ofChat(chatKeyOf(openChat))).toEqual([]);
    expect(h.coach().turns).toEqual([]);
    await openRecap(h);
    expect(h.bg.callsOf('recap.read').at(-1)).toMatchObject({ personaDefinitionId: OTHER_PERSONA.definitionId });
    expect(h.recapView()).toMatchObject({ markdown: null, view: { s: 'empty' } });
    expect(h.recapPicker().slots).toEqual({ short: null, full: null });
    await h.clock.advance(RECAP_STATUS.settleMs);
    expect(h.dock().actions.recap.badge).toBeNull();
    expect(JSON.stringify([h.recapView(), h.recapPicker(), h.coach()])).not.toContain(A_TEXT);
  });
});
