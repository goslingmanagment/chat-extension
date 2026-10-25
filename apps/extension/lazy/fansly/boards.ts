// R20 P9e: the common board with Fansly's missing-data source — and, as on
// ChatSpace, its statistics and the hub's «Ждут ответа» queue, whose fans'
// groups the same source finds — and «Рассылка» with Fansly's own send. This
// module is Fansly's own lazy entry; none of its registry or host code reaches
// ChatSpace.
export { Surfaces, createChatNavigator, createPageContext } from '@cg/core/application/boards';
export { createFanPanelController } from '@cg/core/application/fanpanel';
export { createPaletteDirectory } from '@cg/core/application/preview';

import { createSpendersController as create, type SpendersControllerDeps } from '@cg/core/application/spenders';
import { createOutreachController as createOutreach, type OutreachControllerDeps } from '@cg/core/application/outreach';
import type { HostPort } from '@cg/contracts/host';
import type { FanslyPort } from '@cg/host-fansly/isolated';
import { fanslyRequest } from '../../src/composition/tab/hosts/fansly/requests';
import { asBundles, readCopiedMedia } from '@cg/host-fansly/isolated/copied-media';
import type * as SharedBoards from '../entries/boards';
import { createFanslyNewcomersController } from '../../src/composition/tab/hosts/fansly/newcomers';

// R20 P10a (§8.17): «Новые» reads the background's pass; the shared entry keeps its hub source.
export const createNewcomersController: typeof SharedBoards.createNewcomersController = (deps) => createFanslyNewcomersController(deps);

/** Above the background's own wait for Fansly (30 s) and for its module; a send that outlives it is told «unknown», never resent. */
const OUTREACH_TIMEOUT_MS = 45_000;
/** Above the background's own wait for Fansly's answer to the bundle check. */
const COPIED_TIMEOUT_MS = 35_000;

export function createSpendersController(deps: SpendersControllerDeps & { readonly host: HostPort }) {
  const host = deps.host as FanslyPort;
  return create({ ...deps, source: {
    cached: (account, fan) => host.groupForFan(account, fan),
    async resolve(account, fan) {
      if (host.current().contract.capabilities.navigate.state !== 'on') throw new Error('navigation unavailable');
      const answer = await fanslyRequest(deps.rpc, 'fansly.spenders.resolve', { hostAccountId: account, ...fan }, 17_000);
      if (!answer.ok || !answer.payload.ok) throw new Error('conversation resolution failed');
      return answer.payload.groupId;
    },
    async names(account, fans) {
      const names: { fanRef: string; name: string; username: string | null; displayName: string | null }[] = [];
      for (let i = 0; i < fans.length; i += 100) {
        const answer = await fanslyRequest(deps.rpc, 'fansly.spenders.names', { hostAccountId: account, fanRefs: fans.slice(i, i + 100) });
        if (!answer.ok || !answer.payload.ok) throw new Error('name lookup failed');
        names.push(...answer.payload.names);
      }
      return names;
    },
  } });
}

/**
 * «Рассылка» on Fansly: the same window as on ChatSpace; each version goes by the background's send through Fansly's
 * API, with the items copied in the model's posts — the page's own «Copied …» list (its localStorage, read in this
 * content script). Fansly's own reload files copied bundles as «Copied Media» (copied-media.ts): the background asks
 * Fansly which of those ids are bundles, and they go as bundles. No answer — the list as stored, and the sheet says so.
 */
export function createOutreachController(deps: OutreachControllerDeps & { readonly host: HostPort }) {
  return createOutreach({ ...deps, own: {
    async copied(account) {
      const stored = readCopiedMedia(window);
      const media = stored.filter((item) => item.contentType === 1).map((item) => item.contentId);
      if (media.length === 0) return { items: stored, checked: true };
      if (account === null) return { items: stored, checked: false };
      const answer = await fanslyRequest(deps.rpc, 'fansly.spenders.copied', { hostAccountId: account, ids: media }, COPIED_TIMEOUT_MS);
      if (!answer.ok || !answer.payload.ok) return { items: stored, checked: false };
      return { items: asBundles(stored, answer.payload.bundleIds), checked: true };
    },
    async send(request) {
      const answer = await fanslyRequest(deps.rpc, 'fansly.spenders.outreach', { ...request, attachments: [...request.attachments] }, OUTREACH_TIMEOUT_MS);
      // The port or the answer failed: the request may have reached the background and left — never «not sent».
      if (!answer.ok) return { ok: false, code: 'CG-SEND-UNCERTAIN' };
      return answer.payload.ok ? { ok: true, messageId: answer.payload.messageId } : { ok: false, code: answer.payload.error.code };
    },
  } });
}
