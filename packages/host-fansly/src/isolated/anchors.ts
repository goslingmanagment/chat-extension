// The anchors of Fansly's open chat and the observers that find them
// (docs/project-unite/architecture.md §7.3; FS-PLC-4, FS-RTE-2, FS-CTR-2).
//
// Anchors only through the route: the mini-chat, the gallery, the new-message
// modal and the message editors repeat the same classes (S2 Q7), so every
// anchor of the chat is looked for inside `app-messages-conversation-route`
// and down its own chain — `> app-group-message-container > app-group-
// message-input textarea.message-input` —, never in the document at large.
//
// Two lifecycles of observers:
// 1. SEARCH. At document_start there is no `div.content-wrapper` yet: one
//    `childList + subtree` observer on the document looks for the anchors the
//    address expects and stops as soon as they are found. It comes back only
//    when an expected one is gone, and only for a while (SEARCH_MS): a page
//    that never shows it is a broken anchor, not a reason to watch the whole
//    document for ever. A route signal or a working observer starts it again.
// 2. WORK. `childList` without `subtree` on `div.content-wrapper` (the routed
//    page comes and goes), `div.messages-content-wrapper` (a conversation or
//    none) and `app-messages-conversation-route` (a chat switch re-creates the
//    container and the header's contact block; the gallery takes both away
//    without a change of address). Their targets move with the page; nothing
//    under the feed or the header is watched — FBuddy's nodes and the typing
//    line live there and change with every keystroke of the fan. And two
//    NARROW ones (R20 P7d), `childList` without `subtree` too: on
//    `app-group-message-input` — its children are the field's branches: the
//    DM rules unmet put `div.no-dm-allowed` there (the field's branch gets
//    `hidden`), and the field's own `div.message-composer` is made anew
//    without a change of address — and on the header's row with the back
//    button (`.message-content-header > .flex-col > .flex-row`), where the
//    contact block stands under its `ngIf` and is made anew when the number
//    of participants changes (main:74512). The voice recorder changes a
//    button inside `.actions`, an attachment comes inside
//    `.message-attachments`, FBuddy adds its node to the header itself:
//    none of it is a child of these two, none of it wakes us. The narrow
//    targets move with every reading of the anchors, as the working ones do.
//    Idle, every observer here is silent.
//
// Every callback of these observers is a route signal (route.ts): Fansly
// re-creates the container in the same task as its `pushState`, so a change
// of chat is seen here before anything else. Then the anchors are read again,
// and whoever listens hears of a change.
//
// The contract's DOM anchors (§7.12) are judged here too (`judgeAnchors`):
// an anchor is judged only where the page must show it — a node absent while
// the page is still on its way, in the gallery or off its route is
// `notYet` (or keeps what it was): no break. Selectors are plain data;
// tools/host-contract-check (P7h) compares them with a copy of Fansly's bundle.

import type { RouteWatcher } from './route';

/** Where the anchors of Fansly's chat are (§7.3, fansly-web.md §3). */
export const FANSLY_SELECTORS = {
  contentWrapper: 'content-wrapper',
  messagesWrapper: 'messages-content-wrapper',
  /** The inbox, a virtual list: its rows are `a[href="/messages/<groupId>"]` (navigate.ts). */
  inbox: 'messages-list-wrapper',
  conversationRoute: 'app-messages-conversation-route',
  /** A direct child of the conversation route (as are `header` and `gallery`). */
  container: 'app-group-message-container',
  header: 'div.message-content-header',
  /** `> .flex-col > .flex-row` of the header: the row with the back button, where the contact block stands. */
  headerColumn: 'div.flex-col',
  headerRow: 'div.flex-row',
  backButton: '.back-button',
  headerContact: '.message-content-header-contact',
  headerSubRow: '.content-header-sub-row',
  /** The contact block's name: Fansly's account component and its display name, cut at 10 characters (whole-name.ts). */
  headerAccount: 'app-account-username',
  headerName: '.display-name',
  gallery: 'app-group-media-offers',
  /** A direct child of the container. */
  composer: 'app-group-message-input',
  textarea: 'textarea.message-input',
  sendButton: '.send-button',
  fileInput: '.collapsable-actions > input[type=file]',
  attachments: 'div.message-attachments',
  /** Direct children of the composer: its branches when the DM rules are not met. */
  noDmAllowed: 'div.no-dm-allowed',
  composerHidden: 'div.message-composer.hidden',
  /** On `<body>` while a modal of Fansly is open. */
  modalFlag: 'modal-opened',
  /** On `<html>`: the theme Fansly shows. */
  themeClasses: ['bright-theme', 'dark-theme'],
  vaultPath: '/creator/vault',
  vaultUpload: 'app-media-upload-input input[type=file]',
} as const;

