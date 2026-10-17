// The Coach controller over the fake tab RPC (the real scheduler with R11's
// drivers), @cg/testing's FakeHostPort and the fake hub's frames: opening
// the panel, the empty state and its chips, a turn from the question to the
// answer with drafts, inserting a draft part (Б2, the language gate), the
// history sent back, sessions and «Новый диалог», «приложить мой ответ»,
// failures and cancel, the auto-recap as one composite turn, «Обновить
// переписку» and the archive lag, and the panel yielding to other features.

import { describe, expect, it } from 'vitest';

import { COACH_LIMITS, UiActionSchema, chatKeyOf, type Bootstrap, type CoachTurnVM, type FeedPage, type HubFrame, type RecapStatus, type SettingsV1 } from '@cg/contracts';
import { COACH_RECAP_FRESH_MS } from '@cg/core/domain/coach';
import { createTranslator } from '@cg/core/domain/i18n';
import { createFakeCatalog, ctxOf } from '@cg/testing/app-client';
import { FakeHostPort, HOST_IDS, hostIso, memory, openChat, previewChat, startSnapshot } from '@cg/testing/host';
import { BOOTSTRAP_PILOT_PAGES, contextFrame, hubServing, meta, resolveHubErrorReference, pageFeaturesOff } from '@cg/testing/hub';

import { settingsWithPersona } from './support/ai-background';
import { delta, doneStep, readyHarness, type Harness, type HarnessOptions, type HarnessParts } from './support/ai-harness';
import { type ScriptResponse } from './support/fake-hub';
import { CHATSPACE_RECORDED } from './support/chatspace-recorded';
import { NOW_MS, WORLD, session, uuid } from './support/world';

function parts(): HarnessParts & { readonly fake: FakeHostPort } {
  const fake = new FakeHostPort({ start: startSnapshot, memory, checkpoint: null, answers: {}, timeline: [] });
  return {
    fake,
    baseHost: fake,
    memory,
    catalog: createFakeCatalog(ctxOf({ now: NOW_MS })),
    bootstrap: BOOTSTRAP_PILOT_PAGES,
    resolve: resolveHubErrorReference,
    meta: (feature) => meta(feature as Parameters<typeof meta>[0]),
  };
}

type CoachHarness = Harness & { readonly fake: FakeHostPort };

/** The panel is mounted, as on the page: it is read again on every change. */
async function start(options: HarnessOptions = {}): Promise<CoachHarness> {
  const p = parts();
  const h = Object.assign(await readyHarness(p, options), { fake: p.fake });
  h.mount({ of: 'coach' });
  return h;
}

const withCoach = (coach: Partial<SettingsV1['generation']['coach']>): SettingsV1 => {
  const base = settingsWithPersona();
  return { ...base, generation: { ...base.generation, coach: { ...base.generation.coach, ...coach } } };
};

const RU = createTranslator('ru');
const i18nText = (key: string): string => RU.text(key as Parameters<typeof RU.text>[0]);

const fence = (body: string): string => ['```draft', body, '```'].join('\n');
const ANSWER = ['Сначала согрей, потом предложи.', fence('hey you [NEXT] how was the weekend?'), fence('I saved something for you')].join('\n');

