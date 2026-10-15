// First Fansly background module (P9a). The core captures and persists passive
// observations even when this chunk has never loaded. P9b adds its API/pacer
// here, over the same session owner; a handshake restores this module after
// the first optional grant, whose late webRequest listener cannot wake Firefox.
//
// R20 P13b: the module plugs Fansly's own tab registry (`fansly.*`,
// contracts tab-messages-fansly.ts; architecture.md §1.6, §3.3, §12) into the
// core's RPC through the kit — its schemas are this chunk's, never the core's —
// and answers the vault's checkpoints (`fansly.vault.{resume,checkpoint,clear}`,
// core services/hosts/fansly/vault-checkpoints.ts) over storage.local: a
// checkpoint outlives a reload of the tab and the event page's sleep; one tab
// at a time holds an album's upload (its tab session, while registered). The other
// families answer CG-RUNTIME-UNREACHABLE until their PRs (P9c, P10*, P11b, P12b*).
// Forgotten checkpoints go with the module's first start and «Очистить
// локальные данные».
import {
  FANSLY_TAB_TYPE_PREFIX,
  fanslyEventTargets,
  isFanslyTabEventType,
  isFanslyTabRequestType,
  mayRequestFansly,
  parseFanslyTabPayload,
  type FanslyTabRequestPayload,
} from '@cg/contracts/tab-messages-fansly';
import { createVaultCheckpoints } from '@cg/core/services/hosts/fansly/vault-checkpoints';

import type { BackgroundHostHandle, BackgroundHostModule, BackgroundKit, HostAnswer, HostSiteRegistry } from '../src/composition/background/host-module';

const ok = (payload: unknown): HostAnswer => ({ ok: true, payload });

/** Fansly's registry for the core's RPC: its rules and schemas, and what this module answers so far. */
export function fanslyRegistry(handle: HostSiteRegistry['handle']): HostSiteRegistry {
  return {
    prefix: FANSLY_TAB_TYPE_PREFIX,
    isRequestType: isFanslyTabRequestType,
    mayRequest: (type, sender, page, host) => isFanslyTabRequestType(type) && mayRequestFansly(type, sender, page, host),
    parse: parseFanslyTabPayload,
    eventTargets: (type) => (isFanslyTabEventType(type) ? fanslyEventTargets(type) : null),
    handle,
  };
}

async function startFansly(kit: BackgroundKit): Promise<BackgroundHostHandle> {
  await kit.networkSession?.ready;
  // An album's upload is held by the tab session that wrote its row last, while that session is registered (one tab at a time).
  const vault = createVaultCheckpoints({ local: kit.storage.local, now: () => kit.clock.now(), log: kit.log.service, alive: (session) => kit.router.tabs().includes(session) });
  const handle: HostSiteRegistry['handle'] = async (type, payload, sender) => {
    const tab = sender.tabSessionId;
    switch (type) {
      case 'fansly.vault.resume':
        return ok(await vault.resume(payload as FanslyTabRequestPayload<'fansly.vault.resume'>, tab));
      case 'fansly.vault.checkpoint':
        return ok(await vault.checkpoint((payload as FanslyTabRequestPayload<'fansly.vault.checkpoint'>).checkpoint, tab));
      case 'fansly.vault.clear':
        return ok(await vault.clear(payload as FanslyTabRequestPayload<'fansly.vault.clear'>, tab));
      default:
        return { ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE', detail: `${type}: not served yet` } };
    }
  };
  const unplug = kit.site?.plug(fanslyRegistry(handle)) ?? (() => undefined);
  // Runs once a background: whatever was left for more than 14 days goes.
  void vault.sweep().catch(() => 0);
  return {
    onTabMessage: () => Promise.resolve({ ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE' } }),
    async onEvent(event) {
      if (event.kind === 'clear-finished') await vault.sweep();
    },
    facts: () => ({}),
    dispose: () => {
      unplug();
      return Promise.resolve();
    },
  };
}

/** One module per realm (an event page's start, or a new address in one): its start is idempotent. */
export function fanslyModule(): BackgroundHostModule {
  let started: Promise<BackgroundHostHandle> | null = null;
  return { host: 'fansly-web', start: (kit) => (started ??= startFansly(kit)) };
}

export default fanslyModule();
