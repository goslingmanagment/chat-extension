// The Telegram stand's own protocol: the test-control API of the page (`window.__tgStand`), the ids of its synthetic
// world and the attribute that says it booted. None of this is a Telegram contract — it exists so `pnpm see` and the
// e2e can drive the stand and read what happened on it. The page itself imitates Telegram Web A (telegram-tt
// 6002824b, the build web.telegram.org serves on 2026-10-27): its global class names, ids and mechanics, which are
// what the extension reads (docs/specs/2026-10-27-telegram-site.md §4).

/** The page's test-control API lives on `window[TELEGRAM_STAND_GLOBAL]`. */
export const TELEGRAM_STAND_GLOBAL = '__tgStand';

/** `<html data-stand-ready>`: `1` once the page is up, `failed` if its boot threw. */
export const TELEGRAM_STAND_READY_ATTRIBUTE = 'data-stand-ready';

/** Where Web A lives on its origin: the page is `/a/`, the chat is the hash (`/a/#5550001001`). */
export const TELEGRAM_STAND_PATH = '/a/';

/** The synthetic world's ids. Telegram user ids are decimal strings; a chat with a person is the person's id. */
export const TELEGRAM_STAND_IDS = {
  /** The active account of slot 1 (no `?account=`): Lora, the account the fake hub's Telegram page is bound to. */
  account: '7700100200',
  /** Slot 2 (`?account=2`): another account in the same browser, bound to no page. */
  otherAccount: '7700100299',
  /** The legacy `user_auth` key's id: never the active account's, so a reader of it is caught. */
  legacyUser: '7700100777',
  chats: {
    /** Jamie: English, a long history over several days (quotes, emoji, every media kind, a call, a service line). */
    jamie: '5550001001',
    /** Саша: Russian. */
    sasha: '5550001002',
    /** Mike: English, the account's clock in 12-hour time («2:05 PM»). */
    mike: '5550001003',
    /** A bot: its header status is «bot». */
    bot: '5550001900',
    /** Telegram's own service chat. */
    service: '777000',
  },
} as const;

/** One send the page's composer made (Enter, ⌘/Ctrl+Enter, the Send button): what a scenario checks stayed empty. */
export interface TelegramStandSend {
  /** The chat's peer id. */
  readonly chat: string;
  readonly text: string;
  /** Epoch ms. */
  readonly at: number;
  /** How: the main field, the attachment window's caption, or an edit of a sent message. */
  readonly kind: 'message' | 'attachment' | 'edit';
}

/** `window.__tgStand`, called by scenarios with `browser.execute`. */
export interface TelegramStandControl {
  /** The open chat's peer id (the hash), or null. */
  chat(): string | null;
  /** The active account's user id (the URL's slot). */
  account(): string;
  /** Opens a chat as a click on its row does: `pushState('#<id>')` (no `hashchange`), the slides animate ~300 ms. */
  openChat(peerId: string): void;
  /** A message of the fan arrives in his chat (rendered where the newest messages are). */
  incoming(peerId: string, text: string): void;
  /** The open chat's viewport leaves the newest messages: the newest ones and `.list-bottom-marker` are not rendered. */
  scrollUp(): void;
  /** Back to the newest messages: they and the marker are rendered again. */
  scrollDown(): void;
  /** The attachment window (`#portals`, its caption field): the main field is inactive while it is open. */
  openAttachment(): void;
  closeAttachment(): void;
  /** The edit mode of the last own message: `.ComposerEmbeddedMessage` with the edit icon, the field holds its text. */
  editLast(): void;
  /** Leaves the edit mode (the field is emptied, as Web A does). */
  cancelEdit(): void;
  /** The open chat's main field as text: paragraphs joined by `\n`; null — no editor yet (the stub). */
  fieldText(): string | null;
  /** The attachment window's caption as text; null — the window is closed. */
  captionText(): string | null;
  /** Inserts text at the end of the open chat's field as the editor's own command (lines become paragraphs). */
  typeInField(text: string): void;
  /** Empties the open chat's field. */
  clearField(): void;
  /** Every send of this page load, oldest first. */
  readonly sent: TelegramStandSend[];
}
