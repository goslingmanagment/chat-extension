// The open chat's length on a ChatSpace tab, wired (2026-11-11, the owner: «и с хуя ли на чатспейсе его нет? там же
// все то же самое нужно и по идее можно»): the badge and card of Fansly's chat header (ui/chat-length, one for both
// sites) in ChatSpace's conversation header, right after «Заметки». Its own chunk (`lazy/chatspace/chat-length.js`),
// loaded the first time a chat is open and kept.
//
// - Only where ChatSpace's manifest admits `chat-length` (the header has our slot, the hub serves `deleted-messages-v1`;
//   no owner switch, as on Fansly), on an OnlyFans page, in a chat of the account the tab shows.
// - One hub read when the open chat changes (core application/chat-length; `chat.length`, the background's
//   bg/chatspace/chat-length.ts): the person opened that chat. Nothing is asked of OnlyMonster or OnlyFans, no history
//   is read, nothing marked read. Nothing while no chat is open.
// - The slot is in the header only while there is a badge: none while the read runs, after it failed, or when the hub
//   holds no message of the chat. Unlike Fansly no date of the chat's own: no answer, no badge.
// - On OnlyFans the hub's numbers are what it has seen (`approximate`): the card says so under them.
import type { MountSurfaceKind } from '@cg/contracts/vm';
import { createChatLength } from '@cg/core/application/chat-length';
import { createPageContext } from '@cg/core/application/boards';
import { admittedOn } from '@cg/core/domain/features';
import { CHATSPACE_CHAT_LENGTH_TEXTS } from '@cg/core/domain/hosts/chatspace/i18n/chat-length';
import type { ChatSpaceHostPort } from '@cg/host-chatspace/isolated';
import { chatLengthSurface } from '@cg/ui/chat-length';
import { mountKitSurface, type KitMount } from '@cg/ui/kit';

import type { SiteAppEnv } from '../../adapter';

/** The header's order of the badge: right after «Заметки» (10). */
const CHAT_LENGTH_ORDER = 20;
/** Above the background's own wait for the hub. */
const CHAT_LENGTH_TIMEOUT_MS = 30_000;

export function startChatSpaceChatLength(env: SiteAppEnv<ChatSpaceHostPort>): () => void {
  const { host, rpc } = env;
  const context = createPageContext({ rpc, host });
  const allowed = (): boolean => {
    const ctx = context.current();
    return ctx.phase === 'ready' && ctx.page?.platform === 'onlyfans' && admittedOn(env.features, 'chat-length', null, ctx.bootstrap, ctx.page, host.probe().capabilities).usable;
  };
  const client = createChatLength({
    session() {
      const id = host.identity();
      return id === null ? null : `${id.hostAccountId}|${id.hostLoginEpoch}|${String(context.current().epoch)}`;
    },
    target() {
      const { route, identity } = host.current();
      const chat = route.chat;
      const pageId = context.current().page?.pageId;
      if (!allowed() || pageId === undefined || !host.header.available() || identity === null || route.name !== 'chat' || chat === null || chat.hostAccountId !== identity.hostAccountId) return null;
      // On OnlyFans the chat is the fan.
      return { pageId, accountId: chat.hostAccountId, fanId: chat.platformFanId };
    },
    async read(target) {
      const answer = await rpc.request('chat.length', { pageId: target.pageId, fanRef: target.fanId }, { timeoutMs: CHAT_LENGTH_TIMEOUT_MS }).catch(() => null);
      return answer !== null && answer.ok ? { ok: true, chat: answer.payload.chat } : { ok: false };
    },
  });
  let slot: ReturnType<ChatSpaceHostPort['header']['mount']> | null = null;
  let mount: KitMount | null = null;
  const report = (): void => {
    // Test builds: what the e2e and `pnpm see` read — counts only.
    if (env.probe === null) return;
    const view = client.view();
    env.probe.set('chatLength', view === null ? null : { messages: view.messages, since: new Date(view.since).toISOString(), approximate: view.approximate });
  };
  const place = (): void => {
    if (env.life.aborted) return;
    report();
    const on = allowed() && host.header.available() && client.view() !== null;
    if (on && slot === null) {
      slot = host.header.mount(CHAT_LENGTH_ORDER);
      mount = mountKitSurface('header-slot' as MountSurfaceKind, slot.root, env.deps, chatLengthSurface(client, CHATSPACE_CHAT_LENGTH_TEXTS, 'pill'), { report: env.report });
    } else if (!on && slot !== null) {
      mount?.unmount();
      mount = null;
      slot.remove();
      slot = null;
    }
  };
  const sync = (): void => {
    if (env.life.aborted) return;
    client.sync();
    place();
  };
  const offs = [
    host.subscribe((event) => {
      if (event.type === 'route' || event.type === 'accounts') sync();
    }),
    host.onContract(sync),
    host.header.onChange(sync),
    context.subscribe(sync),
    client.subscribe(place),
  ];
  sync();
  return () => {
    for (const off of offs.splice(0)) off();
    client.dispose();
    context.dispose();
    mount?.unmount();
    slot?.remove();
    mount = null;
    slot = null;
  };
}