const coachStream = (text: string, extra: readonly HubFrame[] = []): ScriptResponse => ({
  kind: 'stream',
  steps: [{ kind: 'frame', frame: meta('coach-chat'), afterMs: 100 }, ...extra.map((frame) => ({ kind: 'frame' as const, frame })), delta(text.slice(0, 20), 100), delta(text.slice(20), 100), doneStep],
});
const recapStream = (text: string): ScriptResponse => ({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fan-summary') }, delta(text, 100), doneStep] });

const ask = (h: Harness, question: string, extra: { attachMyDraft?: boolean } = {}): ReturnType<Harness['generate']> => h.generate('coach', { question, ...extra });

/** One finished exchange. */
async function exchange(h: Harness, question: string, answer: string = ANSWER): Promise<string> {
  h.script(coachStream(answer));
  const receipt = await ask(h, question);
  if (!receipt.ok || receipt.opId === undefined) throw new Error(`not asked: ${JSON.stringify(receipt)}`);
  await h.finish();
  return receipt.opId;
}

const lastTurn = (h: Harness): CoachTurnVM => {
  const turn = h.coach().turns.at(-1);
  if (turn === undefined) throw new Error('no turn');
  return turn;
};

const status = (over: Partial<RecapStatus> = {}): RecapStatus => ({ full: null, short: null, ...over });
const slot = (ageMs: number, requestedCount: number | null = 3000): NonNullable<RecapStatus['full']> => ({ generatedAt: new Date(NOW_MS - ageMs).toISOString(), ageMs, transcriptCoverage: 'full-history', requestedCount, keptCount: 500 });

const feed = (over: Partial<FeedPage> = {}): FeedPage => ({
  target: { pageLabel: WORLD.pages.one.pageLabel, fanRef: HOST_IDS.fan },
  source: 'archive',
  snapshotRevision: 'snap-1',
  asOf: hostIso(0),
  coverage: 'complete',
  head: { messageRef: HOST_IDS.messages.fanBefore, at: hostIso(-60), sender: 'fan' },
  newestKnownAt: hostIso(-60),
  nextOlderCursor: null,
  items: [],
  summary: null,
  ...over,
});

describe('coach: the debug footer of a turn', () => {
  const usage: HubFrame = { type: 'usage', usage: { inputTokens: 3412, outputTokens: 286, cacheWriteTokens: 0, cacheReadTokens: 3000, costMicroUsd: 14_300, costApproximate: false }, providerResponseId: null, cacheHit: false };

  it('[DB-019] in debug mode a turn carries its debug footer — the live timer while it waits, then time, tokens, cost and the stage profile; without debug mode there is none', async () => {
    const h = await start({ settings: { ...settingsWithPersona(), debug: { enabled: true, renderTrace: false } } });
    h.script(coachStream(ANSWER, [usage]));
    await ask(h, 'what next?');
    await h.clock.advance(150);
    // The wait: only the live timer is known (DB-012).
    expect(lastTurn(h).debug).toMatchObject({ liveTimer: true, costLine: null });
    await h.finish();
    const done = lastTurn(h);
    expect(done.state).toBe('done');
    expect(done.debug?.liveTimer).toBe(false);
    expect(done.debug?.costLine?.replace(/\s/gu, ' ')).toContain('in 3 412 tok • out 286 tok');
    expect(done.debug?.costLine).toContain('$0.0143');
    expect(done.debug?.stages.map((stage) => stage.name)).toContain('meta');
    // The footer of a finished turn is built once: a later redraw hands out the same view.
    h.ai.workspace.bump();
    await h.settle();
    expect(lastTurn(h)).toBe(done);

    // Debug mode off: no footer, and nothing of the cost in the panel.
    const plain = await start();
    plain.script(coachStream(ANSWER, [usage]));
    await ask(plain, 'what next?');
    await plain.finish();
    expect(lastTurn(plain).debug ?? null).toBeNull();
    expect(JSON.stringify(plain.coach())).not.toMatch(/tok|\$0\.0/);
  });

  it('[DB-019] switching debug mode off takes the footer of the turns already there away; a turn made without it has none to show later', async () => {
    const h = await start({ settings: { ...settingsWithPersona(), debug: { enabled: true, renderTrace: false } } });
    h.script(coachStream(ANSWER, [usage]));
    await ask(h, 'what next?');
    await h.finish();
    expect(lastTurn(h).debug).not.toBeNull();
    h.bg.changeSettings({ debug: { enabled: false } });
    await h.settle();
    expect(lastTurn(h).debug ?? null).toBeNull();
    expect(JSON.stringify(h.coach())).not.toMatch(/tok|\$0\.0/);

    // Made without debug mode: the background kept no stages and no usage for it — nothing is invented afterwards.
    const plain = await start();
    plain.script(coachStream(ANSWER, [usage]));
    await ask(plain, 'what next?');
    await plain.finish();
    plain.bg.changeSettings({ debug: { enabled: true } });
    await plain.settle();
    expect(lastTurn(plain).debug ?? null).toBeNull();
  });
});

describe('coach: opening and the empty dialog', () => {
  it('[AI-080] the Coach button opens the panel and generates nothing', async () => {
    const h = await start();
    const receipt = await h.generate('coach');
    expect(receipt).toMatchObject({ ok: true, type: 'Generate', outcome: 'opened' });
    expect(h.overlays.opened).toEqual(['coach']);
    expect(h.bg.callsOf('op.start')).toEqual([]);
    expect(h.bg.callsOf('token.issue')).toEqual([]);
    // The key does the same.
    expect(await h.ai.command('coach')).toMatchObject({ kind: 'dispatched', receipt: { ok: true, outcome: 'opened' } });
    expect(h.overlays.opened).toEqual(['coach', 'coach']);
    expect(h.bg.callsOf('op.start')).toEqual([]);
  });

  it('[AI-081] an empty dialog: «Новый диалог», the ready questions, the first one is the hub\'s «разбор ситуации»', async () => {
    const h = await start();
    await h.generate('coach');
    const vm = h.coach();
    expect(vm.view).toEqual({ s: 'empty', why: { key: 'coach.empty.title' } });
    expect(vm).toMatchObject({ targetName: 'Fan Two', turns: [], historyLimit: 10, recap: null });
    expect(vm.chips).toEqual([
      { label: { key: 'coach.chip.situation' }, question: 'Что сейчас в чате?', preset: 'situation' },
      { label: { key: 'coach.chip.offer' }, question: 'Что предложить?', preset: null },
    ]);
    // Three headings of three ready questions, as in the predecessor: a click fills the input, the person sends.
    expect(vm.hints?.map((group) => [i18nText(group.label.key), group.questions.map((question) => question.question)])).toEqual([
      ['Продать', ['Не знаю, как продать — подскажи', 'Как подать цену, чтобы не спугнуть?', 'Просит скидку — что ответить?']],
      ['Вернуть', ['Как оживить остывший чат?', 'Прочитал и молчит — что написать?', 'Пропал после цены — как вернуть?']],
      ['Понять', ['Что этому фану реально заходит?', 'Разбери его: что за человек?', 'О чём говорить, кроме продаж?']],
    ]);
    expect(vm.hints?.flatMap((group) => group.questions.map((question) => question.label.key))).toEqual([
      'coach.hint.sell.how', 'coach.hint.sell.price', 'coach.hint.sell.discount',
      'coach.hint.return.revive', 'coach.hint.return.seen', 'coach.hint.return.afterPrice',
      'coach.hint.understand.likes', 'coach.hint.understand.person', 'coach.hint.understand.topics',
    ]);
    // None of them asks by itself: nothing was started by showing them.
    expect(h.bg.callsOf('op.start')).toEqual([]);
    expect(vm.ask).toMatchObject({ enabled: true, reason: null });
    expect(vm.newDialog).toMatchObject({ enabled: true, action: { type: 'NewCoachDialog' } });
    expect(vm.freshness).toMatchObject({ asOf: null, lag: null, refresh: { enabled: true, action: { type: 'RefreshArchive' } } });
  });

  it('[AI-081] the «разбор ситуации» chip asks with the preset: the hub holds its question, the dialog shows the chip\'s words', async () => {
    const h = await start();
    h.script(coachStream('СИТУАЦИЯ: фан остыл.\nЧТО УПУЩЕНО: вопрос про отпуск.\nСЛЕДУЮЩИЙ ХОД: спросить.\nРИСК: уйдёт.'));
    // The click as the panel dispatches it: the chip's own words and its preset (ui overlays/coach `ask(chip.question, chip.preset)`).
    const chip = h.coach().chips[0];
    expect(chip).toMatchObject({ question: 'Что сейчас в чате?', preset: 'situation' });
    const receipt = await h.generate('coach', { question: chip?.question ?? '', preset: 'situation' });
    expect(receipt).toMatchObject({ ok: true, outcome: 'started' });
    await h.finish();
    const started = h.bg.callsOf('op.start')[0] as { coach: { question?: string; preset?: string; history: unknown[] } };
    expect(started.coach).toEqual({ question: 'Что сейчас в чате?', preset: 'situation', history: [] });
    // The hub gets the preset alone: it answers 400 to a body that names both («preset forbids chatterQuestion»).
    expect(h.bg.hub.streams[0]?.body).toMatchObject({ preset: 'situation' });
    expect(h.bg.hub.streams[0]?.body.chatterQuestion).toBeUndefined();
    const turn = lastTurn(h);
    expect(turn.question).toBe('Что сейчас в чате?');
    // [AI-084] the pinned labels come as blocks.
    expect(turn.answer?.blocks).toEqual([
      { kind: 'situation', title: { key: 'coach.block.situation' }, body: 'фан остыл.' },
      { kind: 'missed', title: { key: 'coach.block.missed' }, body: 'вопрос про отпуск.' },
      { kind: 'move', title: { key: 'coach.block.move' }, body: 'спросить.' },
      { kind: 'risk', title: { key: 'coach.block.risk' }, body: 'уйдёт.' },
    ]);
  });

  it('[AI-081] a ready question the person sent is an ordinary question; once the dialog has a turn the headings are gone', async () => {
    const h = await start();
    const hint = h.coach().hints?.[1]?.questions[0];
    expect(hint).toEqual({ label: { key: 'coach.hint.return.revive' }, question: 'Как оживить остывший чат?' });
    h.script(coachStream(ANSWER));
    // What the UI does after the person pressed «Спросить» with the filled input.
    expect(await ask(h, hint?.question as string)).toMatchObject({ ok: true, outcome: 'started' });
    expect((h.bg.callsOf('op.start')[0] as { coach: { question?: string; preset?: string } }).coach).toMatchObject({ question: 'Как оживить остывший чат?' });
    expect((h.bg.callsOf('op.start')[0] as { coach: { preset?: string } }).coach.preset).toBeUndefined();
    expect(h.coach().hints).toEqual([]);
    await h.finish();
    expect(h.coach().hints).toEqual([]);
    // «Новый диалог» is empty again: the headings are back, in the language of the interface.
    await h.dispatch({ type: 'NewCoachDialog' });
    expect(h.coach().hints).toHaveLength(3);
    const en = await start({ language: 'en' });
    expect(en.coach().hints?.[0]).toMatchObject({ label: { key: 'coach.group.sell' }, questions: [{ question: 'I don\'t know how to sell here — help me' }, {}, {}] });
  });

  it('the Coach switch of the owner off: the panel says «недоступно» and nothing is asked', async () => {
    const off: Bootstrap = pageFeaturesOff(BOOTSTRAP_PILOT_PAGES, ['coach']);
    const h = await start({ bootstrap: off });
    expect(h.coach().view).toMatchObject({ s: 'forbidden', error: { code: 'CG-FEATURE-DISABLED' } });
    expect(h.coach().ask).toMatchObject({ enabled: false });
    expect(h.coach().ask.reason?.id).toBe('feature-disabled');
    expect(await ask(h, 'q')).toMatchObject({ ok: false, code: 'CG-FEATURE-DISABLED' });
    expect(h.bg.callsOf('op.start')).toEqual([]);
  });
});

describe('coach: a turn', () => {
  it('[AI-082] a question goes to the Coach as typed, trimmed; an empty one or one past 2000 characters is not asked', async () => {
    const h = await start();
    h.script(coachStream(ANSWER));
    const receipt = await ask(h, '  How do I bring him back?  ');
    expect(receipt).toMatchObject({ ok: true, type: 'Generate', outcome: 'started' });
    const started = h.bg.callsOf('op.start')[0] as { feature: string; surface: string; window: number; tone: unknown; coach: unknown; fresh?: unknown; cause: { kind: string } };
    expect(started).toMatchObject({ feature: 'coach', surface: 'coach', window: 100, tone: null, coach: { question: 'How do I bring him back?', history: [] } });
    expect(h.bg.callsOf('token.issue')).toEqual([{ kind: 'generate', surface: 'coach' }]);
    // X52: the open chat's fresh tail goes with the question, as with a draft feature; the draft is not read.
    expect(started.fresh).toMatchObject({ messages: [{ platformMessageId: '4004', direction: 'fan', text: 'hey' }] });
    expect(h.host.reads.tail).toBe(1);
    expect(h.host.reads.draft).toBe(0);
    expect(h.bg.hub.streams[0]).toMatchObject({ feature: 'coach-chat', body: { chatterQuestion: 'How do I bring him back?', messageCount: 100 } });
    expect(h.bg.hub.streams[0]?.body.liveTextContext?.items).toEqual([{ platformMessageId: '4004', direction: 'fan', occurredAt: '2026-10-03T09:59:00.000Z', text: 'hey' }]);
    await h.finish();

    // Whitespace alone opens the panel instead of asking; too long a question never passes the UI contract.
    expect(UiActionSchema.safeParse({ type: 'Generate', targetHandle: h.dock().targetHandle, feature: 'coach', options: { question: 'x'.repeat(COACH_LIMITS.questionMaxChars + 1) } }).success).toBe(false);
    expect(UiActionSchema.safeParse({ type: 'Generate', targetHandle: h.dock().targetHandle, feature: 'coach', options: { question: 'x'.repeat(COACH_LIMITS.questionMaxChars) } }).success).toBe(true);
    const turns = h.coach().turns;
    let redraws = 0;
    const off = h.ai.coach.subscribe({ of: 'coach' }, () => (redraws += 1));
    expect(await ask(h, '   ')).toMatchObject({ ok: false, code: 'CG-UI-FAILED' });
    off();
    expect(h.bg.callsOf('op.start')).toHaveLength(1);
    // Not even for a moment did a turn of it appear in the dialog.
    expect(redraws).toBe(0);
    expect(h.coach().turns).toEqual(turns);
    expect(h.bg.callsOf('token.issue')).toHaveLength(1);
  });

  it('[AI-083] [AI-093] the waiting turn: «Отправлено коучу…» until the hub\'s first frame, then the stages and a preview', async () => {
    const h = await start();
    h.script(coachStream(ANSWER));
    const receipt = await ask(h, 'How do I reply?');
    const opId = (receipt as { opId: string }).opId;
    let turn = lastTurn(h);
    expect(turn).toMatchObject({ opId, question: 'How do I reply?', askedAt: NOW_MS, state: 'requesting', sentToCoach: true, streamText: null, answer: null, error: null, attachedDraft: false, outsideMemory: false });
    expect(turn.phase?.stages).toEqual([{ id: 'context', label: { key: 'result.stage.context' }, state: 'current' }]);
    expect(turn.phase?.startedAt).toBe(NOW_MS);
    expect(turn.phase?.cancel).toEqual({ type: 'CancelGeneration', operationId: opId });
    // While the Coach answers nothing else is asked, and the dialog is not restarted.
    expect(h.coach().view).toEqual({ s: 'ready' });
    expect(h.coach().ask).toMatchObject({ enabled: false });
    expect(h.coach().ask.reason).toMatchObject({ id: 'coach-busy', code: 'CG-OP-COACH-BUSY' });
    expect(h.coach().newDialog).toMatchObject({ enabled: false });

    await h.clock.advance(100);
    turn = lastTurn(h);
    // The hub answered: the wait is over, the stage line goes on.
    expect(turn).toMatchObject({ state: 'streaming', sentToCoach: false, streamText: null });
    expect(turn.phase?.stages.map((stage) => `${stage.id}:${stage.state}`)).toEqual(['context:done', 'thinking:current']);
    await h.clock.advance(100);
    turn = lastTurn(h);
    expect(turn.state).toBe('streaming');
    // The preview shows neither the draft fence nor a piece of it.
    expect(turn.streamText).toBe('Сначала согрей, пото');
    await h.finish();
    expect(lastTurn(h)).toMatchObject({ state: 'done', phase: null, streamText: null, sentToCoach: false });
  });

  it('[AI-084] [AI-085] the answer is advice plus up to two drafts, each split into parts that insert and copy like any part', async () => {
    const h = await start();
    const opId = await exchange(h, 'How do I reply?');
    const vm = h.coach();
    expect(vm.view).toEqual({ s: 'ready' });
    expect(vm.turns).toHaveLength(1);
    const turn = lastTurn(h);
    expect(turn).toMatchObject({ opId, state: 'done', question: 'How do I reply?', error: null, errorActions: [] });
    expect(turn.answer?.prose).toBe('Сначала согрей, потом предложи.');
    expect(turn.answer?.blocks).toBeNull();
    expect(turn.answer?.drafts.map((draft) => ({ index: draft.index, label: draft.label, parts: draft.parts.map((part) => part.text) }))).toEqual([
      { index: 0, label: { key: 'coach.draft', params: { n: 1 } }, parts: ['hey you', 'how was the weekend?'] },
      { index: 1, label: { key: 'coach.draft', params: { n: 2 } }, parts: ['I saved something for you'] },
    ]);
    const first = turn.answer?.drafts[0]?.parts[0];
    expect(first).toMatchObject({ index: 0, numbered: true, insert: 'idle', copy: 'idle', insertBlocked: null });
    expect(await h.dispatch({ type: 'Copy', artifactHandle: first?.copyHandle as string })).toMatchObject({ ok: true });
    expect(h.clipboard.texts).toEqual(['hey you']);
    expect(h.bg.callsOf('op.reportCopy')).toEqual([{ opId, part: { variant: 0, index: 0 } }]);
    // The follow-up chips replace the opening ones (AI-094).
    expect(vm.chips.map((chip) => chip.question)).toEqual(['Другой вариант', 'Сделай короче', 'А если откажет?']);
    expect(vm.chips.every((chip) => chip.preset === null)).toBe(true);
    // The dock's result sheet is not the Coach's: its answer lives in the panel.
    expect(h.dock().result).toBeNull();
  });

  it('[AI-086] a draft part goes into an empty field at once, and the panel folds so the field and Send are in view', async () => {
    const h = await start();
    const opId = await exchange(h, 'How do I reply?');
    const receipt = await h.dispatch({ type: 'InsertPart', operationId: opId, variant: 1, part: 0 });
    expect(receipt).toMatchObject({ ok: true, outcome: 'done' });
    expect(h.fake.calls.inserts[0]).toMatchObject({ operationId: opId, part: { variant: 1, index: 0 }, mode: 'replace', text: 'I saved something for you', confirmationId: null, target: openChat });
    expect(h.host.draftOf(openChat)?.plainText).toBe('I saved something for you');
    expect(h.overlays.closed).toEqual(['coach']);
    expect(lastTurn(h).answer?.drafts[1]?.parts[0]).toMatchObject({ insert: 'done' });
  });

  it('[AI-086] the person\'s own text in the field: the question «Заменить / Добавить в конец / Отмена» first, the panel folds only after the write', async () => {
    // A Coach draft keeps its question after X45 (Reply, Hi, Ping and Fix replace at once): as in the old Fansly extension.
    const h = await start();
    const opId = await exchange(h, 'How do I reply?');
    h.host.type('my own words');
    await h.settle();
    const receipt = await h.dispatch({ type: 'InsertPart', operationId: opId, variant: 0, part: 0 });
    expect(receipt).toMatchObject({ ok: true, outcome: 'needs-confirm' });
    expect(h.fake.calls.inserts).toHaveLength(0);
    expect(h.overlays.closed).toEqual([]);
    // The question is on the turn, where the UI reads it: which part, why, and the id the answer takes.
    const confirm = lastTurn(h).confirm;
    expect(confirm).toMatchObject({ kind: 'human-draft', part: { variant: 0, index: 0 }, formatLoss: false });
    const confirmationId = confirm?.confirmationId as string;
    expect(confirmationId).toMatch(/^[0-9a-f-]{36}$/);
    // It names the part the way the part's own view does.
    const part = lastTurn(h).answer?.drafts[0]?.parts[0];
    expect({ variant: part?.variant, index: part?.index }).toEqual(confirm?.part);
    expect(await h.dispatch({ type: 'AnswerConfirm', confirmationId, choice: 'replace' })).toMatchObject({ ok: true, outcome: 'done' });
    expect(h.fake.calls.inserts[0]).toMatchObject({ mode: 'replace', text: 'hey you', confirmationId });
    expect(h.overlays.closed).toEqual(['coach']);
    expect(lastTurn(h).confirm).toBeNull();
    expect(lastTurn(h).answer?.drafts[0]?.parts[0]).toMatchObject({ insert: 'done' });
  });

  it('[AI-086] «Добавить в конец» and «Отмена» of a Coach draft: the answer is read from the turn; a turn without a question carries none', async () => {
    const h = await start();
    const first = await exchange(h, 'How do I reply?');
    // Nothing is asked: neither on a finished exchange, nor on a turn that still runs or failed.
    expect(lastTurn(h).confirm).toBeNull();
    h.host.type('my own words');
    await h.settle();
    // The second draft of the first answer.
    expect(await h.dispatch({ type: 'InsertPart', operationId: first, variant: 1, part: 0 })).toMatchObject({ ok: true, outcome: 'needs-confirm' });
    const asked = h.coach().turns[0]?.confirm;
    expect(asked).toMatchObject({ kind: 'human-draft', part: { variant: 1, index: 0 } });
    expect(await h.dispatch({ type: 'AnswerConfirm', confirmationId: asked?.confirmationId as string, choice: 'cancel' })).toMatchObject({ ok: true, outcome: 'noop' });
    expect(h.coach().turns[0]?.confirm).toBeNull();
    expect(h.fake.calls.inserts).toHaveLength(0);
    expect(h.overlays.closed).toEqual([]);

    await h.dispatch({ type: 'InsertPart', operationId: first, variant: 1, part: 0 });
    const again = h.coach().turns[0]?.confirm;
    expect(again?.confirmationId).not.toBe(asked?.confirmationId);
    expect(await h.dispatch({ type: 'AnswerConfirm', confirmationId: again?.confirmationId as string, choice: 'append' })).toMatchObject({ ok: true, outcome: 'done' });
    expect(h.fake.calls.inserts[0]).toMatchObject({ mode: 'append', text: 'I saved something for you', part: { variant: 1, index: 0 } });
    expect(h.overlays.closed).toEqual(['coach']);

    // A turn in flight and a failed turn ask nothing.
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('coach-chat') }, { kind: 'stall' }] });
    await ask(h, 'second');
    expect(lastTurn(h)).toMatchObject({ state: 'streaming', confirm: null });
    await h.dispatch(lastTurn(h).phase?.cancel as never);
    expect(lastTurn(h)).toMatchObject({ state: 'canceled', confirm: null });
  });

  it('[AI-087] a draft in Cyrillic is not inserted for a fan who does not write Cyrillic — copy stays', async () => {
    const h = await start();
    const opId = await exchange(h, 'Что ему написать?', ['Напиши теплее.', fence('привет, как выходные?'), fence('hey, how was the weekend?')].join('\n'));
    await h.settle();
    const drafts = lastTurn(h).answer?.drafts ?? [];
    expect(drafts[0]?.parts[0]?.insertBlocked).toMatchObject({ id: 'language', code: 'CG-GATE-LANGUAGE' });
    expect(drafts[1]?.parts[0]?.insertBlocked).toBeNull();
    expect(await h.dispatch({ type: 'InsertPart', operationId: opId, variant: 0, part: 0 })).toMatchObject({ ok: false, code: 'CG-GATE-LANGUAGE' });
    expect(h.fake.calls.inserts).toHaveLength(0);
    expect((await h.dispatch({ type: 'Copy', artifactHandle: drafts[0]?.parts[0]?.copyHandle as string })).ok).toBe(true);
    expect(h.clipboard.texts).toEqual(['привет, как выходные?']);

    // Only the fan's own lines are the signal: once the fan wrote Cyrillic the draft may go.
    h.host.setTail(openChat, { capturedAt: hostIso(0), messages: [{ platformMessageId: HOST_IDS.messages.fanBefore, direction: 'fan', sentAt: hostIso(-60), text: 'привет' }] });
    await h.settle();
    expect(lastTurn(h).answer?.drafts[0]?.parts[0]?.insertBlocked).toBeNull();
    expect(await h.dispatch({ type: 'InsertPart', operationId: opId, variant: 0, part: 0 })).toMatchObject({ ok: true, outcome: 'done' });
  });

  it('[AI-087] the chatter\'s own Cyrillic or the model\'s side is not a signal', async () => {
    const h = await start();
    h.host.setTail(openChat, {
      capturedAt: hostIso(0),
      messages: [
        { platformMessageId: HOST_IDS.messages.fanBefore, direction: 'fan', sentAt: hostIso(-60), text: 'hey' },
        { platformMessageId: HOST_IDS.messages.sent, direction: 'model', sentAt: hostIso(-30), text: 'привет' },
      ],
    });
    h.host.type('мой черновик');
    const opId = await exchange(h, 'Что написать?', fence('привет'));
    await h.settle();
    expect(lastTurn(h).answer?.drafts[0]?.parts[0]?.insertBlocked?.id).toBe('language');
    expect(await h.dispatch({ type: 'InsertPart', operationId: opId, variant: 0, part: 0 })).toMatchObject({ ok: false, code: 'CG-GATE-LANGUAGE' });
  });
});

