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
//   ever read (ChatSpace's own list, §6.9); with one, the owner's
//   `navigation` switch counts and the bootstrap must be fresh.
// An expired bootstrap is read again once, here: a hub that answers lets the
// action through, a hub that does not refuses it with its own reason. A
// refusal takes nothing away: results stay readable and can be copied.

import { type CgErrorWire } from '@cg/contracts/errors';
import { type ClientFeatureFlag } from '@cg/contracts/hub';

export type TokenKind = 'generate' | 'insert' | 'navigate' | 'send';

/** What the gate reads of the hub layer (the facade has exactly these). */
export interface TokenGateHub {
  session(): unknown;
  /** The cached bootstrap of this sign-in, fresh or not; null — none. */
  cachedBootstrap(): unknown;
  flagState(flag: ClientFeatureFlag, pageLabel: string | null): { readonly usable: boolean; readonly reason: string | null };
  /** Reads an expired bootstrap again; rejects with the hub layer's own error. */
  bootstrap(): Promise<unknown>;
}

const FLAG: { readonly insert: ClientFeatureFlag; readonly navigate: ClientFeatureFlag } = { insert: 'insertion', navigate: 'navigation' };

/** Why a token of `kind` may not be issued now, or null. `errorOf` — the wire form of what the hub layer rejected with. */
export async function tokenRefusal(kind: TokenKind, hub: TokenGateHub, errorOf: (error: unknown) => CgErrorWire): Promise<CgErrorWire | null> {
  if (kind === 'generate' || kind === 'send') return null;
  if (hub.session() === null) return kind === 'navigate' ? null : { code: 'CG-AUTH-REQUIRED' };
  if (kind === 'navigate' && hub.cachedBootstrap() === null) return null;
  const flag = FLAG[kind];
  let state = hub.flagState(flag, null);
  if (!state.usable && (state.reason === 'bootstrap_expired' || state.reason === 'hub_not_ready')) {
    try {
      await hub.bootstrap();
    } catch (error) {
      return errorOf(error);
    }
    state = hub.flagState(flag, null);
  }
  return state.usable ? null : { code: 'CG-FEATURE-DISABLED', ...(state.reason === null ? {} : { detail: state.reason }) };
}
