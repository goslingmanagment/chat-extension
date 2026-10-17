// «Новые» on Fansly as drawn (R20 P10a; ui-design §3.6, §3.12, §4.17): Fansly's own surface for the shared
// `NewcomersVM` with its `pass` — mounted as its chunk mounts it (the overlay's closed root, Fansly's profile and texts)
// over the gallery's states 13f–13n (13k and the queue's buttons: R20 P10b1; 13m, 13n — the card's greeting: R20 P10c). What is drawn and what is dispatched; the controller's side is
// core/src/application/hosts/fansly/newcomers.test.ts.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { type NewcomersVM } from '@cg/contracts/vm';
import { SEARCH_DEBOUNCE_MS } from '@cg/ui/kit';
import { CARD_FOLLOW_MS } from '@cg/ui/newcomers';

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
    // One status menu, as on ChatSpace (and as the old window's select), not seven chips.
    expect(board.$$('.cg-nc .cg-flt')).toHaveLength(0);
    const status = board.$('.cg-nc .cg-nc__filter') as HTMLElement;
    expect(textOf(status)).toBe('Все статусы 8');
    await flush(() => status.click());
    const filters = board.$$('.cg-nc [role="menuitemradio"]');
    expect(filters.map(textOf)).toEqual(['Все статусы8', 'Не писали2', 'В очереди1', 'Ждёт ответа1', 'Не проверены4', 'Нельзя написать1', 'Уже писали0']);
    expect(filters[0]?.getAttribute('aria-checked')).toBe('true');
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

  it('[NF-008] the header: the stage of the pass; «Пауза» beside the filter; from when to when in the footer', async () => {
    const board = await mount('13f');
    expect(board.text('[data-cg-stage]')).toBe('Уточняем переписку: осталось 2');
    expect(board.$('[data-cg-stage] .cg-spin')).not.toBeNull();
    // R20 P10b1: the queue's «Пауза» stands in the filters' row; the dates go to the footer, no line of their own.
    expect(board.$('.cg-fnw__meta')).toBeNull();
    expect(board.$$('.cg-sp__tools button.cg-fnw__run').map(textOf)).toEqual(['Пауза']);
    expect(board.text('.cg-nc > .cg-sp__foot span')).toMatch(/^10 за 48 часов · .+ — .+ · местное время$/);
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
    // The error card says what failed; no title over it, no filters of an empty list, no second «Список не загружен» in the header.
    expect(board.$('.cg-fnw__failedTitle')).toBeNull();
    expect(board.$('.cg-nc .cg-sp__tools')).toBeNull();
    expect(board.text('[data-cg-list="failed"] .cg-codeline')).toBe('ChatGoose · CG-FAN-SESSION');
    expect(board.text('[data-cg-list="failed"] .cg-card__title')).toBe('Нет связи с Fansly');
    expect(board.text('.cg-fnw__hint2')).toMatch(/«Fansly через вкладку»/);
    expect(board.$('[data-cg-stage]')).toBeNull();
    expect(board.root.textContent).not.toMatch(/новых фоловеров нет/i);
    expect(board.$$('.cg-fnw__row')).toEqual([]);
    const retry = board.$$('[data-cg-list="failed"] button').find((button) => textOf(button) === 'Повторить') as HTMLElement;
    await flush(() => retry.click());
    expect(board.actions().at(-1)).toEqual({ type: 'ReloadView', selector: { of: 'newcomers' } });
  });

  it.each([
    { language: 'en' as const, price: 1700, text: 'Fansly won’t let you write: this fan takes paid messages only — $1.70 per message.' },
    { language: 'ru' as const, price: 405, text: 'Fansly не даёт написать: этот фан принимает только платные сообщения — $0.405 за сообщение.' },
    { language: 'ru' as const, price: null, text: 'Fansly не даёт написать: этот фан принимает только платные сообщения.' },
  ])('[FX-003] [FS-NEW-2] the paid-DM reason in $language, price $price mills; an unknown price keeps the existing reason', async ({ language, price, text }) => {
    const base = boardScenario('13i');
    const vm = base.views.find((view) => view.selector.of === 'newcomers')!.vm as NewcomersVM;
    const pass = vm.pass!;
    ui = await mountBoardSettled('fansly-newcomers', { ...base, views: [entry({ of: 'newcomers' }, { ...vm, pass: { ...pass, card: { ...pass.card!, dmPriceMills: price } } })] }, { language });
    expect(ui.text('.cg-fnc__why')).toBe(text);
  });

  it('[NF-025] [NF-008] «Результат неполный», the pause Fansly asked for; a fan nobody can write to says why', async () => {
    const board = await mount('13i');
    expect(board.text('.cg-nc__incomplete')).toBe('Результат неполныйПроверка прошла не до конца: показаны не все, кто подписался за это время.');
    expect(board.text('.cg-fnw__cool')).toBe('Fansly ограничил частоту запросов. Пауза 45 с — проверка продолжится сама.');
    expect(board.text('.cg-fnc__verdict')).toMatch(/^Нельзя написатьFansly не даёт написать: этот фан принимает только платные сообщения — \$1\.70 за сообщение\.Исключить из очереди/);
  });

  it('[NF-038] the queue’s buttons (R20 P10b1): «Пауза» while it runs; «Проверить оставшихся: N» and «Проверить чат» while it stands — each one action', async () => {
    const running = await mount('13f');
    const pause = running.$$('button.cg-fnw__run').find((button) => textOf(button) === 'Пауза') as HTMLElement;
    await flush(() => pause.click());
    expect(running.actions().at(-1)).toEqual({ type: 'SetNewcomersPassRunning', running: false });
    // A fan already checked has nothing to check.
    expect(running.$$('.cg-fnc button').map(textOf)).not.toContain('Проверить следующим');
    running.unmount();
    ui = null;

    const board = await mount('13k');
    expect(board.$$('button.cg-fnw__run').map(textOf)).toEqual(['Проверить оставшихся: 2']);
    await flush(() => (board.$('button.cg-fnw__run') as HTMLElement).click());
    expect(board.actions().at(-1)).toEqual({ type: 'SetNewcomersPassRunning', running: true });
    const check = board.$$('.cg-fnc__check button').find((button) => textOf(button) === 'Проверить чат') as HTMLElement;
    await flush(() => check.click());
    expect(board.actions().at(-1)).toEqual({ type: 'CheckNewcomerNext', targetHandle: 'pass:00000000-0000-4000-8000-000000000301:800000000000000003' });
  });

  it('[FX-003] [FS-NEW-2] a fan nobody can write to (R20 P10b2): the reason, «Исключить из очереди»; taken out — «Вернуть в очередь» under «Все»; each one action', async () => {
    const closed = await mount('13i');
    expect(closed.$$('.cg-fnc__check button').map(textOf)).toEqual(['Исключить из очереди']);
    await flush(() => (closed.$('.cg-fnc__check button') as HTMLElement).click());
    expect(closed.actions().at(-1)).toEqual({ type: 'ExcludeNewcomer', targetHandle: 'pass:00000000-0000-4000-8000-000000000301:800000000000000005', excluded: true });
    closed.unmount();
    ui = null;

    const board = await mount('13l');
    expect(board.text('.cg-fnc__verdict')).toBe('Исключён · нельзя написатьFansly не даёт написать: модель не проходит правила фана для личных сообщений.Вернуть в очередь');
    await flush(() => (board.$('.cg-fnc__check button') as HTMLElement).click());
    expect(board.actions().at(-1)).toEqual({ type: 'ExcludeNewcomer', targetHandle: 'pass:00000000-0000-4000-8000-000000000301:800000000000000010', excluded: false });
    // A fan who can be written to has neither button.
    board.unmount();
    ui = null;
    const ready = await mount('13f');
    expect(ready.$$('.cg-fnc__check button').map(textOf)).not.toContain('Исключить из очереди');
  });

  it('[NF-012] [NF-019] [NF-028] [host:fansly] the card’s greeting (R20 P10c): the field, «AI» on an unchanged result, «Сгенерировать», «Открыть и вставить», «Отправить →» — the only blue —, and the hint that AI sends nothing by itself', async () => {
    const board = await mount('13m');
    const greeting = board.$('.cg-fnc__greet') as HTMLElement;
    const field = greeting.querySelector('textarea') as HTMLTextAreaElement;
    expect([field.getAttribute('aria-label'), field.value.startsWith('Hey Tomasz!'), field.maxLength]).toEqual(['Личное сообщение', true, 5000]);
    expect(board.text('.cg-fnc__ai')).toBe('AI');
    expect(board.$$('.cg-fnc__gbar button').map(textOf)).toEqual(['Сгенерировать', 'Открыть и вставить', 'Отправить →']);
    // Blue only on what reaches the fan.
    expect(board.$$('.cg-fnc .cg-btn--send').map(textOf)).toEqual(['Отправить →']);
    expect(board.text('.cg-fnc__noauto')).toBe('AI ничего не отправляет автоматически: только по вашему нажатию.');
    const handle = 'pass:00000000-0000-4000-8000-000000000301:800000000000000001';
    const click = async (label: string): Promise<void> => flush(() => (board.$$('.cg-fnc__gbar button').find((button) => textOf(button) === label) as HTMLElement).click());
    await click('Отправить →');
    expect(board.actions().at(-1)).toEqual({ type: 'SendNewcomerGreeting', targetHandle: handle });
    await click('Открыть и вставить');
    expect(board.actions().at(-1)).toEqual({ type: 'InsertNewcomerGreeting', targetHandle: handle });
    await click('Сгенерировать');
    expect(board.actions().at(-1)).toEqual({ type: 'Generate', targetHandle: handle, feature: 'hi', options: {} });
    await flush(() => {
      field.value = 'Hey Tomasz!';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(board.actions().at(-1)).toEqual({ type: 'SetPreviewDraft', targetHandle: handle, text: 'Hey Tomasz!' });
  });

  it('[X55] [host:fansly] J / K: the card follows once the keys stop; Enter on the card’s own row is «Сгенерировать» with an empty field, the field otherwise — never a send', async () => {
    vi.useFakeTimers();
    const handle = 'pass:00000000-0000-4000-8000-000000000301:800000000000000001';
    const base = boardScenario('13m');
    const list = base.views.find((view) => view.selector.of === 'newcomers')?.vm as NewcomersVM;
    const card = list.pass?.card ?? null;
    if (card === null || card.greeting === undefined || card.greeting === null) throw new Error('13m has a card with a greeting');
    const empty = { ...list, pass: { ...(list.pass as NonNullable<NewcomersVM['pass']>), card: { ...card, greeting: { ...card.greeting, text: '', ai: false, canSend: false, canInsert: false } } } };
    const board = await mountBoardSettled('fansly-newcomers', { ...base, views: base.views.map((view) => (view.selector.of === 'newcomers' ? entry({ of: 'newcomers' }, empty) : view)) });
    ui = board;
    const row = (at: number): HTMLElement => board.$$('.cg-fnw__row')[at] as HTMLElement;
    await flush(() => keydown(row(0), 'Enter', { code: 'Enter' }));
    expect(board.actions().at(-1)).toEqual({ type: 'Generate', targetHandle: handle, feature: 'hi', options: {} });
    // J twice: the focus moves at once, one card is asked for once the keys stop.
    const before = board.actionsOf('OpenPreview').length;
    await flush(() => keydown(row(0), 'о', { code: 'KeyJ' }));
    await flush(() => keydown(board.root.activeElement as HTMLElement, 'о', { code: 'KeyJ' }));
    expect(board.root.activeElement).toBe(row(2));
    expect(board.actionsOf('OpenPreview').length).toBe(before);
    await flush(() => vi.advanceTimersByTime(CARD_FOLLOW_MS));
    expect(board.actionsOf('OpenPreview').slice(before)).toEqual([{ type: 'OpenPreview', targetHandle: row(2).getAttribute('data-cg-key') }]);
    ui.unmount();
    // The field has the draft: Enter starts nothing and gives the field the focus; «Отправить →» stays a click.
    const drafted = await mount('13m');
    const at = drafted.actions().length;
    await flush(() => keydown(drafted.$$('.cg-fnw__row')[0] as HTMLElement, 'Enter', { code: 'Enter' }));
    expect(drafted.actions().slice(at)).toEqual([]);
    expect(drafted.root.activeElement).toBe(drafted.$('.cg-fnc__field textarea'));
    expect(drafted.actions().some((action) => action.type === 'SendNewcomerGreeting')).toBe(false);
  });

  it('[NF-018] [NF-024] [host:fansly] a refused greeting names its reason — «Не отправлено», the code and its title; «Проверка изменилась — подтвердите черновик»', async () => {
    const board = await mount('13n');
    expect(board.text('.cg-fnc__gnote')).toBe('Проверка изменилась — подтвердите черновик');
    const state = board.$('.cg-fnc__gst') as HTMLElement;
    expect([state.getAttribute('data-cg-code'), textOf(state)]).toEqual(['CG-FNEW-HISTORY', 'Не отправленоChatGoose · CG-FNEW-HISTORY: Проверка изменилась']);
    expect(board.$$('.cg-fnc__gst .cg-dot--danger')).toHaveLength(1);
  });

  it('[NF-005] [I18-001] in English: the same window in the English words', async () => {
    const board = await mount('13f', 'en');
    expect(board.$$('.cg-sp__top [role="tab"]').map(textOf)).toEqual(['To do 8', 'All 10']);
    expect(board.text('.cg-fnc__open')).toBe('Open in Fansly ↗');
    expect(rowTexts(board)[1]).toMatch(/Waits for a reply$/);
  });
});
