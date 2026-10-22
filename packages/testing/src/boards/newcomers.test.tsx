// «Новые» on ChatSpace (R15; ui-design §3.6, §4.17, §10; H-7; X60): the family's window and card, as on Fansly. Hi is
// one variant; a greeting in parts goes part after part, each by its own click on the card's «Отправить →»; a key on the
// list acts on the fan of its row and never sends.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { type NewcomersVM, type PreviewVM } from '@cg/contracts';

import { ctxOf, entry, newcomerRow, type AppClientScenario } from '../scenarios/app-client';
import { flush, keydown, mountBoardSettled, settle, textOf, type MountedBoard } from './harness';
import { boardScenario } from './states';

let ui: MountedBoard | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
  vi.useRealTimers();
});

const ctx = ctxOf({ lang: 'ru', platform: 'mac' });
const row = (key: string): HTMLElement => ui?.$(`[data-cg-fan="newcomers:${key}"]`) as HTMLElement;

function change(state: string, list: (vm: NewcomersVM) => NewcomersVM, card: (vm: PreviewVM) => PreviewVM = (vm) => vm): AppClientScenario {
  const base = boardScenario(state);
  return {
    ...base,
    views: base.views.map((view) =>
      view.selector.of === 'newcomers' ? entry({ of: 'newcomers' }, list(view.vm as NewcomersVM)) : view.selector.of === 'preview' ? entry({ of: 'preview', from: 'newcomers' }, card(view.vm as PreviewVM)) : view,
    ),
  };
}

describe('«Новые»: the window and the list', () => {
  it('[X55] Enter on the card’s own row: Hi when the card has nothing yet, the field when it has — never a send', async () => {
    const press = async (target: HTMLElement, code: string): Promise<void> => flush(() => keydown(target, code, { code }));
    // The card has no result: Enter is Hi of one variant for that fan.
    ui = await mountBoardSettled('newcomers', change('13a', (vm) => vm, (card) => ({ ...card, result: null })));
    await press(row('n001'), 'Enter');
    expect(ui.actions().at(-1)).toEqual({ type: 'Generate', targetHandle: 'newcomers:n001', feature: 'hi', options: { variants: 1 } });
    ui.unmount();
    // The greeting is there: Enter starts nothing and puts the focus on the field, where it is read before «Отправить →».
    ui = await mountBoardSettled('newcomers', '13a');
    const before = ui.actions().length;
    await press(row('n001'), 'Enter');
    expect(ui.actions().slice(before)).toEqual([]);
    expect(ui.root.activeElement).toBe(ui.$('.cg-nc__field textarea'));
    ui.unmount();
    // A colleague's part is on its way: a note, no hold (2026-10-22) — Enter is Hi, never a send.
    ui = await mountBoardSettled('newcomers', '13c');
    const held = ui.actions().length;
    await press(row('n003'), 'Enter');
    expect(ui.actions().slice(held)).toMatchObject([{ type: 'Generate', feature: 'hi' }]);
    expect(ui.actions().filter((action) => action.type === 'SendPart' || action.type === 'InsertPart' || action.type === 'OpenAndInsertPart')).toEqual([]);
  });

  it('a key acts on the fan of the focused row when the list changed above it: Enter and Space never open a neighbour’s card', async () => {
    const base = change('13a', (vm) => ({ ...vm, cardOpen: false }));
    const list = base.views.find((view) => view.selector.of === 'newcomers')?.vm as NewcomersVM;
    const fresh = newcomerRow(ctx, { key: 'f2777', name: 'Just Subscribed', username: 'just_sub' }, 'new', 1, { s: 'none' });
    ui = await mountBoardSettled('newcomers', {
      ...base,
      steps: [
        // A new subscriber lands on top: every row moves one place down.
        { label: 'a row above', at: 1_000, views: [entry({ of: 'newcomers' }, { ...list, rows: [fresh, ...list.rows] })] },
        // The first two leave «К обработке»: every row moves up.
        { label: 'rows gone above', at: 2_000, views: [entry({ of: 'newcomers' }, { ...list, rows: list.rows.slice(1) })] },
        // The focused fan leaves too.
        { label: 'the fan left', at: 3_000, views: [entry({ of: 'newcomers' }, { ...list, rows: list.rows.slice(2) })] },
      ],
    });
    const focused = (): HTMLElement => ui?.root.activeElement as HTMLElement;
    const press = async (code: string, key = code): Promise<void> => flush(() => keydown(focused(), key, { code }));
    const tabStops = (): (string | null)[] => (ui?.$$('.cg-nw__side [data-cg-item][tabindex="0"]') ?? []).map((element) => element.getAttribute('data-cg-fan'));
    await press('ArrowDown');
    expect(focused()).toBe(row('n002'));
    for (const step of [0, 1]) {
      await flush(() => ui?.client.goTo(step));
      await settle();
      expect(focused().getAttribute('data-cg-fan')).toBe('newcomers:n002');
      expect(tabStops()).toEqual(['newcomers:n002']);
      const before = ui.actions().length;
      await press('Enter');
      await press('Space', ' ');
      expect(ui.actions().slice(before)).toEqual([
        { type: 'OpenPreview', targetHandle: 'newcomers:n002' },
        { type: 'OpenPreview', targetHandle: 'newcomers:n002' },
      ]);
    }
    await press('ArrowDown');
    expect(focused().getAttribute('data-cg-fan')).toBe('newcomers:n003');
    await press('ArrowUp');
    expect(focused().getAttribute('data-cg-fan')).toBe('newcomers:n002');
    // The key is the row's it came from, whatever row the window remembers as the keyboard's (n002 here).
    const elsewhere = ui.actions().length;
    await flush(() => keydown(row('n003'), 'Enter', { code: 'Enter' }));
    expect(ui.actions().slice(elsewhere)).toEqual([{ type: 'OpenPreview', targetHandle: 'newcomers:n003' }]);
    expect(tabStops()).toEqual(['newcomers:n002']);
    const before = ui.actions().length;
    await flush(() => ui?.client.goTo(2));
    await settle();
    expect(row('n002')).toBeNull();
    expect(tabStops()).toEqual(['newcomers:n003']);
    expect(ui.actions().slice(before)).toEqual([]);
  });
});

