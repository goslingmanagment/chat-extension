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
// families answer CG-RUNTIME-UNREACHABLE until their PRs (P10*, P11b, P12b*).
// Forgotten checkpoints go with the module's first start and «Очистить
// локальные данные».
//
// R20 P10b1: «Новые» — the pass Б17 and its queue (core services/hosts/fansly/
// newcomers.ts) answer `fansly.followers.{scan,read,pause,resume,prioritize,
// history,close}` over FS-NET-1's purpose `newcomers`, and tell the rows that
// change to the tabs whose window holds the pass (`fansly.followers.changed`).
//
// R20 P14b1: the settings page reaches this registry too (the core routes a
// page's `fansly.*` request here while Fansly is on): Fansly's part of
// `settings.ext` through the core's one owner of the key (`fansly.settings.*`),
// and «Аккаунты» — the captured sessions with their legacy ↔ canonical
// reconciliation, the tabs no account is known for and «к вкладке» without the
// `tabs` right (`fansly.accounts.*`, core services/hosts/fansly/accounts.ts).
//
// R20 P9c: «Fansly через вкладку» (bg/fansly/relay.ts; architecture.md §8.5):
// the API's requests leave through the transport of packages/fansly-api — the
// event page's own `fetch`, or with the person's switch on the relay frame of
// the model's tab, raised for a batch of work and 60 s after; never the direct
// route instead. The frame's own requests (`fansly.relay.*`) and its going
// (`relayGone`) come here through Fansly's registry.
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
import { createFanslyNewcomers, type FanslyNewcomers, type FanslyNewcomersApi } from '@cg/core/services/hosts/fansly/newcomers';
import { createVaultCheckpoints } from '@cg/core/services/hosts/fansly/vault-checkpoints';
import { createFanslyApi, FanslyApiError, type FanslyApi, type FanslyNetworkSession } from '@cg/fansly-api';
import { createSpendersLookup } from '@cg/fansly-api/spenders';

import type { BackgroundHostHandle, BackgroundHostModule, BackgroundKit, HostAnswer, HostSiteRegistry, SettingsExtAnswer } from '../src/composition/background/host-module';
import { fanslyStandClient, standFanslyClient, startFanslyApiProbe } from './fansly/api-probe';
import { readRegistration } from './fansly/registration';
import { createRelayService } from './fansly/relay';

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
export function fanslyRegistry(handle: HostSiteRegistry['handle'], relayGone?: HostSiteRegistry['relayGone']): HostSiteRegistry {
  return {
    prefix: FANSLY_TAB_TYPE_PREFIX,
    isRequestType: isFanslyTabRequestType,
    mayRequest: (type, sender, page, host) => isFanslyTabRequestType(type) && mayRequestFansly(type, sender, page, host),
    parse: parseFanslyTabPayload,
    eventTargets: (type) => (isFanslyTabEventType(type) ? fanslyEventTargets(type) : null),
    handle,
    ...(relayGone === undefined ? {} : { relayGone }),
  };
}

async function startFansly(kit: BackgroundKit): Promise<BackgroundHostHandle> {
  const session = kit.networkSession;
  await session?.ready.catch(() => undefined);
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
  // «Fansly через вкладку», read at each route: off without the site's settings owner (its default); unknown until read
  // (a route asks the settings once more first, and refuses if they still cannot be read).
  const viaTab = (): boolean | null => (kit.settingsExt === undefined ? false : settingsReady ? kit.settingsExt.current().hosts['fansly-web'].viaTab : null);
  const relay = createRelayService(kit, viaTab, { settled: refreshSettings });
  // Fansly's API over the core's session owner; none without it (a kit without P9a's session asks Fansly nothing).
  const api: FanslyApi | null = session === undefined ? null : createFanslyApi({ session, storage: kit.storage.session, transport: relay.hub, now: () => kit.clock.now(), warn: (reason) => kit.log.service({ level: 'warn', scope: 'fansly.pacer', msg: 'request pacing state unavailable; cooling all creators', fields: { reason } }) });
  await api?.pacer.ready;
  const unprobe = __CG_TEST_HOSTS__ && session !== undefined && api !== null ? startFanslyApiProbe(kit, session, api, relay.hub) : () => undefined;
  const spenders = api === null ? null : createSpendersLookup(__CG_TEST_HOSTS__ && session !== undefined ? fanslyStandClient(kit, session, api) : api.client, () => kit.clock.now(), kit.storage.local);
  const offSettings = kit.settingsExt?.onChange(() => { void refreshSettings(); });
  await refreshSettings();
  // An album's upload is held by the tab session that wrote its row last, while that session is registered (one tab at a time).
  const vault = createVaultCheckpoints({ local: kit.storage.local, now: () => kit.clock.now(), log: kit.log.service, alive: (session) => kit.router.tabs().includes(session) });
  const accounts = kit.networkSession === undefined || kit.siteTabs === undefined ? null : createFanslyAccounts({ sessions: kit.networkSession, tabs: kit.siteTabs });
  const operations = createFanslyOperations((view) => kit.site?.emit('fansly.ops.done', { view }));
  const newcomers = kit.site === undefined ? null : startNewcomers(kit, session, api);
  const handle: HostSiteRegistry['handle'] = async (type, payload, sender) => {
    // The registry's rules let a page send only the settings page's types (contracts tab-messages-fansly.ts).
    if (sender.kind === 'page') return pageRequest(kit, accounts, type, payload);
    const tab = sender.tabSessionId;
    const relayed = relay.handle(type, payload, sender);
    if (relayed !== null) return relayed;
    if (type === 'fansly.spenders.names' || type === 'fansly.spenders.resolve') {
      if (spenders === null) return ok({ ok: false, error: { code: 'CG-FAN-SESSION' } });
      const account = (payload as { hostAccountId: string }).hostAccountId;
      const template = session?.forTab(sender.tabId);
      if (template === null || template === undefined || (template.canonicalId ?? template.legacyId) !== account) return ok({ ok: false, error: { code: 'CG-FAN-SESSION' } });
      try {
        if (type === 'fansly.spenders.names') {
          const request = payload as FanslyTabRequestPayload<'fansly.spenders.names'>;
          return ok({ ok: true, names: await spenders.names(request.hostAccountId, request.fanRefs) });
        }
        const request = payload as FanslyTabRequestPayload<'fansly.spenders.resolve'>;
        return ok({ ok: true, groupId: await spenders.resolve(request.hostAccountId, request) });
      } catch (error) {
        return ok({ ok: false, error: error instanceof FanslyApiError ? error.toWire() : { code: 'CG-FAN-REQUEST' } });
      }
    }
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
      case 'fansly.registration.read': {
        const client = __CG_TEST_HOSTS__ ? session === undefined || api === null ? null : await standFanslyClient(kit, session, api) : api?.client ?? null;
        return ok(await readRegistration(kit, client, payload as FanslyTabRequestPayload<'fansly.registration.read'>, sender));
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
        // «Новые» (R20 P10b1): the pass and its queue; `send` and `exclude` come with P10c and P10b2.
        if (newcomers?.handles(type) === true) return ok(await newcomers.answer(type, payload, tab));
        return { ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE', detail: `${type}: not served yet` } };
    }
  };
  const unplug = kit.site?.plug(fanslyRegistry(handle, (sender) => relay.gone(sender))) ?? (() => undefined);
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
      if (event.kind === 'clear-finished') { await spenders?.clear(); await vault.sweep(); }
      if (event.kind === 'session' && event.ownerChanged) await spenders?.clear();
    },
    facts: () => ({}),
    dispose: async () => {
      disposed = true;
      if (retry !== null) kit.clock.clearTimer(retry);
      offSettings?.();
      unplug();
      unprobe();
      newcomers?.dispose();
      await spenders?.flush();
      await api?.pacer.flush();
    },
  };
}

