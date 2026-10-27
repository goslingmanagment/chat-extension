// Menus (ui-design §4.1 «Ещё»; §6.1, §6.3, §6.4): a button with
// `aria-haspopup="menu"` and `aria-expanded`, a `role="menu"` list of
// `menuitem` / `menuitemradio` items. Opening focuses the checked item (or
// the first); ↑ ↓ Home End move, Enter and Space choose, Esc and choosing
// return focus to the button. Clicking or tabbing away closes it. The menu
// sits above its button (z 5 inside the dock), aligned to its left or right.

import { type ComponentChildren, type JSX, type TargetedFocusEvent, type TargetedKeyboardEvent } from 'preact';
import { useEffect, useId, useLayoutEffect, useRef } from 'preact/hooks';

import { useKit, useOffClick } from '../context';
import { focusQuietly, isHeldKey, rovingIndex } from '../focus';
import { useTooltip } from './Tooltip';

export interface MenuItem {
  readonly id: string;
  readonly label: string;
  /** Right column: a key label («⌘⇧B»), `ink-muted`. */
  readonly hint?: string;
  /** Right column as plain words («около 1,5 мин», «есть, 3 д назад»), `ink-muted`; with `hint` the hint wins. */
  readonly note?: string;
  /** A second line under the label (what the item does), `ink-muted`, wrapping: the menu widens to fit it. */
  readonly detail?: string;
  /** Radio menus mark the chosen item with ✓ and `aria-checked`. */
  readonly checked?: boolean;
  /** Unavailable items stay focusable and say why. */
  readonly reason?: string | null;
}

export interface MenuProps {
  readonly open: boolean;
  /** `menuitemradio` items (the window of «Новые», a select of the settings) or plain `menuitem` (Ещё). */
  readonly kind: 'radio' | 'action';
  readonly label: string;
  readonly items: readonly MenuItem[];
  readonly align?: 'start' | 'end';
  readonly placement?: 'top' | 'bottom';
  readonly onSelect: (id: string) => void;
  readonly onClose: (reason: 'escape' | 'select' | 'outside' | 'tab') => void;
  /** The trigger, to give focus back. */
  readonly returnFocusTo: () => HTMLElement | null;
  /** Focus the checked (or first) item on open (default); off for a menu shown without being opened by a person (the stand's gallery). */
  readonly autoFocus?: boolean;
  /** The item focused on open when none is checked (an action menu's likely choice: Enter takes it); absent — the first. */
  readonly focusId?: string;
  /** A quiet line under the items: where a setting behind them lives. Not an item: never focused or chosen. */
  readonly footer?: string;
}

export function Menu(props: MenuProps): JSX.Element | null {
  const { root, host } = useKit();
  const offClick = useOffClick();
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const { open, items: entries, onClose, returnFocusTo } = props;
  const autoFocus = props.autoFocus ?? true;

  // Before paint: the menu never shows with focus still on its button.
  useLayoutEffect(() => {
    if (!open || !autoFocus) return;
    const list = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-cg-menuitem]') ?? [])];
    const checked = entries.findIndex((item) => item.checked === true);
    const lead = checked >= 0 ? checked : entries.findIndex((item) => item.id === props.focusId);
    focusQuietly(list[lead >= 0 ? lead : 0]);
    // Only for the focus moment of opening; later changes of the items keep focus where it is.
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    // A press outside closes the menu. Inside our root the shadow listener sees the real target;
    // the document listener sees presses outside our host (a closed root shows only the host there).
    const inside = (event: Event): boolean => {
      const path = event.composedPath();
      const trigger = returnFocusTo();
      return (listRef.current !== null && path.includes(listRef.current)) || (trigger !== null && path.includes(trigger));
    };
    const onRootDown = (event: Event): void => {
      if (!inside(event)) onClose('outside');
    };
    // The one listener outside our root (architecture.md §10.1, the exception for an open layer):
    // passive, only while the menu is open, reads composedPath and never cancels anything.
    const onDocumentDown = (event: Event): void => {
      if (host === null || !event.composedPath().includes(host)) onClose('outside');
    };
    const document = 'ownerDocument' in root && root.ownerDocument !== null ? root.ownerDocument : root;
    root.addEventListener('pointerdown', onRootDown, true);
    if (root !== document) document.addEventListener('pointerdown', onDocumentDown, { capture: true, passive: true });
    return () => {
      root.removeEventListener('pointerdown', onRootDown, true);
      if (root !== document) document.removeEventListener('pointerdown', onDocumentDown, { capture: true });
    };
  }, [open, root, host, onClose, returnFocusTo]);

  if (!open) return null;

  const items = (): HTMLElement[] => [...(listRef.current?.querySelectorAll<HTMLElement>('[data-cg-menuitem]') ?? [])];
  const close = (reason: 'escape' | 'select' | 'outside' | 'tab', refocus: boolean): void => {
    props.onClose(reason);
    if (refocus) focusQuietly(props.returnFocusTo());
  };
  const choose = (item: MenuItem): void => {
    if (item.reason !== null && item.reason !== undefined && item.reason !== '') {
      offClick(item.label, item.reason);
      return;
    }
    props.onSelect(item.id);
    close('select', true);
  };

  const onKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close('escape', true);
      return;
    }
    if (event.key === 'Tab') {
      close('tab', false);
      return;
    }
    const list = items();
    const current = list.findIndex((element) => element === event.target);
    const next = rovingIndex(event.key, current, list.length, 'vertical');
    if (next !== null) {
      event.preventDefault();
      focusQuietly(list[next]);
    }
  };

  const onFocusOut = (event: TargetedFocusEvent<HTMLDivElement>): void => {
    const to = event.relatedTarget as Node | null;
    if (to !== null && listRef.current?.contains(to) === true) return;
    if (to !== null && to === props.returnFocusTo()) return;
    // Focus moved elsewhere (a click outside, another control): close without stealing focus back.
    if (to !== null) close('outside', false);
  };

  return (
    <div
      ref={listRef}
      class={`cg-menu cg-menu--${props.placement ?? 'top'} cg-menu--${props.align ?? 'start'}${props.items.some((item) => item.detail !== undefined) ? ' cg-menu--detailed' : ''}`}
      role="menu"
      aria-label={props.label}
      id={`cg-menu-${id}`}
      onKeyDown={onKeyDown}
      onFocusOut={onFocusOut}
    >
      {props.items.map((item) => (
        <MenuEntry key={item.id} item={item} kind={props.kind} onChoose={() => choose(item)} />
      ))}
      {props.footer === undefined ? null : <div class="cg-menu__foot">{props.footer}</div>}
    </div>
  );
}