/** How long one search over the whole document may go on before an expected anchor counts as gone. */
export const SEARCH_MS = 30_000;

/** The open chat's nodes under the conversation route, read in one go. */
export interface ConversationAnchors {
  readonly route: Element;
  readonly header: Element | null;
  /** The header's row with the back button: the contact block's parent (the narrow observer's target). */
  readonly headerRow: Element | null;
  readonly contact: Element | null;
  readonly subRow: Element | null;
  /** The gallery stands instead of the header and the container (no change of address). */
  readonly gallery: boolean;
  readonly container: Element | null;
  readonly composer: Element | null;
  readonly textarea: HTMLTextAreaElement | null;
  readonly sendButton: Element | null;
  readonly fileInput: Element | null;
  readonly attachments: Element | null;
  /** The DM rules are not met: `div.no-dm-allowed`, the field's branch hidden (FS-DOCK-3). */
  readonly copyOnly: boolean;
  /** A message field under the route outside the container's chain: Fansly changed that chain (a new build). */
  readonly strayField: boolean;
  /**
   * The box of a field the chain does not reach — under the route without the container's anchor, or in the container
   * without the composer's — that the dock stands over as a fixed overlay (FS-PLC-3); null — the chain is whole, or no
   * field. Its parent is watched by a narrow observer: a box made anew is a new anchor (R20 P7d).
   */
  readonly strayBox: Element | null;
}

export interface PageAnchors {
  readonly contentWrapper: Element | null;
  readonly messagesWrapper: Element | null;
  /** The conversation route and what stands under it; null — no conversation on the page. */
  readonly conversation: ConversationAnchors | null;
}

const NONE: PageAnchors = { contentWrapper: null, messagesWrapper: null, conversation: null };

/** The first `div` of a class, inside `within` when given: Fansly's own wrappers are divs. */
function firstDiv(list: HTMLCollectionOf<Element>, within: Element | null): Element | null {
  for (const element of list) {
    if (element.tagName === 'DIV' && (within === null || within.contains(element))) return element;
  }
  return null;
}

/**
 * A direct child that matches: looked for among the children only — `querySelector(':scope > …')` would walk the
 * whole subtree first (the container's feed has thousands of nodes before its composer).
 */
function childMatching(parent: Element, selector: string): Element | null {
  for (const child of parent.children) if (child.matches(selector)) return child;
  return null;
}

/** The header's row with the back button (the first row of its column when none has one). */
function headerRowOf(header: Element | null): Element | null {
  const s = FANSLY_SELECTORS;
  const column = header === null ? null : childMatching(header, s.headerColumn);
  if (column === null) return null;
  let first: Element | null = null;
  for (const child of column.children) {
    if (!child.matches(s.headerRow)) continue;
    if (childMatching(child, s.backButton) !== null) return child;
    first ??= child;
  }
  return first;
}

/** How far up from a stray field its box is looked for, and the narrowest box that is a composer's. */
const BOX_DEPTH = 6;
const MIN_COMPOSER_WIDTH = 240;

/**
 * The box of a field found under `within` outside the chain: its composer (`app-group-message-input`) where there is
 * one, else its nearest ancestor as wide as a composer. Read only when the chain is broken: a layout read.
 */
