// «Онлайн» on Fansly (`fansly.online.seen`, contracts tab-messages-fansly.ts): who of the creator's followers Fansly saw
// active within the last 15 minutes — one `GET /account/<creator>/followersnew?lastSeenAfter=<now − 15 min>`, the read
// FBuddy makes, over FS-NET-1's purpose `online` (the creator's own session and pacer: never in the creator's queue, so
// a person's click never waits behind it, and nothing while the creator cools down) — reported to the hub as their
// presence (`clientOnlinePresence`), so the window's list knows them. Only for a tab granted the creator's page where
// the window is admitted (the manifest's `online`: the page's switch and a hub with `online-v1`).
//
// At most one read per creator a minute: a call within it is answered from the last read, and a call while one is in
// flight joins it. A call that provably asked Fansly nothing (no session, no frame of the tab in time, the creator
// cooling down) is not a read and does not hold the minute. Neither the read nor the report is repeated by itself: a
// report the hub refused is answered as its failure and goes again only with the next read. No name or text is kept.
//
// 2026-11-12: the read keeps the creator's `/account*` spacing (5 s; the pacer's `poll`). One the pacer finds too early
// (`early`: it sends nothing) is asked again at the moment it names, again and again until that minute's turn ends —
// then it was not a read either. Never during a cooldown, and never after `clear()`.

import type { CgAnyErrorWire } from '@cg/contracts/errors-fansly';
import type { FeatureSlice } from '@cg/contracts/features/types';
import { ONLINE_PRESENCE_MAX } from '@cg/contracts/hub';
import type { FanslyTabRequestPayload, FanslyTabResponsePayload } from '@cg/contracts/tab-messages-fansly';
import { admittedOn } from '@cg/core/domain/features';
import { readFollowersSeen } from '@cg/core/domain/hosts/fansly/newcomers';
import { flagRefusal } from '@cg/core/domain/ops';
import { FanslyApiError, type FanslyClient } from '@cg/fansly-api';

import type { BackgroundKit, HostSiteSender } from '../../src/composition/background/host-module';

type Request = FanslyTabRequestPayload<'fansly.online.seen'>;
type Answer = FanslyTabResponsePayload<'fansly.online.seen'>;

export const ONLINE_SEEN = {
  /** Who was active within this long: `lastSeenAfter` is now less it. */
  windowMs: 15 * 60_000,
  /** One read per creator at most this often; a call within it is answered from the last read. */
  everyMs: 60_000,
  /** The newest hundred followers seen in the window: one page, never walked further. */
  page: 100,
  /** A read told `early` is asked again up to this much after the moment the pacer named (another poll may aim at it too). */
  jitterMs: 250,
} as const;

/** The read's query: the head of the list (`before` and `after` 0, no search), the followers seen since `since` (epoch ms, as FBuddy sends it). */
export const onlineQuery = (since: number): Readonly<Record<string, string>> => ({
  before: '0',
  after: '0',
  limit: String(ONLINE_SEEN.page),
  offset: '0',
  search: '',
  lastSeenAfter: String(Math.floor(since)),
});

/** The last read of a creator: when it began, its answer, and whether it was one (a request may have left). */
interface Held {
  readonly at: number;
  answer: Promise<Answer>;
  settled: boolean;
  read: boolean;
}

export interface OnlineSeen {
  seen(request: Request, sender: HostSiteSender): Promise<Answer>;
  /** Forgets the last reads (another person signed in). */
  clear(): void;
}

const fail = (error: CgAnyErrorWire): Answer => ({ ok: false, error });

type Admitted = { readonly ok: true; readonly creator: string; readonly pageLabel: string } | { readonly ok: false; readonly error: CgAnyErrorWire };