describe('coach: history and sessions', () => {
  it('[AI-088] [AI-094] the finished exchanges go back as history, oldest first, up to the limit of the settings; what is beyond it is marked', async () => {
    const h = await start({ settings: withCoach({ historyLimit: 2 }) });
    await exchange(h, 'first', 'answer one');
    await exchange(h, 'second', 'answer two');
    await exchange(h, 'third', ['answer three', fence('hey')].join('\n'));
    await exchange(h, 'fourth', 'answer four');
    const starts = h.bg.callsOf('op.start') as { coach: { question: string; history: { question: string; answer: string }[] } }[];
    expect(starts.map((s) => s.coach.history.map((turn) => turn.question))).toEqual([[], ['first'], ['first', 'second'], ['second', 'third']]);
    // The raw finished answer is what is replayed — with its draft fence.
    expect(starts[3]?.coach.history[1]?.answer).toBe(['answer three', fence('hey')].join('\n'));
    expect(h.bg.hub.streams[3]?.body.coachHistory).toEqual(starts[3]?.coach.history);
    expect(h.coach().historyLimit).toBe(2);
    // [AI-094] «выше не входит в память»: turns beyond the limit are marked.
    expect(h.coach().turns.map((turn) => turn.outsideMemory)).toEqual([true, true, false, false]);
  });

  it('[AI-088] a long answer is replayed as its head and tail with the omission between', async () => {
    const h = await start();
    const long = `${'a'.repeat(7_000)} ${'b'.repeat(7_000)}`;
    await exchange(h, 'long one', long);
    await exchange(h, 'next', 'short');
    const history = (h.bg.callsOf('op.start')[1] as { coach: { history: { answer: string }[] } }).coach.history;
    expect(history[0]?.answer.length).toBeLessThan(long.length);
    expect(history[0]?.answer).toContain('chars omitted');
    expect(history[0]?.answer.startsWith('a'.repeat(6_000))).toBe(true);
    expect(history[0]?.answer.endsWith('b'.repeat(3_800))).toBe(true);
  });

  it('[AI-089] the dialog belongs to its chat: another chat has its own, and coming back finds the first', async () => {
    const h = await start();
    await exchange(h, 'about fan two');
    h.host.setWindow({ ...(memory.chatWindows[0] as (typeof memory.chatWindows)[number]), chat: previewChat }, previewChat);
    h.host.openChat(previewChat);
    await h.settle();
    expect(h.coach().turns).toEqual([]);
    expect(h.coach().view.s).toBe('empty');
    await exchange(h, 'about fan three', 'other answer');
    expect((h.bg.callsOf('op.start')[1] as { coach: { history: unknown[] }; target: { chat: unknown } }).coach.history).toEqual([]);
    expect((h.bg.callsOf('op.start')[1] as { target: { chat: unknown } }).target.chat).toEqual(previewChat);
    h.host.openChat(openChat);
    await h.settle();
    expect(h.coach().turns.map((turn) => turn.question)).toEqual(['about fan two']);
    // The answer of the kept dialog is still actionable.
    expect(lastTurn(h).answer?.drafts[0]?.parts.map((part) => part.text)).toEqual(['hey you', 'how was the weekend?']);
  });

  it('[AI-089] at most five dialogs are kept: the least recently used goes first', async () => {
    const h = await start();
    const fans = ['2101', '2102', '2103', '2104', '2105', '2106'];
    for (const fan of fans) {
      const chat = { ...openChat, platformFanId: fan };
      h.host.setWindow({ ...(memory.chatWindows[0] as (typeof memory.chatWindows)[number]), chat }, chat);
      h.host.openChat(chat);
      await h.settle();
      await exchange(h, `about ${fan}`, 'ok');
    }
    h.host.openChat({ ...openChat, platformFanId: '2101' });
    await h.settle();
    expect(h.coach().turns).toEqual([]);
    h.host.openChat({ ...openChat, platformFanId: '2102' });
    await h.settle();
    expect(h.coach().turns.map((turn) => turn.question)).toEqual(['about 2102']);
  });

  it('[AI-089] a change of persona or sign-in wipes the dialogs it belonged to', async () => {
    const h = await start();
    await exchange(h, 'under the first persona');
    h.bg.changePersona(WORLD.pages.one.pageId, { key: 'other', definitionId: WORLD.persona.otherDefinitionId });
    await h.settle();
    expect(h.coach().turns).toEqual([]);
    await exchange(h, 'under the second persona', 'ok');
    expect((h.bg.callsOf('op.start')[1] as { coach: { history: unknown[] } }).coach.history).toEqual([]);
    // Back to the first persona: its dialog is gone for good.
    h.bg.changePersona(WORLD.pages.one.pageId, { key: WORLD.persona.key, definitionId: WORLD.persona.definitionId });
    await h.settle();
    expect(h.coach().turns).toEqual([]);

    const other = await start();
    await exchange(other, 'before the sign-out');
    other.bg.changeSession(null, 'sign-out');
    await other.settle();
    other.bg.changeSession({ ...session, epoch: session.epoch + 2 }, 'sign-in');
    await other.settle();
    expect(other.coach().turns).toEqual([]);
  });

  it('[AI-089] the persona changed while a question was on its way: the dialog is gone, and its answer is not left running for nobody', async () => {
    const h = await start();
    h.bg.held.add('token.issue');
    const asking = ask(h, 'How do I reply?');
    await h.settle();
    expect(lastTurn(h)).toMatchObject({ question: 'How do I reply?', opId: null });
    h.bg.changePersona(WORLD.pages.one.pageId, { key: 'other', definitionId: WORLD.persona.otherDefinitionId });
    await h.settle();
    expect(h.coach().turns).toEqual([]);
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('coach-chat') }, { kind: 'stall' }] });
    h.bg.held.clear();
    h.bg.release();
    expect(await asking).toMatchObject({ ok: false, code: 'CG-CONTEXT-CHANGED' });
    await h.settle();
    expect(h.bg.callsOf('op.cancel')).toHaveLength(1);
    expect(h.bg.scheduler.active()).toEqual([]);
    expect(h.coach().turns).toEqual([]);
    expect(h.coach().ask.enabled).toBe(true);
  });

  it('[AI-089] the dialog survives what is not a change of persona or sign-in: a port that came back, a re-read of the same sign-in', async () => {
    const h = await start();
    await exchange(h, 'kept question');
    h.bg.setConnection('reconnecting');
    await h.settle();
    h.bg.setConnection('ready');
    await h.settle();
    expect(h.coach().turns.map((turn) => turn.question)).toEqual(['kept question']);
    h.bg.changeSession(session, 'sign-in');
    await h.settle();
    expect(h.coach().turns.map((turn) => turn.question)).toEqual(['kept question']);
    // Another setting changing is not a persona change either.
    h.bg.changeSettings({ ui: { hints: false } });
    await h.settle();
    expect(h.coach().turns).toHaveLength(1);
    expect(lastTurn(h).answer?.drafts).toHaveLength(2);
  });

  it('[AI-090] «Новый диалог» starts clean — nothing of the old one is sent as history; not while the Coach answers', async () => {
    const h = await start();
    await exchange(h, 'old question');
    expect(await h.dispatch({ type: 'NewCoachDialog' })).toMatchObject({ ok: true, type: 'NewCoachDialog' });
    const fresh = h.coach();
    expect(fresh.turns).toEqual([]);
    expect(fresh.view.s).toBe('empty');
    expect(fresh.chips[0]?.preset).toBe('situation');
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('coach-chat') }, { kind: 'stall' }] });
    await ask(h, 'new question');
    expect((h.bg.callsOf('op.start')[1] as { coach: { history: unknown[] } }).coach.history).toEqual([]);
    expect(h.coach().newDialog).toMatchObject({ enabled: false });
    expect(h.coach().newDialog.reason?.id).toBe('coach-busy');
    expect(await h.dispatch({ type: 'NewCoachDialog' })).toMatchObject({ ok: false, code: 'CG-OP-COACH-BUSY' });
    expect(h.coach().turns.map((turn) => turn.question)).toEqual(['new question']);
  });

  it('[AI-091] «Приложить мой ответ»: the composer\'s draft is read once and goes with that one turn only', async () => {
    const h = await start();
    expect(h.coach().ask.attachDraft).toMatchObject({ available: false });
    expect(h.coach().ask.attachDraft.reason?.id).toBe('needs-draft');
    h.host.type('i mis you so much');
    await h.settle();
    expect(h.coach().ask.attachDraft).toEqual({ available: true, reason: null });
    h.script(coachStream('Хороший ответ, но поправь опечатку.'));
    await ask(h, 'Is my answer fine?', { attachMyDraft: true });
    await h.finish();
    expect(h.host.reads.draft).toBe(1);
    expect((h.bg.callsOf('op.start')[0] as { coach: { attachDraft?: string }; draft?: unknown; fresh?: unknown }).coach.attachDraft).toBe('i mis you so much');
    expect(h.bg.hub.streams[0]?.body.draftText).toBe('i mis you so much');
    // It is the person's own draft, not fresh page text: the tail is the page's messages alone.
    expect(h.bg.hub.streams[0]?.body.liveTextContext?.items.map((item) => item.text)).toEqual(['hey']);
    expect(lastTurn(h).attachedDraft).toBe(true);

    // The next question goes without it, and the draft is not read again.
    h.script(coachStream('Да.'));
    await ask(h, 'And now?');
    await h.finish();
    expect(h.host.reads.draft).toBe(1);
    expect((h.bg.callsOf('op.start')[1] as { coach: { attachDraft?: string } }).coach.attachDraft).toBeUndefined();
    expect(h.bg.hub.streams[1]?.body.draftText).toBeUndefined();
    expect(lastTurn(h).attachedDraft).toBe(false);
  });

  it('[AI-091] an empty field or an unreadable draft: the question still goes, without the attachment', async () => {
    const h = await start();
    h.host.type('typed');
    h.host.failDraftRead = true;
    h.script(coachStream('Ок.'));
    expect(await ask(h, 'Is it fine?', { attachMyDraft: true })).toMatchObject({ ok: true });
    await h.finish();
    expect((h.bg.callsOf('op.start')[0] as { coach: { attachDraft?: string } }).coach.attachDraft).toBeUndefined();
    expect(lastTurn(h).state).toBe('done');
  });
});

