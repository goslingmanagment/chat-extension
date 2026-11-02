// Who wrote each of the model's messages in the open chat (2026-11-03, the owner: «узнавать кто написал какое
// сообщение»): the login of the person whose browser sent it and how its text was written, before the time Fansly
// prints under a run of the model's messages («Nikita · Reply · Nov 2, 9:49 PM»). The hub's record of who sent what is
// the application's to read (`fansly.setMessageAuthors`); this file only lines it up with the page and draws it.
//
// - Fansly's bubbles carry no message id (fansly-web.md §3). MAIN holds the chat's messages in order (`fx.order`: the
//   ids, whose each is, the model's folded-text hash), and the model's bubbles, top to bottom, are lined up with the
//   model's messages MAIN holds, oldest first: a bubble whose own text hashes as a message's is that message (the
//   longest chain of such pairs), and between two of those the rest pair in order only when both sides hold as many
//   and alike — a text against a text, none against none. A bubble that does not line up gets nothing: a name is never
//   guessed. A quoted reply inside a bubble is not a bubble of its own.
// - One label a run (`app-group-message-collection`): one span of ours at the head of its `div.timestamp`, a line the
//   page already has, so no line is added and the chat does not grow. A run of two people names both; messages of a run
//   nobody is known for are counted («+1 без автора»). Fansly watches nothing inside that line (the list's
//   `xdMutation` reads only its own children), so a label moves nothing of the page's.
// - One observer, `childList + subtree` on the open chat's list while a view is set, looks again after the page's
//   change — a label the page wrote into or took away too: what our own writes said is taken at once, so whatever it
//   hears is the page's — and a burst of changes makes one pass. A label is kept only while it still says its words.
//   Plain nodes with inline styles, named by `data-cg-author`; nothing of the page's is changed, and they all go when
//   the view goes, the chat changes or the port is disposed.

import type { FanslyOrder } from '@cg/contracts/bridge-messages-fansly';
import type { FanslyMessageAuthor, FanslyMessageAuthorsView } from '@cg/contracts/fansly';

export const MESSAGE_AUTHOR_ATTRIBUTE = 'data-cg-author';

/** The open chat's list, its runs, a run's bubbles and time line, a bubble's own text (fansly-web.md §3). */
const LIST = '.message-content-list';
const RUN = 'app-group-message-collection';
const BUBBLE = 'app-group-message';
const STAMP = '.timestamp';
const TEXT = '.message-text';
const MINE = 'my-message';

/** `fx.order`'s flags (contracts FANSLY_ORDER_BITS, MAIN's record flags): the fan's, seen deleted, seen live. */
const FAN = 1;
const DELETED = 4;
const LIVE = 32;

/** A burst of the page's changes (a page of history, a send) makes one pass. */
const PASS_MS = 60;
/** The model's newest bubbles a pass lines up: MAIN holds at most 120 messages of a chat. */
const BUBBLES_MAX = 300;
/** Names one label shows before «+N». */
const NAMES_MAX = 3;

/** The time line's own font and colour; the name a little bolder. Never a click of ours: the line's own stays. */
const LABEL_STYLE = 'white-space:nowrap;pointer-events:none';
const NAME_STYLE = 'font-weight:600';

/** MAIN's `textHash` (main/automation.ts): FNV-1a over the UTF-16 units of the whitespace-folded text; 0 — no text. */
export function textHash(text: string): number {
  const folded = text.replace(/\s+/gu, ' ').trim();
  if (folded === '') return 0;
  let hash = 0x811c9dc5;
  for (let i = 0; i < folded.length; i += 1) hash = Math.imul(hash ^ folded.charCodeAt(i), 0x01000193);
  return hash >>> 0 || 1;
}

/** The text a bubble shows, a line break as one: Fansly draws the message's parts as text, links, names and `<br>`. */
function shownText(node: Node): string {
  let out = '';
  for (const child of node.childNodes) {
    if (child.nodeType === 3) out += (child as Text).data;
    else if (child.nodeType === 1) out += (child as Element).tagName === 'BR' ? '\n' : shownText(child);
  }
  return out;
}

/** The bubble's own text, never the quoted message's inside it; null — media alone. */
function ownText(bubble: Element): string | null {
  for (const node of bubble.querySelectorAll(TEXT)) if (node.closest(BUBBLE) === bubble) return shownText(node);
  return null;
}

/** The run's own bubbles, top to bottom: not a quoted reply inside one. */
const bubblesOf = (run: Element): Element[] => [...run.querySelectorAll(BUBBLE)].filter((bubble) => bubble.parentElement?.closest(`${BUBBLE}, ${RUN}`) === run);
/** The model's, as Fansly marks it on the bubble or on its row. */
const mine = (bubble: Element): boolean => bubble.classList.contains(MINE) || bubble.parentElement?.classList.contains(MINE) === true;
/** The run's time line, outside every bubble. */
const stampOf = (run: Element): Element | null => [...run.querySelectorAll(STAMP)].find((stamp) => stamp.closest(BUBBLE) === null && stamp.closest(RUN) === run) ?? null;