describe('«Новые»: a batch draft sent from its row (X59, as on Fansly)', () => {
  it('a ready draft has its row’s own «Отправить»: one click, one fan, the card never opened, never a key', async () => {
    const ready = (vm: NewcomersVM): NewcomersVM => ({
      ...vm,
      rows: vm.rows.map((entry, at) => (at === 0 ? { ...entry, batch: { pickable: false, picked: false, state: 'ready', text: 'hey 💛 welcome!', failure: null }, send: { can: true, refused: null } } : entry)),
    });
    ui = await mountBoardSettled('newcomers', change('13a', ready));
    const sends = ui.$$('.cg-nw__rsend');
    expect(sends.map((button) => [textOf(button), button.classList.contains('cg-btn--send')])).toEqual([['Отправить', true]]);
    expect(ui.text('.cg-nw__row .cg-nw__dtext')).toBe('hey 💛 welcome!');
    for (const code of ['Enter', 'Space', 'KeyS']) await flush(() => keydown(row('n001'), code === 'Space' ? ' ' : code, { code }));
    expect(ui.actionsOf('SendNewcomerGreeting')).toEqual([]);
    const opened = ui.actionsOf('OpenPreview').length;
    await flush(() => (sends[0] as HTMLElement).click());
    expect(ui.actions().at(-1)).toEqual({ type: 'SendNewcomerGreeting', targetHandle: 'newcomers:n001' });
    expect(ui.actionsOf('OpenPreview')).toHaveLength(opened);
  });
});

describe('«Новые»: the card', () => {
  const field = (): HTMLTextAreaElement => ui?.$('.cg-nc__field textarea') as HTMLTextAreaElement;
  const bar = (): string[] => (ui?.$$('.cg-nc__gbar button') ?? []).map(textOf);

  it('[X60] the family’s card: Hi’s first part in the field with «AI», «Часть 1 из 3», one «Отправить →» that sends that part alone', async () => {
    ui = await mountBoardSettled('newcomers', '13a');
    expect(ui.$('.cg-pv')).toBeNull();
    expect(field().value).toBe('hiii Tomasz 🥰 welcome to my VIP!');
    expect(ui.text('.cg-nc__ai')).toBe('AI');
    expect(ui.text('.cg-nc__gnote')).toBe('Часть 1 из 3');
    expect(bar()).toEqual(['Сгенерировать', 'Открыть и вставить', 'Отправить →']);
    await flush(() => (ui?.$('.cg-nc__gen') as HTMLElement).click());
    expect(ui.actions().at(-1)).toEqual({ type: 'Generate', targetHandle: 'newcomers:n001', feature: 'hi', options: { variants: 1 } });
    await flush(() => (ui?.$('.cg-nc__send') as HTMLElement).click());
    expect(ui.actionsOf('SendPart')).toEqual([expect.objectContaining({ type: 'SendPart', part: 0 })]);
    // The click's lock: a second click before the model answers sends nothing more.
    await flush(() => (ui?.$('.cg-nc__send') as HTMLElement).click());
    expect(ui.actionsOf('SendPart')).toHaveLength(1);
  });

  it('[X60] a greeting in parts goes part after part: the field holds the next one, its state says where the last stands', async () => {
    // Part 1 sent, part 2 in ChatSpace's queue: the field holds part 2, «Отправить →» waits.
    ui = await mountBoardSettled('newcomers', '13b');
    expect(field().value).toBe("I'm Lora, so happy you're here…");
    expect(ui.text('.cg-nc__gnote')).toBe('Часть 2 из 3 · отправлено 1 из 3');
    expect(ui.$('.cg-nc__send')?.getAttribute('aria-busy')).toBe('true');
    expect(ui.$('.cg-nc__greet')?.getAttribute('data-cg-greeting')).toBe('queued');
    ui.unmount();
    // Part 2's outcome unknown: said, with «Открыть чат» and «Отправить ещё раз» — the person's own click, never by itself.
    ui = await mountBoardSettled('newcomers', '13d');
    expect(ui.$('.cg-nc__gst[data-cg-uncertain]')).not.toBeNull();
    expect(bar()).toContain('Отправить ещё раз');
    expect(ui.actionsOf('SendPart')).toEqual([]);
  });

  it('[X60] the person’s own text: an edit of the AI part is what goes', async () => {
    // The controller lets a part on no one's way be edited (`editable`).
    const editable = (card: PreviewVM): PreviewVM => (card.result === null ? card : { ...card, result: { ...card.result, parts: (card.result.parts ?? []).map((part) => ({ ...part, editable: true })) } });
    ui = await mountBoardSettled('newcomers', change('13a', (vm) => vm, editable));
    const area = field();
    area.value = 'hi Tomasz, so glad you are here';
    await flush(() => area.dispatchEvent(new Event('input', { bubbles: true })));
    expect(ui.actions().at(-1)).toEqual(expect.objectContaining({ type: 'EditPart', part: 0, text: 'hi Tomasz, so glad you are here' }));
  });
});
