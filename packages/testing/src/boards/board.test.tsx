// The Spenders board and its statistics over FakeAppClient states (R15;
// ui-design §3.5, §4.14, §4.15, §6): what is drawn, what a click and a key
// dispatch, and what never appears (a colour on a fan, an empty list in place
// of an error). Texts are the shipped catalog's.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { MAX_DOM_ROWS, SEARCH_DEBOUNCE_MS } from '@cg/ui/kit';
import { createI18n } from '@cg/core/domain/i18n';
import { BOARD_HEIGHTS, boardItems, formatPct, initialStop, nextStop, shelfLabel, statsDayName, statsShelfLabel, zoneLabel } from '@cg/ui/spenders';

import { board, button, cgError, ctxOf, entry, stats, views } from '../scenarios/app-client';
import { BOARD_FANS, HUBERT, boardHandle, boardShelves, manyFans, type BoardFan } from './data';
import { flush, keydown, mountBoardSettled, settle, textOf, type MountedBoard } from './harness';
import { LiveBoardClient } from './live-client';
import { boardOf, boardScenario } from './states';
import { boardWorld } from './world';

let ui: MountedBoard | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
  vi.useRealTimers();
});

const ctx = ctxOf({ lang: 'ru', platform: 'mac' });
const row = (handle: string): HTMLElement => ui?.$(`[data-cg-fan="spenders:${handle}"]`) as HTMLElement;
const cells = (element: HTMLElement): string[] => [...element.querySelectorAll('[role="cell"]')].map((cell) => textOf(cell));

/** A scenario of the board alone, built from one view model. */
function boardOnly(vm: ReturnType<typeof boardOf>, statsVm = stats(ctx, views.ready())) {
  return { ...boardScenario('board-list'), views: [entry({ of: 'spenders.board' }, vm), entry({ of: 'spenders.stats' }, statsVm)] };
}

