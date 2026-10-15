// First Fansly background module (P9a). The core captures and persists passive
// observations even when this chunk has never loaded; a handshake restores this
// module after the first optional grant, whose late webRequest listener cannot
// wake Firefox.
//
// R20 P9b: Fansly's API (packages/fansly-api; architecture.md §8.3, §8.4) —
// the client of FS-NET-1 and the pacer, one of each per realm, over the core's
// session owner (`kit.networkSession`: the templates and the 429 facts it
// recorded, those of the page and of a neighbour too) and storage.session (the
// pacer's state survives the event page). The pacer's stored state is read as
// the module starts; a call waits for it. The services that ask Fansly (P9c–P9e,
// P10*, P11*) take `api` from here. A test build adds the e2e's probe
// (bg/fansly/api-probe.ts), which a release chunk does not carry.
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
//
// R20 P14b1: the settings page reaches this registry too (the core routes a
// page's `fansly.*` request here while Fansly is on): Fansly's part of
// `settings.ext` through the core's one owner of the key (`fansly.settings.*`),
// and «Аккаунты» — the captured sessions with their legacy ↔ canonical
// reconciliation, the tabs no account is known for and «к вкладке» without the
// `tabs` right (`fansly.accounts.*`, core services/hosts/fansly/accounts.ts).
//
// R20 P7i: the module brings Fansly's slice of the feature manifest
// (docs/project-unite/architecture.md §1.4). The core's graph never has a file
// of Fansly's, so it admits a generation of a Fansly chat and an insert token
// of a Fansly tab by the slice of this running module (`features`). Cut here
// the way the site's other roots cut it (apps/extension/src/composition/
// features/fansly.ts): the common part and Fansly's own file, never
// ChatSpace's.
import { FEATURES_COMMON } from '@cg/contracts/features/common';
import { FANSLY_FEATURES } from '@cg/contracts/features/fansly';
import {
  FANSLY_TAB_TYPE_PREFIX,
  fanslyEventTargets,
  isFanslyTabEventType,
  isFanslyTabRequestType,
  mayRequestFansly,
  parseFanslyTabPayload,
  type FanslyTabRequestPayload,
} from '@cg/contracts/tab-messages-fansly';
import { createFanslyOperations } from '@cg/core/services/hosts/fansly/voice-operations';
import { featureSlice } from '@cg/core/domain/features';
import { createFanslyAccounts, type FanslyAccounts } from '@cg/core/services/hosts/fansly/accounts';
import { createVaultCheckpoints } from '@cg/core/services/hosts/fansly/vault-checkpoints';
import { createFanslyApi, type FanslyApi } from '@cg/fansly-api';

import type { BackgroundHostHandle, BackgroundHostModule, BackgroundKit, HostAnswer, HostSiteRegistry, SettingsExtAnswer } from '../src/composition/background/host-module';
import { startFanslyApiProbe } from './fansly/api-probe';

