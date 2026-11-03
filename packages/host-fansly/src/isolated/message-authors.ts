// Who wrote each of the model's messages in the open chat (2026-11-03, the owner: «узнавать кто написал какое
// сообщение»): the login of the person whose browser sent it and how its text was written, before the time Fansly
// prints under a run of the model's messages («Nikita · Reply · Nov 2, 9:49 PM»). The hub's record of who sent what is
// the application's to read (`fansly.setMessageAuthors`); this file only lines it up with the page and draws it.
//
// - Fansly's bubbles carry no message id (fansly-web.md §3). MAIN holds the chat's messages in order (`fx.order`: the
//   ids, whose each is, the second it was made, the model's folded-text hash), and the model's bubbles, top to bottom,
//   are lined up with the model's messages MAIN holds, oldest first (`lineUp`). A bubble that does not line up gets
//   nothing, and is not counted: a name is never guessed. A quoted reply inside a bubble is not a bubble of its own.
// - One label a run (`app-group-message-collection`): one span of ours before the first `span.margin-right-text` of its
//   `div.timestamp`, in a line the page already has, so no line is added and the chat does not grow: the time, or, in
//   the read receipts' `div.timestamp` a click on the time makes in place of the first, the «Sent» line. A run of two
//   people names both; messages of a run nobody is known for are counted («+1 без автора»). Fansly watches nothing
//   inside that line (its `xdMutation` and `appMutation` read only their own children), so a label moves nothing of the
//   page's. Plain nodes with inline styles, named by `data-cg-author`; nothing of the page's is changed, and they all go
//   when the view goes, the chat changes or the port is disposed. A label is kept only while it still says its words.
// - The page's changes are heard by `childList` without `subtree` (FS-PLC-4: FBuddy's nodes live inside the bubbles): on
//   the list's wrapper, where the runs come and go, and on the body of each of the model's runs, where bubbles and the
//   time line come and go. A label lies deeper than either, so our own writes say nothing to the observer. A burst of
//   changes makes one pass.
// - MAIN's order is asked once and held until MAIN says the chat moved (`changed`: `fx.chat`, as it may read a page of
//   history after the page drew it, `fx.incoming`, `fx.pageSent`, `fx.deleted`), so a change of the page costs no
//   request. An order not known says nothing: what is drawn stays, and a chat MAIN does not know yet is asked again a
//   few times.

import type { FanslyOrder } from '@cg/contracts/bridge-messages-fansly';
import type { FanslyMessageAuthor, FanslyMessageAuthorsView } from '@cg/contracts/fansly';

export const MESSAGE_AUTHOR_ATTRIBUTE = 'data-cg-author';

/** The open chat's list, the wrapper of its runs, a run's bubbles and time line, a bubble's own text (fansly-web.md §3). */
const LIST = '.message-content-list';
const RUNS = '.message-collection-wrapper';
const RUN = 'app-group-message-collection';
const BUBBLE = 'app-group-message';
const STAMP = '.timestamp';
/** The first of these in a time line: the time itself, in the read receipts' view the tick of «Sent». */
const TIME = 'span.margin-right-text';
const TEXT = '.message-text';
const MINE = 'my-message';
/** FBuddy's translation, which it puts inside the message's text (and takes out again when it reads the text itself). */
const FBUDDY_TRANSLATION = 'fb-translation-output';

/** `fx.order`'s flags (contracts FANSLY_ORDER_BITS, MAIN's record flags): the fan's, seen deleted. */
const FAN = 1;
const DELETED = 4;

