// The Coach side panel (ui-design §3.7, §4.19, §10; AI-080…AI-100): the
// session of the open chat — freshness, turns, drafts in parts, ready
// questions, the question field. It asks only through UiActions and never
// sends the fan's fresh text anywhere.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { type CoachTurnVM, type CoachVM, type ConfirmVM } from '@cg/contracts';
import { DEFAULT_PARTS, preloadPart } from '@cg/ui/dock';
import { UNSENT_QUESTIONS_MAX, coachSurface, forgetUnsentQuestions } from '@cg/ui/overlays/coach';

import { FANS, cgError, coach, coachTurn, dock, entry, handles, msg, parts, reason, scenarioById, uuid, views, type ScenarioStep } from '../scenarios/app-client';
import { type MountedKit, ctx, flush, keydown, mountSurface, scenarioOf, settle, text } from '../dock/harness';

let kit: MountedKit | null = null;
afterEach(() => {
  kit?.unmount();
  kit = null;
  // Unasked questions live in the module, by chat: no test inherits another's.
  forgetUnsentQuestions();
});
beforeAll(async () => {
  await preloadPart(DEFAULT_PARTS.debug);
});

const HANDLE = handles.dock(FANS.hubert);
const mount = (vm: CoachVM, dockPatch: Parameters<typeof dock>[2] = {}, reactions?: Parameters<typeof scenarioOf>[1]): MountedKit =>
  mountSurface(coachSurface.view, scenarioOf([entry({ of: 'dock' }, dock(ctx, 'ready', dockPatch)), entry({ of: 'coach' }, vm)], reactions), 'coach', coachSurface.styles ?? []);
