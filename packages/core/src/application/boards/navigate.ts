// Opening a chat from a board (architecture.md §6.5, §6.9; SP-035): only on
// the person's click, through ChatSpace's own router, with a one-time action
// token of the click. Opening a chat marks it read on OnlyFans — that is the
// person's choice, never ours.
//
// Whose switch: the BOARD's own, on the page the board shows (decision X13).
// A click on one fan in Spenders, in a preview or in «Новые» is the person
// choosing that fan; it is not our navigation. The owner's `navigation`
// switch covers what walks or jumps between chats by our keys and lists
// (J/K, ⌘U, Alt+1–9, quick jump, the palette's chats) and is never asked here:
// a pilot page with `navigation` off still opens the fan the person clicked
// in its board, and a board that is off on its page opens nothing —
// whatever `navigation` says on any other page.

import { type CgCode, type CgErrorWire } from '@cg/contracts/errors';
import { type Surface } from '@cg/contracts/features';
import { type HostPort, type NavigationIntent, type NavigationReceipt } from '@cg/contracts/host';
import { type ChatRef, type HumanCause } from '@cg/contracts/ids';

import { flagRefusal } from '../../domain/ops/flags';
import { pageFlagOf, type PageContextPort, type PageContextState } from './context';
import { type IdSource, type TabRpc } from './ports';

export type TokenKind = 'generate' | 'insert' | 'navigate' | 'send';

/** A one-time token of a trusted click, issued by the background for one kind of write (§14). */
export async function issueCause(rpc: TabRpc, kind: TokenKind, surface: Surface): Promise<{ readonly ok: true; readonly cause: HumanCause } | { readonly ok: false; readonly code: CgCode }> {
  const issued = await rpc.request('token.issue', { kind, surface });
  if (!issued.ok) return { ok: false, code: issued.error.code };
  return { ok: true, cause: { kind: 'click', actionToken: issued.payload.actionToken } };
}

/** The owner switch of a board: the click on a fan there is gated by it, on the board's page. */
export type BoardSwitch = 'spenders' | 'preview' | 'newcomers';

/**
 * Why a click on a fan in a board may not open the fan's chat now, or null: every switch of `boards` must be
 * usable on the page the boards show — the page's own feature, never «on some page». `insert` — the click also
 * puts a text into the chat («Открыть и вставить»): the page's `insertion` switch too.
 */
export function boardOpenRefusal(state: PageContextState, boards: readonly BoardSwitch[], insert = false): CgErrorWire | null {
  // The port to the background is down, or the page is being read again after it came back: the switches held
  // here are from before the outage — the owner may have changed them unheard. Nothing is opened by them.
  if (state.phase === 'blocked' && state.blocker?.code === 'CG-RUNTIME-UNREACHABLE') return state.blocker;
  if (state.binding === null) return { code: 'CG-BINDING-MISSING' };
  for (const flag of insert ? ([...boards, 'insertion'] as const) : boards) {
    const switched = pageFlagOf(state, flag);
    if (!switched.usable) return flagRefusal(switched);
  }
  return null;
}

export interface ChatNavigator {
  /**
   * Opens the chat of a fan the person clicked in a board. `boards` — the switches of the board the click was
   * made in; the chat must be one of the account the boards show. `conversationRef` — the fan's conversation as the
   * board knows it (on Fansly the group id of this fan, never the route of the chat on screen); absent or the fan
   * itself — the conversation is the fan, and the navigation names none.
   */
  open(chat: ChatRef, surface: Surface, boards: readonly BoardSwitch[], conversationRef?: string): Promise<NavigationReceipt>;
}

export function createChatNavigator(deps: { readonly rpc: TabRpc; readonly host: HostPort; readonly ids: IdSource; readonly context: PageContextPort }): ChatNavigator {
  return {
    async open(chat, surface, boards, conversationRef) {
      const state = deps.context.current();
      const refusal = boardOpenRefusal(state, boards);
      if (refusal !== null) return { state: 'failed', code: refusal.code, insert: null };
      // The switch that was asked is the page's of the boards' account: a chat of another account is not its to open.
      if (state.binding?.hostAccountId !== chat.hostAccountId) return { state: 'failed', code: 'CG-CONTEXT-CHANGED', insert: null };
      if (deps.host.current().contract.capabilities.navigate.state !== 'on') return { state: 'failed', code: 'CG-HOST-CONTRACT', insert: null };
      const issued = await issueCause(deps.rpc, 'navigate', surface);
      if (!issued.ok) return { state: 'failed', code: issued.code, insert: null };
      const intent: NavigationIntent = {
        intentId: deps.ids.uuid(),
        cause: issued.cause,
        target: { hostAccountId: chat.hostAccountId, platformFanId: chat.platformFanId, ...(conversationRef === undefined || conversationRef === chat.platformFanId ? {} : { conversationRef }) },
      };
      try {
        return await deps.host.navigate(intent);
      } catch {
        return { state: 'failed', code: 'CG-NAV-FAILED', insert: null };
      }
    },
  };
}