const ok = (payload: unknown): HostAnswer => ({ ok: true, payload });
const unreachable = (detail: string): HostAnswer => ({ ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE', detail } });
/** A read or a write of `settings.ext`: its state, or the owner's code (CG-STORAGE-READ, -WRITE, -VERSION). */
const settingsAnswer = (answer: SettingsExtAnswer): HostAnswer => (answer.ok ? ok(answer.state) : { ok: false, error: answer.error });

/** What the settings page asks of Fansly's module (R20 P14b1): its part of `settings.ext` and its accounts. */
async function pageRequest(kit: BackgroundKit, accounts: FanslyAccounts | null, type: string, payload: unknown): Promise<HostAnswer> {
  switch (type) {
    case 'fansly.settings.read':
      return kit.settingsExt === undefined ? unreachable('no settings.ext port') : settingsAnswer(await kit.settingsExt.state());
    case 'fansly.settings.write':
      return kit.settingsExt === undefined ? unreachable('no settings.ext port') : settingsAnswer(await kit.settingsExt.patch((payload as FanslyTabRequestPayload<'fansly.settings.write'>).patch));
    case 'fansly.accounts.read':
      return accounts === null ? unreachable('no session or tabs port') : ok(await accounts.read());
    case 'fansly.accounts.focus':
      return accounts === null ? unreachable('no session or tabs port') : ok({ focused: await accounts.focus((payload as FanslyTabRequestPayload<'fansly.accounts.focus'>).hostAccountId) });
    default:
      return unreachable(`${type}: not a page's`);
  }
}

/** Fansly's slice of the feature manifest, as its tab and the extension pages hold it. */
const FANSLY_SLICE = featureSlice(FEATURES_COMMON, FANSLY_FEATURES);

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
  const session = kit.networkSession;
  await session?.ready.catch(() => undefined);
  // Fansly's API over the core's session owner; none without it (a kit without P9a's session asks Fansly nothing).
  const api: FanslyApi | null = session === undefined ? null : createFanslyApi({ session, storage: kit.storage.session, now: () => kit.clock.now(), warn: (reason) => kit.log.service({ level: 'warn', scope: 'fansly.pacer', msg: 'request pacing state unavailable; cooling all creators', fields: { reason } }) });
  await api?.pacer.ready;
  const unprobe = __CG_TEST_HOSTS__ && session !== undefined && api !== null ? startFanslyApiProbe(kit, session, api) : () => undefined;
  let settingsReady = false;
  let disposed = false;
  let retry: ReturnType<BackgroundKit['clock']['setTimer']> | null = null;
  let reading: Promise<void> | null = null;
  const refreshSettings = (): Promise<void> => (reading ??= (async () => {
    try { settingsReady = (await kit.settingsExt?.state())?.ok === true; }
    catch { settingsReady = false; }
    if (!disposed && !settingsReady && kit.settingsExt !== undefined && retry === null) {
      retry = kit.clock.setTimer(1000, () => { retry = null; void refreshSettings(); });
    }
  })().finally(() => { reading = null; }));
  const offSettings = kit.settingsExt?.onChange(() => { void refreshSettings(); });
  await refreshSettings();
  // An album's upload is held by the tab session that wrote its row last, while that session is registered (one tab at a time).
  const vault = createVaultCheckpoints({ local: kit.storage.local, now: () => kit.clock.now(), log: kit.log.service, alive: (session) => kit.router.tabs().includes(session) });
  const accounts = kit.networkSession === undefined || kit.siteTabs === undefined ? null : createFanslyAccounts({ sessions: kit.networkSession, tabs: kit.siteTabs });
  const operations = createFanslyOperations((view) => kit.site?.emit('fansly.ops.done', { view }));
  const handle: HostSiteRegistry['handle'] = async (type, payload, sender) => {
    // The registry's rules let a page send only the settings page's types (contracts tab-messages-fansly.ts).
    if (sender.kind === 'page') return pageRequest(kit, accounts, type, payload);
    const tab = sender.tabSessionId;
    switch (type) {
      case 'fansly.ops.start': {
        const start = payload as FanslyTabRequestPayload<'fansly.ops.start'>;
        const page = await kit.hub.page(start.target.binding.pageId, { kind: 'tab', tabSessionId: tab });
        if (!page.ok) return { ok: false, error: { code: page.code } };
        const outcome = await kit.ops.start(tab, start);
        return outcome.kind === 'admission' ? ok(outcome.admission) : { ok: false, error: { code: outcome.code } };
      }
      case 'fansly.ops.read':
        return ok({ view: kit.ops.siteView((payload as FanslyTabRequestPayload<'fansly.ops.read'>).opId, 'fansly-web') });
      case 'fansly.ops.list':
        return ok(kit.ops.siteList(tab, 'fansly-web', (payload as FanslyTabRequestPayload<'fansly.ops.list'>).chatKey));
      case 'fansly.ops.cancel': {
        const { opId } = payload as FanslyTabRequestPayload<'fansly.ops.cancel'>;
        return ok({ state: kit.ops.siteView(opId, 'fansly-web') === null ? null : kit.ops.cancel(opId) });
      }
      case 'fansly.sound.batch':
        await kit.sound?.batch(tab, payload as FanslyTabRequestPayload<'fansly.sound.batch'>);
        return ok({ recorded: kit.sound !== undefined });
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
    features: FANSLY_SLICE,
    operations,
    sound: (accountId) => {
      if (!settingsReady || kit.settingsExt === undefined) return null;
      const tones = kit.settingsExt.current().hosts['fansly-web'].sound;
      // Presence can switch before the passive session. Only the session owner's
      // proven canonical mapping may supply an alias; a tab alone proves nothing.
      const aliases = kit.networkSession?.aliases(accountId) ?? [];
      return { tones: { message: tones.messagesTone, subscriber: tones.subscribersTone }, aliases };
    },
    onTabMessage: () => Promise.resolve({ ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE' } }),
    async onEvent(event) {
      if (event.kind === 'clear-finished') await vault.sweep();
    },
    facts: () => ({}),
    dispose: async () => {
      disposed = true;
      if (retry !== null) kit.clock.clearTimer(retry);
      offSettings?.();
      unplug();
      unprobe();
      await api?.pacer.flush();
    },
  };
}

/** One module per realm (an event page's start, or a new address in one): its start is idempotent. */
export function fanslyModule(): BackgroundHostModule {
  let started: Promise<BackgroundHostHandle> | null = null;
  return { host: 'fansly-web', start: (kit) => (started ??= startFansly(kit)) };
}

export default fanslyModule();