function MenuEntry({ item, kind, onChoose }: { readonly item: MenuItem; readonly kind: 'radio' | 'action'; readonly onChoose: () => void }): JSX.Element {
  const unavailable = item.reason !== null && item.reason !== undefined && item.reason !== '';
  const tip = useTooltip(unavailable ? (item.reason ?? null) : null);
  return (
    <>
      <button
        type="button"
        class={`cg-menu__item${item.checked === true ? ' is-on' : ''}`}
        role={kind === 'radio' ? 'menuitemradio' : 'menuitem'}
        tabIndex={-1}
        data-cg-menuitem=""
        {...tip.props}
        {...(kind === 'radio' ? { 'aria-checked': item.checked === true ? 'true' : 'false' } : {})}
        {...(unavailable ? { 'aria-disabled': 'true' } : {})}
        onClick={onChoose}
        onKeyDown={(event) => {
          tip.props.onKeyDown(event);
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            // The repeat of the press that opened the menu lands here: it chooses nothing.
            if (!isHeldKey(event)) onChoose();
          }
        }}
      >
        <span class="cg-menu__t">{item.label}</span>
        {item.hint !== undefined ? <kbd>{item.hint}</kbd> : item.note === undefined ? null : <span class="cg-menu__n">{item.note}</span>}
        {item.detail === undefined ? null : <span class="cg-menu__d">{item.detail}</span>}
      </button>
      {tip.description}
    </>
  );
}

/** The anchor box a menu positions against: wrap the trigger and the Menu in it. */
export function MenuAnchor({ children }: { readonly children: ComponentChildren }): JSX.Element {
  return <span class="cg-menu-anchor">{children}</span>;
}

/** Trigger behaviour: Enter, Space and ↓ open the menu (ui-design §6.4). */
export function menuTriggerKeys(event: KeyboardEvent, open: () => void): void {
  if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (!isHeldKey(event)) open();
  }
}

export const MENU_CSS = `
.cg-menu-anchor { position: relative; display: inline-flex; flex: none; }
.cg-menu {
  position: absolute; z-index: 5; min-width: 200px; padding: 4px;
  background: var(--cg-raised); border: 1px solid var(--cg-rule-float); border-radius: var(--cg-r-lg);
  box-shadow: var(--cg-shadow-float); animation: cg-open 120ms var(--cg-ease);
  font-size: var(--cg-text-base); line-height: 18px; color: var(--cg-ink);
}
.cg-menu--top { bottom: calc(100% + 4px); }
.cg-menu--bottom { top: calc(100% + 4px); }
.cg-menu--start { left: 0; }
.cg-menu--end { right: 0; }
.cg-menu__item {
  display: flex; align-items: center; justify-content: space-between; gap: 16px; width: 100%; height: 30px; padding: 0 8px;
  border-radius: var(--cg-r-sm); color: var(--cg-ink); text-align: left; white-space: nowrap;
}
.cg-menu__item:hover, .cg-menu__item:focus-visible { background: var(--cg-hover); }
.cg-menu__item.is-on { background: var(--cg-clay-bg); color: var(--cg-clay-ink); font-weight: 600; }
.cg-menu__item.is-on::after { content: "✓"; color: var(--cg-clay-ink); font-size: var(--cg-text-sm); }
.cg-menu__item[aria-disabled="true"] { color: var(--cg-ink-faint); cursor: default; }
.cg-menu--detailed { width: 320px; }
.cg-menu--detailed .cg-menu__item { display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; height: auto; padding: 8px; white-space: normal; }
.cg-menu--detailed .cg-menu__t { font-weight: 600; }
.cg-menu__n { color: var(--cg-ink-muted); font-size: var(--cg-text-sm); font-weight: 400; }
.cg-menu__d { grid-column: 1 / -1; color: var(--cg-ink-muted); font-size: var(--cg-text-sm); line-height: 16px; font-weight: 400; }
${/* A chosen item of a detailed radio menu keeps its ✓ on its first line, after its note (Coach's depths), not on a line of its own. */ ''}
.cg-menu--detailed .cg-menu__n { justify-self: end; }
.cg-menu--detailed .cg-menu__item.is-on::after { grid-row: 1; grid-column: 2; justify-self: end; }
.cg-menu--detailed .cg-menu__item.is-on .cg-menu__n { grid-row: 1; grid-column: 2; margin-right: 18px; }
.cg-menu__foot { margin-top: 4px; padding: 6px 8px 4px; border-top: 1px solid var(--cg-rule); color: var(--cg-ink-faint); font-size: var(--cg-text-sm); line-height: 16px; }
@media (prefers-reduced-motion: reduce) { .cg-menu { animation: none; } }
`;
