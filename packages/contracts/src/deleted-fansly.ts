// «Фан удалил» in Fansly's chat header (hub `clientDeletedMessages`; 2026-11-03, the owner: «показывать удаленные
// сообщения фана», a mark in the header): the header's own client, like the marks'; no DOM or network. The open fan's
// messages the page's socket saw deleted, with the text the hub kept. It disables nothing.

/** One deleted message as the card shows it. */
export interface DeletedMessageView {
  readonly id: string;
  /** "" — a message without text (media only); null — the hub kept no text. */
  readonly text: string | null;
  readonly attachments: number;
  /** Epoch ms; null — not known. */
  readonly sentAt: number | null;
  readonly deletedAt: number;
  /** Deleted lately and not yet seen in this tab: the mark stands out until the card is opened. */
  readonly fresh: boolean;
}

export interface DeletedMessagesView {
  /** All of the fan's deleted messages the hub knows; 0 — no mark. */
  readonly total: number;
  /** The latest deleted first, up to the hub's cap. */
  readonly messages: readonly DeletedMessageView[];
  /** How many of them are fresh. */
  readonly fresh: number;
}

export interface DeletedMessagesClient {
  view(): DeletedMessagesView;
  subscribe(listener: (view: DeletedMessagesView) => void): () => void;
  /** The card was opened: what it shows is seen, nothing of it is fresh any more. */
  seen(): void;
}

/** The words of the mark and its card, by the tab's language (core domain/hosts/fansly/i18n/deleted.ts). */
export interface DeletedMessagesCopy {
  /** The mark's word before its count: «Удалил». */
  readonly mark: string;
  /** The mark for a screen reader and its title: «Фан удалил 2 сообщения». */
  title(count: number): string;
  /** Under the card's title: the fan does not know, so the chatter neither quotes nor hints. */
  readonly hint: string;
  /** When it was sent and how soon it went: «сегодня 21:49 · удалил через 8 с». */
  meta(sentAt: number | null, deletedAt: number, now: number): string;
  /** The tag of a fresh message. */
  readonly fresh: string;
  /** A message without text. */
  readonly noText: string;
  /** A message whose text the hub did not keep. */
  readonly notKept: string;
  /** «1 вложение»: the media are not shown. */
  attachments(count: number): string;
  /** Under the list when the hub answered fewer than all: «Ещё 233 удалённых раньше здесь нет». */
  more(count: number): string;
}

// ── the chat's length (2026-11-08) ────────────────────────────────────────────
// The owner: «хочу еще видеть сколько было месаг с челом… чтобы чаттеры видели как давно общение», «без лишних запросов и
// точно». A badge in the same header, from the same read as «Удалил» (hub `clientDeletedMessages` with the group).
// 2026-11-11, the owner: «Хочу видеть здесь разбивку еще, чтобы писалось, кто из чатеров сколько сообщений оставил»:
// its card also says who wrote how many.

/** One chatter's messages in the chat, as the hub recorded their sends. */
export interface ChatAuthorView {
  /** The chatter's hub login. */
  readonly name: string;
  /** The person in this tab. */
  readonly isMe: boolean;
  readonly messages: number;
}

/** Who wrote the chat's messages; something to show in each (a fan's count or a chatter). */
export interface ChatAuthorsView {
  /** The most messages first, as the hub ordered them. */
  readonly chatters: readonly ChatAuthorView[];
  /** The fan's messages; null — the hub cannot say (no count of the chat). */
  readonly fan: number | null;
  /** The page's messages with no known author (mass messages, sends from elsewhere, before 2026-10-24); null with `fan`. */
  readonly unattributed: number | null;
}

/** The open chat's length as the header's badge shows it. */
export interface ChatLengthView {
  /** Every message of the chat, both sides, deleted ones included; null — the hub cannot say exactly, so no count. */
  readonly messages: number | null;
  /** When the chat began, epoch ms: its first message, or the moment Fansly made the chat when the hub cannot say. */
  readonly since: number;
  /** Who wrote them; null — nothing to break down (a hub before 2026-11-11, or neither a fan's count nor a chatter). */
  readonly authors: ChatAuthorsView | null;
}

export interface ChatLengthClient {
  /** null — no badge: no one-to-one chat open, or its read has not answered. */
  view(): ChatLengthView | null;
  subscribe(listener: (view: ChatLengthView | null) => void): () => void;
}

/** The badge's words by the tab's language (core domain/hosts/fansly/i18n/chat-length.ts). */
export interface ChatLengthCopy {
  /** The badge with no count: how long ago it began, short: «сегодня», «5 дн», «3 нед», «4 мес», «1 г 3 мес». */
  age(since: number, now: number): string;
  /** The count as the badge shows it: «38 888». */
  count(messages: number): string;
  /** What a screen reader hears of the badge: «428 сообщений с 12 августа 2025». */
  title(messages: number | null, since: number): string;
  /** The card's head: «428 сообщений»; no count: «Переписка». */
  heading(messages: number | null): string;
  /** The card: when it began and how long that is: «с 3 августа 2026 · 3 месяца». */
  since(since: number, now: number): string;
  /** The card: how often, on average: «в среднем 4 сообщения в день»; null: too young to say. */
  pace(messages: number, since: number, now: number): string | null;
  /** The card with no count: why there is none. */
  readonly unknown: string;
  /** The card's breakdown for a screen reader: «Кто сколько написал». */
  readonly authors: string;
  /** Its row of the fan: «Фан». */
  readonly fan: string;
  /** After the person's own login: «(вы)». */
  readonly me: string;
  /** Its row of the messages nobody is known for: «Без автора». */
  readonly unattributed: string;
  /** Under that row: what those are. */
  readonly unattributedHint: string;
}
