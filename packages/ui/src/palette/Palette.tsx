// The ⌘K palette (architecture.md §9.1, §10.2 PaletteVM, D-30; ui-design
// §3.8, §4.20, §6.1, §6.4; HK-036, CS-006, CS-012): one field over groups —
// actions for the open chat, running generations, chats from the lists the
// extension already loaded, accounts — and a footer that says where the chats
// were searched. The field is a combobox over a listbox: focus stays in the
// field, ↑ ↓ move the selection, Enter runs it, `?` on an empty field opens
// the cheatsheet. Every row carries the action its controller prepared; the
// palette dispatches it unchanged. Lists longer than 50 rows are virtual.
//
// Enter may open another fan's chat, and opening a chat marks it read on
// OnlyFans, so Enter runs only the row the person can see selected:
// - the selection is a row (its key), never a place in the list: when a
//   group loses or gains rows, it stays on its row;
// - when that row leaves the list, the selection falls to its neighbour and
//   the next Enter only takes it — the one after runs it;
// - while the field holds a query the list has not answered yet, Enter runs
//   nothing: the rows on screen answer an older query.

import { type JSX, type TargetedKeyboardEvent } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';

import { type I18n, type PaletteItemVM, type PaletteVM } from '@cg/contracts/vm';

import { Dialog, Icon, OverlayLayer, Spinner, TalkingMark, ViewState, VirtualList, hotkeyText, isComposing, useDispatch, useGeometry, useI18n, useNowFn, useRenderAfter, useView, type VirtualListHandle } from '../kit';
import { useOwnEchoes } from '../spenders/ownEchoes';

const GROUP_HEIGHT = 32;
const ITEM_HEIGHT = 34;
/** The dialog is at most 100vh − 140 px tall (ui-design §3.8); its field and footer take this much of it. */
const DIALOG_MARGIN_PX = 140;
const CHROME_PX = 48 + 36;
const LIST_MIN_PX = 120;

export type PaletteRow =
  | { readonly kind: 'group'; readonly key: string; readonly title: string }
  | { readonly kind: 'item'; readonly key: string; readonly item: PaletteItemVM; readonly option: number };

/** The groups as one flat list: a title row per group that has items, then its items; `option` numbers the items. */
export function paletteRows(i18n: I18n, groups: PaletteVM['groups']): PaletteRow[] {
  const rows: PaletteRow[] = [];
  let option = 0;
  for (const group of groups) {
    if (group.items.length === 0) continue;
    rows.push({ kind: 'group', key: `g:${group.id}`, title: i18n.text(group.title) });
    for (const item of group.items) {
      rows.push({ kind: 'item', key: `i:${group.id}:${item.id}`, item, option });
      option += 1;
    }
  }
  return rows;
}

/** The selected row of the palette: a row of the answer to `query`, by its key. */
export interface PaletteSelection {
  readonly query: string;
  /** null — the answer has no rows. */
  readonly key: string | null;
  readonly index: number;
  /** The row the person stood on left the list; the selection fell to its neighbour and waits to be taken. */
  readonly displaced: boolean;
}

/**
 * Where the selection stands in the rows as they are now (`keys`, in order).
 * A new query starts from its first row; the same query keeps the selected
 * row wherever it moved; a row that left hands the selection to the row now
 * in its place, marked `displaced`. Returns `previous` itself when nothing changed.
 */
export function resolveSelection(previous: PaletteSelection | null, query: string, keys: readonly string[]): PaletteSelection {
  if (previous === null || previous.query !== query || previous.key === null) {
    const first = keys[0] ?? null;
    return previous !== null && previous.query === query && previous.key === first ? previous : { query, key: first, index: 0, displaced: false };
  }
  const at = keys.indexOf(previous.key);
  if (at >= 0) return at === previous.index ? previous : { ...previous, index: at };
  const index = Math.max(0, Math.min(previous.index, keys.length - 1));
  return { query, key: keys[index] ?? null, index, displaced: keys.length > 0 };
}

/** A label cut into plain and matched pieces by the model's [start, end) ranges. */
export function matchPieces(label: string, match: PaletteItemVM['match']): { readonly text: string; readonly hit: boolean }[] {
  const pieces: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (const [start, end] of [...match].sort((a, b) => a[0] - b[0])) {
    const from = Math.max(at, Math.min(start, label.length));
    const to = Math.max(from, Math.min(end, label.length));
    if (from > at) pieces.push({ text: label.slice(at, from), hit: false });
    if (to > from) pieces.push({ text: label.slice(from, to), hit: true });
    at = to;
  }
  if (at < label.length) pieces.push({ text: label.slice(at), hit: false });
  return pieces;
}

