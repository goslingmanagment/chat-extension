// R20 P9e: the common board with Fansly's missing-data source. This module is
// Fansly's own lazy entry; none of its registry or host code reaches ChatSpace.
export { Surfaces, createChatNavigator, createPageContext } from '@cg/core/application/boards';
export { createFanPanelController } from '@cg/core/application/fanpanel';
export { createPaletteDirectory } from '@cg/core/application/preview';

import { createSpendersController as create, type SpendersControllerDeps } from '@cg/core/application/spenders';
import type { HostPort } from '@cg/contracts/host';
import type { FanslyPort } from '@cg/host-fansly/isolated';
import { fanslyRequest } from '../../src/composition/tab/hosts/fansly/requests';
import type * as SharedBoards from '../entries/boards';
import { createFanslyNewcomersController } from '../../src/composition/tab/hosts/fansly/newcomers';

// R20 P10a (§8.17): «Новые» reads the background's pass; the shared entry keeps its hub source.
export const createNewcomersController: typeof SharedBoards.createNewcomersController = (deps) => createFanslyNewcomersController(deps);

export function createSpendersController(deps: SpendersControllerDeps & { readonly host: HostPort }) {
  const host = deps.host as FanslyPort;
  return create({ ...deps, statistics: false, source: {
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
