// «Новые» (R15; ui-design §3.6, §4.17, §10; H-7): Hi is one variant split
// into parts, each sent by its own click; a key on the list acts on the fan of
// its row and never sends.

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
  it('[X55] Enter on the card’s own row: Hi when the card has nothing yet, the first part when it has, Hi’s reason when it is off — never a send', async () => {
    const press = async (target: HTMLElement, code: string): Promise<void> => flush(() => keydown(target, code, { code }));
    // The card has no result: Enter is Hi of one variant for that fan.
    ui = await mountBoardSettled('newcomers', change('13a', (vm) => vm, (card) => ({ ...card, result: null })));
    await press(row('n001'), 'Enter');
    expect(ui.actions().at(-1)).toEqual({ type: 'Generate', targetHandle: 'newcomers:n001', feature: 'hi', options: { variants: 1 } });
    ui.unmount();
    // The greeting is there: Enter starts nothing and puts the focus on its first part (Enter there is «Открыть и вставить»).
    ui = await mountBoardSettled('newcomers', '13a');
    const before = ui.actions().length;
    await press(row('n001'), 'Enter');
    expect(ui.actions().slice(before)).toEqual([]);
    expect(ui.root.activeElement?.closest('.cg-pv [data-cg-part]')).not.toBeNull();
    ui.unmount();
    // A colleague holds the fan: Hi is off — Enter starts nothing and shows Hi, whose tooltip says why.
    ui = await mountBoardSettled('newcomers', '13c');
    const held = ui.actions().length;
    await press(row('n003'), 'Enter');
    expect(ui.actions().slice(held)).toEqual([]);
    expect(ui.root.activeElement?.closest('[data-cg-strip="hi"]')).not.toBeNull();
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

describe('«Новые»: the card', () => {
  it('Hi greets with one variant split into parts; each part is sent by its own click', async () => {
    ui = await mountBoardSettled('newcomers', '13a');
    expect(ui.text('.cg-pvr__title')).toBe('Hi');
    expect(ui.text('.cg-pvr__meta')).toBe('1 вариант, 3 части');
    expect(ui.$('.cg-pvr__draft')?.firstChild?.textContent).toBe('черновик · не отправлено');
    expect(ui.$$('.cg-pvp')).toHaveLength(3);
    expect(ui.$$('.cg-pvs__send').map(textOf)).toEqual(['Отправить']);
    await flush(() => (ui?.$('.cg-pvb [data-cg-strip="hi"] .cg-act') as HTMLElement).click());
    expect(ui.actions().at(-1)).toEqual({ type: 'Generate', targetHandle: 'newcomers:n001', feature: 'hi', options: { variants: 1 } });
    await flush(() => (ui?.$('.cg-pvs__send') as HTMLElement).click());
    expect(ui.actionsOf('SendPart')).toHaveLength(1);
  });
});
