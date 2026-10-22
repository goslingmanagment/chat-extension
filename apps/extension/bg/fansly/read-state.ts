// Whether the fan read the group's newest message, for a fan's preview (`fansly.preview.readState`; fansly-api
// read-state.ts): `GET /group/<id>/` over FS-NET-1's purpose `preview` — the creator's own session and pacer, once,
// nothing while the creator cools down. Only for a tab granted the creator's page with the preview on.
import type { CgAnyErrorWire } from '@cg/contracts/errors-fansly';
import type { FanslyTabRequestPayload, FanslyTabResponsePayload } from '@cg/contracts/tab-messages-fansly';
import { pageFlagState } from '@cg/core/domain/ops';
import { FanslyApiError, groupReadState, type FanslyClient } from '@cg/fansly-api';

import type { BackgroundKit, HostSiteSender } from '../../src/composition/background/host-module';

type Answer = FanslyTabResponsePayload<'fansly.preview.readState'>;

export async function readPreviewState(kit: BackgroundKit, client: FanslyClient | null, request: FanslyTabRequestPayload<'fansly.preview.readState'>, sender: HostSiteSender): Promise<Answer> {
  const fail = (error: CgAnyErrorWire): Answer => ({ ok: false, error });
  if (sender.kind !== 'tab') return fail({ code: 'CG-CONTEXT-CHANGED' });
  const grant = await kit.hub.page(request.pageId, sender);
  if (!grant.ok) return fail({ code: grant.code });
  // The creator's page (by either of its ids, as `fansly.ppv.read` finds it).
  const ids = [request.hostAccountId, ...(kit.networkSession?.aliases(request.hostAccountId) ?? [])];
  const page = kit.hub.bootstrap()?.pages.find((entry) => entry.pageId === request.pageId);
  if (page === undefined || page.platform !== 'fansly' || page.platformAccountId === null || !ids.includes(page.platformAccountId)) return fail({ code: 'CG-BINDING-NOT-GRANTED' });
  if (!pageFlagState(page, 'preview').usable) return fail({ code: 'CG-FEATURE-DISABLED' });
  if (client === null) return fail({ code: 'CG-FAN-SESSION' });
  try {
    const answer = await client.call({ purpose: 'preview', route: 'group.detail', account: request.hostAccountId, path: { group: request.groupId } });
    const state = groupReadState(answer.response, request.groupId, request.hostAccountId, request.fanRef);
    return state.group ? { ok: true, last: state.last } : fail({ code: 'CG-FAN-GROUP' });
  } catch (error) {
    return fail(error instanceof FanslyApiError ? error.toWire() : { code: 'CG-FAN-REQUEST' });
  }
}
