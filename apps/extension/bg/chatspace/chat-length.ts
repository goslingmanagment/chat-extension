// The open OnlyFans chat's length for ChatSpace's chat header (`chat.length`, contracts tab-messages.ts; 2026-11-11, the
// owner: «и с хуя ли на чатспейсе его нет? там же все то же самое нужно и по идее можно»): the badge and card Fansly has,
// from the same hub read, `clientDeletedMessages` with the fan as the conversation (on OnlyFans the chat is the fan).
// Only the chat's length is taken of its answer: the deleted messages are Fansly's mark.
//
// - Only for a tab granted the page, an OnlyFans page where ChatSpace's manifest admits `chat-length` (the hub serves
//   `deleted-messages-v1`; no owner switch, as on Fansly).
// - The hub alone: nothing is asked of OnlyMonster or OnlyFans, no history is read, nothing is marked read.
// - The tab asks once per opened chat and keeps the answers itself, so nothing is kept here; a read in flight for the
//   same person, page and fan is joined.
// - On an OnlyFans page the hub's numbers are what its archive holds (`approximate`): the card says so.

import type { CgErrorWire } from '@cg/contracts/errors';
import type { FeatureSlice } from '@cg/contracts/features/types';
import type { TabRequestPayload, TabResponsePayload } from '@cg/contracts/tab-messages';
import { boundChatLength } from '@cg/core/domain/chat-length';
import { admittedOn } from '@cg/core/domain/features';
import { flagRefusal } from '@cg/core/domain/ops';

import type { BackgroundKit, KitSender } from '../../src/composition/background/host-module';

type Request = TabRequestPayload<'chat.length'>;
type Answer = { readonly ok: true; readonly payload: TabResponsePayload<'chat.length'> } | { readonly ok: false; readonly error: CgErrorWire };

export interface ChatLengthReader {
  read(request: Request, sender: KitSender): Promise<Answer>;
  /** Forgets the reads in flight (another person signed in). */
  clear(): void;
}

const fail = (error: CgErrorWire): { readonly ok: false; readonly error: CgErrorWire } => ({ ok: false, error });

export function createChatLengthReader(kit: Pick<BackgroundKit, 'hub' | 'log'>, slice: FeatureSlice): ChatLengthReader {
  const flying = new Map<string, Promise<Answer>>();

  /** A tab granted the page: an OnlyFans page of this sign-in where the manifest admits the badge. */
  async function admit(request: Request, sender: KitSender): Promise<{ readonly ok: true; readonly pageLabel: string } | ReturnType<typeof fail>> {
    if (sender.kind !== 'tab') return fail({ code: 'CG-CONTEXT-CHANGED' });
    const grant = await kit.hub.page(request.pageId, sender);
    if (!grant.ok) return fail({ code: grant.code });
    const bootstrap = kit.hub.bootstrap();
    const page = bootstrap?.pages.find((entry) => entry.pageId === request.pageId);
    if (bootstrap === null || page === undefined || page.platform !== 'onlyfans') return fail({ code: 'CG-BINDING-NOT-GRANTED' });
    const admitted = admittedOn(slice, 'chat-length', null, bootstrap, page);
    if (!admitted.usable) return fail(flagRefusal(admitted));
    return { ok: true, pageLabel: grant.page.pageLabel };
  }

  async function ask(pageLabel: string, fanRef: string): Promise<Answer> {
    try {
      const answer = await kit.hub.facade.deletedMessages({ pageLabel, fanRef, conversationRef: fanRef });
      // A hub before 2026-11-08 says nothing of the chat: no badge, as for a chat it holds no message of.
      return { ok: true, payload: { chat: boundChatLength(answer.chat) ?? null } };
    } catch (error) {
      const wire = kit.hub.errorWire(error);
      kit.log.service({ level: 'warn', scope: 'chatspace.chat-length', msg: 'chat length not read', fields: { code: wire.code } });
      return fail(wire);
    }
  }

  return {
    async read(request, sender) {
      const admitted = await admit(request, sender);
      if (!admitted.ok) return admitted;
      const who = kit.hub.session();
      if (who === null) return fail({ code: 'CG-CONTEXT-CHANGED' });
      const key = [who.hubOrigin, String(who.userId), admitted.pageLabel, request.fanRef].join('|');
      const joined = flying.get(key);
      if (joined !== undefined) return joined;
      const next = ask(admitted.pageLabel, request.fanRef).finally(() => {
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