/** A burst of the page's changes (a page of history, a send) makes one pass. */
const PASS_MS = 60;
/** MAIN does not know the chat yet (it starts, or reads the history later): asked again this much later, this often. */
const UNKNOWN_RETRY_MS = 1_000;
const UNKNOWN_RETRIES = 5;
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
    else if (child.nodeType === 1 && !(child as Element).classList.contains(FBUDDY_TRANSLATION)) out += (child as Element).tagName === 'BR' ? '\n' : shownText(child);
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
 * per bubble the index of its message, or -1.
 *
 * Equal hashes pair only when every longest chain of them says so: a text sent twice may fit several places, and which
 * one it is cannot be told, so none is taken. Between two pairs (and before the first, after the last) the rest pair in
 * order only when nothing says otherwise: both sides hold as many and each pair is alike (a text against a text, none
 * against none: Fansly may draw a text differently from what it sent, and media has no text), no text of the bubbles
 * there hashes as a message there (it could have paired, so the order is in doubt), and no two of the messages there
 * were made in one second (`times`: Fansly puts a second's new message before the others, MAIN by its id).
 */
export function lineUp(bubbles: readonly number[], messages: readonly number[], times: readonly number[]): Int32Array {
  const n = bubbles.length;
  const m = messages.length;
  const w = m + 1;
  const same = (i: number, j: number): boolean => (bubbles[i] as number) !== 0 && bubbles[i] === messages[j];
  // The longest chain up to a cell and from it on: a pair is on a longest chain when the two meet through it.
  const before = new Uint16Array((n + 1) * w);
  const after = new Uint16Array((n + 1) * w);
  const of = (table: Uint16Array, i: number, j: number): number => table[i * w + j] as number;
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) before[i * w + j] = same(i - 1, j - 1) ? of(before, i - 1, j - 1) + 1 : Math.max(of(before, i - 1, j), of(before, i, j - 1));
  }
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) after[i * w + j] = same(i, j) ? of(after, i + 1, j + 1) + 1 : Math.max(of(after, i + 1, j), of(after, i, j + 1));
  }
  const longest = of(after, 0, 0);
  // A pair holds one place in every chain through it: alone at its place, it is in every longest chain.
  const places = new Int32Array(longest).fill(-1);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < m; j += 1) {
      if (!same(i, j)) continue;
      const place = of(before, i, j);
      if (place + 1 + of(after, i + 1, j + 1) === longest) places[place] = places[place] === -1 ? i * w + j : -2;
    }
  }
  const at = new Int32Array(n).fill(-1);
  const pairs: Array<readonly [number, number]> = [[-1, -1]];
  for (const cell of places) {
    if (cell < 0) continue;
    const i = Math.floor(cell / w);
    const j = cell % w;
    at[i] = j;
    pairs.push([i, j]);
  }
  pairs.push([n, m]);
  for (let k = 1; k < pairs.length; k += 1) {
    const [i0, j0] = pairs[k - 1] as readonly [number, number];
    const [i1, j1] = pairs[k] as readonly [number, number];
    const count = i1 - i0 - 1;
    if (count <= 0 || count !== j1 - j0 - 1) continue;
    const texts = new Set<number>();
    const seconds = new Set<number>();
    let sure = true;
    for (let d = 1; d <= count && sure; d += 1) {
      const hash = messages[j0 + d] as number;
      const second = times[j0 + d] as number;
      sure = ((bubbles[i0 + d] as number) === 0) === (hash === 0) && !seconds.has(second);
      seconds.add(second);
      if (hash !== 0) texts.add(hash);
    }
    for (let d = 1; d <= count && sure; d += 1) sure = !texts.has(bubbles[i0 + d] as number);
    if (sure) for (let d = 1; d <= count; d += 1) at[i0 + d] = j0 + d;
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
  /** MAIN heard a message of this group come or go: its order moved. `sent` — a person's message of the model that just came: the hub may know who. */
  changed(groupId: string, sent?: string): void;
  /** For a test and the diagnostics: runs labelled now. */
  shown(): number;
  dispose(): void;
}

