// Rows of «Новые» (architecture.md §8.5, §6.7.9, hub H-7c; NF-005…NF-007,
// NF-014, NF-015): who subscribed or came back in the window, and where the
// greeting stands. Three things are kept apart, as the hub keeps them: the
// fact «greeted» (for ever; the desktop's outbox confirms it too), the lease
// of whoever works on the greeting now, and the custody of a sent part. A
// row never looks greeted without that fact, and a part whose outcome is
// unknown stops the row until an owner resolves it in the hub.

import { type AudienceNewItem, type ClaimState, type ClaimSummary } from '@cg/contracts/hub';
import { type IsoTimestamp } from '@cg/contracts/primitives';
import { type GreetingFilter, type GreetingStatusVM, type NewcomerKind, type NewcomersTab } from '@cg/contracts/vm';

/** Hi is for a conversation that has barely started: past this many personal messages it is a dialogue (NF-015). */
export const HI_MAX_PERSONAL_MESSAGES = 10;

export interface NewcomerRow {
  readonly fanRef: string;
  /** The hub's stable event id: what keeps the subscriber sound from repeating. */
  readonly eventRef: string;
  readonly name: string;
  readonly username: string | null;
  readonly kind: NewcomerKind;
  readonly trial: boolean;
  readonly subscribedAt: IsoTimestamp;
  /** The current subscription of THIS page as the hub knows it, with its data time (X8 condition 9). */
  readonly subscription: { readonly state: 'active' | 'expired' | 'unknown'; readonly asOf: IsoTimestamp | null };
  readonly thread: {
    readonly storedMessages: number;
    readonly lastMessageAt: IsoTimestamp | null;
    readonly lastFanMessageAt: IsoTimestamp | null;
    readonly lastModelMessageAt: IsoTimestamp | null;
  } | null;
  readonly claim: ClaimSummary;
  readonly haystack: string;
}

function kindOf(token: string): NewcomerKind {
  return token === 'returning' || token === 'renewed' ? token : 'new';
}

function subscriptionOf(status: AudienceNewItem['status']): NewcomerRow['subscription'] {
  const known = status.subscriptionStatus === 'active' || status.subscriptionStatus === 'expired' ? status.subscriptionStatus : null;
  // The explicit flag and the status word must agree; a disagreement is «unknown», never a guess.
  let state: 'active' | 'expired' | 'unknown' = 'unknown';
  if (status.isSubscriber === true && known !== 'expired') state = 'active';
  else if (status.isSubscriber === false && known !== 'active') state = 'expired';
  else if (status.isSubscriber === null && known !== null) state = known;
  return { state, asOf: status.asOf };
}

const clean = (text: string | null): string | null => {
  const trimmed = text?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
};

export function newcomerRow(item: AudienceNewItem): NewcomerRow {
  const username = clean(item.username)?.replace(/^@/, '') ?? null;
  const name = clean(item.displayName) ?? username ?? item.fanRef;
  return {
    fanRef: item.fanRef,
    eventRef: item.eventRef,
    name,
    username,
    kind: kindOf(item.kind),
    trial: item.trial,
    subscribedAt: item.subscribedAt,
    subscription: subscriptionOf(item.status),
    thread:
      item.thread === null
        ? null
        : {
            storedMessages: item.thread.storedMessageCount,
            lastMessageAt: item.thread.lastMessageAt,
            lastFanMessageAt: item.thread.lastFanMessageAt,
            lastModelMessageAt: item.thread.lastModelMessageAt,
          },
    claim: item.claim,
    haystack: [item.displayName, item.username, item.fanRef]
      .filter((part) => part !== null)
      .join('\n')
      .normalize('NFKC')
      .toLowerCase(),
  };
}

/** A fingerprint of the row's thread: a draft made on one is stale on another (NF-018). */
export function threadRevision(row: Pick<NewcomerRow, 'thread'>): string {
  return row.thread === null ? 'none' : `${row.thread.storedMessages}|${row.thread.lastMessageAt ?? ''}`;
}

/** What this tab itself knows about a fan's greeting: its lease and the parts it sent. */
export interface LocalGreeting {
  /** This tab holds a live lease of the fan. */
  readonly leaseMine: boolean;
  /** The lease was lost to a colleague or to this person elsewhere, as the last claim answer said. */
  readonly heldBy: 'you-elsewhere' | 'someone-else' | null;
  /**
   * Parts of the group this tab is sending: confirmed, total, the first part
   * with an unknown outcome (0-based), and whether a part is on its way now.
   */
  readonly progress: {
    readonly sent: number;
    readonly total: number;
    readonly uncertainPart: number | null;
    readonly inFlight: boolean;
    readonly sentAt: IsoTimestamp | null;
  } | null;
}

export const NO_LOCAL_GREETING: LocalGreeting = { leaseMine: false, heldBy: null, progress: null };