describe('coach: failures, cancel, a question that is not lost', () => {
  it('[AI-092] a failed turn keeps its question with «Повторить»; the partial answer is not kept and is never sent as history', async () => {
    const h = await start();
    await exchange(h, 'first', 'answer one');
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('coach-chat') }, delta('half an ans'), { kind: 'frame', frame: { type: 'error', code: 'provider_new_failure', message: 'Something new', retryAfterMs: null } }] });
    const receipt = await ask(h, 'second');
    await h.finish();
    const failed = lastTurn(h);
    expect(failed).toMatchObject({ opId: (receipt as { opId: string }).opId, question: 'second', state: 'failed', answer: null, streamText: null, phase: null });
    expect(failed.error?.code).toBe('CG-PROVIDER-UNKNOWN');
    const retry = failed.errorActions[0];
    expect(retry?.action).toEqual({ type: 'Generate', targetHandle: h.dock().targetHandle, feature: 'coach', options: { question: 'second' } });
    // The dialog can go on.
    expect(h.coach().ask.enabled).toBe(true);
    h.script(coachStream('answer two'));
    expect(await h.dispatch(retry?.action as never)).toMatchObject({ ok: true, outcome: 'started' });
    await h.finish();
    const history = (h.bg.callsOf('op.start')[2] as { coach: { history: { question: string; answer: string }[] } }).coach.history;
    expect(history).toEqual([{ question: 'first', answer: 'answer one' }]);
    expect(JSON.stringify(history)).not.toContain('half an ans');
    // The new attempt replaces the failed line of the same question: one line per question.
    expect(h.coach().turns.map((turn) => `${turn.question}:${turn.state}`)).toEqual(['first:done', 'second:done']);
  });

  it('[AI-092] «Остановлено вами»: a canceled turn is not an error and can simply be asked again', async () => {
    const h = await start();
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('coach-chat') }, delta('half'), { kind: 'stall' }] });
    await ask(h, 'How do I reply?');
    await h.clock.advance(50);
    const cancel = lastTurn(h).phase?.cancel;
    expect(await h.dispatch(cancel as never)).toMatchObject({ ok: true, type: 'CancelGeneration' });
    const turn = lastTurn(h);
    expect(turn).toMatchObject({ question: 'How do I reply?', state: 'canceled', error: null, answer: null, streamText: null });
    expect(turn.errorActions).toHaveLength(1);
    expect(turn.errorActions[0]).toMatchObject({ enabled: true, label: { key: 'common.retry' }, action: { type: 'Generate', feature: 'coach', options: { question: 'How do I reply?' } } });
    expect(h.coach().ask.enabled).toBe(true);
    // ⌘. is the same cancel.
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('coach-chat') }, { kind: 'stall' }] });
    await ask(h, 'again');
    expect(await h.ai.command('cancel')).toMatchObject({ kind: 'dispatched', receipt: { ok: true } });
    await h.settle();
    expect(lastTurn(h).state).toBe('canceled');
  });

  it('[AI-092] an answer with neither advice nor a draft is not saved as an exchange', async () => {
    const h = await start();
    h.script(coachStream('<think>nothing to say</think>'));
    await ask(h, 'first');
    await h.finish();
    expect(lastTurn(h)).toMatchObject({ state: 'failed', answer: null });
    expect(lastTurn(h).error?.code).toBe('CG-OUTPUT-UNUSABLE');
    h.script(coachStream('answer'));
    await ask(h, 'second');
    await h.finish();
    expect((h.bg.callsOf('op.start')[1] as { coach: { history: unknown[] } }).coach.history).toEqual([]);
    // Still the opening chips: no exchange finished before this one.
    expect(h.coach().chips).toHaveLength(3);
  });

  it('[AI-099] a refused question leaves no turn behind: it stays with the person', async () => {
    const h = await start();
    // The chat is busy with a Reply: the Coach cannot start now.
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fast-reply') }, { kind: 'stall' }] });
    await h.generate('reply');
    expect(h.coach().ask).toMatchObject({ enabled: false });
    expect(h.coach().ask.reason?.id).toBe('chat-busy');
    const refused = await ask(h, 'How do I reply?');
    expect(refused).toMatchObject({ ok: false, type: 'Generate', code: 'CG-OP-CHAT-BUSY' });
    expect(h.coach().turns).toEqual([]);
    // One question at a time.
    await h.ai.command('cancel');
    await h.settle();
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('coach-chat') }, { kind: 'stall' }] });
    await ask(h, 'first');
    expect(await ask(h, 'second')).toMatchObject({ ok: false, code: 'CG-OP-COACH-BUSY' });
    expect(h.coach().turns.map((turn) => turn.question)).toEqual(['first']);
    // The second question never reached the background.
    expect((h.bg.callsOf('op.start') as { coach?: { question: string } }[]).filter((call) => call.coach !== undefined).map((call) => call.coach?.question)).toEqual(['How do I reply?', 'first']);
    expect(h.bg.hub.streams.map((stream) => stream.feature)).toEqual(['fast-reply', 'coach-chat']);
  });

  it('[AI-099] «Повторить» that is refused keeps the failed turn: its line and its question are not lost', async () => {
    const h = await start();
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('coach-chat') }, { kind: 'frame', frame: { type: 'error', code: 'provider_new_failure', message: 'Something new', retryAfterMs: null } }] });
    await ask(h, 'How do I reply?');
    await h.finish();
    const failed = lastTurn(h);
    expect(failed).toMatchObject({ question: 'How do I reply?', state: 'failed' });
    // The chat got busy with a Reply meanwhile: the retry cannot start now.
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fast-reply') }, { kind: 'stall' }] });
    await h.generate('reply');
    expect(await h.dispatch(failed.errorActions[0]?.action as never)).toMatchObject({ ok: false, code: 'CG-OP-CHAT-BUSY' });
    expect(h.coach().turns.map((turn) => `${turn.question}:${turn.state}`)).toEqual(['How do I reply?:failed']);
    expect(lastTurn(h).errorActions[0]?.action).toMatchObject({ type: 'Generate', feature: 'coach', options: { question: 'How do I reply?' } });
  });

  it('[AI-099] a question for another chat than the open one is not asked', async () => {
    const h = await start();
    const handle = h.dock().targetHandle as string;
    h.host.setWindow({ ...(memory.chatWindows[0] as (typeof memory.chatWindows)[number]), chat: previewChat }, previewChat);
    h.host.openChat(previewChat);
    await h.settle();
    expect(await h.dispatch({ type: 'Generate', targetHandle: handle, feature: 'coach', options: { question: 'for the chat I left' } })).toMatchObject({ ok: false, code: 'CG-CONTEXT-CHANGED' });
    expect(h.bg.callsOf('op.start')).toEqual([]);
    expect(h.coach().turns).toEqual([]);
  });

  it('[AI-099] a turn that was running when the chat changed goes on in the background and is found on return', async () => {
    const h = await start();
    h.script(coachStream(ANSWER));
    await ask(h, 'How do I reply?');
    h.host.openChat(previewChat);
    await h.settle();
    expect(h.coach().turns).toEqual([]);
    await h.finish();
    h.host.openChat(openChat);
    await h.settle();
    expect(lastTurn(h)).toMatchObject({ question: 'How do I reply?', state: 'done' });
    expect(lastTurn(h).answer?.drafts).toHaveLength(2);
  });

  it('[AI-100] without a turn in flight the panel yields to another feature that starts; a turn in flight keeps it', async () => {
    const h = await start();
    await h.generate('coach');
    h.script(h.streamOf('fast-reply', ['hey']));
    await h.generate('reply');
    await h.finish();
    expect(h.overlays.closed).toEqual(['coach']);

    const busy = await start();
    busy.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('coach-chat') }, { kind: 'stall' }] });
    await ask(busy, 'How do I reply?');
    // Its own start does not close it, and the chat is busy for anything else.
    expect(busy.overlays.closed).toEqual([]);
    expect(await busy.generate('reply')).toMatchObject({ ok: false, code: 'CG-OP-CHAT-BUSY' });
    expect(busy.overlays.closed).toEqual([]);
  });

  it('[AI-100] a turn in flight keeps the panel when another feature really starts — a Reply in another chat', async () => {
    const h = await start();
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('coach-chat') }, { kind: 'stall' }] });
    await ask(h, 'How do I reply?');
    // The person goes to another chat and starts a Reply there: it is admitted, the Coach still answers for the first.
    h.host.setWindow({ ...(memory.chatWindows[0] as (typeof memory.chatWindows)[number]), chat: previewChat }, previewChat);
    h.host.openChat(previewChat);
    await h.settle();
    h.script(h.streamOf('fast-reply', ['hey']));
    expect(await h.generate('reply')).toMatchObject({ ok: true, outcome: 'started' });
    await h.clock.advance(200);
    expect(h.dock().result).toMatchObject({ feature: 'reply', state: 'done' });
    expect(h.overlays.closed).toEqual([]);
    // Once the turn is over the panel yields again.
    h.host.openChat(openChat);
    await h.settle();
    await h.dispatch(lastTurn(h).phase?.cancel as never);
    h.script(h.streamOf('fast-reply', ['hey']));
    expect(await h.generate('reply')).toMatchObject({ ok: true, outcome: 'started' });
    expect(h.overlays.closed).toEqual(['coach']);
  });

  it('the answers of a dialog are kept as long as the dialog is: their drafts still insert after the half hour other results live', async () => {
    const h = await start();
    const answer = await exchange(h, 'How do I reply?');
    h.script(h.streamOf('fast-reply', ['hey']));
    const reply = (await h.generate('reply')) as { opId: string };
    await h.finish();
    await h.clock.advance(31 * 60_000);
    // A new generation makes the tab look at its shelf: the old Reply goes, the Coach's answer stays.
    h.script(h.streamOf('fast-reply', ['hey again']));
    await h.generate('reply', { tone: 'casual' });
    await h.finish();
    expect(h.ai.workspace.ops.get(reply.opId)).toBeNull();
    expect(h.ai.workspace.ops.get(answer)).not.toBeNull();
    expect(lastTurn(h).answer?.drafts.map((draft) => draft.parts.length)).toEqual([2, 1]);
    expect(await h.dispatch({ type: 'InsertPart', operationId: answer, variant: 1, part: 0 })).toMatchObject({ ok: true, outcome: 'done' });
    // A dialog that is gone releases its answers: after a sign-out nothing of it is held.
    h.bg.changeSession(null, 'sign-out');
    await h.settle();
    expect(h.ai.workspace.ops.get(answer)).toBeNull();
  });
});

