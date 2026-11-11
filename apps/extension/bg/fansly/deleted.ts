// «Фан удалил» for Fansly's chat header (`fansly.deleted.read`, contracts tab-messages-fansly.ts): the hub's
// `clientDeletedMessages`, the open fan's messages the page's socket saw deleted, with the text the hub kept (a Fansly
// deletion is a fact about the message, not an erasure: the owner, 2026-09-28). Only for a tab granted the creator's
// page where the manifest admits `deleted-messages` (a hub with `deleted-messages-v1`; no owner switch).
//
// The tab asks when a chat opens and again after the page heard a deletion in it, so nothing is kept here: the second
// read sees the new message. A read in flight for the same person, page, fan and chat is joined. The answer is bounded
// to what a tab shows. With the open chat (`groupId`) the same read says how long that chat is (2026-11-08): the
// header's badge, no read of its own. And who wrote it (2026-11-11, the owner: «чтобы писалось, кто из чатеров сколько
// сообщений оставил»): each chatter's count, the fan's and the ones with no known author, for the badge's card.

import type { CgAnyErrorWire } from '@cg/contracts/errors-fansly';
import type { FeatureSlice } from '@cg/contracts/features/types';
import type { DeletedMessages } from '@cg/contracts/hub';
import { NATIVE_ID_PATTERN } from '@cg/contracts/primitives';
import { FANSLY_TAB_LIMITS, type FanslyChatAuthors, type FanslyChatLength, type FanslyDeletedMessages, type FanslyTabRequestPayload, type FanslyTabResponsePayload } from '@cg/contracts/tab-messages-fansly';
import { admittedOn } from '@cg/core/domain/features';
import { flagRefusal } from '@cg/core/domain/ops';

import type { BackgroundKit, HostSiteSender } from '../../src/composition/background/host-module';

type Request = FanslyTabRequestPayload<'fansly.deleted.read'>;
type Answer = FanslyTabResponsePayload<'fansly.deleted.read'>;

/** At most `max` UTF-16 units, never half of a pair. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const end = /[\uD800-\uDBFF]/.test(text.charAt(max - 1)) ? max - 1 : max;
  return text.slice(0, end);
}

const isoOf = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

const count = (value: number): number => (Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 1_000_000) : 0);

/** The hub's answer as a tab may take it (FanslyDeletedMessagesSchema): ids and times that read, texts cut, the cap kept. */
export function boundDeletedMessages(answer: DeletedMessages): FanslyDeletedMessages {
  const messages: FanslyDeletedMessages['messages'][number][] = [];
  for (const message of answer.messages) {
    const deletedAt = isoOf(message.deletedAt);
    if (!NATIVE_ID_PATTERN.test(message.platformMessageId) || deletedAt === null) continue;
    messages.push({
      id: message.platformMessageId,
      groupId: message.conversationRef !== null && NATIVE_ID_PATTERN.test(message.conversationRef) ? message.conversationRef : null,
      text: message.text === null ? null : cut(message.text, FANSLY_TAB_LIMITS.deletedMessageMaxChars),
      attachments: count(message.attachments),
      sentAt: isoOf(message.sentAt),
      deletedAt,
    });
    if (messages.length === FANSLY_TAB_LIMITS.deletedMessagesMax) break;
  }
  return { total: Math.max(count(answer.total), messages.length), messages };
}

/** A count the hub may send: a whole number, zero or more; null — none, or one that does not read. */
const exact = (value: number | null): number | null => (value !== null && Number.isSafeInteger(value) && value >= 0 ? value : null);

type HubChatAuthors = NonNullable<NonNullable<DeletedMessages['chat']>['authors']>;

/**
 * Who wrote the chat as a tab may take it: each chatter with a login and at least one message (others dropped), the
 * cap kept, logins cut; the fan's and the unattributed counts both or neither, and only beside the chat's own count.
 * null — the hub did not say, or its split does not read: no breakdown rather than a wrong one.
 */
