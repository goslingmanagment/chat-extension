// The background's side of «Истёкший bootstrap запрещает новые чувствительные
// действия, но готовые результаты не стирает» (architecture.md §8.3, §14;
// docs/hub-layer.md «flagState»). An action token is the permission to act,
// so the gate stands where the token is issued:
//
// - `generate` and `send` are checked by the requests they authorize: the
//   hub layer opens a stream or asks for `dispatch` only on a fresh
//   bootstrap, and reads it again first when it expired;
// - `insert` writes a result of this sign-in into the site's field: it needs
//   the sign-in, a fresh bootstrap and the admission of an insert by the
//   feature manifest of the tab's site (R20 §1.4; on ChatSpace — the owner's
//   `insertion` switch): some feature of the site whose result can be
//   inserted — a draft, a Coach answer — must admit it;
// - `navigate` needs no hub while nobody is signed in or no bootstrap was
//   ever read (ChatSpace's own list, §6.9); with one, the bootstrap must be
//   fresh and the owner's switch of what navigates counts (below).
// An expired bootstrap is read again once, here: a hub that answers lets the
// action through, a hub that does not refuses it with its own reason. A
// refusal takes nothing away: results stay readable and can be copied.
// The one exception is the insert of a ready result while the hub is silent
// (decision X45, the owner reversing X12 п. 19): a result already generated
// in this sign-in is put into the field when the cached bootstrap — expired,
// unanswered — still admits the insert; the hub that answers «off» or «signed
// out» still refuses it, and new generations still wait for the hub (their
// own requests read the bootstrap). Navigation keeps the rule.
//
// Which switch a navigation asks (decision X13): the token's surface says
// who navigates.
// - `overlay` — our own navigation: J/K, ⌘U, Alt+1–9, quick jump, the
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
// copy-only on a page that does not admit an insert, a navigation of ours asks the
// `navigation` switch of the account it goes into, and a board asks its own
// switch (and `insertion` for the insert half) on the page it shows
// (docs/protocols/hub.md «Флаги: решает страница»).

import { type CgErrorWire } from '@cg/contracts/errors';
import { type Surface } from '@cg/contracts/features';
import type { FeatureSlice } from '@cg/contracts/features/types';
import { type ClientFeatureFlag } from '@cg/contracts/hub';
import { admission, admissionState } from '@cg/core/domain/features';

export type TokenKind = 'generate' | 'insert' | 'navigate' | 'send';

/** What the gate reads of the hub layer (the facade has exactly these). */
export interface TokenGateHub {
  session(): unknown;
  /** The cached bootstrap of this sign-in, fresh or not; null — none. */
  cachedBootstrap(): unknown;
  /** `pageLabel: null` — usable on at least one granted page. */
  flagState(flag: ClientFeatureFlag, pageLabel: string | null): { readonly usable: boolean; readonly reason: string | null };
  /**
   * The same switch as the cached bootstrap says it, fresh or expired (X45): asked only for the insert of a ready
   * result once the hub did not answer the read again. Absent — nothing is admitted on an expired bootstrap.
   */
  cachedFlagState?(flag: ClientFeatureFlag, pageLabel: string | null): { readonly usable: boolean; readonly reason: string | null };
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

/** The hub did not answer — away, timed out, the network down — as opposed to answering «off» or «signed out». */
const SILENT_HUB: readonly string[] = ['CG-HUB-UNAVAILABLE', 'CG-HUB-TIMEOUT', 'CG-NETWORK', 'CG-TIMEOUT'];
/** One thing the gate asks: a switch, or an admission. Asked again after an expired bootstrap was read. */
type Ask = () => State;

/**
 * What an insert token asks: the insert of each feature of the site that has one, by the site's slice of the feature
 * manifest. The switches are the hub layer's (a fresh bootstrap, on some granted page); what the feature's own calls
 * need of the hub is those calls' to check, and the site's capabilities are the tab's. No slice — the extension
 * has no such site, and nothing of it is inserted.
 */
function insertAsks(hub: TokenGateHub, features: FeatureSlice | null, flagState: TokenGateHub['flagState'] = (flag, page) => hub.flagState(flag, page)): Ask[] {
  const facts = { flag: (flag: string) => flagState(flag as ClientFeatureFlag, null), serves: () => true };
  return Object.entries(features ?? {})
    .filter(([, entry]) => entry.actions.insert !== undefined)
    .map(([id]) => () => admissionState(admission(features, id, 'insert', facts)));
}

/** The first one usable, else the first one's refusal (its reason is what the person is told). */
function stateOf(asks: readonly Ask[]): { readonly state: State; readonly stale: boolean } {
  const states = asks.map((ask) => ask());
  return {
    state: states.find((state) => state.usable) ?? states[0] ?? { usable: false, reason: 'platform_unsupported' },
    // A refusal a fresh bootstrap may lift: it expired, or was never read.
    stale: states.some((state) => !state.usable && (state.reason === 'bootstrap_expired' || state.reason === 'hub_not_ready')),
  };
}

/**
 * Why a token of `kind` for `surface` may not be issued now, or null. `errorOf` — the wire form of what the hub layer
 * rejected with; `features` — the slice of the feature manifest of the site the asking tab is on.
 */
export async function tokenRefusal(kind: TokenKind, surface: Surface, hub: TokenGateHub, errorOf: (error: unknown) => CgErrorWire, features: FeatureSlice | null): Promise<CgErrorWire | null> {
  if (kind === 'generate' || kind === 'send') return null;
  if (hub.session() === null) return kind === 'navigate' ? null : { code: 'CG-AUTH-REQUIRED' };
  if (kind === 'navigate' && hub.cachedBootstrap() === null) return null;
  const asks: readonly Ask[] = kind === 'insert' ? insertAsks(hub, features) : NAVIGATE_SWITCHES[surface].map((flag) => () => hub.flagState(flag, null));
  let verdict = stateOf(asks);
  if (!verdict.state.usable && verdict.stale) {
    try {
      await hub.bootstrap();
    } catch (error) {
      const refused = errorOf(error);
      // X45: the hub is silent, not «no». A ready result goes into the field by what the cached bootstrap admits.
      if (kind === 'insert' && SILENT_HUB.includes(refused.code) && hub.cachedFlagState !== undefined && hub.cachedBootstrap() !== null) {
        const cached = hub.cachedFlagState.bind(hub);
        const kept = stateOf(insertAsks(hub, features, cached)).state;
        return kept.usable ? null : { code: 'CG-FEATURE-DISABLED', ...(kept.reason === null ? {} : { detail: kept.reason }) };
      }
      return refused;
    }
    verdict = stateOf(asks);
  }
  const { state } = verdict;
  return state.usable ? null : { code: 'CG-FEATURE-DISABLED', ...(state.reason === null ? {} : { detail: state.reason }) };
}
