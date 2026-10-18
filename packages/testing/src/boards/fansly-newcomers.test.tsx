// «Новые фоловеры» on Fansly as drawn (R20 P10a–P10c; X57; ui-design §3.12): Fansly's own surface for the shared
// `NewcomersVM` with its `pass` — mounted as its chunk mounts it (the overlay's closed root, Fansly's profile and texts)
// over the gallery's states 13f–13p (13k and the queue's buttons: R20 P10b1; 13m, 13n — the card's greeting: R20 P10c;
// 13o, 13p — the batch's drafts and «Отправить N →»: X57). What is drawn and what is dispatched; the controller's side
// is core/src/application/hosts/fansly/newcomers.test.ts.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { type NewcomersVM } from '@cg/contracts/vm';
import { SEARCH_DEBOUNCE_MS } from '@cg/ui/kit';
import { nextDraft } from '@cg/ui/hosts/fansly/newcomers';
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

const PASS = 'pass:00000000-0000-4000-8000-000000000301';
const handle = (n: number): string => `${PASS}:${800000000000000000n + BigInt(n)}`;
const mount = async (state: string, language: 'ru' | 'en' = 'ru'): Promise<MountedBoard> => {
  ui = await mountBoardSettled('fansly-newcomers', state, { language });
  return ui;
};
/** A row as the person reads it: the name, «@handle · 14 мин назад», the status. */
const rowTexts = (board: MountedBoard): string[] =>
  board.$$('.cg-fnw__row').map((row) => [row.querySelector('.cg-fnw__name'), row.querySelector('.cg-fnw__meta'), row.querySelector('.cg-fnw__st')].map(textOf).join(' | '));
const vmOf = (state: string): NewcomersVM => boardScenario(state).views.find((view) => view.selector.of === 'newcomers')?.vm as NewcomersVM;
const click = async (element: Element | null | undefined): Promise<void> => flush(() => (element as HTMLElement).click());
const button = (board: MountedBoard, scope: string, label: string): HTMLElement | undefined => board.$$(`${scope} button`).find((item) => textOf(item) === label);

