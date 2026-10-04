// The ⌘K palette and the ⌘1–9 quick jump (R15; ui-design §3.8, §4.20, §10;
// architecture.md §9.1, D-30): a combobox over a listbox of actions, running
// generations, chats from the lists already loaded and accounts; every row
// carries the action its controller prepared.

import { afterEach, describe, expect, it } from 'vitest';

import { type PaletteItemVM, type PaletteVM } from '@cg/contracts';
import { MAX_DOM_ROWS } from '@cg/ui/kit';
import { matchPieces, paletteRows, resolveSelection, type PaletteSelection } from '@cg/ui/palette';

import { ctxOf, entry, reason, type AppClientScenario } from '../scenarios/app-client';
import { manyFans, paletteChat } from './data';
import { flush, keydown, mountBoardSettled, settle, textOf, type MountedBoard } from './harness';
import { boardScenario } from './states';
import { boardWorld } from './world';

let ui: MountedBoard | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
});

const ctx = ctxOf({ lang: 'ru', platform: 'mac' });
const input = (): HTMLInputElement => ui?.$('.cg-pal__in input') as HTMLInputElement;
const options = (): HTMLElement[] => ui?.$$('.cg-pal [role="option"]') ?? [];
const selected = (): string => textOf(ui?.$('.cg-pal [role="option"][aria-selected="true"] .cg-pal__main'));

function withPalette(change: (vm: PaletteVM) => PaletteVM, state = '15a'): AppClientScenario {
  const base = boardScenario(state);
  return { ...base, views: base.views.map((view) => (view.selector.of === 'palette' ? entry({ of: 'palette' }, change(view.vm as PaletteVM)) : view)) };
}

