// Hi in the open chat whose start the tab did not see (`fansly.hi.start`; core services/hosts/fansly/hi-start.ts): the
// history read to its empty page over FS-NET-1's purpose `hi` — the creator's own session and pacer, by the click.
// Only for a tab granted the creator's page with its drafts on.
import type { CgAnyErrorWire } from '@cg/contracts/errors-fansly';
import type { FanslyTabRequestPayload, FanslyTabResponsePayload } from '@cg/contracts/tab-messages-fansly';
import { pageFlagState } from '@cg/core/domain/ops';
import { readHiStart } from '@cg/core/services/hosts/fansly/hi-start';
import { FanslyApiError, type FanslyClient } from '@cg/fansly-api';

import type { BackgroundKit, HostSiteSender } from '../../src/composition/background/host-module';

type Answer = FanslyTabResponsePayload<'fansly.hi.start'>;

export async function readHiStartProof(kit: BackgroundKit, client: FanslyClient | null, request: FanslyTabRequestPayload<'fansly.hi.start'>, sender: HostSiteSender): Promise<Answer> {
  const fail = (error: CgAnyErrorWire): Answer => ({ ok: false, error });
  if (sender.kind !== 'tab') return fail({ code: 'CG-CONTEXT-CHANGED' });
  // The creator's page in the bootstrap (by either of its ids), granted to this tab, its drafts on.
  const ids = [request.hostAccountId, ...(kit.networkSession?.aliases(request.hostAccountId) ?? [])];
  const page = kit.hub.bootstrap()?.pages.find((entry) => entry.platform === 'fansly' && entry.platformAccountId !== null && ids.includes(entry.platformAccountId));
  if (page === undefined) return fail({ code: 'CG-BINDING-NOT-GRANTED' });
  const grant = await kit.hub.page(page.pageId, sender);
  if (!grant.ok) return fail({ code: grant.code });
  if (!pageFlagState(page, 'drafts').usable) return fail({ code: 'CG-FEATURE-DISABLED' });
  if (client === null) return fail({ code: 'CG-FAN-SESSION' });
  const ask = async (route: 'message.history' | 'message.automated', query?: Readonly<Record<string, string>>): Promise<unknown> =>
    (await client.call({ purpose: 'hi', route, account: request.hostAccountId, ...(query === undefined ? {} : { query }) })).response;
  try {
    const read = await readHiStart(
      { history: (query: Readonly<Record<string, string>>) => ask('message.history', query), automated: () => ask('message.automated') },
      { creatorId: request.hostAccountId, fanId: request.fanRef, groupId: request.groupId },
      kit.clock.now(),
    );
    return { ok: true, proof: read.kind === 'proof' ? read.proof : null, dialog: read.kind === 'dialog' };
  } catch (error) {
    return fail(error instanceof FanslyApiError ? error.toWire() : { code: 'CG-FAN-REQUEST' });
  }
}
