// «Новые» (R15; ui-design §3.6, §4.17, §10, §12 п. 5; H-7; X60 — the same window
// as on Fansly): the list of new, renewed and returning subscribers with the
// greeting status and the lease, and the card — the preview pane with Hi only. A colleague's lease shows no
// name and no countdown; Hi is one variant split into parts, each sent by its
// own click.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { GREETING_STATUSES, type NewcomerRowVM, type NewcomersVM, type PreviewVM } from '@cg/contracts';
import { MAX_DOM_ROWS, SEARCH_DEBOUNCE_MS } from '@cg/ui/kit';
import { CARD_FOLLOW_MS, periodText } from '@cg/ui/newcomers';

import { cgError, claimMine, ctxOf, entry, FANS, iso, MIN, msg, newcomerRow, views, type AppClientScenario } from '../scenarios/app-client';
import { flush, keydown, mountBoardSettled, settle, textOf, type MountedBoard } from './harness';
import { BOARD_STATES, boardScenario } from './states';
import { boardWorld } from './world';

let ui: MountedBoard | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
  vi.useRealTimers();
});

const ctx = ctxOf({ lang: 'ru', platform: 'mac' });
const row = (key: string): HTMLElement => ui?.$(`[data-cg-fan="newcomers:${key}"]`) as HTMLElement;
const status = (key: string): HTMLElement => row(key).querySelector('.cg-nw__st') as HTMLElement;

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
  it('[NF-001] [NF-002] a modal window «Новые» over a scrim, as on Fansly: the serif title, the page, the persona Hi greets as, and «×»', async () => {
    ui = await mountBoardSettled('newcomers', '13a');
    const dialog = ui.$('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Новые');
    expect(ui.$('.cg-scrim')).not.toBeNull();
    expect(ui.text('.cg-nw__title')).toBe('Новые');
    expect(ui.text('.cg-nw__page')).toBe('LoraVie VIP');
    // Whose name Hi greets in: the quiet line under the toolbar says it, the head stays short.
    expect(ui.text('.cg-nw__summary span')).toBe('3 за 48 часов · Hi здоровается от имени Лора · VIP');
    expect(ui.host.hasAttribute('data-dismissible-open')).toBe(true);
    await flush(() => (ui?.$('.cg-nw__close') as HTMLElement).click());
    expect(ui.actions().at(-1)).toEqual({ type: 'Navigate', to: { kind: 'surface', surface: 'newcomers', open: false } });
  });

  it('[NF-006] tabs «Поздороваться / Все», status filters with counts, the search and the window', async () => {
    vi.useFakeTimers();
    ui = await mountBoardSettled('newcomers', '13a');
    expect(ui.$$('.cg-nw__tabs [role="tab"]').map(textOf)).toEqual(['Поздороваться 2', 'Все 3']);
    expect(ui.$('.cg-nw__tab.is-on')?.textContent).toBe('Поздороваться 2');
    await flush(() => (ui?.$$('.cg-nw__tabs [role="tab"]')[1] as HTMLElement).click());
    expect(ui.actions().at(-1)).toEqual({ type: 'SetNewcomersTab', tab: 'all' });
    // The status filter is one menu (as the old Fansly window's select), the counts inside it.
    expect(ui.$$('.cg-nw__side .cg-flt')).toHaveLength(0);
    const status = ui.$('.cg-nw__filter') as HTMLElement;
    expect(textOf(status)).toBe('Все статусы 3');
    await flush(() => status.click());
    const filters = ui.$$('.cg-nw__tools [role="menuitemradio"]');
    expect(filters.map(textOf)).toEqual(['Все статусы3', 'Не поздоровались0', 'Бронь2', 'Отправляются0', 'Остановлены0', 'Поздоровались1']);
    expect(filters[0]?.getAttribute('aria-checked')).toBe('true');
    await flush(() => (filters[2] as HTMLElement).click());
    expect(ui.actions().at(-1)).toEqual({ type: 'SetNewcomersFilter', filter: 'claimed' });

    const input = ui.$('.cg-nw__search input') as HTMLInputElement;
    await flush(() => keydown(ui?.root.activeElement as HTMLElement, '/', { code: 'Slash' }));
    expect(ui.root.activeElement).toBe(input);
    await flush(() => {
      input.value = 'tom';
      input.dispatchEvent(new InputEvent('input', { bubbles: true }));
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    expect(ui.actions().at(-1)).toEqual({ type: 'Search', list: 'newcomers', query: 'tom' });
  });

  it('the window of «Новые»: 24 / 48 / 72 hours and a week, read as «7 дней»', async () => {
    ui = await mountBoardSettled('newcomers', '13a');
    const trigger = ui.$('.cg-nw__bar .cg-nw__period') as HTMLElement;
    expect(trigger.querySelector('.cg-btn__t')?.textContent).toBe('48 часов');
    await flush(() => trigger.click());
    const items = ui.$$('.cg-nw__bar [role="menuitemradio"]');
    expect(items.map((item) => item.querySelector('.cg-menu__t')?.textContent)).toEqual(['24 часа', '48 часов', '72 часа', '7 дней']);
    expect(items.map((item) => item.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false', 'false']);
    await flush(() => (items[3] as HTMLElement).click());
    expect(ui.actions().at(-1)).toEqual({ type: 'SetNewcomersWindow', hours: 168 });
    const i18n = boardWorld('13a').deps.i18n;
    expect([1, 24, 168, 200, 720].map((hours) => periodText(i18n, hours))).toEqual(['1 час', '24 часа', '7 дней', '200 часов', '30 дней']);
  });

  it('[NF-007] a row, as on Fansly: the initial, the name over «@handle · who they are, when they subscribed», the greeting in words', async () => {
    ui = await mountBoardSettled('newcomers', '13a');
    const parts = (key: string): (string | null)[] => ['.cg-nw__ava', '.cg-nw__name', '.cg-nw__meta', '.cg-nw__st'].map((selector) => textOf(row(key).querySelector(selector)));
    expect(parts('n001')).toEqual(['T', 'Tomasz Wiśniewski', '@tomwis · новый, подписка 14 мин назад', 'бронь: вы']);
    expect(parts('n002')).toEqual(['J', 'Jake Morrison', '@jake.m.88 · продлил, подписка 2 ч назад', 'поздоровались']);
    // No remote picture on ChatSpace: the initial alone (ui-design §1 п. 12).
    expect(ui.$$('.cg-nw__row img')).toEqual([]);
    expect(ui.$('[role="listbox"]')?.getAttribute('aria-label')).toBe('Новые подписчики');
    expect(row('n001').classList.contains('is-sel')).toBe(true);
    expect(ui.root.activeElement).toBe(row('n001'));
  });

  it('[NF-005] every greeting status in words: terracotta where the person can greet now, as on Fansly; muted where it is done', async () => {
    const all: NewcomerRowVM['greeting'][] = [
      { s: 'none' },
      { s: 'claim-mine' },
      { s: 'claim-other' },
      { s: 'claim-elsewhere' },
      { s: 'sending', sent: 1, total: 3 },
      { s: 'stopped', sent: 1, total: 3, part: 2 },
      { s: 'greeted', at: iso(ctx.now - 60 * MIN) },
    ];
    expect(all.map((item) => item.s)).toEqual([...GREETING_STATUSES]);
    const fans = [FANS.hubert, FANS.theodore, FANS.marco, FANS.jake, FANS.tomasz, FANS.leo, { key: 'f2099', name: 'Seventh', username: 'seventh' }];
    const rows = all.map((greeting, index) => newcomerRow(ctx, fans[index] ?? FANS.leo, 'new', 10 + index, greeting));
    ui = await mountBoardSettled('newcomers', change('13a', (vm) => ({ ...vm, rows, cardOpen: false })));
    const cells = ui.$$('.cg-nw__st');
    expect(cells.map(textOf)).toEqual(['не поздоровались', 'бронь: вы', 'бронь: другой чаттерКоллега здоровается. Бронь снимется сама, если ничего не отправит.', 'бронь: вы, в другой вкладке', 'отправлено 1 из 3', 'отправлено 1 из 3, остановлено', 'поздоровались']);
    expect(cells.map((cell) => [...cell.classList].filter((name) => name.startsWith('is-')).join(' '))).toEqual(['is-act', 'is-act', 'is-2', 'is-2', 'is-busy', 'is-2', '']);
    expect(cells[4]?.querySelector('.cg-spin')).not.toBeNull();
    expect(cells[5]?.querySelector('.cg-dot--ink')).not.toBeNull();
    expect(cells[6]?.querySelector('.cg-ico')).not.toBeNull();
  });

  it('a colleague’s lease has no name and no countdown (ui-design §12 п. 5)', async () => {
    ui = await mountBoardSettled('newcomers', '13c');
    const lease = status('n003');
    expect(lease.firstChild?.textContent).toBe('бронь: другой чаттер');
    expect(textOf(row('n003'))).not.toMatch(/\d:\d\d/);
    expect(textOf(ui.$('.cg-nw'))).not.toMatch(/Анна|ещё \d/);
    // Nothing in the window ticks for it.
    expect(ui.$$('.cg-nw .cg-count')).toEqual([]);
  });

  it('[NF-012] a saved greeting draft is marked on its row; a stale one says so', async () => {
    ui = await mountBoardSettled(
      'newcomers',
      change('13a', (vm) => ({ ...vm, rows: vm.rows.map((item, index) => (index === 1 ? { ...item, hasDraft: true } : index === 2 ? { ...item, hasDraft: true, draftStale: true } : item)) })),
    );
    expect(textOf(row('n002').querySelector('.cg-nw__tag'))).toBe('черновик');
    expect(textOf(row('n003').querySelector('.cg-nw__tag'))).toBe('черновик устарел');
    expect(row('n001').querySelector('.cg-nw__tag')).toBeNull();
  });

  it('[NF-012] the card has the greeting draft field — Fix or not — and typing saves the draft and does nothing else', async () => {
    for (const state of ['13a', '13c']) {
      // 13c: a colleague holds the fan and Hi is off; the draft is still the person's own.
      ui = await mountBoardSettled('newcomers', state);
      const handle = state === '13c' ? 'newcomers:n003' : 'newcomers:n001';
      // The strip has only Hi: the field does not hang on a Fix button.
      expect(ui.$$('.cg-pvb .cg-act').map((button) => button.querySelector('.cg-act__t')?.textContent)).toEqual(['Hi', 'Casual', 'Flirt', 'Sell', 'Spice', 'Split']);
      const field = ui.$('.cg-pv__draft textarea') as HTMLTextAreaElement;
      expect(field.getAttribute('aria-label'), state).toBe('Черновик приветствия');
      expect(field.getAttribute('placeholder'), state).toBe('Черновик приветствия. Остаётся здесь, в чат не уходит');
      expect(field.maxLength).toBe(5000);
      expect(field.value).toBe('');
      // Above the strip, as in the preview.
      expect(field.compareDocumentPosition(ui.$('.cg-pvb') as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const before = ui.actions().length;
      await flush(() => {
        field.value = 'hey Tomasz, welcome';
        field.dispatchEvent(new InputEvent('input', { bubbles: true }));
      });
      // Enter in the draft is a new line: it starts no Hi and sends nothing.
      await flush(() => keydown(field, 'Enter'));
      expect(ui.actions().slice(before), state).toEqual([{ type: 'SetPreviewDraft', targetHandle: handle, text: 'hey Tomasz, welcome' }]);
      ui.unmount();
      ui = null;
    }
  });

  it('[NF-012] a saved greeting draft comes back into the field; in English the field is the greeting’s too', async () => {
    ui = await mountBoardSettled('newcomers', change('13a', (vm) => vm, (vm) => ({ ...vm, draft: { ...vm.draft, text: 'hi there, glad you came' } })));
    expect((ui.$('.cg-pv__draft textarea') as HTMLTextAreaElement).value).toBe('hi there, glad you came');
    ui.unmount();
    ui = await mountBoardSettled('newcomers', '13a', { language: 'en' });
    const field = ui.$('.cg-pv__draft textarea') as HTMLTextAreaElement;
    expect(field.getAttribute('aria-label')).toBe('Greeting draft');
    expect(field.getAttribute('placeholder')).toBe('Greeting draft. Stays here, not in the chat');
  });

  it('[NF-008] the scan shows its phase and progress in the toolbar', async () => {
    ui = await mountBoardSettled('newcomers', change('13a', (vm) => ({ ...vm, scan: { stage: msg('common.loading'), done: 12, total: 40 } })));
    expect(textOf(ui.$('.cg-nw__bar .cg-nw__stage'))).toBe('Загрузка…12 из 40');
    expect(ui.$('.cg-nw__stage')?.getAttribute('role')).toBe('status');
  });

  it('[NF-025] «Результат неполный» is said with why, above the rows that are there', async () => {
    ui = await mountBoardSettled('newcomers', change('13a', (vm) => ({ ...vm, view: views.partial({ kind: 'coverage', level: 'partial' }), incomplete: msg('common.coverage.partial'), footer: { ...vm.footer, stamp: { asOf: vm.footer.stamp.asOf, coverage: 'partial' } } })));
    const line = ui.$('.cg-nw__incomplete') as HTMLElement;
    expect([...line.children].map(textOf)).toEqual(['Результат неполный', 'охват неполный']);
    expect(ui.$$('.cg-nw__side .cg-vlist__inner [data-cg-fan]')).toHaveLength(3);
    expect(ui.text('.cg-nw__summary span')).toBe('3 за 48 часов · Hi здоровается от имени Лора · VIP');
  });

  it('[NF-025] with the reason the controller sends, the title is said once', async () => {
    // The controller (core/application/newcomers) puts `newcomers.incomplete.body` into the model; the title is the window's own.
    ui = await mountBoardSettled('newcomers', change('13a', (vm) => ({ ...vm, view: views.partial({ kind: 'coverage', level: 'partial' }), incomplete: msg('newcomers.incomplete.body') })));
    const line = ui.$('.cg-nw__incomplete') as HTMLElement;
    expect([...line.children].map(textOf)).toEqual(['Результат неполный', 'Показана часть списка. Хаб ещё не собрал всех, кто подписался за это время.']);
  });

  it('[NF-028] «AI ничего не отправляет сам» stands at the Hi button, not as a paragraph under the list', async () => {
    ui = await mountBoardSettled('newcomers', '13a');
    expect(ui.$$('.cg-nw__hint')).toHaveLength(0);
    const hi = ui.$('.cg-pvb [data-cg-strip="hi"] .cg-act') as HTMLElement;
    expect(ui.root.getElementById(hi.getAttribute('aria-describedby') ?? '')?.textContent).toBe('AI ничего не отправляет сам: только по вашему нажатию.');
    expect(ui.$$('.cg-nw__summary span').map(textOf)).toEqual(['3 за 48 часов · Hi здоровается от имени Лора · VIP', 'данные на 09:18']);
  });

  it('[NF-004] the list while it loads, when it failed, and when nobody is in the window', async () => {
    ui = await mountBoardSettled('newcomers', 'gallery-loading');
    expect(ui.$('.cg-nw__side [role="status"][aria-busy="true"]')).not.toBeNull();
    ui.unmount();
    ui = await mountBoardSettled('newcomers', 'gallery-error');
    expect(ui.$('.cg-nw__side .cg-card')?.getAttribute('data-cg-code')).toBe('CG-DATA-UNAVAILABLE');
    expect(ui.$('.cg-nw__side .cg-vlist')).toBeNull();
    ui.unmount();
    ui = await mountBoardSettled('newcomers', 'gallery-empty');
    expect(ui.$('.cg-nw__side .cg-state--empty')).not.toBeNull();
  });

  it('keys: ↑ ↓ and J / K move, Enter or Space opens the card, Esc closes the card and then the window', async () => {
    ui = await mountBoardSettled('newcomers', '13a');
    const press = async (code: string, key = code): Promise<void> => flush(() => keydown(ui?.root.activeElement as HTMLElement, key, { code }));
    await press('KeyJ', 'о');
    expect(ui.root.activeElement).toBe(row('n002'));
    await press('ArrowDown');
    await press('ArrowDown');
    expect(ui.root.activeElement).toBe(row('n003'));
    await press('Enter');
    expect(ui.actions().at(-1)).toEqual({ type: 'OpenPreview', targetHandle: 'newcomers:n003' });
    await press('KeyK', 'л');
    await press('Space', ' ');
    expect(ui.actions().at(-1)).toEqual({ type: 'OpenPreview', targetHandle: 'newcomers:n002' });
    await flush(() => keydown(ui?.$('[role="dialog"]') as HTMLElement, 'Escape'));
    expect(ui.actions().at(-1)).toEqual({ type: 'Navigate', to: { kind: 'surface', surface: 'preview', open: false } });
    ui.unmount();
    ui = await mountBoardSettled('newcomers', change('13a', (vm) => ({ ...vm, cardOpen: false })));
    await flush(() => keydown(ui?.$('[role="dialog"]') as HTMLElement, 'Escape'));
    expect(ui.actions().at(-1)).toEqual({ type: 'Navigate', to: { kind: 'surface', surface: 'newcomers', open: false } });
  });

  it('[NF-002] [X55] with no card open the window opens on the first fan who can be greeted now — and on that fan’s card', async () => {
    // Greeted and a colleague's lease first: the keyboard and the card start at the free fan below them.
    ui = await mountBoardSettled(
      'newcomers',
      change('13a', (vm) => {
        const [tomasz, jake, leo] = vm.rows;
        return { ...vm, cardOpen: false, rows: [jake, leo, { ...tomasz, greeting: { s: 'none' } }].map((one) => ({ ...(one as NewcomerRowVM), selected: false })) };
      }),
    );
    await settle();
    expect(ui.actionsOf('OpenPreview')).toEqual([{ type: 'OpenPreview', targetHandle: 'newcomers:n001' }]);
    expect(ui.root.activeElement).toBe(row('n001'));
    ui.unmount();
    // Nobody to greet: the first row, and its card.
    ui = await mountBoardSettled(
      'newcomers',
      change('13a', (vm) => ({ ...vm, cardOpen: false, rows: vm.rows.slice(1).map((one) => ({ ...one, selected: false })) })),
    );
    await settle();
    expect(ui.actionsOf('OpenPreview')).toEqual([{ type: 'OpenPreview', targetHandle: 'newcomers:n002' }]);
    ui.unmount();
    // A card already open stays: nothing is opened over it.
    ui = await mountBoardSettled('newcomers', '13a');
    await settle();
    expect(ui.actionsOf('OpenPreview')).toEqual([]);
    expect(ui.root.activeElement).toBe(row('n001'));
  });

  it('[X55] J / K walk the rows and the open card follows once the keys stop: one card for a run of keys', async () => {
    vi.useFakeTimers();
    ui = await mountBoardSettled('newcomers', '13a');
    const press = async (code: string, key = code): Promise<void> => flush(() => keydown(ui?.root.activeElement as HTMLElement, key, { code }));
    await press('KeyJ', 'о');
    await press('ArrowDown');
    expect(ui.root.activeElement).toBe(row('n003'));
    await flush(() => vi.advanceTimersByTime(CARD_FOLLOW_MS - 1));
    expect(ui.actionsOf('OpenPreview')).toEqual([]);
    await flush(() => vi.advanceTimersByTime(1));
    expect(ui.actionsOf('OpenPreview')).toEqual([{ type: 'OpenPreview', targetHandle: 'newcomers:n003' }]);
    // Enter before the wait is over opens the row's card at once, and the wait is dropped.
    await press('KeyK', 'л');
    await press('Enter');
    await flush(() => vi.advanceTimersByTime(CARD_FOLLOW_MS * 2));
    expect(ui.actionsOf('OpenPreview')).toEqual([
      { type: 'OpenPreview', targetHandle: 'newcomers:n003' },
      { type: 'OpenPreview', targetHandle: 'newcomers:n002' },
    ]);
    ui.unmount();
    // With the card closed (Esc), J / K only move: no card opens by itself.
    ui = await mountBoardSettled('newcomers', change('13a', (vm) => ({ ...vm, cardOpen: false })));
    const before = ui.actionsOf('OpenPreview').length;
    await press('KeyJ', 'о');
    await flush(() => vi.advanceTimersByTime(CARD_FOLLOW_MS * 2));
    expect(ui.actionsOf('OpenPreview').length).toBe(before);
  });

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

  it('[X55] no line of keys under the list, as on Fansly: the keys are in the cheatsheet', async () => {
    ui = await mountBoardSettled('newcomers', '13a');
    expect(ui.$$('.cg-nw .cg-keys')).toHaveLength(0);
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

  it('[NF-006] a long list is virtual and asks for the next page of 100 near its end', async () => {
    const many = Array.from({ length: 300 }, (_, index) => newcomerRow(ctx, { key: `f${3000 + index}`, name: `Fan ${index}`, username: `fan_${index}` }, 'new', index + 1, { s: 'none' }));
    ui = await mountBoardSettled('newcomers', change('13a', (vm) => ({ ...vm, rows: many, cardOpen: false, canLoadMore: true })));
    expect(ui.$$('.cg-vlist__row').length).toBeLessThanOrEqual(MAX_DOM_ROWS);
    expect(ui.actionsOf('LoadMore')).toEqual([]);
    await flush(() => keydown(ui?.root.activeElement as HTMLElement, 'End', { code: 'End' }));
    await flush();
    expect(ui.actionsOf('LoadMore')).toEqual([{ type: 'LoadMore', list: 'newcomers' }]);
  });
});

describe('«Новые»: the card', () => {
  it('[NF-009] [NF-010] the card is the preview pane: who, «новый, подписка 14 мин назад», the archive, an empty feed in words', async () => {
    ui = await mountBoardSettled('newcomers', '13a');
    const card = ui.$('.cg-pv') as HTMLElement;
    expect(card.getAttribute('aria-label')).toBe('Карточка нового фана');
    expect(textOf(ui.$('.cg-pv__name'))).toBe('Tomasz Wiśniewski@tomwis');
    expect(ui.text('.cg-pv__meta')).toBe('новый, подписка 14 мин назад');
    expect(ui.$('.cg-pv__money')).toBeNull();
    expect(ui.$('.cg-pv__note span')?.firstChild?.textContent).toBe('Чат не открыт, останется непрочитанным');
    expect(ui.text('.cg-pv__asof')).toBe('Архив на 09:18');
    expect(ui.text('.cg-feed__empty')).toBe('Сообщений пока нет. Tomasz подписался 14 мин назад.');
    // The card has no × of its own and no Fix: only Hi, Tone and Split — and the greeting draft above them (NF-012).
    expect(ui.$$('.cg-pv__head .cg-btn').map(textOf)).toEqual(['Открыть чат']);
    expect(ui.$$('.cg-pv__draft textarea')).toHaveLength(1);
    expect(ui.$$('.cg-pvb .cg-act').map((button) => button.querySelector('.cg-act__t')?.textContent)).toEqual(['Hi', 'Casual', 'Flirt', 'Sell', 'Spice', 'Split']);
  });

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

  it('the partial progress «отправлено 1 из 3»: in the list with a spinner, in the card with part 2 in ChatSpace’s queue', async () => {
    ui = await mountBoardSettled('newcomers', '13b');
    expect(status('n001').querySelector('.cg-spin')).not.toBeNull();
    expect(textOf(status('n001'))).toBe('отправлено 1 из 3');
    expect(textOf(ui.$('.cg-pvr__progress'))).toBe('отправлено 1 из 3');
    expect(ui.$('.cg-pvr__progress b')?.textContent).toBe('1 из 3');
    expect(ui.$$('.cg-pvp').map((part) => part.getAttribute('data-cg-send-state'))).toEqual(['sent', 'queued', 'available']);
    expect(textOf(ui.$$('.cg-pvp')[1]?.querySelector('.cg-pvs__st'))).toBe('В очереди ChatSpace');
    expect(textOf(ui.$$('.cg-pvp')[2]?.querySelector('.cg-pvs__st'))).toBe('Отправка после части 2');
    expect(ui.$$('.cg-pvs__send')).toEqual([]);
    expect(ui.$('.cg-pv__note')?.getAttribute('data-cg-unread')).toBe('read-after-send');
  });

  it('[NF-024] a colleague holds the fan: Hi is off with the reason, and the card says so without a name or a countdown', async () => {
    ui = await mountBoardSettled('newcomers', '13c');
    const hi = ui.$('.cg-pvb [data-cg-strip="hi"] .cg-act') as HTMLElement;
    expect(hi.getAttribute('aria-disabled')).toBe('true');
    expect(ui.root.getElementById(hi.getAttribute('aria-describedby') ?? '')?.textContent).toMatch(/^Hi недоступен: /);
    const card = ui.$('.cg-pv [data-cg-claim="other"] .cg-card') as HTMLElement;
    expect(card.getAttribute('data-cg-code')).toBe('CG-CLAIM-BUSY');
    expect(textOf(card.querySelector('.cg-card__code'))).toBe('ChatGoose · CG-CLAIM-BUSY');
    expect(textOf(card)).not.toMatch(/\d:\d\d|Анна/);
    // The card stands under the strip, where the result would be.
    expect((ui.$('.cg-pvb') as HTMLElement).compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await flush(() => hi.click());
    expect(ui.actionsOf('Generate')).toEqual([]);
    expect(textOf(ui.$('.cg-feed__msg'))).toMatch(/^Мы: welcome back, Léo/);
  });

  it('stopped on an unknown outcome: the list says «остановлено», the card holds the rest and explains who lifts it', async () => {
    ui = await mountBoardSettled('newcomers', '13d');
    expect(textOf(status('n001'))).toBe('отправлено 1 из 3, остановлено');
    expect(status('n001').querySelector('.cg-dot--ink')).not.toBeNull();
    expect(ui.$$('.cg-pvp').map((part) => part.getAttribute('data-cg-send-state'))).toEqual(['sent', 'uncertain', 'available']);
    expect(textOf(ui.$$('.cg-pvp')[2]?.querySelector('.cg-pvs__st'))).toBe('Удержано, пока неясен исход части 2');
    expect(ui.text('.cg-pvr__note')).toBe('Дальше не отправляем, пока неясно, ушла ли часть 2. Удержание снимет тимлид или владелец после проверки.');
    expect(ui.$$('.cg-pv .cg-btn--send')).toEqual([]);
    expect(ui.$$('.cg-pvp button').map((button) => button.getAttribute('aria-label') ?? textOf(button))).toEqual(['Копировать часть 1', 'Открыть чат для проверки', 'Копировать часть 3']);
  });

  it('[NF-022] held on an unknown outcome with no result on screen: the card says who lifts the hold and never advises to insert by hand', async () => {
    // The result is gone (its texts expired, another tab): the hold is all the card can say.
    ui = await mountBoardSettled('newcomers', change('13d', (vm) => vm, (vm) => ({ ...vm, result: null, stoppedNote: null })));
    const card = ui.$('.cg-pv [data-cg-claim="held-uncertain"] .cg-card') as HTMLElement;
    expect(card.getAttribute('data-cg-code')).toBe('CG-SEND-UNCERTAIN');
    expect(textOf(card.querySelector('.cg-card__code'))).toBe('ChatGoose · CG-SEND-UNCERTAIN');
    expect(textOf(card.querySelector('.cg-card__title'))).toBe('Неизвестно, ушло ли');
    expect(textOf(card.querySelector('.cg-card__text'))).toBe('Дальше не отправляем, пока неясно, ушла ли часть 2. Удержание снимет тимлид или владелец после проверки.');
    // Nothing to press in it: no retry, no insert, no copy.
    expect(card.querySelectorAll('button')).toHaveLength(0);
    ui.unmount();
    // The model's own note, when it sends one, is what the card says.
    ui = await mountBoardSettled('newcomers', change('13d', (vm) => vm, (vm) => ({ ...vm, result: null, stoppedNote: msg('newcomers.stopped', { n: 3 }) })));
    expect(ui.text('.cg-pv [data-cg-claim="held-uncertain"] .cg-card__text')).toMatch(/ушла ли часть 3\./);
  });

  it('[NF-022] no preview and no card ever advises to insert an uncertain part by hand (ui-design §4.13, §9.5 п. 5)', async () => {
    // «если сообщения нет, вставьте часть вручную» — the «not in the archive, so it did not go» rule the architecture forbids (§6.7.8).
    const advice = /если сообщения нет|вставьте часть вручную|if the message is not there|insert the part by hand/i;
    const cases: (readonly [string, 'spenders' | 'newcomers', AppClientScenario | string])[] = [];
    for (const state of BOARD_STATES) {
      if (state.surface !== 'spenders' && state.surface !== 'newcomers') continue;
      if (!/^1[13][a-j]$/.test(state.id)) continue;
      cases.push([state.id, state.surface, state.id]);
    }
    cases.push(['13d without the result', 'newcomers', change('13d', (vm) => vm, (vm) => ({ ...vm, result: null }))]);
    expect(cases.length).toBeGreaterThan(12);
    for (const language of ['ru', 'en'] as const) {
      for (const [name, surface, scenario] of cases) {
        // Texts are per language: a scenario object is built for `ru`, a state id for the language asked.
        if (typeof scenario !== 'string' && language === 'en') continue;
        ui = await mountBoardSettled(surface, scenario, { language });
        const pane = ui.$('.cg-pv');
        // «Отправка недоступна… Вставьте часть в чат вручную» of an unavailable send is another advice and stays (§4.13).
        const text = textOf(pane).replace(/Вставьте часть в чат вручную|Insert the part into the chat by hand/gi, '');
        expect(text, `${name} · ${language}`).not.toMatch(advice);
        ui.unmount();
        ui = null;
      }
    }
    // Both languages mount the whole preview/card gallery; allow loaded CI headroom for the aggregate.
  }, 20_000);

  it('the own lease counts down and can be renewed or let go; the other lease states say what happened', async () => {
    ui = await mountBoardSettled('newcomers', change('13a', (vm) => vm, (vm) => ({ ...vm, claim: claimMine(ctx, FANS.tomasz) })));
    const lease = ui.$('.cg-pv__lease') as HTMLElement;
    expect(lease.querySelector('span')?.textContent).toBe('Бронь за вами, ещё 1:50');
    expect([...lease.querySelectorAll('.cg-btn')].map(textOf)).toEqual(['Продлить бронь', 'Снять бронь']);
    await flush(() => (lease.querySelectorAll('.cg-btn')[0] as HTMLElement).click());
    expect(ui.actions().at(-1)?.type).toBe('RenewClaim');
    ui.unmount();

    ui = await mountBoardSettled('newcomers', change('13a', (vm) => vm, (vm) => ({ ...vm, result: null, claim: { s: 'expired', error: cgError(ctx, 'CG-CLAIM-EXPIRED') } })));
    expect(ui.$('.cg-pv [data-cg-claim="expired"] .cg-card')?.getAttribute('data-cg-code')).toBe('CG-CLAIM-EXPIRED');
    ui.unmount();

    ui = await mountBoardSettled('newcomers', change('13a', (vm) => vm, (vm) => ({ ...vm, result: null, claim: { s: 'elsewhere', note: msg('newcomers.claim.elsewhere') } })));
    expect(ui.text('.cg-pv__claimnote')).toMatch(/^Вы уже здороваетесь с этим фаном в другой вкладке/);
  });
});
