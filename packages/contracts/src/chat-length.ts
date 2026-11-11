// The open chat's length in the site's own chat header, on every site that has it: how many messages the chat ever had,
// since when, how often, and who wrote them. One badge and one card for both sites (ui/chat-length), each site's own
// read and words.
//
// 2026-11-08, the owner on Fansly: «хочу еще видеть сколько было месаг с челом… чтобы чаттеры видели как давно
// общение», «без лишних запросов и точно»: from the same hub read as «Удалил» (`clientDeletedMessages` with the group).
// 2026-11-11, the owner: «Хочу видеть здесь разбивку еще, чтобы писалось, кто из чатеров сколько сообщений оставил»:
// its card also says who wrote how many. The same day, of ChatSpace: «и с хуя ли на чатспейсе его нет? там же все то
// же самое нужно и по идее можно»: the same badge in ChatSpace's conversation header, from the same hub read with the
// fan as the conversation (on OnlyFans the chat is the fan). There the hub cannot prove a chat's first message, so it
// counts what its archive holds (`approximate`), and the card says so.
//
// Moved out of Fansly's modules (deleted-fansly.ts, tab-messages-fansly.ts) that day: what both sites' tabs and
// backgrounds share lives here.

import * as z from 'zod/mini';

import { CHAT_AUTHORS_MAX } from './hub/deleted';
import { CountSchema, IsoTimestampSchema, boundedText } from './primitives';

export const CHAT_LENGTH_LIMITS = {
  /** The chatters of the card (hub `CLIENT_CHAT_LENGTH_CHATTERS_MAX`) and one's login, far above a real one. */
  authorsMax: CHAT_AUTHORS_MAX,
  authorNameMaxChars: 120,
} as const;

/**
 * Who wrote the chat's messages, as a tab takes it: each chatter's count as the hub recorded their sends (the most
 * first; `isMe` — the person in this tab), the fan's, and the page's messages with no known author. `fan` and
 * `unattributed` are null while the chat's count is.
 */
export const ChatAuthorsSchema = z.strictObject({
  chatters: z
    .array(z.strictObject({ name: boundedText(CHAT_LENGTH_LIMITS.authorNameMaxChars), isMe: z.boolean(), messages: z.int().check(z.gte(1)) }))
    .check(z.maxLength(CHAT_LENGTH_LIMITS.authorsMax)),
  fan: z.nullable(CountSchema),
  unattributed: z.nullable(CountSchema),
});
export type ChatAuthors = z.infer<typeof ChatAuthorsSchema>;

/**
 * The open chat's length as a tab takes it: `messages` and `firstMessageAt` as the hub knows them, null when it cannot
 * say. `authors` null — a hub before 2026-11-11, or an answer that did not read. `approximate` — the hub has no proof
 * of the chat's first message (an OnlyFans page): the numbers are what its archive holds, the oldest messages may be
 * missing.
 */
export const ChatLengthSchema = z.strictObject({
  messages: z.nullable(CountSchema),
  firstMessageAt: z.nullable(IsoTimestampSchema),
  authors: z.nullable(ChatAuthorsSchema),
  approximate: z.boolean(),
});
export type ChatLength = z.infer<typeof ChatLengthSchema>;

// ── what the header shows ───────────────────────────────────────────────────

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
  /** The page's messages with no known author (mass messages, sends from elsewhere, before authors were recorded); null with `fan`. */
  readonly unattributed: number | null;
}

/** The open chat's length as the header's badge shows it. */
export interface ChatLengthView {
  /** Every message of the chat, both sides, deleted ones included; null — the hub cannot say exactly, so no count. */
  readonly messages: number | null;
  /** When the chat began, epoch ms: its first message, or (Fansly) the moment the site made the chat when the hub cannot say. */
  readonly since: number;
  /** Who wrote them; null — nothing to break down (a hub before 2026-11-11, or neither a fan's count nor a chatter). */
  readonly authors: ChatAuthorsView | null;
  /** The numbers are what the hub has seen, not proven from the chat's first message: the card says so. */
  readonly approximate: boolean;
}

export interface ChatLengthClient {
  /** null — no badge: no one-to-one chat open, or its read has not answered. */
  view(): ChatLengthView | null;
  subscribe(listener: (view: ChatLengthView | null) => void): () => void;
}

/** The badge's words by the tab's language (core domain/chat-length: each site's own catalog of them). */
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
  /** The card's last line when the numbers are what the hub has seen (`approximate`). */
  readonly approximate: string;
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
