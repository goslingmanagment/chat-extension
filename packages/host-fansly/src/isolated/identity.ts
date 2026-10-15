// Who and which chat, on a Fansly tab (docs/project-unite/architecture.md
// §5.7, §7.2, §7.7; FS-IDN-1…3, FS-IDN-5, FS-RTE-4). Pure: the port keeps
// the state, these say what it means.
//
// - The creator is `account.id` of the page's own `GET /account/me` answer
//   (MAIN's `fx.identity`). It is the tab's one account (AU-034) and the only
//   key that binds it to a hub page: `platformAccountId` = the creator id =
//   the page's `external_page_id` (HF-1; FS-IDN-5, AU-023) — never a name.
//   Until the page answered, there is no account and no identity («Аккаунт не
//   определён», UI-011).
// - A route of a conversation names its group (`conversationRef`); its fan
//   comes from MAIN's `fx.chat`, which answers our `fx.focus` with the same
//   route epoch. An answer of an older epoch — A → B → A — is dropped
//   (FS-RTE-4). A group with more than one fan is `group`: no chat, no AI
//   (FS-IDN-3). Until MAIN names the fan the chat is null and its window too:
//   the dock says «чат ещё грузится» (AI-122) — never a guess.
// - The login epoch moves whenever the creator does: an identity taken under
//   another creator matches nothing written later.

import type { FanslyChatWire } from '@cg/contracts/bridge-messages-fansly';
import type { ChatWindow, HostFan, RouteState } from '@cg/contracts/host';
import type { ChatRef, HostAccount, HostIdentity } from '@cg/contracts/ids';

import type { FanslyRoute } from './route';

export const FANSLY_KIND = 'fansly-web';
export const FANSLY_PLATFORM = 'fansly';

/** The tab's one account: the creator of `/account/me`; its platform id is the same id (HF-1). */
export function accountOf(creatorId: string | null): HostAccount | null {
  return creatorId === null ? null : { host: FANSLY_KIND, hostAccountId: creatorId, platform: FANSLY_PLATFORM, platformAccountId: creatorId, username: null, displayName: null };
}

/** MAIN's chat answers this route: its group and the epoch of the focus it was asked with (FS-RTE-4). */
export function chatFits(route: FanslyRoute, wire: FanslyChatWire): boolean {
  return wire.groupId === route.groupId && wire.routeEpoch === route.epoch;
}

/** The chat of a direct group once both its creator and its fan are known; null otherwise (a group chat, not known yet). */
export function chatOf(creatorId: string | null, wire: FanslyChatWire | null): ChatRef | null {
  if (creatorId === null || wire === null || wire.kind !== 'direct' || wire.fanId === null || wire.fanId === creatorId) return null;
  return { host: FANSLY_KIND, hostAccountId: creatorId, platformFanId: wire.fanId };
}

/** The route as HostPort says it: a conversation names its group, its kind once MAIN knows it, its chat once the fan is known. */
export function routeStateOf(route: FanslyRoute, creatorId: string | null, wire: FanslyChatWire | null): RouteState {
  const account = accountOf(creatorId);
  if (route.groupId === null) return { epoch: route.epoch, name: 'other', account, chat: null };
  const fits = wire !== null && chatFits(route, wire) ? wire : null;
  return {
    epoch: route.epoch,
    name: 'chat',
    account,
    chat: chatOf(creatorId, fits),
    conversationRef: route.groupId,
    ...(fits === null || fits.kind === null ? {} : { conversationKind: fits.kind }),
  };
}

export const sameChat = (a: ChatRef | null, b: ChatRef | null): boolean =>
  a === null || b === null ? a === b : a.host === b.host && a.hostAccountId === b.hostAccountId && a.platformFanId === b.platformFanId;

export const sameRoute = (a: RouteState, b: RouteState): boolean =>
  a.epoch === b.epoch && a.name === b.name && a.account?.hostAccountId === b.account?.hostAccountId && sameChat(a.chat, b.chat) && a.conversationRef === b.conversationRef && a.conversationKind === b.conversationKind;

/** What the page looks like for a read or a write: null without MAIN's document epoch or before the creator is known. */
export function identityOf(input: {
  readonly documentEpoch: string | null;
  readonly loginEpoch: string | null;
  readonly route: RouteState;
  readonly composerInstanceId: string | null;
}): HostIdentity | null {
  const account = input.route.account;
  if (input.documentEpoch === null || input.loginEpoch === null || account === null || account.platformAccountId === null) return null;
  return {
    host: FANSLY_KIND,
    documentEpoch: input.documentEpoch,
    hostLoginEpoch: input.loginEpoch,
    hostAccountId: account.hostAccountId,
    platformAccountId: account.platformAccountId,
    chat: input.route.chat,
    routeEpoch: input.route.epoch,
    composerInstanceId: input.route.chat === null ? null : input.composerInstanceId,
  };
}

/** The same page, route, account and chat (FS-RTE-4): what a read or a write asked for is still what is open. */
export function identityMatches(expected: HostIdentity, current: HostIdentity): boolean {
  return (
    expected.host === current.host &&
    expected.documentEpoch === current.documentEpoch &&
    expected.hostLoginEpoch === current.hostLoginEpoch &&
    expected.routeEpoch === current.routeEpoch &&
    expected.hostAccountId === current.hostAccountId &&
    expected.platformAccountId === current.platformAccountId &&
    sameChat(expected.chat, current.chat)
  );
}

/**
 * The window of the open chat as MAIN summarizes it (`fx.chat`), synchronously (§7.7: a read that waits would keep the
 * dock «loading» for ever, S1b §2.1). Fansly's summary has no count by side: those stay 0 and no rule of Fansly reads
 * them — its own facts are `loaded`, whether the history before is known (`hasOlder`: false only while the start is
 * proven and the observation complete), the newest message's time (`newestAt`, the lag of the hub's archive) and the fan's script (the language
 * gate without a copy of the text in the tab).
 */
export function chatWindowOf(chat: ChatRef, wire: FanslyChatWire): ChatWindow {
  const window = wire.window;
  return {
    chat,
    state: 'ready',
    loaded: Math.min(window.loaded, 200),
    fanMessages: 0,
    modelMessages: 0,
    lastFanMessageId: null,
    lastFanMessageAt: null,
    lastModelMessageAt: null,
    hasOlder: window.startProven && window.completeness === 'complete' ? false : null,
    fanScript: window.fanScript,
    newestAt: window.newestAt,
  };
}

/** The fan as the page's answers name it: only whether DMs are allowed — decoration; the facts are the hub's. */
export function fanOf(chat: ChatRef, wire: FanslyChatWire): HostFan {
  return {
    chat,
    username: null,
    displayName: null,
    isBlocked: null,
    canReceiveMessages: wire.dmAllowed,
    isRestricted: null,
    isOnline: null,
    lastSeenAt: null,
    buyingPowerLabel: null,
    insights: null,
    bio: null,
    lists: null,
  };
}
