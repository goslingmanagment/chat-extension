// «Отправить» in a preview (X8; architecture.md §6.7; ui-design §4.13): the
// rules a UI must not break — a send is one click on one part's own button;
// there is no «send all», no send key and no next part by itself; an unknown
// outcome is never retried; a held send is never offered again as it is.

import { afterEach, describe, expect, it } from 'vitest';

import { type PreviewSendView, type PreviewVM, type UiAction } from '@cg/contracts';

import { ctxOf, entry, iso, MIN, msg, NOW, preview, scenarioById, uuid, views, withResult, type AppClientScenario } from '../scenarios/app-client';
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

describe('[SP-054] «Отправить»: the states that must not send', () => {
  it('[X8-06] unavailable by the fuse (decision X25): CG-SEND-FUSE in plain words — what happened, where to reset it, insert by hand; nothing is sent', async () => {
    ui = await mountBoardSettled('spenders', previewOf([{ s: 'unavailable', code: 'CG-SEND-FUSE', reason: msg('send.reason.fuse') }]));
    const send = part(0).querySelector('.cg-pvs__send') as HTMLElement;
    expect(send.getAttribute('aria-disabled')).toBe('true');
    expect(buttons(0)).toEqual(['Отправить', 'Открыть и вставить', 'Копировать часть 1']);
    await flush(() => send.click());
    expect(sends()).toEqual([]);
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

  it('held-stale: the blue dot «Удержано: фан написал новое», «Ещё раз», or the chat opened on the fan’s new message — never the stale send', async () => {
    ui = await mountBoardSettled('spenders', previewOf([{ s: 'held-stale', at: SENT_AT }]));
    expect(stateWords(0)).toBe('Удержано: фан написал новое');
    expect(part(0).querySelector('.cg-dot--accent')?.getAttribute('data-accent-use')).toBe('send-held-stale');
    expect(buttons(0)).toEqual(['Ещё раз', 'Открыть и вставить', 'Копировать часть 1']);
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

  it('[HK-042] [NF-022] Enter opens-and-inserts only where the row shows that button: never on an uncertain or waiting part, whatever the model sent', async () => {
    const uncertain: PreviewSendView = { s: 'uncertain', since: SENT_AT, attemptId: uuid(711) };
    const cases: readonly { readonly name: string; readonly states: readonly PreviewSendView[]; readonly rows: readonly (string | null)[] }[] = [
      // One uncertain part holds the group (§6.7.8, §6.7.9).
      { name: 'uncertain and the parts held behind it', states: [{ s: 'sent', at: SENT_AT }, uncertain, { s: 'available' }], rows: [null, 'uncertain', 'held-group'] },
      // A part in work: itself and the ones waiting behind it.
      { name: 'in work and the parts after it', states: [{ s: 'sending' }, { s: 'available' }, { s: 'available' }], rows: ['sending', 'after', 'after'] },
      { name: 'queued', states: [{ s: 'queued' }], rows: ['queued'] },
      { name: 'accepted', states: [{ s: 'accepted' }], rows: ['accepted'] },
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
});
