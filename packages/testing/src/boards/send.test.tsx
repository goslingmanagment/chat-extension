// «Отправить» in a preview (X8; architecture.md §6.7; ui-design §4.13): the
// nine states with their exact words, and the rules a UI must not break — a
// send is one click on one part's own button; there is no «send all», no send
// key and no next part by itself; an unknown outcome is never retried; a held
// send is never offered again as it is.

import { afterEach, describe, expect, it } from 'vitest';

import { PREVIEW_SEND_STATES, type ActionReceipt, type PreviewSendView, type PreviewVM, type UiAction } from '@cg/contracts';

import { cgError, ctxOf, entry, iso, MIN, msg, NOW, preview, scenarioById, uuid, views, withResult, type AppClientScenario } from '../scenarios/app-client';
import { flush, keydown, mountBoardSettled, settle, textOf, type MountedBoard } from './harness';
import { boardScenario, sendResult } from './states';

let ui: MountedBoard | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
});

const ctx = ctxOf({ lang: 'ru', platform: 'mac' });
const SENT_AT = iso(NOW + MIN);
const OP = uuid(701);
const TEXTS = ['first part', 'second part', 'third part'] as const;

/** A Spenders preview whose Reply parts are in `states`. */
function previewOf(states: readonly PreviewSendView[], patch: Partial<AppClientScenario> = {}): AppClientScenario {
  const base = boardScenario('11a');
  const vm = withResult(preview(ctx, 'spenders', views.ready()), sendResult(ctx, OP, 'reply', TEXTS.slice(0, states.length), states, []));
  return { ...base, views: [...base.views.filter((view) => view.selector.of !== 'preview'), entry({ of: 'preview', from: 'spenders' }, vm)], ...patch };
}

/** The same preview with every part's `openInsert` set to `available`: what a controller may send, whatever the part's send state. */
function everyPartInsertable(scenario: AppClientScenario): AppClientScenario {
  return {
    ...scenario,
    views: scenario.views.map((view) => {
      if (view.selector.of !== 'preview') return view;
      const vm = view.vm as PreviewVM;
      if (vm.result === null) return view;
      return entry({ of: 'preview', from: 'spenders' }, { ...vm, result: { ...vm.result, parts: (vm.result.parts ?? []).map((item) => ({ ...item, openInsert: { s: 'available' as const } })) } });
    }),
  };
}

/** The board with Hubert's preview open, and in that preview the «x8-lifecycle» scenario: its steps and its reaction to a click. */
function lifecycle(): AppClientScenario {
  const base = boardScenario('11a');
  const steps = scenarioById('x8-lifecycle');
  return { ...base, views: [...base.views.filter((view) => view.selector.of !== 'preview'), ...steps.views], ...(steps.steps === undefined ? {} : { steps: steps.steps }), ...(steps.reactions === undefined ? {} : { reactions: steps.reactions }) };
}

const part = (index: number): HTMLElement => ui?.$(`.cg-pvp[data-cg-part="${index}"]`) as HTMLElement;
const sendRow = (index: number): HTMLElement => part(index).querySelector('.cg-pvs') as HTMLElement;
const buttons = (index: number): string[] => [...part(index).querySelectorAll('button')].map((button) => button.getAttribute('aria-label') ?? textOf(button));
const stateWords = (index: number): string => textOf(part(index).querySelector('.cg-pvs__st'));
const codeLine = (index: number): string => textOf(part(index).querySelector('.cg-pvs__code'));
const sends = (): UiAction[] => (ui?.actions() ?? []).filter((action) => action.type === 'SendPart');

