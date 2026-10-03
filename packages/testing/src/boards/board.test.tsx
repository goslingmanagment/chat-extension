// The Spenders board and its statistics over FakeAppClient states (R15;
// ui-design §3.5, §4.14, §4.15, §6): what is drawn, what a click and a key
// dispatch, and what never appears (a colour on a fan, an empty list in place
// of an error). Texts are the shipped catalog's.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { MAX_DOM_ROWS, SEARCH_DEBOUNCE_MS } from '@cg/ui/kit';
import { BOARD_HEIGHTS, boardItems, formatPct, initialStop, nextStop, shelfLabel } from '@cg/ui/spenders';

import { board, button, cgError, ctxOf, entry, stats, views } from '../scenarios/app-client';
import { BOARD_FANS, boardShelves, manyFans } from './data';
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
  it('[SP-002] is a modal dialog named Spenders with the page name, period tabs and the search', async () => {
    ui = await mountBoardSettled('spenders', 'board-list');
    const dialog = ui.$('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Spenders');
    expect(ui.text('.cg-sp__title')).toBe('Spenders');
    expect(ui.text('.cg-sp__page')).toBe('LoraVie VIP');
    expect(ui.$$('[role="tablist"] [role="tab"]').map(textOf)).toEqual(['Всё время', '30 дней', 'Месяц', '7 дней', 'Сегодня']);
    expect(ui.$('[role="tab"][aria-selected="true"]')?.textContent).toBe('30 дней');
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

  it('«Закрыть Esc» closes the window; a period tab asks for that period', async () => {
    ui = await mountBoardSettled('spenders', 'board-list');
    const close = ui.$('.cg-sp__close') as HTMLElement;
    expect(textOf(close)).toBe('ЗакрытьEsc');
    await flush(() => close.click());
    expect(ui.actions().at(-1)).toEqual({ type: 'Navigate', to: { kind: 'surface', surface: 'spenders', open: false } });
    await flush(() => (ui?.$$('[role="tab"]')[3] as HTMLElement).click());
    expect(ui.actions().at(-1)).toEqual({ type: 'SetSpendersPeriod', period: '7d' });
  });

  it('[SP-042] the columns: the list is first and the widest, the statistics is the last column', async () => {
    ui = await mountBoardSettled('spenders', '11a');
    const columns = ui.$('.cg-sp__cols') as HTMLElement;
    expect(columns.classList.contains('is-preview')).toBe(true);
    expect([...columns.children].map((child) => child.className.split(' ')[0])).toEqual(['cg-bd', 'cg-pv', 'cg-st']);
    ui.unmount();
    ui = await mountBoardSettled('spenders', 'board-list');
    expect([...(ui.$('.cg-sp__cols') as HTMLElement).children].map((child) => child.className.split(' ')[0])).toEqual(['cg-bd', 'cg-st']);
  });
});

