// Web A's anchors and the open chat as its page shows it (docs/specs/2026-10-27-telegram-site.md §4.2; telegram-tt
// 6002824b). CSS-module classes are hashed in Telegram's build: only global classes are anchors.
//
// Two roots, each the active slide of its own `Transition` — Web A keeps the previous chat as a hidden slide in both
// (its own `EDITABLE_INPUT_CSS_SELECTOR`, src/config.ts, does the same):
// - the list and the field: `.messages-layout > .Transition > .Transition_slide-active`;
// - the header, a sibling of that `Transition` with its own (MiddleColumn.tsx, MiddleHeader.tsx):
//   `.messages-layout > .MiddleHeader > .Transition > .Transition_slide-active`, its `.ChatInfo .Avatar[data-peer-id]`.
// Any `.Avatar[data-peer-id]` elsewhere (the chat list) is never read; while either root has no active slide (an
// animation: Web A takes `-active` off during it), there is no chat. The quick preview (`#portals`) is never read.

export const TELEGRAM_SELECTORS = {
  /** The middle column's layout of an open chat. */
  layout: '.messages-layout',
  /** The list and the composer of the open chat. */
  listSlide: '.messages-layout > .Transition > .Transition_slide-active',
  /** The open chat's header. */
  headerSlide: '.messages-layout > .MiddleHeader > .Transition > .Transition_slide-active',
  /** The peer of the header's chat. */
  headerAvatar: '.ChatInfo .Avatar[data-peer-id]',
  headerName: '.ChatInfo .fullName',
  headerStatus: '.ChatInfo .user-status',
  /** The main field: the TipTap editor's root, or before it loads a stub with the same id and no `contenteditable`. */
  field: '#editable-message-text',
  /** The composer the field stands in: the dock goes in front of its input row. */
  composer: '.Composer',
  messageList: '.MessageList',
  messagesContainer: '.messages-container',
  message: '.Message.message-list-item',
  /** Rendered only while the viewport holds the newest messages (MessageListContent.tsx `isViewportNewest`). */
  bottomMarker: '.list-bottom-marker',
  /** The edit mode of a sent message: the composer's embedded message with the edit icon (ComposerEmbeddedMessage.tsx). */
  editing: '.ComposerEmbeddedMessage.open .embedded-left-icon .icon-edit',
  /** The attachment window's caption field (src/config.ts `EDITABLE_INPUT_MODAL_ID`): the main field is inactive then. */
  attachmentField: '#editable-message-text-modal',
} as const;

/**
 * Telegram's own accounts (src/config.ts): service notifications and login codes (777000), verification codes (489000),
 * replies (1271266957), the anonymous sender (2666000). Never a fan: no dock, nothing read.
 */
export const SERVICE_PEERS: ReadonlySet<string> = new Set(['777000', '489000', '1271266957', '2666000']);

/** A user's hash: digits only. A suffix (`_thread`, `_pinned`, `_scheduled`), a negative id (a group), a username: none. */
const PERSON_HASH = /^#([1-9]\d{0,19})$/;

/** The peer a hash names, when it names a person's chat; null otherwise. */
export function peerOfHash(hash: string): string | null {
  return PERSON_HASH.exec(hash)?.[1] ?? null;
}

/** «bot» in the header's status, in the page's language: best effort, never a promise (spec §4.2). */
const BOT_STATUS = /^(?:bot|бот)$/i;

/** The one element a selector finds under `root`; null — none, or more than one (an ambiguous page is no page). */
export function single(root: ParentNode, selector: string): Element | null {
  const found = root.querySelectorAll(selector);
  return found.length === 1 ? (found[0] ?? null) : null;
}

