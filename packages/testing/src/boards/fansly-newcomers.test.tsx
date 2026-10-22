// «Новые фоловеры» on Fansly (R20 P10c; X59): what the greeting sends dispatch — one click, one fan, never a key,
// never a second send while one goes out. The controller's side is core/src/application/hosts/fansly/newcomers.test.ts.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { type NewcomersVM } from '@cg/contracts/vm';
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
  board.$$('.cg-nw__row').map((row) => [row.querySelector('.cg-nw__name'), row.querySelector('.cg-nw__meta'), row.querySelector('.cg-nw__st')].map(textOf).join(' | '));
const vmOf = (state: string): NewcomersVM => boardScenario(state).views.find((view) => view.selector.of === 'newcomers')?.vm as NewcomersVM;
const click = async (element: Element | null | undefined): Promise<void> => flush(() => (element as HTMLElement).click());
const button = (board: MountedBoard, scope: string, label: string): HTMLElement | undefined => board.$$(`${scope} button`).find((item) => textOf(item) === label);

describe('[host:fansly] «Новые фоловеры» on Fansly: the window (R20 P10a, X59)', () => {
  it('[X55] [host:fansly] J / K: the card follows once the keys stop; Enter on the card’s own row is «Сгенерировать» with an empty field, the field otherwise — never a send', async () => {
    vi.useFakeTimers();
    const base = boardScenario('13m');
    const list = vmOf('13m');
    const card = list.pass?.card ?? null;
    if (card === null || card.greeting === undefined || card.greeting === null) throw new Error('13m has a card with a greeting');
    const empty = { ...list, pass: { ...(list.pass as NonNullable<NewcomersVM['pass']>), card: { ...card, greeting: { ...card.greeting, text: '', ai: false, canSend: false, canInsert: false } } } };
    const board = await mountBoardSettled('fansly-newcomers', { ...base, views: base.views.map((view) => (view.selector.of === 'newcomers' ? entry({ of: 'newcomers' }, empty) : view)) });
    ui = board;
    const row = (at: number): HTMLElement => board.$$('.cg-nw__row')[at] as HTMLElement;
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
    await flush(() => keydown(drafted.$$('.cg-nw__row')[0] as HTMLElement, 'Enter', { code: 'Enter' }));
    expect(drafted.actions().slice(at)).toEqual([]);
    expect(drafted.root.activeElement).toBe(drafted.$('.cg-nc__field textarea'));
    expect(drafted.actions().some((action) => action.type === 'SendNewcomerGreeting')).toBe(false);
  });
});

describe('[host:fansly] «Новые фоловеры» on Fansly: the batch — generate for many, read in the list, send each by a click (X59)', () => {
  it('[X59] [NF-019] the drafts are read in the list, under each fan; each row’s own small «Отправить» sends that fan’s draft — one click, one fan, never the card opened, never a key', async () => {
    const board = await mount('13o');
    // One small send per draft row, the send blue; nothing sends them all.
    const sends = board.$$('.cg-fnw__rsend');
    expect(sends.map((button) => [textOf(button), button.classList.contains('cg-btn--send')])).toEqual([['Отправить', true], ['Отправить', true], ['Отправить', true]]);
    expect(board.$$('.cg-nw__batch button').map(textOf)).toEqual(['Очистить']);
    // A key on the list sends nothing.
    for (const code of ['Enter', 'Space', 'KeyS']) await flush(() => keydown(board.$$('.cg-nw__row')[1] as HTMLElement, code === 'Space' ? ' ' : code, { code }));
    expect(board.actionsOf('SendNewcomerGreeting')).toEqual([]);
    const opened = board.actionsOf('OpenPreview').length;
    await click(sends[1]);
    expect(board.actions().at(-1)).toEqual({ type: 'SendNewcomerGreeting', targetHandle: handle(2) });
    expect(board.actionsOf('OpenPreview')).toHaveLength(opened);
  });

  it('[X59] while one goes out its row says «Отправляем…» and its button waits; the one gone says «Отправлено» and has none', async () => {
    const board = await mount('13p');
    expect(rowTexts(board).slice(0, 2)).toEqual(['Tomasz W. | @tomasz_w · 14 мин назад | Отправлено', 'Leo | @leo.k · 41 мин назад | Отправляем…']);
    expect(board.$('.cg-nw__row .cg-nw__draft.is-sent')).not.toBeNull();
    const rows = board.$$('.cg-nw__row');
    expect(rows[0]?.querySelector('.cg-fnw__rsend')).toBeNull();
    expect(rows[1]?.querySelector('.cg-fnw__rsend')?.getAttribute('aria-busy')).toBe('true');
    expect(board.text('.cg-nw__batch .cg-nw__bst')).toBe('Готово 2 · отправлено 1');
  });

  it('[X59] [NF-024] a refused click says why in its row; a draft that cannot go as it is has its «Отправить» off with the reason', async () => {
    const base = boardScenario('13o');
    const vm = vmOf('13o');
    const rows = vm.rows.map((row) =>
      row.handle === handle(2) ? { ...row, send: { can: true, refused: { code: 'CG-FNEW-HISTORY', retryAt: null } } } : row.handle === handle(8) ? { ...row, send: { can: false, refused: null } } : row,
    );
    ui = await mountBoardSettled('fansly-newcomers', { ...base, views: [entry({ of: 'newcomers' }, { ...vm, rows })] });
    const leo = ui.$$('.cg-nw__row')[1] as HTMLElement;
    expect([leo.querySelector('.cg-nw__st')?.getAttribute('data-cg-code'), textOf(leo.querySelector('.cg-nw__st'))]).toEqual(['CG-FNEW-HISTORY', 'Не вышло: Переписка изменилась']);
    const alex = ui.$$('.cg-nw__row').find((row) => row.getAttribute('data-cg-key') === handle(8)) as HTMLElement;
    const off = alex.querySelector('.cg-fnw__rsend') as HTMLElement;
    expect(off.getAttribute('aria-disabled')).toBe('true');
    await click(off);
    expect(ui.actionsOf('SendNewcomerGreeting')).toEqual([]);
  });

  it('[X59] after the card’s own «Отправить →» the card moves on to the next draft of the batch', async () => {
    const board = await mount('13o');
    await click(button(board, '.cg-nc__gbar', 'Отправить →'));
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
