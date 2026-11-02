// «Кто написал» on a Fansly tab (2026-11-03, the owner: «узнавать кто написал какое сообщение»): who sent each of the
// model's messages of the open chat, as the hub recorded the sends (the background's `messages.authors`, hub
// `clientMessageAuthors`), handed to the host port, which draws it before the time under each run of them
// (host-fansly isolated/message-authors.ts).
//
// - An open one-to-one chat of an account bound to a page: read when the chat opens, kept while it stays open.
// - A message of the model seen live with no sender yet (the port says it): read again SOON_MS later, and once more
//   LATE_MS after the last such message — a sender's report reaches the hub a few seconds after the send, another
//   chatter's after their tab tells it.
// - Where the background says no (signed out, a page not granted, a hub without `message-authors-v1`) nothing is
//   drawn: Fansly's own line stays as it was. One request per read; no read of the site.

import type { FanslyMessageAuthor } from '@cg/contracts/fansly';
import { MESSAGE_AUTHOR_TEXTS } from '@cg/core/domain/hosts/fansly/i18n';
import type { FanslyPort } from '@cg/host-fansly/isolated';

import type { SiteAppEnv } from '../../adapter';

const AUTHORS_TIMEOUT_MS = 15_000;
/** After a live message with no sender: read again soon, and once more a while after the last one. */
const SOON_MS = 4_000;
const LATE_MS = 20_000;

export function startFanslyMessageAuthors(env: Pick<SiteAppEnv<FanslyPort>, 'rpc' | 'host' | 'life' | 'win'>): () => void {
  const { rpc, host, win } = env;
  /** The chat read: account, group and fan; null — none. */
  let key: string | null = null;
  /** The page of the account last resolved. */
  let bound: { readonly account: string; readonly pageId: number } | null = null;
  let reads = 0;
  let soon: number | null = null;
  let late: number | null = null;

  const stopTimers = (): void => {
    if (soon !== null) win.clearTimeout(soon);
    if (late !== null) win.clearTimeout(late);
    soon = null;
    late = null;
  };

  const read = async (chatKey: string, groupId: string, fanRef: string, pageId: number): Promise<void> => {
    reads += 1;
    const asked = reads;
    const answer = await rpc.request('messages.authors', { pageId, fanRef }, { timeoutMs: AUTHORS_TIMEOUT_MS }).catch(() => null);
    if (env.life.aborted || asked !== reads || key !== chatKey) return;
    // Out of reach or refused: what is drawn stays as it was.
    if (answer === null || !answer.ok || !answer.payload.ok) return;
    const byId = new Map<string, FanslyMessageAuthor>();
    for (const message of answer.payload.messages) byId.set(message.messageId, { name: message.name, how: MESSAGE_AUTHOR_TEXTS.how(message.how, message.edited) });
    host.fansly.setMessageAuthors({
      groupId,
      byId,
      unknown: MESSAGE_AUTHOR_TEXTS.unknown,
      onUnknownLive: () => {
        const again = (): void => {
          if (!env.life.aborted && key === chatKey) void read(chatKey, groupId, fanRef, pageId);
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
    const { route, identity, accounts } = host.current();
    const account = accounts.find((entry) => entry.hostAccountId === identity?.hostAccountId) ?? null;
    const groupId = route.name === 'chat' && route.conversationKind !== 'group' ? (route.conversationRef ?? null) : null;
    const fanRef = route.chat?.platformFanId ?? null;
    const next = account === null || groupId === null || fanRef === null ? null : `${account.hostAccountId}|${groupId}|${fanRef}`;
    if (next === key) return;
    key = next;
    stopTimers();
    host.fansly.setMessageAuthors(null);
    if (next === null || account === null || groupId === null || fanRef === null) return;
    if (bound !== null && bound.account === account.hostAccountId) {
      void read(next, groupId, fanRef, bound.pageId);
      return;
    }
    void rpc.request('binding.resolve', { account }).then(
      (answer) => {
        if (env.life.aborted || key !== next || !answer.ok) return;
        bound = { account: account.hostAccountId, pageId: answer.payload.binding.pageId };
        void read(next, groupId, fanRef, bound.pageId);
      },
      () => undefined,
    );
  };

  const off = host.subscribe((event) => {
    if (event.type === 'route' || event.type === 'accounts') {
      // Another account of the tab: its page is resolved anew.
      if (event.type === 'accounts') bound = null;
      sync();
    }
  });
  sync();
  return () => {
    off();
    stopTimers();
    key = null;
    host.fansly.setMessageAuthors(null);
  };
}
