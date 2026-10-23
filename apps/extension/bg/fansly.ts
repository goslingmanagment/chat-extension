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
// families answer CG-RUNTIME-UNREACHABLE until their PRs (P10*, P12b*).
// Forgotten checkpoints go with the module's first start and «Очистить
// локальные данные».
//
// R20 P10b1: «Новые» — the pass Б17 and its queue (core services/hosts/fansly/
// newcomers.ts) answer `fansly.followers.{scan,read,pause,resume,prioritize,
// history,close}` over FS-NET-1's purpose `newcomers`, and tell the rows that
// change to the tabs whose window holds the pass (`fansly.followers.changed`).
// P10b2: `fansly.followers.exclude` — the person's exclusions in storage.local.
//
// R20 P11b: «Заметки» (`fansly.notes.*`, bg/fansly/notes.ts) — the fan's native notes over Fansly's own note calls
// through this realm's client and pacer, admitted by the page's switch `notes`; their view lives in `settings.ext`
// and every Fansly tab hears when it changes (`fansly.notes.viewChanged`).
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
// R20 P9d: the greeting's HTTP send with the hub's custody (core
// services/hosts/fansly/send.ts; architecture.md §8.6): its journal is
// restored as the module starts (a restart's ends and the custody reports
// they owe), the tab's socket facts of our own messages prove its receipts
// (the echo), a new bootstrap sends the reports still owed. A test build's
// probe (bg/fansly/send-probe.ts) drives it for the e2e of P9d.
//
// R20 P10c: the card of «Новые» clicks it — `fansly.followers.{proof,draft,
// send,sent}` (core services/hosts/fansly/greeting.ts): the pass's proof for
// «Сгенерировать», the card's draft, the send with its three admissions and
// the history read again before the custody, and the person's own send of
// the card's text (`registerNativeSend`). The tuple «now» of the final check
// is the pass's row and the draft's revision; every history the pass walks
// confirms the receipts it shows.
//
// R20 P14c: Fansly switched off or its rights taken back while tabs still run
// our copies (FS-PERM-5; `kit.siteActive`): nothing new begins — an AI start, a
// pass of «Новые», a greeting, a read of Fansly's — and the send and the vault
// stop by their own rules (core send.ts: refused before the request; core
// vault-checkpoints.ts: no file handed over after the one in flight). What
// finishes started work still goes: the tab's echoes, the vault's
// confirmations, the relay frame's requests in flight, reads of what is kept.
//
// R20 P7i: the module brings Fansly's slice of the feature manifest
// (docs/project-unite/architecture.md §1.4). The core's graph never has a file
// of Fansly's, so it admits a generation of a Fansly chat and an insert token
// of a Fansly tab by the slice of this running module (`features`). Cut here
// the way the site's other roots cut it (apps/extension/src/composition/
// features/fansly.ts): the common part and Fansly's own file, never
// ChatSpace's.
import { FEATURES_COMMON } from '@cg/contracts/features/common';
import { FanslyGreetingClaimOpSchema } from '@cg/contracts/send-fansly';
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
import { createFanslyOperations } from '@cg/core/services/hosts/fansly/operations';
import { featureSlice } from '@cg/core/domain/features';
import { createFanslyAccounts, type FanslyAccounts } from '@cg/core/services/hosts/fansly/accounts';
import { createFanslyNewcomers, type FanslyNewcomers, type FanslyNewcomersApi } from '@cg/core/services/hosts/fansly/newcomers';
import { createFanslySend, type FanslySend, type FanslySendDeps, type FanslySendLive } from '@cg/core/services/hosts/fansly/send';
import { createFanslyGreeting, type FanslyGreeting } from '@cg/core/services/hosts/fansly/greeting';
import { freshForSend, verdictMark } from '@cg/core/domain/hosts/fansly/verdict';
import { createVaultCheckpoints } from '@cg/core/services/hosts/fansly/vault-checkpoints';
import { createFanslyApi, createFanslyClient, traceFanslyTransport, FanslyApiError, type FanslyApi, type FanslyNetworkSession } from '@cg/fansly-api';
import { createSpendersLookup } from '@cg/fansly-api/spenders';