describe('Spenders window', () => {
  it('[SP-002] [X67] is a modal window over a scrim named Spenders: the page, its fans and the data time under the title; the search', async () => {
    ui = await mountBoardSettled('spenders', 'board-list');
    const dialog = ui.$('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Spenders');
    expect(dialog.classList.contains('cg-dialog--wide')).toBe(true);
    expect(ui.$('.cg-scrim')).not.toBeNull();
    expect(ui.text('.cg-sp__title')).toBe('Spenders');
    expect(ui.$$('.cg-sp__sub > span').map(textOf)).toEqual(['LoraVie VIP', '40 фанов', 'данные на 09:18']);
    // No tabs and no period menu: the old window's chips and the search.
    expect(ui.$$('.cg-sp__top [role="tab"]')).toHaveLength(0);
    expect(ui.$('.cg-bd__period')).toBeNull();
    expect(ui.$('.cg-sp__search input')?.getAttribute('placeholder')).toBe('Имя или @handle');
    // While it is open ChatSpace's Esc leaves its tab alone (§6.3).
    expect(ui.host.hasAttribute('data-dismissible-open')).toBe(true);
    expect(ui.failures).toEqual([]);
  });
  it('[SP-002] opens with focus on the first fan row, and on the selected one when a preview is open', async () => {
    ui = await mountBoardSettled('spenders', 'board-list');
    expect(ui.root.activeElement).toBe(row('b001'));
    ui.unmount();
    ui = await mountBoardSettled('spenders', '11a');
    expect(ui.root.activeElement).toBe(row('b002'));
    expect(row('b002').classList.contains('is-sel')).toBe(true);
    expect(row('b002').getAttribute('aria-current')).toBe('true');
  });

  it('[SP-033] Esc goes in turn: the search, the preview, the window', async () => {
    ui = await mountBoardSettled('spenders', boardOnly(boardOf(ctx, BOARD_FANS, { query: 'hub', selected: 'b002' })));
    const dialog = ui.$('[role="dialog"]') as HTMLElement;
    await flush(() => keydown(dialog, 'Escape'));
    expect(ui.actions().at(-1)).toEqual({ type: 'Search', list: 'spenders', query: '' });
    ui.unmount();

    ui = await mountBoardSettled('spenders', '11a');
    await flush(() => keydown(ui?.$('[role="dialog"]') as HTMLElement, 'Escape'));
    expect(ui.actions().at(-1)).toEqual({ type: 'Navigate', to: { kind: 'surface', surface: 'preview', open: false } });
    ui.unmount();

    ui = await mountBoardSettled('spenders', 'board-list');
    await flush(() => keydown(ui?.$('[role="dialog"]') as HTMLElement, 'Escape'));
    expect(ui.actions().at(-1)).toEqual({ type: 'Navigate', to: { kind: 'surface', surface: 'spenders', open: false } });
  });

  it('«Закрыть» of the header («Закрыть  Esc» in its tooltip) closes the window', async () => {
    ui = await mountBoardSettled('spenders', 'board-list');
    const close = ui.$('.cg-sp__close') as HTMLElement;
    expect(textOf(close)).toBe('Закрыть');
    expect(ui.root.getElementById(close.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Закрыть  Esc');
    await flush(() => close.click());
    expect(ui.actions().at(-1)).toEqual({ type: 'Navigate', to: { kind: 'surface', surface: 'spenders', open: false } });
  });
  it('[SP-042] [X66] the list and its statistics column; the picked fan\'s preview unfolds right under their row', async () => {
    ui = await mountBoardSettled('spenders', '11a');
    const parts = (selector: string): string[] => [...(ui?.$(selector) as HTMLElement).children].map((child) => child.className.split(' ')[0] ?? '');
    expect(parts('.cg-sp__cols')).toEqual(['cg-bd', 'cg-st']);
    // No panel under the list and no border to drag: the preview is a row of the list.
    expect(parts('.cg-sp__body')).toEqual(['cg-sp__cols']);
    const unfolded = ui.$('.cg-vlist__inner .cg-bd__unfold') as HTMLElement;
    expect(unfolded.querySelector('.cg-pv.is-panel')).not.toBeNull();
    // It stands right after Hubert's row, which says it is expanded.
    const hubert = ui.$('.cg-vlist__inner [aria-expanded="true"]') as HTMLElement;
    expect(hubert.getAttribute('data-cg-fan')).toBe(boardHandle(HUBERT.key));
    expect(hubert.closest('.cg-vlist__row')?.nextElementSibling?.contains(unfolded)).toBe(true);
    expect(unfolded.getAttribute('data-cg-unfolded')).toBe(boardHandle(HUBERT.key));
    ui.unmount();
    ui = await mountBoardSettled('spenders', 'board-list');
    expect(parts('.cg-sp__body')).toEqual(['cg-sp__cols']);
    expect(parts('.cg-sp__cols')).toEqual(['cg-bd', 'cg-st']);
    expect(ui.$('.cg-bd__unfold')).toBeNull();
  });

  it('[X66] a picked fan the list does not show (a search hides them) keeps the preview as a panel under the list', async () => {
    const world = boardScenario('11a');
    const hidden = world.views.map((view) => {
      if (view.selector.of !== 'spenders.board') return view;
      const vm = view.vm as ReturnType<typeof boardOf>;
      return entry({ of: 'spenders.board' }, { ...vm, shelves: vm.shelves.map((shelf) => ({ ...shelf, rows: shelf.rows.filter((row) => !row.selected) })) });
    });
    ui = await mountBoardSettled('spenders', { ...world, views: hidden });
    const parts = (selector: string): string[] => [...(ui?.$(selector) as HTMLElement).children].map((child) => child.className.split(' ')[0] ?? '');
    expect(parts('.cg-sp__body')).toEqual(['cg-sp__cols', 'cg-sp__split', 'cg-sp__panel']);
    expect(ui.$('.cg-sp__panel > .cg-pv.is-panel')).not.toBeNull();
    expect(ui.$('.cg-bd__unfold')).toBeNull();
    const border = ui.$('.cg-sp__split') as HTMLElement;
    expect([border.getAttribute('role'), border.getAttribute('aria-orientation'), border.getAttribute('aria-label')]).toEqual(['separator', 'horizontal', 'Высота превью']);
  });
});

describe('Spenders board: shelves and rows', () => {
  it('[SP-009] [X67] the old window\'s chips: «Все» and the tiers with their counts; a tier chip asks for its shelf; the other filters wait in «Фильтр»', async () => {
    const vm = boardOf(ctx, BOARD_FANS);
    ui = await mountBoardSettled('spenders', 'board-list');
    const chips = ui.$$('.cg-sp__top .cg-sp__filters .cg-flt');
    expect(chips.map(textOf)).toEqual(['Все40', '🐳 Whale8', '⭐ Top6', '✅ Prime7', '③ Base7', '② Low6', '① Micro6']);
    expect(chips.map((chip) => chip.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false', 'false', 'false', 'false']);
    expect(ui.$('.cg-sp__tiers')?.getAttribute('aria-label')).toBe('Тиры');
    await flush(() => (chips[1] as HTMLElement).click());
    expect(ui.actions().at(-1)).toEqual({ type: 'SetSpendersShelf', shelfId: vm.tiers?.[0]?.id });
    const menu = ui.$('.cg-sp__filters .cg-choice') as HTMLElement;
    expect(textOf(menu)).toBe('Фильтр');
    await flush(() => menu.click());
    expect(ui.$$('[role="menuitemradio"] .cg-menu__t').map(textOf)).toEqual(['Ждут ответа', 'Новые']);
    await flush(() => (ui?.$$('[role="menuitemradio"]')[0] as HTMLElement).click());
    expect(ui.actions().at(-1)).toEqual({ type: 'SetSpendersFilter', filter: 'waiting' });
  });

  it('[X67] a pressed tier chip asks for every tier again; «Все» is not pressed meanwhile', async () => {
    const vm = boardOf(ctx, BOARD_FANS);
    const tiers = (vm.tiers ?? []).map((tier, index) => ({ ...tier, pressed: index === 1 }));
    const filters = vm.filters.map((filter) => (filter.id === 'all' ? { ...filter, pressed: false } : filter));
    ui = await mountBoardSettled('spenders', boardOnly({ ...vm, tiers, filters }));
    const chips = ui.$$('.cg-sp__filters .cg-flt');
    expect(chips.map((chip) => chip.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true', 'false', 'false', 'false', 'false']);
    await flush(() => (chips[2] as HTMLElement).click());
    expect(ui.actions().at(-1)).toEqual({ type: 'SetSpendersShelf', shelfId: null });
  });
  it('[SP-020] «Фильтр» holds the rest of the filters; «Фан писал», the same as «Ждут ответа», is not repeated', async () => {
    ui = await mountBoardSettled('spenders', boardOnly({ ...boardOf(ctx, BOARD_FANS), filters: board(ctx, views.ready()).filters }));
    expect(ui.$$('.cg-sp__filters')).toHaveLength(1);
    const more = ui.$$('.cg-sp__filters .cg-choice')[0] as HTMLElement;
    expect(textOf(more)).toBe('Фильтр');
    await flush(() => more.click());
    expect(ui.$$('[role="menuitemradio"] .cg-menu__t').map(textOf)).toEqual(['Ждут ответа', 'Новые', 'Мы писали', 'С перепиской', 'Без переписки']);
    await flush(() => (ui?.$$('[role="menuitemradio"]')[2] as HTMLElement).click());
    expect(ui.actions().at(-1)).toEqual({ type: 'SetSpendersFilter', filter: 'we-wrote' });
  });
  it('[SP-011] [X67] a shelf\'s header, as the old extension\'s: the tier\'s mark and name, its bounds, its fans; no sums', async () => {
    ui = await mountBoardSettled('spenders', 'board-list');
    const shelves = ui.$$('.cg-vlist__inner [role="rowgroup"]');
    expect(shelves[0]?.getAttribute('aria-label')).toBe('Whale $600+');
    expect(textOf(shelves[0])).toBe('🐳 Whale$600+8');
    expect(shelves[1]?.getAttribute('aria-label')).toBe('Top $350–600');
    expect(shelves[0]?.querySelectorAll('[role="cell"], .cg-money')).toHaveLength(0);
  });
  it('[SP-008] shelf labels: an open top, a range, «вне полок»; an empty shelf is not drawn', () => {
    const i18n = boardWorld('board-list').deps.i18n;
    expect(shelfLabel(i18n, { fromMills: 600_000, toMills: null })).toBe('$600+');
    expect(shelfLabel(i18n, { fromMills: 350_000, toMills: 600_000 })).toBe('$350–600');
    expect(shelfLabel(i18n, { fromMills: 1_000_000, toMills: 2_500_000 })).toBe('$1,000–2,500');
    expect(shelfLabel(i18n, { fromMills: null, toMills: 1_000 })).toBe('$0–1');
    expect(shelfLabel(i18n, { fromMills: null, toMills: null })).toBe('вне полок');
    const shelves = boardShelves(ctx, BOARD_FANS.slice(0, 8), null);
    expect(shelves).toHaveLength(6);
    expect(boardItems(shelves).filter((item) => item.kind === 'shelf')).toHaveLength(1);
  });

  it('[SP-010] [X66] nothing is left behind «ещё N · показать»: a shelf lists the rows it has', async () => {
    const vm = boardOf(ctx, BOARD_FANS);
    const cut = vm.shelves.map((shelf, index) => (index === 1 ? { ...shelf, rows: shelf.rows.slice(0, 2), collapsed: { hidden: 4, reveal: button('spenders.shelfMore', { type: 'RevealShelf', shelfId: shelf.id }) } } : shelf));
    ui = await mountBoardSettled('spenders', boardOnly({ ...vm, shelves: cut }));
    expect(ui.$('.cg-bd__morebtn')).toBeNull();
    expect(ui.$$('[data-cg-fan]').length).toBeGreaterThan(0);
  });
  it('[SP-012] [SP-013] [X67] a fan row, as the old extension\'s: the initials, the name over the @handle, the lifetime over «+$N»', async () => {
    ui = await mountBoardSettled('spenders', 'board-list');
    const hubert = row('b002');
    expect(hubert.getAttribute('role')).toBe('row');
    expect(textOf(hubert.querySelector('.cg-bd__ava'))).toBe('H');
    expect(textOf(hubert.querySelector('.cg-bd__name'))).toBe('Hubert');
    expect(textOf(hubert.querySelector('.cg-bd__handle'))).toBe('@hubert_pl');
    expect(textOf(hubert.querySelector('.cg-bd__life'))).toBe('$12,480');
    expect(textOf(hubert.querySelector('.cg-bd__per .cg-money'))).toBe('+$320');
    const per = hubert.querySelector('.cg-bd__per') as HTMLElement;
    expect(ui.root.getElementById(per.getAttribute('aria-describedby') ?? '')?.textContent).toBe('30 дней');
    expect(hubert.querySelector('.cg-bd__sums')?.getAttribute('aria-label')).toBeTruthy();
    expect(textOf(row('b001').querySelector('.cg-bd__ava'))).toBe('TW');
    // A known zero has no «+»; money is whole dollars with a comma.
    expect(textOf(row('b003').querySelector('.cg-bd__life'))).toBe('$8,930');
    expect(row('b003').querySelector('.cg-bd__per')).toBeNull();
    // No last message and no column of ages in the row: the preview has them.
    expect(hubert.querySelector('.cg-bd__last, .cg-bd__age')).toBeNull();
  });
  it('[SP-013] an unknown amount is «—», never 0; an unknown period sum is not printed', async () => {
    const vm = boardOf(ctx, BOARD_FANS);
    const unknown = vm.shelves.map((shelf, index) => (index === 0 ? { ...shelf, rows: shelf.rows.map((item, n) => (n === 0 ? { ...item, lifetime: null, period: null } : item)) } : shelf));
    ui = await mountBoardSettled('spenders', boardOnly({ ...vm, shelves: unknown }));
    expect(textOf(row('b001').querySelector('.cg-bd__life'))).toBe('—');
    expect(row('b001').querySelector('.cg-bd__per')).toBeNull();
  });
  it('[SP-013] [X67] the money of a row is green, as in the old extension: the lifetime and «+$N» of the period', async () => {
    ui = await mountBoardSettled('spenders', 'board-list');
    expect(row('b002').querySelector('.cg-bd__per .cg-money')).not.toBeNull();
    const sheet = ui.root.adoptedStyleSheets.map((item) => [...item.cssRules].map((rule) => rule.cssText).join('\n')).join('\n');
    expect(sheet).toMatch(/\.cg-bd__life[^{]*\{[^}]*--cg-money/);
  });
  it('[SP-014] [X67] a new payer has the old extension\'s chip «новый» by the name', async () => {
    ui = await mountBoardSettled('spenders', boardOnly(boardOf(ctx, BOARD_FANS.filter((fan) => fan.isNew === true))));
    const jake = row('b021');
    expect(textOf(jake.querySelector('.cg-bd__new'))).toBe('новый');
    expect(textOf(jake.querySelector('.cg-bd__name'))).toBe('Jake Morrison');
  });
  it('[SP-015] a deleted account: a muted name and the word «удалён», no strike-through', async () => {
    ui = await mountBoardSettled('spenders', 'board-list');
    const kenji = row('b012');
    expect(kenji.classList.contains('is-deleted')).toBe(true);
    expect([...kenji.querySelectorAll('.cg-bd__tag')].map(textOf)).toEqual(['удалён']);
    expect(kenji.querySelector('s, del, strike')).toBeNull();
    expect(cells(kenji)[2]).toBe('$430');
    const sheets = ui.root.adoptedStyleSheets.flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText)).join('\n');
    expect(sheets).not.toMatch(/line-through/);
  });

  it('[SP-016] [X67] the last message is not a column of the list: the row is the name over the @handle', async () => {
    ui = await mountBoardSettled('spenders', 'board-list');
    expect(ui.$('.cg-bd__last')).toBeNull();
    expect(textOf(row('b005').querySelector('.cg-bd__handle'))).toBe('@dank_88');
  });
  it('[SP-017] [X67] a fan who waits has «ждёт 7 мин» by the name; both ages are the tooltip of the fan; we wrote last — no chip', async () => {
    ui = await mountBoardSettled('spenders', 'board-list');
    expect(textOf(row('b002').querySelector('.cg-bd__wait'))).toBe('ждёт 7 мин');
    const main = row('b002').querySelector('.cg-bd__main') as HTMLElement;
    expect(ui.root.getElementById(main.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Мы писали 10 ч назад, фан 7 мин назад');
    expect(row('b005').querySelector('.cg-bd__wait')).toBeNull();
    expect(ui.$$('.cg-bd .cg-dot, .cg-bd [data-accent-use], .cg-bd .cg-badge')).toEqual([]);
  });
  it('[SP-018] [X67] no column heads: the list goes by the lifetime, as the old one did', async () => {
    ui = await mountBoardSettled('spenders', 'board-list');
    expect(ui.$('.cg-bd__colhead, .cg-bd__sort')).toBeNull();
    expect(ui.$$('[data-cg-fan]').slice(0, 3).map((element) => element.getAttribute('data-cg-fan'))).toEqual(['spenders:b001', 'spenders:b002', 'spenders:b003']);
  });
  it('[SP-021] [SP-022] [X67] the footer speaks only when a search narrows the list: «40 фанов. Показано: 7» and the way back; the time is under the title', async () => {
    ui = await mountBoardSettled('spenders', 'board-list');
    expect(ui.$('.cg-bd > .cg-sp__foot')).toBeNull();
    expect(ui.$$('.cg-sp__sub > span').map(textOf)).toContain('данные на 09:18');
    const refresh = ui.$('.cg-sp__top .cg-sp__refresh button') as HTMLElement;
    expect(ui.root.getElementById(refresh.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Перечитать данные хаба. AI не запускается');
    ui.unmount();
    const vm = boardOf(ctx, BOARD_FANS);
    const reset = button('spenders.filter.all', { type: 'ResetFilters', list: 'spenders' });
    ui = await mountBoardSettled('spenders', boardOnly({ ...vm, footer: { ...vm.footer, shown: 7 }, reset }));
    expect(ui.$('.cg-bd > .cg-sp__foot')).toBeNull();
    ui.unmount();
    ui = await mountBoardSettled('spenders', boardOnly({ ...vm, query: 'hub', footer: { ...vm.footer, shown: 7 }, reset }));
    expect(ui.text('.cg-bd > .cg-sp__foot > span')).toBe('40 фанов. Показано: 7');
    await flush(() => (ui?.$('.cg-bd > .cg-sp__foot .cg-btn') as HTMLElement).click());
    expect(ui.actions().at(-1)).toEqual({ type: 'ResetFilters', list: 'spenders' });
  });
  it('[SP-021] the 1000-row cut is said in words, and a total the hub does not know is not invented', async () => {
    ui = await mountBoardSettled('spenders', 'board-1000');
    expect(ui.text('.cg-sp__line')).toBe('Показаны первые 1000 из 1340. Сузьте поиск или фильтр.');
    expect(ui.text('.cg-bd > .cg-sp__foot > span')).toBe('1000 из 1340 фанов, охват неполный');
    ui.unmount();
    const vm = boardOf(ctx, BOARD_FANS);
    ui = await mountBoardSettled('spenders', boardOnly({ ...vm, footer: { ...vm.footer, total: null, stamp: { asOf: null, coverage: 'unknown' } } }));
    expect(ui.$$('.cg-bd > .cg-sp__foot > span').map(textOf)).toEqual(['40 фанов, охват неизвестен']);
  });

  it('[SP-034] [X67] the old window\'s foot: the list\'s keys', async () => {
    ui = await mountBoardSettled('spenders', 'board-list');
    const keys = ui.$$('.cg-sp__frame > .cg-keys .cg-key');
    expect(keys.map((key) => textOf(key.querySelector('kbd')))).toEqual(['J / K', 'Space', 'O', '/', 'Esc']);
  });
  it('a thousand fans: at most 150 rows are in the DOM, and the keyboard still reaches the last one', async () => {
    ui = await mountBoardSettled('spenders', 'board-1000');
    expect(ui.$$('.cg-vlist__inner [data-cg-fan]').length).toBeGreaterThan(0);
    expect(ui.$$('.cg-vlist__row').length).toBeLessThanOrEqual(MAX_DOM_ROWS);
    const first = ui.root.activeElement as HTMLElement;
    await flush(() => keydown(first, 'End', { code: 'End' }));
    await flush();
    expect(ui.$$('.cg-vlist__row').length).toBeLessThanOrEqual(MAX_DOM_ROWS);
    const items = boardItems(boardShelves(ctx, manyFans(1000), null));
    const last = items.at(-1);
    expect((ui.root.activeElement as HTMLElement).getAttribute('data-cg-fan')).toBe(last?.kind === 'fan' ? last.row.handle : null);
    expect(items.filter((item) => item.kind === 'fan')).toHaveLength(1000);
  });

  it('[SP-021] a list viewport taller than 150 rows still holds 150: the cap, not the window, sets the limit', async () => {
    // happy-dom has no layout: a 20 000 px list viewport (over 500 rows of 36 px) stands in for a very tall window.
    const tall = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('cg-vlist') ? 20_000 : 0;
    });
    try {
      ui = await mountBoardSettled('spenders', 'board-1000');
      await settle();
      const nodes = (): number => ui?.$$('.cg-vlist__row, .cg-vlist__sticky').length ?? -1;
      // The viewport alone would hold over 500 rows: exactly the cap is rendered.
      expect(ui.$$('.cg-vlist__row').length).toBeGreaterThanOrEqual(MAX_DOM_ROWS - 1);
      expect(nodes()).toBeLessThanOrEqual(MAX_DOM_ROWS);
      await flush(() => keydown(ui?.root.activeElement as HTMLElement, 'End', { code: 'End' }));
      await settle();
      // Scrolled: the sticky copy of the shelf row counts too.
      expect(ui.$$('.cg-vlist__row').length).toBeGreaterThanOrEqual(MAX_DOM_ROWS - 1);
      expect(nodes()).toBeLessThanOrEqual(MAX_DOM_ROWS);
    } finally {
      tall.mockRestore();
    }
  });
});

describe('Spenders board: states of the source', () => {
  it('[SP-003] loading shows its stage, not an empty list', async () => {
    ui = await mountBoardSettled('spenders', 'gallery-loading');
    expect(ui.$('.cg-bd [role="status"][aria-busy="true"]')).not.toBeNull();
    expect(ui.$('.cg-vlist')).toBeNull();
    // The window itself is there and can be closed.
    expect(ui.$('.cg-sp__close')).not.toBeNull();
  });

  it('[SP-021] an error is a card with «Повторить», never an empty list (SP-029)', async () => {
    ui = await mountBoardSettled('spenders', 'board-error');
    const card = ui.$('.cg-bd .cg-card') as HTMLElement;
    expect(card.getAttribute('data-cg-code')).toBe('CG-DATA-TIMEOUT');
    expect(textOf(card.querySelector('.cg-card__code'))).toBe('ChatGoose · CG-DATA-TIMEOUT');
    expect(ui.$('.cg-vlist')).toBeNull();
    await flush(() => (card.querySelector('.cg-btn') as HTMLElement).click());
    expect(ui.actions().at(-1)).toEqual({ type: 'ReloadView', selector: { of: 'spenders.board' } });
    // The statistics failed on its own, with its own retry.
    expect(ui.$('.cg-st .cg-card')?.getAttribute('data-cg-code')).toBe('CG-DATA-UNAVAILABLE');
  });

  it('nothing after a filter: the words and «Сбросить»', async () => {
    ui = await mountBoardSettled('spenders', 'board-empty');
    expect(ui.text('.cg-bd .cg-state--empty')).toBe('Никого не нашли. Проверьте фильтр или поиск.');
    expect(ui.text('.cg-bd > .cg-sp__foot > span')).toBe('40 фанов. Показано: 0');
    expect(ui.$('.cg-bd__reset .cg-btn')).not.toBeNull();
  });

  it('no rights: the card says why, with the way out', async () => {
    ui = await mountBoardSettled('spenders', 'no-rights');
    expect(ui.$('.cg-bd .cg-card')?.getAttribute('data-cg-code')).toBe('CG-HUB-FORBIDDEN');
    expect(ui.$('.cg-vlist')).toBeNull();
  });

  it('the hub is away: the last rows stay under the offline card', async () => {
    ui = await mountBoardSettled('spenders', boardOnly({ ...boardOf(ctx, BOARD_FANS), view: views.offline(cgError(ctx, 'CG-HUB-UNAVAILABLE'), { type: 'ReloadView', selector: { of: 'spenders.board' } }, ctx.now - 600_000) }));
    expect(ui.$('.cg-bd__banner .cg-card')?.getAttribute('data-cg-code')).toBe('CG-HUB-UNAVAILABLE');
    expect(ui.$$('.cg-vlist__inner [data-cg-fan]').length).toBeGreaterThan(0);
  });

  it('[SP-029] [SP-047] «Ждут ответа» whose hub queue did not read (1.5.0): the error card with its code and «Повторить» stands over the list, a line says the list below is the local filter — and the rows stay on screen', async () => {
    const retry = { type: 'ReloadView', selector: { of: 'spenders.board' } } as const;
    ui = await mountBoardSettled('spenders', boardOnly({ ...boardOf(ctx, BOARD_FANS), waitingFallback: { error: cgError(ctx, 'CG-HUB-TIMEOUT', { detail: 'HTTP 504 • gateway_timeout' }), retry } }));
    const notice = ui.$('.cg-bd__banner[data-cg-waiting-fallback]') as HTMLElement;
    expect(notice.getAttribute('data-cg-waiting-fallback')).toBe('CG-HUB-TIMEOUT');
    const card = notice.querySelector('.cg-card') as HTMLElement;
    expect(card.getAttribute('data-cg-code')).toBe('CG-HUB-TIMEOUT');
    expect(textOf(card.querySelector('.cg-card__code'))).toBe('ChatGoose · CG-HUB-TIMEOUT');
    expect(textOf(card)).toContain('HTTP 504 • gateway_timeout');
    // The list is named for what it is.
    expect(textOf(notice.querySelector('.cg-sp__line'))).toBe('Ниже — не очередь хаба, а локальный фильтр: только те строки доски, что уже загружены.');
    expect(notice.querySelector('.cg-sp__line')?.getAttribute('role')).toBe('status');
    // …and is still there, under the notice.
    expect(ui.$$('.cg-vlist__inner [data-cg-fan]').length).toBeGreaterThan(0);
    await flush(() => (card.querySelector('.cg-btn') as HTMLElement).click());
    expect(ui.actions().at(-1)).toEqual(retry);
    ui.unmount();
    // The local filter found nobody: the notice stands over the empty words, so «никого не нашли» is never read as «никто не ждёт».
    ui = await mountBoardSettled('spenders', boardOnly({ ...boardOf(ctx, []), view: views.empty({ key: 'spenders.empty' }), waitingFallback: { error: cgError(ctx, 'CG-HUB-TIMEOUT'), retry } }));
    expect(ui.$('.cg-bd__banner[data-cg-waiting-fallback] .cg-card')?.getAttribute('data-cg-code')).toBe('CG-HUB-TIMEOUT');
    expect(ui.text('.cg-bd .cg-state--empty')).toBe('Никого не нашли. Проверьте фильтр или поиск.');
    ui.unmount();
    // Without the field — or with null — a board is as it always was.
    ui = await mountBoardSettled('spenders', boardOnly({ ...boardOf(ctx, BOARD_FANS), waitingFallback: null }));
    expect(ui.$('[data-cg-waiting-fallback]')).toBeNull();
    expect(ui.$('.cg-bd__banner .cg-sp__line')).toBeNull();
  });

  it('[SP-043] «Ждут ответа» without the hub queue says it in English too', async () => {
    const en = ctxOf({ lang: 'en', platform: 'mac' });
    ui = await mountBoardSettled('spenders', boardOnly({ ...boardOf(en, BOARD_FANS), waitingFallback: { error: cgError(en, 'CG-HUB-TIMEOUT'), retry: { type: 'ReloadView', selector: { of: 'spenders.board' } } } }), { language: 'en' });
    expect(ui.text('.cg-bd__banner .cg-sp__line')).toBe('Below is not the hub’s queue but a local filter: only the rows of the board that are already loaded.');
    expect(textOf(ui.$('.cg-bd__banner[data-cg-waiting-fallback] .cg-btn'))).toBe('Retry');
  });

  it('[SP-043] the board speaks the chosen language', async () => {
    ui = await mountBoardSettled('spenders', 'board-list', { language: 'en' });
    expect(ui.$$('.cg-sp__filters .cg-flt').map((filter) => filter.firstChild?.textContent)).toEqual(['All', '🐳 Whale', '⭐ Top', '✅ Prime', '③ Base', '② Low', '① Micro']);
    expect(textOf(ui.$('.cg-sp__filters .cg-choice'))).toBe('Filter');
    expect(textOf(row('b012').querySelector('.cg-bd__tag'))).toBe('deleted');
  });
});

describe('Spenders board: keyboard', () => {
  it('[SP-033] ↑ ↓ and J / K move by the physical key, skipping shelf rows; Enter or O opens the chat; Space the preview', async () => {
    ui = await mountBoardSettled('spenders', 'board-list');
    const press = async (code: string, key = code): Promise<void> => flush(() => keydown(ui?.root.activeElement as HTMLElement, key, { code }));
    await press('ArrowDown');
    expect((ui.root.activeElement as HTMLElement).getAttribute('data-cg-fan')).toBe('spenders:b002');
    // «о» on the Russian layout is still the J key.
    await press('KeyJ', 'о');
    expect((ui.root.activeElement as HTMLElement).getAttribute('data-cg-fan')).toBe('spenders:b003');
    await press('KeyK', 'л');
    await press('ArrowUp');
    expect((ui.root.activeElement as HTMLElement).getAttribute('data-cg-fan')).toBe('spenders:b001');
    // One tab stop: the keyboard's row.
    expect(ui.$$('.cg-vlist__inner [data-cg-item][tabindex="0"]')).toHaveLength(1);

    await press('Space', ' ');
    expect(ui.actions().at(-1)).toEqual({ type: 'OpenPreview', targetHandle: 'spenders:b001' });
    await press('Enter');
    expect(ui.actions().at(-1)).toEqual({ type: 'Navigate', to: { kind: 'chat', targetHandle: 'spenders:b001' } });
    await press('KeyO', 'щ');
    expect(ui.actionsOf('Navigate')).toHaveLength(2);
  });

  it('[SP-033] a key acts on the fan of the focused row when the list changed above it: Enter, O and Space never reach a neighbour', async () => {
    const newcomer: BoardFan = { ...(BOARD_FANS[0] as BoardFan), key: 'b900', name: 'Zed Newcomer', username: 'zed', lifetime: 50_000 };
    const scenario = {
      ...boardOnly(boardOf(ctx, BOARD_FANS)),
      steps: [
        // A fan lands on top of the first shelf: every row below moves one place down.
        { label: 'a row above', at: 1_000, views: [entry({ of: 'spenders.board' }, boardOf(ctx, [newcomer, ...BOARD_FANS]))] },
        // The two top fans leave: every row moves two places up.
        { label: 'rows gone above', at: 2_000, views: [entry({ of: 'spenders.board' }, boardOf(ctx, BOARD_FANS.slice(1)))] },
        // The focused fan itself leaves the list.
        { label: 'the fan left', at: 3_000, views: [entry({ of: 'spenders.board' }, boardOf(ctx, BOARD_FANS.filter((fan) => fan.key !== 'b003').slice(1)))] },
      ],
    };
    ui = await mountBoardSettled('spenders', scenario);
    const focused = (): HTMLElement => ui?.root.activeElement as HTMLElement;
    const press = async (code: string, key = code): Promise<void> => flush(() => keydown(focused(), key, { code }));
    const tabStops = (): (string | null)[] => (ui?.$$('.cg-vlist__inner [data-cg-item][tabindex="0"]') ?? []).map((element) => element.getAttribute('data-cg-fan'));
    await press('ArrowDown');
    await press('ArrowDown');
    expect(focused().getAttribute('data-cg-fan')).toBe('spenders:b003');

    for (const step of [0, 1]) {
      await flush(() => ui?.client.goTo(step));
      await settle();
      // Focus and the one tab stop stay on the fan, wherever its row went.
      expect(focused().getAttribute('data-cg-fan')).toBe('spenders:b003');
      expect(tabStops()).toEqual(['spenders:b003']);
      const before = ui.actions().length;
      await press('Enter');
      await press('KeyO', 'щ');
      await press('Space', ' ');
      expect(ui.actions().slice(before)).toEqual([
        { type: 'Navigate', to: { kind: 'chat', targetHandle: 'spenders:b003' } },
        { type: 'Navigate', to: { kind: 'chat', targetHandle: 'spenders:b003' } },
        { type: 'OpenPreview', targetHandle: 'spenders:b003' },
      ]);
    }
    // The arrows go on from the fan, not from where it used to stand.
    await press('ArrowDown');
    expect(focused().getAttribute('data-cg-fan')).toBe('spenders:b004');
    await press('ArrowUp');
    expect(focused().getAttribute('data-cg-fan')).toBe('spenders:b003');

    // The key is the row's it came from, whatever row the board remembers as the keyboard's: here it still
    // remembers b003, and the key comes from b005.
    const elsewhere = ui.actions().length;
    await flush(() => keydown(row('b005'), 'Enter', { code: 'Enter' }));
    await flush(() => keydown(row('b005'), ' ', { code: 'Space' }));
    expect(ui.actions().slice(elsewhere)).toEqual([
      { type: 'Navigate', to: { kind: 'chat', targetHandle: 'spenders:b005' } },
      { type: 'OpenPreview', targetHandle: 'spenders:b005' },
    ]);
    expect(tabStops()).toEqual(['spenders:b003']);

    // The fan left the list: its row is gone, the tab stop goes back to the start, and no key opens anybody.
    const before = ui.actions().length;
    await flush(() => ui?.client.goTo(2));
    await settle();
    expect(row('b003')).toBeNull();
    expect(tabStops()).toEqual(['spenders:b002']);
    expect(ui.actions().slice(before)).toEqual([]);
  });

  it('[SP-033] the last row of a shelf is followed by the first row of the next one', () => {
    const items = boardItems(boardShelves(ctx, BOARD_FANS, null));
    const lastOfTop = items.findIndex((item) => item.kind === 'fan' && item.row.handle === 'spenders:b008');
    const next = items[nextStop(items, lastOfTop, 1)];
    expect(next?.kind === 'fan' ? next.row.handle : null).toBe('spenders:b009');
    expect(nextStop(items, initialStop(items), -1)).toBe(initialStop(items));
    expect(BOARD_HEIGHTS).toEqual({ shelf: 36, fan: 52 });
  });

  it('[SP-019] `/` puts focus into the search; typing asks after the debounce; Esc clears it first', async () => {
    vi.useFakeTimers();
    ui = await mountBoardSettled('spenders', 'board-list');
    const input = ui.$('.cg-sp__search input') as HTMLInputElement;
    await flush(() => keydown(ui?.root.activeElement as HTMLElement, '/', { code: 'Slash' }));
    expect(ui.root.activeElement).toBe(input);
    await flush(() => {
      input.value = 'hub';
      input.dispatchEvent(new InputEvent('input', { bubbles: true }));
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    });
    expect(ui.actionsOf('Search')).toEqual([]);
    await flush(() => vi.advanceTimersByTime(1));
    expect(ui.actionsOf('Search')).toEqual([{ type: 'Search', list: 'spenders', query: 'hub' }]);
    // Letters typed into the search are text: S does not expand the statistics, J does not move the list.
    await flush(() => keydown(input, 's', { code: 'KeyS' }));
    expect(ui.actionsOf('SetStatsExpanded')).toEqual([]);
    await flush(() => keydown(input, 'Escape'));
    expect(input.value).toBe('');
    expect(ui.actionsOf('Search').at(-1)).toEqual({ type: 'Search', list: 'spenders', query: '' });
    expect(ui.actionsOf('Navigate')).toEqual([]);
  });

  it('[SP-019] the search paint mark ends with the shelves that answer the query, not with the echo of the typed text', async () => {
    const all = boardOf(ctx, BOARD_FANS);
    const hub = BOARD_FANS.filter((fan) => fan.name.toLowerCase().includes('hub'));
    const answer = boardOf(ctx, hub, { query: 'hub', footer: { ...all.footer, shown: hub.length } });
    const at = (vm: ReturnType<typeof boardOf>) => [entry({ of: 'spenders.board' }, vm)];
    ui = await mountBoardSettled('spenders', {
      ...boardOnly(all),
      steps: [
        // A controller shows the typed text at once (the list is still the old one)…
        { label: 'the echo of the query', at: 10, views: at({ ...all, query: 'hub' }) },
        // …and the filtered list after its pause.
        { label: 'the answer', at: 160, views: at(answer) },
        // The hub refreshed the same answer: not a search.
        { label: 'a refresh', at: 5_000, views: at({ ...answer, shelves: [...answer.shelves] }) },
        // Query and list in one snapshot.
        { label: 'cleared, answered at once', at: 6_000, views: at(all) },
        // Typed and taken back before the pause ended: the list on screen already answers it.
        { label: 'typed', at: 7_000, views: at({ ...all, query: 'x' }) },
        { label: 'taken back', at: 7_050, views: at({ ...all, query: '' }) },
        { label: 'a refresh later', at: 9_000, views: at({ ...all, shelves: [...all.shelves] }) },
      ],
    });
    const searches = (): number => ui?.deps.marks.paints.filter((paint) => paint.metric === 'searchMs').length ?? -1;
    const step = async (index: number): Promise<number> => {
      await flush(() => ui?.client.goTo(index));
      await settle();
      return searches();
    };
    expect(searches()).toBe(0);
    expect(await step(0)).toBe(0);
    expect(await step(1)).toBe(1);
    expect(ui.deps.marks.paints.at(-1)).toEqual({ metric: 'searchMs', mark: 'spenders.search' });
    expect(await step(2)).toBe(1);
    expect(await step(3)).toBe(2);
    expect(await step(4)).toBe(2);
    expect(await step(5)).toBe(2);
    expect(await step(6)).toBe(2);
  });

  it('[SP-049] S expands the statistics and collapses it back', async () => {
    ui = await mountBoardSettled('spenders', 'board-list');
    await flush(() => keydown(ui?.root.activeElement as HTMLElement, 's', { code: 'KeyS' }));
    expect(ui.actions().at(-1)).toEqual({ type: 'SetStatsExpanded', expanded: true });
    ui.unmount();
    ui = await mountBoardSettled('spenders', '11i');
    await flush(() => keydown(ui?.$('.cg-stx') as HTMLElement, 'ы', { code: 'KeyS' }));
    expect(ui.actions().at(-1)).toEqual({ type: 'SetStatsExpanded', expanded: false });
  });

  it('[SP-049] S keeps the keyboard inside the window: the statistics take the focus when they replace the list, and the fan’s row takes it back', async () => {
    const collapsed = stats(ctx, views.ready());
    const scenario = {
      ...boardOnly(boardOf(ctx, BOARD_FANS), collapsed),
      steps: [
        { at: 0, label: 'the statistics expanded', views: [entry({ of: 'spenders.stats' }, { ...collapsed, expanded: true })] },
        { at: 0, label: 'the list is back', views: [entry({ of: 'spenders.stats' }, collapsed)] },
      ],
    };
    ui = await mountBoardSettled('spenders', scenario);
    expect(ui.root.activeElement).toBe(row('b001'));
    await flush(() => keydown(ui?.root.activeElement as HTMLElement, 's', { code: 'KeyS' }));
    expect(ui.actions().at(-1)).toEqual({ type: 'SetStatsExpanded', expanded: true });
    // The controller expands them: the list — and the row that had the focus — is gone.
    await flush(() => ui?.client.advance());
    expect(ui.$('.cg-bd')).toBeNull();
    expect(textOf(ui.root.activeElement)).toContain('Свернуть к списку');
    // The focus is still ours, so the second S is heard and brings the list back.
    await flush(() => keydown(ui?.root.activeElement as HTMLElement, 's', { code: 'KeyS' }));
    expect(ui.actions().at(-1)).toEqual({ type: 'SetStatsExpanded', expanded: false });
    await flush(() => ui?.client.advance());
    await settle();
    expect(ui.$('.cg-stx')).toBeNull();
    expect(ui.root.activeElement).toBe(row('b001'));
  });

  it('[SP-024] «Обновить» of the window\'s header reads the list and the statistics again; of the expanded statistics — the statistics', async () => {
    ui = await mountBoardSettled('spenders', 'board-list');
    const refresh = ui.$('.cg-sp__top .cg-sp__refresh button') as HTMLElement;
    expect(textOf(refresh)).toBe('Обновить');
    await flush(() => refresh.click());
    expect(ui.actionsOf('ReloadView')).toEqual([
      { type: 'ReloadView', selector: { of: 'spenders.board' } },
      { type: 'ReloadView', selector: { of: 'spenders.stats' } },
    ]);
    await settle();
    expect(refresh.getAttribute('aria-busy')).not.toBe('true');
    ui.unmount();

    ui = await mountBoardSettled('spenders', '11i');
    const again = ui.$('.cg-stx__foot .cg-sp__refresh button') as HTMLElement;
    await flush(() => again.click());
    expect(ui.actionsOf('ReloadView')).toEqual([{ type: 'ReloadView', selector: { of: 'spenders.stats' } }]);
  });

  it('a click on a row opens its preview', async () => {
    ui = await mountBoardSettled('spenders', 'board-list');
    await flush(() => row('b004').click());
    expect(ui.actions().at(-1)).toEqual({ type: 'OpenPreview', targetHandle: 'spenders:b004' });
  });

  it('[SP-019] a search over a thousand rows rebuilds the list and says «Показано N»', async () => {
    const fans = manyFans(1000);
    ui = await mountBoardSettled('spenders', 'board-1000', { client: (world) => new LiveBoardClient(world.client, world.ctx, fans) });
    const input = ui.$('.cg-sp__search input') as HTMLInputElement;
    await flush(() => {
      input.value = 'aaron';
      input.dispatchEvent(new InputEvent('input', { bubbles: true }));
      keydown(input, 'Enter');
    });
    const expected = fans.filter((fan) => fan.name.toLowerCase().includes('aaron')).length;
    expect(expected).toBeGreaterThan(10);
    await settle();
    expect(ui.text('.cg-bd > .cg-sp__foot > span')).toBe(`1000 фанов. Показано: ${expected}`);
    // Said, not only printed (ui-design §6.2). The live region speaks a render later than the foot (the board's effect,
    // then the announcement's own render): on a busy runner settle()'s 30 ms ended between the two (#184's check).
    const live = ui.$('[data-cg-live]');
    await vi.waitFor(() => expect(textOf(live)).toBe(`Показано: ${expected}`), { timeout: 2000, interval: 10 });
    expect(ui.$$('.cg-vlist__inner [data-cg-fan]').length).toBeLessThanOrEqual(expected);
  });
});

describe('Spenders statistics', () => {
  it('[SP-044] the compact column: 30 days, today, 7 days with the change, payers, the average check', async () => {
    ui = await mountBoardSettled('spenders', 'board-list');
    const column = ui.$('.cg-st') as HTMLElement;
    expect(column.tagName).toBe('ASIDE');
    // The region is «Статистика Spenders» for a screen reader (ui-design §6.1); its visible title stays «Статистика».
    expect(column.getAttribute('aria-label')).toBe('Статистика Spenders');
    expect(textOf(column.querySelector('.cg-st__title'))).toBe('Статистика');
    expect(textOf(column.querySelector('.cg-st__big'))).toBe('$4,670');
    const keys = [...column.querySelectorAll('.cg-st__kv .cg-st__k')].map((key) => key.firstChild?.textContent);
    expect(keys).toEqual(['Сегодня', '7 дней', 'Платящие', 'Средний чек', 'Ждут ответа', 'Новые плательщики', 'Молчат 8–21 день', 'Молчат дольше 21 дня', 'Нет данных']);
    const values = [...column.querySelectorAll('.cg-st__kv .cg-st__v')].map((value) => value.firstChild?.textContent);
    expect(values).toEqual(['$65', '$1,110', '20', '$106', '12', '3', '10', '6', '4']);
    expect([...column.querySelectorAll('.cg-st__kv .cg-st__d')].map(textOf)[1]).toBe('+4%');
    expect(textOf(column.querySelector('.cg-st__foot'))).toBe('Данные на 09:18, охват полный');
    // Sums in the statistics are plain ink: green belongs to `+$N` only.
    expect(column.querySelectorAll('.cg-money')).toHaveLength(0);
  });

  it('[SP-044] the chart: a bar per day, «today» marked, and the same series as a hidden table', async () => {
    ui = await mountBoardSettled('spenders', 'board-list');
    const chart = ui.$('.cg-st .cg-spark') as HTMLElement;
    expect(chart.getAttribute('aria-label')).toBe('Выручка по дням');
    expect(chart.querySelectorAll('.cg-spark__bar')).toHaveLength(30);
    expect(chart.querySelectorAll('.cg-spark__bar.is-today')).toHaveLength(1);
    expect(ui.$$('.cg-st .cg-spark__ax span').map(textOf)).toEqual(['4 сен', 'сегодня']);
    const table = ui.$('.cg-st table.cg-sr') as HTMLElement;
    expect(table.querySelectorAll('tbody tr')).toHaveLength(30);
    expect(textOf(table.querySelector('tbody tr'))).toMatch(/^4 сен\$\d+/);
    const first = chart.querySelector('.cg-spark__bar') as HTMLElement;
    expect(ui.root.getElementById(first.getAttribute('aria-describedby') ?? '')?.textContent).toMatch(/^4 сен: \$\d+$/);
  });

  it('[SP-045] the shelves of the statistics; a click scrolls the list to that shelf', async () => {
    ui = await mountBoardSettled('spenders', 'board-list');
    const tiers = ui.$$('.cg-st__tier');
    // One grid holds the header and every shelf, so the names, the bars and the numbers stand in columns.
    expect(tiers.every((tier) => tier.parentElement === ui?.$('.cg-st__tiers'))).toBe(true);
    expect(ui.$$('.cg-st__tiers > .cg-st__tierrow')).toHaveLength(7);
    expect(tiers.map((tier) => [...tier.children].map(textOf).filter((text) => text !== ''))).toEqual([
      ['$600+', '8', '$4,005'],
      ['$350–600', '6', '$200'],
      ['$150–350', '7', '$310'],
      ['$50–150', '7', '$105'],
      ['$25–50', '6', '$40'],
      ['$1–25', '6', '$10'],
    ]);
    await flush(() => (tiers[2] as HTMLElement).click());
    expect(ui.actions().at(-1)).toEqual({ type: 'RevealShelf', shelfId: 't150' });
  });

  it('[SP-045] the hub’s two remainder tiers are two rows — «Без тира» and «Не распределено» — in the column and in the expanded table, in both languages', async () => {
    const vm = boardOf(ctx, BOARD_FANS);
    const base = stats(ctx, views.ready());
    const none = { fromMills: null, toMills: null } as const;
    const withRemainders = {
      ...base,
      shelves: [
        ...base.shelves.slice(0, 2),
        { id: 'shelf-outside', range: none, remainder: 'untiered' as const, fans: 109, lifetime: null, period: 0, share: 0 },
        { id: 'shelf-unattributed', range: none, remainder: 'unattributed' as const, fans: 0, lifetime: null, period: 1_250_000, share: 0.04 },
        // A tier without bounds that names no remainder (a hub newer than this build): still a row of its own.
        { id: 'shelf-someday', range: none, fans: 3, lifetime: null, period: 5_000, share: 0.04 },
      ],
    };
    ui = await mountBoardSettled('spenders', boardOnly(vm, withRemainders));
    const names = (): string[] => (ui?.$$('.cg-st__tier .cg-st__k') ?? []).map(textOf);
    expect(names()).toEqual(['$600+', '$350–600', 'Без тира', 'Не распределено', 'вне полок']);
    // Five rows, five buttons: no row swallowed another for sharing its key.
    expect(ui.$$('.cg-st__tier')).toHaveLength(5);
    await flush(() => (ui?.$$('.cg-st__tier')[2] as HTMLElement).click());
    expect(ui.actions().at(-1)).toEqual({ type: 'RevealShelf', shelfId: 'shelf-outside' });
    await flush(() => (ui?.$$('.cg-st__tier')[3] as HTMLElement).click());
    expect(ui.actions().at(-1)).toEqual({ type: 'RevealShelf', shelfId: 'shelf-unattributed' });
    ui.unmount();
    ui = await mountBoardSettled('spenders', boardOnly(vm, { ...withRemainders, expanded: true }));
    expect(ui.$$('.cg-stx__table tbody tr td:first-child').map(textOf)).toEqual(['$600+', '$350–600', 'Без тира', 'Не распределено', 'вне полок']);
    expect(statsShelfLabel(boardWorld('board-list', 'en').deps.i18n, { range: none, remainder: 'untiered' })).toBe('No tier');
    expect(statsShelfLabel(boardWorld('board-list', 'en').deps.i18n, { range: none, remainder: 'unattributed' })).toBe('Unattributed');
  });

  it('[SP-049] «Развернуть» and the expanded view with «Свернуть к списку»', async () => {
    ui = await mountBoardSettled('spenders', 'board-list');
    const expand = ui.$('.cg-st__head .cg-btn') as HTMLElement;
    expect(textOf(expand)).toBe('Развернуть');
    await flush(() => expand.click());
    expect(ui.actions().at(-1)).toEqual({ type: 'SetStatsExpanded', expanded: true });
    ui.unmount();

    ui = await mountBoardSettled('spenders', '11i');
    expect(ui.$('.cg-bd')).toBeNull();
    expect(ui.$('.cg-stx')?.tagName).toBe('SECTION');
    expect(ui.$('.cg-stx')?.getAttribute('aria-label')).toBe('Статистика Spenders');
    expect(ui.text('.cg-stx .cg-st__title')).toBe('Статистика, 30 дней');
    expect(ui.$$('.cg-stx__cell').map((cell) => [...cell.children].map(textOf))).toEqual([
      ['Сегодня', '$65', 'день ещё идёт'],
      ['7 дней', '$1,110', '+4% к прошлым 7 дням ($1,071)'],
      ['30 дней', '$4,670', '44 покупки'],
      ['Платящие', '20', 'средний чек $106'],
    ]);
    expect(ui.$$('.cg-stx__table thead th').map(textOf)).toEqual(['Полка', 'Фанов', 'Всё время', '30 дней']);
    expect(ui.$$('.cg-stx__table tbody tr').map((line) => [...line.children].map(textOf))[0]).toEqual(['$600+', '8', '$78,690', '$4,005']);
    // The zone is said by its offset, never by the hub's raw zone id.
    expect(ui.text('.cg-stx__foot > span')).toBe('Данные на 09:18, охват полный. Часовой пояс: UTC+3.');
    expect(ui.$$('.cg-stx .cg-spark__ax span').map(textOf)).toEqual(['4 сен', '18 сен', 'сегодня']);
    await flush(() => (ui?.$('.cg-stx__head .cg-btn') as HTMLElement).click());
    expect(ui.actions().at(-1)).toEqual({ type: 'SetStatsExpanded', expanded: false });
  });

  it('[SP-044] [X55] a known zero of the period is «трат нет» — in the column and in the tiles, as the rows and the fan panel say it; unknown stays «—»', async () => {
    const base = stats(ctx, views.ready());
    const quiet = {
      ...base,
      today: { ...base.today, mills: 0 },
      d7: { ...base.d7, mills: 0, changePct: null, prev7: null },
      d30: { ...base.d30, mills: 0, purchases: 0 },
      avgCheck: { ...base.avgCheck, mills: null },
      days: base.days.map((day) => ({ ...day, gross: 0 })),
    };
    ui = await mountBoardSettled('spenders', boardOnly(boardOf(ctx, BOARD_FANS), quiet));
    const column = ui.$('.cg-st') as HTMLElement;
    expect(textOf(column.querySelector('.cg-st__big'))).toBe('трат нет');
    expect(column.querySelector('.cg-st__big')?.classList.contains('is-none')).toBe(true);
    const values = [...column.querySelectorAll('.cg-st__kv .cg-st__v')];
    expect(values.slice(0, 4).map((value) => value.firstChild?.textContent)).toEqual(['трат нет', 'трат нет', '20', '—']);
    expect(values.slice(0, 4).map((value) => value.classList.contains('is-none'))).toEqual([true, true, false, false]);
    expect(column.textContent).not.toContain('$0');
    ui.unmount();
    ui = await mountBoardSettled('spenders', boardOnly(boardOf(ctx, BOARD_FANS), { ...quiet, expanded: true }));
    expect(ui.$$('.cg-stx__cell').map((cell) => [...cell.children].map(textOf))).toEqual([
      ['Сегодня', 'трат нет', 'день ещё идёт'],
      ['7 дней', 'трат нет'],
      ['30 дней', 'трат нет'],
      ['Платящие', '20'],
    ]);
    // No day with money: no «максимум $0» over the chart.
    expect(ui.$('.cg-stx__chart .cg-st__cap')?.textContent).toBe('Выручка по дням');
  });

  it('[SP-046] [SP-047] [SP-048] the attention numbers come with their own data time; unknown is «—»', async () => {
    const partial = { ...stats(ctx, views.partial({ kind: 'coverage', level: 'partial' })) };
    const unknown = { ...partial, attention: { ...partial.attention, silentOver21: { count: null, stamp: partial.stamp } } };
    ui = await mountBoardSettled('spenders', boardOnly(boardOf(ctx, BOARD_FANS), unknown));
    const keys = [...(ui.$('.cg-st') as HTMLElement).querySelectorAll('.cg-st__kv .cg-st__k')].map((key) => key.firstChild?.textContent);
    // The past is incomplete: «new» means the first purchase the hub has seen.
    expect(keys).toContain('Новые, по первой наблюдённой покупке');
    const values = [...(ui.$('.cg-st') as HTMLElement).querySelectorAll('.cg-st__kv .cg-st__v')];
    expect(values.at(-2)?.firstChild?.textContent).toBe('—');
    expect(ui.root.getElementById(values[0]?.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Данные на 09:18, охват неполный');
    expect(textOf(ui.$('.cg-st__foot'))).toBe('Данные на 09:18, охват неполный');
  });

  it('[SP-044] a day of the chart is its calendar date in any time zone, also east of UTC+12', () => {
    // The dates are the page's calendar days; the I18n port prints moments in its own zone.
    const now = Date.parse('2026-10-03T06:20:00Z');
    for (const timeZone of ['Europe/Moscow', 'UTC', 'America/Los_Angeles', 'Pacific/Pago_Pago', 'Etc/GMT+12', 'Asia/Kamchatka', 'Pacific/Tongatapu', 'Pacific/Kiritimati']) {
      const i18n = createI18n({ language: 'ru', now: () => now, timeZone });
      expect(['2026-09-04', '2026-09-30', '2026-10-01', '2026-10-03'].map((date) => statsDayName(i18n, date)), timeZone).toEqual(['4 сен', '30 сен', '1 окт', '3 окт']);
      // Another year carries its year, as every date of the port does.
      expect(statsDayName(i18n, '2025-12-31'), timeZone).toBe('31 дек 2025');
      expect(statsDayName(i18n, '2020-02-20'), timeZone).toBe('20 фев 2020');
    }
    expect(statsDayName(createI18n({ language: 'en', now: () => now, timeZone: 'Pacific/Kiritimati' }), '2026-09-04')).toBe(createI18n({ language: 'en', now: () => now, timeZone: 'UTC' }).formatTime('2026-09-04T12:00:00Z', 'day'));
  });

  it('a time zone is said by its offset from UTC at the data’s moment, never by the raw zone id', () => {
    const at = '2026-10-03T06:18:00Z';
    expect(zoneLabel('Europe/Moscow', at)).toBe('UTC+3');
    expect(zoneLabel('UTC', at)).toBe('UTC');
    expect(zoneLabel('America/Los_Angeles', at)).toBe('UTC−7');
    expect(zoneLabel('America/Los_Angeles', '2026-12-03T06:18:00Z')).toBe('UTC−8');
    expect(zoneLabel('Asia/Kolkata', at)).toBe('UTC+5:30');
    // A zone the browser does not know keeps its last word, readable.
    expect(zoneLabel('Mars/Olympus_Mons', at)).toBe('Olympus Mons');
  });

  it('percent changes read «+4%», «−12%», «0%»', () => {
    expect([4.4, -12.6, 0, 0.4].map(formatPct)).toEqual(['+4%', '−13%', '0%', '0%']);
  });

  it('the statistics failed: its own card, and the board next to it keeps working (stats-error)', async () => {
    ui = await mountBoardSettled('spenders', 'stats-error');
    expect(ui.$('.cg-st .cg-card')?.getAttribute('data-cg-code')).toBe('CG-DATA-UNAVAILABLE');
    expect(ui.$$('.cg-vlist__inner [data-cg-fan]').length).toBeGreaterThan(0);
    await flush(() => (ui?.$('.cg-st .cg-card .cg-btn') as HTMLElement).click());
    expect(ui.actions().at(-1)).toEqual({ type: 'ReloadView', selector: { of: 'spenders.stats' } });
  });
});
