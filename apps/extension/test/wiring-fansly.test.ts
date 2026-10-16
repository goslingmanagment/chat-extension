// A Fansly tab with the background wired whole (R20 P7i; docs/project-unite/
// architecture.md §1.4, §3.3, §4): the composition root on the fake browser
// against the in-process fake hub (test/support/world.ts) — the release
// flavor, fansly.com itself — once the person switched Fansly on.
// - «Включить Fansly» from the settings: the bundle granted, both scripts
//   registered by the background's sync (P9a) in one call, MAIN first;
// - the tab registers as Fansly's (`fansly-web`), its site module comes up
//   with it, and the background admits what the tab asks by FANSLY's slice of
//   the feature manifest — the one the module brings, as the core's graph has
//   no file of Fansly's: a Reply of a Fansly chat is admitted and streams, an
//   insert token is issued, under the Fansly page's own switches; a part of it
//   sent by hand is taken for known by Fansly's own rule (`human-send`), not
//   by ChatSpace's `wsTap`;
// - the module down (its file missing): nothing of Fansly is admitted, and
//   nothing reaches the hub; ChatSpace as before.

import { CONTRACTS_VERSION, parseTabPayload, type HubBinding, type StartOp } from '@cg/contracts';
import { FanslyGreetingClaimOpSchema } from '@cg/contracts/send-fansly';
import type { SoundBatch } from '@cg/contracts/sound';
import { soundTransport } from '../src/composition/tab/hosts/fansly/sound';
import type { StartedHost } from '../src/composition/tab/adapter';
import type { ChatRef, HostAccount } from '@cg/contracts/ids';
import { FANSLY_TAB_TYPE_PREFIX, parseFanslyTabPayload, type FanslyTabRequestPayload, type FanslyTabResponsePayload } from '@cg/contracts/tab-messages-fansly';
import type { FanslyPageRequestType } from '@cg/core/application/hosts/fansly/pages';
import { SoundArbiter } from '@cg/core/services/sound';
import type { NetworkSession, RequestFact } from '@cg/core/services/network-session';
import { createPageRpcClient, createTabRpcClient, type TabRpcClient } from '@cg/platform';
import { callsTo, fanslyPageFlags } from '@cg/testing/fake-hub';
import { WORLD } from '@cg/testing/hub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WebRequestDetailsApi } from '../../../packages/platform/src/browser-api.ts';
import { FakeEvent, pageSender, tabSender } from '../../../packages/platform/src/test-support/fake-browser.ts';
import { createFanslyApi } from '@cg/fansly-api';
import type { BackgroundKit } from '../src/composition/background/host-module.ts';

import { readFanslyWindows } from '../lazy/fansly/ai-fansly.ts';
import { parseTabPayload as fanslyProtocol } from '../lazy/fansly/tab-protocol.ts';
import { fanslyRequest } from '../src/composition/tab/hosts/fansly/requests.ts';
import { fanslyModule } from '../bg/fansly.ts';
import { SITE_TYPE_PREFIX } from '../src/composition/site-access.ts';
import { FANSLY_API_MATCHES, FANSLY_MATCHES } from '../src/hosts/runtime/fansly.ts';
import { admitted, bindingOf, opsOf, signInWithPersona, startReply, workingTab, type WorkingTab } from './support/tabs.ts';
import { PASSWORD, createWorld, loadChunkModule, sleep, until, type World } from './support/world.ts';

const FANSLY_ORIGIN = new URL((FANSLY_MATCHES[0] ?? '').replace(/\*$/, '')).origin;
const PAGE = WORLD.pages.fansly;
const { group, fan } = WORLD.fansly.chats.a;
const CREATOR = PAGE.platformAccountId;

/** The account a Fansly tab shows: one creator, whose host and platform ids are the same (§7.13). */
const FANSLY_ACCOUNT: HostAccount = { host: 'fansly-web', hostAccountId: CREATOR, platform: 'fansly', platformAccountId: CREATOR, username: null, displayName: null };
const FANSLY_CHAT: ChatRef = { host: 'fansly-web', hostAccountId: CREATOR, platformFanId: fan };