describe('Spenders board: shelves and rows', () => {
  it('[SP-009] filters carry their counts; the pressed one is «Все»', async () => {
    ui = await mountBoardSettled('spenders', 'board-list');
    const filters = ui.$$('.cg-sp__tools .cg-flt');
    expect(filters.map(textOf)).toEqual(['Все40', 'Ждут ответа12', 'Новые3']);
    expect(filters.map((filter) => filter.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    await flush(() => (filters[1] as HTMLElement).click());
    expect(ui.actions().at(-1)).toEqual({ type: 'SetSpendersFilter', filter: 'waiting' });
    expect(ui.text('.cg-bd__sortnote')).toBe('в полке по сумме');
  });

  it('[SP-020] the «мы / фан» and history filters stand in a second row', async () => {
    ui = await mountBoardSettled('spenders', boardOnly({ ...boardOf(ctx, BOARD_FANS), filters: board(ctx, views.ready()).filters }));
    const rows = ui.$$('.cg-sp__tools');
    expect(rows).toHaveLength(2);
    expect([...(rows[1] as HTMLElement).querySelectorAll('.cg-flt')].map((filter) => filter.firstChild?.textContent)).toEqual(['Мы писали', 'Фан писал', 'С перепиской', 'Без переписки']);
  });

  it('[SP-011] a shelf row carries its name from the tier bounds, its fans and its sums', async () => {
    ui = await mountBoardSettled('spenders', 'board-list');
    const shelves = ui.$$('.cg-vlist__inner [role="rowgroup"]');
    expect(shelves[0]?.getAttribute('aria-label')).toBe('$600+');
    expect(textOf(shelves[0]?.querySelector('.cg-bd__shelfname'))).toBe('$600+8');
    expect([...(shelves[0] as HTMLElement).querySelectorAll('.cg-bd__shelfsum')].map(textOf)).toEqual(['$78,690', '+$4,005']);
    expect(shelves[1]?.getAttribute('aria-label')).toBe('$350–600');
    // The shelf sum of the period is the only green in a shelf row: money that came in.
    expect(shelves[0]?.querySelectorAll('.cg-money')).toHaveLength(1);
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

  it('[SP-010] a cut shelf ends with «ещё N · показать», which reveals it', async () => {
    const vm = boardOf(ctx, BOARD_FANS);
    const cut = vm.shelves.map((shelf, index) => (index === 1 ? { ...shelf, rows: shelf.rows.slice(0, 2), collapsed: { hidden: 4, reveal: button('spenders.shelfMore', { type: 'RevealShelf', shelfId: shelf.id }) } } : shelf));
    ui = await mountBoardSettled('spenders', boardOnly({ ...vm, shelves: cut }));
    const more = ui.$('.cg-bd__morebtn') as HTMLElement;
    expect(textOf(more)).toBe('ещё 4 · показать');
    await flush(() => more.click());
    expect(ui.actions().at(-1)).toEqual({ type: 'RevealShelf', shelfId: 't350' });
  });

  it('[SP-012] [SP-013] a fan row: name, @handle, lifetime, the period as income, both ages', async () => {
    ui = await mountBoardSettled('spenders', 'board-list');
    expect(cells(row('b002'))).toEqual(['Hubert@hubert_plHubert @hubert_pl', 'are you awake? 😇', '$12,480', '+$320', '10 ч', '7 минФан ждёт ответа']);
    // A known zero is blank, an unknown age is «—»; money is whole dollars with a comma.
    expect(cells(row('b018')).slice(2)).toEqual(['$240', '', '30 д', '—']);
    expect(row('b002').querySelector('.cg-bd__per')?.getAttribute('aria-label')).toBe('плюс 320 долларов');
    expect(row('b002').getAttribute('role')).toBe('row');
  });

  it('[SP-013] an unknown amount is «—», never 0', async () => {
    const vm = boardOf(ctx, BOARD_FANS);
    const unknown = vm.shelves.map((shelf, index) => (index === 0 ? { ...shelf, rows: shelf.rows.map((item, n) => (n === 0 ? { ...item, lifetime: null, period: null } : item)) } : shelf));
    ui = await mountBoardSettled('spenders', boardOnly({ ...vm, shelves: unknown }));
    expect(cells(row('b001')).slice(2, 4)).toEqual(['—', '—']);
  });

  it('[SP-014] a new payer carries the word «новый»', async () => {
    ui = await mountBoardSettled('spenders', boardOnly(boardOf(ctx, BOARD_FANS.filter((fan) => fan.isNew === true))));
    const jake = row('b021');
    expect([...jake.querySelectorAll('.cg-bd__tag')].map(textOf)).toEqual(['новый']);
    // The word stands right after the name, before the @handle.
    expect(textOf(jake.querySelector('.cg-bd__who'))).toMatch(/^Jake Morrisonновый@jake\.m\.88/);
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

  it('[SP-016] the last message column says «Мы:» before ours', async () => {
    ui = await mountBoardSettled('spenders', 'board-list');
    expect(textOf(row('b005').querySelector('.cg-bd__last'))).toBe('Мы: you always know what to say 😌');
    expect(textOf(row('b004').querySelector('.cg-bd__last'))).toBe('ok that video was insane 🔥');
  });

  it('[SP-017] «фан ждёт ответа» is the bold age of «Фан писал» with its tooltip: no dot, no colour', async () => {
    ui = await mountBoardSettled('spenders', 'board-list');
    const ages = [...row('b002').querySelectorAll('.cg-bd__age')];
    expect(ages[1]?.classList.contains('is-wait')).toBe(true);
    expect(ages[0]?.classList.contains('is-wait')).toBe(false);
    const tip = ui.root.getElementById(ages[1]?.getAttribute('aria-describedby') ?? '');
    expect(tip?.textContent).toBe('Фан ждёт ответа');
    // We wrote last to Daniel: nothing is bold there.
    expect(row('b005').querySelector('.is-wait')).toBeNull();
    // No dot and no accent anywhere in the list: importance is ink and weight only (ui-design §1 п. 5).
    expect(ui.$$('.cg-bd .cg-dot, .cg-bd [data-accent-use], .cg-bd .cg-badge')).toEqual([]);
  });

  it('[SP-018] the two sort buttons: «Всё время ↓» is sorted, «Фан писал» asks for the other sort', async () => {
    ui = await mountBoardSettled('spenders', 'board-list');
    const headers = ui.$$('.cg-bd__colhead [role="columnheader"]');
    expect(headers.map((header) => header.getAttribute('aria-sort'))).toEqual([null, null, 'descending', null, null, 'none']);
    const sorts = ui.$$('.cg-bd__sort');
    expect(textOf(sorts[0])).toBe('Всё времяВсего ↓');
    expect(sorts[0]?.classList.contains('is-sorted')).toBe(true);
    await flush(() => (sorts[1] as HTMLElement).click());
    expect(ui.actions().at(-1)).toEqual({ type: 'SetSpendersSort', sort: 'fan-age' });
  });

  it('the narrow column has short headers ready: «Всего», «Мы», «Фан» (shown at ≤ 620 px by a container query)', async () => {
    ui = await mountBoardSettled('spenders', 'board-list');
    expect(ui.$$('.cg-bd__colhead .cg-lbl-short').map(textOf)).toEqual(['Всего', 'Мы', 'Фан']);
    const css = ui.root.adoptedStyleSheets.flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText)).join('\n');
    expect(css).toMatch(/@container cgboard \(max-width: 620px\)/);
    // The full label of the short «Мы» is its tooltip.
    const we = ui.$$('.cg-bd__colhead .cg-lbl-short')[1] as HTMLElement;
    expect(ui.root.getElementById(we.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Мы писали');
  });

  it('[SP-021] the footer: «40 из 40 фанов, охват полный», «данные на 09:18», and «Показано: 7» under a filter', async () => {
    ui = await mountBoardSettled('spenders', 'board-list');
    expect(ui.$$('.cg-bd > .cg-sp__foot span').map(textOf)).toEqual(['40 из 40 фанов, охват полный', 'данные на 09:18']);
    ui.unmount();
    const vm = boardOf(ctx, BOARD_FANS);
    ui = await mountBoardSettled('spenders', boardOnly({ ...vm, footer: { ...vm.footer, shown: 7 }, reset: button('spenders.filter.all', { type: 'ResetFilters', list: 'spenders' }) }));
    expect(ui.text('.cg-bd > .cg-sp__foot span')).toBe('40 из 40 фанов, охват полный. Показано: 7');
    await flush(() => (ui?.$('.cg-sp__line .cg-btn') as HTMLElement).click());
    expect(ui.actions().at(-1)).toEqual({ type: 'ResetFilters', list: 'spenders' });
  });

  it('[SP-021] the 1000-row cut is said in words, and a total the hub does not know is not invented', async () => {
    ui = await mountBoardSettled('spenders', 'board-1000');
    expect(ui.text('.cg-sp__line')).toBe('Показаны первые 1000 из 1340. Сузьте поиск или фильтр.');
    expect(ui.text('.cg-bd > .cg-sp__foot span')).toBe('1000 из 1340 фанов, охват неполный');
    ui.unmount();
    const vm = boardOf(ctx, BOARD_FANS);
    ui = await mountBoardSettled('spenders', boardOnly({ ...vm, footer: { ...vm.footer, total: null, stamp: { asOf: null, coverage: 'unknown' } } }));
    expect(ui.$$('.cg-bd > .cg-sp__foot span').map(textOf)).toEqual(['40 фанов, охват неизвестен']);
  });

  it('[SP-034] the keys footer of the model stands under the list', async () => {
    ui = await mountBoardSettled('spenders', boardOnly({ ...boardOf(ctx, BOARD_FANS), keys: board(ctx, views.ready()).keys }));
    expect(ui.$$('.cg-bd .cg-keys .cg-key').map(textOf)).toEqual(['/Имя или @handle', 'EscЗакрыть Esc']);
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
    expect(ui.text('.cg-bd > .cg-sp__foot span')).toBe('40 из 40 фанов, охват полный. Показано: 0');
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

  it('[SP-043] the board speaks the chosen language', async () => {
    ui = await mountBoardSettled('spenders', 'board-list', { language: 'en' });
    expect(ui.$$('.cg-sp__tools .cg-flt').map((filter) => filter.firstChild?.textContent)).toEqual(['All', 'Awaiting reply', 'New']);
    expect(ui.$$('.cg-bd > .cg-sp__foot span').map(textOf)).toEqual(['40 of 40 fans, full coverage', 'data as of 09:18']);
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

  it('[SP-033] the last row of a shelf is followed by the first row of the next one', () => {
    const items = boardItems(boardShelves(ctx, BOARD_FANS, null));
    const lastOfTop = items.findIndex((item) => item.kind === 'fan' && item.row.handle === 'spenders:b008');
    const next = items[nextStop(items, lastOfTop, 1)];
    expect(next?.kind === 'fan' ? next.row.handle : null).toBe('spenders:b009');
    expect(nextStop(items, initialStop(items), -1)).toBe(initialStop(items));
    expect(BOARD_HEIGHTS).toEqual({ header: 28, shelf: 34, gap: 10, fan: 36, more: 32 });
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

  it('[SP-049] S expands the statistics and collapses it back', async () => {
    ui = await mountBoardSettled('spenders', 'board-list');
    await flush(() => keydown(ui?.root.activeElement as HTMLElement, 's', { code: 'KeyS' }));
    expect(ui.actions().at(-1)).toEqual({ type: 'SetStatsExpanded', expanded: true });
    ui.unmount();
    ui = await mountBoardSettled('spenders', '11i');
    await flush(() => keydown(ui?.$('.cg-stx') as HTMLElement, 'ы', { code: 'KeyS' }));
    expect(ui.actions().at(-1)).toEqual({ type: 'SetStatsExpanded', expanded: false });
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
    expect(ui.text('.cg-bd > .cg-sp__foot span')).toBe(`1000 из 1000 фанов, охват полный. Показано: ${expected}`);
    // Said, not only printed (ui-design §6.2).
    expect(textOf(ui.$('[data-cg-live]'))).toBe(`Показано: ${expected}`);
    expect(ui.$$('.cg-vlist__inner [data-cg-fan]').length).toBeLessThanOrEqual(expected);
  });
});

describe('Spenders statistics', () => {
  it('[SP-044] the compact column: 30 days, today, 7 days with the change, payers, the average check', async () => {
    ui = await mountBoardSettled('spenders', 'board-list');
    const column = ui.$('.cg-st') as HTMLElement;
    expect(column.tagName).toBe('ASIDE');
    expect(column.getAttribute('aria-label')).toBe('Статистика');
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

  it('[SP-049] «Развернуть» and the expanded view with «Свернуть к списку»', async () => {
    ui = await mountBoardSettled('spenders', 'board-list');
    const expand = ui.$('.cg-st__head .cg-btn') as HTMLElement;
    expect(textOf(expand)).toBe('Развернуть');
    await flush(() => expand.click());
    expect(ui.actions().at(-1)).toEqual({ type: 'SetStatsExpanded', expanded: true });
    ui.unmount();

    ui = await mountBoardSettled('spenders', '11i');
    expect(ui.$('.cg-bd')).toBeNull();
    expect(ui.text('.cg-stx .cg-st__title')).toBe('Статистика, 30 дней');
    expect(ui.$$('.cg-stx__cell').map((cell) => [...cell.children].map(textOf))).toEqual([
      ['Сегодня', '$65', 'день ещё идёт'],
      ['7 дней', '$1,110', '+4% к прошлым 7 дням ($1,071)'],
      ['30 дней', '$4,670', '44 покупки'],
      ['Платящие', '20', 'средний чек $106'],
    ]);
    expect(ui.$$('.cg-stx__table thead th').map(textOf)).toEqual(['Полка', 'Фанов', 'Всё время', '30 дней']);
    expect(ui.$$('.cg-stx__table tbody tr').map((line) => [...line.children].map(textOf))[0]).toEqual(['$600+', '8', '$78,690', '$4,005']);
    expect(ui.text('.cg-stx__foot')).toBe('Данные на 09:18, охват полный. Часовой пояс: Europe/Moscow.');
    expect(ui.$$('.cg-stx .cg-spark__ax span').map(textOf)).toEqual(['4 сен', '18 сен', 'сегодня']);
    await flush(() => (ui?.$('.cg-stx__head .cg-btn') as HTMLElement).click());
    expect(ui.actions().at(-1)).toEqual({ type: 'SetStatsExpanded', expanded: false });
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