export function createOnlineSeen(kit: Pick<BackgroundKit, 'hub' | 'clock' | 'networkSession' | 'log'>, slice: FeatureSlice, clientNow: () => Promise<Pick<FanslyClient, 'call'> | null>, random: () => number = Math.random): OnlineSeen {
  const last = new Map<string, Held>();
  /** Fired by `clear()`: a read waiting for the pacer's moment asks nothing more. */
  let stop = new AbortController();

  /** Waits until `at` (epoch ms) unless `clear()` comes first: true — the moment came. */
  function pause(at: number, signal: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
      if (signal.aborted) {
        resolve(false);
        return;
      }
      const abort = (): void => {
        kit.clock.clearTimer(timer);
        resolve(false);
      };
      const timer = kit.clock.setTimer(Math.max(0, at - kit.clock.now()), () => {
        signal.removeEventListener('abort', abort);
        resolve(true);
      });
      signal.addEventListener('abort', abort, { once: true });
    });
  }

  async function read(held: Held, creator: string, account: string, pageLabel: string): Promise<Answer> {
    const signal = stop.signal;
    const client = await clientNow().catch(() => null);
    if (client === null) return fail({ code: 'CG-FAN-SESSION' });
    let found: ReturnType<typeof readFollowersSeen>;
    for (;;) {
      const since = kit.clock.now() - ONLINE_SEEN.windowMs;
      try {
        const answer = await client.call({ purpose: 'online', route: 'followers.new', account, path: { account: creator }, query: onlineQuery(since) });
        held.read = true;
        found = readFollowersSeen(answer.response, creator, since, kit.clock.now());
        break;
      } catch (error) {
        // Too early for the creator's `/account*` spacing (nothing left): asked again at the pacer's moment, within this minute.
        if (error instanceof FanslyApiError && error.kind === 'early' && error.retryAt !== undefined) {
          const at = error.retryAt + Math.floor(random() * (ONLINE_SEEN.jitterMs + 1));
          if (at < held.at + ONLINE_SEEN.everyMs && (await pause(at, signal))) continue;
        }
        // Refused before anything left (no session, no frame, a cooldown, too early): not a read. Anything else may have reached Fansly.
        held.read = !(error instanceof FanslyApiError) || error.sent;
        const wire = error instanceof FanslyApiError ? error.toWire() : { code: 'CG-FAN-REQUEST' as const };
        if (!signal.aborted) kit.log.service({ level: 'warn', scope: 'fansly.online', msg: 'followers not read', fields: { code: wire.code } });
        return fail(wire);
      }
    }
    if (found === null) {
      kit.log.service({ level: 'warn', scope: 'fansly.online', msg: 'followers page malformed', fields: {} });
      return fail({ code: 'CG-FAN-REQUEST' });
    }
    const seen = found.slice(0, ONLINE_PRESENCE_MAX);
    if (seen.length === 0) return { ok: true, seen: 0, recorded: 0 };
    try {
      const result = await kit.hub.facade.onlinePresence({ pageLabel, seen: seen.map((fan) => ({ fanRef: fan.fanRef, lastSeenAt: new Date(fan.lastSeenAt).toISOString() })) });
      return { ok: true, seen: seen.length, recorded: result.recorded };
    } catch (error) {
      const wire = kit.hub.errorWire(error);
      kit.log.service({ level: 'warn', scope: 'fansly.online', msg: 'presence not reported', fields: { code: wire.code } });
      return fail(wire);
    }
  }

  /** The tab's page is the creator's Fansly page and «Онлайн» is admitted there. */
  async function admit(pageId: number, hostAccountId: string, sender: HostSiteSender): Promise<Admitted> {
    if (sender.kind !== 'tab') return { ok: false, error: { code: 'CG-CONTEXT-CHANGED' } };
    const grant = await kit.hub.page(pageId, sender);
    if (!grant.ok) return { ok: false, error: { code: grant.code } };
    // The creator's page (by either of the tab's ids for the creator, as the preview's read finds it).
    const bootstrap = kit.hub.bootstrap();
    const page = bootstrap?.pages.find((entry) => entry.pageId === pageId);
    const ids = [hostAccountId, ...(kit.networkSession?.aliases(hostAccountId) ?? [])];
    if (bootstrap === null || page === undefined || page.platform !== 'fansly' || page.platformAccountId === null || !ids.includes(page.platformAccountId)) return { ok: false, error: { code: 'CG-BINDING-NOT-GRANTED' } };
    const admitted = admittedOn(slice, 'online', null, bootstrap, page);
    if (!admitted.usable) return { ok: false, error: flagRefusal(admitted) };
    return { ok: true, creator: page.platformAccountId, pageLabel: grant.page.pageLabel };
  }

  return {
    async seen(request, sender) {
      const admitted = await admit(request.pageId, request.hostAccountId, sender);
      if (!admitted.ok) return fail(admitted.error);
      const creator = admitted.creator;
      const now = kit.clock.now();
      const held = last.get(creator);
      if (held !== undefined && (!held.settled || (held.read && now - held.at < ONLINE_SEEN.everyMs))) return held.answer;
      // Set before anything is awaited: a call that comes meanwhile joins this read.
      const next: Held = { at: now, answer: Promise.resolve(fail({ code: 'CG-FAN-REQUEST' })), settled: false, read: false };
      next.answer = read(next, creator, request.hostAccountId, admitted.pageLabel).finally(() => {
        next.settled = true;
        if (!next.read && last.get(creator) === next) last.delete(creator);
      });
      last.set(creator, next);
      return next.answer;
    },
    clear() {
      last.clear();
      stop.abort();
      stop = new AbortController();
    },
  };
}
