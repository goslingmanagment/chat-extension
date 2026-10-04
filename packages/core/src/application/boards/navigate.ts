// Opening a chat from a board (architecture.md §6.5, §6.9; SP-035): only on
// the person's click, through ChatSpace's own router, with a one-time action
// token of the click. Opening a chat marks it read on OnlyFans — that is the
// person's choice, never ours.

import { type CgCode } from '@cg/contracts/errors';
import { type Surface } from '@cg/contracts/features';
import { type HostPort, type NavigationIntent, type NavigationReceipt } from '@cg/contracts/host';
import { type ChatRef, type HumanCause } from '@cg/contracts/ids';

import { type IdSource, type TabRpc } from './ports';

export type TokenKind = 'generate' | 'insert' | 'navigate' | 'send';

/** A one-time token of a trusted click, issued by the background for one kind of write (§14). */
export async function issueCause(rpc: TabRpc, kind: TokenKind, surface: Surface): Promise<{ readonly ok: true; readonly cause: HumanCause } | { readonly ok: false; readonly code: CgCode }> {
  const issued = await rpc.request('token.issue', { kind, surface });
  if (!issued.ok) return { ok: false, code: issued.error.code };
  return { ok: true, cause: { kind: 'click', actionToken: issued.payload.actionToken } };
}

export interface ChatNavigator {
  /** Opens the chat of a fan in ChatSpace. */
  open(chat: ChatRef, surface: Surface): Promise<NavigationReceipt>;
}

export function createChatNavigator(deps: { readonly rpc: TabRpc; readonly host: HostPort; readonly ids: IdSource }): ChatNavigator {
  return {
    async open(chat, surface) {
      if (deps.host.current().contract.capabilities.navigate.state !== 'on') return { state: 'failed', code: 'CG-HOST-CONTRACT', insert: null };
      const issued = await issueCause(deps.rpc, 'navigate', surface);
      if (!issued.ok) return { state: 'failed', code: issued.code, insert: null };
      const intent: NavigationIntent = {
        intentId: deps.ids.uuid(),
        cause: issued.cause,
        target: { hostAccountId: chat.hostAccountId, platformFanId: chat.platformFanId },
      };
      try {
        return await deps.host.navigate(intent);
      } catch {
        return { state: 'failed', code: 'CG-NAV-FAILED', insert: null };
      }
    },
  };
}