describe('coach: the recap it stands on', () => {
  const FULL = ['## Кто он', 'Марк, 34.', '', '## Деньги', '$30.'].join('\n');
  const savedOutcome = { state: 'saved' as const, response: { outcome: 'created' as const, profile: { version: 1, createdAt: '2026-10-03T10:00:01.000Z', sourceGeneratedAt: null } } };

  it('[AI-095] the header shows the fresher of the hub\'s two recaps, read when the panel opens', async () => {
    const h = await start({
      background: (bg) =>
        (bg.sharedRecaps = {
          full: { generationRef: uuid(0x700), generatedAt: '2026-10-03T08:00:00.000Z', personaDefinitionId: WORLD.persona.definitionId, coverage: { transcriptCoverage: 'full-history', requestedCount: 3000, keptCount: 800 }, text: FULL },
          short: { generationRef: uuid(0x701), generatedAt: '2026-10-03T09:00:00.000Z', personaDefinitionId: WORLD.persona.definitionId, coverage: { transcriptCoverage: 'window', requestedCount: 300, keptCount: 300 }, text: 'Короткий.' },
          fullSavedToProfile: true,
        }),
    });
    expect(h.coach().recap).toBeNull();
    await h.generate('coach');
    await h.settle();
    expect(h.bg.callsOf('recap.read')).toHaveLength(1);
    expect(h.coach().recap).toEqual({ length: 'short', generatedAt: '2026-10-03T09:00:00.000Z', summary: 'Короткий.' });
    expect(h.bg.callsOf('op.start')).toEqual([]);
  });

  it('[AI-096] auto-recap off (the default): the first question goes straight to the Coach, the status is not even read', async () => {
    const h = await start();
    h.script(coachStream(ANSWER));
    await ask(h, 'first');
    expect(h.bg.callsOf('recap.status')).toEqual([]);
    await h.finish();
    expect(h.bg.hub.streams.map((stream) => stream.feature)).toEqual(['coach-chat']);
  });

  it('[AI-096] auto-recap «full»: no recap on the hub — one start builds the recap, then asks; one turn, one token, one cancel at a time', async () => {
    const h = await start({ settings: withCoach({ autoRecap: 'full' }) });
    h.bg.hub.profileScript.push(savedOutcome);
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fan-summary'), afterMs: 20 }, delta(FULL.slice(0, 12), 30), delta(FULL.slice(12), 50), doneStep] }, coachStream(ANSWER));
    const receipt = await ask(h, 'How do I reply?');
    expect(receipt).toMatchObject({ ok: true, outcome: 'started' });
    expect(h.bg.callsOf('recap.status')).toHaveLength(1);
    // One start for the whole turn: the question, with the recap in front of it at the deep window.
    expect(h.bg.callsOf('op.start')).toHaveLength(1);
    expect(h.bg.callsOf('op.start')[0]).toMatchObject({ feature: 'coach', surface: 'coach', window: 100, coach: { question: 'How do I reply?', history: [], autoRecap: { length: 'full', window: 3000 } } });
    // The admitted operation is the recap step: the question waits, the turn shows its stages and its cancel.
    const recapOp = (receipt as { opId: string }).opId;
    expect(h.ai.workspace.ops.get(recapOp)?.view).toMatchObject({ feature: 'recap', surface: 'coach' });
    expect(h.coach().turns).toHaveLength(1);
    expect(lastTurn(h)).toMatchObject({ opId: recapOp, question: 'How do I reply?', sentToCoach: false, streamText: null });
    expect(lastTurn(h).phase?.cancel).toEqual({ type: 'CancelGeneration', operationId: recapOp });
    expect(h.coach().ask.reason?.id).toBe('coach-busy');
    await h.clock.advance(60);
    // The recap is being written: its text is not the Coach's answer, and nothing was «отправлено коучу» yet.
    expect(h.ai.workspace.ops.get(recapOp)?.view).toMatchObject({ state: 'streaming', text: FULL.slice(0, 12) });
    expect(lastTurn(h)).toMatchObject({ opId: recapOp, state: 'streaming', sentToCoach: false, streamText: null });
    expect(lastTurn(h).phase?.stages.at(-1)).toMatchObject({ id: 'writing', state: 'current' });

    await h.clock.advance(90);
    // The recap is done and is now the shared artifact. The answer step holds the chat's slot already — the
    // background put it there; the tab asked for nothing more and spent no second token.
    expect(h.bg.callsOf('op.start')).toHaveLength(1);
    expect(h.bg.callsOf('token.issue')).toEqual([{ kind: 'generate', surface: 'coach' }]);
    const answerOp = h.ai.workspace.ops.get(recapOp)?.view.continuedBy as string;
    expect(answerOp).toMatch(/^[0-9a-f-]{36}$/);
    expect(h.bg.scheduler.active().map((view) => `${view.feature}:${view.opId}`)).toEqual([`coach:${answerOp}`]);
    expect(h.coach().turns).toHaveLength(1);
    expect(lastTurn(h)).toMatchObject({ opId: answerOp, question: 'How do I reply?', sentToCoach: true });
    expect(lastTurn(h).phase?.cancel).toEqual({ type: 'CancelGeneration', operationId: answerOp });
    // Nothing else gets into the chat while the turn goes on.
    expect(await h.generate('reply')).toMatchObject({ ok: false, code: 'CG-OP-CHAT-BUSY' });
    await h.clock.advance(160);
    // The answer streams into the turn like any other.
    expect(lastTurn(h)).toMatchObject({ state: 'streaming', streamText: 'Сначала согрей, пото' });
    // X52: the open chat's tail goes with the question only; the recap step stays on the hub's archive (§19 п. 1).
    expect(h.bg.hub.streams.map((stream) => [stream.feature, stream.body.liveTextContext?.items.length])).toEqual([['fan-summary', undefined], ['coach-chat', 1]]);
    expect(h.ai.workspace.ops.get(answerOp)).toMatchObject({ own: true, desynced: false });
    await h.finish();
    expect(lastTurn(h)).toMatchObject({ opId: answerOp, state: 'done', question: 'How do I reply?' });
    expect(h.coach().recap).toMatchObject({ length: 'full', summary: FULL });
    expect(h.bg.hub.streams.map((stream) => stream.feature)).toEqual(['fan-summary', 'coach-chat']);
    expect(h.bg.hub.streams[1]?.body).toMatchObject({ chatterQuestion: 'How do I reply?' });
    // The whole turn was one trusted action: one token and one start of the Coach surface (the other is the refused Reply).
    expect(h.bg.callsOf('token.issue')).toEqual([{ kind: 'generate', surface: 'coach' }, { kind: 'generate', surface: 'dock' }]);
    expect((h.bg.callsOf('op.start') as { surface: string }[]).map((call) => call.surface)).toEqual(['coach', 'dock']);
    // The drafts of the answer insert: the answer step is of the persona the turn was started under.
    expect(await h.dispatch({ type: 'InsertPart', operationId: answerOp, variant: 1, part: 0 })).toMatchObject({ ok: true, outcome: 'done' });

    // Once per session: the next question asks at once.
    const statusReads = h.bg.callsOf('recap.status').length;
    h.script(coachStream('ok'));
    await ask(h, 'And then?');
    expect(h.bg.callsOf('recap.status')).toHaveLength(statusReads);
    expect((h.bg.callsOf('op.start')[2] as { coach: { autoRecap?: unknown; history: unknown[] } }).coach.autoRecap).toBeUndefined();
    expect((h.bg.callsOf('op.start')[2] as { coach: { history: unknown[] } }).coach.history).toHaveLength(1);
    await h.finish();
    expect(h.bg.hub.streams.map((stream) => stream.feature)).toEqual(['fan-summary', 'coach-chat', 'coach-chat']);
  });

  it('[AI-096] the answer step of a turn is remembered with the turn\'s Split snapshot and persona — nothing was started for it', async () => {
    const base = withCoach({ autoRecap: 'full' });
    const h = await start({ settings: { ...base, generation: { ...base.generation, split: true } } });
    h.bg.hub.profileScript.push(savedOutcome);
    h.script(h.streamOf('fan-summary', [FULL]), coachStream(ANSWER));
    const recapOp = ((await ask(h, 'How do I reply?')) as { opId: string }).opId;
    expect((h.bg.callsOf('op.start')[0] as { split: boolean }).split).toBe(true);
    await h.finish();
    const answerOp = h.ai.workspace.ops.get(recapOp)?.view.continuedBy as string;
    expect(h.bg.callsOf('op.start')).toHaveLength(1);
    expect(h.ai.workspace.ops.get(answerOp)).toMatchObject({ own: true, memo: { split: true, fixSource: null, personaDefinitionId: WORLD.persona.definitionId } });
  });

  it('[AI-096] [UI-008] while the turn builds its recap the strip\'s busy button is Coach — it still opens the panel; Recap waits like the rest', async () => {
    const h = await start({ settings: withCoach({ autoRecap: 'full' }) });
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fan-summary') }, { kind: 'stall' }] });
    await ask(h, 'How do I reply?');
    expect(h.ai.workspace.running(chatKeyOf(openChat))?.view).toMatchObject({ feature: 'recap', surface: 'coach' });
    const actions = h.dock().actions;
    expect(actions.coach).toMatchObject({ enabled: true, busy: true, active: true, reason: null });
    expect(actions.recap).toMatchObject({ enabled: false, busy: false });
    expect(actions.recap.reason?.id).toBe('chat-busy');
    expect(actions.reply.reason?.id).toBe('chat-busy');
    // The Coach key brings the panel back to the turn; it asks nothing.
    expect(await h.ai.command('coach')).toMatchObject({ kind: 'dispatched', receipt: { ok: true, outcome: 'opened' } });
    expect(h.overlays.opened).toEqual(['coach']);
    expect(h.bg.callsOf('op.start')).toHaveLength(1);
    await h.dispatch(lastTurn(h).phase?.cancel as never);
    expect(h.dock().actions.coach).toMatchObject({ enabled: true, busy: false });
    expect(h.dock().actions.recap).toMatchObject({ enabled: true });
  });

  it('[AI-096] [AI-091] the attached draft is read at the click, not when the recap step ends', async () => {
    const h = await start({ settings: withCoach({ autoRecap: 'full' }) });
    h.bg.hub.profileScript.push(savedOutcome);
    h.host.type('my first words');
    await h.settle();
    h.script(recapStream(FULL), coachStream(ANSWER));
    await ask(h, 'Is my answer fine?', { attachMyDraft: true });
    expect(h.host.reads.draft).toBe(1);
    // The person goes on typing while the recap is built.
    h.host.type('something else entirely');
    await h.finish();
    expect(h.host.reads.draft).toBe(1);
    expect(h.bg.hub.streams.map((stream) => stream.feature)).toEqual(['fan-summary', 'coach-chat']);
    expect(h.bg.hub.streams[0]?.body.draftText).toBeUndefined();
    expect(h.bg.hub.streams[1]?.body.draftText).toBe('my first words');
    expect(lastTurn(h)).toMatchObject({ state: 'done', attachedDraft: true });
  });

  it('[AI-096] the status of the recaps could not be read: nothing is built on a guess — the question goes right away', async () => {
    const h = await start({ settings: withCoach({ autoRecap: 'full' }), background: (bg) => (bg.recapStatus = { error: { code: 'CG-HUB-TIMEOUT' } }) });
    h.script(coachStream(ANSWER));
    expect(await ask(h, 'How do I reply?')).toMatchObject({ ok: true, outcome: 'started' });
    await h.finish();
    expect(h.bg.callsOf('recap.status')).toHaveLength(1);
    expect((h.bg.callsOf('op.start')[0] as { feature: string; coach: { autoRecap?: unknown } }).coach.autoRecap).toBeUndefined();
    expect(h.bg.hub.streams.map((stream) => stream.feature)).toEqual(['coach-chat']);
    expect(lastTurn(h)).toMatchObject({ state: 'done' });
  });

  it('[AI-096] [AI-051] a recap that cannot be built for this chat is not asked for: too little history, or the owner switch off', async () => {
    const h = await start({ settings: withCoach({ autoRecap: 'full' }) });
    // The whole short conversation is loaded: a full recap has nothing to stand on.
    h.host.setWindow({ ...(memory.chatWindows[0] as (typeof memory.chatWindows)[number]), loaded: 12, fanMessages: 6, modelMessages: 6, hasOlder: false }, openChat);
    await h.settle();
    expect(h.dock().actions.review.reason).toMatchObject({ id: 'no-history' });
    h.script(coachStream(ANSWER));
    await ask(h, 'How do I reply?');
    await h.finish();
    expect((h.bg.callsOf('op.start')[0] as { coach: { autoRecap?: unknown } }).coach.autoRecap).toBeUndefined();
    expect(h.bg.hub.streams.map((stream) => stream.feature)).toEqual(['coach-chat']);

    const off: Bootstrap = pageFeaturesOff(BOOTSTRAP_PILOT_PAGES, ['recap']);
    const noRecap = await start({ settings: withCoach({ autoRecap: 'full' }), bootstrap: off });
    noRecap.script(coachStream(ANSWER));
    await ask(noRecap, 'How do I reply?');
    await noRecap.finish();
    // The status is not even asked.
    expect(noRecap.bg.callsOf('recap.status')).toEqual([]);
    expect(noRecap.bg.hub.streams.map((stream) => stream.feature)).toEqual(['coach-chat']);
  });

  it('[AI-096] [AI-099] the person left the chat while the status was read: nothing starts for another fan, and no turn is left behind', async () => {
    const h = await start({ settings: withCoach({ autoRecap: 'full' }) });
    h.bg.held.add('recap.status');
    const asking = ask(h, 'How do I reply?');
    await h.settle();
    // The question is in the feed while its start is on the way; nothing to cancel yet.
    expect(lastTurn(h)).toMatchObject({ question: 'How do I reply?', state: 'admitted', opId: null });
    expect(lastTurn(h).phase?.cancel).toBeNull();
    h.host.setWindow({ ...(memory.chatWindows[0] as (typeof memory.chatWindows)[number]), chat: previewChat }, previewChat);
    h.host.openChat(previewChat);
    await h.settle();
    h.bg.held.delete('recap.status');
    h.bg.release();
    expect(await asking).toMatchObject({ ok: false, code: 'CG-CONTEXT-CHANGED' });
    expect(h.bg.callsOf('op.start')).toEqual([]);
    expect(h.bg.callsOf('token.issue')).toEqual([]);
    expect(h.coach().turns).toEqual([]);
    h.host.openChat(openChat);
    await h.settle();
    expect(h.coach().turns).toEqual([]);
    expect(h.coach().ask.enabled).toBe(true);
  });

  it('[AI-096] a fresh matching recap on the hub: nothing is built; an old one or one of another window is', async () => {
    const fresh = await start({ settings: withCoach({ autoRecap: 'full' }), background: (bg) => (bg.recapStatus = status({ full: slot(60 * 60_000) })) });
    await exchange(fresh, 'first');
    expect(fresh.bg.hub.streams.map((stream) => stream.feature)).toEqual(['coach-chat']);

    const old = await start({ settings: withCoach({ autoRecap: 'full' }), background: (bg) => (bg.recapStatus = status({ full: slot(COACH_RECAP_FRESH_MS + 1) })) });
    old.script(recapStream(FULL), coachStream('ok'));
    await ask(old, 'first');
    await old.finish();
    expect(old.bg.hub.streams.map((stream) => stream.feature)).toEqual(['fan-summary', 'coach-chat']);

    const otherWindow = await start({ settings: withCoach({ autoRecap: 'full' }), background: (bg) => (bg.recapStatus = status({ full: slot(60_000, 1500) })) });
    otherWindow.script(recapStream(FULL), coachStream('ok'));
    await ask(otherWindow, 'first');
    await otherWindow.finish();
    expect(otherWindow.bg.hub.streams.map((stream) => stream.feature)).toEqual(['fan-summary', 'coach-chat']);

    // «short» is satisfied by any fresh recap, and builds the short one otherwise.
    const short = await start({ settings: withCoach({ autoRecap: 'short' }), background: (bg) => (bg.recapStatus = status({ full: slot(60_000, 1500) })) });
    await exchange(short, 'first');
    expect(short.bg.hub.streams.map((stream) => stream.feature)).toEqual(['coach-chat']);
    const none = await start({ settings: withCoach({ autoRecap: 'short' }) });
    none.script(recapStream('Короткий.'), coachStream('ok'));
    await ask(none, 'first');
    await none.finish();
    expect((none.bg.callsOf('op.start')[0] as { coach: { autoRecap: unknown } }).coach.autoRecap).toEqual({ length: 'short', window: 300 });
    expect(none.bg.hub.streams.map((stream) => stream.feature)).toEqual(['fan-summary', 'coach-chat']);
    expect(none.bg.hub.streams[0]?.body.summaryMode).toBe('short');
  });

  it('[AI-096] a recap that cannot be made for the conversation\'s own reasons does not stop the question; any other failure does, and keeps it', async () => {
    const h = await start({ settings: withCoach({ autoRecap: 'full' }) });
    h.script({ kind: 'http-error', status: 409, body: { error: 'gate_min_messages' } }, coachStream(ANSWER));
    await ask(h, 'How do I reply?');
    await h.finish();
    expect(h.bg.hub.streams.map((stream) => stream.feature)).toEqual(['fan-summary', 'coach-chat']);
    expect(lastTurn(h)).toMatchObject({ state: 'done' });
    expect(h.coach().recap).toBeNull();

    const down = await start({ settings: withCoach({ autoRecap: 'full' }) });
    down.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fan-summary') }, { kind: 'frame', frame: { type: 'error', code: 'provider_new_failure', message: 'Something new', retryAfterMs: null } }] });
    await ask(down, 'How do I reply?');
    await down.finish();
    expect(down.bg.hub.streams.map((stream) => stream.feature)).toEqual(['fan-summary']);
    const failed = lastTurn(down);
    expect(failed).toMatchObject({ question: 'How do I reply?', state: 'failed' });
    expect(failed.error?.code).toBe('CG-PROVIDER-UNKNOWN');
    expect(failed.errorActions[0]?.action).toMatchObject({ type: 'Generate', feature: 'coach', options: { question: 'How do I reply?' } });
    // «Повторить» asks at once: the recap was this session's one attempt.
    down.script(coachStream('ok'));
    await down.dispatch(failed.errorActions[0]?.action as never);
    await down.finish();
    expect(down.bg.hub.streams.map((stream) => stream.feature)).toEqual(['fan-summary', 'coach-chat']);
  });

  it('[AI-096] canceling during the recap step cancels the whole turn: the Coach is never asked', async () => {
    const h = await start({ settings: withCoach({ autoRecap: 'full' }) });
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fan-summary') }, { kind: 'stall' }] });
    await ask(h, 'How do I reply?');
    const cancel = lastTurn(h).phase?.cancel;
    expect(await h.dispatch(cancel as never)).toMatchObject({ ok: true });
    await h.finish();
    expect(lastTurn(h)).toMatchObject({ question: 'How do I reply?', state: 'canceled' });
    expect(h.bg.hub.streams.map((stream) => stream.feature)).toEqual(['fan-summary']);
    expect(h.coach().ask.enabled).toBe(true);
  });

  it('[AI-096] [AI-099] the person left the chat during the recap step: the turn goes on for its own fan and is found on return', async () => {
    const h = await start({ settings: withCoach({ autoRecap: 'full' }) });
    h.bg.hub.profileScript.push(savedOutcome);
    h.script(recapStream(FULL), coachStream(ANSWER));
    await ask(h, 'How do I reply?');
    h.host.setWindow({ ...(memory.chatWindows[0] as (typeof memory.chatWindows)[number]), chat: previewChat }, previewChat);
    h.host.openChat(previewChat);
    await h.finish();
    // Both steps ran for the chat the question was asked in — its target was fixed at the click.
    expect(h.bg.hub.streams.map((stream) => stream.feature)).toEqual(['fan-summary', 'coach-chat']);
    expect(h.bg.hub.streams.map((stream) => stream.body.fanRef)).toEqual([HOST_IDS.fan, HOST_IDS.fan]);
    expect(h.bg.callsOf('op.start')).toHaveLength(1);
    expect(h.coach().turns).toEqual([]);
    h.host.openChat(openChat);
    await h.settle();
    expect(lastTurn(h)).toMatchObject({ question: 'How do I reply?', state: 'done' });
    expect(lastTurn(h).answer?.drafts).toHaveLength(2);
  });

  it('[AI-096] the turn could not go on although the recap was built: it fails with «контекст изменился» and keeps its question', async () => {
    const h = await start({ settings: withCoach({ autoRecap: 'full' }) });
    h.bg.hub.profileScript.push(savedOutcome);
    h.script(recapStream(FULL), coachStream(ANSWER));
    await ask(h, 'How do I reply?');
    // The owner switched the Coach off while the recap was being built.
    h.bg.bootstrap = pageFeaturesOff(BOOTSTRAP_PILOT_PAGES, ['coach']);
    await h.finish();
    expect(h.bg.hub.streams.map((stream) => stream.feature)).toEqual(['fan-summary']);
    const turn = lastTurn(h);
    expect(turn).toMatchObject({ question: 'How do I reply?', state: 'failed' });
    expect(turn.error?.code).toBe('CG-CONTEXT-CHANGED');
    expect(h.bg.scheduler.active()).toEqual([]);
    expect(h.coach().ask.enabled).toBe(true);
  });

  it('[AI-096] the port was down when the recap step ended: once it is back the turn is on its answer step, with what was written so far', async () => {
    const h = await start({ settings: withCoach({ autoRecap: 'full' }) });
    h.bg.hub.profileScript.push(savedOutcome);
    h.script(recapStream(FULL), coachStream(ANSWER));
    const receipt = await ask(h, 'How do I reply?');
    const recapOp = (receipt as { opId: string }).opId;
    h.bg.setConnection('reconnecting');
    // The recap ends and the answer starts streaming — into a dead port.
    await h.clock.advance(350);
    expect(lastTurn(h)).toMatchObject({ opId: recapOp });
    h.bg.setConnection('ready');
    await h.settle();
    const answerOp = h.ai.workspace.ops.get(recapOp)?.view.continuedBy as string;
    expect(answerOp).toMatch(/^[0-9a-f-]{36}$/);
    expect(lastTurn(h)).toMatchObject({ opId: answerOp, state: 'streaming', streamText: 'Сначала согрей, пото' });
    expect(lastTurn(h).phase?.cancel).toEqual({ type: 'CancelGeneration', operationId: answerOp });
    expect(h.coach().recap).toMatchObject({ length: 'full' });
    await h.finish();
    expect(lastTurn(h)).toMatchObject({ opId: answerOp, state: 'done' });
    expect(lastTurn(h).answer?.drafts).toHaveLength(2);
    expect(h.bg.callsOf('op.start')).toHaveLength(1);

    // And when the answer ended in the gap as well, the turn is simply done.
    const late = await start({ settings: withCoach({ autoRecap: 'full' }) });
    late.bg.hub.profileScript.push(savedOutcome);
    late.script(recapStream(FULL), coachStream(ANSWER));
    await ask(late, 'How do I reply?');
    late.bg.setConnection('reconnecting');
    await late.clock.advance(5_000);
    late.bg.setConnection('ready');
    await late.settle();
    expect(lastTurn(late)).toMatchObject({ state: 'done', question: 'How do I reply?' });
    expect(lastTurn(late).answer?.drafts).toHaveLength(2);
  });

  it('[AI-096] the recap step ended before the answer to the start arrived: the turn still follows its answer step', async () => {
    const h = await start({ settings: withCoach({ autoRecap: 'full' }) });
    // The hub refuses the recap at once (too little history for it): the recap step is over within the start.
    h.script({ kind: 'http-error', status: 409, body: { error: 'gate_min_messages' } }, coachStream(ANSWER));
    h.bg.slow.add('op.start');
    const asking = ask(h, 'How do I reply?');
    // Meanwhile the answer step was admitted and its first batches went out — before the tab knew either id.
    await h.clock.advance(250);
    h.bg.slow.delete('op.start');
    h.bg.release();
    const receipt = await asking;
    expect(receipt).toMatchObject({ ok: true, outcome: 'started' });
    const recapOp = (receipt as { opId: string }).opId;
    const answerOp = h.ai.workspace.ops.get(recapOp)?.view.continuedBy as string;
    // Nothing of it was lost: the batches that came early are in the turn, and the next one is no gap.
    expect(lastTurn(h)).toMatchObject({ opId: answerOp, state: 'streaming', streamText: 'Сначала согрей, пото' });
    await h.clock.advance(20);
    expect(h.ai.workspace.ops.get(answerOp)).toMatchObject({ own: true, desynced: false });
    await h.clock.advance(100);
    expect(h.ai.workspace.ops.get(answerOp)).toMatchObject({ desynced: false });
    await h.finish();
    expect(lastTurn(h)).toMatchObject({ opId: answerOp, state: 'done' });
    expect(h.ai.workspace.ops.get(answerOp)).toMatchObject({ own: true, desynced: false });
    expect(h.bg.callsOf('op.start')).toHaveLength(1);
  });
});