function labelOf(i18n: I18n, item: PaletteItemVM): string {
  return typeof item.label === 'string' ? item.label : i18n.text(item.label);
}

/** «14 с» of a running generation, counted from its start once a second while shown. */
function Elapsed({ since }: { readonly since: number }): JSX.Element {
  const i18n = useI18n();
  const now = useNowFn()();
  const elapsed = Math.max(0, now - since);
  useRenderAfter(1000 - (elapsed % 1000));
  return <span class="cg-num">{i18n.t('common.seconds', { n: Math.floor(elapsed / 1000) })}</span>;
}

function Item({ row, selected, id, onPick, onRun }: { readonly row: Extract<PaletteRow, { kind: 'item' }>; readonly selected: boolean; readonly id: string; readonly onPick: () => void; readonly onRun: () => void }): JSX.Element {
  const i18n = useI18n();
  const { item } = row;
  const running = item.runningSince !== null;
  const label = labelOf(i18n, item);
  // «Reply для Theodore Whitfield»: a running generation names its fan in the label.
  const text = running && item.sublabel !== null ? i18n.t('palette.item.running', { feature: label, fan: item.sublabel }) : label;
  const keys = hotkeyText(item.hotkey);
  const reason = item.enabled ? null : item.reason === null ? i18n.t('common.unknown') : i18n.text(item.reason.text);
  let right: JSX.Element | string | null = null;
  if (reason !== null) right = reason;
  else if (item.runningSince !== null) right = <Elapsed since={item.runningSince} />;
  else if (keys !== null) right = <kbd>{keys.display}</kbd>;
  else if (item.money !== null && item.waitingSince !== null) right = i18n.t('palette.item.waiting', { money: { money: item.money }, age: { age: item.waitingSince } });
  else if (item.money !== null) right = i18n.formatMoneyMills(item.money);
  return (
    // The field keeps focus; a row is chosen by pointer or through aria-activedescendant.
    <div
      id={id}
      class={`cg-pal__item${selected ? ' is-sel' : ''}`}
      role="option"
      aria-selected={selected ? 'true' : 'false'}
      {...(item.enabled ? {} : { 'aria-disabled': 'true' as const })}
      data-cg-option={row.option}
      onPointerMove={onPick}
      onPointerDown={(event) => event.preventDefault()}
      onClick={onRun}
    >
      <span class="cg-pal__main">
        {running ? <Spinner /> : null}
        <b>
          {running && item.sublabel !== null ? text : matchPieces(label, item.match).map((piece, index) => (piece.hit ? <mark key={index}>{piece.text}</mark> : piece.text))}
        </b>
        {!running && item.sublabel !== null ? <span class="cg-pal__sub">{item.sublabel}</span> : null}
        {item.action.type === 'Navigate' && item.action.to.kind === 'chat' ? <TalkingMark handle={item.action.to.targetHandle} /> : null}
      </span>
      <span class="cg-pal__right cg-num">{right}</span>
    </div>
  );
}

function partialNote(view: PaletteVM['view']): boolean {
  return view.s === 'partial' && view.gaps.some((gap) => gap.kind === 'source-failed' || gap.kind === 'host-degraded');
}

