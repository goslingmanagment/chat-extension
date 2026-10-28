// The fans' badges (`fansly.fans.badges`, contracts fan-badges.ts; 2026-10-28) for «Онлайн», Spenders, «Рассылка» and
// «Новые»: Fansly's blue card «Recent Spender» from one `GET /account?ids=` (FS-NET-1 `badges`: never queued, nothing
// while the creator cools down) and FBuddy's tier (./fbuddy.ts), read side by side — either may fail alone, the other's
// answer still goes. Each fan's blue card is kept ten minutes per creator; a fan asked within them is answered from it.
// Only for a tab granted the creator's Fansly page; nothing of a fan's name or text is kept.

import type { CgAnyErrorWire } from '@cg/contracts/errors-fansly';
import type { FbuddyTier } from '@cg/contracts/fan-badges';
import type { FanslyTabRequestPayload, FanslyTabResponsePayload } from '@cg/contracts/tab-messages-fansly';
import { readRecentSpenders } from '@cg/core/domain/hosts/fansly/badges';
import { FanslyApiError, type FanslyClient } from '@cg/fansly-api';

import type { BackgroundKit, HostSiteSender } from '../../src/composition/background/host-module';
import type { FbuddyTiers } from './fbuddy';

type Request = FanslyTabRequestPayload<'fansly.fans.badges'>;
type Answer = FanslyTabResponsePayload<'fansly.fans.badges'>;

export const FAN_BADGES_READ = {
  /** A fan's blue card is kept this long: asked of Fansly again no sooner. */
  keepMs: 10 * 60_000,
  /** The kept blue cards at most (every creator together). */
  keepMax: 5_000,
} as const;

export interface FanBadgesService {
  badges(request: Request, sender: HostSiteSender): Promise<Answer>;
  /** Forgets everything (another person signed in). */
  clear(): void;
}

const fail = (error: CgAnyErrorWire): Answer => ({ ok: false, error });

export function createFanBadges(kit: Pick<BackgroundKit, 'hub' | 'clock' | 'networkSession' | 'log'>, clientNow: () => Promise<Pick<FanslyClient, 'call'> | null>, fbuddy: FbuddyTiers | null): FanBadgesService {
  /** Each fan's blue card, by creator and fan, and when it was read. */
  const cards = new Map<string, { readonly at: number; readonly value: boolean | null }>();

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

  return {
    async badges(request, sender) {
      if (sender.kind !== 'tab') return fail({ code: 'CG-CONTEXT-CHANGED' });
      const grant = await kit.hub.page(request.pageId, sender);
      if (!grant.ok) return fail({ code: grant.code });
      // The creator's page (by either of the tab's ids for the creator, as the preview's read finds it).
      const page = kit.hub.bootstrap()?.pages.find((entry) => entry.pageId === request.pageId);
      const ids = [request.hostAccountId, ...(kit.networkSession?.aliases(request.hostAccountId) ?? [])];
      if (page === undefined || page.platform !== 'fansly' || page.platformAccountId === null || !ids.includes(page.platformAccountId)) return fail({ code: 'CG-BINDING-NOT-GRANTED' });
      const creator = page.platformAccountId;
      const fanRefs = [...new Set(request.fanRefs)].filter((fan) => fan !== creator);
      const none = { state: 'failed' as const, tiers: new Map<string, FbuddyTier | null>() };
      const [found, tiers] = await Promise.all([readCards(creator, request.hostAccountId, fanRefs), fbuddy === null ? Promise.resolve(none) : fbuddy.read(creator, fanRefs).catch(() => none)]);
      return { ok: true, fans: fanRefs.map((fanRef) => ({ fanRef, recentSpender: found.get(fanRef) ?? null, tier: tiers.tiers.get(fanRef) ?? null })), fbuddy: tiers.state };
    },
    clear() {
      cards.clear();
      fbuddy?.clear();
    },
  };
}