describe('⌘K palette', () => {
  it('[HK-036] a modal dialog «Палитра команд»: the field is a combobox over a listbox and has the focus', async () => {
    ui = await mountBoardSettled('palette', '15a');
    const dialog = ui.$('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Палитра команд');
    expect(ui.$('.cg-scrim')).not.toBeNull();
    const field = input();
    expect(field.getAttribute('role')).toBe('combobox');
    expect(field.getAttribute('placeholder')).toBe('Команда или имя фана');
    expect(field.getAttribute('aria-controls')).toBe('cg-pal-list');
    expect(ui.root.activeElement).toBe(field);
    expect(ui.$('.cg-pal [role="listbox"]')).not.toBeNull();
    expect(field.getAttribute('aria-activedescendant')).toBe(options()[0]?.id);
    expect(ui.host.hasAttribute('data-dismissible-open')).toBe(true);
  });

  it('[CS-006] the groups: actions for the open chat, running generations, chats waiting in Spenders', async () => {
    ui = await mountBoardSettled('palette', '15a');
    expect(ui.$$('.cg-pal__grp').map(textOf)).toEqual(['Действия в чате с Hubert', 'Идут сейчас', 'Ждут ответа, из Spenders']);
    const rows = paletteRows(boardWorld('15a').deps.i18n, (boardScenario('15a').views[0]?.vm as PaletteVM).groups);
    expect(rows.filter((row) => row.kind === 'item').map((row) => (row.kind === 'item' && typeof row.item.label === 'string' ? row.item.label : row.kind === 'item' ? row.item.id : ''))).toEqual([
      'Reply',
      'Fix',
      'Hi',
      'Ping',
      'Review',
      'Recap',
      'Coach',
      'spenders',
      'newcomers',
      'tone',
      'split',
      'cheatsheet',
      'settings',
      'Reply',
      'Recap',
      'Hi',
      'Theodore Whitfield',
      'Hubert',
      'Marco Rinaldi',
      'Sebastian',
    ]);
    const first = options()[0] as HTMLElement;
    expect(textOf(first.querySelector('.cg-pal__main'))).toBe('Reply');
    expect(textOf(first.querySelector('kbd'))).toBe('⌘E');
    expect(textOf(options()[8])).toBe('Новые');
    expect(textOf(options()[11]?.querySelector('.cg-pal__main'))).toBe('Шпаргалка клавиш');
  });

  it('[CS-012] a running generation is a row with a spinner, «Reply для Theodore Whitfield» and its seconds', async () => {
    ui = await mountBoardSettled('palette', '15a');
    const running = options()[13] as HTMLElement;
    expect(running.querySelector('.cg-spin')).not.toBeNull();
    expect(textOf(running.querySelector('.cg-pal__main'))).toBe('Reply для Theodore Whitfield');
    expect(textOf(running.querySelector('.cg-pal__right'))).toBe('14 с');
  });

  it('a chat row: the name, the @handle, «$41,760, ждёт 6 мин»; a chat nobody waits in shows the money only', async () => {
    ui = await mountBoardSettled('palette', '15b');
    const chats = options().slice(-6);
    expect(textOf(chats[0]?.querySelector('.cg-pal__main'))).toBe('Theodore Whitfield@theo_whitfield');
    expect(textOf(chats[0]?.querySelector('.cg-pal__right'))).toBe('$41,760, ждёт 6 мин');
    expect(textOf(chats[2]?.querySelector('.cg-pal__right'))).toBe('$310');
    expect(ui.$$('.cg-pal__grp').map(textOf)).toEqual(['Действия в чате с Hubert', 'Идут сейчас', 'Чаты из загруженных списков']);
  });

  it('the match is underlined in the label, not painted', async () => {
    ui = await mountBoardSettled('palette', '15b');
    expect(input().value).toBe('re');
    expect(ui.$$('.cg-pal__item mark').slice(0, 3).map(textOf)).toEqual(['Re', 'Re', 'Re']);
    expect(matchPieces('Theodore Whitfield', [[6, 8]])).toEqual([
      { text: 'Theodo', hit: false },
      { text: 're', hit: true },
      { text: ' Whitfield', hit: false },
    ]);
    expect(matchPieces('Hubert', [])).toEqual([{ text: 'Hubert', hit: false }]);
    expect(matchPieces('ab', [[1, 9], [0, 1]])).toEqual([
      { text: 'a', hit: true },
      { text: 'b', hit: true },
    ]);
  });

  it('typing searches (no key is lost to a shortcut); Esc clears the field first, then closes', async () => {
    ui = await mountBoardSettled('palette', '15a');
    const field = input();
    await flush(() => {
      field.value = 'hub';
      field.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });
    expect(ui.actions().at(-1)).toEqual({ type: 'Search', list: 'palette', query: 'hub' });
    await flush(() => keydown(field, 'Escape'));
    expect(field.value).toBe('');
    expect(ui.actions().at(-1)).toEqual({ type: 'Search', list: 'palette', query: '' });
    await flush(() => keydown(field, 'Escape'));
    expect(ui.actions().at(-1)).toEqual({ type: 'Navigate', to: { kind: 'surface', surface: 'palette', open: false } });
  });

  it('an IME composition is not searched letter by letter, and its Enter runs nothing', async () => {
    ui = await mountBoardSettled('palette', '15a');
    const field = input();
    await flush(() => {
      field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      field.value = 'ひ';
      field.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
      keydown(field, 'Enter', { isComposing: true });
    });
    expect(ui.actions()).toEqual([]);
    await flush(() => {
      field.value = '日';
      field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    });
    expect(ui.actions()).toEqual([{ type: 'Search', list: 'palette', query: '日' }]);
  });

  it('↑ ↓ move the selection round, Enter runs the selected row with the action its controller prepared', async () => {
    ui = await mountBoardSettled('palette', '15a');
    const field = input();
    expect(selected()).toBe('Reply');
    await flush(() => keydown(field, 'ArrowDown'));
    await flush(() => keydown(field, 'ArrowDown'));
    expect(selected()).toBe('Hi');
    expect(field.getAttribute('aria-activedescendant')).toBe(ui.$('.cg-pal [role="option"][aria-selected="true"]')?.id);
    await flush(() => keydown(field, 'Enter'));
    expect(ui.actions().at(-1)).toEqual({ type: 'Generate', targetHandle: 'dock:b002', feature: 'hi', options: {} });
    await flush(() => keydown(field, 'ArrowUp'));
    await flush(() => keydown(field, 'ArrowUp'));
    await flush(() => keydown(field, 'ArrowUp'));
    // From the first row ↑ goes to the last one.
    expect(field.getAttribute('aria-activedescendant')).toBe('cg-pal-opt-19');
    // Focus never leaves the field.
    expect(ui.root.activeElement).toBe(field);
  });

  it('the selection is a row, not a place: when «Идут сейчас» loses a row above it, Enter still runs the row the person chose', async () => {
    const base = boardScenario('15a');
    const vm = base.views.find((view) => view.selector.of === 'palette')?.vm as PaletteVM;
    // A generation ends: its row leaves «Идут сейчас» and every row below moves one place up.
    const without = (id: string): PaletteVM => ({ ...vm, groups: vm.groups.map((group) => (group.id === 'running' ? { ...group, items: group.items.filter((item) => item.id !== id) } : group)) });
    ui = await mountBoardSettled('palette', { ...base, steps: [{ label: 'Reply for Theodore is done', at: 1_000, views: [entry({ of: 'palette' }, without('r1'))] }] });
    const field = input();
    // To the first chat: «Theodore Whitfield», the 17th row.
    for (let n = 0; n < 16; n += 1) await flush(() => keydown(field, 'ArrowDown'));
    expect(selected()).toBe('Theodore Whitfield@theo_whitfield');
    await flush(() => ui?.client.goTo(0));
    await settle();
    expect(options()).toHaveLength(19);
    // The place it stood on now holds Hubert; the selection stayed with Theodore.
    expect(selected()).toBe('Theodore Whitfield@theo_whitfield');
    expect(field.getAttribute('aria-activedescendant')).toBe(ui.$('.cg-pal [role="option"][aria-selected="true"]')?.id);
    await flush(() => keydown(field, 'Enter'));
    expect(ui.actions()).toEqual([{ type: 'Navigate', to: { kind: 'chat', targetHandle: 'palette:b001' } }]);
  });

  it('the selected row left the list: the selection falls to its neighbour, and the first Enter only takes it', async () => {
    const base = boardScenario('15a');
    const vm = base.views.find((view) => view.selector.of === 'palette')?.vm as PaletteVM;
    const gone: PaletteVM = { ...vm, groups: vm.groups.map((group) => (group.id === 'running' ? { ...group, items: group.items.filter((item) => item.id !== 'r2') } : group)) };
    ui = await mountBoardSettled('palette', { ...base, steps: [{ label: 'Recap for Marco is done', at: 1_000, views: [entry({ of: 'palette' }, gone)] }] });
    const field = input();
    for (let n = 0; n < 14; n += 1) await flush(() => keydown(field, 'ArrowDown'));
    expect(selected()).toBe('Recap для Marco Rinaldi');
    await flush(() => ui?.client.goTo(0));
    await settle();
    // The row that took its place is selected — «Hi для Jake Morrison», another fan's chat.
    expect(selected()).toBe('Hi для Jake Morrison');
    // An Enter already on its way to the row that left opens nobody's chat.
    await flush(() => keydown(field, 'Enter'));
    expect(ui.actions()).toEqual([]);
    expect(selected()).toBe('Hi для Jake Morrison');
    // The person saw the new selection and pressed again.
    await flush(() => keydown(field, 'Enter'));
    expect(ui.actions()).toEqual([{ type: 'Navigate', to: { kind: 'chat', targetHandle: 'dock:r3' } }]);
  });

  it('a selection the list moved is the person’s again once they move it themselves', async () => {
    const base = boardScenario('15a');
    const vm = base.views.find((view) => view.selector.of === 'palette')?.vm as PaletteVM;
    const gone: PaletteVM = { ...vm, groups: vm.groups.map((group) => (group.id === 'running' ? { ...group, items: group.items.filter((item) => item.id !== 'r2') } : group)) };
    ui = await mountBoardSettled('palette', { ...base, steps: [{ label: 'Recap for Marco is done', at: 1_000, views: [entry({ of: 'palette' }, gone)] }] });
    const field = input();
    for (let n = 0; n < 14; n += 1) await flush(() => keydown(field, 'ArrowDown'));
    await flush(() => ui?.client.goTo(0));
    await settle();
    await flush(() => keydown(field, 'ArrowUp'));
    expect(selected()).toBe('Reply для Theodore Whitfield');
    await flush(() => keydown(field, 'Enter'));
    expect(ui.actions()).toEqual([{ type: 'Navigate', to: { kind: 'chat', targetHandle: 'dock:r1' } }]);
  });

  it('Enter before the answer to the typed query runs nothing: the rows on screen answer an older query', async () => {
    const base = boardScenario('15a');
    const vm = base.views.find((view) => view.selector.of === 'palette')?.vm as PaletteVM;
    const marco = vm.groups.find((group) => group.id === 'waiting')?.items.find((item) => item.id === 'chat:b004') as PaletteItemVM;
    const answer: PaletteVM = { ...vm, query: 'marco', groups: [{ id: 'chats', title: { key: 'palette.group.chats' }, items: [{ ...marco, match: [[0, 5]] }] }] };
    ui = await mountBoardSettled('palette', { ...base, steps: [{ label: 'the answer for «marco»', at: 150, views: [entry({ of: 'palette' }, answer)] }] });
    const field = input();
    // The usual way to use a palette: type the name and press Enter at once.
    await flush(() => {
      field.value = 'marco';
      field.dispatchEvent(new InputEvent('input', { bubbles: true }));
      keydown(field, 'Enter');
    });
    // The first row on screen is still «Reply» of the open chat: it was not started.
    expect(selected()).toBe('Reply');
    expect(ui.actions()).toEqual([{ type: 'Search', list: 'palette', query: 'marco' }]);
    await flush(() => keydown(field, 'Enter'));
    expect(ui.actionsOf('Generate')).toEqual([]);
    // The answer arrived: Enter runs its first row.
    await flush(() => ui?.client.goTo(0));
    await settle();
    expect(field.value).toBe('marco');
    expect(selected()).toBe('Marco Rinaldi@marco.rinaldi');
    await flush(() => keydown(field, 'Enter'));
    expect(ui.actions().at(-1)).toEqual({ type: 'Navigate', to: { kind: 'chat', targetHandle: 'palette:b004' } });
    expect(ui.actions()).toHaveLength(2);
  });

  it('an answer to an earlier query never takes back what was typed since; a change from outside is taken', async () => {
    const base = boardScenario('15a');
    const vm = base.views.find((view) => view.selector.of === 'palette')?.vm as PaletteVM;
    const answer = (query: string) => entry({ of: 'palette' }, { ...vm, query });
    ui = await mountBoardSettled('palette', {
      ...base,
      steps: [
        { label: 'the answer for «ma»', at: 100, views: [answer('ma')] },
        { label: 'the answer for «marc»', at: 200, views: [answer('marc')] },
        { label: 'the palette was reset from outside', at: 300, views: [answer('')] },
      ],
    });
    const field = input();
    const type = async (text: string): Promise<void> =>
      flush(() => {
        field.value = text;
        field.dispatchEvent(new InputEvent('input', { bubbles: true }));
      });
    await type('ma');
    await type('marc');
    // The late answer for «ma»: the field keeps «marc», and Enter still waits for its answer.
    await flush(() => ui?.client.goTo(0));
    await settle();
    expect(field.value).toBe('marc');
    await flush(() => keydown(field, 'Enter'));
    expect(ui.actions()).toEqual([
      { type: 'Search', list: 'palette', query: 'ma' },
      { type: 'Search', list: 'palette', query: 'marc' },
    ]);
    await flush(() => ui?.client.goTo(1));
    await settle();
    expect(field.value).toBe('marc');
    // Not an echo of anything typed: the field follows the model.
    await flush(() => ui?.client.goTo(2));
    await settle();
    expect(field.value).toBe('');
    // The same text typed twice in a row is asked once (Firefox reports it again after a composition).
    await type('m');
    await type('m');
    expect(ui.actionsOf('Search')).toHaveLength(3);
  });

  it('resolveSelection: a new query starts from its first row; the same query keeps the row by its key', () => {
    const start = resolveSelection(null, '', ['a', 'b', 'c']);
    expect(start).toEqual({ query: '', key: 'a', index: 0, displaced: false });
    // Nothing changed: the same object, so nothing re-renders.
    expect(resolveSelection(start, '', ['a', 'b', 'c'])).toBe(start);
    const onC: PaletteSelection = { query: '', key: 'c', index: 2, displaced: false };
    // A row above left, a row above came: the selection stays on «c».
    expect(resolveSelection(onC, '', ['b', 'c'])).toEqual({ query: '', key: 'c', index: 1, displaced: false });
    expect(resolveSelection(onC, '', ['x', 'a', 'b', 'c'])).toEqual({ query: '', key: 'c', index: 3, displaced: false });
    // «c» left: the row now in its place, or the last one, marked as moved by the list.
    expect(resolveSelection(onC, '', ['a', 'b', 'd', 'e'])).toEqual({ query: '', key: 'd', index: 2, displaced: true });
    expect(resolveSelection(onC, '', ['a'])).toEqual({ query: '', key: 'a', index: 0, displaced: true });
    expect(resolveSelection(onC, '', [])).toEqual({ query: '', key: null, index: 0, displaced: false });
    // A moved selection stays marked while its row stays.
    const moved = resolveSelection(onC, '', ['a', 'b', 'd']);
    expect(resolveSelection(moved, '', ['b', 'd']).displaced).toBe(true);
    // Another query: its first row, whatever was selected.
    expect(resolveSelection(moved, 'ma', ['c', 'd'])).toEqual({ query: 'ma', key: 'c', index: 0, displaced: false });
    // Rows arrive for a query that had none: the first one, nothing was moved.
    expect(resolveSelection({ query: 'ma', key: null, index: 0, displaced: false }, 'ma', ['m1', 'm2'])).toEqual({ query: 'ma', key: 'm1', index: 0, displaced: false });
  });

  it('a click runs a row; an unavailable row says why and runs nothing', async () => {
    ui = await mountBoardSettled(
      'palette',
      withPalette((vm) => ({
        ...vm,
        groups: vm.groups.map((group, index) => (index === 0 ? { ...group, items: group.items.map((item, n) => (n === 1 ? { ...item, enabled: false, reason: reason('needs-draft') } : item)) } : group)),
      })),
    );
    await flush(() => (options()[7] as HTMLElement).click());
    expect(ui.actions().at(-1)).toEqual({ type: 'Navigate', to: { kind: 'surface', surface: 'spenders', open: true } });
    const fix = options()[1] as HTMLElement;
    expect(fix.getAttribute('aria-disabled')).toBe('true');
    expect(textOf(fix.querySelector('.cg-pal__right'))).toBe('сначала напишите черновик в поле ввода');
    const before = ui.actions().length;
    await flush(() => fix.click());
    expect(ui.actions()).toHaveLength(before);
  });

  it('[SP-001] [HK-039] [HK-041] the ways in are rows with their keys: Spenders ⌘⇧M, the fan panel ], settings ⌘,', async () => {
    ui = await mountBoardSettled(
      'palette',
      withPalette((vm) => ({
        ...vm,
        groups: vm.groups.map((group, index) => {
          const spenders = group.items.find((item) => item.id === 'spenders');
          if (index !== 0 || spenders === undefined) return group;
          const key = (display: string, aria: string): PaletteItemVM['hotkey'] => ({ display, aria, delivery: 'delivered', fallback: null });
          return {
            ...group,
            items: [
              spenders,
              { ...spenders, id: 'fan-panel', label: 'Панель фана', hotkey: key(']', 'BracketRight'), action: { type: 'Navigate', to: { kind: 'surface', surface: 'fan-panel', open: true } } },
              { ...spenders, id: 'settings', label: { key: 'palette.item.settings' }, hotkey: key('⌘,', 'Meta+Comma'), action: { type: 'OpenSettings', route: { section: 'status' } } },
            ],
          };
        }),
      })),
    );
    const rows = options().slice(0, 3);
    expect(rows.map((row) => [textOf(row.querySelector('.cg-pal__main')), textOf(row.querySelector('kbd'))])).toEqual([
      ['Spenders', '⌘⇧M'],
      ['Панель фана', ']'],
      ['Настройки ChatGoose', '⌘,'],
    ]);
    for (const row of rows) await flush(() => row.click());
    expect(ui.actions().slice(-3)).toEqual([
      { type: 'Navigate', to: { kind: 'surface', surface: 'spenders', open: true } },
      { type: 'Navigate', to: { kind: 'surface', surface: 'fan-panel', open: true } },
      { type: 'OpenSettings', route: { section: 'status' } },
    ]);
  });

  it('`?` on an empty field opens the cheatsheet; in a query it is a character', async () => {
    ui = await mountBoardSettled('palette', '15a');
    await flush(() => keydown(input(), '?'));
    expect(ui.actions().at(-1)).toEqual({ type: 'Navigate', to: { kind: 'surface', surface: 'cheatsheet', open: true } });
    ui.unmount();
    ui = await mountBoardSettled('palette', '15b');
    const event = keydown(input(), '?');
    expect(event.defaultPrevented).toBe(false);
    expect(ui.actions()).toEqual([]);
  });

  it('[CS-014] the footer: the keys and where the chats were searched', async () => {
    ui = await mountBoardSettled('palette', '15a');
    expect(ui.$$('.cg-pal__foot > span').map(textOf)).toEqual(['↑↓выбрать', '↵выполнить', '?все клавиши', 'Чаты: Spenders и Новые, 43 фана']);
    expect(ui.text('.cg-pal__in kbd')).toBe('Esc');
  });

  it('a missing list is said: not every chat can be found', async () => {
    ui = await mountBoardSettled('palette', 'gallery-partial');
    expect(ui.text('.cg-pal__note')).toBe('Часть списков не загружена: чаты найдены не все.');
    expect(options().length).toBeGreaterThan(0);
  });

  it('nothing matches, loading and a failure each look like what they are', async () => {
    ui = await mountBoardSettled('palette', 'gallery-empty');
    expect(ui.$('.cg-pal .cg-state--empty')).not.toBeNull();
    expect(input().getAttribute('aria-expanded')).toBe('false');
    ui.unmount();
    ui = await mountBoardSettled('palette', 'gallery-loading');
    expect(ui.$('.cg-pal [role="status"][aria-busy="true"]')).not.toBeNull();
    ui.unmount();
    ui = await mountBoardSettled('palette', 'gallery-error');
    expect(ui.$('.cg-pal .cg-card')?.getAttribute('data-cg-code')).toBe('CG-UNKNOWN');
    // The field still works: a new query is the retry.
    expect(ui.root.activeElement).toBe(input());
  });

  it('a thousand chats: the list is virtual', async () => {
    const chats = manyFans(1000).map((fan) => paletteChat(ctx, fan));
    ui = await mountBoardSettled(
      'palette',
      withPalette((vm) => ({ ...vm, groups: [{ id: 'chats', title: { key: 'palette.group.chats' }, items: chats }] })),
    );
    expect(options().length).toBeGreaterThan(5);
    expect(ui.$$('.cg-vlist__row').length).toBeLessThanOrEqual(MAX_DOM_ROWS);
    await flush(() => keydown(input(), 'ArrowUp'));
    expect(input().getAttribute('aria-activedescendant')).toBe('cg-pal-opt-999');
  });
});