describe('[SP-054] «Отправить»: the nine states, their words and their buttons', () => {
  it('covers every state of the contract', () => {
    expect([...PREVIEW_SEND_STATES].sort()).toEqual(['accepted', 'available', 'held-stale', 'queued', 'rejected', 'sending', 'sent', 'unavailable', 'uncertain']);
  });

  it('available: the blue «Отправить», «Открыть и вставить» and Copy; no state words, no code line', async () => {
    ui = await mountBoardSettled('spenders', previewOf([{ s: 'available' }]));
    expect(sendRow(0).getAttribute('data-cg-send')).toBe('available');
    expect(buttons(0)).toEqual(['Отправить', 'Открыть и вставить', 'Копировать часть 1']);
    const send = part(0).querySelector('.cg-pvs__send') as HTMLElement;
    expect(send.classList.contains('cg-btn--send')).toBe(true);
    // No key label on it and no shortcut: it is sent by a press only (§6.7.4 п. 1).
    expect(send.querySelector('kbd')).toBeNull();
    expect(send.hasAttribute('aria-keyshortcuts')).toBe(false);
    expect(part(0).querySelector('.cg-pvs__st')).toBeNull();
    expect(part(0).querySelector('.cg-pvs__code')).toBeNull();
  });

  it('unavailable: «Отправить» off as a line, the reason by code, the two other buttons stay', async () => {
    ui = await mountBoardSettled('spenders', previewOf([{ s: 'unavailable', code: 'CG-SEND-HOST', reason: msg('send.reason.host') }]));
    const send = part(0).querySelector('.cg-pvs__send') as HTMLElement;
    expect(send.getAttribute('aria-disabled')).toBe('true');
    // A line button: the blue one would promise a send.
    expect(send.classList.contains('cg-btn--line')).toBe(true);
    expect(part(0).querySelector('.cg-btn--send')).toBeNull();
    expect(buttons(0)).toEqual(['Отправить', 'Открыть и вставить', 'Копировать часть 1']);
    expect(codeLine(0)).toBe('ChatGoose · CG-SEND-HOST: Отправка недоступна: ChatSpace сейчас не принимает отправку из расширения. Вставьте часть в чат вручную.');
    expect(textOf(part(0).querySelector('.cg-pvs__code b'))).toBe('ChatGoose · CG-SEND-HOST:');
    await flush(() => send.click());
    expect(sends()).toEqual([]);
  });

  it('queued: a ring and «В очереди ChatSpace»; nothing to press (we never cancel ChatSpace’s queue)', async () => {
    ui = await mountBoardSettled('spenders', previewOf([{ s: 'queued' }]));
    expect(stateWords(0)).toBe('В очереди ChatSpace');
    expect(part(0).querySelector('.cg-dot--ring')).not.toBeNull();
    expect(buttons(0)).toEqual([]);
  });

  it('sending: a spinner and «Отправляется…»; nothing to press', async () => {
    ui = await mountBoardSettled('spenders', previewOf([{ s: 'sending' }]));
    expect(stateWords(0)).toBe('Отправляется…');
    expect(part(0).querySelector('.cg-spin')).not.toBeNull();
    expect(buttons(0)).toEqual([]);
  });

  it('accepted: a pulsing dot and «Принято ChatSpace, ждём подтверждения» — never «Отправлено»', async () => {
    ui = await mountBoardSettled('spenders', previewOf([{ s: 'accepted' }]));
    expect(stateWords(0)).toBe('Принято ChatSpace, ждём подтверждения');
    expect(part(0).querySelector('.cg-dot--pulse')).not.toBeNull();
    expect(part(0).classList.contains('is-done')).toBe(false);
    expect(buttons(0)).toEqual([]);
  });

  it('sent: the part collapses to one line «✓ Отправлено 09:21» with Copy', async () => {
    ui = await mountBoardSettled('spenders', previewOf([{ s: 'sent', at: SENT_AT }]));
    expect(part(0).classList.contains('is-done')).toBe(true);
    expect(textOf(part(0).querySelector('.cg-pvp__a .cg-pvs__st'))).toBe('Отправлено 09:21');
    expect(part(0).getAttribute('aria-label')).toBe('Часть 1, отправлена');
    expect(buttons(0)).toEqual(['Копировать часть 1']);
    expect(part(0).querySelector('.cg-pvs')).toBeNull();
  });

  it('rejected without a retry: a red dot, «Не отправлено», «Открыть и вставить» and Copy — no blue button', async () => {
    ui = await mountBoardSettled('spenders', previewOf([{ s: 'rejected', code: 'CG-SEND-REJECTED', detail: 'OnlyFans didn’t accept this action', canRetry: false }]));
    expect(stateWords(0)).toBe('Не отправлено');
    expect(part(0).querySelector('.cg-dot--danger')).not.toBeNull();
    expect(buttons(0)).toEqual(['Открыть и вставить', 'Копировать часть 1']);
    expect(part(0).querySelector('.cg-btn--send')).toBeNull();
    expect(codeLine(0)).toBe('ChatGoose · CG-SEND-REJECTED: OnlyFans didn’t accept this action. Текст не ушёл.');
  });

  it('rejected by Message Guard: the same row with its own words', async () => {
    ui = await mountBoardSettled('spenders', previewOf([{ s: 'rejected', code: 'CG-SEND-GUARD', canRetry: false }]));
    expect(codeLine(0)).toBe('ChatGoose · CG-SEND-GUARD: Message Guard ChatSpace не пропустил текст. Текст не ушёл.');
    expect(part(0).querySelector('.cg-btn--send')).toBeNull();
  });

  it('rejected with a retry the model allows: «Отправить ещё раз» (blue) and Copy', async () => {
    ui = await mountBoardSettled('spenders', previewOf([{ s: 'rejected', code: 'CG-SEND-QUEUE', canRetry: true }]));
    expect(stateWords(0)).toBe('Не отправлено');
    expect(buttons(0)).toEqual(['Отправить ещё раз', 'Копировать часть 1']);
    expect(codeLine(0)).toBe('ChatGoose · CG-SEND-QUEUE: очередь ChatSpace не приняла сообщение. Текст не ушёл.');
    await flush(() => (part(0).querySelector('.cg-btn--send') as HTMLElement).click());
    expect(sends()).toEqual([{ type: 'SendPart', operationId: OP, part: 0 }]);
  });

  it('the retry is the model’s decision: the same code with canRetry false shows no «Отправить ещё раз»', async () => {
    ui = await mountBoardSettled('spenders', previewOf([{ s: 'rejected', code: 'CG-SEND-QUEUE', canRetry: false }]));
    expect(buttons(0)).toEqual(['Открыть и вставить', 'Копировать часть 1']);
  });

  it('[NF-022] uncertain: «Неизвестно, ушло ли» and only «Открыть чат для проверки» — no retry, no insert, no copy', async () => {
    const attemptId = uuid(711);
    ui = await mountBoardSettled('spenders', previewOf([{ s: 'uncertain', since: SENT_AT, attemptId }]));
    expect(stateWords(0)).toBe('Неизвестно, ушло ли');
    expect(part(0).querySelector('.cg-dot--ink')).not.toBeNull();
    expect(buttons(0)).toEqual(['Открыть чат для проверки']);
    expect(codeLine(0)).toBe('ChatGoose · CG-SEND-UNCERTAIN: с 09:21. Ждём проверки тимлидом или владельцем; повторно не отправляем.');
    await flush(() => (part(0).querySelector('.cg-pvs__verify') as HTMLElement).click());
    expect(ui.actions().at(-1)).toEqual({ type: 'OpenChatToVerify', attemptId });
    // Enter on the part does not open-and-insert an uncertain part either.
    await flush(() => keydown(part(0), 'Enter'));
    expect(ui.actionsOf('OpenAndInsertPart')).toEqual([]);
    expect(sends()).toEqual([]);
  });

  it('held-stale: the blue dot «Удержано: фан написал новое» and «Ещё раз» — a new answer, never the stale send', async () => {
    ui = await mountBoardSettled('spenders', previewOf([{ s: 'held-stale', at: SENT_AT }]));
    expect(stateWords(0)).toBe('Удержано: фан написал новое');
    expect(part(0).querySelector('.cg-dot--accent')?.getAttribute('data-accent-use')).toBe('send-held-stale');
    expect(buttons(0)).toEqual(['Ещё раз']);
    expect(codeLine(0)).toBe('ChatGoose · CG-SEND-STALE: ответ не учитывает новое сообщение фана. Обновите архив выше и нажмите «Ещё раз».');
    await flush(() => (part(0).querySelector('.cg-pvs__again') as HTMLElement).click());
    expect(ui.actions().at(-1)).toEqual({ type: 'Regenerate', operationId: OP });
    expect(sends()).toEqual([]);
  });
});

