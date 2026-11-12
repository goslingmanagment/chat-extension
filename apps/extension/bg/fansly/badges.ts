// The fans' badges (`fansly.fans.badges`, contracts fan-badges.ts; 2026-10-28) for «Онлайн», Spenders, «Рассылка» and
// «Новые»: Fansly's blue card «Recent Spender» from one `GET /account?ids=` (FS-NET-1 `badges`: never queued, nothing
// while the creator cools down) and FBuddy's tier (./fbuddy.ts), read side by side — either may fail alone, the other's
// answer still goes. Each fan's blue card is kept thirty minutes per creator (ten until 2026-11-12); a fan asked within
// them is answered from it. Only for a tab granted the creator's Fansly page; nothing of a fan's name or text is kept.
//
// 2026-11-12: Fansly's `/account*` reads are 5 s apart per creator (pacer/rules.ts: the third `/account?ids=` read 2 s
// apart drew a 429, and a 429 cools every click of the model for 30–300 s). A long board asks a hundred fans a call, one
// call after another, and several tabs ask at once: each creator's reads here go one after another (a request waits its
// turn, then reads only the fans the one before it did not), and a read the pacer finds too early (`early`) waits until
// the moment it names and is asked again. A request's reads start within `waitMs` of its coming or not at all, so the
// tab's wait for its answer is never outrun by ours; `clear()` stops every wait. A cooldown or any other failure leaves
// the fans unknown this time, said once in the log, as before.
//
// 2026-11-12: what was read goes on to the hub (`clientFanBadges`, `fan-badges-v1`) for its analytics and agents, after
// the tab is answered and never in its way: one call per request, a field only where its source answered for the fan
// (the tier where FBuddy answered, null where it has none for him; the blue card where Fansly said it). A fan whose
// badges equal what went in the last six hours does not go again. A refusal or no answer is one warning, and those
// fans go again with a later read; nothing is repeated by itself.

import type { CgAnyErrorWire } from '@cg/contracts/errors-fansly';
import type { FbuddyTier } from '@cg/contracts/fan-badges';
import { FAN_BADGES_REPORT_MAX, hasCapability, type FanBadgesReportFan } from '@cg/contracts/hub';
import type { FanslyTabRequestPayload, FanslyTabResponsePayload } from '@cg/contracts/tab-messages-fansly';
import { readRecentSpenders } from '@cg/core/domain/hosts/fansly/badges';
import { FanslyApiError, type FanslyClient } from '@cg/fansly-api';

import type { BackgroundKit, HostSiteSender } from '../../src/composition/background/host-module';
import type { FbuddyAnswer, FbuddyTiers } from './fbuddy';

type Request = FanslyTabRequestPayload<'fansly.fans.badges'>;
type Answer = FanslyTabResponsePayload<'fansly.fans.badges'>;

export const FAN_BADGES_READ = {
  /** A fan's blue card is kept this long: asked of Fansly again no sooner. */
  keepMs: 30 * 60_000,
  /** The kept blue cards at most (every creator together). */
  keepMax: 5_000,
  /**
   * A request's read of Fansly starts within this long of its coming — its turn and the pacer's moments included — or
   * not at all: below the tab's wait for the answer (35 s, tab requests.ts `FAN_BADGES_TIMEOUT_MS`), with room for the read.
   */
  waitMs: 20_000,
  /** A read told `early` is asked again up to this much after the moment the pacer named (another poll may aim at it too). */
  jitterMs: 250,
} as const;

export const FAN_BADGES_REPORT = {
  /** A fan whose badges equal what went to the hub within this long does not go again. */
  againMs: 6 * 60 * 60_000,
  /** The fans remembered as sent at most (every creator together); the oldest go first. */
  keepMax: 20_000,
} as const;

export interface FanBadgesService {
  badges(request: Request, sender: HostSiteSender): Promise<Answer>;
  /** Forgets everything (another person signed in). */
  clear(): void;
}

/** What went to the hub for a fan, and when; a field absent — it did not go. */
interface Sent {
  readonly at: number;
  readonly tier: FbuddyTier | null | undefined;
  readonly card: boolean | undefined;
}

const fail = (error: CgAnyErrorWire): Answer => ({ ok: false, error });

