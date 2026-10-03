// The Recap and Review controllers over the fake tab RPC (the real
// scheduler with R11's drivers), @cg/testing's FakeHostPort and the fake
// hub's frames: the Recap sheet and picker (shared recaps of the hub as two
// local copies, «Проверяю сохранённые Recap…», builds that are always new,
// the dossier save and its retries, the archive lag) and the Review sheet
// (N/10 with its blocks, raw text when the frame does not read, copy,
// «Ещё раз» past the cache).

import { describe, expect, it } from 'vitest';

import { UiActionSchema, chatKeyOf, type Bootstrap, type HubFrame, type LiveTextTail, type RecapBody, type RecapViewVM, type ReviewVM } from '@cg/contracts';
import { RECAP_STATUS, readArtifactHandle } from '@cg/core/application/ai';
import { saveSchedule } from '@cg/core/domain/recap';
import { createFakeCatalog, ctxOf } from '@cg/testing/app-client';
import { FakeHostPort, HOST_IDS, hostIso, memory, openChat, previewChat, startSnapshot } from '@cg/testing/host';
import { BOOTSTRAP_PILOT_ON, contextFrame, meta, resolveHubErrorReference } from '@cg/testing/hub';

import { OTHER_TAB, settingsWithPersona } from './support/ai-background';
import { delta, doneStep, readyHarness, type Harness, type HarnessOptions, type HarnessParts } from './support/ai-harness';
import { type ScriptResponse } from './support/fake-hub';
import { NOW_MS, WORLD, uuid } from './support/world';

function parts(): HarnessParts {
  return {
    baseHost: new FakeHostPort({ start: startSnapshot, memory, checkpoint: null, answers: {}, timeline: [] }),
    memory,
    catalog: createFakeCatalog(ctxOf({ now: NOW_MS })),
    bootstrap: BOOTSTRAP_PILOT_ON,
    resolve: resolveHubErrorReference,
    meta: (feature) => meta(feature as Parameters<typeof meta>[0]),
  };
}

/** The sheets are mounted, as on the page: they are read again on every change. */
async function start(options: HarnessOptions = {}): Promise<Harness> {
  const h = await readyHarness(parts(), options);
  h.mount({ of: 'recap.view' });
  h.mount({ of: 'recap.picker' });
  h.mount({ of: 'review' });
  return h;
}

const FULL_TEXT = ['## Кто он', 'Марк, 34, Остин.', '', '## Деньги', 'Купил сет за $30.', '', '## Что дальше', 'Спросить про выходные.'].join('\n');
const SHORT_TEXT = 'Марк из Остина. Купил сет за $30, ждёт фото.';

/** Both saved recaps were made after the newest message of the page: not behind the chat. */
const FULL_AT = '2026-10-03T09:59:20.000Z';
const SHORT_AT = '2026-10-03T09:59:40.000Z';

const body = (over: Partial<RecapBody> = {}): RecapBody => ({
  generationRef: uuid(0x700),
  generatedAt: FULL_AT,
  personaDefinitionId: WORLD.persona.definitionId,
  coverage: { transcriptCoverage: 'full-history', requestedCount: 3000, keptCount: 812 },
  text: FULL_TEXT,
  ...over,
});
const shortBody = (over: Partial<RecapBody> = {}): RecapBody => body({ generationRef: uuid(0x701), generatedAt: SHORT_AT, text: SHORT_TEXT, coverage: { transcriptCoverage: 'window', requestedCount: 300, keptCount: 300 }, ...over });

const saved = { state: 'saved' as const, response: { outcome: 'created' as const, profile: { version: 1, createdAt: '2026-10-03T10:00:01.000Z', sourceGeneratedAt: null } } };