/** The open chat as the two active slides show it. */
export interface ChatDom {
  readonly listSlide: Element;
  readonly headerSlide: Element;
  /** The header's peer: one id, the same on every avatar of the header. */
  readonly peerId: string;
  /** The header's name as the page shows it; null — none. */
  readonly name: string | null;
  /** The header says «bot». */
  readonly bot: boolean;
  /** The main field under the list slide (the editor or its stub); null — none, or more than one. */
  readonly field: HTMLElement | null;
  /** The composer the field stands in; null — none. */
  readonly composer: Element | null;
}

/** The two active slides and the header's peer; null while either is missing or ambiguous (an animation, no chat). */
export function readChatDom(doc: Document): ChatDom | null {
  const listSlide = single(doc, TELEGRAM_SELECTORS.listSlide);
  const headerSlide = single(doc, TELEGRAM_SELECTORS.headerSlide);
  if (listSlide === null || headerSlide === null) return null;
  const peers = new Set([...headerSlide.querySelectorAll(TELEGRAM_SELECTORS.headerAvatar)].map((avatar) => avatar.getAttribute('data-peer-id') ?? ''));
  if (peers.size !== 1) return null;
  const peerId = [...peers][0] ?? '';
  if (!/^[1-9]\d{0,19}$/.test(peerId)) return null;
  const name = headerSlide.querySelector(TELEGRAM_SELECTORS.headerName)?.textContent?.trim().slice(0, 200) || null;
  const status = headerSlide.querySelector(TELEGRAM_SELECTORS.headerStatus)?.textContent?.trim() ?? '';
  const field = single(listSlide, TELEGRAM_SELECTORS.field) as HTMLElement | null;
  const composer = field?.closest(TELEGRAM_SELECTORS.composer) ?? null;
  return { listSlide, headerSlide, peerId, name, bot: BOT_STATUS.test(status), field, composer: composer !== null && listSlide.contains(composer) ? composer : null };
}

/** The field is the editor itself, not its stub: TipTap made it `contenteditable`. */
export function editable(field: HTMLElement | null): field is HTMLElement {
  return field !== null && field.isConnected && field.getAttribute('contenteditable') === 'true';
}

/** The page's own state around the open chat that the dock warns about (spec §4.3, §4.4). */
export interface PageState {
  /** The newest messages are rendered (`.list-bottom-marker`). */
  readonly newest: boolean;
  /** A sent message is being edited in the main field. */
  readonly editing: boolean;
  /** The attachment window is open: the main field is inactive, the caption is another field. */
  readonly attachment: boolean;
}

export function readPageState(doc: Document, listSlide: Element | null): PageState {
  return {
    newest: listSlide !== null && listSlide.querySelector(TELEGRAM_SELECTORS.bottomMarker) !== null,
    editing: listSlide !== null && listSlide.querySelector(TELEGRAM_SELECTORS.editing) !== null,
    attachment: doc.querySelector(TELEGRAM_SELECTORS.attachmentField) !== null,
  };
}

/**
 * The field's text as the person sees it: its paragraphs joined by line breaks, an emoji image by its `alt`, ProseMirror's
 * trailing break left out. What the draft read and the insert's read-back compare.
 */
export function fieldText(field: Element): string {
  const blocks = [...field.children];
  if (blocks.length === 0) return inlineText(field).trim() === '' ? '' : inlineText(field);
  const lines = blocks.map((block) => inlineText(block));
  // An empty editor is one empty paragraph.
  return lines.length === 1 && lines[0] === '' ? '' : lines.join('\n');
}

/** A block's inline text: text nodes, an image's `alt` (emoji), a hard break; ProseMirror's own trailing break is nothing. */
function inlineText(node: Node): string {
  let out = '';
  for (const child of node.childNodes) {
    if (child.nodeType === 3) out += (child as Text).data;
    else if (child.nodeType === 1) {
      const element = child as Element;
      const tag = element.tagName;
      if (tag === 'IMG') out += element.getAttribute('alt') ?? '';
      else if (tag === 'BR') out += element.classList.contains('ProseMirror-trailingBreak') ? '' : '\n';
      else out += inlineText(element);
    }
  }
  return out.replace(/\u00a0/g, ' ');
}