export function createFanBadges(kit: Pick<BackgroundKit, 'hub' | 'clock' | 'networkSession' | 'log'>, clientNow: () => Promise<Pick<FanslyClient, 'call'> | null>, fbuddy: FbuddyTiers | null, random: () => number = Math.random): FanBadgesService {
  /** Each fan's blue card, by creator and fan, and when it was read. */
  const cards = new Map<string, { readonly at: number; readonly value: boolean | null }>();
  /** What went to the hub, by creator and fan, the oldest first. */
  const sent = new Map<string, Sent>();
  /** Each creator's last turn to read Fansly: the next request waits for it. */
  const chains = new Map<string, Promise<void>>();
  /** Fired by `clear()`: every wait for a turn or a moment ends, and nothing more is read for it. */
  let stop = new AbortController();
  /** One more with each `clear()`: a report of a request begun before it goes nowhere. */
  let generation = 0;

  /** Waits for `work` (null — nothing but the time) until `deadline` or `clear()`, whichever comes first. */
  function race(work: Promise<void> | null, deadline: number, signal: AbortSignal): Promise<'work' | 'time' | 'stop'> {
    return new Promise((resolve) => {
      if (signal.aborted) {
        resolve('stop');
        return;
      }
      let done = false;
      const finish = (end: 'work' | 'time' | 'stop'): void => {
        if (done) return;
        done = true;
        kit.clock.clearTimer(timer);
        signal.removeEventListener('abort', abort);
        resolve(end);
      };
      const abort = (): void => finish('stop');
      const timer = kit.clock.setTimer(Math.max(0, deadline - kit.clock.now()), () => finish('time'));
      signal.addEventListener('abort', abort, { once: true });
      void work?.then(() => finish('work'));
    });
  }

  /** The fans' blue cards: the ones kept, the rest from `GET /account?ids=` in the creator's turn; a failed read leaves them unknown. */
  async function readCards(creator: string, account: string, fanRefs: readonly string[]): Promise<Map<string, boolean | null>> {
    const begun = generation;
    const signal = stop.signal;
    const now = kit.clock.now();
    const deadline = now + FAN_BADGES_READ.waitMs;
    for (const [name, entry] of cards) if (cards.size > FAN_BADGES_READ.keepMax || now - entry.at >= FAN_BADGES_READ.keepMs) cards.delete(name);
    const key = (fan: string): string => `${creator}:${fan}`;
    const known = (): Map<string, boolean | null> => new Map(fanRefs.map((fan) => [fan, cards.get(key(fan))?.value ?? null]));
    if (fanRefs.every((fan) => cards.has(key(fan)))) return known();
    // One read of the creator at a time, in the order asked. Whoever comes next waits for the one before this one too,
    // even when this one gave up waiting.
    const previous = chains.get(creator) ?? Promise.resolve();
    let release!: () => void;
    const turn = new Promise<void>((resolve) => {
      release = resolve;
    });
    chains.set(creator, turn);
    try {
      if ((await race(previous, deadline, signal)) === 'work') await readMissing(account, fanRefs, key, deadline, signal, begun);
    } finally {
      void previous.then(() => {
        release();
        if (chains.get(creator) === turn) chains.delete(creator);
      });
    }
    return known();
  }

  /** The fans not kept now (the turn before may have read them), in one read; `early` is asked again at its moment. */
  async function readMissing(account: string, fanRefs: readonly string[], key: (fan: string) => string, deadline: number, signal: AbortSignal, begun: number): Promise<void> {
    let client: Pick<FanslyClient, 'call'> | null | undefined;
    for (;;) {
      const missing = fanRefs.filter((fan) => !cards.has(key(fan)));
      if (begun !== generation || missing.length === 0) return;
      client ??= await clientNow().catch(() => null);
      try {
        if (client === null) throw new FanslyApiError('session', { sent: false });
        const answer = await client.call({ purpose: 'badges', route: 'account.byIds', account, query: { ids: missing.join(',') } });
        // Read for someone signed out meanwhile: not kept.
        if (begun !== generation) return;
        const found = readRecentSpenders(answer.response, missing);
        if (found === null) kit.log.service({ level: 'warn', scope: 'fansly.badges', msg: 'accounts malformed', fields: {} });
        else for (const fan of missing) cards.set(key(fan), { at: kit.clock.now(), value: found.get(fan) ?? null });
        return;
      } catch (error) {
        // Too early for the creator's `/account*` spacing: nothing left; asked again at the pacer's moment, while in time.
        if (error instanceof FanslyApiError && error.kind === 'early' && error.retryAt !== undefined) {
          const at = error.retryAt + Math.floor(random() * (FAN_BADGES_READ.jitterMs + 1));
          if (at <= deadline && (await race(null, at, signal)) === 'time') continue;
        }
        if (signal.aborted) return;
        const wire = error instanceof FanslyApiError ? error.toWire() : { code: 'CG-FAN-REQUEST' as const };
        kit.log.service({ level: 'warn', scope: 'fansly.badges', msg: 'accounts not read', fields: { code: wire.code } });
        return;
      }
    }
  }

  /** The remembered sends past six hours, and the oldest beyond the bound. */
  function prune(now: number): void {
    for (const [name, entry] of sent) {
      if (sent.size <= FAN_BADGES_REPORT.keepMax && now - entry.at < FAN_BADGES_REPORT.againMs) break;
      sent.delete(name);
    }
  }

  /** What is known of the asked fans and did not go lately, to the hub; never awaited by the tab's answer. */
  async function report(pageLabel: string, creator: string, fanRefs: readonly string[], found: ReadonlyMap<string, boolean | null>, tiers: FbuddyAnswer): Promise<void> {
    const now = kit.clock.now();
    prune(now);
    const fans: FanBadgesReportFan[] = [];
    const marked: Array<{ readonly name: string; readonly before: Sent | undefined; readonly entry: Sent }> = [];
    for (const fanRef of fanRefs) {
      if (fans.length >= FAN_BADGES_REPORT_MAX) break;
      const value = found.get(fanRef);
      const card = typeof value === 'boolean' ? value : undefined;
      const tier = tiers.state === 'on' && tiers.tiers.has(fanRef) ? (tiers.tiers.get(fanRef) ?? null) : undefined;
      if (card === undefined && tier === undefined) continue;
      const name = `${creator}:${fanRef}`;
      const before = sent.get(name);
      if (before !== undefined && now - before.at < FAN_BADGES_REPORT.againMs && before.tier === tier && before.card === card) continue;
      // Remembered before the call: a request meanwhile does not send the fan again.
      const entry: Sent = { at: now, tier, card };
      sent.delete(name);
      sent.set(name, entry);
      marked.push({ name, before, entry });
      fans.push({ fanRef, ...(tier === undefined ? {} : { fbuddyTier: tier }), ...(card === undefined ? {} : { recentSpender: card }) });
    }
    if (fans.length === 0) return;
    prune(now);
    const begun = generation;
    try {
      await kit.hub.facade.fanBadges({ pageLabel, fans });
    } catch (error) {
      kit.log.service({ level: 'warn', scope: 'fansly.badges', msg: 'badges not reported', fields: { code: kit.hub.errorWire(error).code } });
      // Not sent as far as we know: the fans go again with a later read.
      if (begun !== generation) return;
      for (const { name, before, entry } of marked) {
        if (sent.get(name) !== entry) continue;
        sent.delete(name);
        if (before !== undefined) sent.set(name, before);
      }
    }
  }

  return {
    async badges(request, sender) {
      if (sender.kind !== 'tab') return fail({ code: 'CG-CONTEXT-CHANGED' });
      const grant = await kit.hub.page(request.pageId, sender);
      if (!grant.ok) return fail({ code: grant.code });
      // The creator's page (by either of the tab's ids for the creator, as the preview's read finds it).
      const bootstrap = kit.hub.bootstrap();
      const page = bootstrap?.pages.find((entry) => entry.pageId === request.pageId);
      const ids = [request.hostAccountId, ...(kit.networkSession?.aliases(request.hostAccountId) ?? [])];
      if (bootstrap === null || page === undefined || page.platform !== 'fansly' || page.platformAccountId === null || !ids.includes(page.platformAccountId)) return fail({ code: 'CG-BINDING-NOT-GRANTED' });
      const creator = page.platformAccountId;
      // The hub is told only when it serves the badges, for this page of the same bootstrap.
      const reportTo = hasCapability(bootstrap.capabilities, 'fan-badges-v1') ? page.pageLabel : null;
      const begun = generation;
      const fanRefs = [...new Set(request.fanRefs)].filter((fan) => fan !== creator);
      const none: FbuddyAnswer = { state: 'failed', tiers: new Map<string, FbuddyTier | null>() };
      const [found, tiers] = await Promise.all([readCards(creator, request.hostAccountId, fanRefs), fbuddy === null ? Promise.resolve(none) : fbuddy.read(creator, fanRefs).catch(() => none)]);
      if (reportTo !== null && begun === generation) void report(reportTo, creator, fanRefs, found, tiers).catch(() => undefined);
      return { ok: true, fans: fanRefs.map((fanRef) => ({ fanRef, recentSpender: found.get(fanRef) ?? null, tier: tiers.tiers.get(fanRef) ?? null })), fbuddy: tiers.state };
    },
    clear() {
      cards.clear();
      sent.clear();
      generation += 1;
      // The waits end now; a read in flight is not kept. The next person's requests do not queue behind them.
      stop.abort();
      stop = new AbortController();
      chains.clear();
      fbuddy?.clear();
    },
  };
}
