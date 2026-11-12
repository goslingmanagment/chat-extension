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
// - `pin`: a pinned chat's mark on the bottom left of the avatar — a dark disc with the pin in the «pinned» blue, there
//   from the row's first frame, never taking the pointer;
// - `row`: the pin button (inbox-pin-button.ts), made for a row the first time a person's pointer comes over it, once
//   MAIN says the chat is a direct one with a known fan (`meta`, asked again a few times while the pointer stays).
//   Shown and hidden by one set of delegated listeners on the list, and only on a real movement of the pointer: the
//   list scrolling under a resting pointer hides the button of the row it left and shows none, and reads no geometry.
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
import { FANSLY_WAITING_DOT_COLOR } from '@cg/contracts/fansly-pin-glyph';
import type { FanslyInboxMark } from '@cg/contracts/settings-ext';

import { dressRowButton, makeRowButton, pinGlyph, placeRowButton, ROW_BUTTON_KIND, showRowButton } from './inbox-pin-button';
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
export const INBOX_DOT_COLOR = FANSLY_WAITING_DOT_COLOR;
/** 8 px in a ring of the page's background: as large as Fansly's own online dot with its border (the owner: «чуть меньше»). */
const DOT_STYLE = `position:absolute;top:0;right:0;width:8px;height:8px;box-sizing:border-box;border-radius:50%;background:${INBOX_DOT_COLOR};box-shadow:0 0 0 2px var(--dark-1,#111215);pointer-events:none;z-index:2`;
const WE_STYLE = 'color:var(--font-tint-3,#9da2ad)';
export const INBOX_WE_TEXT = 'Мы:';
/** A pinned row's mark: a 16 px disc of the page's background in a ring of it, the pin filled in the «pinned» blue. */
const PIN_MARK_STYLE =
  'position:absolute;left:-3px;bottom:-3px;width:16px;height:16px;box-sizing:border-box;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--dark-1,#111215);color:var(--blue-1,#2699f7);box-shadow:0 0 0 2px var(--dark-1,#111215);pointer-events:none;z-index:2';
/** A row's chat not known to MAIN yet (an empty answer) is asked again this often, this many times, while hovered. */
const META_RETRY_MS = 300;
const META_RETRIES = 4;

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

const NO_DEPS: InboxMarksDeps = { meta: () => Promise.resolve(null), toggle: () => undefined };

