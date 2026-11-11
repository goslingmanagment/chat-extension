// The fans' badges (`fansly.fans.badges`, contracts fan-badges.ts; 2026-10-28) for «Онлайн», Spenders, «Рассылка» and
// «Новые»: Fansly's blue card «Recent Spender» from one `GET /account?ids=` (FS-NET-1 `badges`: never queued, nothing
// while the creator cools down) and FBuddy's tier (./fbuddy.ts), read side by side — either may fail alone, the other's
// answer still goes. Each fan's blue card is kept ten minutes per creator; a fan asked within them is answered from it.
// Only for a tab granted the creator's Fansly page; nothing of a fan's name or text is kept.
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
  keepMs: 10 * 60_000,
  /** The kept blue cards at most (every creator together). */
  keepMax: 5_000,
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

export function createFanBadges(kit: Pick<BackgroundKit, 'hub' | 'clock' | 'networkSession' | 'log'>, clientNow: () => Promise<Pick<FanslyClient, 'call'> | null>, fbuddy: FbuddyTiers | null): FanBadgesService {
  /** Each fan's blue card, by creator and fan, and when it was read. */
  const cards = new Map<string, { readonly at: number; readonly value: boolean | null }>();
  /** What went to the hub, by creator and fan, the oldest first. */
  const sent = new Map<string, Sent>();
  /** One more with each `clear()`: a report of a request begun before it goes nowhere. */
  let generation = 0;

  /** The fans' blue cards: the ones kept, the rest from one `GET /account?ids=`; a failed read leaves them unknown. */
  async function readCards(creator: string, account: string, fanRefs: readonly string[]): Promise<Map<string, boolean | null>> {
    const now = kit.clock.now();
    for (const [name, entry] of cards) if (cards.size > FAN_BADGES_READ.keepMax || now - entry.at >= FAN_BADGES_READ.keepMs) cards.delete(name);
    const key = (fan: string): string => `${creator}:${fan}`;
    const missing = fanRefs.filter((fan) => !cards.has(key(fan)));
    if (missing.length > 0) {
      const client = await clientNow().catch(() => null);
      try {
        if (client === null) throw new FanslyApiError('session', { sent: false });
        const answer = await client.call({ purpose: 'badges', route: 'account.byIds', account, query: { ids: missing.join(',') } });
        const found = readRecentSpenders(answer.response, missing);
        if (found === null) kit.log.service({ level: 'warn', scope: 'fansly.badges', msg: 'accounts malformed', fields: {} });
        else for (const fan of missing) cards.set(key(fan), { at: kit.clock.now(), value: found.get(fan) ?? null });
      } catch (error) {
        const wire = error instanceof FanslyApiError ? error.toWire() : { code: 'CG-FAN-REQUEST' as const };
        kit.log.service({ level: 'warn', scope: 'fansly.badges', msg: 'accounts not read', fields: { code: wire.code } });
      }
    }
    return new Map(fanRefs.map((fan) => [fan, cards.get(key(fan))?.value ?? null]));
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
      fbuddy?.clear();
    },
  };
}