const byLabel = (label: string): HTMLElement => {
  const found = kit?.$$('button').find((element) => element.querySelector('.cg-btn__t')?.textContent === label || element.getAttribute('aria-label') === label);
  if (found === undefined) throw new Error(`no button «${label}»`);
  return found;
};
const field = (): HTMLTextAreaElement => kit?.$('textarea') as HTMLTextAreaElement;
const type = async (value: string): Promise<void> => {
  await flush(() => {
    field().value = value;
    field().dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe('the Coach panel', () => {
  it('[AI-080] is a complementary side panel «Coach» for the open chat, opened with focus in the question field; Esc and × close it and focus goes back', async () => {
    let restored = 0;
    kit = mount(coach(ctx, views.ready(), [coachTurn(ctx, 1)]));
    (kit.deps.focus as { restore: () => boolean }).restore = () => {
      restored += 1;
      return true;
    };
    const panel = kit.$('.cg-side') as HTMLElement;
    expect(panel.getAttribute('role')).toBe('complementary');
    expect(panel.getAttribute('aria-label')).toBe('Coach');
    expect(text(kit.$('.cg-co__name'))).toBe('Coach');
    expect(text(kit.$('.cg-co__sub'))).toBe('по чату с Hubert');
    // Opening Coach puts focus into the question field (parity AI-080); the panel does not trap it.
    expect(kit.root.activeElement).toBe(field());
    await flush(() => panel.dispatchEvent(keydown('Escape')));
    await flush(() => byLabel('Закрыть').click());
    expect(kit.client.dispatched).toEqual(Array(2).fill({ type: 'Navigate', to: { kind: 'surface', surface: 'coach', open: false } }));
    expect(restored).toBe(1);
  });

  it('[AI-081] [AI-094] the empty state invites a question and offers ready ones; a chip asks at once', async () => {
    kit = mount(coach(ctx, views.empty({ key: 'coach.empty.title' }), []));
    expect(text(kit.$('.cg-co__empty b'))).toBe('Новый диалог');
    expect(text(kit.$('.cg-co__empty'))).toContain('Спросите, как ответить Hubert');
    const chips = kit.$$('.cg-co__chips button');
    expect(chips.map(text)).toEqual(['Что сейчас в чате?', 'Что предложить?']);
    await flush(() => chips[0]?.click());
    await flush(() => chips[1]?.click());
    expect(kit.client.dispatched).toEqual([
      { type: 'Generate', targetHandle: HANDLE, feature: 'coach', options: { question: 'Что сейчас происходит в чате?', preset: 'situation' } },
      { type: 'Generate', targetHandle: HANDLE, feature: 'coach', options: { question: 'Что ему предложить?' } },
    ]);
  });

  it('[AI-082] [AI-099] Enter asks, Shift+Enter is a new line; the question leaves the field only once the turn started', async () => {
    kit = mount(coach(ctx, views.ready(), []), {}, { reactions: [{ on: 'Generate', receipt: { ok: false, type: 'Generate', code: 'CG-HUB-UNAVAILABLE', error: cgError(ctx, 'CG-HUB-UNAVAILABLE') } }] });
    expect(field().getAttribute('aria-label')).toBe('Вопрос Coach');
    expect(field().placeholder).toBe('Спросите Coach про этот чат');
    expect(field().maxLength).toBe(2000);
    expect(text(kit.$('.cg-co__send span'))).toBe('↵ спросить, ⇧↵ новая строка');
    await type('  как вернуть его к покупкам?  ');
    await flush(() => field().dispatchEvent(keydown('Enter', { shiftKey: true })));
    expect(kit.client.dispatched).toEqual([]);
    await flush(() => field().dispatchEvent(keydown('Enter')));
    await settle(1);
    expect(kit.client.dispatched).toEqual([{ type: 'Generate', targetHandle: HANDLE, feature: 'coach', options: { question: 'как вернуть его к покупкам?' } }]);
    // The start was refused: the question is still there.
    expect(field().value).toBe('  как вернуть его к покупкам?  ');
    // An empty question asks nothing.
    await type('   ');
    await flush(() => byLabel('Спросить').click());
    expect(kit.client.dispatched).toHaveLength(1);
  });

  it('[AI-099] a typed question survives closing the panel and is cleared when its turn starts', async () => {
    kit = mount(coach(ctx, views.ready(), []));
    await type('что ему предложить сегодня?');
    kit.unmount();
    kit = mount(coach(ctx, views.ready(), []));
    expect(field().value).toBe('что ему предложить сегодня?');
    await flush(() => byLabel('Спросить').click());
    await settle(1);
    expect(field().value).toBe('');
    kit.unmount();
    kit = mount(coach(ctx, views.ready(), []));
    expect(field().value).toBe('');
  });

  it('[AI-080] [AI-099] a chat switched under the open panel moves no focus, and the field shows the question of the chat that is open', async () => {
    const other = handles.dock(FANS.theodore);
    const steps: ScenarioStep[] = [
      { label: 'theodore', at: 10, views: [entry({ of: 'dock' }, dock(ctx, 'ready', { fan: FANS.theodore })), entry({ of: 'coach' }, coach(ctx, views.ready(), [], { targetName: FANS.theodore.name }))] },
      { label: 'hubert again', at: 20, views: [entry({ of: 'dock' }, dock(ctx, 'ready')), entry({ of: 'coach' }, coach(ctx, views.ready(), []))] },
    ];
    kit = mount(coach(ctx, views.ready(), []), {}, { steps });
    await type('вопрос про Hubert');
    await flush(() => (kit?.$('.cg-co__attach button') as HTMLElement).click());
    // The person went back to ChatSpace and opened another chat there.
    await flush(() => field().blur());
    await flush(() => kit?.client.goTo(0));
    expect(text(kit.$('.cg-co__sub'))).toBe('по чату с Theodore Whitfield');
    expect(kit.root.activeElement).toBeNull();
    // Hubert's question is not Theodore's; «Приложить мой ответ» was asked for Hubert's chat only.
    expect(field().value).toBe('');
    expect(kit.$('.cg-co__attach button')?.getAttribute('aria-pressed')).toBe('false');
    await flush(() => field().dispatchEvent(keydown('Enter')));
    expect(kit.client.dispatched).toEqual([]);
    await type('вопрос про Theodore');
    await flush(() => kit?.client.goTo(1));
    // Back in Hubert's chat his question is in the field again, with his «Приложить мой ответ», and it is asked about him.
    expect(field().value).toBe('вопрос про Hubert');
    expect(kit.$('.cg-co__attach button')?.getAttribute('aria-pressed')).toBe('true');
    await flush(() => field().dispatchEvent(keydown('Enter')));
    await settle(1);
    expect(kit.client.dispatched).toEqual([{ type: 'Generate', targetHandle: HANDLE, feature: 'coach', options: { question: 'вопрос про Hubert', attachMyDraft: true } }]);
    expect(field().value).toBe('');
    // Theodore's unasked question waits for his chat.
    kit.unmount();
    kit = mount(coach(ctx, views.ready(), [], { targetName: FANS.theodore.name }), { fan: FANS.theodore });
    expect(field().value).toBe('вопрос про Theodore');
    await flush(() => byLabel('Спросить').click());
    expect(kit.client.dispatched).toEqual([{ type: 'Generate', targetHandle: other, feature: 'coach', options: { question: 'вопрос про Theodore' } }]);
  });

  it('[AI-099] a ready question asks at once and leaves what is being typed in the field; a question typed on while its turn starts is kept', async () => {
    kit = mount(coach(ctx, views.ready(), []));
    await type('мой недописанный вопрос');
    await flush(() => (kit?.$$('.cg-co__chips button')[1] as HTMLElement).click());
    await settle(1);
    expect(kit.client.dispatched).toEqual([{ type: 'Generate', targetHandle: HANDLE, feature: 'coach', options: { question: 'Что ему предложить?' } }]);
    expect(field().value).toBe('мой недописанный вопрос');
    // The turn starts a moment after the click; the person is already typing the next question.
    await flush(() => {
      byLabel('Спросить').click();
      field().value = 'мой недописанный вопрос, и ещё один';
      field().dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle(1);
    expect(kit.client.dispatched).toHaveLength(2);
    expect(field().value).toBe('мой недописанный вопрос, и ещё один');
  });

  it('[AI-099] unasked questions are kept for the chats written in last, never without a limit', async () => {
    const at = (index: number) => ({ targetHandle: `dock:f9${index.toString().padStart(3, '0')}` });
    for (let index = 0; index <= UNSENT_QUESTIONS_MAX; index += 1) {
      kit = mount(coach(ctx, views.ready(), []), at(index));
      await type(`вопрос ${index}`);
      kit.unmount();
    }
    kit = mount(coach(ctx, views.ready(), []), at(0));
    expect(field().value).toBe('');
    kit.unmount();
    kit = mount(coach(ctx, views.ready(), []), at(1));
    expect(field().value).toBe('вопрос 1');
  });

  it('[AI-091] «Приложить мой ответ» sends the composer draft along — the person\'s own text, never the fan\'s', async () => {
    kit = mount(coach(ctx, views.ready(), []));
    const attach = kit.$('.cg-co__attach button') as HTMLElement;
    expect(text(attach)).toBe('Приложить мой ответ');
    expect(attach.getAttribute('aria-pressed')).toBe('false');
    await flush(() => attach.click());
    expect(attach.getAttribute('aria-pressed')).toBe('true');
    await type('оцени мой ответ');
    await flush(() => byLabel('Спросить').click());
    expect(kit.client.dispatched).toEqual([{ type: 'Generate', targetHandle: HANDLE, feature: 'coach', options: { question: 'оцени мой ответ', attachMyDraft: true } }]);
    kit.unmount();
    kit = mount(coach(ctx, views.ready(), [], { ask: { enabled: true, reason: null, attachDraft: { available: false, reason: reason('needs-draft') } } }));
    expect(kit.$('.cg-co__attach button')?.getAttribute('aria-disabled')).toBe('true');
  });

  it('[AI-091] a draft that is gone is not attached: the composer was emptied after «Приложить мой ответ» was pressed', async () => {
    const without = coach(ctx, views.ready(), [], { ask: { enabled: true, reason: null, attachDraft: { available: false, reason: reason('needs-draft') } } });
    kit = mount(coach(ctx, views.ready(), []), {}, { steps: [{ label: 'the draft is gone', at: 10, views: [entry({ of: 'coach' }, without)] }] });
    await flush(() => (kit?.$('.cg-co__attach button') as HTMLElement).click());
    await flush(() => kit?.client.goTo(0));
    expect(kit.$('.cg-co__attach button')?.getAttribute('aria-pressed')).toBe('false');
    await type('оцени мой ответ');
    await flush(() => byLabel('Спросить').click());
    expect(kit.client.dispatched).toEqual([{ type: 'Generate', targetHandle: HANDLE, feature: 'coach', options: { question: 'оцени мой ответ' } }]);
  });

  it('[AI-083] [AI-093] [AI-100] while Coach answers: «Отправлено Coach…», then the stage line and the preliminary text; «Спросить» is off with the reason', async () => {
    const waiting = coachTurn(ctx, 2, { state: 'requesting', answer: null, sentToCoach: true, streamText: null, phase: null });
    kit = mount(coach(ctx, views.ready(), [coachTurn(ctx, 1), waiting], { ask: { enabled: false, reason: reason('coach-busy'), attachDraft: { available: true, reason: null } } }));
    expect(text(kit.$('.cg-co__sent'))).toBe('Отправлено Coach…');
    expect(byLabel('Спросить').getAttribute('aria-disabled')).toBe('true');
    await type('ещё вопрос');
    await flush(() => field().dispatchEvent(keydown('Enter')));
    expect(kit.client.dispatched).toEqual([]);
    kit.unmount();
    kit = mountSurface(coachSurface.view, scenarioById('coach-session'), 'coach', coachSurface.styles ?? []);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(kit.$$('.cg-co__stages .cg-stage').map(text)).toEqual(['Читаю переписку', 'Пишет ответ…']);
    expect(text(kit.$('.cg-co__stream [data-cg-stream]'))).toBe('If he asks about a discount');
    expect(kit.$('.cg-co__wait')?.getAttribute('aria-busy')).toBe('true');
    // No ready questions while a turn runs.
    expect(kit.$('.cg-co__chips')).toBeNull();
  });

  it('[AI-083] the live region says the stages of the wait and that the answer came with a draft: «Ответ готов: 2 части»', async () => {
    const session = scenarioById('coach-session');
    const answered = coach(ctx, views.ready(), [coachTurn(ctx, 1), coachTurn(ctx, 2, { opId: uuid(402) })]);
    kit = mountSurface(coachSurface.view, { ...session, steps: [{ label: 'answered', at: 10, views: [entry({ of: 'coach' }, answered)] }] }, 'coach', coachSurface.styles ?? []);
    await settle(1);
    expect(text(kit.$('[data-cg-live]'))).toBe('Coach: пишет ответ');
    await flush(() => kit?.client.goTo(0));
    await settle(1);
    expect(text(kit.$('[data-cg-live]'))).toBe('Ответ готов: 2 части');
  });

  it('[AI-084] [AI-085] an answer: prose, then drafts split into parts, inserted one at a time by the operation of that turn', async () => {
    kit = mount(coach(ctx, views.ready(), [coachTurn(ctx, 1)]));
    expect(kit.$$('.cg-co__who').map(text)).toEqual(['Вы', 'Coach']);
    expect(text(kit.$('.cg-co__turn.is-you p'))).toBe('Как вернуть его к покупкам?');
    expect(text(kit.$('.cg-co__md'))).toContain('He responds to warmth first.');
    const parts = kit.$$('.cg-co__drafts .cg-part');
    expect(parts).toHaveLength(2);
    expect(parts[0]?.classList.contains('is-next')).toBe(true);
    expect(parts[0]?.querySelector('.cg-ins kbd')?.textContent).toBe('↵');
    await flush(() => (parts[1]?.querySelector('.cg-ins') as HTMLElement).click());
    expect(kit.client.dispatched).toEqual([{ type: 'InsertPart', operationId: uuid(401), part: 1 }]);
    expect(kit.client.dispatched.some((action) => action.type === 'SendPart')).toBe(false);
  });

  const asks = (part: ConfirmVM['part'], kind: ConfirmVM['kind'] = 'human-draft'): ConfirmVM => ({ confirmationId: uuid(501), kind, part, formatLoss: false });

  it('[AI-086] a draft inserted into a composer that has the person\'s text asks first: the question opens in that part, with focus on «Добавить в конец»', async () => {
    const steps: ScenarioStep[] = [
      { label: 'asks', at: 10, views: [entry({ of: 'coach' }, coach(ctx, views.ready(), [coachTurn(ctx, 1, { confirm: asks({ index: 1 }) })]))] },
      { label: 'answered', at: 20, views: [entry({ of: 'coach' }, coach(ctx, views.ready(), [coachTurn(ctx, 1)]))] },
    ];
    kit = mount(coach(ctx, views.ready(), [coachTurn(ctx, 1)]), {}, {
      steps,
      reactions: [
        { on: 'InsertPart', receipt: { ok: true, type: 'InsertPart', outcome: 'needs-confirm' }, thenStep: 0 },
        { on: 'AnswerConfirm', receipt: { ok: true, type: 'AnswerConfirm', outcome: 'done' }, thenStep: 1 },
      ],
    });
    expect(kit.$('.cg-confirm')).toBeNull();
    await flush(() => (kit?.$$('.cg-co__drafts .cg-part')[1]?.querySelector('.cg-ins') as HTMLElement).click());
    await settle(2);
    const group = kit.$('.cg-confirm') as HTMLElement;
    expect(group.getAttribute('aria-label')).toBe('В поле ввода уже есть ваш текст.');
    expect(group.closest('.cg-part')?.getAttribute('data-cg-part')).toBe('1');
    expect(kit.$$('.cg-confirm')).toHaveLength(1);
    expect([...group.querySelectorAll('button')].map((element) => text(element.querySelector('.cg-btn__t')))).toEqual(['Заменить', 'Добавить в конец', 'Отмена']);
    expect(kit.root.activeElement).toBe([...group.querySelectorAll('button')][1]);
    await flush(() => ([...group.querySelectorAll('button')][0] as HTMLElement).click());
    expect(kit.client.dispatched).toEqual([
      { type: 'InsertPart', operationId: uuid(401), part: 1 },
      { type: 'AnswerConfirm', confirmationId: uuid(501), choice: 'replace' },
    ]);
    expect(kit.$('.cg-confirm')).toBeNull();
    // Nothing is sent, and nothing is inserted before the answer.
    expect(kit.client.dispatched.some((action) => action.type === 'SendPart')).toBe(false);
  });

  it('[AI-086] with two drafts the question opens in the draft it names; Esc is «Отмена» and closes the question, not the panel', async () => {
    const op = uuid(401);
    const drafts = [0, 1].map((index) => ({ index, label: msg('coach.draft', { n: index + 1 }), parts: parts(op, [`draft ${index + 1}, part 1`, `draft ${index + 1}, part 2`], () => ({ variant: index })) }));
    const turn = (patch: Partial<CoachTurnVM> = {}): CoachTurnVM => coachTurn(ctx, 1, { answer: { prose: 'Two ways to say it.', blocks: null, drafts }, ...patch });
    kit = mount(coach(ctx, views.ready(), [turn({ confirm: asks({ variant: 1, index: 0 }, 'draft-changed') })]), {}, {
      steps: [{ label: 'answered', at: 10, views: [entry({ of: 'coach' }, coach(ctx, views.ready(), [turn()]))] }],
      reactions: [{ on: 'AnswerConfirm', receipt: { ok: true, type: 'AnswerConfirm', outcome: 'done' }, thenStep: 0 }],
    });
    expect(kit.$$('.cg-confirm')).toHaveLength(1);
    const group = kit.$('.cg-confirm') as HTMLElement;
    expect(text(group.querySelector('.cg-confirm__q'))).toBe('Текст в поле изменился после генерации.');
    expect(group.closest('.cg-co__drafts')?.getAttribute('aria-label')).toBe('Черновик 2');
    expect(group.closest('.cg-part')?.getAttribute('data-cg-part')).toBe('0');
    const cancel = [...group.querySelectorAll('button')][2] as HTMLElement;
    cancel.focus();
    await flush(() => cancel.dispatchEvent(keydown('Escape')));
    expect(kit.client.dispatched).toEqual([{ type: 'AnswerConfirm', confirmationId: uuid(501), choice: 'cancel' }]);
    // Focus is back on «Вставить» of that part, in that draft.
    const again = kit.root.activeElement as HTMLElement;
    expect(again.classList.contains('cg-ins')).toBe(true);
    expect(again.closest('.cg-co__drafts')?.getAttribute('aria-label')).toBe('Черновик 2');
  });

  it('[DB-019] in debug mode a turn carries its debug footer — time, tokens, cost, «Промпт», the stage profile; outside it nothing of that shows', async () => {
    const debug = {
      costLine: 'in 5 210 tok • out 402 tok • $0.0188 • 4.1 s • model-test',
      stages: [
        { name: 'request', ms: 36 },
        { name: 'first-chunk', ms: 1_240 },
        { name: 'stream', ms: 2_810 },
      ],
      totalMs: 4_086,
      hubStages: [{ name: 'context', ms: 190 }],
      prompt: { type: 'Navigate', to: { kind: 'debug-prompt', promptHandle: 'snap-3' } } as const,
      reasoning: null,
      context: null,
      liveTimer: false,
    };
    kit = mount(coach(ctx, views.ready(), [coachTurn(ctx, 1, { debug })]));
    await settle(2);
    const foot = kit.$('[data-cg-answer="turn-1"] .cg-debug') as HTMLElement;
    expect(text(foot.querySelector('.cg-debug__line span'))).toBe(debug.costLine);
    expect([...foot.querySelectorAll('.cg-prof__legend:not(.cg-prof__legend--hub) span')].map(text)).toEqual(['запрос 36', 'первый чанк 1 240', 'поток 2 810', 'мс, всего 4,09 с']);
    await flush(() => (foot.querySelector('.cg-debug__link') as HTMLElement).click());
    expect(kit.client.dispatched).toEqual([{ type: 'Navigate', to: { kind: 'debug-prompt', promptHandle: 'snap-3' } }]);
    kit.unmount();
    kit = mount(coach(ctx, views.ready(), [coachTurn(ctx, 1)]));
    await settle(2);
    expect(kit.$('.cg-debug')).toBeNull();
    expect(kit.$('.cg-side')?.textContent).not.toMatch(/\btok\b|\$0\./);
  });

  it('[AI-087] drafts are copy-only where the dock is (a blocked fan, a broken host contract)', () => {
    kit = mountSurface(coachSurface.view, scenarioOf([entry({ of: 'dock' }, dock(ctx, 'blocked-fan')), entry({ of: 'coach' }, coach(ctx, views.ready(), [coachTurn(ctx, 1)]))]), 'coach', coachSurface.styles ?? []);
    expect(kit.$$('.cg-co__drafts .cg-ins')).toEqual([]);
    expect(kit.$$('.cg-co__drafts .cg-copy-main')).toHaveLength(2);
  });

  it('[AI-092] a failed turn shows its error card with the recovery button; the question stays in the list', () => {
    const failed = coachTurn(ctx, 1, { state: 'failed', answer: null, error: cgError(ctx, 'CG-PROVIDER-STREAM'), errorActions: [] });
    kit = mount(coach(ctx, views.ready(), [failed]));
    expect(text(kit.$('.cg-co__turn .cg-card__code'))).toBe('ChatGoose · CG-PROVIDER-STREAM');
    expect(text(kit.$('.cg-co__turn.is-you p'))).toBe('Как вернуть его к покупкам?');
  });

  it('[AI-094] turns beyond the history limit stand above the memory line', () => {
    kit = mount(coach(ctx, views.ready(), [coachTurn(ctx, 1, { outsideMemory: true }), coachTurn(ctx, 2)]));
    const line = kit.$('.cg-co__memory') as HTMLElement;
    expect(line.getAttribute('role')).toBe('separator');
    expect(text(line)).toBe('Ходы выше Coach уже не помнит');
    expect(line.parentElement?.querySelector('[data-cg-turn]')?.getAttribute('data-cg-turn')).toBe('turn-2');
  });

  it('[AI-097] the freshness of what Coach reads: «Переписка на 06:20» and a refresh; a lagging archive turns it into the accent line', async () => {
    kit = mount(coach(ctx, views.ready(), []));
    expect(text(kit.$('.cg-co__bar span'))).toBe('Переписка на 06:20');
    await flush(() => byLabel('Обновить переписку').click());
    expect(kit.client.dispatched).toEqual([{ type: 'RefreshArchive', targetHandle: HANDLE }]);
    expect(byLabel('Обновить переписку').classList.contains('cg-btn--line')).toBe(false);
    kit.unmount();
    kit = mount(coach(ctx, views.partial({ kind: 'archive-lag', messages: 2, minutes: null }), []));
    expect(text(kit.$('.cg-co__bar .is-lag'))).toBe('Архив отстаёт от чата на 2 сообщения');
    expect(kit.$('.cg-co__bar .cg-dot--accent')?.getAttribute('data-accent-use')).toBe('archive-lag');
    expect(byLabel('Обновить переписку').classList.contains('cg-btn--line')).toBe(true);
  });

  it('[AI-090] «Новый диалог» asks first when there are turns (DialogPort) and starts at once when there are none', async () => {
    kit = mount(coach(ctx, views.ready(), [coachTurn(ctx, 1)]));
    kit.deps.dialogs.answer = 'cancel';
    await flush(() => byLabel('Новый диалог').click());
    await settle(1);
    expect(kit.deps.dialogs.asked).toHaveLength(1);
    expect(kit.deps.dialogs.asked[0]?.title).toEqual({ key: 'coach.newDialog' });
    expect(kit.client.dispatched).toEqual([]);
    kit.deps.dialogs.answer = 'confirm';
    await flush(() => byLabel('Новый диалог').click());
    await settle(1);
    expect(kit.client.dispatched).toEqual([{ type: 'NewCoachDialog' }]);
    kit.unmount();
    kit = mount(coach(ctx, views.ready(), []));
    await flush(() => byLabel('Новый диалог').click());
    expect(kit.deps.dialogs.asked).toEqual([]);
    expect(kit.client.dispatched).toEqual([{ type: 'NewCoachDialog' }]);
  });

  it('[AI-095] the Recap Coach was given is folded under the head', () => {
    kit = mount(coach(ctx, views.ready(), [coachTurn(ctx, 1)]));
    const recap = kit.$('.cg-co__recap') as HTMLElement;
    expect(recap.tagName).toBe('DETAILS');
    expect(text(recap.querySelector('summary'))).toBe('RecapСделан 1 д назад');
    expect(text(recap.querySelector('p'))).toContain('Hubert, 34, Warsaw.');
  });

  it('with no chat ready there is nobody to ask about: «Спросить» is off', async () => {
    kit = mountSurface(coachSurface.view, scenarioOf([entry({ of: 'dock' }, dock(ctx, 'loading-chat')), entry({ of: 'coach' }, coach(ctx, views.ready(), []))]), 'coach', coachSurface.styles ?? []);
    await type('вопрос');
    await flush(() => byLabel('Спросить').click());
    expect(kit.client.dispatched).toEqual([]);
  });
});