function boundChatAuthors(authors: HubChatAuthors | undefined, messages: number | null): FanslyChatAuthors | null {
  if (authors === undefined) return null;
  const chatters: FanslyChatAuthors['chatters'][number][] = [];
  for (const chatter of authors.chatters) {
    const name = cut(chatter.name.trim(), FANSLY_TAB_LIMITS.chatAuthorNameMaxChars);
    const count = exact(chatter.messages);
    if (name === '' || count === null || count < 1) continue;
    chatters.push({ name, isMe: chatter.isMe, messages: count });
    if (chatters.length === FANSLY_TAB_LIMITS.chatAuthorsMax) break;
  }
  if (authors.fan === null && authors.unattributed === null) return { chatters, fan: null, unattributed: null };
  // The split needs the whole chat: both counts, beside the chat's own, or the answer does not read.
  const fan = exact(authors.fan);
  const unattributed = exact(authors.unattributed);
  if (messages === null || fan === null || unattributed === null) return null;
  return { chatters, fan, unattributed };
}

/** The chat's length as a tab may take it: a count that reads, a time that reads, who wrote it; undefined — the hub did not say. */
export function boundChatLength(chat: DeletedMessages['chat']): FanslyChatLength | null | undefined {
  if (chat === undefined || chat === null) return chat;
  const messages = exact(chat.messages);
  return {
    messages,
    firstMessageAt: isoOf(chat.firstMessageAt),
    authors: boundChatAuthors(chat.authors, messages),
  };
}

export interface DeletedMessagesReader {
  read(request: Request, sender: HostSiteSender): Promise<Answer>;
  /** Forgets the reads in flight (another person signed in). */
  clear(): void;
}

const fail = (error: CgAnyErrorWire): { readonly ok: false; readonly error: CgAnyErrorWire } => ({ ok: false, error });

export function createDeletedMessagesReader(kit: Pick<BackgroundKit, 'hub' | 'networkSession' | 'log'>, slice: FeatureSlice): DeletedMessagesReader {
  const flying = new Map<string, Promise<Answer>>();

  /** A tab granted the creator's Fansly page (by either of the tab's ids for the creator), where the manifest admits the feature. */
  async function admit(request: Request, sender: HostSiteSender): Promise<{ readonly ok: true; readonly pageLabel: string } | ReturnType<typeof fail>> {
    if (sender.kind !== 'tab') return fail({ code: 'CG-CONTEXT-CHANGED' });
    const grant = await kit.hub.page(request.pageId, sender);
    if (!grant.ok) return fail({ code: grant.code });
    const bootstrap = kit.hub.bootstrap();
    const page = bootstrap?.pages.find((entry) => entry.pageId === request.pageId);
    const ids = [request.hostAccountId, ...(kit.networkSession?.aliases(request.hostAccountId) ?? [])];
    if (bootstrap === null || page === undefined || page.platform !== 'fansly' || page.platformAccountId === null || !ids.includes(page.platformAccountId)) return fail({ code: 'CG-BINDING-NOT-GRANTED' });
    const admitted = admittedOn(slice, 'deleted-messages', null, bootstrap, page);
    if (!admitted.usable) return fail(flagRefusal(admitted));
    return { ok: true, pageLabel: grant.page.pageLabel };
  }

  async function ask(pageLabel: string, fanRef: string, groupId: string | undefined): Promise<Answer> {
    try {
      const answer = await kit.hub.facade.deletedMessages({ pageLabel, fanRef, ...(groupId === undefined ? {} : { conversationRef: groupId }) });
      const chat = groupId === undefined ? undefined : boundChatLength(answer.chat);
      return { ok: true, deleted: boundDeletedMessages(answer), ...(chat === undefined ? {} : { chat }) };
    } catch (error) {
      const wire = kit.hub.errorWire(error);
      kit.log.service({ level: 'warn', scope: 'fansly.deleted', msg: 'deleted messages not read', fields: { code: wire.code } });
      return fail(wire);
    }
  }

  return {
    async read(request, sender) {
      const admitted = await admit(request, sender);
      if (!admitted.ok) return admitted;
      const who = kit.hub.session();
      if (who === null) return fail({ code: 'CG-CONTEXT-CHANGED' });
      const key = [who.hubOrigin, String(who.userId), admitted.pageLabel, request.fanRef, request.groupId ?? ''].join('|');
      const joined = flying.get(key);
      if (joined !== undefined) return joined;
      const next = ask(admitted.pageLabel, request.fanRef, request.groupId).finally(() => {
        if (flying.get(key) === next) flying.delete(key);
      });
      flying.set(key, next);
      return next;
    },
    clear() {
      flying.clear();
    },
  };
}
