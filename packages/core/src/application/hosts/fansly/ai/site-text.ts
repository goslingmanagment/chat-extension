import type { FanslyHostPort } from '@cg/contracts/fansly-host';
import type { Bootstrap } from '@cg/contracts/hub';
import { LIVE_TEXT_LIMITS } from '@cg/contracts/limits';
import type { SiteStartOp } from '@cg/contracts/ops';

import { trimFreshTail } from '../../../../domain/features/plan';

/** Latest confirmed text for a site operation, from the same open chat as its target. */
export async function withFanslyOpText<T extends SiteStartOp>(
  host: FanslyHostPort,
  start: T,
  bootstrap: Bootstrap | null,
  admitted: boolean,
  now: () => number = Date.now,
): Promise<T | null> {
  const before = host.current().route;
  const matches = (): boolean => {
    const route = host.current().route;
    return route.epoch === before.epoch && route.conversationRef === start.target.conversationRef
      && route.chat?.hostAccountId === start.target.chat.hostAccountId
      && route.chat.platformFanId === start.target.chat.platformFanId;
  };
  if (!matches()) return null;
  if (!admitted || bootstrap === null || !bootstrap.capabilities.includes('live-text-fansly-tools-v1')) return start;
  const limits = {
    maxItems: Math.min(LIVE_TEXT_LIMITS.maxItems, bootstrap.limits.freshTextMaxItems),
    maxChars: Math.min(LIVE_TEXT_LIMITS.maxChars, bootstrap.limits.freshTextMaxChars),
  };
  if (limits.maxItems < 1 || limits.maxChars < 1) return start;
  let fresh = null;
  try {
    const snapshot = await host.freshness.snapshot(start.target.chat, {
      conversationRef: start.target.conversationRef,
      feature: start.feature,
      window: Math.min(LIVE_TEXT_LIMITS.maxItems, start.window),
      withText: true,
    });
    if (snapshot !== null && snapshot.identity.groupId === start.target.conversationRef
      && snapshot.identity.creatorId === start.target.chat.hostAccountId
      && snapshot.identity.fanId === start.target.fanRef && snapshot.tail !== undefined) {
      fresh = trimFreshTail({ capturedAt: new Date(now()).toISOString(), messages: snapshot.tail }, limits);
    }
  } catch {
    // A failed page read leaves the hub's archive available.
  }
  return matches() ? (fresh === null ? start : { ...start, fresh }) : null;
}
