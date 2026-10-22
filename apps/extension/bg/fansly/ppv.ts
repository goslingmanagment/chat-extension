// The open chat's PPV state for an AI start (`fansly.ppv.read`; core services/hosts/fansly/ppv.ts): the chat's newest
// pages and the fan's orders of its paid attachments over FS-NET-1's purpose `ppv` — the creator's own session and
// pacer, by the click. Only for a tab granted the creator's page with its fresh text on (the hub takes the state under
// the same flag). The same newest page names the photos of the fan's latest turn when the tab asks for them (`photos`);
// `ppv: false` reads only that page. The cache of order-history answers lives as long as the event page.
import type { CgAnyErrorWire } from '@cg/contracts/errors-fansly';
import type { FanslyTabRequestPayload, FanslyTabResponsePayload } from '@cg/contracts/tab-messages-fansly';
import { pageFlagState } from '@cg/core/domain/ops';
import { readOpenChat, type PpvCache } from '@cg/core/services/hosts/fansly/ppv';
import { FanslyApiError, type FanslyClient } from '@cg/fansly-api';

import type { BackgroundKit, HostSiteSender } from '../../src/composition/background/host-module';

type Answer = FanslyTabResponsePayload<'fansly.ppv.read'>;

const cache: PpvCache = new Map();

export async function readOpenChatPpv(kit: BackgroundKit, client: FanslyClient | null, request: FanslyTabRequestPayload<'fansly.ppv.read'>, sender: HostSiteSender): Promise<Answer> {
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
    const { items, photos } = await readOpenChat(
      { history: (query) => ask('message.history', query), orders: (query) => ask('media.orderhistory', query) },
      { creatorId: request.hostAccountId, fanId: request.fanRef, groupId: request.groupId },
      { now: () => kit.clock.now(), cache, wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
      { ppv: request.ppv !== false, photos: request.photos === true },
    );
    return { ok: true, capturedAt: new Date(kit.clock.now()).toISOString(), items, ...(photos.length > 0 ? { photos } : {}) };
  } catch (error) {
    return fail(error instanceof FanslyApiError ? error.toWire() : { code: 'CG-FAN-REQUEST' });
  }
}
