// «Новые» on Fansly as drawn (R20 P10a; ui-design §3.6, §3.12, §4.17): Fansly's own surface for the shared
// `NewcomersVM` with its `pass` — mounted as its chunk mounts it (the overlay's closed root, Fansly's profile and texts)
// over the gallery's states 13f–13j. What is drawn and what is dispatched; the controller's side is
// core/src/application/hosts/fansly/newcomers.test.ts.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { type NewcomersVM } from '@cg/contracts/vm';
import { SEARCH_DEBOUNCE_MS } from '@cg/ui/kit';

import { entry } from '../scenarios/app-client';
import { flush, keydown, mountBoardSettled, textOf, type MountedBoard } from './harness';
import { boardScenario } from './states';

let ui: MountedBoard | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
  vi.useRealTimers();
});

const mount = async (state: string, language: 'ru' | 'en' = 'ru'): Promise<MountedBoard> => {
  ui = await mountBoardSettled('fansly-newcomers', state, { language });
  return ui;
};
const rowTexts = (board: MountedBoard): string[] => board.$$('.cg-fnw__row').map((row) => [...row.querySelectorAll('[role="cell"]')].map(textOf).join(' | '));

describe('[host:fansly] «Новые» on Fansly: the window (R20 P10a)', () => {
  it('[NF-001] [NF-002] a window «Новые» with the page’s name; «Закрыть Esc» and Esc close it, the search first', async () => {
    const board = await mount('13f');
    const dialog = board.$('[role="dialog"]') as HTMLElement;
    expect([dialog.getAttribute('aria-modal'), dialog.getAttribute('aria-label'), board.text('.cg-sp__title')]).toEqual(['true', 'Новые', 'Новые']);
    expect(board.text('.cg-sp__page')).toBe('LoraVie VIP');
    expect(board.host.hasAttribute('data-dismissible-open')).toBe(true);
    await flush(() => (board.$('.cg-sp__close') as HTMLElement).click());
    expect(board.actions().at(-1)).toEqual({ type: 'Navigate', to: { kind: 'surface', surface: 'newcomers', open: false } });
  });

  it('[NF-003] the period: 48 hours first, from 1 hour to 30 days', async () => {
    const board = await mount('13f');
    const trigger = board.$('.cg-fnw__period') as HTMLElement;
    expect(trigger.querySelector('.cg-btn__t')?.textContent).toBe('48 часов');
    await flush(() => trigger.click());
    const items = board.$$('[role="menuitemradio"]');
    expect(items.map(textOf)).toEqual(['1 час', '3 часа', '6 часов', '12 часов', '24 часа', '48 часов', '72 часа', '7 дней', '14 дней', '30 дней']);
    expect(items.find((item) => item.getAttribute('aria-checked') === 'true')?.textContent).toBe('48 часов');
    await flush(() => (items.at(-1) as HTMLElement).click());
    expect(board.actions().at(-1)).toEqual({ type: 'SetNewcomersWindow', hours: 720 });
  });

  it('[NF-003] [NF-006] scrolling requests the second page again after a period change to another 200-row pass', async () => {
    const base = boardScenario('13f');
    const vm = base.views.find((view) => view.selector.of === 'newcomers')!.vm as NewcomersVM;
    const page = (passId: string, windowHours: number): NewcomersVM => ({
      ...vm, windowHours, canLoadMore: true,
      rows: Array.from({ length: 100 }, (_, i) => ({ ...vm.rows[0]!, handle: `pass:${passId}:${800000000000000001n + BigInt(i)}`, selected: i === 0 })),
      pass: { ...vm.pass!, passId, total: 200, card: null },
    });
    const first = page('00000000-0000-4000-8000-000000000301', 48);
    const second = page('00000000-0000-4000-8000-000000000302', 720);
    ui = await mountBoardSettled('fansly-newcomers', {
      ...base,
      views: [entry({ of: 'newcomers' }, first)],
      steps: [
        { label: 'new period loading', at: 1, views: [entry({ of: 'newcomers' }, { ...second, rows: [], canLoadMore: false, view: { s: 'loading', stage: null, since: null } })] },
        { label: 'new pass, first 100 of 200', at: 2, views: [entry({ of: 'newcomers' }, second)] },
      ],
    });
    const board = ui;
    const scrollToEnd = async (): Promise<void> => flush(() => {
      const list = board.$('.cg-vlist') as HTMLElement;
      list.scrollTop = 4_000;
      list.dispatchEvent(new Event('scroll'));
    });
    await scrollToEnd();
    expect(board.actionsOf('LoadMore')).toHaveLength(1);
    // The same mounted window: a new pass has 100 rows again. Its scroll must reach the controller.
    await flush(() => board.client.goTo(0));
    await flush(() => board.client.goTo(1));
    await scrollToEnd();
    expect(board.actionsOf('LoadMore')).toHaveLength(2);
  });

  it('[NF-005] [NF-007] a row: the initial, the name and the person’s own name for the fan, @username, how long ago, the status in words — no colour', async () => {
    const board = await mount('13f');
    expect(rowTexts(board)).toEqual([
      'TTomasz W.@tomasz_w | 14 мин | Не писали',
      'LLeo@leo.k | 41 мин | Ждёт ответа',
      'JJake@jake88 | 2 ч | В очереди',
      'MMarco R.@marco_r | 3 ч | Проверяем…',
      'DDaniel@dan_p | 5 ч | Нельзя написать',
      'RRyan T.@ryan_t | 7 ч | Не удалось проверить',
      'CChris@chris_77 | 9 ч | Переписка не проверена',
      'AAlex M. (Алекс из Бостона)@alex_m | 11 ч | Не писали',
    ]);
    expect(board.$$('.cg-fnw__row').map((row) => row.getAttribute('data-cg-check'))).toEqual(['ready', 'reply', 'pending', 'checking', 'dm-closed', 'failed', 'unverified', 'ready']);
    // Strong only where the person can act; a spinner while the chat is being checked; no red, no remote picture.
    expect(board.$$('.cg-fnw__row .cg-nc__st.is-strong').map(textOf)).toEqual(['Не писали', 'Ждёт ответа', 'Не писали']);
    expect(board.$('[data-cg-check="checking"] .cg-spin')).not.toBeNull();
    expect(board.$$('.cg-fnw__row .cg-dot--danger, .cg-fnw__row img')).toEqual([]);
    expect(board.$('.cg-fnw__row.is-sel')?.getAttribute('data-cg-check')).toBe('ready');
  });

  it('[NF-006] «К обработке / Все» with counts, the status filters with counts, the search; a row opens its card', async () => {
    vi.useFakeTimers();
    const board = await mount('13f');
    expect(board.$$('.cg-sp__top [role="tab"]').map(textOf)).toEqual(['К обработке 8', 'Все 10']);
    await flush(() => (board.$$('.cg-sp__top [role="tab"]')[1] as HTMLElement).click());
    expect(board.actions().at(-1)).toEqual({ type: 'SetNewcomersTab', tab: 'all' });
    const filters = board.$$('.cg-nc .cg-flt');
    expect(filters.map(textOf)).toEqual(['Все статусы8', 'Не писали2', 'В очереди1', 'Ждёт ответа1', 'Не проверены4', 'Нельзя написать1', 'Уже писали0']);
    expect(filters[0]?.getAttribute('aria-pressed')).toBe('true');
    await flush(() => (filters[5] as HTMLElement).click());
    expect(board.actions().at(-1)).toEqual({ type: 'SetNewcomersCheckFilter', filter: 'dm-closed' });

    const input = board.$('.cg-sp__search input') as HTMLInputElement;
    await flush(() => keydown(board.root.activeElement as HTMLElement, '/', { code: 'Slash' }));
    expect(board.root.activeElement).toBe(input);
    await flush(() => {
      input.value = 'leo';
      input.dispatchEvent(new InputEvent('input', { bubbles: true }));
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    expect(board.actions().at(-1)).toEqual({ type: 'Search', list: 'newcomers', query: 'leo' });

    await flush(() => (board.$$('.cg-fnw__row')[1] as HTMLElement).click());
    expect(board.actions().at(-1)).toEqual({ type: 'OpenPreview', targetHandle: 'pass:00000000-0000-4000-8000-000000000301:800000000000000002' });
  });

  it('[NF-008] the header: the stage of the pass, whose followers and from when to when', async () => {
    const board = await mount('13f');
    expect(board.text('[data-cg-stage]')).toBe('Уточняем переписку: осталось 2');
    expect(board.$('[data-cg-stage] .cg-spin')).not.toBeNull();
    expect(board.text('.cg-fnw__meta')).toMatch(/^@lora_vie\d.+ — .+ · местное время$/);
    const loading = await (async () => {
      ui?.unmount();
      return mount('13j');
    })();
    expect(loading.text('[data-cg-stage]')).toBe('Загружаем фоловеров…');
  });

  it('[NF-009] [NF-010] [NF-011] the card: the profile, the verdict, the conversation with the automation marked, «Открыть в Fansly ↗» in a new tab', async () => {
    const board = await mount('13f');
    const card = board.$('.cg-fnc') as HTMLElement;
    expect(textOf(card.querySelector('.cg-fnc__name'))).toBe('Tomasz W.@tomasz_w');
    expect(textOf(card.querySelector('.cg-fnc__meta'))).toMatch(/^подписался 14 мин назад · проверен в \d\d:\d\d$/);
    expect(textOf(card.querySelector('.cg-fnc__verdict'))).toBe('Не писали');
    expect(textOf(card.querySelector('.cg-fnc__bio'))).toBe('Warsaw · photographer · here for the art 📷');
    const bubble = card.querySelector('.cg-feed__msg') as HTMLElement;
    expect([bubble.classList.contains('is-own'), textOf(bubble.querySelector('.cg-fnc__auto'))]).toEqual([true, 'Автоматическое / массовое']);
    const link = card.querySelector('a.cg-fnc__open') as HTMLAnchorElement;
    expect([textOf(link), link.getAttribute('href'), link.target, link.rel]).toEqual(['Открыть в Fansly ↗', 'https://fansly.com/messages/900000000000000001', '_blank', 'noopener noreferrer']);
    // The person's own link: the window dispatches nothing for it and stays open.
    const before = board.actions().length;
    link.addEventListener('click', (event) => event.preventDefault(), { once: true });
    await flush(() => link.click());
    expect(board.actions().length).toBe(before);
    // No send, no generation in this window (P10c): nothing reaches the fan from it.
    expect(board.$$('.cg-fnc button').map(textOf)).not.toContain('Отправить');
  });

  it('[NF-009] [NF-010] «Уже писали»: the proof folded; earlier messages on request; the cap of 750 said', async () => {
    const board = await mount('13g');
    const proof = board.$('.cg-fnc__proof') as HTMLDetailsElement;
    expect(proof.open).toBe(false);
    expect(textOf(proof.querySelector('summary'))).toMatch(/^Уже писали · /);
    expect(textOf(proof.querySelector('blockquote'))).toBe('hiii Sam! welcome 💕 what made you subscribe?');
    expect(board.$$('.cg-fnc .cg-feed__msg').map((bubble) => bubble.classList.contains('is-own'))).toEqual([false, true, false, true, false, true]);
    const older = board.$$('.cg-fnc .cg-feed__older button').find((button) => textOf(button) === 'Более ранние сообщения') as HTMLElement;
    await flush(() => older.click());
    expect(board.actions().at(-1)).toEqual({ type: 'LoadOlder', targetHandle: 'pass:00000000-0000-4000-8000-000000000301:800000000000000009' });
  });

  it('[FX-017] the list that was not read says so — with the reason and the way to «Fansly через вкладку» —, never «nobody new»', async () => {
    const board = await mount('13h');
    expect(board.$('[data-cg-list="failed"]')).not.toBeNull();
    expect(board.text('.cg-fnw__failedTitle')).toBe('Список не загружен — это сбой, а не пустой список.');
    expect(board.text('[data-cg-list="failed"] .cg-codeline')).toBe('ChatGoose · CG-FAN-SESSION');
    expect(board.text('[data-cg-list="failed"] .cg-card__title')).toBe('Нет связи с Fansly');
    expect(board.text('.cg-fnw__hint2')).toMatch(/«Fansly через вкладку»/);
    expect(board.text('[data-cg-stage]')).toBe('Список не загружен');
    expect(board.root.textContent).not.toMatch(/новых фоловеров нет/i);
    expect(board.$$('.cg-fnw__row')).toEqual([]);
    const retry = board.$$('[data-cg-list="failed"] button').find((button) => textOf(button) === 'Повторить') as HTMLElement;
    await flush(() => retry.click());
    expect(board.actions().at(-1)).toEqual({ type: 'ReloadView', selector: { of: 'newcomers' } });
  });

  it('[NF-025] [NF-008] «Результат неполный», the pause Fansly asked for; a fan nobody can write to says why', async () => {
    const board = await mount('13i');
    expect(board.text('.cg-nc__incomplete')).toBe('Результат неполныйПроверка прошла не до конца: показаны не все, кто подписался за это время.');
    expect(board.text('.cg-fnw__cool')).toBe('Fansly ограничил частоту запросов. Пауза 45 с — проверка продолжится сама.');
    expect(board.text('.cg-fnc__verdict')).toBe('Нельзя написатьFansly не даёт написать: этот фан принимает только платные сообщения.');
  });

  it('[NF-005] [I18-001] in English: the same window in the English words', async () => {
    const board = await mount('13f', 'en');
    expect(board.$$('.cg-sp__top [role="tab"]').map(textOf)).toEqual(['To do 8', 'All 10']);
    expect(board.text('.cg-fnc__open')).toBe('Open in Fansly ↗');
    expect(rowTexts(board)[1]).toMatch(/Waits for a reply$/);
  });
});
