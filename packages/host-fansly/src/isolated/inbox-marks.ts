// The marks of ours on the rows of Fansly's own list of chats.
//
// Who waits for a reply (2026-10-29). Fansly's row shows the text of the last message and never whose it is; MAIN says
// who has the last word in each chat (`fx.lastWord`, main/last-word.ts), and the person chose how it is shown
// (`settings.ext` → `setInboxMark`):
// - `dot`, the default: a muted terracotta dot on the top right of the avatar of a fan who has the last word. Fansly's
//   own online dot stands on the bottom right;
// - `we`: «Мы:» before the preview of a chat where the model has the last word, as a messenger says it;
// - `off`: nothing. Until the application says the choice, nothing either.
//
// Temporary chat pins (2026-11-12, `setPins`): only in the route's own list (`app-messages-route`), never the mini chat's
// - `pin`: a pinned chat's small badge with the pin glyph on the bottom left of the avatar, there from the row's first
//   frame, never taking the pointer;
// - `row`: the pin button, made for a row the first time the pointer comes over it, once MAIN says the chat is a direct
//   one with a known fan (`meta`). A child of the row's `app-messaging-group`, at a fixed place (right 10 px, top 22 px:
//   FBuddy makes rows taller) over a short fade of the row's hover colour; only the 28 px button takes the pointer, and
//   only while it is shown, so a click on the row's time or badge still opens the chat. Shown and hidden by one pair of
//   delegated listeners on the list (an inline opacity, 100 ms). Its click pins or unpins without opening the chat: the
//   press keeps the focus where it was, the click goes no further than the button, and only a person's click counts.
//
// The rows are Fansly's virtual list, `a[href="/messages/<groupId>"]` in `div.messages-list-wrapper`: they come and go
// as the person scrolls, and a row's parts are made anew when its chat changes. While any kind is wanted one observer,
// `childList + subtree` on that list alone, looks at its rows again after the page's change; changes of our own wake
// nothing — the strip's host (inbox-slot.ts) is ours too, and these cleanups never touch it. Each kind is drawn and taken
// away on its own: the marks off leave the pins, the pins off leave the marks. Our nodes are plain ones with inline
// styles (nothing global, FS-PLC-7), named by `data-cg-inbox`; nothing of the page's is changed, and they all go when
// nothing is wanted, the list is gone or the port is disposed. A leftover of a previous copy of the add-on goes at the
// first look at a list.

import type { FanslyLastWord } from '@cg/contracts/bridge-messages-fansly';
import type { FanslyChatMeta, FanslyRowPinsState } from '@cg/contracts/fansly';
import { FANSLY_PIN_GLYPH } from '@cg/contracts/fansly-pins';
import type { FanslyInboxMark } from '@cg/contracts/settings-ext';

import { INBOX_SLOT_HOST } from './inbox-slot';

export const INBOX_MARK_ATTRIBUTE = 'data-cg-inbox';

/** The row's parts the marks stand on: the avatar (positioned by Fansly itself) and the preview of the last message. */
const ROW_LINK = 'a[href^="/messages/"]';
const AVATAR = '.message-avatar app-account-avatar';
const PREVIEW = '.font-size-xs.eclipse';
const GROUP = 'app-messaging-group';
const GROUP_PATH = /^\/messages\/(\d+)$/;
const ROUTE = 'app-messages-route';

/** «оранж, но не яркий» (the owner, 2026-10-29): the family's terracotta, dimmed for Fansly's list. */
export const INBOX_DOT_COLOR = '#b9765d';
/** 8 px in a ring of the page's background: as large as Fansly's own online dot with its border (the owner: «чуть меньше»). */
const DOT_STYLE = `position:absolute;top:0;right:0;width:8px;height:8px;box-sizing:border-box;border-radius:50%;background:${INBOX_DOT_COLOR};box-shadow:0 0 0 2px var(--dark-1,#111215);pointer-events:none;z-index:2`;
const WE_STYLE = 'color:var(--font-tint-3,#9da2ad)';
export const INBOX_WE_TEXT = 'Мы:';
/** A pinned row's badge: 14 px on the bottom left of the avatar, in a ring of the page's background, never taking the pointer. */
const PIN_MARK_STYLE =
  'position:absolute;left:-2px;bottom:-2px;width:14px;height:14px;box-sizing:border-box;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--dark-3,#1a1e26);color:var(--font-1,#d6dce8);box-shadow:0 0 0 2px var(--dark-1,#111215);pointer-events:none;z-index:2';
