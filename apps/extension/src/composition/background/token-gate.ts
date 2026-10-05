// The background's side of «Истёкший bootstrap запрещает новые чувствительные
// действия, но готовые результаты не стирает» (architecture.md §8.3, §14;
// docs/hub-layer.md «flagState»). An action token is the permission to act,
// so the gate stands where the token is issued:
//
// - `generate` and `send` are checked by the requests they authorize: the
//   hub layer opens a stream or asks for `dispatch` only on a fresh
//   bootstrap, and reads it again first when it expired;
// - `insert` writes a result of this sign-in into ChatSpace: it needs the
//   sign-in, a fresh bootstrap and the owner's `insertion` switch;
// - `navigate` needs no hub while nobody is signed in or no bootstrap was
//   ever read (ChatSpace's own list, §6.9); with one, the bootstrap must be
//   fresh and the owner's switch of what navigates counts (below).
// An expired bootstrap is read again once, here: a hub that answers lets the
// action through, a hub that does not refuses it with its own reason. A
// refusal takes nothing away: results stay readable and can be copied.
//
// Which switch a navigation asks (decision X13): the token's surface says
// who navigates.
// - `overlay` — our own navigation: J/K, ⌘U, ⌘1–9, quick jump, the
//   palette's chats, «Открыть чат» of a toast. The owner's `navigation`.
// - `preview`, `newcomers` — the person clicked one fan in a board: the
//   Spenders row, a preview's «Открыть» / «Открыть и вставить», a card of
//   «Новые». That is the BOARD's switch (`spenders`, `preview`,
//   `newcomers`), and `navigation` is never asked: a page whose owner left
//   `navigation` off still opens the fan the person chose in its board.
//
// Which page: a token names a kind and a surface, not a chat, so the gate
// asks «is the switch usable on at least one granted page» (`flagState(flag,
// null)`; the top-level `flags` are the owner's `"*"` row alone and decide
// nothing). The page's own value is applied where the page is known — by
// the tab's controllers, before they ask for the token: the dock is
// copy-only on a page without `insertion`, a navigation of ours asks the
// `navigation` switch of the account it goes into, and a board asks its own
// switch (and `insertion` for the insert half) on the page it shows
// (docs/protocols/hub.md «Флаги: решает страница»).

import { type CgErrorWire } from '@cg/contracts/errors';
import { type Surface } from '@cg/contracts/features';
import { type ClientFeatureFlag } from '@cg/contracts/hub';

export type TokenKind = 'generate' | 'insert' | 'navigate' | 'send';

/** What the gate reads of the hub layer (the facade has exactly these). */
export interface TokenGateHub {
  session(): unknown;
  /** The cached bootstrap of this sign-in, fresh or not; null — none. */
  cachedBootstrap(): unknown;
  /** `pageLabel: null` — usable on at least one granted page. */
  flagState(flag: ClientFeatureFlag, pageLabel: string | null): { readonly usable: boolean; readonly reason: string | null };
  /** Reads an expired bootstrap again; rejects with the hub layer's own error. */
  bootstrap(): Promise<unknown>;
}

/** The switches a navigation token of each surface answers to: any one usable (on some granted page) lets it through. */
export const NAVIGATE_SWITCHES: Readonly<Record<Surface, readonly ClientFeatureFlag[]>> = {
  overlay: ['navigation'],
  dock: ['navigation'],
  coach: ['navigation'],
  preview: ['spenders', 'preview'],
  newcomers: ['newcomers', 'preview'],
};

type State = ReturnType<TokenGateHub['flagState']>;

/** The first usable switch, else the first one's refusal (its reason is what the person is told). */
function stateOf(hub: TokenGateHub, flags: readonly ClientFeatureFlag[]): State {
  const states = flags.map((flag) => hub.flagState(flag, null));
  return states.find((state) => state.usable) ?? states[0] ?? { usable: false, reason: 'flag_off' };
}

/** A refusal a fresh bootstrap may lift: it expired, or was never read. */
const stale = (hub: TokenGateHub, flags: readonly ClientFeatureFlag[]): boolean =>
  flags.some((flag) => {
    const state = hub.flagState(flag, null);
    return !state.usable && (state.reason === 'bootstrap_expired' || state.reason === 'hub_not_ready');
  });

/** Why a token of `kind` for `surface` may not be issued now, or null. `errorOf` — the wire form of what the hub layer rejected with. */
export async function tokenRefusal(kind: TokenKind, surface: Surface, hub: TokenGateHub, errorOf: (error: unknown) => CgErrorWire): Promise<CgErrorWire | null> {
  if (kind === 'generate' || kind === 'send') return null;
  if (hub.session() === null) return kind === 'navigate' ? null : { code: 'CG-AUTH-REQUIRED' };
  if (kind === 'navigate' && hub.cachedBootstrap() === null) return null;
  const flags: readonly ClientFeatureFlag[] = kind === 'insert' ? ['insertion'] : NAVIGATE_SWITCHES[surface];
  let state = stateOf(hub, flags);
  if (!state.usable && stale(hub, flags)) {
    try {
      await hub.bootstrap();
    } catch (error) {
      return errorOf(error);
    }
    state = stateOf(hub, flags);
  }
  return state.usable ? null : { code: 'CG-FEATURE-DISABLED', ...(state.reason === null ? {} : { detail: state.reason }) };
}
