// The open chat's PPV state for an AI start (`fansly.ppv.read`; core services/hosts/fansly/ppv.ts): the chat's newest
// pages and the fan's orders of its paid attachments over FS-NET-1's purpose `ppv` — the creator's own session and
// pacer, by the click. Only for a tab granted the creator's page with its fresh text on (the hub takes the state under
// the same flag). The same newest page names the photos of the fan's latest turn when the tab asks for them (`photos`);
// `ppv: false` reads only that page. The cache of order-history answers lives as long as the event page.
//
// A photo's address on Fansly's CDN is signed for the line that read it (CloudFront `AWS:SourceIp`, a /24), and the
// tab loads it through its container's proxy. Read on the direct route, from the chatter's own line, the address is
// refused there (403). So when the newest page names photos and «Fansly через вкладку» is off, that page is read once
// more through the model's tab (the relay frame, the container's proxy, `via: 'tab'`), within TAB_READ_MS, and its
// addresses are the ones the tab draws. No frame in time — the direct read's addresses stay (a chatter without a proxy
// loads them). One request more, and only on a click whose fan's latest turn carries photos.
import type { CgAnyErrorWire } from '@cg/contracts/errors-fansly';
import type { LiveImageRef } from '@cg/contracts/host';
import { LIVE_IMAGE_LIMITS } from '@cg/contracts/limits';
import type { FanslyTabRequestPayload, FanslyTabResponsePayload } from '@cg/contracts/tab-messages-fansly';
import { pageFlagState } from '@cg/core/domain/ops';
import { latestFanPhotos, readOpenChat, type PpvCache, type PpvChat } from '@cg/core/services/hosts/fansly/ppv';
import { FanslyApiError, type FanslyClient } from '@cg/fansly-api';

import type { BackgroundKit, HostSiteSender } from '../../src/composition/background/host-module';

type Answer = FanslyTabResponsePayload<'fansly.ppv.read'>;

const cache: PpvCache = new Map();

/** How long a click whose fan's latest turn carries photos waits for the newest page read through the model's tab. */
export const TAB_READ_MS = 1500;

/** The photos of the fan's latest turn as the model's tab reads them (addresses signed for its line); null — no read. */
async function photosThroughTab(client: FanslyClient, chat: PpvChat): Promise<LiveImageRef[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TAB_READ_MS);
  try {
    const prepared = await client.prepare({
      purpose: 'ppv',
      route: 'message.history',
      account: chat.creatorId,
      query: { groupId: chat.groupId, limit: String(LIVE_IMAGE_LIMITS.windowMessages) },
      via: 'tab',
      signal: controller.signal,
    });
    if (prepared.transport === 'direct') {
      prepared.cancel();
      return null;
    }
    return latestFanPhotos((await prepared.start()).response, chat);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function readOpenChatPpv(kit: BackgroundKit, client: FanslyClient | null, request: FanslyTabRequestPayload<'fansly.ppv.read'>, sender: HostSiteSender, viaTab: boolean): Promise<Answer> {
  const fail = (error: CgAnyErrorWire): Answer => ({ ok: false, error });
  if (sender.kind !== 'tab') return fail({ code: 'CG-CONTEXT-CHANGED' });
  // The creator's page in the bootstrap (by either of its ids), granted to this tab, its fresh text on.
  const ids = [request.hostAccountId, ...(kit.networkSession?.aliases(request.hostAccountId) ?? [])];
  const page = kit.hub.bootstrap()?.pages.find((entry) => entry.platform === 'fansly' && entry.platformAccountId !== null && ids.includes(entry.platformAccountId));
  if (page === undefined) return fail({ code: 'CG-BINDING-NOT-GRANTED' });
  const grant = await kit.hub.page(page.pageId, sender);
  if (!grant.ok) return fail({ code: grant.code });
  if (!pageFlagState(page, 'freshText').usable) return fail({ code: 'CG-FEATURE-DISABLED' });
  if (client === null) return fail({ code: 'CG-FAN-SESSION' });
  const ask = async (route: 'message.history' | 'media.orderhistory', query: Readonly<Record<string, string>>): Promise<unknown> =>
    (await client.call({ purpose: 'ppv', route, account: request.hostAccountId, query })).response;
  try {
    const chat: PpvChat = { creatorId: request.hostAccountId, fanId: request.fanRef, groupId: request.groupId };
    const read = await readOpenChat(
      { history: (query) => ask('message.history', query), orders: (query) => ask('media.orderhistory', query) },
      chat,
      { now: () => kit.clock.now(), cache, wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
      { ppv: request.ppv !== false, photos: request.photos === true },
    );
    const { items } = read;
    const photos = read.photos.length > 0 && !viaTab ? ((await photosThroughTab(client, chat)) ?? read.photos) : read.photos;
    return { ok: true, capturedAt: new Date(kit.clock.now()).toISOString(), items, ...(photos.length > 0 ? { photos } : {}) };
  } catch (error) {
    return fail(error instanceof FanslyApiError ? error.toWire() : { code: 'CG-FAN-REQUEST' });
  }
}
