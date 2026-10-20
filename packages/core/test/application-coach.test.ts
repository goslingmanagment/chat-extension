// The Coach controller over the fake tab RPC (the real scheduler with R11's
// drivers), @cg/testing's FakeHostPort and the fake hub's frames: opening
// the panel, the empty state and its chips, a turn from the question to the
// answer with drafts, inserting a draft part (Б2, the language gate), the
// history sent back, sessions and «Новый диалог», «приложить мой ответ»,
// failures and cancel, the auto-recap as one composite turn, «Обновить
// переписку» and the archive lag, and the panel yielding to other features.

import { describe, expect, it } from 'vitest';

import { COACH_LIMITS, UiActionSchema, type CoachTurnVM, type FeedPage, type HubFrame, type SettingsV1 } from '@cg/contracts';
import { createFakeCatalog, ctxOf } from '@cg/testing/app-client';
import { FakeHostPort, HOST_IDS, hostIso, memory, openChat, previewChat, startSnapshot } from '@cg/testing/host';
import { BOOTSTRAP_PILOT_PAGES, meta, resolveHubErrorReference } from '@cg/testing/hub';

import { settingsWithPersona } from './support/ai-background';
import { delta, doneStep, readyHarness, type Harness, type HarnessOptions, type HarnessParts } from './support/ai-harness';
import { type ScriptResponse } from './support/fake-hub';
import { NOW_MS, WORLD, session } from './support/world';

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
});

describe('coach: the recap it stands on', () => {
  const FULL = ['## Кто он', 'Марк, 34.', '', '## Деньги', '$30.'].join('\n');
  const savedOutcome = { state: 'saved' as const, response: { outcome: 'created' as const, profile: { version: 1, createdAt: '2026-10-03T10:00:01.000Z', sourceGeneratedAt: null } } };

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
    // X70: both steps use the same confirmed text read for this Coach turn.
    expect(h.bg.hub.streams.map((stream) => [stream.feature, stream.body.liveTextContext?.items.length])).toEqual([['fan-summary', 1], ['coach-chat', 1]]);
    expect(h.bg.hub.streams[0]?.body.liveTextContext).toEqual(h.bg.hub.streams[1]?.body.liveTextContext);
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
});
