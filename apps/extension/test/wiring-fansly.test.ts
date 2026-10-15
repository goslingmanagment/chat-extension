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
import type { ChatRef, HostAccount } from '@cg/contracts/ids';
import { createTabRpcClient } from '@cg/platform';
import { callsTo, fanslyPageFlags } from '@cg/testing/fake-hub';
import { WORLD } from '@cg/testing/hub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { tabSender } from '../../../packages/platform/src/test-support/fake-browser.ts';
import fanslyModule from '../bg/fansly.ts';
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

/** The world with Fansly's chunk loadable — or missing, as a build without it would be. */
function world(chunk: 'present' | 'missing' = 'present'): World {
  const made = createWorld({
    loadHostModule: (url) => (url.includes('/bg/fansly.js') ? (chunk === 'present' ? Promise.resolve({ default: fanslyModule }) : Promise.reject(new TypeError('error loading dynamically imported module'))) : loadChunkModule(url)),
  });
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
async function fanslyTab(w: World, tabId = 21): Promise<FanslyTab> {
  const url = `${FANSLY_ORIGIN}/messages/${group}`;
  const context = w.fake.context(tabSender(w.fake, { url, origin: FANSLY_ORIGIN, tab: { id: tabId, url } }));
  const client = createTabRpcClient({ api: context.api, validate: parseTabPayload, register: { host: 'fansly-web', lateInjection: false, contractsVersion: CONTRACTS_VERSION }, reconnectDelaysMs: [5, 10, 20] });
  await until(() => client.state() === 'ready', 'the Fansly tab registered');
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