describe('[NEW-07] quick jump ⌘1–9', () => {
  it('lists the chats of the visible list with their digits; it takes no focus and is not modal', async () => {
    ui = await mountBoardSettled('quick-jump', 'quick-jump');
    const popup = ui.$('.cg-qj') as HTMLElement;
    expect(popup.getAttribute('role')).toBe('dialog');
    expect(popup.getAttribute('aria-label')).toBe('Быстрый переход');
    expect(popup.hasAttribute('aria-modal')).toBe(false);
    expect(ui.root.activeElement).toBeNull();
    expect(ui.host.hasAttribute('data-dismissible-open')).toBe(false);
    expect(ui.$$('.cg-qj__item').map((item) => textOf(item.querySelector('.cg-pal__main')))).toEqual(['Hubert@hubert_pl2 новых', 'Theodore Whitfield@theo_w', 'Marco Rinaldi@marco_r']);
    expect(ui.$$('.cg-qj__item kbd').map(textOf)).toEqual(['1', '2', '3']);
    expect(ui.$('.cg-qj__item')?.classList.contains('is-unread')).toBe(true);
  });

  it('[HK-037] a click goes to that chat; with no chats it says so', async () => {
    ui = await mountBoardSettled('quick-jump', 'quick-jump');
    await flush(() => (ui?.$$('.cg-qj__item')[1] as HTMLElement).click());
    expect(ui.actions().at(-1)).toEqual({ type: 'Navigate', to: { kind: 'chat-slot', slot: 2 } });
    ui.unmount();
    ui = await mountBoardSettled('quick-jump', 'gallery-empty');
    expect(ui.text('.cg-qj .cg-state--empty')).toBe('Нет загруженных чатов для перехода');
  });
});
