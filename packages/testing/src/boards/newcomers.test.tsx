// «Новые» (R15; ui-design §3.6, §4.17, §10, §12 п. 5; H-7): the list of new,
// renewed and returning subscribers with the greeting status and the lease,
// and the card — the preview pane with Hi only. A colleague's lease shows no
// name and no countdown; Hi is one variant split into parts, each sent by its
// own click.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { GREETING_STATUSES, type NewcomerRowVM, type NewcomersVM, type PreviewVM } from '@cg/contracts';
import { MAX_DOM_ROWS, SEARCH_DEBOUNCE_MS } from '@cg/ui/kit';
import { windowText } from '@cg/ui/newcomers';

import { cgError, claimMine, ctxOf, entry, FANS, iso, MIN, msg, newcomerRow, views, type AppClientScenario } from '../scenarios/app-client';
import { flush, keydown, mountBoardSettled, textOf, type MountedBoard } from './harness';
import { boardScenario } from './states';
import { boardWorld } from './world';

let ui: MountedBoard | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
  vi.useRealTimers();
});

const ctx = ctxOf({ lang: 'ru', platform: 'mac' });
const row = (key: string): HTMLElement => ui?.$(`[data-cg-fan="newcomers:${key}"]`) as HTMLElement;
const status = (key: string): HTMLElement => row(key).querySelector('.cg-nc__st') as HTMLElement;

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
  it('[NF-001] [NF-002] a modal window «Новые» with the page, the persona Hi greets as, and «Закрыть Esc»', async () => {
    ui = await mountBoardSettled('newcomers', '13a');
    const dialog = ui.$('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Новые');
    expect(ui.text('.cg-sp__title')).toBe('Новые');
    expect(ui.text('.cg-sp__page')).toBe('LoraVie VIP');
    expect(ui.text('.cg-sp__note')).toBe('Hi здоровается от имени Лора · VIP');
    expect(ui.host.hasAttribute('data-dismissible-open')).toBe(true);
    await flush(() => (ui?.$('.cg-sp__close') as HTMLElement).click());
    expect(ui.actions().at(-1)).toEqual({ type: 'Navigate', to: { kind: 'surface', surface: 'newcomers', open: false } });
  });

  it('[NF-006] tabs «Поздороваться / Все», status filters with counts, the search and the window', async () => {
    vi.useFakeTimers();
    ui = await mountBoardSettled('newcomers', '13a');
    expect(ui.$$('.cg-sp__top [role="tab"]').map(textOf)).toEqual(['Поздороваться 2', 'Все 3']);
    await flush(() => (ui?.$$('.cg-sp__top [role="tab"]')[1] as HTMLElement).click());
    expect(ui.actions().at(-1)).toEqual({ type: 'SetNewcomersTab', tab: 'all' });
    const filters = ui.$$('.cg-nc .cg-flt');
    expect(filters.map(textOf)).toEqual(['Все3', 'Не поздоровались0', 'Бронь2', 'Отправляются0', 'Остановлены0', 'Поздоровались1']);
    expect(filters[0]?.getAttribute('aria-pressed')).toBe('true');
    await flush(() => (filters[2] as HTMLElement).click());
    expect(ui.actions().at(-1)).toEqual({ type: 'SetNewcomersFilter', filter: 'claimed' });

    const input = ui.$('.cg-sp__search input') as HTMLInputElement;
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
    const trigger = ui.$('.cg-nc .cg-menu-anchor .cg-btn') as HTMLElement;
    expect(trigger.querySelector('.cg-btn__t')?.textContent).toBe('48 часов');
    await flush(() => trigger.click());
    const items = ui.$$('.cg-nc [role="menuitemradio"]');
    expect(items.map((item) => item.querySelector('.cg-menu__t')?.textContent)).toEqual(['24 часа', '48 часов', '72 часа', '7 дней']);
    expect(items.map((item) => item.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false', 'false']);
    await flush(() => (items[3] as HTMLElement).click());
    expect(ui.actions().at(-1)).toEqual({ type: 'SetNewcomersWindow', hours: 168 });
    const i18n = boardWorld('13a').deps.i18n;
    expect([1, 24, 168, 200, 720].map((hours) => windowText(i18n, hours))).toEqual(['1 час', '24 часа', '7 дней', '200 часов', '30 дней']);
  });

  it('[NF-007] a row: the name over the @handle, who they are, when they subscribed, the greeting', async () => {
    ui = await mountBoardSettled('newcomers', '13a');
    expect(ui.$$('.cg-nc__colhead [role="columnheader"]').map(textOf)).toEqual(['Фан', 'Кто', 'Подписка', 'Приветствие']);
    expect([...row('n001').querySelectorAll('[role="cell"]')].map(textOf)).toEqual(['Tomasz Wiśniewski@tomwis', 'новый', '14 мин', 'бронь: вы']);
    expect([...row('n002').querySelectorAll('[role="cell"]')].map(textOf)).toEqual(['Jake Morrison@jake.m.88', 'продлил', '2 ч', 'поздоровались']);
    expect(row('n001').classList.contains('is-sel')).toBe(true);
    expect(ui.root.activeElement).toBe(row('n001'));
  });

  it('[NF-005] every greeting status in words: strong where it needs the eye, muted where it is done', async () => {
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
    const cells = ui.$$('.cg-nc__st');
    expect(cells.map(textOf)).toEqual(['не поздоровались', 'бронь: вы', 'бронь: другой чаттерКоллега здоровается. Бронь снимется сама, если ничего не отправит.', 'бронь: вы, в другой вкладке', 'отправлено 1 из 3', 'отправлено 1 из 3, остановлено', 'поздоровались']);
    expect(cells.map((cell) => cell.classList.contains('is-strong'))).toEqual([false, true, true, true, true, true, false]);
    expect(cells[4]?.querySelector('.cg-spin')).not.toBeNull();
    expect(cells[5]?.querySelector('.cg-dot--ink')).not.toBeNull();
    expect(cells[6]?.querySelector('.cg-ico')).not.toBeNull();
  });

  it('a colleague’s lease has no name and no countdown (ui-design §12 п. 5)', async () => {
    ui = await mountBoardSettled('newcomers', '13c');
    const lease = status('n003');
    expect(lease.firstChild?.textContent).toBe('бронь: другой чаттер');
    expect(textOf(row('n003'))).not.toMatch(/\d:\d\d/);
    expect(textOf(ui.$('.cg-ncw'))).not.toMatch(/Анна|ещё \d/);
    // Nothing in the window ticks for it.
    expect(ui.$$('.cg-ncw .cg-count')).toEqual([]);
  });

  it('[NF-012] a saved greeting draft is marked on its row; a stale one says so', async () => {
    ui = await mountBoardSettled(
      'newcomers',
      change('13a', (vm) => ({ ...vm, rows: vm.rows.map((item, index) => (index === 1 ? { ...item, hasDraft: true } : index === 2 ? { ...item, hasDraft: true, draftStale: true } : item)) })),
    );
    expect(textOf(row('n002').querySelector('.cg-nc__tag'))).toBe('черновик');
    expect(textOf(row('n003').querySelector('.cg-nc__tag'))).toBe('черновик устарел');
    expect(row('n001').querySelector('.cg-nc__tag')).toBeNull();
  });

  it('[NF-008] the scan shows its phase and progress in the header', async () => {
    ui = await mountBoardSettled('newcomers', change('13a', (vm) => ({ ...vm, scan: { stage: msg('common.loading'), done: 12, total: 40 } })));
    expect(textOf(ui.$('.cg-nc__scan'))).toBe('Загрузка…12 из 40');
    expect(ui.$('.cg-nc__scan')?.getAttribute('role')).toBe('status');
  });

  it('[NF-025] «Результат неполный» is said with why, above the rows that are there', async () => {
    ui = await mountBoardSettled('newcomers', change('13a', (vm) => ({ ...vm, view: views.partial({ kind: 'coverage', level: 'partial' }), incomplete: msg('common.coverage.partial'), footer: { ...vm.footer, stamp: { asOf: vm.footer.stamp.asOf, coverage: 'partial' } } })));
    const line = ui.$('.cg-nc__incomplete') as HTMLElement;
    expect([...line.children].map(textOf)).toEqual(['Результат неполный', 'охват неполный']);
    expect(ui.$$('.cg-nc .cg-vlist__inner [data-cg-fan]')).toHaveLength(3);
    expect(ui.text('.cg-nc > .cg-sp__foot span')).toBe('3 за 48 часов, охват неполный');
  });

  it('[NF-028] «AI ничего не отправляет сам» stands under the list and at the Hi button', async () => {
    ui = await mountBoardSettled('newcomers', '13a');
    expect(ui.$$('.cg-nc__hint p').map(textOf)).toEqual([
      'Здесь те, кто подписался, продлил подписку или вернулся за последние 48 часов. Пока вы здороваетесь, фан забронирован за вами, и другой чаттер не напишет ему одновременно с вами.',
      'AI ничего не отправляет сам: только по вашему нажатию.',
    ]);
    const hi = ui.$('.cg-pvb [data-cg-strip="hi"] .cg-act') as HTMLElement;
    expect(ui.root.getElementById(hi.getAttribute('aria-describedby') ?? '')?.textContent).toBe('AI ничего не отправляет сам: только по вашему нажатию.');
    expect(ui.$$('.cg-nc > .cg-sp__foot span').map(textOf)).toEqual(['3 за 48 часов, охват полный', 'данные на 09:18']);
  });

  it('[NF-004] the list while it loads, when it failed, and when nobody is in the window', async () => {
    ui = await mountBoardSettled('newcomers', 'gallery-loading');
    expect(ui.$('.cg-nc [role="status"][aria-busy="true"]')).not.toBeNull();
    ui.unmount();
    ui = await mountBoardSettled('newcomers', 'gallery-error');
    expect(ui.$('.cg-nc .cg-card')?.getAttribute('data-cg-code')).toBe('CG-DATA-UNAVAILABLE');
    expect(ui.$('.cg-nc .cg-vlist')).toBeNull();
    ui.unmount();
    ui = await mountBoardSettled('newcomers', 'gallery-empty');
    expect(ui.$('.cg-nc .cg-state--empty')).not.toBeNull();
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
    // The card has no × of its own and no Fix draft: only Hi, Tone and Split.
    expect(ui.$$('.cg-pv__head .cg-btn').map(textOf)).toEqual(['Открыть чат']);
    expect(ui.$('.cg-pv__draft')).toBeNull();
    expect(ui.$$('.cg-pvb .cg-act').map((button) => button.querySelector('.cg-act__t')?.textContent)).toEqual(['Hi', 'Тон', 'Split']);
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