/**
 * The model's bubbles against the model's messages MAIN holds, both oldest first, by their text hashes (0 — no text):
 * per bubble the index of its message, or -1. Equal hashes pair, the longest chain of them in order; between two pairs
 * — and before the first, after the last — the rest pair in order only when both sides hold as many and each pair is
 * alike: a text against a text, none against none.
 */
export function lineUp(bubbles: readonly number[], messages: readonly number[]): Int32Array {
  const n = bubbles.length;
  const m = messages.length;
  const w = m + 1;
  const best = new Uint16Array((n + 1) * w);
  const cell = (i: number, j: number): number => best[i * w + j] as number;
  const same = (i: number, j: number): boolean => (bubbles[i] as number) !== 0 && bubbles[i] === messages[j];
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) best[i * w + j] = same(i, j) ? cell(i + 1, j + 1) + 1 : Math.max(cell(i + 1, j), cell(i, j + 1));
  }
  const at = new Int32Array(n).fill(-1);
  const pairs: Array<readonly [number, number]> = [[-1, -1]];
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (same(i, j) && cell(i, j) === cell(i + 1, j + 1) + 1) {
      at[i] = j;
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (cell(i + 1, j) >= cell(i, j + 1)) i += 1;
    else j += 1;
  }
  pairs.push([n, m]);
  for (let k = 1; k < pairs.length; k += 1) {
    const [i0, j0] = pairs[k - 1] as readonly [number, number];
    const [i1, j1] = pairs[k] as readonly [number, number];
    const count = i1 - i0 - 1;
    if (count <= 0 || count !== j1 - j0 - 1) continue;
    let alike = true;
    for (let d = 1; d <= count && alike; d += 1) alike = ((bubbles[i0 + d] as number) === 0) === ((messages[j0 + d] as number) === 0);
    if (alike) for (let d = 1; d <= count; d += 1) at[i0 + d] = j0 + d;
  }
  return at;
}

/** What one run's label says: the name or names, then how the texts were written and the messages nobody is known for. */
export function labelOf(authors: readonly FanslyMessageAuthor[], unknown: number, unknownWords: (count: number) => string): { readonly name: string; readonly rest: string } | null {
  if (authors.length === 0) return null;
  const names = [...new Set(authors.map((author) => author.name))];
  const rest: string[] = [];
  if (names.length === 1) {
    const hows = [...new Set(authors.map((author) => author.how).filter((how): how is string => how !== null && how !== ''))];
    if (hows.length > 0) rest.push(hows.join(', '));
  }
  if (unknown > 0) rest.push(unknownWords(unknown));
  const name = names.length <= NAMES_MAX ? names.join(', ') : `${names.slice(0, NAMES_MAX).join(', ')} +${names.length - NAMES_MAX}`;
  return { name, rest: rest.join(' · ') };
}

export interface MessageAuthorsDeps {
  /** MAIN's order of a group's messages (`fx.order`); null — not known. */
  readonly order: (groupId: string) => Promise<FanslyOrder | null>;
}

export interface MessageAuthors {
  /** The application's authors of the open chat; null — nothing of ours in the chat. */
  set(view: FanslyMessageAuthorsView | null): void;
  /** The open chat's container (`app-group-message-container`) and its group; null — no chat. */
  place(container: Element | null, groupId: string | null): void;
  /** MAIN heard a message of this group come or go: its order moved. */
  changed(groupId: string): void;
  /** For a test and the diagnostics: runs labelled now. */
  shown(): number;
  dispose(): void;
}