const worlds: World[] = [];
beforeEach(() => {
  for (const level of ['debug', 'info', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => undefined);
});
afterEach(async () => {
  for (const made of worlds.splice(0)) made.dispose();
  await sleep(30);
  vi.restoreAllMocks();
});

/** A load of Fansly's chunk held until the test lets it go: a module that takes its time to come up. */
interface ChunkGate {
  held: boolean;
  readonly waiting: Array<() => void>;
}
const gate = (): ChunkGate => ({ held: false, waiting: [] });
const release = (held: ChunkGate): void => {
  held.held = false;
  for (const go of held.waiting.splice(0)) go();
};

/** The world with Fansly's chunk loadable — or missing, as a build without it would be, or held at a gate. */
function world(chunk: 'present' | 'missing' | ChunkGate = 'present', captureSession?: (session: NetworkSession, kit: BackgroundKit) => void): World {
  const loadFansly = (): Promise<unknown> => {
    if (chunk === 'missing') return Promise.reject(new TypeError('error loading dynamically imported module'));
    // A module of its own for every load: each instance of the event page is a realm of its own.
    const module = fanslyModule();
    const loaded = { default: { ...module, start: (kit: Parameters<typeof module.start>[0]) => {
      if (kit.networkSession !== undefined) captureSession?.(kit.networkSession, kit);
      return module.start(kit);
    } } };
    if (chunk === 'present' || !chunk.held) return Promise.resolve(loaded);
    return new Promise((resolve) => chunk.waiting.push(() => resolve(loaded)));
  };
  const made = createWorld({ loadHostModule: (url) => (url.includes('/bg/fansly.js') ? loadFansly() : loadChunkModule(url)) });
  worlds.push(made);
  // The Fansly page of the hub with every switch it has on (its own row: `*` never reaches a Fansly page, HF-2).
  made.hub.control({ op: 'config', patch: fanslyPageFlags() });
  return made;
}

/** «Включить Fansly» in the settings: the browser grants the bundle, the background registers both scripts. */
async function switchFanslyOn(w: World): Promise<void> {
  for (const origin of [...FANSLY_MATCHES, ...FANSLY_API_MATCHES]) w.fake.permissions.origins.add(origin);
  w.fake.permissions.permissions.add('webRequest');
  const answer = await w.page().request('site.access', { host: 'fansly-web', enabled: true });
  if (!answer.ok) throw new Error(`site.access: ${answer.error.code}`);
  await until(async () => {
    const state = await w.page().request('site.access', { host: 'fansly-web' });
    return state.ok && state.payload.registered;
  }, 'the background registered Fansly');
}

/** The person signed in, and the Fansly page has its persona too. */
async function signIn(w: World): Promise<void> {
  await signInWithPersona(w, { username: WORLD.user.username, password: PASSWORD });
  const saved = await w.page().request('persona.set', { pageId: PAGE.pageId, key: WORLD.persona.key, definitionId: WORLD.persona.definitionId });
  if (!saved.ok) throw new Error(`persona.set: ${saved.error.code}`);
}

type FanslyTab = WorkingTab;

/** A tab of fansly.com in the open chat of group `a`, registered as Fansly's and reporting its creator. */
async function fanslyTab(w: World, tabId = 21, report = true): Promise<FanslyTab> {
  const url = `${FANSLY_ORIGIN}/messages/${group}`;
  const context = w.fake.context(tabSender(w.fake, { url, origin: FANSLY_ORIGIN, tab: { id: tabId, url } }));
  const client = createTabRpcClient({ api: context.api, validate: fanslyProtocol, register: { host: 'fansly-web', lateInjection: false, contractsVersion: CONTRACTS_VERSION }, reconnectDelaysMs: [5, 10, 20] });
  await until(() => client.state() === 'ready', 'the Fansly tab registered');
  if (!report) return { client, tabSessionId: () => client.tabSessionId() ?? '' };
  const reported = await client.request('tab.presence', { chat: FANSLY_CHAT, routeEpoch: 1, visible: true, focused: true, accounts: [FANSLY_ACCOUNT], routeAccount: FANSLY_ACCOUNT });
  if (!reported.ok) throw new Error(`tab.presence: ${reported.error.code}`);
  return { client, tabSessionId: () => client.tabSessionId() ?? '' };
}

async function fanslyBinding(tab: FanslyTab): Promise<HubBinding> {
  const answer = await tab.client.request('binding.resolve', { account: FANSLY_ACCOUNT });
  if (!answer.ok) throw new Error(`binding.resolve: ${answer.error.code}`);
  return answer.payload.binding;
}

/** A Reply of the Fansly chat as the dock starts it: the token of the click, then `op.start` — the chat is the group, the fan its own. */
async function fanslyReply(tab: FanslyTab, binding: HubBinding) {
  const token = await tab.client.request('token.issue', { kind: 'generate', surface: 'dock' });
  if (!token.ok) throw new Error(`token.issue: ${token.error.code}`);
  const start: StartOp = {
    feature: 'reply',
    surface: 'dock',
    target: { binding, chat: FANSLY_CHAT, fanRef: fan, conversationRef: group },
    cause: { kind: 'click', actionToken: token.payload.actionToken },
    tone: null,
    split: false,
    window: 100,
  };
  return tab.client.request('op.start', start);
}

const modules = async (w: World): Promise<ReadonlyArray<{ host: string; state: string }>> => {
  const diagnostics = await w.page().request('diagnostics.get', {});
  return diagnostics.ok ? (diagnostics.payload.hostModules ?? []) : [];
};

describe('[host:fansly] a Fansly tab and the background (R20 P7i)', () => {
  it.each(['switched off', 'permissions revoked'] as const)('[FS-PERM-5] Fansly %s: shared Reply and Hi starts with existing tokens and new generation tokens are refused; ChatSpace still starts', async (change) => {
    const w = world(); w.start(); await switchFanslyOn(w); await signIn(w);
    const tab = await fanslyTab(w);
    const binding = await fanslyBinding(tab);
    const starts: StartOp[] = [];
    for (const feature of ['reply', 'hi'] as const) {
      const token = await tab.client.request('token.issue', { kind: 'generate', surface: 'dock' });
      if (!token.ok) throw new Error(`token.issue: ${token.error.code}`);
      starts.push({ feature, surface: 'dock', target: { binding, chat: FANSLY_CHAT, fanRef: fan, conversationRef: group }, cause: { kind: 'click', actionToken: token.payload.actionToken }, tone: null, split: false, window: 100 });
    }
    if (change === 'switched off') {
      expect(await w.page('popup').request('site.access', { host: 'fansly-web', enabled: false })).toMatchObject({ ok: true, payload: { enabled: false, registered: false } });
    } else {
      w.fake.revokeFromBrowserUi({ origins: [...FANSLY_MATCHES, ...FANSLY_API_MATCHES], permissions: ['webRequest'] });
      await until(async () => {
        const access = await w.page().request('site.access', { host: 'fansly-web' });
        return access.ok && !access.payload.granted && !access.payload.registered;
      }, 'Fansly permissions revoked');
    }
    for (const start of starts) expect(await tab.client.request('op.start', start)).toMatchObject({ ok: false, error: { code: 'CG-FEATURE-DISABLED' } });
    expect(await tab.client.request('token.issue', { kind: 'generate', surface: 'dock' })).toMatchObject({ ok: false, error: { code: 'CG-FEATURE-DISABLED' } });
    expect(await opsOf(tab)).toHaveLength(0);
    expect(callsTo(w.hub.read().entries, 'aiFeatureStream')).toHaveLength(0);
    const chatspace = await workingTab(w);
    admitted(await startReply(chatspace, await bindingOf(chatspace)));
    await until(() => callsTo(w.hub.read().entries, 'aiFeatureStream').length === 1, 'ChatSpace’s Reply reached the hub');
  });

  it('[NF-021] own and ai-edited greetings: the real kit adapter passes the manual group’s site schema to the hub', async () => {
    let kit: BackgroundKit | undefined;
    const w = world('present', (_session, given) => { kit = given; });
    w.start(); await switchFanslyOn(w); await signIn(w); await fanslyTab(w);
    await until(() => kit !== undefined, 'the real kit supplied');
    const given = kit!;
    const instanceId = given.install.instanceId();
    const leaseToken = given.ids.uuid();
    const attemptId = given.ids.uuid();
    const target = { pageLabel: PAGE.pageLabel, fanRef: fan };
    await given.hub.facade.claim({ ...target, body: { action: 'claim', instanceId, leaseToken } }, FanslyGreetingClaimOpSchema);
    const group = { kind: 'manual', textFingerprint: 'a'.repeat(64) } as const;
    await expect(given.hub.facade.claim({
      ...target,
      body: { action: 'dispatch', attemptId, instanceId, purpose: 'greeting', group, partIndex: 0, textRevision: 2, leaseToken, flagRevision: given.hub.bootstrap()!.configRevision },
    }, FanslyGreetingClaimOpSchema)).resolves.toMatchObject({ custody: { attemptId, state: 'dispatching', ticket: expect.any(String) as unknown } });
    expect(callsTo(w.hub.read().entries, 'clientFanClaim').at(-1)).toMatchObject({ status: 200, request: { ...target, body: { action: 'dispatch', group: { kind: 'manual' } } } });
  });

  it('[AI-111] P12a: the real site RPC streams a script, then an event-page restart restores it and interrupts the next script without a second POST', async () => {
    const w = world(); w.start(); await switchFanslyOn(w); await signIn(w);
    const tab = await fanslyTab(w);
    const binding = await fanslyBinding(tab);
    const start = async (regenerateOf?: string): Promise<string> => {
      const token = await tab.client.request('token.issue', { kind: 'generate', surface: 'dock' });
      if (!token.ok) throw new Error(token.error.code);
      return admitted(await fanslyRequest(tab.client, 'fansly.ops.start', {
        feature: 'voice-script', target: { binding, chat: FANSLY_CHAT, fanRef: fan, conversationRef: group },
        cause: { kind: 'click', actionToken: token.payload.actionToken }, window: 100, tone: null,
        draft: { text: 'A synthetic draft.', revision: 1, digest: '0123456789abcdef' },
        ...(regenerateOf === undefined ? {} : { regenerateOf }),
      }));
    };
    const read = (opId: string) => fanslyRequest(tab.client, 'fansly.ops.read', { opId });
    const first = await start();
    await until(async () => { const result = await read(first); return result.ok && result.payload.view?.state === 'done'; }, 'the voice script is complete');
    w.hub.control({ op: 'scriptSse', feature: 'voice-script', responses: [{ kind: 'stream', steps: [{ kind: 'gate', name: 'p12a-restart' }, { kind: 'eof' }] }] });
    const pending = await start(first);
    await until(async () => { const result = await read(pending); return result.ok && result.payload.view?.state === 'requesting'; }, 'the next script is journaled and requested');
    const before = w.starts();
    w.fake.suspendBackground();
    await until(() => w.starts() > before && tab.client.state() === 'ready', 'the tab registered with a fresh background');
    expect(await read(first)).toMatchObject({ ok: true, payload: { view: { state: 'done', result: { kind: 'voice-script' }, generationRef: expect.any(String) as unknown } } });
    expect(await read(pending)).toMatchObject({ ok: true, payload: { view: { state: 'interrupted', error: { code: 'CG-OP-INTERRUPTED' } } } });
    expect(callsTo(w.hub.read().entries, 'aiFeatureStream')).toHaveLength(2);
    w.hub.control({ op: 'release', gate: 'p12a-restart' });
  });

  it('[SN-001] a MAIN batch acknowledged during RPC reconnection reaches the arbiter after the new presence', async () => {
    const w = world(); w.start(); await switchFanslyOn(w);
    let emit = (_batch: SoundBatch): void => undefined;
    const source = Promise.resolve({ onSoundBatch: (listener: (batch: SoundBatch) => void) => { emit = listener; return () => undefined; } });
    let runtimeRpc: TabRpcClient | null = null;
    const transport = soundTransport(source, () => undefined);
    const host = {
      background: { ...transport, connect(rpc: TabRpcClient, life: AbortSignal) { runtimeRpc = rpc; transport.connect(rpc, life); } },
      mounts: { points: () => ({ dock: { kind: 'none' }, overlay: { ready: false } }), onChange: () => () => undefined },
      host: Promise.resolve({
        current: () => ({ route: { chat: null, epoch: 1, account: FANSLY_ACCOUNT }, accounts: [FANSLY_ACCOUNT], composer: null }),
        subscribe: () => () => undefined,
      }),
    } as unknown as StartedHost;
    w.tabRuntime({ hostKind: 'fansly-web', host, focused: false });
    await sleep(350);
    w.fake.suspendBackground();
    await until(() => runtimeRpc?.state() === 'reconnecting', 'the tab is reconnecting');
    emit({ host: 'fansly-web', hostAccountId: CREATOR, events: [{ kind: 'message', id: '90002', conversationRef: group, senderId: fan, fromFan: true, automatic: false, tip: false, sentAt: new Date().toISOString() }] });
    await sleep(700);
    expect(w.played).toHaveLength(1);
  });

  it('[SN-001] a socket batch before the first presence waits for the account report', async () => {
    const w = world(); w.start(); await switchFanslyOn(w);
    const tab = await fanslyTab(w, 21, false);
    const sent = fanslyRequest(tab.client, 'fansly.sound.batch', { host: 'fansly-web', hostAccountId: CREATOR, events: [{ kind: 'message', id: '90001', conversationRef: group, senderId: fan, fromFan: true, automatic: false, tip: false, sentAt: new Date().toISOString() }] });
    await sleep(50);
    await tab.client.request('tab.presence', { chat: null, routeEpoch: 1, visible: true, focused: false, accounts: [FANSLY_ACCOUNT], routeAccount: FANSLY_ACCOUNT });
    expect(await sent).toMatchObject({ ok: true });
    expect(w.played).toHaveLength(1);
  });

  it('[BG-003] presence acknowledges without waiting for the sound decision chain, including ChatSpace keepalives', async () => {
    const w = world(); w.start(); await switchFanslyOn(w);
    const tab = await fanslyTab(w);
    const other = await workingTab(w);
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(SoundArbiter.prototype, 'rememberAccounts').mockReturnValue(held);
    try {
      for (const client of [tab.client, other.client]) {
        const ack = client.request('tab.presence', { chat: null, routeEpoch: 2, visible: true, focused: false });
        expect(await Promise.race([ack, sleep(150).then(() => 'blocked')])).toMatchObject({ ok: true });
      }
    } finally { release(); }
  });

  it('[FS-SND-1] [FS-SND-2] socket sounds use the site slice while signed out: focus, effective tones, identity, mute and disable are checked in the real wiring', async () => {
    const w = world();
    const context = w.start();
    await switchFanslyOn(w);
    const tab = await fanslyTab(w);
    const report = { chat: null, routeEpoch: 2, visible: true, focused: true, accounts: [FANSLY_ACCOUNT], routeAccount: FANSLY_ACCOUNT, conversationRef: group };
    await tab.client.request('tab.presence', report);
    // The model is remembered before a socket event ever comes in.
    await until(async () => JSON.stringify((await context.api.storage.local.get('sound.accounts'))['sound.accounts']).includes(CREATOR), 'the model was remembered');
    const fact = { kind: 'message' as const, id: '900000000000000001', conversationRef: group, senderId: fan, fromFan: true, automatic: false, tip: false, sentAt: new Date().toISOString() };
    const send = (id: string, hostAccountId: string = CREATOR) => fanslyRequest(tab.client, 'fansly.sound.batch', { host: 'fansly-web', hostAccountId, events: [{ ...fact, id }] });
    expect(await send(fact.id)).toMatchObject({ ok: true });
    expect(w.played).toHaveLength(0); // The group is open, although its fan is unknown.
    await tab.client.request('tab.presence', { ...report, focused: false });
    // A site-specific choice, changed while the module lives; v1's blip remains untouched.
    await context.api.storage.local.set({ 'settings.ext': { v: 1, hosts: { 'fansly-web': { enabled: true, sound: { messagesTone: 'double' } } } } });
    await sleep(30);
    expect(await send('900000000000000002')).toMatchObject({ ok: true });
    expect(w.played).toHaveLength(1);
    expect(w.played[0]?.notes).toBe(2);
    expect(await send('900000000000000003', '900000000000000999')).toMatchObject({ ok: true });
    expect(w.played).toHaveLength(1); // A different account's facts are not this tab's.
    const other = w.tabClient();
    await until(() => other.client.state() === 'ready', 'the ChatSpace tab registered');
    expect(await fanslyRequest(other.client, 'fansly.sound.batch', { host: 'fansly-web', hostAccountId: CREATOR, events: [fact] }, 200)).toMatchObject({ ok: false });
    await w.page().request('settings.patch', { patch: { sound: { mutedAccounts: [`fansly-web:${CREATOR}`] } }, baseRevision: null });
    expect(await send('900000000000000005')).toMatchObject({ ok: true });
    expect(w.played).toHaveLength(1);
    await w.page().request('site.access', { host: 'fansly-web', enabled: false });
    expect(await fanslyRequest(tab.client, 'fansly.sound.batch', { host: 'fansly-web', hostAccountId: CREATOR, events: [{ ...fact, id: '900000000000000004' }] }, 200)).toMatchObject({ ok: true });
    const diagnostics = await w.page().request('diagnostics.get', {});
    expect(diagnostics.ok && diagnostics.payload.sound.outcomes).toMatchObject({ 'open-chat': 1, played: 1, 'tab-closed': 1, muted: 1, 'no-permission': 1 });
  });

  it('[host:fansly] «Включить Fansly»: the sync registers both scripts on fansly.com in one call, MAIN first; the tab registers as Fansly’s and its module comes up', async () => {
    const w = world();
    w.start();
    await switchFanslyOn(w);
    const scripts = await w.fake.context(tabSender(w.fake)).api.scripting?.getRegisteredContentScripts();
    expect((scripts ?? []).filter((script) => script.id.startsWith('fansly')).map((script) => [script.id, script.world, [...(script.matches ?? [])]])).toEqual([
      ['fansly-main', 'MAIN', [...FANSLY_MATCHES]],
      ['fansly', 'ISOLATED', [...FANSLY_MATCHES]],
    ]);
    await fanslyTab(w);
    const diagnostics = await w.page().request('diagnostics.get', {});
    expect(diagnostics.ok && diagnostics.payload.tabs.map((tab) => tab.site)).toEqual(['fansly-web']);
    await until(async () => (await modules(w)).some((entry) => entry.host === 'fansly-web' && entry.state === 'started'), 'Fansly’s module started with its tab');
  });

  it('[host:fansly] a Reply of a Fansly chat is admitted by Fansly’s slice of the manifest — the one its module brought — and streams; an insert token is issued', async () => {
    const w = world();
    w.start();
    await switchFanslyOn(w);
    await signIn(w);
    const tab = await fanslyTab(w);
    const binding = await fanslyBinding(tab);
    expect(binding).toMatchObject({ host: 'fansly-web', pageId: PAGE.pageId, platformAccountId: CREATOR });
    const opId = admitted(await fanslyReply(tab, binding));
    await until(async () => (await opsOf(tab)).find((op) => op.opId === opId)?.state === 'done', 'the Fansly Reply is done');
    const streams = callsTo(w.hub.read().entries, 'aiFeatureStream');
    expect(streams).toHaveLength(1);
    expect(await tab.client.request('token.issue', { kind: 'insert', surface: 'dock' })).toMatchObject({ ok: true });
    // The page's own switch decides: Fansly's drafts off — a Reply there is refused before the hub hears of it.
    w.hub.control({ op: 'config', patch: fanslyPageFlags({ drafts: false, insertion: true }) });
    expect(await w.page().request('bootstrap.get', { force: true })).toMatchObject({ ok: true });
    expect(await fanslyReply(tab, binding)).toEqual({ ok: false, error: { code: 'CG-FEATURE-DISABLED' } });
    expect(callsTo(w.hub.read().entries, 'aiFeatureStream')).toHaveLength(1);
  });

  it('[host:fansly] [FS-TAIL-9] local freshness counts without telemetry consent and survives event-page sleep', async () => {
    const w = world();
    w.start();
    await switchFanslyOn(w);
    await signIn(w);
    const tab = await fanslyTab(w);
    const opId = admitted(await fanslyReply(tab, await fanslyBinding(tab)));
    await until(async () => (await opsOf(tab)).some((op) => op.opId === opId && op.state === 'done'), 'the Reply is done');
    const before = await w.page().request('diagnostics.get', {});
    expect(before.ok && before.payload.telemetry.consent).toBe(false);
    expect(before.ok && before.payload.freshness?.rows).toMatchObject([{ host: 'fansly-web', feature: 'reply', counts: { generations: 1, unknown: 1 } }]);
    await until(() => w.fake.areas.session.has('diagnostics.freshnessDay'), 'the numeric day aggregate is saved');
    expect(JSON.stringify(w.fake.areas.session.get('diagnostics.freshnessDay'))).not.toContain(CREATOR);
    w.fake.suspendBackground();
    await until(() => w.starts() === 2 && tab.client.state() === 'ready', 'the background woke');
    const after = await w.page().request('diagnostics.get', {});
    expect(after.ok && after.payload.freshness?.rows).toEqual(before.ok ? before.payload.freshness?.rows : []);
    expect(after.ok && after.payload.freshness?.persisted).toBe(true);
    expect(after.ok && after.payload.telemetry.queued).toBe(0);
    expect(callsTo(w.hub.read().entries, 'ingestObservations')).toHaveLength(0);
  });

  it('[host:fansly] a part of a Fansly Reply sent by hand is taken for known by Fansly’s own rule — its page has no `wsTap`, its MAIN sees the send —; a ChatSpace page with `wsTap` off still drops its own', async () => {
    const w = world();
    // The person agreed to technical data: a `sent` that is taken for known is queued (`recorded: true`).
    w.fake.permissions.data_collection.add('technicalAndInteraction');
    w.start();
    await switchFanslyOn(w);
    await signIn(w);
    const tab = await fanslyTab(w);
    const opId = admitted(await fanslyReply(tab, await fanslyBinding(tab)));
    await until(async () => (await opsOf(tab)).find((op) => op.opId === opId)?.state === 'done', 'the Fansly Reply is done');
    expect(await tab.client.request('op.reportSent', { opId, part: { index: 0 }, pendingId: 'pending-1', platformMessageId: '810000000000000999', edited: false })).toEqual({ ok: true, payload: { recorded: true } });

    // ChatSpace as before: the page of its operation has its tap off — the send is not ours to know.
    w.hub.control({ op: 'config', patch: { pageFlags: { [WORLD.pages.one.pageLabel]: { wsTap: false } } } });
    expect(await w.page().request('bootstrap.get', { force: true })).toMatchObject({ ok: true });
    const chatspace = await workingTab(w);
    const reply = admitted(await startReply(chatspace, await bindingOf(chatspace)));
    await until(async () => (await opsOf(chatspace)).find((op) => op.opId === reply)?.state === 'done', 'ChatSpace’s Reply is done');
    expect(await chatspace.client.request('op.reportSent', { opId: reply, part: { index: 0 }, pendingId: 'pending-2', platformMessageId: '4101', edited: false })).toEqual({ ok: true, payload: { recorded: false } });
  });

  it('[host:fansly] a send reported while the woken background brings Fansly’s module up is judged when the module is up: the person signed out and another signed in meanwhile — the operation is gone, nothing is recorded under the new sign-in', async () => {
    const held = gate();
    const w = world(held);
    w.fake.permissions.data_collection.add('technicalAndInteraction');
    w.start();
    await switchFanslyOn(w);
    await signIn(w);
    const tab = await fanslyTab(w);
    const opId = admitted(await fanslyReply(tab, await fanslyBinding(tab)));
    await until(async () => (await opsOf(tab)).find((op) => op.opId === opId)?.state === 'done', 'the Fansly Reply is done');
    // The event page goes and comes back: Fansly's module is to be loaded again, and that load takes its time.
    held.held = true;
    w.fake.suspendBackground();
    await until(() => w.starts() === 2 && tab.client.state() === 'ready', 'the tab registered with the new instance');
    expect((await opsOf(tab)).find((op) => op.opId === opId)).toBeDefined();
    const reported = tab.client.request('op.reportSent', { opId, part: { index: 0 }, pendingId: 'pending-1', platformMessageId: '810000000000000999', edited: false });
    await sleep(50);
    // Meanwhile the person signs out, and another signs in.
    expect(await w.page().request('session.signOut', {})).toMatchObject({ ok: true });
    await signInWithPersona(w, { username: WORLD.otherUser.username, password: 'synthetic-password-2' });
    release(held);
    expect(await reported).toEqual({ ok: true, payload: { recorded: false } });
    const diagnostics = await w.page().request('diagnostics.get', {});
    expect(diagnostics.ok && diagnostics.payload.telemetry.queued).toBe(0);
  });

  it('[host:fansly] a start and an insert token that waited for Fansly’s module are refused when the sign-in changed meanwhile', async () => {
    const held = gate();
    const w = world(held);
    w.start();
    await switchFanslyOn(w);
    await signIn(w);
    held.held = true;
    const tab = await fanslyTab(w);
    const binding = await fanslyBinding(tab);
    const token = await tab.client.request('token.issue', { kind: 'generate', surface: 'dock' });
    if (!token.ok) throw new Error(`token.issue: ${token.error.code}`);
    const started = tab.client.request('op.start', {
      feature: 'reply',
      surface: 'dock',
      target: { binding, chat: FANSLY_CHAT, fanRef: fan, conversationRef: group },
      cause: { kind: 'click', actionToken: token.payload.actionToken },
      tone: null,
      split: false,
      window: 100,
    });
    const insert = tab.client.request('token.issue', { kind: 'insert', surface: 'dock' });
    await sleep(50);
    expect(await w.page().request('session.signOut', {})).toMatchObject({ ok: true });
    await signInWithPersona(w, { username: WORLD.otherUser.username, password: 'synthetic-password-2' });
    release(held);
    expect(await started).toMatchObject({ ok: false, error: { code: 'CG-CONTEXT-CHANGED' } });
    expect(await insert).toMatchObject({ ok: false, error: { code: 'CG-CONTEXT-CHANGED' } });
    expect(callsTo(w.hub.read().entries, 'aiFeatureStream')).toHaveLength(0);
  });

  it('[host:fansly] the module down (its file missing): nothing of Fansly is admitted and nothing reaches the hub; a ChatSpace tab beside it generates as before', async () => {
    const w = world('missing');
    w.start();
    await switchFanslyOn(w);
    await signIn(w);
    const tab = await fanslyTab(w);
    const binding = await fanslyBinding(tab);
    const refused = await fanslyReply(tab, binding);
    expect(refused).toMatchObject({ ok: false, error: { code: 'CG-FEATURE-DISABLED' } });
    expect(await tab.client.request('token.issue', { kind: 'insert', surface: 'dock' })).toMatchObject({ ok: false, error: { code: 'CG-FEATURE-DISABLED' } });
    expect((await modules(w)).find((entry) => entry.host === 'fansly-web')?.state).toBe('failed');
    expect(callsTo(w.hub.read().entries, 'aiFeatureStream')).toHaveLength(0);
    const chatspace = await workingTab(w);
    admitted(await startReply(chatspace, await bindingOf(chatspace)));
    await until(() => callsTo(w.hub.read().entries, 'aiFeatureStream').length === 1, 'ChatSpace’s Reply reached the hub');
  });
});


it('[host:fansly] [FS-NET-3] a call waits for webRequest observations still queued in composition', async () => {
  let kit: BackgroundKit | undefined;
  const completed = new FakeEvent<(details: WebRequestDetailsApi) => void>();
  const w = createWorld({ configureApi: (api) => { Object.assign(api, { webRequest: { onCompleted: completed, onBeforeSendHeaders: new FakeEvent(), onErrorOccurred: new FakeEvent() } }); }, loadHostModule: () => Promise.resolve({ default: { host: 'fansly-web', start: async (value: BackgroundKit) => {
    kit = value;
    return fanslyModule().start(value);
  } } }) });
  worlds.push(w);
  w.start(); await switchFanslyOn(w); await fanslyTab(w);
  await until(() => kit !== undefined, 'kit supplied');
  const session = kit!.networkSession!;
  const fact = { requestId: 'capture', url: 'https://apiv3.fansly.com/api/v1/message', tabId: 21, frameId: 0, documentUrl: `${FANSLY_ORIGIN}/messages/9`, originUrl: FANSLY_ORIGIN,
    requestHeaders: [
      { name: 'authorization', value: btoa(`${CREATOR}:token`) },
      { name: 'fansly-client-id', value: 'client' }, { name: 'fansly-session-id', value: 'session' }, { name: 'fansly-client-ts', value: '1' },
    ],
  };
  await session.accept({ ...fact, phase: 'headers' }); await session.accept({ ...fact, phase: 'completed', statusCode: 200 });
  const fetch = vi.fn().mockResolvedValue({ status: 200, headers: { get: () => null }, text: () => Promise.resolve( '{"success":true}') });
  const api = createFanslyApi({ session, storage: kit!.storage.session, fetch });
  await api.pacer.ready;
  // Hold the first item inside accept: the 429 behind it has not reached the core yet.
  const original = session.accept.bind(session);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const spy = vi.spyOn(session, 'accept').mockImplementation(async (event) => {
    if (event.requestId === 'held') await held;
    return original(event);
  });
  completed.emit( { ...fact, requestId: 'held', statusCode: 200 });
  await until(() => spy.mock.calls.length > 0, 'observation held');
  completed.emit( { ...fact, requestId: 'foreign-429', statusCode: 429 });
  const result = api.client.call({ purpose: 'registration', route: 'group.detail', account: CREATOR, path: { group } }).catch((error: unknown) => error);
  await sleep(20);
  const callsBeforeRelease = fetch.mock.calls.length;
  release();
  const outcome = await result;
  expect(callsBeforeRelease).toBe(0);
  expect(outcome).toMatchObject({ kind: 'cooling', sent: false });
  expect(fetch).not.toHaveBeenCalled();
});


it('[host:fansly] unreadable pacer storage keeps the module and vault registry running while calls fail closed', async () => {
  let kit: BackgroundKit | undefined;
  const w = createWorld({ loadHostModule: () => Promise.resolve({ default: { host: 'fansly-web', start: async (value: BackgroundKit) => {
    kit = value;
    const get = value.storage.session.get.bind(value.storage.session);
    vi.spyOn(value.storage.session, 'get').mockImplementation((keys) => keys.includes('fansly.pacer') ? Promise.reject(new Error('unreadable')) : get(keys));
    return fanslyModule().start(value);
  } } }) });
  worlds.push(w);
  w.start(); await switchFanslyOn(w);
  const tab = await fanslyTab(w);
  await until(async () => (await modules(w)).some((entry) => entry.host === 'fansly-web' && entry.state === 'started'), 'Fansly module starts despite unreadable pacer');
  expect(kit).toBeDefined();
  // The installed registry handles the vault request (not CG-RUNTIME-UNREACHABLE).
  const vault = await fanslyRequest(tab.client, 'fansly.vault.resume', { hostAccountId: CREATOR, albumId: '123' });
  expect(vault).toMatchObject({ ok: true });
});

/** The settings page as the pages' composition root makes its port: Fansly's types checked by Fansly's registry (R20 P14b1). */
function fanslySettingsPage(w: World) {
  const client = createPageRpcClient({
    api: w.fake.context(pageSender(w.fake, 'options')).api,
    validate: (kind, type, payload) => (type.startsWith(FANSLY_TAB_TYPE_PREFIX) ? parseFanslyTabPayload(kind, type, payload) : parseTabPayload(kind, type, payload)),
    reconnectDelaysMs: [5, 10, 20],
  });
  return {
    request: <T extends FanslyPageRequestType>(type: T, payload: FanslyTabRequestPayload<T>) =>
      client.request(type as never, payload as never) as unknown as Promise<{ ok: true; payload: FanslyTabResponsePayload<T> } | { ok: false; error: { code: string; detail?: string } }>,
    close: () => client.close(),
  };
}

describe('[host:fansly] the settings page and Fansly’s module (R20 P14b1)', () => {
  it('[ST-075] [ST-079] mute set before the creator was known still silences the canonical account after reconciliation', async () => {
    let network: NetworkSession | undefined;
    const w = world('present', (session) => { network = session; });
    w.start();
    await switchFanslyOn(w);
    const tab = await fanslyTab(w, 21);
    const page = fanslySettingsPage(w);
    await page.request('fansly.accounts.read', {}); // Wait for the real module.
    const legacy = '700000000000000101';
    const fact: RequestFact = {
      phase: 'headers', requestId: 'legacy-session', url: 'https://apiv3.fansly.com/api/v1/account/me', tabId: 21, frameId: 0,
      originUrl: `${FANSLY_ORIGIN}/messages`, documentUrl: `${FANSLY_ORIGIN}/messages`,
      requestHeaders: [
        { name: 'authorization', value: btoa(`${legacy}:synthetic`) },
        { name: 'fansly-client-id', value: 'client' }, { name: 'fansly-session-id', value: 'session' },
        { name: 'fansly-client-ts', value: '100' }, { name: 'fansly-client-check', value: 'check' },
      ],
    };
    if (network === undefined) throw new Error('module did not receive its session owner');
    await network.accept(fact);
    await network.accept({ ...fact, phase: 'completed', statusCode: 200 });
    expect(await w.page().request('settings.patch', { patch: { sound: { mutedAccounts: [`fansly-web:${legacy}`] } }, baseRevision: null })).toMatchObject({ ok: true });
    // A correlated identity response, after the legacy-only preference was stored.
    await network.resolveIdentity(21, legacy, CREATOR);
    expect(await page.request('fansly.accounts.read', {})).toMatchObject({ ok: true, payload: { sessions: [{ legacyId: legacy, canonicalId: CREATOR }] } });
    // P14a's real socket route uses its persistent own-account aliases for both kinds of sound.
    expect(await fanslyRequest(tab.client, 'fansly.sound.batch', { host: 'fansly-web', hostAccountId: CREATOR, events: [
      { kind: 'message', id: '900000000000000010', conversationRef: group, senderId: fan, fromFan: true, automatic: false, tip: false, sentAt: new Date().toISOString() },
      { kind: 'subscriber', id: '900000000000000011', accountId: CREATOR, followerId: fan },
    ] })).toMatchObject({ ok: true });
    const diagnostics = await w.page().request('diagnostics.get', {});
    expect(diagnostics.ok && diagnostics.payload.sound.outcomes).toMatchObject({ muted: 1, 'subscriber.muted': 1 });
    expect(w.played).toEqual([]);
    page.close();
  });

  it('[FS-SET-1] disabling Fansly while its module loads refuses the pending page write', async () => {
    const held = gate();
    held.held = true;
    const w = world(held);
    w.start();
    await switchFanslyOn(w);
    const page = fanslySettingsPage(w);
    const pending = page.request('fansly.settings.write', { patch: { hosts: { 'fansly-web': { viaTab: true } } } });
    await until(() => held.waiting.length > 0, 'Fansly module load is pending');
    expect(await w.page().request('site.access', { host: 'fansly-web', enabled: false })).toMatchObject({ ok: true });
    const storage = w.fake.context(pageSender(w.fake, 'options')).api.storage.local;
    const before = await storage.get('settings.ext');
    release(held);
    expect(await pending).toEqual({ ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE', detail: 'site off' } });
    expect(await storage.get('settings.ext')).toEqual(before);
    page.close();
  });

  it('[host:fansly] the core routes the page’s `fansly.*` by the site’s own prefix (composition site-access.ts = contracts)', () => {
    expect(SITE_TYPE_PREFIX).toBe(FANSLY_TAB_TYPE_PREFIX);
  });

  it('[FS-SET-1] [host:fansly] off: answered at once — CG-RUNTIME-UNREACHABLE, no module; on: its part of `settings.ext` through the one owner — a write lands in the key, never «Fansly включён»', async () => {
    const w = world();
    w.start();
    const page = fanslySettingsPage(w);
    expect(await page.request('fansly.settings.read', {})).toEqual({ ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE', detail: 'site off' } });
    expect((await modules(w)).find((entry) => entry.host === 'fansly-web')?.state ?? 'idle').not.toBe('started');
    await switchFanslyOn(w);
    const read = await page.request('fansly.settings.read', {});
    expect(read).toMatchObject({ ok: true, payload: { ext: { hosts: { 'fansly-web': { enabled: true, viaTab: false } }, windows: { deep: null } }, readOnly: false } });
    const before = read.ok ? read.payload.revision : -1;
    const written = await page.request('fansly.settings.write', { patch: { hosts: { 'fansly-web': { viaTab: true, sound: { subscribersTone: 'bell' } } } } });
    expect(written).toMatchObject({ ok: true, payload: { ext: { hosts: { 'fansly-web': { enabled: true, viaTab: true, sound: { messagesTone: 'chime', subscribersTone: 'bell' } } } } } });
    expect(written.ok && written.payload.revision).toBe(before + 1);
    const stored = await w.fake.context(pageSender(w.fake, 'options')).api.storage.local.get('settings.ext');
    expect(stored['settings.ext']).toMatchObject({ v: 1, hosts: { 'fansly-web': { enabled: true, viaTab: true, sound: { subscribersTone: 'bell' } } } });
    // «Fansly включён» changes through site.access only: the page's write of it is refused by Fansly's own schema.
    expect(await page.request('fansly.settings.write', { patch: { hosts: { 'fansly-web': { enabled: false } } } })).toMatchObject({ ok: false, error: { code: 'CG-UNKNOWN' } });
    page.close();
  });

  it('[FS-AI-1] [host:fansly] a deep start’s depth (R20 P8c): a Fansly tab reads the `windows` of `settings.ext` alone, as the settings page wrote them', async () => {
    const w = world();
    w.start();
    await switchFanslyOn(w);
    const tab = await fanslyTab(w, 21);
    expect(await readFanslyWindows(tab.client)).toEqual({ deep: null });
    const page = fanslySettingsPage(w);
    expect(await page.request('fansly.settings.write', { patch: { windows: { deep: 4000 } } })).toMatchObject({ ok: true, payload: { ext: { windows: { deep: 4000 } } } });
    expect(await readFanslyWindows(tab.client)).toEqual({ deep: 4000 });
    page.close();
  });

  it('[ST-067] [ST-076] [ST-077] [host:fansly] «Аккаунты»: the tabs by their registration, «к вкладке» brings the creator’s tab forward without the `tabs` right and sends the tab nothing', async () => {
    const w = world();
    w.start();
    await switchFanslyOn(w);
    await fanslyTab(w, 21);
    const page = fanslySettingsPage(w);
    // The fake browser lists no tab by address; the registered one is attributed by the creator its tab reported.
    expect(await page.request('fansly.accounts.read', {})).toEqual({ ok: true, payload: { sessions: [], openTabs: 0, unattributedTabs: 0 } });
    w.fake.tabCalls.length = 0;
    expect(await page.request('fansly.accounts.focus', { hostAccountId: CREATOR })).toEqual({ ok: true, payload: { focused: true } });
    expect(w.fake.tabCalls).toEqual(['update 21', 'focus window 1']);
    expect(await page.request('fansly.accounts.focus', { hostAccountId: '700000000000000999' })).toEqual({ ok: true, payload: { focused: false } });
    page.close();
  });
});