function strayBoxIn(within: Element): Element | null {
  const s = FANSLY_SELECTORS;
  const field = within.querySelector(s.textarea);
  if (field === null) return null;
  const composer = field.closest(s.composer);
  if (composer !== null && within.contains(composer)) return composer;
  let node = field.parentElement;
  for (let depth = 0; node !== null && node !== within && depth < BOX_DEPTH; depth += 1, node = node.parentElement) {
    if (node.getBoundingClientRect().width >= MIN_COMPOSER_WIDTH) return node;
  }
  return field.parentElement;
}

/** Reads the open chat's nodes from the conversation route down its own chain (§7.3). */
export function locateConversation(route: Element): ConversationAnchors {
  const s = FANSLY_SELECTORS;
  const header = childMatching(route, s.header);
  const contact = header?.querySelector(s.headerContact) ?? null;
  const container = childMatching(route, s.container);
  const composer = container === null ? null : childMatching(container, s.composer);
  const textarea = composer?.querySelector<HTMLTextAreaElement>(s.textarea) ?? null;
  return {
    route,
    header,
    headerRow: headerRowOf(header),
    contact,
    subRow: contact?.querySelector(s.headerSubRow) ?? null,
    gallery: container === null && childMatching(route, s.gallery) !== null,
    container,
    composer,
    textarea,
    sendButton: composer?.querySelector(s.sendButton) ?? null,
    fileInput: composer?.querySelector(s.fileInput) ?? null,
    attachments: composer?.querySelector(s.attachments) ?? null,
    copyOnly: composer !== null && (childMatching(composer, s.noDmAllowed) !== null || childMatching(composer, s.composerHidden) !== null),
    strayField: container === null && route.querySelector(s.textarea) !== null,
    strayBox: container === null ? strayBoxIn(route) : composer === null ? strayBoxIn(container) : null,
  };
}

const sameConversation = (a: ConversationAnchors | null, b: ConversationAnchors | null): boolean => {
  if (a === null || b === null) return a === b;
  return (
    a.route === b.route &&
    a.header === b.header &&
    a.headerRow === b.headerRow &&
    a.contact === b.contact &&
    a.subRow === b.subRow &&
    a.gallery === b.gallery &&
    a.container === b.container &&
    a.composer === b.composer &&
    a.textarea === b.textarea &&
    a.sendButton === b.sendButton &&
    a.fileInput === b.fileInput &&
    a.attachments === b.attachments &&
    a.copyOnly === b.copyOnly &&
    a.strayField === b.strayField &&
    a.strayBox === b.strayBox
  );
};

const samePage = (a: PageAnchors, b: PageAnchors): boolean => a.contentWrapper === b.contentWrapper && a.messagesWrapper === b.messagesWrapper && sameConversation(a.conversation, b.conversation);

export interface AnchorStats {
  /** Searches over the whole document started since the start. */
  readonly searches: number;
  readonly searching: boolean;
  /** The last search ran out of time with an expected anchor still missing. */
  readonly exhausted: boolean;
  /** Callbacks of the working observers since the start. */
  readonly workCallbacks: number;
  /** Callbacks of the narrow observers (the composer's branches, the header's row) since the start. */
  readonly narrowCallbacks: number;
}

export interface AnchorWatcher {
  current(): PageAnchors;
  /** Reads the anchors again now (an action of ours is about to use them). */
  refresh(): void;
  onChange(listener: (anchors: PageAnchors) => void): () => void;
  stats(): AnchorStats;
  dispose(): void;
}

export interface AnchorOptions {
  /** A search's time limit (SEARCH_MS by default). */
  readonly searchMs?: number;
}

/**
 * Starts the search for the anchors the address expects, synchronously at document_start (no style is touched, no
 * node is made), and the working observers once they are there.
 */