import type { BackgroundHostHandle, BackgroundHostModule, BackgroundKit, HostAnswer, HostSiteRegistry, SettingsExtAnswer } from '../src/composition/background/host-module';
import { fanslyStandClient, standFanslyClient, startFanslyApiProbe } from './fansly/api-probe';
import { createNotesService } from './fansly/notes';
import { createOutreachService } from './fansly/outreach';
import { readOpenChatPpv } from './fansly/ppv';
import { readPreviewState } from './fansly/read-state';
import { readRegistration } from './fansly/registration';
import { createRelayService } from './fansly/relay';
import { fanslySendProbe } from './fansly/send-probe';

const ok = (payload: unknown): HostAnswer => ({ ok: true, payload });
const unreachable = (detail: string): HostAnswer => ({ ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE', detail } });
/** A read or a write of `settings.ext`: its state, or the owner's code (CG-STORAGE-READ, -WRITE, -VERSION). */
const settingsAnswer = (answer: SettingsExtAnswer): HostAnswer => (answer.ok ? ok(answer.state) : { ok: false, error: answer.error });

/**
 * What begins new work or asks Fansly, answered `CG-FAN-OFF` in the payload while Fansly is off or its rights are taken
 * back (FS-PERM-5); `fansly.ops.start`, whose answer has no such payload, is refused by the RPC itself.
 */
const BEGINS: ReadonlySet<string> = new Set(['fansly.followers.scan', 'fansly.followers.resume', 'fansly.followers.send', 'fansly.registration.read', 'fansly.spenders.names', 'fansly.spenders.resolve', 'fansly.spenders.outreach', 'fansly.ppv.read', 'fansly.preview.readState']);

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

/** sha256 of a text's UTF-8 bytes, lower-case hex: the manual group's `textFingerprint` (HF-3). */
async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The greeting send over the kit: the custody through the core's facade, the request through Fansly's API. */
function greetingSend(kit: BackgroundKit, api: FanslyApi, live: FanslySendLive, wrap: (deps: FanslySendDeps) => FanslySendDeps): FanslySend {
  // The kit's hub is read at each use.
  return createFanslySend(
    wrap({
      local: kit.storage.local,
      hub: {
        // Checked by Fansly's own strict body (a manual group the registry does not name), never sent otherwise.
        claim: (op) => kit.hub.call('clientFanClaim', () => kit.hub.facade.claim(op, FanslyGreetingClaimOpSchema)),
        claimStatus: (pageLabel, fanRef) => kit.hub.call('clientFanClaimStatus', () => kit.hub.facade.claimStatus(pageLabel, fanRef)),
        resolve: (failure, context) => kit.hub.resolve(failure, context),
        hubOrigin: () => kit.hub.session()?.hubOrigin ?? null,
        pageLabel: (pageId) => kit.hub.bootstrap()?.pages.find((page) => page.pageId === pageId)?.pageLabel ?? null,
        limits: () => kit.hub.bootstrap()?.limits ?? null,
      },
      // FS-NET-1's greeting: one `POST /message`, the body the old extension sends (fansly-client.ts:737).
      prepare: ({ account, groupId, text }) =>
        api.client.prepare({ purpose: 'greeting', route: 'message.send', account, body: { type: 1, content: text, groupId, attachments: [], likes: [], scheduledFor: 0, inReplyTo: null } }),
      // The tuple now is the pass's and the draft's (P10c, the greeting service); without them no attempt passes its checks.
      live,
      sha256,
      instanceId: () => kit.install.instanceId(),
      clock: kit.clock,
      ids: kit.ids,
      log: kit.log.service,
      countUncertain: () => kit.telemetry.countCode('CG-SEND-UNCERTAIN'),
      // FS-PERM-5: switched off or its rights taken back — no new attempt; one not yet requested is refused.
      active: () => kit.siteActive?.() !== false,
    }),
  );
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
  /** Fansly on and its rights granted now (FS-PERM-5); a kit without the switch — on. */
  const active = (): boolean => kit.siteActive?.() !== false;
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
  const sendProbe = __CG_TEST_HOSTS__ && session !== undefined && api !== null ? fanslySendProbe(kit, session, api, relay.hub) : null;
  // The send's «now» is the card's (P10c): the greeting service is made just below, over this very send.
  let greeting: FanslyGreeting | null = null;
  const greetings = api === null ? null : greetingSend(kit, api, (start) => greeting?.live(start) ?? null, (deps) => (sendProbe === null ? deps : sendProbe.wrap(deps)));
  const offSendRequests = session?.onOwnRequest((fact) => { void greetings?.observeRequest(fact); });
  const unprobeSend = sendProbe !== null && greetings !== null ? sendProbe.start(greetings) : () => undefined;
  // R20 P11b: the view of «Заметки» is one for every tab (FS-NOTE-2): a change, from any panel, goes to all of them.
  let notesView = kit.settingsExt?.current().hosts['fansly-web'].notesView ?? null;
  const offSettings = kit.settingsExt?.onChange(() => {
    void refreshSettings();
    const view = kit.settingsExt?.current().hosts['fansly-web'].notesView ?? null;
    if (view !== null && view !== notesView) kit.site?.emit('fansly.notes.viewChanged', { view });
    notesView = view;
  });
  await refreshSettings();
  // The client of a feature's call: the realm's own; a test build's, on the stand's loopback API.
  const clientNow = async () => (__CG_TEST_HOSTS__ ? (session === undefined || api === null ? null : await standFanslyClient(kit, session, api)) : (api?.client ?? null));
  const notes = createNotesService(kit, clientNow);
  const outreach = createOutreachService(kit, clientNow);
  // An album's upload is held by the tab session that wrote its row last, while that session is registered (one tab at a time).
  const vault = createVaultCheckpoints({ local: kit.storage.local, now: () => kit.clock.now(), log: kit.log.service, alive: (session) => kit.router.tabs().includes(session), active });
  const accounts = kit.networkSession === undefined || kit.siteTabs === undefined ? null : createFanslyAccounts({ sessions: kit.networkSession, tabs: kit.siteTabs });
  const operations = createFanslyOperations((view) => kit.site?.emit('fansly.ops.done', { view }));
  const journal = kit.site === undefined ? null : kit.log.passJournal ?? null;
  const newcomers = kit.site === undefined ? null : startNewcomers(kit, session, api, journal, greetings);
  greeting = newcomers === null || greetings === null ? null : startGreeting(kit, newcomers, greetings);
  const handle: HostSiteRegistry['handle'] = async (type, payload, sender) => {
    // The registry's rules let a page send only the settings page's types (contracts tab-messages-fansly.ts).
    if (sender.kind === 'page') return pageRequest(kit, accounts, type, payload);
    const tab = sender.tabSessionId;
    const relayed = relay.handle(type, payload, sender);
    if (relayed !== null) return relayed;
    if (!active()) {
      if (type === 'fansly.ops.start') return unreachable('Fansly is off');
      if (BEGINS.has(type)) return ok({ ok: false, error: { code: 'CG-FAN-OFF' } });
    }
    if (type === 'fansly.spenders.names' || type === 'fansly.spenders.resolve' || type === 'fansly.spenders.outreach') {
      if (spenders === null) return ok({ ok: false, error: { code: 'CG-FAN-SESSION' } });
      const account = (payload as { hostAccountId: string }).hostAccountId;
      const owns = (): boolean => {
        const template = session?.forTab(sender.tabId) ?? null;
        return template !== null && (template.legacyId === account || template.canonicalId === account);
      };
      // The tab's session names another id than its creator until `/account/me` ties them (AU-032).
      if (!owns()) await (await clientNow())?.identify(account);
      if (!owns()) return ok({ ok: false, error: { code: 'CG-FAN-SESSION' } });
      // «Рассылка»: the row's «Отправить», one request of the click (bg/fansly/outreach.ts).
      if (type === 'fansly.spenders.outreach') return ok(await outreach(payload as FanslyTabRequestPayload<'fansly.spenders.outreach'>, tab));
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
      case 'fansly.ppv.read':
        return ok(await readOpenChatPpv(kit, await clientNow(), payload as FanslyTabRequestPayload<'fansly.ppv.read'>, sender, viaTab() === true));
      case 'fansly.preview.readState':
        return ok(await readPreviewState(kit, await clientNow(), payload as FanslyTabRequestPayload<'fansly.preview.readState'>, sender));
      case 'fansly.registration.read':
        return ok(await readRegistration(kit, await clientNow(), payload as FanslyTabRequestPayload<'fansly.registration.read'>, sender));
      case 'fansly.notes.read':
        return ok(await notes.read(payload as FanslyTabRequestPayload<'fansly.notes.read'>, sender));
      case 'fansly.notes.create':
        return ok(await notes.create(payload as FanslyTabRequestPayload<'fansly.notes.create'>, sender));
      case 'fansly.notes.edit':
        return ok(await notes.edit(payload as FanslyTabRequestPayload<'fansly.notes.edit'>, sender));
      case 'fansly.notes.delete':
        return ok(await notes.remove(payload as FanslyTabRequestPayload<'fansly.notes.delete'>, sender));
      case 'fansly.notes.name':
        return ok(await notes.name(payload as FanslyTabRequestPayload<'fansly.notes.name'>, sender));
      case 'fansly.notes.view':
        return kit.settingsExt === undefined ? unreachable('no settings.ext port') : ok({ view: (await kit.settingsExt.state()).state.ext.hosts['fansly-web'].notesView });
      case 'fansly.notes.setView': {
        const { view } = payload as FanslyTabRequestPayload<'fansly.notes.setView'>;
        if (kit.settingsExt === undefined) return unreachable('no settings.ext port');
        const answer = await kit.settingsExt.patch({ hosts: { 'fansly-web': { notesView: view } } });
        return ok({ view: answer.state.ext.hosts['fansly-web'].notesView });
      }
      case 'fansly.sound.batch':
        // Our own messages of the batch may be the echoes of greeting receipts (§8.6).
        greetings?.echo((payload as FanslyTabRequestPayload<'fansly.sound.batch'>).events.flatMap((event) => (event.kind === 'message' ? [event] : [])));
        await kit.sound?.batch(tab, payload as FanslyTabRequestPayload<'fansly.sound.batch'>);
        return ok({ recorded: kit.sound !== undefined });
      case 'fansly.vault.resume':
        return ok(await vault.resume(payload as FanslyTabRequestPayload<'fansly.vault.resume'>, tab));
      case 'fansly.vault.checkpoint':
        return ok(await vault.checkpoint((payload as FanslyTabRequestPayload<'fansly.vault.checkpoint'>).checkpoint, tab));
      case 'fansly.vault.clear':
        return ok(await vault.clear(payload as FanslyTabRequestPayload<'fansly.vault.clear'>, tab));
      // R20 P8c: a deep start's depth above 3000 — the `windows` of the key alone.
      case 'fansly.settings.windows': {
        if (kit.settingsExt === undefined) return unreachable('no settings.ext port');
        const answer = await kit.settingsExt.state();
        return answer.ok ? ok(answer.state.ext.windows) : { ok: false, error: answer.error };
      }
      default:
        // «Новые» (R20 P10b1, P10b2): the pass, its queue and the exclusions; P10c: the card's greeting.
        if (newcomers?.handles(type) === true) return ok(await newcomers.answer(type, payload, tab));
        if (greeting?.handles(type) === true) return ok(await greeting.answer(type, payload, tab));
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
      if (event.kind === 'clear-finished') {
        await spenders?.clear();
        await Promise.all([vault.sweep(), greetings?.clearFinished()]);
      }
      if (event.kind === 'session' && event.ownerChanged) await spenders?.clear();
      // The custody reports still owed go once the bootstrap names their pages again.
      if (event.kind === 'bootstrap' || event.kind === 'session') greetings?.pump();
    },
    facts: () => ({}),
    dispose: async () => {
      disposed = true;
      if (retry !== null) kit.clock.clearTimer(retry);
      offSettings?.();
      offSendRequests?.();
      unplug();
      unprobe();
      greeting?.dispose();
      newcomers?.dispose();
      unprobeSend();
      greetings?.dispose();
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
function startNewcomers(kit: BackgroundKit, session: FanslyNetworkSession | undefined, api: FanslyApi | null, journal: NonNullable<BackgroundKit['log']['passJournal']> | null, send: FanslySend | null): FanslyNewcomers {
  const client = api === null || session === undefined ? null : __CG_TEST_HOSTS__ ? fanslyStandClient(kit, session, api) : api.client;
  const port: FanslyNewcomersApi = {
    async call(call, signal, trace) {
      let asking = client;
      // No session owner: nothing can be asked; a test build without the stand's API asks nothing either.
      if (asking === null) throw new FanslyApiError(api === null || session === undefined ? 'session' : 'not-admitted', { sent: false });
      if (trace !== undefined && api !== null && session !== undefined) {
        // Observe the selected transport while keeping the stand's origin check at each call.
        const transport = traceFanslyTransport(api.client.transport, (event, fields) => trace(event, { ...fields, route: call.route }));
        asking = __CG_TEST_HOSTS__
          ? fanslyStandClient(kit, session, api, transport)
          : createFanslyClient({ session, pacer: api.pacer, now: () => kit.clock.now(), transport });
      }
      const abort = new AbortController();
      if (signal.aborted) abort.abort();
      else signal.addEventListener('abort', () => abort.abort());
      const answer = await asking.call({
        // The check right before a send is the greeting's: refused at once during a cooldown, never waited out.
        purpose: call.click === true ? 'greeting' : 'newcomers',
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
    monotonicNow: () => performance.now(),
    ...(journal === null ? {} : { journal }),
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
    local: kit.storage.local,
    log: kit.log.service,
    // A receipt the echo never confirmed is confirmed by a history that shows its id (§8.6).
    onHistory: (groupId, ids, complete) => send?.history(groupId, ids, complete),
  });
}

/** The tab is registered and on this creator's account (its aliases count); one that has not said its account yet is not refused. */
function tabOnCreator(kit: BackgroundKit, tab: string, creator: string): boolean {
  if (!kit.router.tabs().includes(tab)) return false;
  const registration = kit.siteTabs?.registered().find((entry) => entry.tabSessionId === tab);
  if (registration === undefined || registration.accounts.length === 0 || registration.accounts.includes(creator)) return true;
  const aliases = kit.networkSession?.aliases(creator) ?? [];
  return registration.accounts.some((account) => aliases.includes(account));
}

/**
 * The greeting of a «Новые» card (R20 P10c; core services/hosts/fansly/greeting.ts): over the pass and the send. The
 * creator's page is the bootstrap's Fansly page whose binding is the creator (or an alias of it), granted to the tab;
 * an unchanged AI text is checked against its operation in this background and its own verdict (FS-TAIL-8).
 */
function startGreeting(kit: BackgroundKit, newcomers: FanslyNewcomers, send: FanslySend): FanslyGreeting {
  return createFanslyGreeting({
    newcomers,
    send,
    local: kit.storage.local,
    session: () => kit.hub.session(),
    async page(creator, tab) {
      const bootstrap = kit.hub.bootstrap();
      if (bootstrap === null) return { ok: false, code: 'CG-HUB-UNAVAILABLE' };
      const ids = [creator, ...(kit.networkSession?.aliases(creator) ?? [])];
      const page = bootstrap.pages.find((entry) => entry.platform === 'fansly' && entry.platformAccountId !== null && ids.includes(entry.platformAccountId));
      if (page === undefined) return { ok: false, code: 'CG-BINDING-NOT-GRANTED' };
      const granted = await kit.hub.page(page.pageId, { kind: 'tab', tabSessionId: tab });
      return granted.ok ? { ok: true, page: { pageId: granted.page.pageId, pageLabel: granted.page.pageLabel, flagRevision: bootstrap.configRevision } } : { ok: false, code: granted.code };
    },
    generation(opId) {
      const view = kit.ops.view(opId);
      if (view === null) return null;
      const result = view.result;
      const parts = result?.kind === 'variants' ? result.variants[0] : undefined;
      return {
        generationRef: view.generationRef ?? null,
        fanRef: view.target.fanRef,
        conversationRef: view.target.conversationRef,
        text: parts?.length === 1 ? (parts[0] ?? null) : null,
        // Its own evidence as the current one too: the background has no newer window of the pass to add (§3.5).
        fresh: freshForSend(view, view.freshnessProof?.fingerprint ?? null),
        mark: verdictMark(view, view.freshnessProof?.fingerprint ?? null)?.reason ?? null,
      };
    },
    tabOn: (tab, creator) => tabOnCreator(kit, tab, creator),
    now: () => kit.clock.now(),
    log: kit.log.service,
  });
}

/** One module per realm (an event page's start, or a new address in one): its start is idempotent. */
export function fanslyModule(): BackgroundHostModule {
  let started: Promise<BackgroundHostHandle> | null = null;
  return { host: 'fansly-web', start: (kit) => (started ??= startFansly(kit)) };
}

export default fanslyModule();