/** The button's box: the row's right end, its whole height, faded into the row's hover colour; it never takes the pointer itself. */
const ROW_BOX_STYLE =
  'position:absolute;top:0;right:0;bottom:0;width:76px;box-sizing:border-box;border-radius:0 var(--border-radius-2,8px) var(--border-radius-2,8px) 0;background:linear-gradient(to right,transparent,var(--dark-3,#1a1e26) 30px);opacity:0;transition:opacity 100ms ease;pointer-events:none;z-index:3';
const ROW_BUTTON_STYLE =
  'position:absolute;right:10px;top:22px;width:28px;height:28px;box-sizing:border-box;margin:0;padding:0;border:0;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--dark-1,#111215);color:var(--font-tint-3,#9da2ad);cursor:pointer;outline:none;pointer-events:none;transition:color 100ms ease,background-color 100ms ease;-webkit-user-drag:none;user-select:none';
const BUTTON_HOVER = { color: 'var(--font-1,#d6dce8)', background: 'var(--dark-2,#191e26)' } as const;
const BUTTON_PINNED = 'var(--blue-1,#2699f7)';

export interface InboxMarks {
  /** The person's choice. */
  setMark(mark: FanslyInboxMark): void;
  /** MAIN's word of a chat; null — not known any more. */
  word(groupId: string, word: FanslyLastWord | null): void;
  /** Every word forgotten: MAIN says them all again after `fx.state`, or another creator logged in. */
  clear(): void;
  /** 2026-11-12: the pinned chats and the button's words; null — the pins are off (no marks, no buttons). */
  setPins(state: FanslyRowPinsState | null): void;
  /** The list of chats now on the page; null — none. */
  place(inbox: Element | null): void;
  /** For a test and the diagnostics: rows marked now. */
  marked(): number;
  dispose(): void;
}

export interface InboxMarksDeps {
  /** The chat of a row as MAIN knows it (cached by the port); null — not known. */
  meta(groupId: string): Promise<FanslyChatMeta | null>;
  /** A person's click on a row's pin button. */
  toggle(meta: FanslyChatMeta & { readonly fanId: string }): void;
}

const ours = (node: Node): boolean => {
  if (node.nodeType !== 1) return false;
  const element = node as Element;
  return element.hasAttribute(INBOX_MARK_ATTRIBUTE) || element.getAttribute('data-host') === INBOX_SLOT_HOST;
};
const onlyOurs = (records: readonly MutationRecord[]): boolean => records.every((r) => [...r.addedNodes, ...r.removedNodes].every(ours));

const SVG = 'http://www.w3.org/2000/svg';

/** The pin glyph as plain nodes (no markup parsed): `filled` — a pinned chat's. */
export function pinGlyph(doc: Document, size: number, filled: boolean, stroke = 2): SVGSVGElement {
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', FANSLY_PIN_GLYPH.viewBox);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('style', 'display:block;pointer-events:none;flex:none');
  for (const d of [FANSLY_PIN_GLYPH.needle, FANSLY_PIN_GLYPH.head]) {
    const path = doc.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', filled && d === FANSLY_PIN_GLYPH.head ? 'currentColor' : 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', String(stroke));
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
  }
  return svg;
}

const NO_DEPS: InboxMarksDeps = { meta: () => Promise.resolve(null), toggle: () => undefined };

