// The open chat's length in the site's chat header (contracts chat-length.ts): what the badge shows of a read's answer,
// and the client of a site whose length is a read of its own. One badge for both sites (2026-11-11, the owner of
// ChatSpace: «и с хуя ли на чатспейсе его нет? там же все то же самое нужно и по идее можно»).
//
// - Fansly's length rides on the «Удалил» read (application/hosts/fansly/deleted.ts) and takes only the view from here,
//   with the chat's own id for a start the hub cannot say.
// - ChatSpace's is a read of its own (`createChatLength`): one when a chat opens (the person opened it), none while it
//   stays open; the tab keeps the last answers of this document, so a chat opened again shows its badge at once while
//   its read runs. Nothing while no chat is open, nothing while loading, nothing on a failed read. No date of its own:
//   no answer, no badge.
import type { ChatAuthorsView, ChatLength, ChatLengthClient, ChatLengthView } from '@cg/contracts/chat-length';

/** The card's breakdown of an answer: null when it has neither the fan's count nor a chatter. */
function chatAuthorsView(authors: ChatLength['authors'] | undefined): ChatAuthorsView | null {
  if (authors === null || authors === undefined || (authors.fan === null && authors.chatters.length === 0)) return null;
  return { chatters: authors.chatters.map(({ name, isMe, messages }) => ({ name, isMe, messages })), fan: authors.fan, unattributed: authors.unattributed };
}

/**
 * What the badge shows of an answer: the hub's count and first message when it has them; otherwise no count, and
 * `fallbackSince` for when the chat began (Fansly: the moment it made the chat, from its id). null — no start reads.
 */
export function chatLengthView(chat: ChatLength | null | undefined, fallbackSince: number | null): ChatLengthView | null {
  const firstAt = chat?.firstMessageAt ?? null;
  const first = firstAt === null ? Number.NaN : Date.parse(firstAt);
  const since = Number.isFinite(first) ? first : fallbackSince;
  if (since === null) return null;
  return { messages: chat?.messages ?? null, since, authors: chatAuthorsView(chat?.authors), approximate: chat?.approximate === true };
}

const sameAuthors = (a: ChatAuthorsView | null, b: ChatAuthorsView | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.fan === b.fan &&
    a.unattributed === b.unattributed &&
    a.chatters.length === b.chatters.length &&
    a.chatters.every((chatter, index) => {
      const other = b.chatters[index];
      return other !== undefined && chatter.name === other.name && chatter.isMe === other.isMe && chatter.messages === other.messages;
    }));

/** The same badge and card: a read that says nothing new draws nothing. */
export const sameChatLength = (a: ChatLengthView | null, b: ChatLengthView | null): boolean =>
  a === b || (a !== null && b !== null && a.messages === b.messages && a.since === b.since && a.approximate === b.approximate && sameAuthors(a.authors, b.authors));

/** The chat a read is for: the hub page, the site's account and the fan (on OnlyFans the chat is the fan). */
export interface ChatLengthTarget {
  readonly pageId: number;
  readonly accountId: string;
  readonly fanId: string;
}

/** A read's answer: `chat` null — the hub holds no message of that chat (no badge). */
export type ChatLengthAnswer = { readonly ok: true; readonly chat: ChatLength | null } | { readonly ok: false };

/** Answers the tab keeps for chats opened again; the oldest goes first. */
const KEPT = 50;

export function createChatLength(deps: {
  /** Who is signed in where: a new one forgets every answer. */
  session(): string | null;
  /** The chat open now; null — none, or the badge is not admitted there. */
  target(): ChatLengthTarget | null;
  read(target: ChatLengthTarget): Promise<ChatLengthAnswer>;
}): ChatLengthClient & { sync(): void; dispose(): void } {
  let session: string | null = null;
  /** The chat open now, by page, account and fan; null — none (a chat closed and opened again is a new visit). */
  let visit: string | null = null;
  let view: ChatLengthView | null = null;
  let disposed = false;
  /** Each read's turn: an answer of an older turn than the visit's last shown one is dropped. */
  let turn = 0;
  let shownTurn = 0;
  const kept = new Map<string, ChatLength | null>();
  const listeners = new Set<(view: ChatLengthView | null) => void>();

  const show = (next: ChatLengthView | null): void => {
    if (sameChatLength(next, view)) return;
    view = next;
    for (const listener of [...listeners]) listener(view);
  };
  const keep = (key: string, chat: ChatLength | null): void => {
    kept.delete(key);
    kept.set(key, chat);
    while (kept.size > KEPT) kept.delete(kept.keys().next().value as string);
  };
  const render = (key: string): void => {
    show(kept.has(key) ? chatLengthView(kept.get(key), null) : null);
  };
  const read = (asked: ChatLengthTarget, key: string): void => {
    turn += 1;
    const mine = turn;
    const under = session;
    void deps.read(asked).then(
      (answer) => {
        // A failed read changes nothing: no badge appears, none goes.
        if (disposed || !answer.ok || session !== under || mine < shownTurn) return;
        keep(key, answer.chat);
        if (visit !== key) return;
        shownTurn = mine;
        render(key);
      },
      () => undefined,
    );
  };

  return {
    view: () => view,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    sync() {
      if (disposed) return;
      const now = deps.session();
      if (now !== session) {
        session = now;
        visit = null;
        kept.clear();
      }
      const next = now === null ? null : deps.target();
      const key = next === null ? null : `${String(next.pageId)}|${next.accountId}|${next.fanId}`;
      if (key === visit) return;
      visit = key;
      shownTurn = turn;
      if (next === null || key === null) {
        show(null);
        return;
      }
      render(key);
      read(next, key);
    },
    dispose() {
      disposed = true;
      kept.clear();
      listeners.clear();
    },
  };
}