/** The served head of a generation: the archive stood at this message. */
const context = (messageRef: string, seconds: number): HubFrame => contextFrame({ servedHead: { messageRef, occurredAt: hostIso(seconds), isFromFan: true } });

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

  it('[AI-065] nothing saved: «нет сохранённого» with the two build buttons, the full one on the Recap key', async () => {
    const h = await start();
    await openRecap(h);
    const view = h.recapView();
    expect(view.view).toEqual({ s: 'empty', why: { key: 'cg.recapNotFound.title' } });
    expect(view).toMatchObject({ length: 'full', markdown: null, blocks: null, generatedAt: null, copyHandle: null, state: null, phase: null, archiveLag: null, saved: { s: 'not-applicable' } });
    expect(view.opId).toMatch(/^[0-9a-f-]{36}$/);
    const picker = h.recapPicker();
    expect(picker.view.s).toBe('empty');
    expect(picker.slots).toEqual({ short: null, full: null });
    expect(picker.targetName).toBe('Fan Two');
    expect(picker.build.full).toMatchObject({ enabled: true, label: { key: 'recap.build.full' }, action: { type: 'RefreshRecap', length: 'full' } });
    expect(picker.build.full.hotkey?.display).toBe('⌘⇧S');
    expect(picker.build.short).toMatchObject({ enabled: true, label: { key: 'recap.build.short' }, action: { type: 'RefreshRecap', length: 'short' }, hotkey: null });
    // «Открыть последний» of a length the hub does not hold opens nothing.
    expect(await h.dispatch({ type: 'ShowRecap', length: 'short' })).toMatchObject({ ok: true, outcome: 'noop' });
  });

  it('[REC-01] [AI-066] the hub\'s shared recaps become two local copies, each with its id and revision', async () => {
    const h = await start({ background: (bg) => (bg.sharedRecaps = { full: body(), short: shortBody(), fullSavedToProfile: true }) });
    await openRecap(h);
    const picker = h.recapPicker();
    expect(picker.view).toEqual({ s: 'ready' });
    expect(picker.slots.full).toMatchObject({ length: 'full', generatedAt: FULL_AT, stamp: { asOf: FULL_AT, coverage: 'complete' }, saved: { s: 'saved', at: null }, open: { enabled: true, action: { type: 'ShowRecap', length: 'full' } } });
    expect(picker.slots.short).toMatchObject({ length: 'short', generatedAt: SHORT_AT, stamp: { coverage: 'partial' }, saved: { s: 'not-applicable' }, open: { action: { type: 'ShowRecap', length: 'short' } } });
    const key = { hubOrigin: WORLD.hubOrigin, pageId: WORLD.pages.one.pageId, fanRef: HOST_IDS.fan, personaDefinitionId: WORLD.persona.definitionId };
    const copies = h.ai.workspace.recaps.both(key);
    expect(copies.full).toMatchObject({ id: uuid(0x700), revision: FULL_AT, source: 'hub', opId: null, savedToProfile: true });
    expect(copies.short).toMatchObject({ id: uuid(0x701), revision: SHORT_AT, source: 'hub', savedToProfile: null });
    // Nothing was generated to show them, and the dossier that already holds the full one is not written again.
    expect(h.bg.callsOf('op.start')).toEqual([]);
    expect(h.bg.callsOf('recap.save')).toEqual([]);
  });

  it('[AI-069] a saved recap is shown as prepared markdown with its time, coverage and a copy handle', async () => {
    const h = await start({ background: (bg) => (bg.sharedRecaps = { full: body(), short: shortBody(), fullSavedToProfile: true }) });
    await openRecap(h);
    const view = h.recapView();
    expect(view.view).toEqual({ s: 'ready' });
    expect(view).toMatchObject({ length: 'full', lengths: { short: true, full: true }, markdown: FULL_TEXT, generatedAt: FULL_AT, state: null, phase: null, streamText: null, targetName: 'Fan Two', expanded: false, debug: null });
    expect(view.blocks).toEqual([
      { heading: 'Кто он', markdown: 'Марк, 34, Остин.' },
      { heading: 'Деньги', markdown: 'Купил сет за $30.' },
      { heading: 'Что дальше', markdown: 'Спросить про выходные.' },
    ]);
    expect(view.stamp).toEqual({ asOf: FULL_AT, coverage: 'complete' });
    expect(view.saved).toEqual({ s: 'saved', at: null });
    // A recap is not a message to the fan: Split says why it does not apply (NEW-04).
    expect(view.splitReason.id).toBe('not-a-message');
    expect(readArtifactHandle(view.copyHandle as string)?.kind).toBe('recap');
    expect(await h.dispatch({ type: 'Copy', artifactHandle: view.copyHandle as string })).toMatchObject({ ok: true });
    expect(h.clipboard.texts).toEqual([FULL_TEXT]);
    // «↻ Обновить» carries the Recap key.
    expect(view.refresh).toMatchObject({ enabled: true, label: { key: 'recap.refresh' }, action: { type: 'RefreshRecap', length: 'full' } });
    expect(view.refresh.hotkey?.display).toBe('⌘⇧S');
  });

  it('[AI-065] «Открыть последний» shows a saved slot without a generation; the short one is partial by its window', async () => {
    const h = await start({ background: (bg) => (bg.sharedRecaps = { full: body(), short: shortBody(), fullSavedToProfile: true }) });
    await openRecap(h);
    expect(await h.dispatch({ type: 'ShowRecap', length: 'short' })).toMatchObject({ ok: true, outcome: 'opened' });
    const view = h.recapView();
    expect(view).toMatchObject({ length: 'short', markdown: SHORT_TEXT, blocks: null, saved: { s: 'not-applicable' } });
    expect(view.view).toEqual({ s: 'partial', gaps: [{ kind: 'coverage', level: 'partial' }] });
    expect(h.bg.callsOf('op.start')).toEqual([]);
  });

  it('[AI-065] asking for a length the hub does not hold opens the one it does', async () => {
    const h = await start({ background: (bg) => (bg.sharedRecaps = { full: null, short: shortBody(), fullSavedToProfile: false }) });
    await h.generate('recap');
    await h.settle();
    // The check answered after the sheet opened at «full»: the picker offers what exists.
    expect(h.recapPicker().slots.full).toBeNull();
    expect(h.recapPicker().slots.short?.length).toBe('short');
    expect(h.recapView().lengths).toEqual({ short: true, full: true });
    // Opened again, the sheet goes straight to the slot that exists.
    await h.dispatch({ type: 'HideResult', operationId: h.recapView().opId as string });
    await h.generate('recap');
    expect(h.recapView()).toMatchObject({ length: 'short', markdown: SHORT_TEXT });
  });

  it('the read of the saved recaps failed: the error is named with a retry, never an empty state', async () => {
    const h = await start({ background: (bg) => (bg.sharedRecaps = { error: { code: 'CG-HUB-UNAVAILABLE', httpStatus: 503 } }) });
    await openRecap(h);
    expect(h.recapPicker().view).toMatchObject({ s: 'offline', error: { code: 'CG-HUB-UNAVAILABLE' }, retry: { type: 'ReloadView', selector: { of: 'recap.picker' } } });
    h.bg.sharedRecaps = { full: body(), short: null, fullSavedToProfile: true };
    expect(await h.dispatch({ type: 'ReloadView', selector: { of: 'recap.picker' } })).toMatchObject({ ok: true });
    await h.settle();
    expect(h.recapPicker().view).toEqual({ s: 'ready' });
    expect(h.recapView().markdown).toBe(FULL_TEXT);
  });

  it('a recap the hub no longer holds leaves the slot; the check is not repeated within a minute', async () => {
    const h = await start({ background: (bg) => (bg.sharedRecaps = { full: body(), short: shortBody(), fullSavedToProfile: true }) });
    await openRecap(h);
    await h.dispatch({ type: 'HideResult', operationId: h.recapView().opId as string });
    await openRecap(h);
    expect(h.bg.callsOf('recap.read')).toHaveLength(1);
    h.bg.sharedRecaps = { full: body(), short: null, fullSavedToProfile: true };
    await h.clock.advance(61_000);
    await h.dispatch({ type: 'HideResult', operationId: h.recapView().opId as string });
    await openRecap(h);
    expect(h.bg.callsOf('recap.read')).toHaveLength(2);
    expect(h.recapPicker().slots.short).toBeNull();
    expect(h.recapPicker().slots.full?.length).toBe('full');
  });

  it('«Скрыть» and «Развернуть» work on the sheet by its id', async () => {
    const h = await start();
    await openRecap(h);
    const id = h.recapView().opId as string;
    expect(await h.dispatch({ type: 'ExpandResult', operationId: id, expanded: true })).toMatchObject({ ok: true, outcome: 'opened' });
    expect(h.recapView().expanded).toBe(true);
    expect(await h.dispatch({ type: 'HideResult', operationId: id })).toMatchObject({ ok: true });
    expect(h.dock().analysis).toBeNull();
    expect(h.dock().actions.recap.active).toBe(false);
  });

  it('the Recap switch of the owner off: the button is off and the views say «недоступно»', async () => {
    const off: Bootstrap = { ...BOOTSTRAP_PILOT_ON, flags: { ...BOOTSTRAP_PILOT_ON.flags, recap: false } };
    const h = await start({ bootstrap: off });
    expect(h.dock().actions.recap.reason?.id).toBe('feature-disabled');
    expect(h.recapView().view).toMatchObject({ s: 'forbidden', error: { code: 'CG-FEATURE-DISABLED' } });
    expect(h.recapPicker().build.full).toMatchObject({ enabled: false });
    expect(h.recapPicker().build.full.reason?.id).toBe('feature-disabled');
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
    // Built from the hub archive only: no page text goes with it.
    expect(started.fresh).toBeUndefined();
    expect(h.bg.hub.streams[0]).toMatchObject({ feature: 'fan-summary', body: { messageCount: 3000 } });
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

  it('[AI-063] «Короткий» asks the hub for the short mode and keeps its own slot beside the full one', async () => {
    const h = await start({ background: (bg) => (bg.sharedRecaps = { full: body(), short: null, fullSavedToProfile: true }) });
    await openRecap(h);
    h.script(recapStream(SHORT_TEXT));
    expect(await h.dispatch({ type: 'RefreshRecap', length: 'short' })).toMatchObject({ ok: true, outcome: 'started' });
    await h.finish();
    expect(h.bg.callsOf('op.start')[0]).toMatchObject({ feature: 'recap-short', force: true });
    expect(h.bg.hub.streams[0]).toMatchObject({ feature: 'fan-summary', body: { summaryMode: 'short' } });
    const view = h.recapView();
    expect(view).toMatchObject({ length: 'short', markdown: SHORT_TEXT, blocks: null, saved: { s: 'not-applicable' } });
    // [AI-066] the full copy is still there, untouched.
    const picker = h.recapPicker();
    expect(picker.slots.full?.generatedAt).toBe(FULL_AT);
    expect(picker.slots.short?.generatedAt).toBe('2026-10-03T10:00:00.040Z');
    // A short recap has no dossier: the background's saver is not asked.
    expect(h.bg.hub.profiles).toEqual([]);
  });

  it('[AI-137] the finished text is prepared once: reasoning out, line ends normalised', async () => {
    const h = await start();
    h.bg.hub.profileScript.push(saved);
    await openRecap(h);
    h.script(recapStream(`<think>plan the dossier</think>## Кто он\r\nМарк.\r\n\r\n\r\n\r\n## Деньги\r\n$30.`));
    await h.dispatch({ type: 'RefreshRecap', length: 'full' });
    await h.finish();
    const view = h.recapView();
    expect(view.markdown).toBe('## Кто он\nМарк.\n\n## Деньги\n$30.');
    expect(view.blocks).toEqual([
      { heading: 'Кто он', markdown: 'Марк.' },
      { heading: 'Деньги', markdown: '$30.' },
    ]);
  });

  it('[AI-127] a build that is already running is shown, not started twice; ⌘. cancels it', async () => {
    const h = await start();
    await openRecap(h);
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fan-summary') }, delta('## Кто'), { kind: 'stall' }] });
    const first = await h.dispatch({ type: 'RefreshRecap', length: 'full' });
    await h.clock.advance(50);
    await h.dispatch({ type: 'HideResult', operationId: (first as { opId: string }).opId });
    expect(h.dock().analysis).toBeNull();
    const again = await h.dispatch({ type: 'RefreshRecap', length: 'full' });
    expect(again).toMatchObject({ ok: true, outcome: 'noop', opId: (first as { opId: string }).opId });
    expect(h.bg.callsOf('op.start')).toHaveLength(1);
    expect(h.dock().analysis).toBe('recap');
    // The strip button reopens the sheet on the running build.
    await h.dispatch({ type: 'HideResult', operationId: (first as { opId: string }).opId });
    await h.generate('recap');
    expect(h.recapView()).toMatchObject({ state: 'streaming', opId: (first as { opId: string }).opId });
    expect(await h.ai.command('cancel')).toMatchObject({ kind: 'dispatched', receipt: { ok: true } });
    await h.settle();
    expect(h.recapView().state).toBeNull();
    expect(h.recapView().view.s).toBe('empty');
  });

  it('a failed build shows its error with «Обновить» as the retry; the saved copy is not lost', async () => {
    const h = await start({ background: (bg) => (bg.sharedRecaps = { full: body(), short: null, fullSavedToProfile: true }) });
    await openRecap(h);
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fan-summary') }, { kind: 'frame', frame: { type: 'error', code: 'provider_new_failure', message: 'Something new', retryAfterMs: null } }] });
    await h.dispatch({ type: 'RefreshRecap', length: 'full' });
    await h.finish();
    const failed = h.recapView();
    expect(failed.view).toMatchObject({ s: 'error', retry: { type: 'RefreshRecap', length: 'full' } });
    expect(failed).toMatchObject({ state: 'failed', markdown: null });
    // The copy of the hub's recap is still in its slot.
    expect(h.recapPicker().slots.full?.generatedAt).toBe(FULL_AT);
    expect(await h.dispatch({ type: 'ShowRecap', length: 'full' })).toMatchObject({ ok: true, outcome: 'opened' });
    expect(h.recapView()).toMatchObject({ markdown: FULL_TEXT, state: null });
  });

  it('[AI-051] a short conversation that is loaded whole cannot have a full recap; the short one can still be built', async () => {
    const h = await start();
    h.host.setWindow({ ...(memory.chatWindows[0] as (typeof memory.chatWindows)[number]), loaded: 12, fanMessages: 6, modelMessages: 6, hasOlder: false }, openChat);
    await openRecap(h);
    const picker = h.recapPicker();
    expect(picker.build.full).toMatchObject({ enabled: false, hotkey: null });
    expect(picker.build.full.reason).toMatchObject({ id: 'no-history', code: 'CG-GATE-HISTORY' });
    expect(picker.build.short.enabled).toBe(true);
    expect(await h.dispatch({ type: 'RefreshRecap', length: 'full' })).toMatchObject({ ok: false, code: 'CG-GATE-HISTORY' });
    expect(h.bg.callsOf('op.start')).toEqual([]);
  });

  it('the Recap key opens the sheet, and with the sheet open it builds the shown length', async () => {
    const h = await start();
    expect(await h.ai.command('recap')).toMatchObject({ kind: 'dispatched', action: { type: 'Generate', feature: 'recap' }, receipt: { ok: true, outcome: 'opened' } });
    await h.settle();
    expect(h.bg.callsOf('op.start')).toEqual([]);
    h.bg.hub.profileScript.push(saved);
    h.script(recapStream(FULL_TEXT));
    expect(await h.ai.command('recap')).toMatchObject({ kind: 'dispatched', action: { type: 'RefreshRecap', length: 'full' }, receipt: { ok: true, outcome: 'started' } });
    await h.finish();
    expect((h.bg.callsOf('op.start')[0] as { cause: { kind: string } }).cause.kind).toBe('key');
    expect(h.recapView().markdown).toBe(FULL_TEXT);
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

  it('[AI-068] the hub is not ready yet: «сохраняю», and the link write repeats by the schedule without a new generation', async () => {
    const h = await start();
    h.bg.hub.profileScript.push({ state: 'not-ready' }, { state: 'not-ready' }, saved);
    const view = await built(h);
    expect(view.saved).toEqual({ s: 'saving' });
    expect(h.bg.hub.profiles).toHaveLength(1);
    await h.clock.advance(5_000);
    expect(h.bg.hub.profiles).toHaveLength(2);
    expect(h.recapView().saved).toEqual({ s: 'saving' });
    await h.clock.advance(15_000);
    expect(h.bg.hub.profiles).toHaveLength(3);
    expect(h.recapView().saved).toMatchObject({ s: 'saved' });
    expect(h.bg.hub.streams).toHaveLength(1);
    // 5 s, 15 s, 60 s, then every 3 minutes up to 30 minutes.
    expect(saveSchedule().slice(0, 4)).toEqual([5_000, 20_000, 80_000, 260_000]);
    expect(Math.max(...saveSchedule())).toBeLessThanOrEqual(30 * 60_000);
  });

  it('[AI-067] the save failed: CG-RECAP-SAVE with «Сохранить ещё раз», which repeats only the link write', async () => {
    const h = await start();
    h.bg.hub.profileScript.push({ state: 'rejected', reason: 'generation_not_found' });
    const view = await built(h);
    expect(view.saved).toMatchObject({ s: 'failed', error: { code: 'CG-RECAP-SAVE' }, retry: { type: 'RetryRecapSave', length: 'full' } });
    // The recap itself is fine and shown.
    expect(view.markdown).toBe(FULL_TEXT);
    expect(await h.dispatch({ type: 'RetryRecapSave', length: 'full' })).toMatchObject({ ok: true, type: 'RetryRecapSave', outcome: 'done' });
    expect(h.bg.callsOf('recap.save')).toEqual([{ pageId: WORLD.pages.one.pageId, fanRef: HOST_IDS.fan, generationRef: uuid(0x200), opId: view.opId }]);
    expect(h.recapView().saved).toMatchObject({ s: 'saved' });
    expect(h.bg.hub.streams).toHaveLength(1);
    expect(h.bg.callsOf('op.start')).toHaveLength(1);
  });

  it('«Сохранить ещё раз» that fails again stays CG-RECAP-SAVE; a short recap has nothing to save', async () => {
    const h = await start();
    h.bg.hub.profileScript.push('error');
    await built(h);
    h.bg.saveAnswers.push({ error: { code: 'CG-HUB-UNAVAILABLE' } });
    expect(await h.dispatch({ type: 'RetryRecapSave', length: 'full' })).toMatchObject({ ok: false, code: 'CG-RECAP-SAVE' });
    expect(h.recapView().saved).toMatchObject({ s: 'failed' });
    expect(await h.dispatch({ type: 'RetryRecapSave', length: 'short' })).toMatchObject({ ok: false, code: 'CG-RECAP-NOT-FOUND' });
  });

  it('[AI-068] a full recap of the hub that the dossier does not hold yet is sent after — the link write only, by the schedule', async () => {
    const h = await start({ background: (bg) => (bg.sharedRecaps = { full: body(), short: null, fullSavedToProfile: false }) });
    h.bg.saveAnswers.push({ state: 'not-ready', savedAt: null }, { state: 'not-ready', savedAt: null }, { state: 'saved', savedAt: '2026-10-03T10:00:20.000Z' });
    await openRecap(h);
    expect(h.bg.callsOf('recap.save')).toEqual([{ pageId: WORLD.pages.one.pageId, fanRef: HOST_IDS.fan, generationRef: uuid(0x700) }]);
    expect(h.recapView().saved).toEqual({ s: 'saving' });
    await h.clock.advance(5_000);
    expect(h.bg.callsOf('recap.save')).toHaveLength(2);
    await h.clock.advance(14_999);
    expect(h.bg.callsOf('recap.save')).toHaveLength(2);
    await h.clock.advance(1);
    expect(h.bg.callsOf('recap.save')).toHaveLength(3);
    expect(h.recapView().saved).toEqual({ s: 'saved', at: '2026-10-03T10:00:20.000Z' });
    expect(h.bg.callsOf('op.start')).toEqual([]);
  });

  it('the port came back while a save was waiting for the background: the link write is asked again from the tab', async () => {
    const h = await start();
    // The hub is not ready; the background's saver waits for its next attempt — and is lost with the event page.
    h.bg.hub.profileScript.push({ state: 'not-ready' });
    const view = await built(h);
    expect(view.saved).toEqual({ s: 'saving' });
    h.bg.setConnection('reconnecting');
    h.bg.setConnection('ready');
    await h.settle();
    expect(h.bg.callsOf('recap.save')).toEqual([{ pageId: WORLD.pages.one.pageId, fanRef: HOST_IDS.fan, generationRef: uuid(0x200), opId: view.opId }]);
    expect(h.recapView().saved).toMatchObject({ s: 'saved' });
    expect(h.bg.hub.streams).toHaveLength(1);
  });

  it('a refusal of the link write is not repeated by itself; the schedule stops when the tab\'s surfaces are disposed', async () => {
    const h = await start({ background: (bg) => (bg.sharedRecaps = { full: body(), short: null, fullSavedToProfile: false }) });
    h.bg.saveAnswers.push({ state: 'rejected', savedAt: null });
    await openRecap(h);
    expect(h.recapView().saved).toMatchObject({ s: 'failed' });
    await h.clock.advance(30 * 60_000);
    expect(h.bg.callsOf('recap.save')).toHaveLength(1);

    const other = await start({ background: (bg) => (bg.sharedRecaps = { full: body(), short: null, fullSavedToProfile: false }) });
    other.bg.saveAnswers.push({ state: 'not-ready', savedAt: null });
    await openRecap(other);
    other.ai.dispose();
    await other.clock.advance(30 * 60_000);
    expect(other.bg.callsOf('recap.save')).toHaveLength(1);
  });
});

describe('recap: the status line of the hub and the archive lag', () => {
  it('[AI-061] [UI-010] the «Recap готов» dot comes from the hub\'s status — asked only once the chat stayed open', async () => {
    const h = await start({ background: (bg) => (bg.recapStatus = { full: { generatedAt: FULL_AT, ageMs: 3_600_000, transcriptCoverage: 'full-history', requestedCount: 3000, keptCount: 812 }, short: null }) });
    expect(h.dock().actions.recap.badge).toBeNull();
    expect(h.bg.callsOf('recap.status')).toEqual([]);
    await h.clock.advance(RECAP_STATUS.settleMs);
    expect(h.bg.callsOf('recap.status')).toEqual([{ pageId: WORLD.pages.one.pageId, fanRef: HOST_IDS.fan, personaDefinitionId: WORLD.persona.definitionId }]);
    expect(h.dock().actions.recap.badge).toBe('recap-ready');
    // Metadata only: no generation, no text read.
    expect(h.bg.callsOf('op.start')).toEqual([]);
    expect(h.bg.callsOf('recap.read')).toEqual([]);
    // Kept: a later look asks nothing again.
    await h.clock.advance(60_000);
    expect(h.bg.callsOf('recap.status')).toHaveLength(1);
  });

  it('[AI-061] a failed status read is not asked again by itself — only on a new visit of the chat or «Повторить»', async () => {
    const h = await start({ background: (bg) => (bg.recapStatus = { error: { code: 'CG-HUB-UNAVAILABLE' } }) });
    await h.clock.advance(RECAP_STATUS.settleMs);
    expect(h.bg.callsOf('recap.status')).toHaveLength(1);
    expect(h.dock().actions.recap.badge).toBeNull();
    // Minutes with the dock mounted and redrawn (within the ten the answer is kept): still the one read.
    for (let i = 0; i < 9; i += 1) {
      h.ai.workspace.bump();
      await h.clock.advance(60_000);
    }
    expect(h.bg.callsOf('recap.status')).toHaveLength(1);
    // «Повторить» of the dock asks again — once.
    h.bg.recapStatus = { full: { generatedAt: FULL_AT, ageMs: 3_600_000, transcriptCoverage: 'full-history', requestedCount: 3000, keptCount: 812 }, short: null };
    await h.dispatch({ type: 'ReloadView', selector: { of: 'dock' } });
    await h.clock.advance(RECAP_STATUS.settleMs);
    expect(h.bg.callsOf('recap.status')).toHaveLength(2);
    expect(h.dock().actions.recap.badge).toBe('recap-ready');

    // A new visit of the chat asks what failed before.
    const other = await start({ background: (bg) => (bg.recapStatus = { error: { code: 'CG-HUB-TIMEOUT' } }) });
    await other.clock.advance(5 * 60_000);
    expect(other.bg.callsOf('recap.status')).toHaveLength(1);
    other.host.openChat(previewChat);
    await other.settle();
    other.host.openChat(openChat);
    await other.clock.advance(RECAP_STATUS.settleMs);
    expect(other.bg.callsOf('recap.status')).toHaveLength(2);
    await other.clock.advance(5 * 60_000);
    expect(other.bg.callsOf('recap.status')).toHaveLength(2);
  });

  it('[AI-061] flipping through chats asks the hub nothing', async () => {
    const h = await start();
    await h.clock.advance(RECAP_STATUS.settleMs - 100);
    h.host.openChat(previewChat);
    await h.clock.advance(RECAP_STATUS.settleMs + 100);
    // The chat that was left is not asked about; the other one has no window yet and asks nothing either.
    expect(h.bg.callsOf('recap.status')).toEqual([]);
  });

  it('[NEW-02] [AI-070] «архив отстаёт от чата на K сообщений»: the page holds messages after the recap\'s archive point', async () => {
    const h = await start();
    h.bg.hub.profileScript.push(saved);
    const tail: LiveTextTail = {
      capturedAt: hostIso(0),
      messages: [
        { platformMessageId: HOST_IDS.messages.fanEarlier, direction: 'fan', sentAt: hostIso(-300), text: 'a' },
        { platformMessageId: HOST_IDS.messages.fanBefore, direction: 'fan', sentAt: hostIso(-60), text: 'b' },
        { platformMessageId: HOST_IDS.messages.fanAfter, direction: 'fan', sentAt: hostIso(-10), text: 'c' },
      ],
    };
    h.host.setTail(openChat, tail);
    await openRecap(h);
    // The hub served the archive up to the first of the three visible messages.
    h.script(recapStream(FULL_TEXT, [context(HOST_IDS.messages.fanEarlier, -300)]));
    await h.dispatch({ type: 'RefreshRecap', length: 'full' });
    await h.finish();
    const view = h.recapView();
    expect(view.archiveLag).toEqual({ messages: 2 });
    expect(view.view).toEqual({ s: 'partial', gaps: [{ kind: 'archive-lag', messages: 2, minutes: null }] });
    expect(view.stamp.asOf).toBe(hostIso(-300));
    // Nothing of the page went to the hub to count that.
    expect(h.bg.hub.streams[0]?.body.liveTextContext).toBeUndefined();

    // The archive caught up: no lag.
    h.host.setTail(openChat, { ...tail, messages: tail.messages.slice(0, 1) });
    await h.settle();
    expect(h.recapView().archiveLag).toBeNull();
    expect(h.recapView().view).toEqual({ s: 'ready' });
  });

  it('[AI-070] a saved recap older than the newest page message is behind, by a number when the tail shows it', async () => {
    const h = await start({ background: (bg) => (bg.sharedRecaps = { full: body({ generatedAt: hostIso(-120) }), short: null, fullSavedToProfile: true }) });
    h.host.setTail(openChat, {
      capturedAt: hostIso(0),
      messages: [
        { platformMessageId: HOST_IDS.messages.fanEarlier, direction: 'fan', sentAt: hostIso(-300), text: 'a' },
        { platformMessageId: HOST_IDS.messages.fanBefore, direction: 'fan', sentAt: hostIso(-60), text: 'b' },
      ],
    });
    await openRecap(h);
    expect(h.recapView().archiveLag).toEqual({ messages: 1 });
    // Every visible message is newer: more may be above the tail — the number is not known.
    h.host.setTail(openChat, { capturedAt: hostIso(0), messages: [{ platformMessageId: HOST_IDS.messages.fanBefore, direction: 'fan', sentAt: hostIso(-60), text: 'b' }] });
    await h.settle();
    expect(h.recapView().archiveLag).toEqual({ messages: null });
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

  it('every action the recap views offer is a valid UiAction', async () => {
    const h = await start({ background: (bg) => (bg.sharedRecaps = { full: body(), short: shortBody(), fullSavedToProfile: false }) });
    h.bg.saveAnswers.push({ state: 'rejected', savedAt: null });
    await openRecap(h);
    const actions: unknown[] = [];
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === 'object' && value !== null) {
        const record = value as Record<string, unknown>;
        if (typeof record['type'] === 'string' && /^[A-Z]/.test(record['type'])) actions.push(record);
        Object.values(record).forEach(walk);
      }
    };
    walk(h.recapView());
    walk(h.recapPicker());
    expect(actions.length).toBeGreaterThan(4);
    for (const action of actions) expect(UiActionSchema.safeParse(action).success, JSON.stringify(action)).toBe(true);
  });
});

describe('review', () => {
  const run = async (h: Harness, text: string = REVIEW, extra: readonly HubFrame[] = []): Promise<string> => {
    h.script(reviewStream(text, extra));
    const receipt = await h.generate('review');
    if (!receipt.ok || receipt.opId === undefined) throw new Error(`not started: ${JSON.stringify(receipt)}`);
    await h.finish();
    return receipt.opId;
  };

  it('[AI-050] Review grades the conversation over the deep window of the hub archive, without page text', async () => {
    const h = await start();
    expect(h.review()).toMatchObject({ opId: null, state: null, rating: null, sections: [], raw: null, unparsed: false, copyHandle: null });
    expect(h.review().view.s).toBe('empty');
    h.script(reviewStream(REVIEW));
    const receipt = await h.generate('review');
    expect(receipt).toMatchObject({ ok: true, outcome: 'started' });
    const started = h.bg.callsOf('op.start')[0] as { feature: string; surface: string; window: number; split: boolean; tone: unknown; fresh?: unknown };
    expect(started).toMatchObject({ feature: 'review', surface: 'dock', window: 3000, split: false, tone: null });
    expect(started.fresh).toBeUndefined();
    expect(h.host.reads.tail).toBe(0);
    expect(h.bg.hub.streams[0]).toMatchObject({ feature: 'chat-review', body: { messageCount: 3000 } });
    expect(h.bg.hub.streams[0]?.body.replyMode).toBeUndefined();
    expect(h.dock()).toMatchObject({ analysis: 'review', result: null });
    expect(h.dock().actions.review).toMatchObject({ busy: true, active: true });

    // The stream is a preview without the XML frame.
    await h.clock.advance(120);
    const running = h.review();
    expect(running.view).toMatchObject({ s: 'loading', since: NOW_MS });
    expect(running).toMatchObject({ state: 'streaming', rating: null, sections: [], copyHandle: null });
    expect(running.streamText).not.toMatch(/<\/?(rating|evaluation)/);
    expect(running.regenerate).toMatchObject({ enabled: false });
    await h.finish();
    expect(h.review().state).toBe('done');
  });

  it('[AI-053] the result is N/10 with «Вердикт / Деньги / Персона / Ошибки / Что работает», «Как надо было», then the recommendations', async () => {
    const h = await start();
    const opId = await run(h);
    const vm: ReviewVM = h.review();
    expect(vm.view).toEqual({ s: 'ready' });
    expect(vm).toMatchObject({ opId, state: 'done', rating: 7, lead: 'Коротко о диалоге.', raw: REVIEW, unparsed: false, phase: null, streamText: null, targetName: 'Fan Two' });
    expect(vm.sections.map((section) => `${section.kind}:${section.title.key}`)).toEqual([
      'verdict:review.section.verdict',
      'money:review.section.money',
      'persona:review.section.persona',
      'mistakes:review.section.mistakes',
      'works:review.section.works',
      'recommendations:review.section.recommendations',
    ]);
    expect(vm.sections[0]?.body).toBe('Диалог тёплый, но апселл пришёл рано.');
    expect(vm.sections[3]?.items).toEqual([{ body: 'Оффер сразу после чаевых: "want more?" — давит.', example: 'missed you today, want to see what I saved?', exampleWhere: 'после "[Photo]"', afterExample: 'Это мягче.' }]);
    expect(vm.sections[5]).toMatchObject({ body: 'Общий совет.', items: [{ body: 'Вместо оффера в лоб делай разогрев.', example: null }] });
    expect(vm.facts[0]).toEqual({ key: 'review.madeNow' });
    // Nothing of a Review is a message to the fan: no parts, no insert, Split does not apply (NEW-04).
    expect(vm.splitReason.id).toBe('not-a-message');
    expect(h.dock().result).toBeNull();
    expect(await h.dispatch({ type: 'InsertPart', operationId: opId, part: 0 })).toMatchObject({ ok: false, code: 'CG-OUTPUT-UNUSABLE' });
    expect(h.host.draftOf(openChat)?.plainText).toBe('');
  });

  it('[AI-052] an answer whose frame does not read is shown raw — not as an error', async () => {
    const h = await start();
    const raw = 'Диалог хороший. Оценка: 8 из 10. Продолжай в том же духе.';
    await run(h, raw);
    const vm = h.review();
    expect(vm.view).toEqual({ s: 'ready' });
    expect(vm).toMatchObject({ state: 'done', rating: null, raw, unparsed: true, sections: [], lead: null });
    expect(vm.copyHandle).not.toBeNull();
  });

  it('[AI-054] Copy writes the formatted text without the frame; «Ещё раз» asks again past the cache', async () => {
    const h = await start();
    const opId = await run(h);
    const vm = h.review();
    expect(readArtifactHandle(vm.copyHandle as string)).toEqual({ kind: 'review', opId });
    expect(await h.dispatch({ type: 'Copy', artifactHandle: vm.copyHandle as string })).toMatchObject({ ok: true });
    expect(h.clipboard.texts[0]?.startsWith('7/10\n\nКоротко о диалоге.')).toBe(true);
    expect(h.clipboard.texts[0]).not.toMatch(/<\/?(rating|evaluation|recommendations)>/);
    // `copied` is reported for the operation as a whole: a review has no parts.
    expect(h.bg.callsOf('op.reportCopy')).toEqual([{ opId }]);

    expect(vm.regenerate).toMatchObject({ enabled: true, label: { key: 'common.again' }, action: { type: 'Regenerate', operationId: opId } });
    expect(vm.regenerate.hotkey?.display).toBe('⌘⇧B');
    h.script(reviewStream(REVIEW.replace('<rating>7</rating>', '<rating>9</rating>')));
    const again = await h.dispatch(vm.regenerate.action);
    expect(again).toMatchObject({ ok: true, type: 'Regenerate', outcome: 'started' });
    await h.finish();
    expect(h.bg.callsOf('op.start')[1]).toMatchObject({ feature: 'review', force: true, regenerateOf: opId });
    expect(h.bg.hub.streams).toHaveLength(2);
    expect(h.review().rating).toBe(9);
  });

  it('the same click reopens the same review without a new generation; «Скрыть» keeps it', async () => {
    const h = await start();
    const opId = await run(h);
    expect(await h.dispatch({ type: 'HideResult', operationId: opId })).toMatchObject({ ok: true });
    expect(h.dock().analysis).toBeNull();
    const again = await h.generate('review');
    expect(again).toMatchObject({ ok: true, outcome: 'noop', opId });
    expect(h.bg.hub.streams).toHaveLength(1);
    expect(h.dock().analysis).toBe('review');
    expect(h.review().rating).toBe(7);
    expect(await h.dispatch({ type: 'ExpandResult', operationId: opId, expanded: true })).toMatchObject({ ok: true, outcome: 'opened' });
    expect(h.review().expanded).toBe(true);
  });

  it('[AI-051] Review needs history: off for a short conversation that is loaded whole, and the hub\'s own gate is an error with its code', async () => {
    const h = await start();
    h.host.setWindow({ ...(memory.chatWindows[0] as (typeof memory.chatWindows)[number]), loaded: 12, fanMessages: 6, modelMessages: 6, hasOlder: false }, openChat);
    await h.settle();
    expect(await h.generate('review')).toMatchObject({ ok: false, code: 'CG-GATE-HISTORY' });
    expect(h.bg.callsOf('op.start')).toEqual([]);

    const other = await start();
    other.script({ kind: 'http-error', status: 409, body: { error: 'gate_min_messages' } });
    await other.generate('review');
    await other.finish();
    const failed = other.review();
    expect(failed.state).toBe('failed');
    expect(failed.view).toMatchObject({ s: 'error', error: { code: 'CG-GATE-HISTORY' }, retry: { type: 'Regenerate', operationId: failed.opId } });
  });

  it('[NEW-02] the review stands on the archive: the facts name its point and the lag behind the page', async () => {
    const h = await start();
    h.host.setTail(openChat, {
      capturedAt: hostIso(0),
      messages: [
        { platformMessageId: HOST_IDS.messages.fanEarlier, direction: 'fan', sentAt: hostIso(-300), text: 'a' },
        { platformMessageId: HOST_IDS.messages.fanBefore, direction: 'fan', sentAt: hostIso(-60), text: 'b' },
      ],
    });
    await run(h, REVIEW, [context(HOST_IDS.messages.fanEarlier, -300)]);
    const vm = h.review();
    expect(vm.stamp.asOf).toBe(hostIso(-300));
    expect(vm.facts).toContainEqual({ key: 'review.archiveAsOf', params: { time: { time: hostIso(-300) } } });
    expect(vm.view).toEqual({ s: 'partial', gaps: [{ kind: 'archive-lag', messages: 1, minutes: null }] });
    // The window the hub served is only known in debug mode: it is never guessed from the request.
    expect(vm.window).toBeNull();
    expect(vm.meta).toEqual([]);
  });

  it('the window the hub served is shown once its context frame says it (debug mode)', async () => {
    const h = await start({ settings: { ...settingsWithPersona(), debug: { enabled: true, renderTrace: false } } });
    await run(h, REVIEW, [contextFrame({ window: { requested: 3000, served: 412 }, coverage: 'partial' })]);
    const vm = h.review();
    expect(vm.window).toEqual({ messages: 412 });
    expect(vm.meta).toEqual([{ key: 'review.meta', params: { n: 412, name: 'Fan Two' } }]);
    expect(vm.stamp.coverage).toBe('partial');
    expect(vm.view).toMatchObject({ s: 'partial', gaps: [{ kind: 'coverage', level: 'partial' }] });
    // [DB-020] the debug block itself only in the expanded sheet.
    expect(vm.debug).toBeNull();
    await h.dispatch({ type: 'ExpandResult', operationId: vm.opId as string, expanded: true });
    expect(h.review().debug).not.toBeNull();
  });

  it('[DB-020] a Recap built in debug mode shows its debug block only when the sheet is expanded', async () => {
    const h = await start({ settings: { ...settingsWithPersona(), debug: { enabled: true, renderTrace: false } } });
    h.bg.hub.profileScript.push(saved);
    await openRecap(h);
    h.script(recapStream(FULL_TEXT));
    await h.dispatch({ type: 'RefreshRecap', length: 'full' });
    await h.finish();
    expect(h.recapView()).toMatchObject({ markdown: FULL_TEXT, expanded: false, debug: null });
    await h.dispatch({ type: 'ExpandResult', operationId: h.recapView().opId as string, expanded: true });
    expect(h.recapView().expanded).toBe(true);
    expect(h.recapView().debug).not.toBeNull();
  });

  it('the Review key starts it; while it runs the key brings the sheet back and ⌘. cancels', async () => {
    const h = await start();
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('chat-review') }, { kind: 'stall' }] });
    const outcome = await h.ai.command('review');
    expect(outcome).toMatchObject({ kind: 'dispatched', receipt: { ok: true, outcome: 'started' } });
    const opId = (outcome as { receipt: { opId: string } }).receipt.opId;
    await h.dispatch({ type: 'HideResult', operationId: opId });
    expect(await h.ai.command('review')).toMatchObject({ kind: 'dispatched', receipt: { ok: true, outcome: 'noop', opId } });
    expect(h.dock().analysis).toBe('review');
    expect(await h.ai.command('cancel')).toMatchObject({ kind: 'dispatched', receipt: { ok: true } });
    await h.settle();
    expect(h.review()).toMatchObject({ opId: null, state: null });
    expect(h.dock().actions.review).toMatchObject({ busy: false });
  });

  it('a review belongs to its chat: another chat shows none, and «Ещё раз» of it is refused there', async () => {
    const h = await start();
    const opId = await run(h);
    h.host.setWindow({ ...(memory.chatWindows[0] as (typeof memory.chatWindows)[number]), chat: previewChat }, previewChat);
    h.host.openChat(previewChat);
    await h.settle();
    expect(h.review()).toMatchObject({ opId: null, rating: null });
    expect(await h.dispatch({ type: 'Regenerate', operationId: opId })).toMatchObject({ ok: false, code: 'CG-CONTEXT-CHANGED' });
    expect(h.bg.callsOf('op.start')).toHaveLength(1);
  });
});