describe('coach: the archive it reads', () => {
  it('[AI-097] «Обновить переписку» reads the head of the hub archive — the feed, which marks nothing read', async () => {
    const h = await start({ background: (bg) => (bg.feed = feed()) });
    const refresh = h.coach().freshness.refresh;
    expect(refresh).toMatchObject({ enabled: true, label: { key: 'coach.refresh' } });
    expect(await h.dispatch(refresh.action)).toMatchObject({ ok: true, type: 'RefreshArchive' });
    expect(h.bg.callsOf('feed.read')).toEqual([{ pageId: WORLD.pages.one.pageId, fanRef: HOST_IDS.fan, cursor: null, limit: 1 }]);
    await h.settle();
    // The archive holds the newest message of the page: no lag.
    expect(h.coach().freshness).toMatchObject({ asOf: hostIso(0), lag: null });
    // Nothing was generated to learn that.
    expect(h.bg.callsOf('op.start')).toEqual([]);
  });

  it('[NEW-02] the archive is behind the chat by K messages: the header says so and the view is partial', async () => {
    const h = await start({ background: (bg) => (bg.feed = feed({ head: { messageRef: HOST_IDS.messages.fanEarlier, at: hostIso(-300), sender: 'fan' } })) });
    h.host.setTail(openChat, {
      capturedAt: hostIso(0),
      messages: [
        { platformMessageId: HOST_IDS.messages.fanEarlier, direction: 'fan', sentAt: hostIso(-300), text: 'a' },
        { platformMessageId: HOST_IDS.messages.fanBefore, direction: 'fan', sentAt: hostIso(-60), text: 'b' },
        { platformMessageId: HOST_IDS.messages.fanAfter, direction: 'fan', sentAt: hostIso(-10), text: 'c' },
      ],
    });
    await exchange(h, 'How do I reply?');
    await h.dispatch(h.coach().freshness.refresh.action);
    await h.settle();
    expect(h.coach().freshness.lag).toEqual({ messages: 2 });
    expect(h.coach().view).toEqual({ s: 'partial', gaps: [{ kind: 'archive-lag', messages: 2, minutes: null }] });
    // The archive caught up and the person refreshed again.
    h.bg.feed = feed({ head: { messageRef: HOST_IDS.messages.fanAfter, at: hostIso(-10), sender: 'fan' } });
    await h.dispatch(h.coach().freshness.refresh.action);
    await h.settle();
    expect(h.coach().freshness.lag).toBeNull();
    expect(h.coach().view).toEqual({ s: 'ready' });
  });

  it('[NEW-02] before any refresh the lag is told from what the latest answer was built on', async () => {
    const h = await start();
    h.host.setTail(openChat, {
      capturedAt: hostIso(0),
      messages: [
        { platformMessageId: HOST_IDS.messages.fanEarlier, direction: 'fan', sentAt: hostIso(-300), text: 'a' },
        { platformMessageId: HOST_IDS.messages.fanBefore, direction: 'fan', sentAt: hostIso(-60), text: 'b' },
      ],
    });
    h.script(coachStream(ANSWER, [contextFrame({ servedHead: { messageRef: HOST_IDS.messages.fanEarlier, occurredAt: hostIso(-300), isFromFan: true } })]));
    await ask(h, 'How do I reply?');
    await h.finish();
    expect(h.coach().freshness).toMatchObject({ asOf: hostIso(-300), lag: { messages: 1 } });
  });

  it('a failed refresh says so and keeps what was known; without the feed capability the button is off', async () => {
    const h = await start({ background: (bg) => (bg.feed = { error: { code: 'CG-HUB-UNAVAILABLE' } }) });
    expect(await h.dispatch(h.coach().freshness.refresh.action)).toMatchObject({ ok: false, code: 'CG-HUB-UNAVAILABLE' });
    expect(h.coach().freshness).toMatchObject({ asOf: null, lag: null, refresh: { enabled: true } });

    // A hub that does not serve the feed says so in the page's own feature (`preview`: `hub_not_ready`).
    const noFeed: Bootstrap = hubServing(BOOTSTRAP_PILOT_PAGES, BOOTSTRAP_PILOT_PAGES.capabilities.filter((capability) => capability !== 'archive-feed-v1'));
    const other = await start({ bootstrap: noFeed });
    expect(other.coach().freshness.refresh).toMatchObject({ enabled: false });
    expect(other.coach().freshness.refresh.reason?.id).toBe('feature-disabled');
  });

  it('[AI-097] «Обновить переписку» follows the PAGE’s own `preview` feature — the owner’s switch with its reason — not the hub capability alone: off on the page, the button says why and nothing is asked of the hub', async () => {
    // The hub serves the feed (the capability is declared), and the owner left `preview` off for this page.
    const off = await start({ bootstrap: pageFeaturesOff(BOOTSTRAP_PILOT_PAGES, ['preview']), background: (bg) => (bg.feed = feed()) });
    expect(BOOTSTRAP_PILOT_PAGES.capabilities).toContain('archive-feed-v1');
    const refresh = off.coach().freshness.refresh;
    expect(refresh).toMatchObject({ enabled: false, reason: { id: 'feature-disabled', code: 'CG-FEATURE-DISABLED', text: { key: 'dock.reason.featureDisabled' } } });
    // A key or a stale click still reaches the action: refused with the page's reason, before any request.
    expect(await off.dispatch(refresh.action)).toMatchObject({ ok: false, code: 'CG-FEATURE-DISABLED' });
    expect(off.bg.callsOf('feed.read')).toEqual([]);
    // The Coach itself is not the preview's business: a question can still be asked.
    expect(off.coach().ask).toMatchObject({ enabled: true, reason: null });

    // The hub's own reason picks the words: a hub that does not serve the feed yet is not «выключена».
    const notReady = await start({ bootstrap: pageFeaturesOff(BOOTSTRAP_PILOT_PAGES, ['preview'], { reason: 'hub_not_ready' }) });
    expect(notReady.coach().freshness.refresh).toMatchObject({ enabled: false, reason: { code: 'CG-HUB-CAPABILITY', text: { key: 'dock.reason.hubNotReady' } } });
    expect(await notReady.dispatch(notReady.coach().freshness.refresh.action)).toMatchObject({ ok: false, code: 'CG-HUB-CAPABILITY' });

    // Off on ANOTHER page only: this page's button works.
    const elsewhere = await start({ bootstrap: pageFeaturesOff(BOOTSTRAP_PILOT_PAGES, ['preview'], { pageIds: BOOTSTRAP_PILOT_PAGES.pages.map((page) => page.pageId).filter((pageId) => pageId !== WORLD.pages.one.pageId) }), background: (bg) => (bg.feed = feed()) });
    expect(elsewhere.coach().freshness.refresh).toMatchObject({ enabled: true, reason: null });
    expect(await elsewhere.dispatch(elsewhere.coach().freshness.refresh.action)).toMatchObject({ ok: true });
    expect(elsewhere.bg.callsOf('feed.read')).toHaveLength(1);
  });

  it('R20 F6b, ChatSpace: «Обновить переписку» of a ChatSpace chat reads the feed as before F6b — byte for byte as recorded on main', async () => {
    const h = await start({ background: (bg) => (bg.feed = feed()) });
    expect(await h.dispatch(h.coach().freshness.refresh.action)).toMatchObject({ ok: true, type: 'RefreshArchive' });
    expect(JSON.stringify(h.bg.callsOf('feed.read'))).toBe(CHATSPACE_RECORDED.coachFeed);
  });

  it('every action the Coach view offers is a valid UiAction', async () => {
    const h = await start();
    await exchange(h, 'first');
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('coach-chat') }, { kind: 'frame', frame: { type: 'error', code: 'provider_new_failure', message: 'Something new', retryAfterMs: null } }] });
    await ask(h, 'second');
    await h.finish();
    const actions: unknown[] = [];
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === 'object' && value !== null) {
        const record = value as Record<string, unknown>;
        if (typeof record['type'] === 'string' && /^[A-Z]/.test(record['type'])) actions.push(record);
        Object.values(record).forEach(walk);
      }
    };
    walk(h.coach());
    expect(actions.length).toBeGreaterThan(3);
    for (const action of actions) expect(UiActionSchema.safeParse(action).success, JSON.stringify(action)).toBe(true);
  });
});
