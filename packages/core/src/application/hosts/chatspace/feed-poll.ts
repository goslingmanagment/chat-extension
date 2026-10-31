// The OnlyFans feed's light reads of ChatSpace (2026-10-31, the owner: «к ChatSpace я разрешаю запросы без проблем,
// если они будут работать нормально»; hub #955). What ChatSpace's socket does not carry — the page's new subscribers
// and its sales ledger (subscription money, renewals, chargebacks) — is read the way ChatSpace's own client reads it,
// at its own pace: the first page of each list every ten minutes, and back page by page to the newest item the hub
// already holds, never further than the hub says (`maxPages`).
//
// ONE poller an OnlyMonster account for the whole team: the hub lends the page's poll to one tab at a time — the
// agency's always-on ChatSpace tab while it is there, else a chatter's — and this tab reads only while it holds it.
// Nothing is retried: a page ChatSpace refused or did not answer ends the poll, and this tab asks again only 10, then
// 20, 40 and at most 60 minutes later. Reads only: no chat is opened, nothing is marked read or written. What a read
// brings reaches the hub through the OnlyFans feed (MAIN feed.ts), which dedups it with every other sighting.

import { ONLYFANS_POLL_EVERY_MS, ONLYFANS_POLL_LISTS, type OnlyfansPollResult } from '@cg/contracts/hub';
import type { FeedPollPort } from '@cg/contracts/host';
import type { HostAccount } from '@cg/contracts/ids';

/** How often this tab looks whether an account's poll is due. */
export const FEED_POLL_TICK_MS = 60_000;
/** Between two pages of one poll: ChatSpace's own client never asks faster. */
export const FEED_POLL_PAGE_GAP_MS = 2_000;
/** The first wait after a failed page; it doubles up to FEED_POLL_BACKOFF_MAX_MS. */
export const FEED_POLL_BACKOFF_MS = 10 * 60_000;
export const FEED_POLL_BACKOFF_MAX_MS = 60 * 60_000;
/** The tabs of the team ask the hub a little apart. */
const LEND_SPREAD_MS = 30_000;
/** At least this long after a «not yours» answer. */
const LEND_WAIT_MIN_MS = 30_000;

export interface ChatSpaceFeedPollDeps {
  /** ChatSpace's own lists (HostPort.feedPoll); null — the port has none. */
  readonly port: FeedPollPort | null;
  /** ChatSpace's OnlyFans accounts as the port has them: the creator's OnlyFans id names its page. */
  readonly accounts: () => readonly HostAccount[];
  /** The page's poll asked of the hub (`feed.poll`); null — refused (the page's switch is off), or no answer. */
  readonly lend: (hostAccountId: string, creatorId: string) => Promise<OnlyfansPollResult | null>;
  readonly clock: { now(): number };
  readonly random: () => number;
  readonly setTimer: (ms: number, fn: () => void) => unknown;
  readonly clearTimer: (handle: unknown) => void;
}

interface AccountPoll {
  nextAt: number;
  backoffMs: number;
  running: boolean;
}

/** The poll of one account, once lent: each list back to the hub's cursor. False — a page failed (the poll stops). */
export async function pollAccount(deps: Pick<ChatSpaceFeedPollDeps, 'setTimer'> & { readonly port: FeedPollPort }, hostAccountId: string, lent: OnlyfansPollResult): Promise<boolean> {
  const wait = (ms: number): Promise<void> => new Promise((resolve) => void deps.setTimer(ms, resolve));
  let first = true;
  for (const list of ONLYFANS_POLL_LISTS) {
    const known = lent.cursors[list];
    let cursor: string | null = null;
    for (let page = 0; page < Math.max(1, lent.maxPages); page += 1) {
      if (!first) await wait(FEED_POLL_PAGE_GAP_MS);
      first = false;
      const read = await deps.port.read(hostAccountId, list, cursor);
      if (!read.ok) return read.reason === 'account';
      // Back to what the hub holds: no further.
      if (known !== null && read.refs.includes(known)) break;
      if (!read.hasMore || read.next === null) break;
      cursor = read.next;
    }
  }
  return true;
}

export function startChatSpaceFeedPoll(deps: ChatSpaceFeedPollDeps): () => void {
  const { port, clock } = deps;
  const polls = new Map<string, AccountPoll>();
  let stopped = false;
  let timer: unknown = null;

  async function maybePoll(account: HostAccount): Promise<void> {
    if (port === null || account.platform !== 'onlyfans' || account.platformAccountId === null) return;
    const state = polls.get(account.hostAccountId) ?? { nextAt: 0, backoffMs: 0, running: false };
    polls.set(account.hostAccountId, state);
    if (state.running || clock.now() < state.nextAt) return;
    state.running = true;
    // Whatever comes of it, not before the team's pace.
    state.nextAt = clock.now() + ONLYFANS_POLL_EVERY_MS + Math.floor(deps.random() * LEND_SPREAD_MS);
    try {
      const lent = await deps.lend(account.hostAccountId, account.platformAccountId);
      if (lent === null || stopped) return;
      if (!lent.granted) {
        const due = Date.parse(lent.nextAt) - Date.parse(lent.serverNow);
        const waitMs = Number.isFinite(due) ? Math.min(Math.max(due, LEND_WAIT_MIN_MS), ONLYFANS_POLL_EVERY_MS) : ONLYFANS_POLL_EVERY_MS;
        state.nextAt = clock.now() + waitMs + Math.floor(deps.random() * LEND_SPREAD_MS);
        return;
      }
      const done = await pollAccount({ port, setTimer: deps.setTimer }, account.hostAccountId, lent);
      if (done) {
        state.backoffMs = 0;
        return;
      }
      // ChatSpace refused or did not answer: this tab backs off; another tab may hold the next poll.
      state.backoffMs = state.backoffMs === 0 ? FEED_POLL_BACKOFF_MS : Math.min(state.backoffMs * 2, FEED_POLL_BACKOFF_MAX_MS);
      state.nextAt = clock.now() + state.backoffMs;
    } finally {
      state.running = false;
    }
  }

  const tick = (): void => {
    if (stopped) return;
    for (const account of deps.accounts()) void maybePoll(account).catch(() => undefined);
    timer = deps.setTimer(FEED_POLL_TICK_MS, tick);
  };
  timer = deps.setTimer(FEED_POLL_PAGE_GAP_MS, tick);

  return () => {
    stopped = true;
    if (timer !== null) deps.clearTimer(timer);
  };
}