export function createAnchorWatcher(doc: Document, route: RouteWatcher, options: AnchorOptions = {}): AnchorWatcher {
  const searchMs = options.searchMs ?? SEARCH_MS;
  // Live collections: reading them on a callback costs no walk of the document.
  const contentWrappers = doc.getElementsByClassName(FANSLY_SELECTORS.contentWrapper);
  const messagesWrappers = doc.getElementsByClassName(FANSLY_SELECTORS.messagesWrapper);
  let anchors: PageAnchors = NONE;
  let disposed = false;
  let searching = false;
  let exhausted = false;
  let searches = 0;
  let workCallbacks = 0;
  let narrowCallbacks = 0;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let watched: readonly Element[] = [];
  let narrowed: readonly Element[] = [];
  const listeners = new Set<(anchors: PageAnchors) => void>();

  const locate = (): PageAnchors => {
    const contentWrapper = firstDiv(contentWrappers, null);
    const messagesWrapper = contentWrapper === null ? null : firstDiv(messagesWrappers, contentWrapper);
    const conversationRoute = messagesWrapper?.querySelector(FANSLY_SELECTORS.conversationRoute) ?? null;
    return { contentWrapper, messagesWrapper, conversation: conversationRoute === null ? null : locateConversation(conversationRoute) };
  };

  /** Whether the anchors the address expects are all there: the wrappers of its page and, in a chat, the conversation route. */
  const complete = (found: PageAnchors): boolean => {
    const { path, groupId } = route.current();
    if (found.contentWrapper === null) return false;
    if (!path.startsWith('/messages')) return true;
    if (found.messagesWrapper === null) return false;
    return groupId === null || found.conversation !== null;
  };

  const onMutations = (): void => {
    if (disposed) return;
    // The address first: a chat switch is a new route before its nodes are read.
    route.signal('observer');
    resolve();
  };
  const search = new MutationObserver(onMutations);
  const work = new MutationObserver(() => {
    workCallbacks += 1;
    onMutations();
  });
  const narrow = new MutationObserver(() => {
    narrowCallbacks += 1;
    onMutations();
  });

  const stopSearch = (): void => {
    if (!searching) return;
    searching = false;
    search.disconnect();
    if (searchTimer !== null) clearTimeout(searchTimer);
    searchTimer = null;
  };
  const startSearch = (): void => {
    if (searching || exhausted || disposed) return;
    searching = true;
    searches += 1;
    search.observe(doc, { childList: true, subtree: true });
    searchTimer = setTimeout(() => {
      searchTimer = null;
      stopSearch();
      exhausted = true;
      // The time ran out: what is still missing is judged as missing now.
      notify();
    }, searchMs);
  };

  const same = (a: readonly Element[], b: readonly Element[]): boolean => a.length === b.length && a.every((target, index) => target === b[index]);
  const present = (targets: ReadonlyArray<Element | null | undefined>): Element[] => targets.filter((target): target is Element => target !== null && target !== undefined);
  /**
   * The working observers stand on the wrappers and the route that are there now, the narrow ones on the open chat's
   * composer and header row — and on nothing else.
   */
  const watch = (found: PageAnchors): void => {
    const targets = present([found.contentWrapper, found.messagesWrapper, found.conversation?.route]);
    if (!same(targets, watched)) {
      work.disconnect();
      for (const target of targets) work.observe(target, { childList: true });
      watched = targets;
    }
    const narrowTargets = present([found.conversation?.composer, found.conversation?.headerRow, found.conversation?.strayBox?.parentElement]);
    if (!same(narrowTargets, narrowed)) {
      narrow.disconnect();
      for (const target of narrowTargets) narrow.observe(target, { childList: true });
      narrowed = narrowTargets;
    }
  };

  const notify = (): void => {
    for (const listener of [...listeners]) listener(anchors);
  };

  function resolve(): void {
    if (disposed) return;
    const found = locate();
    watch(found);
    if (complete(found)) stopSearch();
    else startSearch();
    if (samePage(found, anchors)) return;
    anchors = found;
    notify();
  }

  // A new address expects other anchors: the search may run again for it.
  const offRoute = route.onChange(() => {
    exhausted = false;
    resolve();
  });
  resolve();

  return {
    current: () => anchors,
    refresh: resolve,
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    stats: () => ({ searches, searching, exhausted, workCallbacks, narrowCallbacks }),
    dispose() {
      if (disposed) return;
      disposed = true;
      offRoute();
      stopSearch();
      work.disconnect();
      narrow.disconnect();
      watched = [];
      narrowed = [];
      listeners.clear();
      anchors = NONE;
    },
  };
}