export function Palette(): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const vm = useView({ of: 'palette' }).value;
  const viewportHeight = useGeometry().value.viewportHeight;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<VirtualListHandle>(null);
  const composing = useRef(false);
  const rows = useMemo(() => paletteRows(i18n, vm.groups), [vm.groups, i18n, i18n.language]);
  const options = useMemo(() => rows.filter((row): row is Extract<PaletteRow, { kind: 'item' }> => row.kind === 'item'), [rows]);
  const keys = useMemo(() => options.map((row) => row.key), [options]);
  const [stored, setStored] = useState<PaletteSelection | null>(null);
  // Derived at render, so a key pressed before the effect below has run still sees it.
  const selection = useMemo(() => resolveSelection(stored, vm.query, keys), [stored, vm.query, keys]);
  useEffect(() => {
    if (selection !== stored) setStored(selection);
  }, [selection, stored]);
  const current = selection.index;

  // The field shows the model's query unless the person is typing into it: an answer to an earlier query
  // never takes back what was typed since.
  const echo = useOwnEchoes(vm.query);
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (input !== null && !composing.current && input.value !== echo.shown) input.value = echo.shown;
  }, [vm.query, echo.shown]);

  const close = (): void => void dispatch({ type: 'Navigate', to: { kind: 'surface', surface: 'palette', open: false } });
  const search = (query: string): void => {
    // Firefox reports the text again after a composition ends: one query is asked once.
    if (query === echo.latest()) return;
    echo.sent(query);
    void dispatch({ type: 'Search', list: 'palette', query });
  };
  const run = (row: Extract<PaletteRow, { kind: 'item' }> | undefined): void => {
    if (row === undefined || !row.item.enabled) return;
    void dispatch(row.item.action);
  };
  /** The person chose a row (arrows, the pointer): the selection is theirs again. */
  const pick = (index: number): void => {
    const row = options[index];
    if (row === undefined) return;
    if (row.key !== selection.key || selection.displaced) setStored({ query: vm.query, key: row.key, index, displaced: false });
  };
  const select = (to: number): void => {
    if (options.length === 0) return;
    const next = (to + options.length) % options.length;
    pick(next);
    const index = rows.findIndex((row) => row.kind === 'item' && row.option === next);
    if (index >= 0) listRef.current?.scrollToIndex(index);
  };

  const onKeyDown = (event: TargetedKeyboardEvent<HTMLInputElement>): void => {
    if (composing.current || isComposing(event)) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        select(current + 1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        select(current - 1);
        return;
      case 'Home':
        if (event.currentTarget.value !== '') return;
        event.preventDefault();
        select(0);
        return;
      case 'End':
        if (event.currentTarget.value !== '') return;
        event.preventDefault();
        select(options.length - 1);
        return;
      case 'Enter':
        event.preventDefault();
        // The rows on screen answer `vm.query`. A field that holds a newer query is still waiting for its
        // answer: running the old list's row is not what the person asked for.
        if (event.currentTarget.value !== vm.query) return;
        // The selected row left the list under the person: this Enter takes its neighbour, the next one runs it.
        if (selection.displaced) {
          setStored({ ...selection, displaced: false });
          return;
        }
        run(options[current]);
        return;
      case '?':
        // `?` on an empty field: every key in one place.
        if (event.currentTarget.value !== '') return;
        event.preventDefault();
        void dispatch({ type: 'Navigate', to: { kind: 'surface', surface: 'cheatsheet', open: true } });
        return;
      case 'Escape':
        // Esc clears the field first; an empty field lets the dialog close.
        if (event.currentTarget.value === '') return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.value = '';
        search('');
        return;
      default:
    }
  };

  const note = partialNote(vm.view);
  const room = Math.max(LIST_MIN_PX, viewportHeight - DIALOG_MARGIN_PX - CHROME_PX - (note ? 32 : 0));
  // The list's own padding: 4 px above the rows, 8 px below.
  const listHeight = Math.min(room, rows.reduce((sum, row) => sum + (row.kind === 'group' ? GROUP_HEIGHT : ITEM_HEIGHT), 0) + 12);
  const listId = 'cg-pal-list';
  const activeId = options.length === 0 ? undefined : `cg-pal-opt-${current}`;
  const showRows = rows.length > 0 && vm.view.s !== 'error' && vm.view.s !== 'forbidden';

  return (
    <OverlayLayer>
      <Dialog open label={i18n.t('palette.label')} size="center" class="cg-pal" onClose={close} initialFocus={() => inputRef.current}>
        <div class="cg-pal__in">
          <Icon name="search" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label={i18n.t('palette.placeholder')}
            aria-expanded={showRows ? 'true' : 'false'}
            aria-controls={listId}
            aria-autocomplete="list"
            {...(activeId === undefined ? {} : { 'aria-activedescendant': activeId })}
            placeholder={i18n.t('palette.placeholder')}
            autocomplete="off"
            spellcheck={false}
            onInput={(event) => {
              if (!composing.current && !(event as unknown as InputEvent).isComposing) search(event.currentTarget.value);
            }}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={(event) => {
              composing.current = false;
              search(event.currentTarget.value);
            }}
            onKeyDown={onKeyDown}
          />
          <kbd>{i18n.t('common.key.esc')}</kbd>
        </div>
        {vm.view.s === 'offline' || (!showRows && vm.view.s !== 'ready' && vm.view.s !== 'partial') ? (
          <div class="cg-pal__state">
            <ViewState view={vm.view} />
          </div>
        ) : null}
        {showRows ? (
          <VirtualList
            items={rows}
            rowHeight={(row) => (row.kind === 'group' ? GROUP_HEIGHT : ITEM_HEIGHT)}
            getKey={(row) => row.key}
            height={listHeight}
            role="listbox"
            label={i18n.t('palette.label')}
            class="cg-pal__list"
            listRef={listRef}
            renderRow={(row) =>
              row.kind === 'group' ? (
                <div class="cg-pal__grp" role="presentation">
                  {row.title}
                </div>
              ) : (
                <Item row={row} selected={row.option === current} id={`cg-pal-opt-${row.option}`} onPick={() => pick(row.option)} onRun={() => run(row)} />
              )
            }
          />
        ) : null}
        {note ? (
          <div class="cg-pal__note" role="status">
            {i18n.t('palette.partial')}
          </div>
        ) : null}
        <div class="cg-pal__foot">
          <span>
            <kbd>↑↓</kbd>
            {i18n.t('palette.foot.select')}
          </span>
          <span>
            <kbd>↵</kbd>
            {i18n.t('palette.foot.run')}
          </span>
          <span>
            <kbd>?</kbd>
            {i18n.t('palette.foot.allKeys')}
          </span>
          {vm.footer === null ? null : <span class="cg-pal__where cg-num">{i18n.text(vm.footer)}</span>}
        </div>
      </Dialog>
    </OverlayLayer>
  );
}