export function createMessageAuthors(doc: Document, deps: MessageAuthorsDeps): MessageAuthors {
  let view: FanslyMessageAuthorsView | null = null;
  let container: Element | null = null;
  let groupId: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let run = 0;
  let disposed = false;
  /** MAIN's order of this chat while it has not moved; null — to be asked. */
  let held: FanslyOrder | null = null;
  /** How many times it moved: an answer asked before a move is drawn, never held. */
  let moves = 0;
  /** Passes in a row MAIN answered nothing for this chat. */
  let unknownPasses = 0;
  /** The model's messages come since the chat opened, not yet told to the application: each once. */
  const heard = new Set<string>();

  const observer = new MutationObserver(() => schedule());
  /** What the observer listens to now: each node once. */
  let watched = new WeakSet<Element>();

  const watch = (node: Element): void => {
    if (watched.has(node)) return;
    watched.add(node);
    observer.observe(node, { childList: true });
  };

  const unwatch = (): void => {
    observer.disconnect();
    watched = new WeakSet();
  };

  const moved = (): void => {
    held = null;
    moves += 1;
  };

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
      if (!kept && key !== null && stamp !== null && stamp.contains(node) && node.getAttribute(MESSAGE_AUTHOR_ATTRIBUTE) === key && intact) kept = true;
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
    const time = stamp.querySelector(TIME);
    if (time === null) stamp.prepend(span);
    else time.before(span);
  };

  const draw = (list: Element, shown: FanslyMessageAuthorsView, order: FanslyOrder): void => {
    const runs: { readonly node: Element; readonly stamp: Element | null; readonly bubbles: readonly Element[] }[] = [];
    const bubbles: { readonly bubble: Element; readonly hash: number }[] = [];
    // From the newest up, as far as MAIN could know them.
    const nodes = list.querySelectorAll(RUN);
    for (let r = nodes.length - 1; r >= 0 && bubbles.length < BUBBLES_MAX; r -= 1) {
      const node = nodes[r] as Element;
      const own = bubblesOf(node).filter(mine);
      const stamp = stampOf(node);
      if (own.length > 0 && stamp?.parentElement) watch(stamp.parentElement);
      runs.push({ node, stamp, bubbles: own });
      for (let b = own.length - 1; b >= 0; b -= 1) {
        const bubble = own[b] as Element;
        const text = ownText(bubble);
        bubbles.push({ bubble, hash: text === null ? 0 : textHash(text) });
      }
    }
    bubbles.reverse();
    const messages: { readonly id: string; readonly hash: number; readonly time: number }[] = [];
    for (let i = 0; i < order.ids.length; i += 1) {
      const bits = order.bits[i] ?? 0;
      if ((bits & FAN) !== 0 || (bits & DELETED) !== 0) continue;
      messages.push({ id: order.ids[i] as string, hash: order.hashes[i] ?? 0, time: order.times[i] ?? 0 });
    }
    const at = lineUp(bubbles.map((entry) => entry.hash), messages.map((message) => message.hash), messages.map((message) => message.time));
    const idOf = new Map<Element, string>();
    bubbles.forEach((entry, i) => {
      const message = messages[at[i] as number];
      if (message !== undefined) idOf.set(entry.bubble, message.id);
    });
    for (const { node, stamp, bubbles: own } of runs) {
      const authors: FanslyMessageAuthor[] = [];
      let unknown = 0;
      for (const bubble of own) {
        const id = idOf.get(bubble);
        // Lined up with nothing: not a message known to have no sender, only one not named.
        if (id === undefined) continue;
        const author = shown.byId.get(id);
        if (author === undefined) unknown += 1;
        else authors.push(author);
      }
      label(node, stamp, labelOf(authors, unknown, shown.unknown));
    }
  };

  /** The messages come since the last telling that the application has no sender for. */
  const tell = (shown: FanslyMessageAuthorsView): void => {
    if (heard.size === 0) return;
    const unknown = [...heard].filter((id) => !shown.byId.has(id));
    heard.clear();
    if (unknown.length > 0) shown.onUnknownLive?.(unknown);
  };

  const pass = async (): Promise<void> => {
    if (disposed) return;
    run += 1;
    const asked = run;
    const shown = view;
    const box = container !== null && container.isConnected ? container : null;
    const group = groupId;
    if (shown === null || box === null || group === null || shown.groupId !== group) {
      unwatch();
      remove(container);
      return;
    }
    tell(shown);
    const list = box.querySelector(LIST) ?? box;
    watch(list.querySelector(RUNS) ?? list);
    let order = held;
    if (order === null) {
      const movesAsked = moves;
      order = await deps.order(group).catch(() => null);
      if (disposed || asked !== run || view !== shown || groupId !== group || container !== box || !list.isConnected) return;
      if (order === null) {
        unknownPasses += 1;
        if (unknownPasses <= UNKNOWN_RETRIES) schedule(UNKNOWN_RETRY_MS);
        return;
      }
      unknownPasses = 0;
      if (movesAsked === moves) held = order;
    }
    draw(list, shown, order);
  };

  function schedule(ms: number = PASS_MS): void {
    if (disposed || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      void pass();
    }, ms);
  }

  return {
    set(next) {
      if (next === view) return;
      if (next === null) moved();
      view = next;
      schedule();
    },
    place(nextContainer, nextGroup) {
      if (nextContainer === container && nextGroup === groupId) return;
      if (container !== null && container !== nextContainer) remove(container);
      if (nextGroup !== groupId) {
        heard.clear();
        unknownPasses = 0;
      }
      moved();
      unwatch();
      container = nextContainer;
      groupId = nextGroup;
      schedule();
    },
    changed(changedGroup, sent) {
      if (changedGroup !== groupId) return;
      moved();
      if (sent !== undefined) heard.add(sent);
      if (view !== null) schedule();
    },
    shown: () => (container === null ? 0 : container.querySelectorAll(`[${MESSAGE_AUTHOR_ATTRIBUTE}]`).length),
    dispose() {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      unwatch();
      remove(container);
      container = null;
      view = null;
      held = null;
      heard.clear();
    },
  };
}