describe('[host:fansly] «Новые фоловеры» on Fansly: the window (R20 P10a, X57)', () => {
  it('[NF-001] [NF-002] [X57] the old window: «Новые фоловеры» over «@креатор», a window over a scrim; × and Esc close it, the search first', async () => {
    const board = await mount('13f');
    const dialog = board.$('[role="dialog"]') as HTMLElement;
    expect([dialog.getAttribute('aria-modal'), dialog.getAttribute('aria-label'), board.text('.cg-fnw__title'), board.text('.cg-fnw__creator'), board.text('.cg-fnw__page')]).toEqual(['true', 'Новые фоловеры', 'Новые фоловеры', '@lora_vie', 'LoraVie VIP']);
    // Not the whole page: a window of its own size over a scrim, as the old one.
    expect(dialog.classList.contains('cg-dialog--wide')).toBe(true);
    expect(board.$('.cg-scrim')).not.toBeNull();
    expect(board.host.hasAttribute('data-dismissible-open')).toBe(true);
    await click(board.$('.cg-fnw__close'));
    expect(board.actions().at(-1)).toEqual({ type: 'Navigate', to: { kind: 'surface', surface: 'newcomers', open: false } });
  });

  it('[NF-003] [X57] the period: «За 48 часов», from 1 hour to 30 days; the choice is the controller’s to remember', async () => {
    const board = await mount('13f');
    expect(board.text('.cg-fnw__period-box .cg-fnw__label')).toBe('За');
    const trigger = board.$('.cg-fnw__period') as HTMLElement;
    expect(trigger.querySelector('.cg-btn__t')?.textContent).toBe('48 часов');
    await click(trigger);
    const items = board.$$('[role="menuitemradio"]');
    expect(items.map(textOf)).toEqual(['1 час', '3 часа', '6 часов', '12 часов', '24 часа', '48 часов', '72 часа', '7 дней', '14 дней', '30 дней']);
    expect(items.find((item) => item.getAttribute('aria-checked') === 'true')?.textContent).toBe('48 часов');
    await click(items[3]);
    expect(board.actions().at(-1)).toEqual({ type: 'SetNewcomersWindow', hours: 12 });
  });

  it('[NF-003] [NF-006] scrolling requests the second page again after a period change to another 200-row pass', async () => {
    const base = boardScenario('13f');
    const vm = vmOf('13f');
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
      list.scrollTop = 7_000;
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

  it('[NF-005] [NF-007] a row: the picture or the initial, the name and the person’s own name for the fan, «@handle · how long ago», the status in words', async () => {
    const board = await mount('13f');
    expect(rowTexts(board)).toEqual([
      'Tomasz W. | @tomasz_w · 14 мин назад | Не писали',
      'Leo | @leo.k · 41 мин назад | Ждёт ответа',
      'Jake | @jake88 · 2 ч назад | В очереди',
      'Marco R. | @marco_r · 3 ч назад | Проверяем…',
      'Daniel | @dan_p · 5 ч назад | Нельзя написать',
      'Ryan T. | @ryan_t · 7 ч назад | Не удалось проверить',
      'Chris | @chris_77 · 9 ч назад | Переписка не проверена',
      'Alex M. (Алекс из Бостона) | @alex_m · 11 ч назад | Не писали',
    ]);
    expect(board.$$('.cg-fnw__row').map((row) => row.getAttribute('data-cg-check'))).toEqual(['ready', 'reply', 'pending', 'checking', 'dm-closed', 'failed', 'unverified', 'ready']);
    // The terracotta of «можно работать» only where the person can act; a spinner while the chat is being checked; no red.
    expect(board.$$('.cg-fnw__row .cg-fnw__st.is-act').map(textOf)).toEqual(['Не писали', 'Ждёт ответа', 'Не писали']);
    expect(board.$('[data-cg-check="checking"] .cg-spin')).not.toBeNull();
    expect(board.$$('.cg-fnw__row .cg-dot--danger')).toEqual([]);
    // No picture in this state: the initial.
    expect(board.$$('.cg-fnw__row .cg-fnw__ava').map(textOf).slice(0, 2)).toEqual(['T', 'L']);
    expect(board.$$('.cg-fnw__row img')).toEqual([]);
    const selected = board.$('.cg-fnw__row.is-sel') as HTMLElement;
    expect([selected.getAttribute('data-cg-check'), selected.getAttribute('aria-selected')]).toEqual(['ready', 'true']);
  });

  it('[X57] the fan’s picture: lazy, without a referrer, over the initial — the initial stays when it does not load', async () => {
    const board = await mount('13o');
    const img = board.$('.cg-fnw__row img') as HTMLImageElement;
    expect([img.getAttribute('loading'), img.getAttribute('decoding'), img.getAttribute('referrerpolicy'), img.getAttribute('alt')]).toEqual(['lazy', 'async', 'no-referrer', '']);
    expect(textOf(img.parentElement)).toBe('T');
    await flush(() => img.dispatchEvent(new Event('error')));
    expect(board.$('.cg-fnw__row')?.querySelector('img')).toBeNull();
    expect(textOf(board.$('.cg-fnw__row .cg-fnw__ava'))).toBe('T');
    // The card shows the same picture, larger.
    expect(board.$('.cg-fnc__head .cg-fnw__ava.is-card img')).not.toBeNull();
  });

  it('[NF-006] «К обработке / Все» with counts, the status filter with counts, the search; a row opens its card', async () => {
    vi.useFakeTimers();
    const board = await mount('13f');
    const tabs = board.$$('.cg-fnw__tabs [role="tab"]');
    expect(tabs.map(textOf)).toEqual(['К обработке 8', 'Все 10']);
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    await click(tabs[1]);
    expect(board.actions().at(-1)).toEqual({ type: 'SetNewcomersTab', tab: 'all' });
    // One status menu, as the old window's select.
    const status = board.$('.cg-fnw__filter') as HTMLElement;
    expect(textOf(status)).toBe('Все статусы 8');
    await click(status);
    const filters = board.$$('.cg-fnw__tools [role="menuitemradio"]');
    expect(filters.map(textOf)).toEqual(['Все статусы8', 'Не писали2', 'В очереди1', 'Ждёт ответа1', 'Не проверены4', 'Нельзя написать1', 'Уже писали0']);
    await click(filters[5]);
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

    await click(board.$$('.cg-fnw__row')[1]);
    expect(board.actions().at(-1)).toEqual({ type: 'OpenPreview', targetHandle: handle(2) });
  });

  it('[NF-008] the toolbar: the stage of the pass, «Пауза», «Проверить заново»; the dates in a quiet line', async () => {
    const board = await mount('13f');
    expect(board.text('[data-cg-stage]')).toBe('Уточняем переписку: осталось 2');
    expect(board.$('[data-cg-stage] .cg-spin')).not.toBeNull();
    expect(board.$$('.cg-fnw__bar button.cg-fnw__run').map(textOf)).toEqual(['Пауза']);
    expect(board.text('.cg-fnw__range')).toMatch(/^.+ — .+ · местное время$/);
    await click(board.$('.cg-fnw__refresh'));
    expect(board.actions().at(-1)).toEqual({ type: 'ReloadView', selector: { of: 'newcomers' } });
    board.unmount();
    ui = null;
    const loading = await mount('13j');
    expect(loading.text('[data-cg-stage]')).toBe('Загружаем фоловеров…');
  });

  it('[NF-009] [NF-010] [NF-011] the card: the profile, the conversation with the automation marked, «Открыть в Fansly ↗» in a new tab', async () => {
    const board = await mount('13f');
    const card = board.$('.cg-fnc') as HTMLElement;
    expect(textOf(card.querySelector('.cg-fnc__name'))).toBe('Tomasz W.');
    expect(textOf(card.querySelector('.cg-fnc__meta'))).toMatch(/^@tomasz_w · подписался 14 мин назад · проверен в \d\d:\d\d$/);
    // «Не писали» needs no words on the card: the list says it, the card shows the chat.
    expect(card.querySelector('.cg-fnc__verdict')).toBeNull();
    expect(textOf(card.querySelector('.cg-fnc__bio'))).toBe('Warsaw · photographer · here for the art 📷');
    const bubble = card.querySelector('.cg-fnc__msg') as HTMLElement;
    expect([bubble.classList.contains('is-own'), textOf(bubble.querySelector('.cg-fnc__auto'))]).toEqual([true, 'Автоматическое / массовое']);
    const link = card.querySelector('a.cg-fnc__open') as HTMLAnchorElement;
    expect([textOf(link), link.getAttribute('href'), link.target, link.rel]).toEqual(['Открыть в Fansly ↗', 'https://fansly.com/messages/900000000000000001', '_blank', 'noopener noreferrer']);
    // The person's own link: the window dispatches nothing for it and stays open.
    const before = board.actions().length;
    link.addEventListener('click', (event) => event.preventDefault(), { once: true });
    await flush(() => link.click());
    expect(board.actions().length).toBe(before);
    // No greeting in this state: nothing reaches the fan from it.
    expect(board.$$('.cg-fnc button').map(textOf)).not.toContain('Отправить →');
  });

  it('[NF-009] [NF-010] «Уже писали»: the proof folded; earlier messages on request; the cap of 750 said', async () => {
    const board = await mount('13g');
    const proof = board.$('.cg-fnc__proof') as HTMLDetailsElement;
    expect(proof.open).toBe(false);
    expect(textOf(proof.querySelector('summary'))).toMatch(/^Уже писали · /);
    expect(textOf(proof.querySelector('blockquote'))).toBe('hiii Sam! welcome 💕 what made you subscribe?');
    expect(board.$$('.cg-fnc .cg-fnc__msg').map((bubble) => bubble.classList.contains('is-own'))).toEqual([false, true, false, true, false, true]);
    await click(button(board, '.cg-fnc__older', 'Более ранние сообщения'));
    expect(board.actions().at(-1)).toEqual({ type: 'LoadOlder', targetHandle: handle(9) });
  });

  it('[FX-017] the list that was not read says so — with the reason and the way to «Fansly через вкладку» —, never «nobody new»', async () => {
    const board = await mount('13h');
    expect(board.$('[data-cg-list="failed"]')).not.toBeNull();
    expect(board.$('.cg-fnw__tools')).toBeNull();
    expect(board.text('[data-cg-list="failed"] .cg-codeline')).toBe('ChatGoose · CG-FAN-SESSION');
    expect(board.text('[data-cg-list="failed"] .cg-card__title')).toBe('Нет связи с Fansly');
    expect(board.text('.cg-fnw__hint2')).toMatch(/«Fansly через вкладку»/);
    expect(board.$('[data-cg-stage]')).toBeNull();
    expect(board.root.textContent).not.toMatch(/новых фоловеров нет/i);
    expect(board.$$('.cg-fnw__row')).toEqual([]);
    await click(button(board, '[data-cg-list="failed"]', 'Повторить'));
    expect(board.actions().at(-1)).toEqual({ type: 'ReloadView', selector: { of: 'newcomers' } });
  });

  it.each([
    { language: 'en' as const, price: 1700, text: 'Fansly won’t let you write: this fan takes paid messages only — $1.70 per message.' },
    { language: 'ru' as const, price: 405, text: 'Fansly не даёт написать: этот фан принимает только платные сообщения — $0.405 за сообщение.' },
    { language: 'ru' as const, price: null, text: 'Fansly не даёт написать: этот фан принимает только платные сообщения.' },
  ])('[FX-003] [FS-NEW-2] the paid-DM reason in $language, price $price mills; an unknown price keeps the existing reason', async ({ language, price, text }) => {
    const base = boardScenario('13i');
    const vm = vmOf('13i');
    const pass = vm.pass!;
    ui = await mountBoardSettled('fansly-newcomers', { ...base, views: [entry({ of: 'newcomers' }, { ...vm, pass: { ...pass, card: { ...pass.card!, dmPriceMills: price } } })] }, { language });
    expect(textOf(ui.$('.cg-fnc__why span'))).toBe(text);
  });

  it('[NF-025] [NF-008] «Результат неполный», the pause Fansly asked for; a fan nobody can write to says why', async () => {
    const board = await mount('13i');
    expect(board.text('.cg-nc__incomplete')).toBe('Результат неполный Проверка прошла не до конца: показаны не все, кто подписался за это время.');
    expect(board.text('.cg-fnw__cool')).toBe('Fansly ограничил частоту запросов. Пауза 45 с — проверка продолжится сама.');
    expect(board.text('.cg-fnc__verdict')).toMatch(/^Нельзя написатьFansly не даёт написать: этот фан принимает только платные сообщения — \$1\.70 за сообщение\.Исключить из очереди/);
  });

  it('[NF-038] the queue’s buttons (R20 P10b1): «Пауза» while it runs; «Проверить оставшихся: N» and «Проверить чат» while it stands — each one action', async () => {
    const running = await mount('13f');
    await click(button(running, '.cg-fnw__bar', 'Пауза'));
    expect(running.actions().at(-1)).toEqual({ type: 'SetNewcomersPassRunning', running: false });
    expect(running.$$('.cg-fnc button').map(textOf)).not.toContain('Проверить следующим');
    running.unmount();
    ui = null;

    const board = await mount('13k');
    expect(board.$$('button.cg-fnw__run').map(textOf)).toEqual(['Проверить оставшихся: 2']);
    await click(board.$('button.cg-fnw__run'));
    expect(board.actions().at(-1)).toEqual({ type: 'SetNewcomersPassRunning', running: true });
    await click(button(board, '.cg-fnc__check', 'Проверить чат'));
    expect(board.actions().at(-1)).toEqual({ type: 'CheckNewcomerNext', targetHandle: handle(3) });
  });

  it('[FX-003] [FS-NEW-2] a fan nobody can write to (R20 P10b2): the reason, «Исключить из очереди»; taken out — «Вернуть в очередь» under «Все»; each one action', async () => {
    const closed = await mount('13i');
    expect(closed.$$('.cg-fnc__check button').map(textOf)).toEqual(['Исключить из очереди']);
    await click(closed.$('.cg-fnc__check button'));
    expect(closed.actions().at(-1)).toEqual({ type: 'ExcludeNewcomer', targetHandle: handle(5), excluded: true });
    closed.unmount();
    ui = null;

    const board = await mount('13l');
    expect(board.text('.cg-fnc__verdict')).toBe('Исключён · нельзя написатьFansly не даёт написать: модель не проходит правила фана для личных сообщений.Вернуть в очередь');
    await click(board.$('.cg-fnc__check button'));
    expect(board.actions().at(-1)).toEqual({ type: 'ExcludeNewcomer', targetHandle: handle(10), excluded: false });
    board.unmount();
    ui = null;
    const ready = await mount('13f');
    expect(ready.$$('.cg-fnc__check button').map(textOf)).not.toContain('Исключить из очереди');
  });

  it('[NF-012] [NF-019] [NF-028] [host:fansly] the card’s greeting (R20 P10c): the field in the AI serif, «AI» on an unchanged result, «Сгенерировать», «Открыть и вставить», «Отправить →» — blue, and it says AI sends nothing by itself', async () => {
    const board = await mount('13m');
    const greeting = board.$('.cg-fnc__greet') as HTMLElement;
    const field = greeting.querySelector('textarea') as HTMLTextAreaElement;
    expect([field.getAttribute('aria-label'), field.value.startsWith('Hey Tomasz!'), field.maxLength]).toEqual(['Личное сообщение', true, 5000]);
    expect(board.text('.cg-fnc__ai')).toBe('AI');
    expect(board.$$('.cg-fnc__gbar button').map(textOf)).toEqual(['Сгенерировать', 'Открыть и вставить', 'Отправить →']);
    // Blue only on what reaches the fan.
    expect(board.$$('.cg-fnc .cg-btn--send').map(textOf)).toEqual(['Отправить →']);
    const handleOf = handle(1);
    await click(button(board, '.cg-fnc__gbar', 'Отправить →'));
    expect(board.actions().at(-1)).toEqual({ type: 'SendNewcomerGreeting', targetHandle: handleOf });
    await click(button(board, '.cg-fnc__gbar', 'Открыть и вставить'));
    expect(board.actions().at(-1)).toEqual({ type: 'InsertNewcomerGreeting', targetHandle: handleOf });
    await click(button(board, '.cg-fnc__gbar', 'Сгенерировать'));
    expect(board.actions().at(-1)).toEqual({ type: 'Generate', targetHandle: handleOf, feature: 'hi', options: {} });
    await flush(() => {
      field.value = 'Hey Tomasz!';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(board.actions().at(-1)).toEqual({ type: 'SetPreviewDraft', targetHandle: handleOf, text: 'Hey Tomasz!' });
  });

  it('[X55] [host:fansly] J / K: the card follows once the keys stop; Enter on the card’s own row is «Сгенерировать» with an empty field, the field otherwise — never a send', async () => {
    vi.useFakeTimers();
    const base = boardScenario('13m');
    const list = vmOf('13m');
    const card = list.pass?.card ?? null;
    if (card === null || card.greeting === undefined || card.greeting === null) throw new Error('13m has a card with a greeting');
    const empty = { ...list, pass: { ...(list.pass as NonNullable<NewcomersVM['pass']>), card: { ...card, greeting: { ...card.greeting, text: '', ai: false, canSend: false, canInsert: false } } } };
    const board = await mountBoardSettled('fansly-newcomers', { ...base, views: base.views.map((view) => (view.selector.of === 'newcomers' ? entry({ of: 'newcomers' }, empty) : view)) });
    ui = board;
    const row = (at: number): HTMLElement => board.$$('.cg-fnw__row')[at] as HTMLElement;
    await flush(() => keydown(row(0), 'Enter', { code: 'Enter' }));
    expect(board.actions().at(-1)).toEqual({ type: 'Generate', targetHandle: handle(1), feature: 'hi', options: {} });
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
    expect(board.text('.cg-fnw__title')).toBe('New followers');
    expect(board.$$('.cg-fnw__tabs [role="tab"]').map(textOf)).toEqual(['To do 8', 'All 10']);
    expect(board.text('.cg-fnc__open')).toBe('Open in Fansly ↗');
    expect(rowTexts(board)[1]).toMatch(/^Leo \| @leo\.k · 41 min ago \| Waits for a reply$/);
  });
});

describe('[host:fansly] «Новые фоловеры» on Fansly: the batch — generate, read in the list, send (X57)', () => {
  it('[X57] tick a fan by its picture, or «Выбрать N» — the fans in view that can be written to; the bar says what is ticked and «Сгенерировать N»', async () => {
    const base = boardScenario('13o');
    const vm = vmOf('13o');
    // Before any batch: nobody ticked, no drafts yet.
    const fresh: NewcomersVM = {
      ...vm,
      rows: vm.rows.map((row) => ({ ...row, batch: { ...row.batch!, state: null, text: null } })),
      batch: { ...vm.batch!, ready: 0 },
      pass: { ...vm.pass!, batchSend: { ...vm.pass!.batchSend!, ready: 0 } },
    };
    ui = await mountBoardSettled('fansly-newcomers', { ...base, views: [entry({ of: 'newcomers' }, fresh)] });
    const board = ui;
    expect(board.$('.cg-fnw__batch')).toBeNull();
    // Only a fan who can be written to has the box: Jake (queued) has none.
    expect(board.$$('.cg-fnw__row .cg-fnw__pick[role="checkbox"]').map((box) => box.getAttribute('aria-label'))).toEqual(['Отметить для пакета: Tomasz W.', 'Отметить для пакета: Leo', 'Отметить для пакета: Alex M.']);
    // A click on the picture ticks the fan and never opens the card.
    await click(board.$('.cg-fnw__row .cg-fnw__pick[role="checkbox"]'));
    expect(board.actions().at(-1)).toEqual({ type: 'SetBatchPick', list: 'newcomers', targetHandles: [handle(1)], picked: true });
    expect(board.actionsOf('OpenPreview')).toEqual([]);
    const pickAll = board.$('.cg-fnw__pickall') as HTMLElement;
    expect(textOf(pickAll)).toBe('Выбрать 3');
    await click(pickAll);
    expect(board.actions().at(-1)).toEqual({ type: 'SetBatchPick', list: 'newcomers', targetHandles: [handle(1), handle(2), handle(8)], picked: true });
    // X on a row ticks it from the keyboard.
    await flush(() => keydown(board.$$('.cg-fnw__row')[1] as HTMLElement, 'x', { code: 'KeyX' }));
    expect(board.actions().at(-1)).toEqual({ type: 'SetBatchPick', list: 'newcomers', targetHandles: [handle(2)], picked: true });
    board.unmount();

    const picked: NewcomersVM = { ...fresh, rows: fresh.rows.map((row) => ({ ...row, batch: { ...row.batch!, picked: row.batch!.pickable } })), batch: { ...fresh.batch!, picked: 3 } };
    ui = await mountBoardSettled('fansly-newcomers', { ...base, views: [entry({ of: 'newcomers' }, picked)] });
    expect(ui.text('.cg-fnw__batch .cg-fnw__bn')).toBe('Выбрано 3');
    expect(ui.$('.cg-fnw__pickall')).toBeNull();
    await click(ui.$('.cg-fnw__go'));
    expect(ui.actions().at(-1)).toEqual({ type: 'GenerateBatch', list: 'newcomers' });
  });

  it('[X57] the drafts are read in the list, under each fan, in the draft’s look; «Отправить 3 →» is the bar’s one blue button — one action, never a key', async () => {
    const board = await mount('13o');
    expect(board.$$('.cg-fnw__row .cg-fnw__draft').map(textOf)).toEqual([
      'Hey Tomasz! So happy you’re here 💕 What made you follow me — the beach set or the gym pics?',
      'Leo! Sorry for the wait, babe 🙈 I saw your message — tell me a little about you?',
      'Hi Alex, welcome! Boston, right? 😊 I have a little surprise for my new followers…',
    ]);
    expect(board.text('.cg-fnw__batch .cg-fnw__bst')).toBe('Готово 3');
    const send = board.$('.cg-fnw__batchsend') as HTMLElement;
    expect([textOf(send), send.classList.contains('cg-btn--send')]).toEqual(['Отправить 3 →', true]);
    expect(board.text('.cg-fnw__bline.is-hint')).toBe('Прочтите черновики в списке — поправить можно в карточке справа');
    // A key on the list sends nothing.
    for (const code of ['Enter', 'Space', 'KeyS']) await flush(() => keydown(board.$$('.cg-fnw__row')[1] as HTMLElement, code === 'Space' ? ' ' : code, { code }));
    expect(board.actionsOf('SendNewcomerGreetings')).toEqual([]);
    await click(send);
    expect(board.actions().at(-1)).toEqual({ type: 'SendNewcomerGreetings' });
  });

  it('[X57] while it sends: the fan going out says so, the one gone says «Отправлено», the bar counts and «Остановить» stops', async () => {
    const board = await mount('13p');
    expect(rowTexts(board).slice(0, 2)).toEqual(['Tomasz W. | @tomasz_w · 14 мин назад | Отправлено', 'Leo | @leo.k · 41 мин назад | Отправляем…']);
    expect(board.$('.cg-fnw__row .cg-fnw__draft.is-sent')).not.toBeNull();
    expect(board.text('.cg-fnw__batch .cg-fnw__bst')).toBe('Отправляем 1 из 3…');
    expect(board.$('.cg-fnw__batchsend')).toBeNull();
    await click(button(board, '.cg-fnw__batch', 'Остановить'));
    expect(board.actions().at(-1)).toEqual({ type: 'StopNewcomerGreetings' });
  });

  it('[X57] a run that stopped says at whom and why', async () => {
    const base = boardScenario('13o');
    const vm = vmOf('13o');
    const stopped: NewcomersVM = {
      ...vm,
      pass: { ...vm.pass!, batchSend: { ready: 2, running: false, current: null, sent: 0, total: 3, skipped: 0, stopped: { handle: handle(1), name: 'Tomasz W.', failure: { code: 'CG-SEND-UNCERTAIN', retryAt: null } } } },
    };
    ui = await mountBoardSettled('fansly-newcomers', { ...base, views: [entry({ of: 'newcomers' }, stopped)] });
    expect(ui.text('.cg-fnw__bline.is-stop')).toMatch(/^Остановлено на Tomasz W\.: .+/);
    expect(ui.$('.cg-fnw__bline.is-stop')?.getAttribute('data-cg-code')).toBe('CG-SEND-UNCERTAIN');
    // The hint to read the drafts gives way to the reason.
    expect(ui.$('.cg-fnw__bline.is-hint')).toBeNull();
  });

  it('[X57] after the card’s own «Отправить →» the card moves on to the next draft of the batch', async () => {
    const board = await mount('13o');
    await click(button(board, '.cg-fnc__gbar', 'Отправить →'));
    await flush();
    expect(board.actions().slice(-2)).toEqual([
      { type: 'SendNewcomerGreeting', targetHandle: handle(1) },
      { type: 'OpenPreview', targetHandle: handle(2) },
    ]);
    // The next draft is the next unsent one, round the list.
    const rows = vmOf('13o').rows;
    expect([nextDraft(rows, handle(2)), nextDraft(rows, handle(8)), nextDraft(rows, handle(3))]).toEqual([handle(8), handle(1), handle(8)]);
  });
});
