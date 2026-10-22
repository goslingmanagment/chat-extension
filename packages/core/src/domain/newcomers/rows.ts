// Rows of «Новые» (architecture.md §8.5, §6.7.9, hub H-7c; NF-005…NF-007,
// NF-014, NF-015): who subscribed or came back in the window, and where the
// greeting stands. Two things are kept apart, as the hub keeps them: the
// fact «greeted» (for ever; the desktop's outbox confirms it too) and the
// custody of a sent part. A row never looks greeted without that fact. No
// lease is shown (2026-10-22, «правь все»: nobody takes one any more, and a
// colleague's send in flight is a quiet note, never a hold), and a part whose
// outcome is unknown says so and stops nothing: the person looks at the chat
// and may send again.

import { type AudienceNewItem, type ClaimState, type ClaimSummary } from '@cg/contracts/hub';
import { type IsoTimestamp } from '@cg/contracts/primitives';
import { type GreetingFilter, type GreetingStatusVM, type NewcomerKind, type NewcomersTab } from '@cg/contracts/vm';

export interface NewcomerRow {
  readonly fanRef: string;
  /** The hub's stable event id: what keeps the subscriber sound from repeating. */
  readonly eventRef: string;
  readonly name: string;
  readonly username: string | null;
  readonly kind: NewcomerKind;
  readonly trial: boolean;
  readonly subscribedAt: IsoTimestamp;
  /** The current subscription of THIS page as the hub knows it, with its data time and its end (X8 condition 9). */
  readonly subscription: { readonly state: 'active' | 'expired' | 'unknown'; readonly asOf: IsoTimestamp | null; readonly endsAt: IsoTimestamp | null };
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
  return { state, asOf: status.asOf, endsAt: status.endsAt };
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

/** What this tab itself knows about a fan's greeting: the parts it sent. */
export interface LocalGreeting {
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

export const NO_LOCAL_GREETING: LocalGreeting = { progress: null };

/** Part numbers of the hub's own answer for a group (`ClaimState.group`), when a claim call brought one. */
export function progressOfClaim(state: ClaimState | null): LocalGreeting['progress'] {
  const group = state?.group ?? null;
  if (group === null) return null;
  const held = [...group.heldParts].sort((a, b) => a - b)[0];
  const inFlight = state?.custody?.state === 'dispatching';
  return { sent: new Set(group.sentParts).size, total: group.partCount, uncertainPart: held ?? null, inFlight, sentAt: state?.greeting.at ?? null };
}

/**
 * The «Приветствие» column. In order: a part whose outcome is unknown says so
 * (it holds nothing, 2026-10-20 audit, row 2); parts on their way show the
 * progress; every part confirmed (or the hub's fact alone) is «поздоровались»;
 * a fan who wrote is a dialogue; a send of somebody else's still in its
 * ticket is a quiet «отправляется другим чаттером». No lease is a status any
 * more (2026-10-22): a colleague's lease an older client takes, and a send of
 * theirs past its ticket, hold nothing here — the hub refuses at the send what
 * it must. Incoming archive history is a conversation without a ChatGoose
 * greeting receipt; outgoing messages alone may be automated and do not
 * establish that fact.
 */
export function greetingStatus(claim: ClaimSummary, local: LocalGreeting = NO_LOCAL_GREETING, greetedAt: IsoTimestamp | null = null, fanWrote = false): GreetingStatusVM {
  const progress = local.progress;
  if (progress !== null && progress.uncertainPart !== null) {
    return { s: 'stopped', sent: progress.sent, total: progress.total, part: progress.uncertainPart + 1 };
  }
  if (progress !== null && progress.sent >= progress.total && progress.total > 0) return { s: 'greeted', at: progress.sentAt ?? greetedAt };
  if (progress !== null && (progress.sent > 0 || progress.inFlight)) return { s: 'sending', sent: progress.sent, total: progress.total };
  if (claim.greeting === 'confirmed') return { s: 'greeted', at: greetedAt };
  // An incoming message is direct evidence of a started conversation, even without a ChatGoose send receipt.
  // Outgoing messages alone prove nothing: the archive may contain only an automatic welcome or a mass message.
  if (fanWrote) return { s: 'replied' };
  // Somebody's part is on its way to the fan right now (the hub's `dispatching`, inside its ticket): a note, not a hold.
  if (claim.custody === 'dispatching') return { s: 'sending-other' };
  return { s: 'none' };
}

/** Which statuses a filter button shows (NF-006). */
export const FILTER_STATUSES: Readonly<Record<GreetingFilter, readonly GreetingStatusVM['s'][]>> = {
  any: ['none', 'sending-other', 'sending', 'stopped', 'greeted', 'replied'],
  none: ['none'],
  sending: ['sending', 'sending-other'],
  stopped: ['stopped'],
  greeted: ['greeted'],
  replied: ['replied'],
};

/**
 * «Поздороваться» leaves out confirmed greetings; «Все» keeps everyone. A fan who already wrote stays: it is a row to
 * work with, as «Ждёт ответа» in the old Fansly window (X59; 2026-10-21 restrictions, item 14).
 */
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
export type HiBlock = 'greeted' | 'sending';

/**
 * §6.7.9, owner X5: after the first confirmed part the fan counts as greeted —
 * the owner may still send the rest of that group, but another generation
 * would be a second greeting, so Hi is off from then on («Уже поздоровались —
 * дальше Reply»). While the first part is still on its way Hi waits for it. A
 * colleague's send, a lease and an unknown outcome hold nothing (2026-10-20
 * audit, rows 2 and 11; 2026-10-22): the hub claims the fan at the send and
 * refuses one somebody greeted. A fan who already wrote is no block either
 * (2026-10-21 restrictions, item 14): the person sees the thread and decides.
 * Hi has no message limit (the owner, 2026-10-21).
 */
export function hiBlock(status: GreetingStatusVM): HiBlock | null {
  switch (status.s) {
    case 'greeted':
      return 'greeted';
    case 'sending':
      return status.sent > 0 ? 'greeted' : 'sending';
    case 'stopped':
      return status.sent > 0 ? 'greeted' : null;
    case 'replied':
    case 'sending-other':
    case 'none':
      return null;
  }
}
