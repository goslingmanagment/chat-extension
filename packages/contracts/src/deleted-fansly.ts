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

/** The open chat's length as the header's badge shows it. */
export interface ChatLengthView {
  /** Every message of the chat, both sides, deleted ones included; null — the hub cannot say exactly, so no count. */
  readonly messages: number | null;
  /** When the chat began, epoch ms: its first message, or the moment Fansly made the chat when the hub cannot say. */
  readonly since: number;
}

export interface ChatLengthClient {
  /** null — no badge: no one-to-one chat open, or its read has not answered. */
  view(): ChatLengthView | null;
  subscribe(listener: (view: ChatLengthView | null) => void): () => void;
}

/** The badge's words by the tab's language (core domain/hosts/fansly/i18n/chat-length.ts). */
export interface ChatLengthCopy {
  /** How long ago it began, short: «сегодня», «5 дн», «3 нед», «4 мес», «1 г 3 мес». */
  age(since: number, now: number): string;
  /** The count as the badge shows it: «38 888». */
  count(messages: number): string;
  /** The badge's title and what a screen reader hears: «428 сообщений с 12 августа 2025». */
  title(messages: number | null, since: number): string;
}
