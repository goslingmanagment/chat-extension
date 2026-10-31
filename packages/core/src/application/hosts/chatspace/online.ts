// «Онлайн» on OnlyFans from ChatSpace itself (2026-10-31, hub #952). OnlyFansAPI's feed of who is online stops, so the
// tab tells the hub what ChatSpace already knows: the fans its own online poll found online — the chats on its screen
// and the open chat, read from the page's memory with no request of ours — each with the moment ChatSpace asked.
//
// Where the owner's `onlineProbe` is on, the page's one bounded probe besides: the hub lends it to one tab of the whole
// team at a time, at most every five minutes a page, with up to 400 of the page's known spenders; the tab that holds it
// asks OnlyMonster about them once, as ChatSpace's own poll asks (`fans-online`, the page's own session, only while the
// page is on screen), and reports the online ones. Nothing is retried: a probe ChatSpace answered with an error or with
// its own `timed_out` makes this tab ask again only 10, then 20, then 40 minutes later, and the window says so; a probe
// that asked nothing (the page off screen, no session yet) is just skipped. Reads only: no chat is opened, nothing is
// written to ChatSpace or to anyone.

import { ONLINE_PRESENCE_MAX, type OnlineProbeResult } from '@cg/contracts/hub';
import type { OnlinePresencePort, OnlineProbeFailure } from '@cg/contracts/host';
import type { HostAccount } from '@cg/contracts/ids';
import { ONLINE_SOURCE_LIMITS } from '@cg/contracts/limits';

import type { OnlineProbeStatus, OnlineProbeTrouble, OnlineSiteSource } from '../../online/source';

/** A lent probe's next ask comes at least this long after the hub's answer, spread over this much more between tabs. */
const LEND_WAIT_MIN_MS = 30_000;
const LEND_SPREAD_MS = 30_000;
/** The reported moments a page keeps past this many fans: the older ones than the window go. */
const REPORTED_KEEP = 2000;
/** A probe that asked ChatSpace nothing (or could not): skipped, never a trouble of ChatSpace's. */
const NOTHING_ASKED: readonly (OnlineProbeFailure | 'unavailable')[] = ['hidden', 'account', 'endpoint', 'session'];

export interface ChatSpaceOnlineDeps {
  /** ChatSpace's own word of who is online (HostPort.onlinePresence); null — the port has none. */
  readonly port: OnlinePresencePort | null;
  /** ChatSpace's accounts as the port has them: the creator's OnlyFans id names its OnlyMonster account. */
  readonly accounts: () => readonly HostAccount[];
  /** The fans found online, to the hub (`online.presence`): one call, never repeated; false — it did not go. */
  readonly report: (pageId: number, seen: readonly { readonly fanRef: string; readonly lastSeenAt: string }[]) => Promise<boolean>;
  /** The page's probe asked of the hub (`online.probe`); null — refused (the owner's switch is off) or no answer. */
  readonly lend: (pageId: number) => Promise<OnlineProbeResult | null>;
  readonly clock: { now(): number };
  readonly random: () => number;
  /** The page is on screen: the probe is asked for only then (ChatSpace polls only while it is visible). */
  readonly visible: () => boolean;
}

interface ProbePage {
  /** When this tab may ask the hub for the page's probe again. */
  nextAt: number;
  /** The wait after the last failed probe; 0 — the last one did not fail. */
  backoffMs: number;
  running: boolean;
  trouble: OnlineProbeTrouble | null;
}