// ── The contract's DOM anchors (§7.12) ─────────────────────────────────────

/** Fansly's anchors the isolated side checks in the page (contracts FANSLY_ANCHOR_IDS but the network four). */
export const DOM_ANCHORS = [
  'conversationRoute',
  'container',
  'composer',
  'textarea',
  'sendButton',
  'fileInput',
  'headerContact',
  'headerSubRow',
  'attachments',
  'noDmAllowed',
  'modalFlag',
  'themeClass',
  'vaultUpload',
] as const;
export type DomAnchor = (typeof DOM_ANCHORS)[number];
export type AnchorState = 'ok' | 'missing' | 'shape' | 'notYet';
export type DomAnchorStates = Readonly<Record<DomAnchor, AnchorState>>;

export const DOM_ANCHORS_NOT_YET: DomAnchorStates = Object.fromEntries(DOM_ANCHORS.map((anchor) => [anchor, 'notYet'])) as Record<DomAnchor, AnchorState>;

export interface JudgeFacts {
  readonly anchors: PageAnchors;
  /** The address is a conversation. */
  readonly chat: boolean;
  readonly path: string;
  /** The search for the expected anchors ran out of time. */
  readonly exhausted: boolean;
  /** MAIN says the open group is a direct chat (one fan): its header must show the contact block. */
  readonly direct: boolean;
}

/**
 * The DOM anchors as the contract report names them (FS-CTR-1): judged where the page must show a node, kept as they
 * were where it need not (the page still on its way, the gallery, another route) — `notYet` until first judged. A
 * branch the page shows only sometimes (`noDmAllowed`, `modalFlag`) is `ok` once seen and `notYet` before: its
 * absence is the normal state. `vaultUpload` is there only on the vault page, the owner's switch: `missing` elsewhere.
 */
export function judgeAnchors(doc: Document, facts: JudgeFacts, before: DomAnchorStates): DomAnchorStates {
  const next: Record<DomAnchor, AnchorState> = { ...before };
  const present = (node: Element | null): AnchorState => (node === null ? 'missing' : 'ok');
  const conversation = facts.anchors.conversation;
  if (facts.chat) {
    if (conversation !== null) next.conversationRoute = 'ok';
    else if (facts.exhausted) next.conversationRoute = 'missing';
  }
  if (conversation !== null) {
    if (conversation.container !== null) {
      next.container = 'ok';
      next.composer = present(conversation.composer);
      next.textarea = present(conversation.textarea);
      next.sendButton = present(conversation.sendButton);
      next.fileInput = present(conversation.fileInput);
      next.attachments = present(conversation.attachments);
    } else if (conversation.strayField) {
      // A field stands under the route, and not where the chain says: the container's anchor is gone (FS-PLC-3).
      next.container = 'missing';
    }
    if (conversation.contact !== null) {
      next.headerContact = 'ok';
      next.headerSubRow = present(conversation.subRow);
    } else if (facts.direct && conversation.header !== null && conversation.container !== null) {
      // A direct chat, rendered, its header there and no contact block: the anchor is gone in a new build (FS-REG-4).
      next.headerContact = 'missing';
      next.headerSubRow = 'missing';
    }
    if (conversation.copyOnly && conversation.composer !== null && childMatching(conversation.composer, FANSLY_SELECTORS.noDmAllowed) !== null) next.noDmAllowed = 'ok';
  }
  if (doc.body?.classList.contains(FANSLY_SELECTORS.modalFlag) === true) next.modalFlag = 'ok';
  const root = doc.documentElement as HTMLElement | null;
  if (root !== null && FANSLY_SELECTORS.themeClasses.some((name) => root.classList.contains(name))) next.themeClass = 'ok';
  next.vaultUpload = facts.path.startsWith(FANSLY_SELECTORS.vaultPath) && doc.querySelector(FANSLY_SELECTORS.vaultUpload) !== null ? 'ok' : 'missing';
  return next;
}