export function createInboxMarks(doc: Document, deps: InboxMarksDeps = NO_DEPS): InboxMarks {
  const words = new Map<string, FanslyLastWord>();
  let mark: FanslyInboxMark | null = null;
  let pins: FanslyRowPinsState | null = null;
  let inbox: Element | null = null;
  let watching: Element | null = null;
  /** The list the hover listeners are on (the route's own, while the pins are on). */
  let hovering: Element | null = null;
  /** The row whose button is shown (the pointer came onto it by a real movement). */
  let hovered: Element | null = null;
  /** The pointer's last place: an event at the same place is the list moving under it, not the person. */
  let lastX = Number.NaN;
  let lastY = Number.NaN;
  /** The pending ask of MAIN for the row the pointer is on, asked again a little later. */
  let retry: number | null = null;
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
    if (kind === 'pin') node.append(pinGlyph(doc, 10, true, 2.4));
    return node;
  };

  const dress = (button: HTMLButtonElement, groupId: string): void => {
    if (pins === null) return;
    const pinned = pins.pinned.has(groupId);
    dressRowButton(doc, button, { pinned, label: pinned ? pins.words.unpin : pins.words.pin });
  };

  const buttonOf = (group: Element): HTMLButtonElement | null => group.querySelector<HTMLButtonElement>(`:scope > [${INBOX_MARK_ATTRIBUTE}="${ROW_BUTTON_KIND}"]`);

  /** The pin button of a row: made once its chat is known as a direct one with a fan. */
  const button = (group: Element, meta: FanslyChatMeta & { readonly fanId: string }): HTMLButtonElement => {
    const made = makeRowButton(doc, INBOX_MARK_ATTRIBUTE, (pressed) => {
      if (disposed || pins === null) return;
      const chat = buttons.get(pressed);
      if (chat !== undefined) deps.toggle(chat);
    });
    buttons.set(made, meta);
    group.append(made);
    dress(made, meta.groupId);
    return made;
  };

  /** Shown on a person's hover: dressed, placed by one read of its row (the observer skips our own nodes by itself). */
  const show = (group: Element, made: HTMLButtonElement, groupId: string): void => {
    dress(made, groupId);
    placeRowButton(made, group);
    showRowButton(made, true);
  };

  /** A person's pointer came onto a row (null — off the rows): its button, once known; the row it left hides its own. */
  const enter = (row: Element | null): void => {
    if (row === hovered) return;
    const left = hovered;
    hovered = row;
    if (retry !== null) {
      doc.defaultView?.clearTimeout(retry);
      retry = null;
    }
    const old = left === null ? null : left.querySelector<HTMLButtonElement>(`[${INBOX_MARK_ATTRIBUTE}="${ROW_BUTTON_KIND}"]`);
    if (old !== null) showRowButton(old, false);
    if (row === null || !pinsHere(watching)) return;
    const group = row.querySelector(GROUP);
    const groupId = groupOf(row);
    if (group === null || groupId === undefined) return;
    const existing = buttonOf(group);
    if (existing !== null) {
      show(group, existing, groupId);
      return;
    }
    // MAIN's answer can come back empty while its state is being said again (a new page, a new generation): asked
    // again a few times while the pointer stays on the row.
    const ask = (left: number): void => {
      void deps.meta(groupId).then((meta) => {
        // Still the row the pointer is on, the pins still on, the row's chat still this one.
        if (disposed || hovered !== row || !pinsHere(watching) || groupOf(row) !== groupId || !row.isConnected) return;
        if (meta === null) {
          if (left > 0) retry = doc.defaultView?.setTimeout(() => ask(left - 1), META_RETRY_MS) ?? null;
          return;
        }
        if (meta.kind !== 'direct' || meta.fanId === null || meta.groupId !== groupId || buttonOf(group) !== null) return;
        show(group, button(group, { ...meta, fanId: meta.fanId }), groupId);
      }, () => undefined);
    };
    ask(META_RETRIES);
  };

  const rowOf = (target: EventTarget | null): Element | null => {
    if (!(target instanceof Element) || hovering === null) return null;
    const row = target.closest(ROW_LINK);
    return row !== null && hovering.contains(row) && row.querySelector(GROUP) !== null ? row : null;
  };
  /** Whether the pointer moved since the last event we saw: one at the same place is the list moving under it. */
  const moved = (event: Event): boolean => {
    const { clientX, clientY } = event as PointerEvent;
    const real = clientX !== lastX || clientY !== lastY;
    lastX = clientX;
    lastY = clientY;
    return real;
  };
  const onMove = (event: Event): void => {
    if (!moved(event)) return;
    const row = rowOf(event.target);
    if (row !== hovered) enter(row);
  };
  const onOver = (event: Event): void => {
    const row = rowOf(event.target);
    if (moved(event)) enter(row);
    // The list scrolled under a resting pointer: the row it left hides its button, the new one shows none.
    else if (row !== hovered) enter(null);
  };
  const onOut = (event: Event): void => {
    const next = (event as PointerEvent).relatedTarget;
    if (hovering !== null && (!(next instanceof Node) || !hovering.contains(next))) enter(null);
  };
  const hover = (target: Element | null): void => {
    if (target === hovering) return;
    hovering?.removeEventListener('pointermove', onMove);
    hovering?.removeEventListener('pointerover', onOver);
    hovering?.removeEventListener('pointerout', onOut);
    enter(null);
    hovering = target;
    target?.addEventListener('pointermove', onMove, { passive: true });
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
      else if (kind === ROW_BUTTON_KIND && !rowKept && row !== null && node.parentElement === row && buttons.get(node)?.groupId === groupId) {
        rowKept = true;
        if (groupId !== undefined) dress(node as HTMLButtonElement, groupId);
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