export function createChatSpaceOnlineSource(deps: ChatSpaceOnlineDeps): OnlineSiteSource & { readonly probe: OnlineProbeStatus } {
  const { port, clock } = deps;
  /** What this tab told the hub of each page: the newest moment of each fan. */
  const reported = new Map<number, Map<string, number>>();
  const pages = new Map<number, ProbePage>();
  const listeners = new Set<() => void>();

  const hostAccountOf = (account: string): string | null => deps.accounts().find((one) => one.platformAccountId === account)?.hostAccountId ?? null;

  const setTrouble = (page: ProbePage, trouble: OnlineProbeTrouble | null): void => {
    if (page.trouble === trouble || (page.trouble?.kind === trouble?.kind && page.trouble?.retryAt === trouble?.retryAt)) return;
    page.trouble = trouble;
    for (const listener of [...listeners]) listener();
  };

  /** Who ChatSpace's own poll found online since this tab last told the hub: to the hub, once. */
  async function fromMemory(pageId: number, hostAccountId: string, read: OnlinePresencePort): Promise<void> {
    const seen = await read.seen(hostAccountId);
    if (!seen.ok) return;
    const known = reported.get(pageId) ?? new Map<string, number>();
    reported.set(pageId, known);
    const fresh = seen.fans.filter((fan) => {
      const at = Date.parse(fan.at);
      return Number.isFinite(at) && at > (known.get(fan.fanRef) ?? -Infinity);
    });
    if (fresh.length === 0) return;
    for (const fan of fresh) known.set(fan.fanRef, Date.parse(fan.at));
    if (known.size > REPORTED_KEEP) {
      const old = clock.now() - ONLINE_SOURCE_LIMITS.seenWindowMs;
      for (const [fanRef, at] of known) if (at < old) known.delete(fanRef);
    }
    await deps.report(pageId, fresh.slice(0, ONLINE_PRESENCE_MAX).map((fan) => ({ fanRef: fan.fanRef, lastSeenAt: fan.at })));
  }

  /** The page's probe, when this tab may ask for it: lent by the hub to one tab of the team, run once, never retried. */
  async function probe(pageId: number, hostAccountId: string, read: OnlinePresencePort): Promise<void> {
    const page = pages.get(pageId) ?? { nextAt: 0, backoffMs: 0, running: false, trouble: null };
    pages.set(pageId, page);
    if (page.running || clock.now() < page.nextAt || !deps.visible()) return;
    page.running = true;
    // Whatever comes of it, not before ChatSpace's own pace.
    page.nextAt = clock.now() + ONLINE_SOURCE_LIMITS.probeEveryMs;
    try {
      const lent = await deps.lend(pageId);
      if (lent === null) return;
      if (!lent.granted || lent.fanRefs.length === 0) {
        // Another tab of the team holds it: ask when the hub may lend it again, the tabs spread a little.
        const wait = Date.parse(lent.nextAt) - Date.parse(lent.serverNow);
        const due = Number.isFinite(wait) ? Math.min(Math.max(wait, LEND_WAIT_MIN_MS), ONLINE_SOURCE_LIMITS.probeEveryMs) : ONLINE_SOURCE_LIMITS.probeEveryMs;
        page.nextAt = clock.now() + due + Math.floor(deps.random() * LEND_SPREAD_MS);
        return;
      }
      const fans = lent.fanRefs.slice(0, ONLINE_SOURCE_LIMITS.probeMax);
      const answer = await read.probe(hostAccountId, fans);
      if (answer.ok && !answer.timedOut) {
        page.backoffMs = 0;
        setTrouble(page, null);
        // The most paid first, as the hub named them, within one report.
        const order = new Map(fans.map((fanRef, index) => [fanRef, index]));
        const online = [...answer.online].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)).slice(0, ONLINE_PRESENCE_MAX);
        if (online.length > 0) await deps.report(pageId, online.map((fanRef) => ({ fanRef, lastSeenAt: answer.at })));
        return;
      }
      if (!answer.ok && NOTHING_ASKED.includes(answer.reason)) return;
      // ChatSpace answered with an error, or said its own read timed out: this tab backs off, and the window says so.
      page.backoffMs = page.backoffMs === 0 ? ONLINE_SOURCE_LIMITS.backoffMs : Math.min(page.backoffMs * 2, ONLINE_SOURCE_LIMITS.backoffMaxMs);
      page.nextAt = clock.now() + page.backoffMs;
      setTrouble(page, { kind: answer.ok ? 'timeout' : 'error', retryAt: page.nextAt });
    } finally {
      page.running = false;
    }
  }

  return {
    words: { line: 'online.line.sourceChatspace', empty: 'online.empty.chatspace' },
    async seen(pageId, account) {
      const hostAccountId = hostAccountOf(account);
      if (port === null || hostAccountId === null) return;
      await fromMemory(pageId, hostAccountId, port).catch(() => undefined);
      // Never awaited: the hub's list is not held by a probe.
      void probe(pageId, hostAccountId, port).catch(() => undefined);
    },
    probe: {
      trouble: (pageId) => pages.get(pageId)?.trouble ?? null,
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
  };
}