export const PALETTE_CSS = `
.cg-pal__in { flex: none; display: flex; align-items: center; gap: 10px; height: 48px; padding: 0 14px; border-bottom: 1px solid var(--cg-rule); color: var(--cg-ink-muted); }
.cg-pal__in input { flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; background: none; font: inherit; font-size: var(--cg-text-xl); color: var(--cg-ink-strong); padding: 0; }
.cg-pal__in input::placeholder { color: var(--cg-ink-muted); opacity: 1; }
.cg-pal__in input:focus-visible { outline: none; }
.cg-pal__list { flex: 0 1 auto; padding: 4px 6px 8px; }
.cg-pal__list .cg-vlist__inner { width: auto; }
.cg-pal__grp { display: flex; align-items: flex-end; height: 32px; padding: 0 10px 4px; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
.cg-pal__item {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; height: 34px; padding: 0 10px;
  border-radius: 7px; color: var(--cg-ink); cursor: default;
}
.cg-pal__item.is-sel { background: var(--cg-hover); }
.cg-pal__item[aria-disabled="true"] { color: var(--cg-ink-faint); }
.cg-pal__main { display: flex; align-items: baseline; min-width: 0; white-space: nowrap; }
.cg-pal__main b { font-weight: 500; overflow: hidden; text-overflow: ellipsis; }
.cg-pal__main mark { background: none; color: var(--cg-ink-strong); font-weight: 600; text-decoration: underline; text-decoration-color: var(--cg-rule-3); text-underline-offset: 3px; }
.cg-pal__main .cg-spin { margin-right: 8px; align-self: center; }
.cg-pal__sub { color: var(--cg-ink-muted); margin-left: 8px; overflow: hidden; text-overflow: ellipsis; }
.cg-pal__right { color: var(--cg-ink-muted); white-space: nowrap; }
.cg-pal__note { flex: none; padding: 6px 14px; border-top: 1px solid var(--cg-rule); font-size: var(--cg-text-sm); color: var(--cg-ink-2); }
.cg-pal__state { flex: none; }
.cg-pal__foot { flex: none; display: flex; gap: 16px; padding: 8px 14px; border-top: 1px solid var(--cg-rule); font-size: var(--cg-text-sm); color: var(--cg-ink-muted); white-space: nowrap; }
.cg-pal__foot kbd { color: var(--cg-ink-2); margin-right: 4px; }
.cg-pal__where { margin-left: auto; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
@media (max-width: 520px) { .cg-pal__foot > span:not(.cg-pal__where):nth-child(n + 2) { display: none; } }
`;