export function createMessageAuthors(doc: Document, deps: MessageAuthorsDeps): MessageAuthors {
  let view: FanslyMessageAuthorsView | null = null;
  let container: Element | null = null;
  let groupId: string | null = null;
  let watching: Element | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let run = 0;
  let disposed = false;
  /** The model's live messages of this chat already told unknown to the application: each once. */
  const told = new Set<string>();

  // Every pass takes what its own writes told the observer before it returns: whatever comes here is the page's.
  const observer = new MutationObserver(() => schedule());

  const remove = (root: ParentNode | null): void => {
    if (root === null) return;
    for (const node of [...root.querySelectorAll(`[${MESSAGE_AUTHOR_ATTRIBUTE}]`)]) node.remove();
  };

  /** One run's label in its time line, or none; a label still saying the same, untouched, stays. */
  const label = (runNode: Element, stamp: Element | null, said: { readonly name: string; readonly rest: string } | null): void => {
    // The time follows: « · » before it (Fansly's own time starts with a space, which folds into ours).
    const tail = `${said === null || said.rest === '' ? '' : ` · ${said.rest}`} · `;
    const key = said === null ? null : `${said.name}\n${said.rest}`;
    let kept = false;
    for (const node of [...runNode.querySelectorAll(`[${MESSAGE_AUTHOR_ATTRIBUTE}]`)]) {
      const intact = node.childNodes.length === 2 && node.firstChild?.textContent === said?.name && node.lastChild?.textContent === tail;
      if (!kept && key !== null && stamp !== null && node.parentElement === stamp && node.getAttribute(MESSAGE_AUTHOR_ATTRIBUTE) === key && intact) kept = true;
      else node.remove();
    }
    if (kept || said === null || key === null || stamp === null) return;
    const span = doc.createElement('span');
    span.setAttribute(MESSAGE_AUTHOR_ATTRIBUTE, key);
    span.setAttribute('style', LABEL_STYLE);
    const name = doc.createElement('span');
    name.setAttribute('style', NAME_STYLE);
    name.textContent = said.name;
    span.append(name, tail);
    stamp.prepend(span);
  };

  const draw = (list: Element, shown: FanslyMessageAuthorsView, order: FanslyOrder | null): void => {
    const runs: { readonly node: Element; readonly stamp: Element | null; readonly bubbles: readonly Element[] }[] = [];
    const bubbles: { readonly bubble: Element; readonly hash: number }[] = [];
    for (const node of list.querySelectorAll(RUN)) {
      const own = bubblesOf(node).filter(mine);
      runs.push({ node, stamp: stampOf(node), bubbles: own });
      for (const bubble of own) {
        const text = ownText(bubble);
        bubbles.push({ bubble, hash: text === null ? 0 : textHash(text) });
      }
    }
    const messages: { readonly id: string; readonly hash: number; readonly live: boolean }[] = [];
    if (order !== null) {
      for (let i = 0; i < order.ids.length; i += 1) {
        const bits = order.bits[i] ?? 0;
        if ((bits & FAN) !== 0 || (bits & DELETED) !== 0) continue;
        messages.push({ id: order.ids[i] as string, hash: order.hashes[i] ?? 0, live: (bits & LIVE) !== 0 });
      }
    }
    const tail = bubbles.slice(-BUBBLES_MAX);
    const at = lineUp(tail.map((entry) => entry.hash), messages.map((message) => message.hash));
    const idOf = new Map<Element, string>();
    const unknownLive: string[] = [];
    tail.forEach((entry, i) => {
      const message = messages[at[i] as number];
      if (message === undefined) return;
      idOf.set(entry.bubble, message.id);
      if (message.live && !shown.byId.has(message.id) && !told.has(message.id)) unknownLive.push(message.id);
    });
    for (const { node, stamp, bubbles: own } of runs) {
      const authors: FanslyMessageAuthor[] = [];
      let unknown = 0;
      for (const bubble of own) {
        const id = idOf.get(bubble);
        const author = id === undefined ? undefined : shown.byId.get(id);
        if (author === undefined) unknown += 1;
        else authors.push(author);
      }
      label(node, stamp, labelOf(authors, unknown, shown.unknown));
    }
    if (unknownLive.length > 0) {
      for (const id of unknownLive) told.add(id);
      shown.onUnknownLive?.(unknownLive);
    }
  };

  const pass = async (): Promise<void> => {
    if (disposed) return;
    run += 1;
    const asked = run;
    const shown = view;
    const box = container !== null && container.isConnected ? container : null;
    const group = groupId;
    if (shown === null || box === null || group === null || shown.groupId !== group) {
      observer.disconnect();
      watching = null;
      remove(container);
      return;
    }
    const list = box.querySelector(LIST) ?? box;
    if (watching !== list) {
      observer.disconnect();
      observer.observe(list, { childList: true, subtree: true });
      watching = list;
    }
    const order = await deps.order(group).catch(() => null);
    if (disposed || asked !== run || view !== shown || groupId !== group || container !== box || !list.isConnected) return;
    draw(list, shown, order);
    // What our own writes said to the observer is not the page's change.
    observer.takeRecords();
  };

  function schedule(): void {
    if (disposed || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      void pass();
    }, PASS_MS);
  }

  return {
    set(next) {
      if (next === view) return;
      if ((next?.groupId ?? null) !== (view?.groupId ?? null)) told.clear();
      view = next;
      schedule();
    },
    place(nextContainer, nextGroup) {
      if (nextContainer === container && nextGroup === groupId) return;
      if (container !== null && container !== nextContainer) remove(container);
      if (nextGroup !== groupId) told.clear();
      container = nextContainer;
      groupId = nextGroup;
      schedule();
    },
    changed(changedGroup) {
      if (changedGroup === groupId && view !== null) schedule();
    },
    shown: () => (container === null ? 0 : container.querySelectorAll(`[${MESSAGE_AUTHOR_ATTRIBUTE}]`).length),
    dispose() {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      observer.disconnect();
      remove(container);
      container = null;
      watching = null;
      view = null;
      told.clear();
    },
  };
}