/**
 * «Новые» (R20 P10b1; core services/hosts/fansly/newcomers.ts): the pass over FS-NET-1's purpose `newcomers` — the
 * creator's own session and pacer, never another's — and its changes to the tabs whose window holds it. A test build
 * asks the stand's API the e2e names (`dev.fanslyApi.origin`, api-probe.ts) and nothing without it; a release build,
 * Fansly's.
 */
function startNewcomers(kit: BackgroundKit, session: FanslyNetworkSession | undefined, api: FanslyApi | null): FanslyNewcomers {
  const client = api === null || session === undefined ? null : __CG_TEST_HOSTS__ ? fanslyStandClient(kit, session, api) : api.client;
  const port: FanslyNewcomersApi = {
    async call(call, signal) {
      const asking = client;
      // No session owner: nothing can be asked; a test build without the stand's API asks nothing either.
      if (asking === null) throw new FanslyApiError(api === null || session === undefined ? 'session' : 'not-admitted', { sent: false });
      const abort = new AbortController();
      if (signal.aborted) abort.abort();
      else signal.addEventListener('abort', () => abort.abort());
      const answer = await asking.call({
        purpose: 'newcomers',
        route: call.route,
        account: call.account,
        ...(call.path === undefined ? {} : { path: call.path }),
        ...(call.query === undefined ? {} : { query: call.query }),
        ...(call.body === undefined ? {} : { body: call.body }),
        signal: abort.signal,
      });
      return answer.response;
    },
    coolingUntil(account) {
      const template = session?.forAccount(account) ?? null;
      return template === null || api === null ? 0 : api.pacer.coolingUntil({ legacyId: template.legacyId, canonicalId: template.canonicalId });
    },
  };
  return createFanslyNewcomers({
    api: port,
    now: () => kit.clock.now(),
    uuid: () => kit.ids.uuid(),
    sleep: (ms, signal) =>
      new Promise<void>((resolve) => {
        if (signal.aborted) return resolve();
        const timer = kit.clock.setTimer(Math.max(0, ms), resolve);
        signal.addEventListener('abort', () => {
          kit.clock.clearTimer(timer);
          resolve();
        });
      }),
    emit: (tab, change) => kit.site?.emit('fansly.followers.changed', change, { tabSessionId: tab }),
    alive: (tab) => kit.router.tabs().includes(tab),
    tabOn(tab, creator) {
      const registration = kit.siteTabs?.registered().find((entry) => entry.tabSessionId === tab);
      // A tab that has not said its account yet is not refused; one on another account is (its aliases count).
      if (registration === undefined || registration.accounts.length === 0 || registration.accounts.includes(creator)) return true;
      const aliases = kit.networkSession?.aliases(creator) ?? [];
      return registration.accounts.some((account) => aliases.includes(account));
    },
    log: kit.log.service,
  });
}

/** One module per realm (an event page's start, or a new address in one): its start is idempotent. */
export function fanslyModule(): BackgroundHostModule {
  let started: Promise<BackgroundHostHandle> | null = null;
  return { host: 'fansly-web', start: (kit) => (started ??= startFansly(kit)) };
}

export default fanslyModule();
