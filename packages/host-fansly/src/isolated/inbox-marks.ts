// The mark of a chat waiting for a reply in Fansly's own list of chats (2026-10-29). Fansly's row shows the text of
// the last message and never whose it is; MAIN says who has the last word in each chat (`fx.lastWord`,
// main/last-word.ts), and the person chose how it is shown (`settings.ext` → `setInboxMark`):
// - `dot`, the default: a muted terracotta dot on the top right of the avatar of a fan who has the last word. Fansly's
//   own online dot stands on the bottom right;
// - `we`: «Мы:» before the preview of a chat where the model has the last word, as a messenger says it;
// - `off`: nothing. Until the application says the choice, nothing either.
//
// The rows are Fansly's virtual list, `a[href="/messages/<groupId>"]` in `div.messages-list-wrapper`: they come and go
// as the person scrolls, and a row's parts are made anew when its chat changes. While a mark is shown one observer,
// `childList + subtree` on that list alone, looks at its rows again after the page's change; changes of our own wake
// nothing. Our nodes are plain ones with inline styles (nothing global, FS-PLC-7), named by `data-cg-inbox`; nothing
// of the page's is changed, and they all go when the mark is off, the list is gone or the port is disposed.

import type { FanslyLastWord } from '@cg/contracts/bridge-messages-fansly';
import type { FanslyInboxMark } from '@cg/contracts/settings-ext';

export const INBOX_MARK_ATTRIBUTE = 'data-cg-inbox';

/** The row's parts the marks stand on: the avatar (positioned by Fansly itself) and the preview of the last message. */
const ROW_LINK = 'a[href^="/messages/"]';
const AVATAR = '.message-avatar app-account-avatar';
const PREVIEW = '.font-size-xs.eclipse';
const GROUP_PATH = /^\/messages\/(\d+)$/;

/** «оранж, но не яркий» (the owner, 2026-10-29): the family's terracotta, dimmed for Fansly's list. */
export const INBOX_DOT_COLOR = '#b9765d';
const DOT_STYLE = `position:absolute;top:-1px;right:-1px;width:10px;height:10px;box-sizing:border-box;border-radius:50%;background:${INBOX_DOT_COLOR};box-shadow:0 0 0 2px var(--dark-1,#111215);pointer-events:none;z-index:2`;
const WE_STYLE = 'color:var(--font-tint-3,#9da2ad)';
export const INBOX_WE_TEXT = 'Мы:';

export interface InboxMarks {
  /** The person's choice. */
  setMark(mark: FanslyInboxMark): void;
  /** MAIN's word of a chat; null — not known any more. */
  word(groupId: string, word: FanslyLastWord | null): void;
  /** Every word forgotten: MAIN says them all again after `fx.state`, or another creator logged in. */
  clear(): void;
  /** The list of chats now on the page; null — none. */
  place(inbox: Element | null): void;
  /** For a test and the diagnostics: rows marked now. */
  marked(): number;
  dispose(): void;
}

const ours = (node: Node): boolean => node.nodeType === 1 && (node as Element).hasAttribute(INBOX_MARK_ATTRIBUTE);
const onlyOurs = (records: readonly MutationRecord[]): boolean => records.every((r) => [...r.addedNodes, ...r.removedNodes].every(ours));

export function createInboxMarks(doc: Document): InboxMarks {
  const words = new Map<string, FanslyLastWord>();
  let mark: FanslyInboxMark | null = null;
  let inbox: Element | null = null;
  let watching: Element | null = null;
  let scheduled = false;
  let disposed = false;

  const remove = (root: ParentNode | null): void => {
    if (root === null) return;
    for (const node of [...root.querySelectorAll(`[${INBOX_MARK_ATTRIBUTE}]`)]) node.remove();
  };

  const made = (kind: 'dot' | 'we'): Element => {
    const node = doc.createElement(kind === 'dot' ? 'i' : 'span');
    node.setAttribute(INBOX_MARK_ATTRIBUTE, kind);
    node.setAttribute('style', kind === 'dot' ? DOT_STYLE : WE_STYLE);
    if (kind === 'dot') node.setAttribute('aria-hidden', 'true');
    else node.textContent = `${INBOX_WE_TEXT} `;
    return node;
  };

  /** One row: the mark its word and the choice ask for, in its place, and nothing else of ours. */
  const decorate = (link: Element): void => {
    const groupId = GROUP_PATH.exec(link.getAttribute('href') ?? '')?.[1];
    const word = groupId === undefined ? undefined : words.get(groupId);
    const avatar = link.querySelector(AVATAR);
    const preview = link.querySelector(PREVIEW);
    const dot = mark === 'dot' && word === 'fan' ? avatar : null;
    const we = mark === 'we' && word === 'model' ? preview : null;
    let dotKept = false;
    let weKept = false;
    for (const node of [...link.querySelectorAll(`[${INBOX_MARK_ATTRIBUTE}]`)]) {
      const kind = node.getAttribute(INBOX_MARK_ATTRIBUTE);
      if (kind === 'dot' && !dotKept && dot !== null && node.parentElement === dot) dotKept = true;
      else if (kind === 'we' && !weKept && we !== null && we.firstChild === node) weKept = true;
      else node.remove();
    }
    if (dot !== null && !dotKept) dot.append(made('dot'));
    if (we !== null && !weKept) we.prepend(made('we'));
  };

  const apply = (): void => {
    scheduled = false;
    if (disposed) return;
    const target = inbox !== null && inbox.isConnected ? inbox : null;
    const shown = target !== null && (mark === 'dot' || mark === 'we');
    if (!shown) {
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
    for (const link of [...target.querySelectorAll(ROW_LINK)]) decorate(link);
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
      remove(inbox);
      inbox = null;
      watching = null;
      words.clear();
    },
  };
}
