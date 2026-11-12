// A fan the page stopped seeing (2026-11-12; contracts fan-account.ts): one mark from two words — the hub's (what the
// page knows of the fan's account, `fan-account-state-v1`, or before it `accountLookupMissAt`) and, on Fansly, the
// background's own read of `GET /account?ids=` in the page's session, which may be fresher. Spenders, «Рассылка» and
// Fansly's chat header all take the mark from `fanGoneOf`. Pure.

import { FAN_GONE_STATES, type FanAccountRead, type FanGone, type FanGoneState } from '@cg/contracts/fan-account';
import { type FanAccountState } from '@cg/contracts/hub';
import { type IsoTimestamp } from '@cg/contracts/primitives';

/** What the hub says of the fan's account on the page: seen, or one of the reasons he is not. */
export interface HubFanAccount {
  readonly state: 'seen' | FanGoneState;
  readonly since: IsoTimestamp | null;
  readonly checkedAt: IsoTimestamp;
}

const GONE: ReadonlySet<string> = new Set(FAN_GONE_STATES);

const time = (iso: string): number | null => {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
};

/**
 * The hub's word on a fan's account. `accountState` absent — a hub before `fan-account-state-v1`: its
 * `accountLookupMissAt` (the page's latest lookup did not return him) is a fan not seen for a reason not known, checked
 * then; null — the page never answered about him. A state this client does not know is a fan not seen, cause unknown.
 */
export function hubFanAccountOf(accountState: FanAccountState | null | undefined, lookupMissAt: IsoTimestamp | null | undefined): HubFanAccount | null {
  if (accountState === undefined) return lookupMissAt === undefined || lookupMissAt === null ? null : { state: 'unchecked', since: null, checkedAt: lookupMissAt };
  if (accountState === null) return null;
  const state = accountState.state === 'seen' ? 'seen' : GONE.has(accountState.state) ? (accountState.state as FanGoneState) : 'unchecked';
  return { state, since: state === 'seen' ? null : accountState.since, checkedAt: accountState.checkedAt };
}

/**
 * The mark of a fan, or null — none. A local read counts only when it is newer than the hub's latest answer (`checkedAt`);
 * an older one says nothing.
 * - The hub says he is not seen, and no fresher local read says he is: the hub's state (`local: false`).
 * - A fresher local «seen»: no mark (he came back, or the hub's answer is stale).
 * - The hub says he is seen, or says nothing, and a fresher local read did not find him: «не виден» (`unchecked`)
 *   since nobody knows, checked at the local read (`local: true`) — until the hub, told of it, names the cause.
 */
export function fanGoneOf(hub: HubFanAccount | null, local: FanAccountRead | null): FanGone | null {
  const hubAt = hub === null ? null : time(hub.checkedAt);
  const fresher = local !== null && Number.isFinite(local.at) && (hubAt === null || local.at > hubAt) ? local : null;
  if (hub !== null && hub.state !== 'seen') return fresher?.seen === true ? null : { state: hub.state, since: hub.since, checkedAt: hub.checkedAt, local: false };
  if (fresher !== null && !fresher.seen) return { state: 'unchecked', since: null, checkedAt: new Date(fresher.at).toISOString(), local: true };
  return null;
}

/** Two marks say the same (a list redraws only on a change). */
export function sameFanGone(a: FanGone | null, b: FanGone | null): boolean {
  if (a === null || b === null) return a === b;
  return a.state === b.state && a.since === b.since && a.checkedAt === b.checkedAt && a.local === b.local;
}