/** Part numbers of the hub's own answer for a group (`ClaimState.group`), when a claim call brought one. */
export function progressOfClaim(state: ClaimState | null): LocalGreeting['progress'] {
  const group = state?.group ?? null;
  if (group === null) return null;
  const held = [...group.heldParts].sort((a, b) => a - b)[0];
  const inFlight = state?.custody?.state === 'dispatching';
  return { sent: new Set(group.sentParts).size, total: group.partCount, uncertainPart: held ?? null, inFlight, sentAt: state?.greeting.at ?? null };
}

/**
 * The «Приветствие» column. In order: a part whose outcome is unknown stops
 * the row; parts on their way show the progress; every part confirmed (or
 * the hub's fact alone) is «поздоровались»; then the lease — mine, mine in
 * another tab, a colleague's. A colleague's unresolved send holds the fan as
 * their lease does. Otherwise nobody greeted the fan yet.
 */
export function greetingStatus(claim: ClaimSummary, local: LocalGreeting = NO_LOCAL_GREETING, greetedAt: IsoTimestamp | null = null): GreetingStatusVM {
  const progress = local.progress;
  if (progress !== null && progress.uncertainPart !== null) {
    return { s: 'stopped', sent: progress.sent, total: progress.total, part: progress.uncertainPart + 1 };
  }
  if (progress !== null && progress.sent >= progress.total && progress.total > 0) return { s: 'greeted', at: progress.sentAt ?? greetedAt };
  if (progress !== null && (progress.sent > 0 || progress.inFlight)) return { s: 'sending', sent: progress.sent, total: progress.total };
  if (claim.greeting === 'confirmed') return { s: 'greeted', at: greetedAt };
  if (local.leaseMine) return { s: 'claim-mine' };
  if (local.heldBy !== null) return { s: local.heldBy === 'you-elsewhere' ? 'claim-elsewhere' : 'claim-other' };
  if (claim.lease === 'owned') return { s: 'claim-mine' };
  if (claim.lease === 'held') return { s: claim.heldBy === 'you-elsewhere' ? 'claim-elsewhere' : 'claim-other' };
  // No live lease, yet a part is on its way or unresolved: somebody's send holds the fan.
  if (claim.custody === 'dispatching' || claim.custody === 'uncertain-held') return { s: 'claim-other' };
  return { s: 'none' };
}

/** Which statuses a filter button shows (NF-006). */
export const FILTER_STATUSES: Readonly<Record<GreetingFilter, readonly GreetingStatusVM['s'][]>> = {
  any: ['none', 'claim-mine', 'claim-other', 'claim-elsewhere', 'sending', 'stopped', 'greeted'],
  none: ['none'],
  claimed: ['claim-mine', 'claim-other', 'claim-elsewhere'],
  sending: ['sending'],
  stopped: ['stopped'],
  greeted: ['greeted'],
};

/** «Поздороваться» holds everyone not greeted yet; «Все» everyone. */
export function inTab(status: GreetingStatusVM, tab: NewcomersTab): boolean {
  return tab === 'all' || status.s !== 'greeted';
}

export function passesFilter(status: GreetingStatusVM, filter: GreetingFilter): boolean {
  return FILTER_STATUSES[filter].includes(status.s);
}

export function matchesSearch(row: NewcomerRow, query: string): boolean {
  const needle = query.normalize('NFKC').toLowerCase().trim().replace(/^@+/, '');
  return needle.length === 0 || row.haystack.includes(needle);
}

/** Why Hi is off for a row, by its greeting status; null — Hi may start (the hub still decides on its own). */
export type HiBlock = 'claim-busy' | 'claim-elsewhere' | 'greeted' | 'uncertain';

export function hiBlock(status: GreetingStatusVM): HiBlock | null {
  switch (status.s) {
    case 'claim-other':
      return 'claim-busy';
    case 'claim-elsewhere':
      return 'claim-elsewhere';
    case 'stopped':
      return 'uncertain';
    case 'greeted':
      return 'greeted';
    case 'sending':
    case 'none':
    case 'claim-mine':
      return null;
  }
}

/**
 * NF-015: messages that are certainly personal — the fan's own, and ours the
 * archive knows were typed by a person. Above ten the thread is a dialogue:
 * Hi is refused before any AI call («это уже диалог, здесь нужен Reply»). A
 * message of ours with an unknown origin is not counted: the hub's own gate
 * decides those.
 */
export function personalMessages(items: readonly { readonly sender: string; readonly automatic: boolean | null; readonly deleted: boolean }[]): number {
  let count = 0;
  for (const item of items) {
    if (item.deleted) continue;
    if (item.sender === 'fan' || (item.sender === 'model' && item.automatic === false)) count += 1;
  }
  return count;
}

export function tooManyForHi(personal: number): boolean {
  return personal > HI_MAX_PERSONAL_MESSAGES;
}
