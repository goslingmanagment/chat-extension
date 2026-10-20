// A Fansly tab with the background wired whole (R20 P7i; docs/project-unite/
// architecture.md §1.4, §3.3, §4): the composition root on the fake browser
// against the in-process fake hub (test/support/world.ts) — the release
// flavor, fansly.com itself — once the person switched Fansly on.
// - a Reply of a Fansly chat is admitted by Fansly's slice of the feature
//   manifest and streams, an insert token is issued, under the Fansly page's
//   own switches;
// - a greeting's dispatch goes through the hub's custody;
// - a start and an insert that waited for the module are refused when the
//   sign-in changed meanwhile.

import { CONTRACTS_VERSION, type HubBinding, type StartOp } from '@cg/contracts';
import { FanslyGreetingClaimOpSchema } from '@cg/contracts/send-fansly';
import type { ChatRef, HostAccount } from '@cg/contracts/ids';
import type { NetworkSession } from '@cg/core/services/network-session';
import { createTabRpcClient } from '@cg/platform';
import { callsTo, fanslyPageFlags } from '@cg/testing/fake-hub';
import { WORLD } from '@cg/testing/hub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { tabSender } from '../../../packages/platform/src/test-support/fake-browser.ts';
import type { BackgroundKit } from '../src/composition/background/host-module.ts';

import { parseTabPayload as fanslyProtocol } from '../lazy/fansly/tab-protocol.ts';
import { fanslyModule } from '../bg/fansly.ts';
import { FANSLY_API_MATCHES, FANSLY_MATCHES } from '../src/hosts/runtime/fansly.ts';
import { admitted, opsOf, signInWithPersona, type WorkingTab } from './support/tabs.ts';
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

describe('[host:fansly] a Fansly tab and the background (R20 P7i)', () => {
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
});