export function createInboxMarks(doc: Document, deps: InboxMarksDeps = NO_DEPS): InboxMarks {
  const words = new Map<string, FanslyLastWord>();
  let mark: FanslyInboxMark | null = null;
  let pins: FanslyRowPinsState | null = null;
  let inbox: Element | null = null;
  let watching: Element | null = null;
  /** The list the hover listeners are on (the route's own, while the pins are on). */
  let hovering: Element | null = null;
  /** The row the pointer is over now. */
  let hovered: Element | null = null;
  /** Lists looked at once: a leftover of a previous copy of ours goes at the first look. */
  const seen = new WeakSet<Element>();
  /** Each row button's chat, as MAIN said it when the button was made. */
  const buttons = new WeakMap<Element, FanslyChatMeta & { readonly fanId: string }>();
  let scheduled = false;
  let disposed = false;

  const remove = (root: ParentNode | null): void => {
    if (root === null) return;
    for (const node of [...root.querySelectorAll(`[${INBOX_MARK_ATTRIBUTE}]`)]) node.remove();
  };

  const groupOf = (link: Element): string | undefined => GROUP_PATH.exec(link.getAttribute('href') ?? '')?.[1];
  const pinsHere = (target: Element | null): boolean => pins !== null && target !== null && target.closest(ROUTE) !== null;

  const made = (kind: 'dot' | 'we' | 'pin'): Element => {
    const node = doc.createElement(kind === 'we' ? 'span' : 'i');
    node.setAttribute(INBOX_MARK_ATTRIBUTE, kind);
    node.setAttribute('style', kind === 'dot' ? DOT_STYLE : kind === 'pin' ? PIN_MARK_STYLE : WE_STYLE);
    if (kind === 'we') node.textContent = `${INBOX_WE_TEXT} `;
    else node.setAttribute('aria-hidden', 'true');
    if (kind === 'pin') node.append(pinGlyph(doc, 9, true, 2.6));
    return node;
  };

  /** A row button's look: pinned or not, its words, and whether the pointer is on the button itself. */
  const dress = (box: Element, groupId: string): void => {
    const button = box.firstElementChild as HTMLButtonElement | null;
    if (button === null || pins === null) return;
    const pinned = pins.pinned.has(groupId);
    const label = pinned ? pins.words.unpin : pins.words.pin;
    if (button.getAttribute('aria-pressed') !== String(pinned)) {
      button.setAttribute('aria-pressed', String(pinned));
      button.replaceChildren(pinGlyph(doc, 16, pinned, 1.7));
    }
    if (button.getAttribute('aria-label') !== label) {
      button.setAttribute('aria-label', label);
      button.title = label;
    }
    const over = button.matches(':hover');
    button.style.color = pinned ? BUTTON_PINNED : over ? BUTTON_HOVER.color : '';
    button.style.backgroundColor = over ? BUTTON_HOVER.background : '';
  };

  const show = (box: Element, on: boolean): void => {
    const button = box.firstElementChild as HTMLElement | null;
    (box as HTMLElement).style.opacity = on ? '1' : '0';
    if (button !== null) button.style.pointerEvents = on ? 'auto' : 'none';
  };

  /** The pin button of a row: made once its chat is known as a direct one with a fan. */
  const button = (group: Element, meta: FanslyChatMeta & { readonly fanId: string }): Element => {
    const box = doc.createElement('span');
    box.setAttribute(INBOX_MARK_ATTRIBUTE, 'row');
    box.setAttribute('style', ROW_BOX_STYLE);
    const press = doc.createElement('button');
    press.type = 'button';
    press.tabIndex = -1;
    press.draggable = false;
    press.setAttribute('style', ROW_BUTTON_STYLE);
    // The focus stays where it was (the composer): no press of ours moves it, and no drag of the row starts here.
    const keep = (event: Event): void => {
      event.preventDefault();
    };
    press.addEventListener('pointerdown', keep);
    press.addEventListener('mousedown', keep);
    press.addEventListener('dragstart', keep);
    // The row's link never hears this click: no chat opens, nothing is marked read.
    press.addEventListener('auxclick', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    press.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!event.isTrusted || event.button !== 0 || disposed || pins === null) return;
      const chat = buttons.get(box);
      if (chat !== undefined) deps.toggle(chat);
    });
    const hover = (): void => {
      const groupId = groupOf(box.closest(ROW_LINK) ?? box);
      if (groupId !== undefined) dress(box, groupId);
    };
    press.addEventListener('pointerenter', hover);
    press.addEventListener('pointerleave', () => queueMicrotask(hover));
    box.append(press);
    buttons.set(box, meta);
    group.append(box);
    dress(box, meta.groupId);
    return box;
  };

  /** The pointer came over a row: its button, once known; the row it left hides its own. */
  const enter = (row: Element | null): void => {
    if (row === hovered) return;
    const left = hovered;
    hovered = row;
    const old = left?.querySelector(`[${INBOX_MARK_ATTRIBUTE}="row"]`) ?? null;
    if (old !== null) show(old, false);
    if (row === null || !pinsHere(watching)) return;
    const group = row.querySelector(GROUP);
    const groupId = groupOf(row);
    if (group === null || groupId === undefined) return;
    const box = group.querySelector(`:scope > [${INBOX_MARK_ATTRIBUTE}="row"]`);
    if (box !== null) {
      dress(box, groupId);
      show(box, true);
      return;
    }
    void deps.meta(groupId).then((meta) => {
      // Still the row the pointer is on, the pins still on, the row's chat still this one.
      if (disposed || hovered !== row || !pinsHere(watching) || groupOf(row) !== groupId || !row.isConnected) return;
      if (meta === null || meta.kind !== 'direct' || meta.fanId === null || meta.groupId !== groupId) return;
      if (group.querySelector(`:scope > [${INBOX_MARK_ATTRIBUTE}="row"]`) !== null) return;
      const made = button(group, { ...meta, fanId: meta.fanId });
      observer.takeRecords();
      show(made, true);
    }, () => undefined);
  };

  const rowOf = (target: EventTarget | null): Element | null => {
    if (!(target instanceof Element) || hovering === null) return null;
    const row = target.closest(ROW_LINK);
    return row !== null && hovering.contains(row) && row.querySelector(GROUP) !== null ? row : null;
  };
  const onOver = (event: Event): void => enter(rowOf(event.target));
  const onOut = (event: Event): void => {
    const next = rowOf((event as PointerEvent).relatedTarget);
    if (next !== hovered) enter(next);
  };
  const hover = (target: Element | null): void => {
    if (target === hovering) return;
    hovering?.removeEventListener('pointerover', onOver);
    hovering?.removeEventListener('pointerout', onOut);
    hovering = target;
    hovered = null;
    target?.addEventListener('pointerover', onOver, { passive: true });
    target?.addEventListener('pointerout', onOut, { passive: true });
  };

  /** One row: the marks its word and the choice ask for, the pin mark and the button the pins ask for, in their places; nothing else of ours. */
  const decorate = (link: Element, pinsOn: boolean): void => {
    const groupId = groupOf(link);
    const word = groupId === undefined ? undefined : words.get(groupId);
    const avatar = link.querySelector(AVATAR);
    const preview = link.querySelector(PREVIEW);
    const group = link.querySelector(GROUP);
    const dot = mark === 'dot' && word === 'fan' ? avatar : null;
    const we = mark === 'we' && word === 'model' ? preview : null;
    const pin = pinsOn && groupId !== undefined && pins?.pinned.has(groupId) === true ? avatar : null;
    const row = pinsOn ? group : null;
    let dotKept = false;
    let weKept = false;
    let pinKept = false;
    let rowKept = false;
    for (const node of [...link.querySelectorAll(`[${INBOX_MARK_ATTRIBUTE}]`)]) {
      const kind = node.getAttribute(INBOX_MARK_ATTRIBUTE);
      if (kind === 'dot' && !dotKept && dot !== null && node.parentElement === dot) dotKept = true;
      else if (kind === 'we' && !weKept && we !== null && we.firstChild === node) weKept = true;
      else if (kind === 'pin' && !pinKept && pin !== null && node.parentElement === pin) pinKept = true;
      else if (kind === 'row' && !rowKept && row !== null && node.parentElement === row && buttons.get(node)?.groupId === groupId) {
        rowKept = true;
        if (groupId !== undefined) dress(node, groupId);
      } else node.remove();
    }
    if (dot !== null && !dotKept) dot.append(made('dot'));
    if (we !== null && !weKept) we.prepend(made('we'));
    if (pin !== null && !pinKept) pin.append(made('pin'));
  };

  const apply = (): void => {
    scheduled = false;
    if (disposed) return;
    const target = inbox !== null && inbox.isConnected ? inbox : null;
    if (target !== null && !seen.has(target)) {
      seen.add(target);
      remove(target);
    }
    const marks = mark === 'dot' || mark === 'we';
    const pinsOn = pinsHere(target);
    hover(pinsOn ? target : null);
    if (target === null || (!marks && !pinsOn)) {
      observer.disconnect();
      watching = null;
      remove(target);
      return;
    }
    if (watching !== target) {
      observer.disconnect();
      observer.observe(target, { childList: true, subtree: true });
      watching = target;
    }
    for (const link of [...target.querySelectorAll(ROW_LINK)]) decorate(link, pinsOn);
    // What our own writes said to the observer is not the page's change.
    observer.takeRecords();
  };

  const schedule = (): void => {
    if (scheduled || disposed) return;
    scheduled = true;
    queueMicrotask(apply);
  };

  const observer = new MutationObserver((records) => {
    if (!onlyOurs(records)) schedule();
  });

  return {
    setMark(next) {
      if (next === mark) return;
      mark = next;
      schedule();
    },
    word(groupId, word) {
      if ((words.get(groupId) ?? null) === word) return;
      if (word === null) words.delete(groupId);
      else words.set(groupId, word);
      schedule();
    },
    clear() {
      if (words.size === 0) return;
      words.clear();
      schedule();
    },
    setPins(next) {
      if (next === pins) return;
      pins = next;
      schedule();
    },
    place(next) {
      if (next === inbox) return;
      if (inbox !== null && inbox !== next) remove(inbox);
      inbox = next;
      schedule();
    },
    marked: () => (inbox === null ? 0 : inbox.querySelectorAll(`[${INBOX_MARK_ATTRIBUTE}]`).length),
    dispose() {
      disposed = true;
      observer.disconnect();
      hover(null);
      remove(inbox);
      inbox = null;
      watching = null;
      words.clear();
    },
  };
}