describe('recap: a fresh build and the hub\'s clock', () => {
  it('«Обновить» shows the recap it has just built even when this computer\'s clock is behind the hub\'s stamp of the saved one', async () => {
    const ahead = new Date(NOW_MS + 60_000).toISOString();
    const h = await start({ background: (bg) => (bg.sharedRecaps = { full: body({ generatedAt: ahead, text: 'Старый рекап.' }), short: null, fullSavedToProfile: true }) });
    h.bg.hub.profileScript.push(saved);
    await openRecap(h);
    expect(h.recapView()).toMatchObject({ markdown: 'Старый рекап.', generatedAt: ahead });
    h.script(recapStream(FULL_TEXT));
    expect(await h.dispatch(h.recapView().refresh.action)).toMatchObject({ ok: true, outcome: 'started' });
    await h.finish();
    expect(h.bg.hub.streams).toHaveLength(1);
    // The paid result is what the sheet shows — not the older text under a «done».
    expect(h.recapView()).toMatchObject({ state: 'done', markdown: FULL_TEXT });
    expect(h.recapView().generatedAt).not.toBe(ahead);
    // The hub does not list it yet and answers the older recap once more: the new one stays.
    await h.dispatch({ type: 'ReloadView', selector: { of: 'recap.view' } });
    await h.settle();
    expect(h.bg.callsOf('recap.read')).toHaveLength(2);
    expect(h.recapView().markdown).toBe(FULL_TEXT);
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
    expect(h.bg.callsOf('recap.read')).toEqual([]);
    expect(h.bg.callsOf('op.start')).toEqual([]);
  });
});