describe('[SP-054] one click sends one part; nothing sends by itself', () => {
  it('a click sends exactly that part, once, however often it is pressed', async () => {
    ui = await mountBoardSettled('spenders', previewOf([{ s: 'available' }, { s: 'available' }, { s: 'available' }]));
    const send = part(0).querySelector('.cg-pvs__send') as HTMLElement;
    await flush(() => {
      send.click();
      send.click();
      send.click();
    });
    expect(sends()).toEqual([{ type: 'SendPart', operationId: OP, part: 0 }]);
    // The button is off until the model says what happened (§6.7.7, блокировка 1).
    expect(send.getAttribute('aria-disabled')).toBe('true');
    expect(send.getAttribute('aria-busy')).toBe('true');
    await flush(() => send.click());
    expect(sends()).toHaveLength(1);
  });

  it('a refused click unlocks the button: nothing was started', async () => {
    const refusal: ActionReceipt = { ok: false, type: 'SendPart', code: 'CG-SEND-BUSY', error: cgError(ctx, 'CG-SEND-BUSY') };
    ui = await mountBoardSettled('spenders', previewOf([{ s: 'available' }], { reactions: [{ on: 'SendPart', receipt: refusal }] }));
    const send = part(0).querySelector('.cg-pvs__send') as HTMLElement;
    await flush(() => send.click());
    await settle();
    expect(send.hasAttribute('aria-disabled')).toBe(false);
  });

  it('only the first unsent part has «Отправить»: the others wait behind it, each named', async () => {
    ui = await mountBoardSettled('spenders', '11a');
    expect(ui.$$('.cg-pvs__send')).toHaveLength(1);
    expect(sendRow(0).getAttribute('data-cg-send')).toBe('available');
    expect(stateWords(1)).toBe('Отправка после части 1');
    expect(stateWords(2)).toBe('Отправка после части 2');
    expect(buttons(1)).toEqual(['Копировать часть 2']);
    // «черновик · не отправлено» until a part starts sending.
    expect(ui.$('.cg-pvr__draft')?.firstChild?.textContent).toBe('черновик · не отправлено');
  });

  it('there is no «send all», no send key and no button that sends more than its own part', async () => {
    ui = await mountBoardSettled('spenders', '11a');
    const labels = ui.$$('.cg-pv button').map((button) => button.getAttribute('aria-label') ?? textOf(button));
    expect(labels.filter((label) => /отправить/i.test(label))).toEqual(['Отправить']);
    expect(ui.$$('.cg-pv [aria-keyshortcuts]').filter((element) => element.closest('.cg-pvs') !== null)).toEqual([]);
    // Every key a person may try on the result: none of them sends.
    const root = ui.$('.cg-pv') as HTMLElement;
    for (const target of [part(0), part(1), root, ui.$('.cg-pvr') as HTMLElement]) {
      for (const init of [{ key: 'Enter' }, { key: 'Enter', metaKey: true }, { key: 'Enter', ctrlKey: true }, { key: 'Enter', shiftKey: true }, { key: ' ', code: 'Space' }, { key: 's', code: 'KeyS', metaKey: true }]) {
        await flush(() => keydown(target, init.key, init));
      }
    }
    expect(sends()).toEqual([]);
  });

  it('[HK-042] Enter and ⌘↵ on a focused part are «Открыть и вставить» for that part, never a send', async () => {
    ui = await mountBoardSettled('spenders', '11a');
    await flush(() => keydown(part(0), 'Enter'));
    expect(ui.actions()).toEqual([{ type: 'OpenAndInsertPart', operationId: OP, part: 0 }]);
    await flush(() => keydown(part(0), 'Enter', { metaKey: true }));
    await flush(() => keydown(part(0), 'Enter', { ctrlKey: true }));
    expect(ui.actionsOf('OpenAndInsertPart')).toHaveLength(3);
    // Part 2 waits behind part 1: its row shows no «Открыть и вставить», so the key offers none either.
    expect(buttons(1)).toEqual(['Копировать часть 2']);
    await flush(() => keydown(part(1), 'Enter'));
    await flush(() => keydown(part(1), 'Enter', { metaKey: true }));
    expect(ui.actionsOf('OpenAndInsertPart')).toHaveLength(3);
    expect(sends()).toEqual([]);
    // ↑ ↓ move between the parts; one of them is the tab stop.
    part(0).focus();
    await flush(() => keydown(part(0), 'ArrowDown'));
    expect(ui.root.activeElement).toBe(part(1));
    expect(ui.$$('.cg-pvp[tabindex="0"]')).toHaveLength(1);
  });

  it('[HK-042] [NF-022] Enter opens-and-inserts only where the row shows that button: never on an uncertain, held or waiting part, whatever the model sent', async () => {
    const uncertain: PreviewSendView = { s: 'uncertain', since: SENT_AT, attemptId: uuid(711) };
    const cases: readonly { readonly name: string; readonly states: readonly PreviewSendView[]; readonly rows: readonly (string | null)[] }[] = [
      // One uncertain part holds the group (§6.7.8, §6.7.9).
      { name: 'uncertain and the parts held behind it', states: [{ s: 'sent', at: SENT_AT }, uncertain, { s: 'available' }], rows: [null, 'uncertain', 'held-group'] },
      // A part in work: itself and the ones waiting behind it.
      { name: 'in work and the parts after it', states: [{ s: 'sending' }, { s: 'available' }, { s: 'available' }], rows: ['sending', 'after', 'after'] },
      { name: 'queued', states: [{ s: 'queued' }], rows: ['queued'] },
      { name: 'accepted', states: [{ s: 'accepted' }], rows: ['accepted'] },
      // «Фан написал новое»: only a new answer.
      { name: 'held-stale', states: [{ s: 'held-stale', at: SENT_AT }], rows: ['held-stale'] },
      // A retry the model allows is «Отправить ещё раз», not an insert.
      { name: 'rejected with a retry', states: [{ s: 'rejected', code: 'CG-SEND-QUEUE', canRetry: true }], rows: ['rejected-retry'] },
    ];
    for (const item of cases) {
      ui = await mountBoardSettled('spenders', everyPartInsertable(previewOf(item.states)));
      expect(ui.$$('.cg-pvp').map((element) => element.querySelector('.cg-pvs')?.getAttribute('data-cg-send') ?? null), item.name).toEqual(item.rows);
      // The model says `openInsert: available` on every part; no row of these shows the button…
      expect(ui.$$('.cg-pvs__open'), item.name).toEqual([]);
      // …and no key reaches it.
      for (const element of ui.$$('.cg-pvp')) {
        for (const init of [{}, { metaKey: true }, { ctrlKey: true }]) await flush(() => keydown(element, 'Enter', init));
      }
      expect(ui.actionsOf('OpenAndInsertPart'), item.name).toEqual([]);
      expect(sends(), item.name).toEqual([]);
      ui.unmount();
      ui = null;
    }
  });

  it('[HK-042] Enter opens-and-inserts where the row shows the button: available, unavailable, refused without a retry', async () => {
    const states: readonly PreviewSendView[] = [{ s: 'available' }, { s: 'unavailable', code: 'CG-SEND-HOST', reason: msg('send.reason.host') }, { s: 'rejected', code: 'CG-SEND-REJECTED', canRetry: false }];
    for (const state of states) {
      ui = await mountBoardSettled('spenders', previewOf([state]));
      expect(ui.$$('.cg-pvs__open')).toHaveLength(1);
      await flush(() => keydown(part(0), 'Enter'));
      expect(ui.actions()).toEqual([{ type: 'OpenAndInsertPart', operationId: OP, part: 0 }]);
      ui.unmount();
      ui = null;
    }
  });

  it('the «Отправить» lock ends with the model’s next word about the part, even when the state reads the same', async () => {
    // A send held before ChatSpace's queue reads «available» again: the click was accepted, nothing went out.
    const base = previewOf([{ s: 'available' }]);
    const again = previewOf([{ s: 'available' }]).views.filter((view) => view.selector.of === 'preview');
    ui = await mountBoardSettled('spenders', { ...base, steps: [{ label: 'the same state again', at: 1_000, views: again }] });
    const send = (): HTMLElement => part(0).querySelector('.cg-pvs__send') as HTMLElement;
    await flush(() => send().click());
    await settle();
    // Accepted, and the model has said nothing yet: the button stays off.
    expect(send().getAttribute('aria-disabled')).toBe('true');
    expect(send().getAttribute('aria-busy')).toBe('true');
    await flush(() => ui?.client.goTo(0));
    await settle();
    expect(send().hasAttribute('aria-disabled')).toBe(false);
    expect(send().hasAttribute('aria-busy')).toBe(false);
    expect(sends()).toHaveLength(1);
    // The button is the person's again: a second click is a second, deliberate click.
    await flush(() => send().click());
    expect(sends()).toHaveLength(2);
  });

  it('Enter on the focused «Отправить» is its click: the event is the button’s, the part does not take it', async () => {
    ui = await mountBoardSettled('spenders', '11a');
    const send = part(0).querySelector('.cg-pvs__send') as HTMLElement;
    const event = keydown(send, 'Enter');
    // The part leaves the key to the button (the browser turns it into a click).
    expect(event.defaultPrevented).toBe(false);
    expect(ui.actionsOf('OpenAndInsertPart')).toEqual([]);
  });

  it('[UI-029] no auto-next and no auto-insert: after part 1 is sent nothing is dispatched until a person clicks', async () => {
    ui = await mountBoardSettled('spenders', lifecycle());
    const first = (): HTMLElement => ui?.$('.cg-pvp[data-cg-part="0"]') as HTMLElement;
    await flush(() => (first().querySelector('.cg-pvs__send') as HTMLElement).click());
    await settle();
    expect(sends()).toHaveLength(1);
    // The model walks part 1 through the queue to «Отправлено».
    for (const step of [1, 2, 3]) {
      await flush(() => ui?.client.goTo(step));
      await settle();
    }
    expect(first().classList.contains('is-done')).toBe(true);
    expect(textOf(first().querySelector('.cg-pvp__a .cg-pvs__st'))).toMatch(/^Отправлено \d\d:\d\d$/);
    expect(ui.actions().map((action) => action.type)).toEqual(['SendPart']);
    // Part 2 is now the one that can be sent — by its own click.
    const second = ui.$('.cg-pvp[data-cg-part="1"]') as HTMLElement;
    expect(second.querySelector('.cg-pvs__send')).not.toBeNull();
    expect(ui.text('.cg-pvr__progress')).toBe('отправлено 1 из 2');
  });

  it('while a part is in work the next ones wait, and «Ещё раз» is off with the reason', async () => {
    ui = await mountBoardSettled('spenders', '11b');
    expect(part(0).classList.contains('is-done')).toBe(true);
    expect(stateWords(1)).toBe('Отправляется…');
    expect(stateWords(2)).toBe('Отправка после части 2');
    expect(ui.$$('.cg-pvs__send')).toEqual([]);
    const again = ui.$('.cg-pvr__head .cg-btn') as HTMLElement;
    expect(again.getAttribute('aria-disabled')).toBe('true');
    expect(ui.root.getElementById(again.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Нельзя, пока части отправляются');
    expect(textOf(ui.$('.cg-pvr__progress'))).toBe('отправлено 1 из 3');
    expect(ui.$('.cg-pvr__draft')).toBeNull();
  });

  it('an uncertain part holds the ones after it: «Удержано, пока неясен исход части 2», no send anywhere', async () => {
    ui = await mountBoardSettled('spenders', '11d');
    expect(stateWords(1)).toBe('Неизвестно, ушло ли');
    expect(stateWords(2)).toBe('Удержано, пока неясен исход части 2');
    expect(sendRow(2).getAttribute('data-cg-send')).toBe('held-group');
    expect(buttons(2)).toEqual(['Копировать часть 3']);
    expect(ui.$$('.cg-pvs__send')).toEqual([]);
    const again = ui.$('.cg-pvr__head .cg-btn') as HTMLElement;
    expect(ui.root.getElementById(again.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Нельзя, пока неясен исход части 2');
  });

  it('a state change is said once: «Часть 1. Отправлено 09:21»', async () => {
    ui = await mountBoardSettled('spenders', lifecycle());
    await flush(() => ui?.client.goTo(3));
    await settle();
    expect(textOf(ui.$('[data-cg-live]'))).toMatch(/^Часть 1\. Отправлено \d\d:\d\d$/);
  });

  it('the gallery of all states renders each state once, in a row of its own', async () => {
    ui = await mountBoardSettled('spenders', '11h');
    expect(ui.$$('.cg-pvp').map((item) => item.getAttribute('data-cg-send-state'))).toEqual(['available', 'unavailable', 'queued', 'sending', 'accepted', 'sent', 'rejected', 'rejected', 'uncertain', 'held-stale']);
    // The filled blue is on «Отправить» and «Отправить ещё раз» only.
    expect(ui.$$('.cg-pv .cg-btn--send:not([aria-disabled])').map(textOf)).toEqual(['Отправить', 'Отправить ещё раз']);
    // Blue dots only where our own result is held; red dots only next to a refusal.
    expect(ui.$$('.cg-pv .cg-dot--accent').map((dot) => dot.getAttribute('data-accent-use'))).toEqual(['send-held-stale']);
    expect(ui.$$('.cg-pv .cg-dot--danger')).toHaveLength(2);
  });
});
