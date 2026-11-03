// «Кто написал» on a Fansly tab (2026-11-03, the owner: «узнавать кто написал какое сообщение»): who sent each of the
// model's messages of the open chat, as the hub recorded the sends (the background's `messages.authors`, hub
// `clientMessageAuthors`), handed to the host port, which draws it before the time under each run of them
// (host-fansly isolated/message-authors.ts).
//
// - An open one-to-one chat of an account bound to a page: read when the chat opens, kept while it stays open.
// - A person's message of the model that came with no sender yet (the port says it): read again SOON_MS later, and once
//   more LATE_MS after the last such message — a sender's report reaches the hub a few seconds after the send, another
//   chatter's after their tab tells it.
// - The page context says whose it is (the same as «Метки фана»): signed out, a page no longer granted or a hub without
//   `message-authors-v1` draws nothing, whatever was drawn goes; once it is known again the open chat is read. A read
//   that failed keeps what is drawn and is tried again, then waits for the next event. One request per read; no read
//   of the site.

import { createPageContext } from '@cg/core/application/boards';
import { admittedOn } from '@cg/core/domain/features';
import type { FanslyMessageAuthor } from '@cg/contracts/fansly';
import { MESSAGE_AUTHOR_TEXTS } from '@cg/core/domain/hosts/fansly/i18n';
import type { FanslyPort } from '@cg/host-fansly/isolated';

import type { SiteAppEnv } from '../../adapter';

const AUTHORS_TIMEOUT_MS = 15_000;
/** After a live message with no sender: read again soon, and once more a while after the last one. */
const SOON_MS = 4_000;
const LATE_MS = 20_000;
/** A read that failed is tried again after each of these, then waits for the next event. */
const RETRIES_MS = [5_000, 30_000];

/** The open chat to read: `key` also moves with who is signed in and the page bound (the context's epoch). */
interface Target {
  readonly key: string;
  readonly groupId: string;
  readonly fanRef: string;
  readonly pageId: number;
}

export function startFanslyMessageAuthors(env: Pick<SiteAppEnv<FanslyPort>, 'rpc' | 'host' | 'life' | 'win' | 'features'>): () => void {
  const { rpc, host, win } = env;
  const context = createPageContext({ rpc, host });
  let target: Target | null = null;
  /** The hub answered for this target. */
  let answered = false;
  let reading = false;
  let reads = 0;
  let failures = 0;
  let retry: number | null = null;
  let soon: number | null = null;
  let late: number | null = null;

  const stopTimers = (): void => {
    if (retry !== null) win.clearTimeout(retry);
    if (soon !== null) win.clearTimeout(soon);
    if (late !== null) win.clearTimeout(late);
    retry = null;
    soon = null;
    late = null;
  };

  const targetNow = (): Target | null => {
    const { bootstrap, page, epoch } = context.current();
    const { route } = host.current();
    const groupId = route.name === 'chat' && route.conversationKind !== 'group' ? (route.conversationRef ?? null) : null;
    const fanRef = route.chat?.platformFanId ?? null;
    if (groupId === null || fanRef === null || page === null || !admittedOn(env.features, 'message-authors', null, bootstrap, page).usable) return null;
    return { key: `${String(epoch)}|${String(page.pageId)}|${groupId}|${fanRef}`, groupId, fanRef, pageId: page.pageId };
  };

  const read = async (chat: Target): Promise<void> => {
    reads += 1;
    const asked = reads;
    reading = true;
    if (retry !== null) win.clearTimeout(retry);
    retry = null;
    const answer = await rpc.request('messages.authors', { pageId: chat.pageId, fanRef: chat.fanRef }, { timeoutMs: AUTHORS_TIMEOUT_MS }).catch(() => null);
    if (env.life.aborted || asked !== reads) return;
    reading = false;
    if (target?.key !== chat.key) return;
    // Out of reach or refused: what is drawn stays as it was.
    if (answer === null || !answer.ok || !answer.payload.ok) {
      const wait = RETRIES_MS[failures];
      failures += 1;
      if (wait !== undefined) {
        retry = win.setTimeout(() => {
          retry = null;
          if (!env.life.aborted && target?.key === chat.key) void read(chat);
        }, wait);
      }
      return;
    }
    answered = true;
    failures = 0;
    const byId = new Map<string, FanslyMessageAuthor>();
    for (const message of answer.payload.messages) byId.set(message.messageId, { name: message.name, how: MESSAGE_AUTHOR_TEXTS.how(message.how, message.edited) });
    host.fansly.setMessageAuthors({
      groupId: chat.groupId,
      byId,
      unknown: MESSAGE_AUTHOR_TEXTS.unknown,
      onUnknownLive: () => {
        const again = (): void => {
          if (!env.life.aborted && target?.key === chat.key) void read(chat);
        };
        // Every message told before the soon read fires is covered by it; the late one waits for the last of them.
        soon ??= win.setTimeout(() => {
          soon = null;
          again();
        }, SOON_MS);
        if (late !== null) win.clearTimeout(late);
        late = win.setTimeout(() => {
          late = null;
          again();
        }, LATE_MS);
      },
    });
  };

  const sync = (): void => {
    if (env.life.aborted) return;
    const next = targetNow();
    if (next?.key === target?.key) {
      // The same chat, and the context came back or something else moved: a chat not answered yet is read now.
      if (next !== null && !answered && !reading && retry === null) void read(next);
      return;
    }
    target = next;
    answered = false;
    reading = false;
    failures = 0;
    reads += 1;
    stopTimers();
    host.fansly.setMessageAuthors(null);
    if (next !== null) void read(next);
  };

  const offs = [
    host.subscribe((event) => {
      if (event.type === 'route' || event.type === 'accounts') sync();
    }),
    context.subscribe(sync),
  ];
  sync();
  return () => {
    for (const off of offs.splice(0)) off();
    context.dispose();
    stopTimers();
    target = null;
    reads += 1;
    host.fansly.setMessageAuthors(null);
  };
}