describe('persona change: nothing of the old persona comes back', () => {
  const OTHER_PERSONA = { key: 'other', definitionId: WORLD.persona.otherDefinitionId };
  const A_TEXT = 'Рекап персоны A.';

  /** A full recap and a review, both made under the first persona. */
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
    expect(h.review().rating).toBe(7);
  }

  it('[AI-126] the next visit of the chat does not bring the old persona\'s Recap and Review back', async () => {
    const h = await start();
    await madeUnderFirst(h);
    h.bg.changePersona(WORLD.pages.one.pageId, OTHER_PERSONA);
    await h.settle();
    // The sheets of the old persona closed and show nothing.
    expect(h.dock().analysis).toBeNull();
    expect(h.review()).toMatchObject({ opId: null, rating: null });
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
    expect(h.review()).toMatchObject({ opId: null, rating: null, raw: null });
    expect(h.review().view.s).toBe('empty');
    await openRecap(h);
    expect(h.bg.callsOf('recap.read').at(-1)).toMatchObject({ personaDefinitionId: OTHER_PERSONA.definitionId });
    expect(h.recapView()).toMatchObject({ markdown: null, view: { s: 'empty' } });
    expect(h.recapPicker().slots).toEqual({ short: null, full: null });
    await h.clock.advance(RECAP_STATUS.settleMs);
    expect(h.dock().actions.recap.badge).toBeNull();
    expect(JSON.stringify([h.recapView(), h.recapPicker(), h.review()])).not.toContain(A_TEXT);
  });

  it('[AI-126] a tab opened after the change adopts the old results without their persona: they are not shown as the new one\'s', async () => {
    const h = await start();
    await madeUnderFirst(h);
    h.bg.changePersona(WORLD.pages.one.pageId, OTHER_PERSONA);
    await h.settle();
    const later = await readyHarness(parts(), { shared: { bg: h.bg, clock: h.clock, tab: OTHER_TAB } });
    later.mount({ of: 'recap.view' });
    later.mount({ of: 'recap.picker' });
    later.mount({ of: 'review' });
    await later.settle();
    // It did read what the background holds of this chat.
    expect(later.ai.workspace.ops.ofChat(chatKeyOf(openChat)).map((record) => record.view.feature).sort()).toEqual(['recap', 'review']);
    expect(later.review()).toMatchObject({ opId: null, rating: null });
    await openRecap(later);
    expect(later.recapView()).toMatchObject({ markdown: null, view: { s: 'empty' } });
    expect(later.recapPicker().slots).toEqual({ short: null, full: null });
    await later.clock.advance(RECAP_STATUS.settleMs);
    expect(later.dock().actions.recap.badge).toBeNull();
  });

  it('a recap of the same persona made in another tab is the hub\'s shared one: it comes with `recap.read`, never by a guess', async () => {
    const h = await start();
    h.bg.hub.profileScript.push(saved);
    await openRecap(h);
    h.script(recapStream(A_TEXT));
    await h.dispatch({ type: 'RefreshRecap', length: 'full' });
    await h.finish();
    const generation = h.ai.workspace.ops.all()[0]?.view.generationRef ?? '';
    const later = await readyHarness(parts(), { shared: { bg: h.bg, clock: h.clock, tab: OTHER_TAB } });
    later.mount({ of: 'recap.view' });
    await later.settle();
    // Adopted finished, persona unknown: not a local copy yet.
    expect(later.dock().actions.recap.badge).toBeNull();
    h.bg.sharedRecaps = { full: body({ generationRef: generation, text: A_TEXT }), short: null, fullSavedToProfile: true };
    await openRecap(later);
    expect(later.recapView()).toMatchObject({ markdown: A_TEXT, view: { s: 'ready' } });
  });
});

