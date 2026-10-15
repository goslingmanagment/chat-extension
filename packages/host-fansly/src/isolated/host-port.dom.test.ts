// Fansly's HostPort (R20 P7c; docs/project-unite/architecture.md §6, §7.2, §7.7, §7.12): the isolated world over
// MAIN's stream and the page's DOM. A scripted MAIN — every event it sends checked by Fansly's own schemas
// (validate.ts) and built from the contracts' fixtures — for each rule; then the real MAIN of P7a under the port, the
// way the stand runs it (in Firefox: suite-fansly-tap.e2e.ts). The page is a Fansly-like DOM (testing/fake-dom.ts).

import type { FanslyChatWire, FanslyState, FromMainFansly as FanslyBatchEvent } from '@cg/contracts/bridge-messages-fansly';
import type { FanslySnapshot } from '@cg/contracts/fansly';
import { FANSLY_CONTRACT, FanslyContractReportSchema } from '@cg/contracts/fansly-host';
import { FANSLY_IDS, fanslyChatWire, fanslyContractWire, fanslyIdentityWire, fanslyReplySnapshot, fanslyState, probe as PROBE } from '@cg/contracts/fixtures';
import { HostContractReportSchema, RouteStateSchema, type HostEvent } from '@cg/contracts/host';
import { HostIdentitySchema, type HostIdentity } from '@cg/contracts/ids';
import { afterEach, describe, expect, it } from 'vitest';

import { installFanslyMain } from '../main/index';
import { createFakeFanslyPage, type FakeFanslyPage } from '../testing/fake-dom';
import { EPOCH, NO_ONE, scriptedMain, type Answer } from '../testing/scripted-main';
import { createFakeVaultPage } from '../testing/fake-vault';
import { createAnchorWatcher } from './anchors';
import { BridgeCallError, type FanslyMainBridgeClient } from './bridge-client';
import { createFanslyHostPort, type FanslyDiagnostic, type FanslyPort } from './host-port';
import { watchCoexistence, type Coexistence } from './legacy';
import { createVaultUploader, vaultTargetOf } from './vault/upload';
import { createFanslyMounts } from './mount';
import { createRouteWatcher } from './route';
import { startFanslyHost } from './start';
import { loadValidation } from './validation';

const { creator: CREATOR, fan: FAN, group: GROUP, otherGroup: OTHER } = FANSLY_IDS;
const SECOND_CREATOR = '700000000000000009';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  history.replaceState({}, '', '/');
});

/** Lets the port, the observers and the bridge's promises run. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};


/** No action token is ever spent here: these tests write nothing (insert.dom.test.ts does). */
const NO_TOKEN = (): Promise<boolean> => Promise.resolve(false);

const light = { current: () => ({ scheme: 'light', tokens: {}, fixedWidth: false }) as const, onChange: () => () => undefined, dispose: () => undefined };

interface Started {
  readonly port: FanslyPort;
  readonly page: FakeFanslyPage;
  readonly events: HostEvent[];
  readonly diagnostics: FanslyDiagnostic[];
}

/** The port on a Fansly-like page at `path`, over `main` (null — no MAIN), once its first state was taken. */
async function startPort(path: string, main: FanslyMainBridgeClient | null, now?: () => number, before?: (page: FakeFanslyPage) => void, coexistence?: Coexistence): Promise<Started> {
  history.replaceState({}, '', path);
  const page = createFakeFanslyPage();
  // What the page shows before the port exists (its field rendered before MAIN's first word).
  before?.(page);
  const diagnostics: FanslyDiagnostic[] = [];
  const route = createRouteWatcher(window, (diagnostic) => diagnostics.push(diagnostic));
  const anchors = createAnchorWatcher(document, route);
  const port = createFanslyHostPort({ ...(coexistence ? { coexistence } : {}), win: window, bridge: main, mounts: createFanslyMounts(document), theme: light, route, anchors, redeem: NO_TOKEN, validation: loadValidation, onDiagnostic: (diagnostic) => diagnostics.push(diagnostic), ...(now === undefined ? {} : { now }) });
  cleanups.push(() => port.dispose(), () => page.destroy());
  const events: HostEvent[] = [];
  port.subscribe((event) => events.push(event));
  await port.ready;
  return { port, page, events, diagnostics };
}

const chatOf = (groupId: string, routeEpoch: number, over: Partial<FanslyChatWire> = {}): FanslyBatchEvent => ({ t: 'fx.chat', p: { ...fanslyChatWire, groupId, routeEpoch, ...over } });
const identityEvent = (creatorId: string | null): FanslyBatchEvent => ({ t: 'fx.identity', p: { ...fanslyIdentityWire, creatorId, accountMeSeen: creatorId !== null } });
const open = (identity: HostIdentity | null): HostIdentity => {
  if (identity === null) throw new Error('no identity');
  return identity;
};

describe('[host:fansly] who the tab is (FS-IDN-1, FS-IDN-2, FS-IDN-5)', () => {
  it('[UI-011] [AU-023] [AU-034] the initial binding: no account until the page’s /account/me, then exactly one — the creator, whose platform id is the hub page’s key', async () => {
    const main = scriptedMain({ 'fx.state': () => NO_ONE, 'fx.ack': () => null, 'fx.focus': () => null });
    const { port, events, page } = await startPort(`/messages/${GROUP}`, main.client);
    page.openChat(GROUP);
    await settle();
    // «Аккаунт не определён»: before the page's own answer there is no account and no identity — never a guess.
    expect(port.current()).toMatchObject({ kind: 'fansly-web', identity: null, accounts: [], route: { name: 'chat', account: null, chat: null, conversationRef: GROUP } });
    expect(port.listCachedAccounts()).toEqual([]);
    main.batch(1, identityEvent(CREATOR));
    const account = { host: 'fansly-web', hostAccountId: CREATOR, platform: 'fansly', platformAccountId: CREATOR, username: null, displayName: null };
    expect(port.current().accounts).toEqual([account]);
    expect(port.current().route.account).toEqual(account);
    expect(events.filter((event) => event.type === 'accounts')).toEqual([{ type: 'accounts', accounts: [account] }]);
    const first = open(port.identity());
    expect(HostIdentitySchema.parse(first)).toEqual({ host: 'fansly-web', documentEpoch: EPOCH, hostLoginEpoch: expect.any(String) as unknown, hostAccountId: CREATOR, platformAccountId: CREATOR, chat: null, routeEpoch: 1, composerInstanceId: null });
    expect(RouteStateSchema.parse(port.current().route)).toEqual(port.current().route);
    // Another creator signs in on the page: still one account, a new login epoch — the old identity matches nothing.
    main.batch(2, identityEvent(SECOND_CREATOR));
    expect(port.current().accounts).toEqual([{ ...account, hostAccountId: SECOND_CREATOR, platformAccountId: SECOND_CREATOR }]);
    expect(open(port.identity()).hostLoginEpoch).not.toBe(first.hostLoginEpoch);
    expect(main.asked('fx.ack')).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('[AI-122] [FS-IDN-3] the chat is known once MAIN names the group’s fan for this very route: until then it is «loading», a group chat has none', async () => {
    const main = scriptedMain({ 'fx.state': () => ({ ...NO_ONE, identity: fanslyIdentityWire }), 'fx.ack': () => null, 'fx.focus': () => null });
    const { port, events, page } = await startPort(`/messages/${GROUP}`, main.client);
    page.openChat(GROUP);
    await settle();
    // MAIN was asked to focus the route's group with the route's epoch.
    expect(main.asked('fx.focus')).toEqual([{ groupId: GROUP, routeEpoch: 1 }]);
    const chat = { host: 'fansly-web', hostAccountId: CREATOR, platformFanId: FAN } as const;
    expect(port.current().route.chat).toBeNull();
    expect(port.chatWindow(chat, 200)).toBeNull();
    expect(port.current().composer).toBeNull();
    main.batch(1, chatOf(GROUP, 1));
    expect(port.current().route).toEqual({ epoch: 1, name: 'chat', account: expect.objectContaining({ hostAccountId: CREATOR }) as unknown, chat, conversationRef: GROUP, conversationKind: 'direct' });
    expect(events.filter((event) => event.type === 'route').at(-1)).toEqual({ type: 'route', route: port.current().route });
    expect(port.chatWindow(chat, 200)).toEqual({
      chat,
      state: 'ready',
      loaded: 4,
      fanMessages: 0,
      modelMessages: 0,
      lastFanMessageId: null,
      lastFanMessageAt: null,
      lastModelMessageAt: null,
      hasOlder: false,
      fanScript: 'cyrillic',
      newestAt: fanslyChatWire.window.newestAt,
    });
    expect(port.fan(chat)).toMatchObject({ chat, canReceiveMessages: true, username: null });
    // The composer of the open chat: its field under the route, a token of its own, the draft's revision.
    expect(port.current().composer).toEqual({ chat, instanceId: expect.any(String) as unknown, ready: true, hidden: false, draft: { revision: 0, provenance: 'empty' } });
    expect(open(port.identity()).composerInstanceId).toBe(port.current().composer?.instanceId);
    // The window moves: the dock hears `chatCache`.
    main.batch(2, chatOf(GROUP, 1, { window: { ...fanslyChatWire.window, loaded: 5 } }));
    expect(events.at(-1)).toEqual({ type: 'chatCache', chat });
    // The members change: a group chat — no fan, no chat, no AI.
    main.batch(3, chatOf(GROUP, 1, { kind: 'group', fanId: null }));
    expect(port.current().route).toMatchObject({ chat: null, conversationKind: 'group' });
    expect(port.fansly.headerSlot()).toEqual({ state: 'none', reason: 'group' });
    expect(port.current().composer).toBeNull();
  });

  it('[AI-122] a MAIN that cannot observe chats yet (P7a: `fx.focus` is `not-ready`) leaves the chat unknown — the honest «not yet» — and says so in the report', async () => {
    const main = scriptedMain({ 'fx.state': () => ({ ...NO_ONE, identity: fanslyIdentityWire }), 'fx.ack': () => null });
    const { port, page } = await startPort(`/messages/${GROUP}`, main.client);
    page.openChat(GROUP);
    await settle();
    expect(main.asked('fx.focus')).toEqual([{ groupId: GROUP, routeEpoch: 1 }]);
    expect(port.current().route).toMatchObject({ name: 'chat', conversationRef: GROUP, chat: null });
    expect(port.probe().capabilities.chatWindow).toEqual({ state: 'off', reason: 'observation', code: 'CG-HOST-NOT-READY' });
    expect(port.probe().extensions['fansly-web'].capabilities.freshness).toEqual({ state: 'off', reason: 'observation', code: 'CG-HOST-NOT-READY' });
    expect(await port.freshness.snapshot({ host: 'fansly-web', hostAccountId: CREATOR, platformFanId: FAN }, { conversationRef: GROUP, feature: 'reply', window: 30, withText: true })).toBeNull();
    // The identity is there all the same: the creator came from /account/me.
    expect(port.identity()).toMatchObject({ hostAccountId: CREATOR, chat: null });
  });
});

describe('[host:fansly] epochs drop what came late (FS-RTE-4)', () => {
  it('[RB-015] [FS-RTE-4] A → B → A: every change of route is a new epoch and a new focus; MAIN’s answer of an older epoch — even of the same group — is dropped', async () => {
    const main = scriptedMain({ 'fx.state': () => ({ ...NO_ONE, identity: fanslyIdentityWire }), 'fx.ack': () => null, 'fx.focus': () => null });
    const { port, page } = await startPort('/messages', main.client);
    page.openChat(GROUP);
    await settle();
    page.openChat(OTHER);
    await settle();
    page.openChat(GROUP);
    await settle();
    expect(main.asked('fx.focus')).toEqual([
      { groupId: null, routeEpoch: 1 },
      { groupId: GROUP, routeEpoch: 2 },
      { groupId: OTHER, routeEpoch: 3 },
      { groupId: GROUP, routeEpoch: 4 },
    ]);
    // The answer to the first visit of A comes now, after B: A again, but another epoch — not taken.
    main.batch(1, chatOf(GROUP, 2));
    main.batch(2, chatOf(OTHER, 3));
    expect(port.current().route).toMatchObject({ epoch: 4, conversationRef: GROUP, chat: null });
    expect((await port.health()).isolated.staleChats).toBe(2);
    main.batch(3, chatOf(GROUP, 4));
    expect(port.current().route.chat).toEqual({ host: 'fansly-web', hostAccountId: CREATOR, platformFanId: FAN });
  });

  it('[RB-014] [FS-RTE-4] a read or a focus names the open chat — its document, login, route and field; another one is refused, and the address is verified first', async () => {
    const main = scriptedMain({ 'fx.state': () => ({ ...NO_ONE, identity: fanslyIdentityWire }), 'fx.ack': () => null, 'fx.focus': () => null });
    const { port, page, diagnostics } = await startPort(`/messages/${GROUP}`, main.client);
    page.openChat(GROUP);
    await settle();
    main.batch(1, chatOf(GROUP, 1));
    const field = page.textarea() as HTMLTextAreaElement;
    field.value = 'привет';
    field.dispatchEvent(new Event('input'));
    field.value = 'привет!';
    field.dispatchEvent(new Event('input'));
    const identity = open(port.identity());
    const draft = await port.readDraft(identity);
    expect(draft).toMatchObject({ identity, revision: 2, plainText: 'привет!', provenance: 'human-or-unknown' });
    expect(draft.digest).toMatch(/^[0-9a-f]{16}$/);
    expect(port.current().composer?.draft).toEqual({ revision: 2, provenance: 'human-or-unknown' });
    expect(await port.focusComposer(identity)).toBe(true);
    expect(document.activeElement).toBe(field);
    for (const other of [
      { ...identity, documentEpoch: 'doc2' },
      { ...identity, hostLoginEpoch: 'other' },
      { ...identity, routeEpoch: identity.routeEpoch + 1 },
      { ...identity, composerInstanceId: 'f999' },
      { ...identity, chat: { host: 'fansly-web', hostAccountId: CREATOR, platformFanId: '700000000000000099' } } as const,
    ]) {
      const refused = (await port.readDraft(other).catch((error: unknown) => error)) as BridgeCallError;
      expect([refused.failure, refused.executed]).toEqual(['identity-mismatch', 'no']);
      expect(await port.focusComposer(other)).toBe(false);
    }
    // The address moved with no signal at all: the read verifies it first, counts it, and the old identity is refused.
    page.silentPush(`/messages/${OTHER}`);
    const late = (await port.readDraft(identity).catch((error: unknown) => error)) as BridgeCallError;
    expect(late.failure).toBe('identity-mismatch');
    expect(diagnostics).toContainEqual({ event: 'route-unsignalled', detail: { via: 'ui', count: 1, chat: true } });
    expect(port.current().route).toMatchObject({ epoch: 2, conversationRef: OTHER, chat: null });
  });

  it('[RB-014] [FS-IDN-6] the freshness snapshot is the target’s own: its group, its creator and fan, this document, the function asked; page text only for a draft function', async () => {
    const snapshots: unknown[] = [];
    let answer: FanslySnapshot | null = { ...fanslyReplySnapshot, window: [...fanslyReplySnapshot.window], knownFanMessageIds: [...fanslyReplySnapshot.knownFanMessageIds], deletedIds: [...fanslyReplySnapshot.deletedIds], tail: [...fanslyReplySnapshot.tail] };
    const main = scriptedMain({
      'fx.state': () => ({ ...NO_ONE, identity: fanslyIdentityWire }),
      'fx.ack': () => null,
      'fx.focus': () => null,
      'fx.generationSnapshot': (payload: never) => {
        snapshots.push(payload);
        return answer;
      },
    });
    const { port } = await startPort(`/messages/${OTHER}`, main.client);
    const chat = { host: 'fansly-web', hostAccountId: CREATOR, platformFanId: FAN } as const;
    // A start for a chat the person is not looking at asks for ITS group, never the open route's.
    expect(await port.freshness.snapshot(chat, { conversationRef: GROUP, feature: 'reply', window: 30, withText: true })).toEqual(answer);
    // Recap reads no page text, whatever it asked for.
    answer = { ...answer, feature: 'recap', tail: undefined, truncated: false } as unknown as FanslySnapshot;
    delete (answer as { tail?: unknown }).tail;
    expect(await port.freshness.snapshot(chat, { conversationRef: GROUP, feature: 'recap', window: 60, withText: true })).toEqual(answer);
    expect(snapshots).toEqual([
      { groupId: GROUP, feature: 'reply', window: 30, withText: true },
      { groupId: GROUP, feature: 'recap', window: 60, withText: false },
    ]);
    // Anything not of this chat, document or function is no snapshot: «свежесть не проверена».
    expect(await port.freshness.snapshot(chat, { conversationRef: OTHER, feature: 'recap', window: 60, withText: false })).toBeNull();
    expect(await port.freshness.snapshot({ ...chat, platformFanId: '700000000000000099' }, { conversationRef: GROUP, feature: 'recap', window: 60, withText: false })).toBeNull();
    expect(await port.freshness.snapshot(chat, { conversationRef: GROUP, feature: 'review', window: 60, withText: false })).toBeNull();
    answer = { ...answer, epochs: { ...answer.epochs, document: 'doc0' } };
    expect(await port.freshness.snapshot(chat, { conversationRef: GROUP, feature: 'recap', window: 60, withText: false })).toBeNull();
    answer = null;
    expect(await port.freshness.snapshot(chat, { conversationRef: GROUP, feature: 'recap', window: 60, withText: false })).toBeNull();
    expect(await port.freshness.snapshot(chat, { conversationRef: GROUP, feature: 'recap', window: 0, withText: false })).toBeNull();
  });
});

describe('[host:fansly] the stream rebuilds the tab’s state (§6)', () => {
  it('[BG-002] every batch is acknowledged; a gap, a refused or a skipped batch makes the chat unknown at once and asks MAIN’s state whole again', async () => {
    let state: FanslyState = { ...fanslyState, chat: null, lastBatch: 3 };
    const main = scriptedMain({ 'fx.state': () => state, 'fx.ack': () => null, 'fx.focus': () => null });
    const { port, page, events, diagnostics } = await startPort(`/messages/${GROUP}`, main.client);
    page.openChat(GROUP);
    await settle();
    // The first state: everything whole, the batches before it acknowledged with it.
    expect(main.asked('fx.state')).toHaveLength(1);
    expect(main.asked('fx.ack')).toEqual([{ n: 3 }]);
    expect(port.probe().extensions['fansly-web'].anchors).toMatchObject(fanslyContractWire.anchors);
    main.batch(4, chatOf(GROUP, 1));
    const chat = port.current().route.chat;
    if (chat === null) throw new Error('no chat');
    expect(port.chatWindow(chat, 200)?.hasOlder).toBe(false);
    // MAIN stopped (its queue overflowed): unknown at once, then its state again.
    state = { ...state, chat: { ...fanslyChatWire, groupId: GROUP, routeEpoch: 1, window: { ...fanslyChatWire.window, completeness: 'unknown', startProven: false } }, lastBatch: 9 };
    main.gap();
    expect(events.at(-1)).toEqual({ type: 'chatCache', chat });
    await settle();
    expect(main.asked('fx.state')).toHaveLength(2);
    expect(main.asked('fx.ack').at(-1)).toEqual({ n: 9 });
    expect(port.chatWindow(chat, 200)?.hasOlder).toBeNull();
    // A batch its schemas refuse: acknowledged (MAIN frees its credit), nothing of it taken, the state asked again.
    main.refused(10);
    await settle();
    expect(main.asked('fx.ack').at(-1)).toEqual({ n: 10 });
    expect(main.asked('fx.state')).toHaveLength(3);
    // A batch that never came (refused before its schema): the next one says so by its number.
    main.batch(12, { t: 'fx.vaultAdded', p: { seq: 1 } });
    await settle();
    expect(main.asked('fx.state')).toHaveLength(4);
    expect(diagnostics.filter((d) => d.event === 'stream-lost').map((d) => d.detail?.['reason'])).toEqual(['gap', 'refused', 'skipped']);
    const health = await port.health();
    expect(health.isolated.stream).toMatchObject({ gaps: 1, refused: 1, skipped: 1, acked: 12, states: 4 });
    // MAIN's own counts, through `fx.health`, are null when it does not answer.
    expect(health.main).toBeNull();
  });

  it('[BG-002] a failed state is asked again at the page’s next signal, never on a timer; MAIN’s guarded failures are logged at 1, 2, 4…', async () => {
    let answering = false;
    const main = scriptedMain({ 'fx.state': () => (answering ? NO_ONE : Promise.reject(new BridgeCallError('timeout', 'fx.state'))), 'fx.ack': () => null, 'fx.focus': () => null });
    let clock = 1_000;
    const { port, page, diagnostics } = await startPort('/messages', main.client, () => clock);
    expect(diagnostics).toContainEqual({ event: 'state-failed', detail: { failure: 'timeout' } });
    await settle();
    expect(main.asked('fx.state')).toHaveLength(1);
    answering = true;
    // After its pause (it failed once: 250 ms), the next signal of the page asks again.
    clock += 300;
    page.openChat(GROUP);
    await settle();
    expect(main.asked('fx.state')).toHaveLength(2);
    expect(main.asked('fx.focus')).toEqual([{ groupId: GROUP, routeEpoch: 2 }]);
    main.fault('frame', 1);
    main.fault('frame', 1);
    main.fault('frame', 2);
    main.fault('frame', 3);
    expect(diagnostics.filter((d) => d.event === 'main-fault')).toEqual([
      { event: 'main-fault', code: 'CG-UNKNOWN', detail: { source: 'frame', count: 1 } },
      { event: 'main-fault', code: 'CG-UNKNOWN', detail: { source: 'frame', count: 2 } },
    ]);
    expect(port.current().route.conversationRef).toBe(GROUP);
  });
});

describe('[host:fansly] the vault’s facts for the uploader (§7.11, P13a)', () => {
  it('[AU-036] [VA-006] an addition and an album load go to whoever listens, in order; the album the page loaded last is kept for this address only', async () => {
    const main = scriptedMain({ 'fx.state': () => ({ ...NO_ONE, lastBatch: 0 }), 'fx.ack': () => null, 'fx.focus': () => null });
    const { port, page } = await startPort('/creator/vault', main.client);
    const heard: unknown[] = [];
    expect(port.vault.album()).toBeNull();
    main.batch(1, { t: 'fx.vaultLoaded', p: { albumId: '700000000000000301', seq: 4 } });
    const off = port.vault.onFact((fact) => heard.push(fact));
    main.batch(2, { t: 'fx.vaultAdded', p: { seq: 7 } }, { t: 'fx.vaultLoaded', p: { albumId: '700000000000000301', seq: 8 } });
    expect(heard).toEqual([
      { t: 'fx.vaultAdded', p: { seq: 7 } },
      { t: 'fx.vaultLoaded', p: { albumId: '700000000000000301', seq: 8 } },
    ]);
    expect(port.vault.album()).toEqual({ albumId: '700000000000000301', seq: 8 });
    // A type album («Posts») has no id.
    main.batch(3, { t: 'fx.vaultLoaded', p: { albumId: null, seq: 9 } });
    expect(port.vault.album()).toEqual({ albumId: null, seq: 9 });
    // Another address: the page shows no album there until it loads one.
    main.batch(4, { t: 'fx.vaultLoaded', p: { albumId: '700000000000000302', seq: 10 } });
    page.openInbox();
    await settle();
    expect(port.vault.album()).toBeNull();
    expect(heard).toHaveLength(4);
    // Nobody listens: acknowledged with its batch, said to no one.
    off();
    main.batch(5, { t: 'fx.vaultAdded', p: { seq: 11 } });
    expect(heard).toHaveLength(4);
    expect(main.asked('fx.ack').at(-1)).toEqual({ n: 5 });
  });
});

describe('[host:fansly] the contract and its degradation (FS-CTR-1, FS-CTR-2)', () => {
  it('[ER-048] [AU-030] [FS-CTR-2] without MAIN the port still answers: nothing of the page’s memory, every part that needs it off with «хост не подключён», no write', async () => {
    const { port, page } = await startPort(`/messages/${GROUP}`, null);
    page.openChat(GROUP);
    await settle();
    const report = port.probe();
    expect(FanslyContractReportSchema.parse(report)).toEqual(report);
    expect(report.capabilities.identity).toEqual({ state: 'off', reason: 'bridge', code: 'CG-HOST-NOT-READY' });
    expect(report.capabilities.chatWindow).toEqual({ state: 'off', reason: 'bridge', code: 'CG-HOST-NOT-READY' });
    expect(report.capabilities.route).toEqual({ state: 'on' });
    expect(report.extensions['fansly-web'].anchors).toMatchObject({ accountMe: 'missing', socket: 'missing', frames: 'missing', xhr: 'missing', conversationRoute: 'ok', container: 'ok', textarea: 'ok' });
    expect(port.current()).toMatchObject({ identity: null, accounts: [], route: { name: 'chat', conversationRef: GROUP, chat: null } });
    const identity = { host: 'fansly-web', documentEpoch: EPOCH, hostLoginEpoch: 'fansly-1', hostAccountId: CREATOR, platformAccountId: CREATOR, chat: null, routeEpoch: 1, composerInstanceId: null } as const;
    const refused = (await port.readDraft(identity).catch((error: unknown) => error)) as BridgeCallError;
    expect(refused.failure).toBe('not-ready');
    expect(await port.freshness.snapshot({ host: 'fansly-web', hostAccountId: CREATOR, platformFanId: FAN }, { conversationRef: GROUP, feature: 'reply', window: 10, withText: true })).toBeNull();
    expect(await port.readVisibleTail(identity, 10)).toBeNull();
    expect(await port.checkpoint({ host: 'fansly-web', hostAccountId: CREATOR, platformFanId: FAN })).toBeNull();
    expect(port.previewSend).toBeNull();
    expect(port.listCachedChats(CREATOR, 10)).toEqual([]);
  });

  it('[FS-CTR-1] the report has Fansly’s shape: every shared capability and every anchor and capability of its own block, as its strict schema and the shared one accept', async () => {
    const main = scriptedMain({ 'fx.state': () => ({ ...fanslyState, chat: null }), 'fx.ack': () => null, 'fx.focus': () => null });
    const { port, page } = await startPort(`/messages/${GROUP}`, main.client);
    const reports: unknown[] = [];
    port.onContract((report) => reports.push(report));
    page.openChat(GROUP, { copyOnly: true });
    await settle();
    const report = port.probe();
    expect(FanslyContractReportSchema.parse(report)).toEqual(report);
    expect(HostContractReportSchema.parse(report)).toEqual(report);
    expect(Object.keys(report.extensions['fansly-web'].anchors).sort()).toEqual([...FANSLY_CONTRACT.anchors].sort());
    expect(report).toMatchObject({ host: 'fansly-web', adapterVersion: '0.1.0', build: null });
    expect(report.capabilities.identity).toEqual({ state: 'on' });
    expect(report.capabilities.chatWindow).toEqual({ state: 'on' });
    expect(report.extensions['fansly-web'].capabilities.follows).toEqual({ state: 'on' });
    expect(report.extensions['fansly-web'].anchors.noDmAllowed).toBe('ok');
    // A change of the report is said; the same report again is not.
    expect(reports.length).toBeGreaterThan(0);
    const said = reports.length;
    await port.recheck();
    expect(reports).toHaveLength(said);
    // The copy-only branch of the composer is the composer state's `hidden` once the chat is known.
    main.batch(18, chatOf(GROUP, 1));
    expect(port.current().composer?.hidden).toBe(true);
  });

  it('[FS-IDN-4] a MAIN that came after the page began (installed under an open tab) asks the person to reload — said to a subscriber that comes later too', async () => {
    const main = scriptedMain({ 'fx.state': () => NO_ONE, 'fx.ack': () => null });
    (main.client as { probe: () => Promise<unknown> }).probe = () => Promise.resolve({ ...PROBE, readyStateAtStart: 'interactive' });
    const { port, diagnostics } = await startPort('/messages', main.client);
    expect(diagnostics).toContainEqual({ event: 'late-start', detail: { startReadyState: 'interactive' } });
    const later: HostEvent[] = [];
    port.subscribe((event) => later.push(event));
    await settle();
    expect(later).toEqual([{ type: 'reloadNeeded' }]);
  });
});

describe('[host:fansly] what the port holds belongs to its route, its creator and its life (review of P7c)', () => {
  const mainFor = (extra: Partial<Record<string, Answer>> = {}) => scriptedMain({ 'fx.state': () => ({ ...NO_ONE, identity: fanslyIdentityWire }), 'fx.ack': () => null, 'fx.focus': () => null, ...extra });
  const chat = (fanId: string = FAN, creatorId: string = CREATOR) => ({ host: 'fansly-web', hostAccountId: creatorId, platformFanId: fanId }) as const;

  it('[RB-014] [FS-RTE-4] back or forward: the address moves before Fansly replaces the conversation — the field still on the page is the old chat’s, never the new one’s, even once MAIN names the new fan', async () => {
    const main = mainFor();
    const { port, page } = await startPort(`/messages/${GROUP}`, main.client);
    page.openChat(GROUP);
    await settle();
    main.batch(1, chatOf(GROUP, 1));
    const fieldA = page.textarea() as HTMLTextAreaElement;
    fieldA.value = 'draft for fan A';
    fieldA.dispatchEvent(new Event('input'));
    const first = port.current().composer;
    expect(first?.chat).toEqual(chat());
    // `popstate`: the address is OTHER's now, the DOM still A's — and MAIN already names OTHER's fan for the new epoch.
    const moved = page.popTo(`/messages/${OTHER}`);
    main.batch(2, chatOf(OTHER, 2, { fanId: '700000000000000099' }));
    expect(port.current().route).toMatchObject({ epoch: 2, conversationRef: OTHER, chat: chat('700000000000000099') });
    expect(page.textarea()).toBe(fieldA);
    expect(port.current().composer).toBeNull();
    const identity = open(port.identity());
    expect(identity.composerInstanceId).toBeNull();
    const refused = (await port.readDraft({ ...identity, composerInstanceId: first?.instanceId ?? null }).catch((error: unknown) => error)) as BridgeCallError;
    expect(refused.failure).toBe('identity-mismatch');
    expect(await port.focusComposer({ ...identity, composerInstanceId: first?.instanceId ?? null })).toBe(false);
    // Fansly renders OTHER's conversation: its own field, a new instance.
    await moved;
    await settle();
    const second = port.current().composer;
    expect(second).toMatchObject({ chat: chat('700000000000000099'), draft: { provenance: 'empty' } });
    expect(second?.instanceId).not.toBe(first?.instanceId);
    expect((await port.readDraft(open(port.identity()))).plainText).toBe('');
  });

  it('[AU-034] [FS-RTE-4] another creator signs in on the page: the old creator’s chat and window go at once, MAIN is asked to focus again, and only its new answer names the chat', async () => {
    const main = mainFor();
    const { port, page } = await startPort(`/messages/${GROUP}`, main.client);
    page.openChat(GROUP);
    await settle();
    main.batch(1, chatOf(GROUP, 1));
    expect(port.current().route.chat).toEqual(chat());
    main.batch(2, identityEvent(SECOND_CREATOR));
    await settle();
    // Another creator is a new generation: a new route epoch on the same address, focused anew.
    expect(port.current().route).toMatchObject({ epoch: 2, conversationRef: GROUP, chat: null });
    expect(port.current().route.conversationKind).toBeUndefined();
    expect(port.chatWindow(chat(FAN, SECOND_CREATOR), 200)).toBeNull();
    expect(port.current().composer).toBeNull();
    expect(main.asked('fx.focus')).toEqual([
      { groupId: GROUP, routeEpoch: 1 },
      { groupId: GROUP, routeEpoch: 2 },
    ]);
    main.batch(3, chatOf(GROUP, 2));
    expect(port.current().route.chat).toEqual(chat(FAN, SECOND_CREATOR));
  });

  it('[FS-RTE-2] [FS-RTE-4] back from the back-forward cache: a snapshot asked before is no answer after, the chat held is gone until MAIN names it again, and MAIN’s state is asked again', async () => {
    let release: (snapshot: unknown) => void = () => undefined;
    const main = mainFor({ 'fx.generationSnapshot': () => new Promise((resolve) => (release = resolve)) });
    const { port, page, events } = await startPort(`/messages/${GROUP}`, main.client);
    page.openChat(GROUP);
    await settle();
    main.batch(1, chatOf(GROUP, 1, { window: { ...fanslyChatWire.window, completeness: 'complete', startProven: true } }));
    expect(port.chatWindow(chat(), 200)?.hasOlder).toBe(false);
    const asked = port.freshness.snapshot(chat(), { conversationRef: GROUP, feature: 'reply', window: 30, withText: true });
    await settle();
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    // The same address, a new life (a new route epoch): what was held is gone, and the state is asked again.
    expect(port.chatWindow(chat(), 200)).toBeNull();
    expect(events.filter((event) => event.type === 'route').at(-1)).toMatchObject({ route: { epoch: 2, chat: null } });
    await settle();
    expect(main.asked('fx.state')).toHaveLength(2);
    release({ ...fanslyReplySnapshot, identity: { creatorId: CREATOR, groupId: GROUP, fanId: FAN }, epochs: { ...fanslyReplySnapshot.epochs, document: EPOCH } });
    expect(await asked).toBeNull();
  });

  it('[BG-002] a recovery that failed is asked again at the next signal of the page — a chat switch, an action of ours — however many states were taken before', async () => {
    let answering = true;
    const main = mainFor({ 'fx.state': () => (answering ? { ...NO_ONE, identity: fanslyIdentityWire } : Promise.reject(new BridgeCallError('timeout', 'fx.state'))) });
    let clock = 1_000;
    const { port, page } = await startPort(`/messages/${GROUP}`, main.client, () => clock);
    page.openChat(GROUP);
    await settle();
    expect(main.asked('fx.state')).toHaveLength(1);
    answering = false;
    main.gap();
    await settle();
    expect(main.asked('fx.state')).toHaveLength(2);
    // MAIN stays stopped until a state is taken: the next chat asks again, once the pause after the failure is over.
    clock += 300;
    page.openChat(OTHER);
    await settle();
    expect(main.asked('fx.state')).toHaveLength(3);
    // And so does an action of our UI (the pause doubled after the second failure).
    clock += 600;
    await port.readDraft(open(port.identity())).catch(() => undefined);
    await settle();
    expect(main.asked('fx.state')).toHaveLength(4);
    answering = true;
    clock += 1_200;
    page.openChat(GROUP);
    await settle();
    expect(main.asked('fx.state')).toHaveLength(5);
    // Taken: nothing more is asked.
    page.openChat(OTHER);
    await settle();
    expect(main.asked('fx.state')).toHaveLength(5);
  });

  it('[BG-002] MAIN’s state replaces what the port holds: a chat MAIN no longer names is gone, a window that changed is said', async () => {
    let state: FanslyState = { ...NO_ONE, identity: fanslyIdentityWire };
    const main = mainFor({ 'fx.state': () => state });
    const { port, page, events } = await startPort(`/messages/${GROUP}`, main.client);
    page.openChat(GROUP);
    await settle();
    main.batch(1, chatOf(GROUP, 1));
    expect(port.chatWindow(chat(), 200)?.loaded).toBe(4);
    // The recovery's state names the same chat with another window: the dock hears `chatCache` with it.
    const heard: Array<number | null> = [];
    port.subscribe((event) => event.type === 'chatCache' && heard.push(port.chatWindow(event.chat, 200)?.loaded ?? null));
    state = { ...state, chat: { ...fanslyChatWire, groupId: GROUP, routeEpoch: 1, window: { ...fanslyChatWire.window, loaded: 9 } } };
    main.gap();
    await settle();
    expect(port.chatWindow(chat(), 200)?.loaded).toBe(9);
    expect(heard.at(-1)).toBe(9);
    // MAIN no longer names the chat: it is gone, and the route says so.
    state = { ...state, chat: null };
    main.gap();
    await settle();
    expect(port.current().route.chat).toBeNull();
    expect(port.chatWindow(chat(), 200)).toBeNull();
    expect(events.filter((event) => event.type === 'route').at(-1)).toMatchObject({ route: { chat: null } });
  });

  it('[BG-002] a loss of the stream withdraws a proven start at once: no window claims the whole history until MAIN says so again', async () => {
    const proven = mainFor();
    const { port, page } = await startPort(`/messages/${GROUP}`, proven.client);
    page.openChat(GROUP);
    await settle();
    proven.batch(1, chatOf(GROUP, 1, { window: { ...fanslyChatWire.window, completeness: 'complete', startProven: true } }));
    expect(port.chatWindow(chat(), 200)?.hasOlder).toBe(false);
    proven.gap();
    expect(port.chatWindow(chat(), 200)).toMatchObject({ state: 'ready', hasOlder: null });
  });
});

describe('[host:fansly] every asynchronous answer is taken under the generation it was asked in (review of P7c, round 2)', () => {
  /**
   * The generation: the page's life, the route and the creator, one token taken when a request leaves. Each path —
   * MAIN's state, its chat, the generation snapshot, the field's draft — is asked under one generation, the generation
   * moves (another chat, another creator, a return from bfcache), and the late answer must change nothing.
   */
  type Change = 'route' | 'creator' | 'bfcache';
  const CHANGES: readonly Change[] = ['route', 'creator', 'bfcache'];
  const B_FAN = '700000000000000099';
  const chatRef = (fanId: string = FAN, creatorId: string = CREATOR) => ({ host: 'fansly-web', hostAccountId: creatorId, platformFanId: fanId }) as const;

  interface World {
    readonly port: FanslyPort;
    readonly page: FakeFanslyPage;
    readonly main: ReturnType<typeof scriptedMain>;
    /** Resolves the request of a type that waits (the deferred ones). */
    readonly release: (t: string, value: unknown) => void;
    next: number;
  }

  /** The port on chat A, its fan named for epoch 1; the requests named in `deferred` wait for `release` (after the first state). */
  async function onChatA(deferred: readonly string[] = []): Promise<World> {
    const waiting = new Map<string, (value: unknown) => void>();
    let states = 0;
    const later = (t: string) => () => new Promise((resolve) => waiting.set(t, resolve));
    const main = scriptedMain({
      'fx.state': () => (deferred.includes('fx.state') && states++ > 0 ? later('fx.state')() : { ...NO_ONE, identity: fanslyIdentityWire }),
      'fx.ack': () => null,
      'fx.focus': () => null,
      'fx.generationSnapshot': later('fx.generationSnapshot'),
    });
    const { port, page } = await startPort(`/messages/${GROUP}`, main.client);
    page.openChat(GROUP);
    await settle();
    main.batch(1, chatOf(GROUP, 1));
    expect(port.current().route).toMatchObject({ epoch: 1, chat: chatRef() });
    return {
      port,
      page,
      main,
      next: 2,
      release: (t, value) => {
        const resolve = waiting.get(t);
        if (resolve === undefined) throw new Error(`nothing of ${t} waits`);
        waiting.delete(t);
        resolve(value);
      },
    };
  }

  /** Moves the generation; afterwards what the route's chat must be (MAIN named B's fan for a route change). */
  async function change(world: World, kind: Change): Promise<ReturnType<typeof chatRef> | null> {
    if (kind === 'route') {
      world.page.openChat(OTHER);
      await settle();
      const epoch = world.port.current().route.epoch;
      world.main.batch(world.next++, chatOf(OTHER, epoch, { fanId: B_FAN }));
      return chatRef(B_FAN);
    }
    if (kind === 'creator') {
      world.main.batch(world.next++, identityEvent(SECOND_CREATOR));
      await settle();
      return null;
    }
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    await settle();
    return null;
  }

  for (const kind of CHANGES) {
    it(`[FS-RTE-4] [BG-002] MAIN’s state asked before ${kind === 'route' ? 'a chat switch' : kind === 'creator' ? 'another creator' : 'a return from bfcache'} is discarded whole when it lands, and asked again`, async () => {
      const world = await onChatA(['fx.state']);
      world.main.gap();
      await settle();
      expect(world.main.asked('fx.state')).toHaveLength(2);
      const after = await change(world, kind);
      const route = world.port.current().route;
      // The old answer: chat A for epoch 1, the first creator.
      world.release('fx.state', { ...NO_ONE, identity: fanslyIdentityWire, chat: { ...fanslyChatWire, groupId: GROUP, routeEpoch: 1 } });
      await settle();
      expect(world.port.current().route).toEqual(route);
      expect(world.port.current().route.chat).toEqual(after);
      expect(world.main.asked('fx.state')).toHaveLength(3);
    });

    it(`[FS-RTE-4] MAIN’s chat named for the epoch before ${kind === 'route' ? 'a chat switch' : kind === 'creator' ? 'another creator' : 'a return from bfcache'} is dropped, and the route is focused under a new epoch`, async () => {
      const world = await onChatA();
      const focusesBefore = world.main.asked('fx.focus').length;
      const after = await change(world, kind);
      const epoch = world.port.current().route.epoch;
      expect(epoch).toBeGreaterThan(1);
      expect(world.main.asked('fx.focus').slice(focusesBefore)).toContainEqual({ groupId: kind === 'route' ? OTHER : GROUP, routeEpoch: epoch });
      world.main.batch(world.next++, chatOf(GROUP, 1));
      expect(world.port.current().route.chat).toEqual(after);
      expect(world.port.current().route.epoch).toBe(epoch);
      if (after === null) expect(world.port.current().composer).toBeNull();
    });

    it(`[FS-RTE-4] [FS-TAIL-7] a snapshot asked before ${kind === 'route' ? 'a chat switch' : kind === 'creator' ? 'another creator' : 'a return from bfcache'} is no answer after it`, async () => {
      const world = await onChatA();
      const asked = world.port.freshness.snapshot(chatRef(), { conversationRef: GROUP, feature: 'reply', window: 30, withText: true });
      await settle();
      await change(world, kind);
      world.release('fx.generationSnapshot', { ...fanslyReplySnapshot, identity: { creatorId: CREATOR, groupId: GROUP, fanId: FAN }, epochs: { ...fanslyReplySnapshot.epochs, document: EPOCH } });
      expect(await asked).toBeNull();
    });

    it(`[RB-014] [FS-RTE-4] a draft read under the identity of before ${kind === 'route' ? 'a chat switch' : kind === 'creator' ? 'another creator' : 'a return from bfcache'} is refused`, async () => {
      const world = await onChatA();
      const field = world.page.textarea() as HTMLTextAreaElement;
      field.value = 'draft for fan A';
      field.dispatchEvent(new Event('input'));
      const before = open(world.port.identity());
      expect((await world.port.readDraft(before)).plainText).toBe('draft for fan A');
      await change(world, kind);
      const refused = (await world.port.readDraft(before).catch((error: unknown) => error)) as BridgeCallError;
      expect(refused.failure).toBe('identity-mismatch');
      expect(await world.port.focusComposer(before)).toBe(false);
    });
  }

  it('[AU-034] [FS-RTE-4] another creator on the same address: a late fx.chat of the first creator names nothing, and the field is not the new creator’s until MAIN names its fan', async () => {
    const world = await onChatA();
    const field = world.page.textarea() as HTMLTextAreaElement;
    field.value = 'draft for fan A';
    field.dispatchEvent(new Event('input'));
    world.main.batch(world.next++, identityEvent(SECOND_CREATOR));
    await settle();
    world.main.batch(world.next++, chatOf(GROUP, 1));
    expect(world.port.current().route.chat).toBeNull();
    expect(world.port.current().composer).toBeNull();
    const identity = open(world.port.identity());
    expect((await world.port.readDraft({ ...identity, composerInstanceId: 'f1' }).catch((error: unknown) => error)) as BridgeCallError).toMatchObject({ failure: 'identity-mismatch' });
  });

  it('[BG-002] a state that keeps failing is asked again with a growing pause: many actions in a row make a few asks, never one each', async () => {
    let clock = 1_000;
    let answering = true;
    const main = scriptedMain({ 'fx.state': () => (answering ? { ...NO_ONE, identity: fanslyIdentityWire } : Promise.reject(new BridgeCallError('timeout', 'fx.state'))), 'fx.ack': () => null, 'fx.focus': () => null });
    const { port, page } = await startPort(`/messages/${GROUP}`, main.client, () => clock);
    page.openChat(GROUP);
    await settle();
    answering = false;
    main.gap();
    await settle();
    const asks = (): number => main.asked('fx.state').length;
    expect(asks()).toBe(2);
    const identity = port.identity() as HostIdentity;
    // 25 actions within one pause: no ask at all.
    for (let i = 0; i < 25; i += 1) await port.readDraft(identity).catch(() => undefined);
    await settle();
    expect(asks()).toBe(2);
    // The pause passes: one ask; it fails, the next pause is longer.
    clock += 300;
    for (let i = 0; i < 25; i += 1) await port.readDraft(identity).catch(() => undefined);
    await settle();
    expect(asks()).toBe(3);
    clock += 300;
    await port.readDraft(identity).catch(() => undefined);
    await settle();
    expect(asks()).toBe(3);
    clock += 300;
    await port.readDraft(identity).catch(() => undefined);
    await settle();
    expect(asks()).toBe(4);
    // Never longer than a few seconds.
    for (let i = 0; i < 6; i += 1) {
      clock += 5_000;
      await port.readDraft(identity).catch(() => undefined);
      await settle();
    }
    expect(asks()).toBe(10);
    // Taken: the pause is over, nothing is owed.
    answering = true;
    clock += 5_000;
    page.openChat(OTHER);
    await settle();
    expect(asks()).toBe(11);
    page.openChat(GROUP);
    await settle();
    expect(asks()).toBe(11);
  });
});

describe('[host:fansly] the binding and the moment of consumption (review of P7c, round 3)', () => {
  const chat = (fanId: string = FAN, creatorId: string = CREATOR) => ({ host: 'fansly-web', hostAccountId: creatorId, platformFanId: fanId }) as const;

  it('[UI-011] [AI-122] a field rendered before MAIN’s first state is the first creator’s: the initial binding is no change of creator', async () => {
    const main = scriptedMain({ 'fx.state': () => ({ ...NO_ONE, identity: fanslyIdentityWire }), 'fx.ack': () => null, 'fx.focus': () => null });
    const { port, page } = await startPort(`/messages/${GROUP}`, main.client, undefined, (shown) => shown.openChat(GROUP));
    await settle();
    main.batch(1, chatOf(GROUP, 1));
    expect(port.current().composer).toMatchObject({ chat: chat(), ready: true });
    const field = page.textarea() as HTMLTextAreaElement;
    field.value = 'hello';
    field.dispatchEvent(new Event('input'));
    expect((await port.readDraft(open(port.identity()))).plainText).toBe('hello');
  });

  it('[UI-011] [AI-122] a field rendered before the page’s /account/me is the creator’s it names: the identity event binds, it does not change', async () => {
    const main = scriptedMain({ 'fx.state': () => NO_ONE, 'fx.ack': () => null, 'fx.focus': () => null });
    const { port } = await startPort(`/messages/${GROUP}`, main.client, undefined, (shown) => shown.openChat(GROUP));
    await settle();
    expect(port.current().composer).toBeNull();
    main.batch(1, identityEvent(CREATOR));
    main.batch(2, chatOf(GROUP, 1));
    expect(port.current().route.epoch).toBe(1);
    expect(port.current().composer).toMatchObject({ chat: chat(), ready: true });
    expect((await port.readDraft(open(port.identity()))).identity.chat).toEqual(chat());
    // A real change after it still takes the field away: it was the first creator's.
    main.batch(3, identityEvent(SECOND_CREATOR));
    main.batch(4, chatOf(GROUP, 2));
    expect(port.current().route.chat).toEqual(chat(FAN, SECOND_CREATOR));
    expect(port.current().composer).toBeNull();
  });

  it('[FS-RTE-4] [FS-TAIL-7] a snapshot is checked when it is handed over, not when it lands: a switch between the two makes it no answer', async () => {
    let release: (snapshot: unknown) => void = () => undefined;
    const main = scriptedMain({
      'fx.state': () => ({ ...NO_ONE, identity: fanslyIdentityWire }),
      'fx.ack': () => null,
      'fx.focus': () => null,
      'fx.generationSnapshot': () => new Promise((resolve) => (release = resolve)),
    });
    const { port, page } = await startPort(`/messages/${GROUP}`, main.client);
    page.openChat(GROUP);
    await settle();
    main.batch(1, chatOf(GROUP, 1));
    const identity = open(port.identity());
    const asked = port.freshness.snapshot(chat(), { conversationRef: GROUP, feature: 'reply', window: 30, withText: true });
    await settle();
    // The answer lands, and in the very next turn — before the port hands it over — the person is in another chat.
    release({ ...fanslyReplySnapshot, identity: { creatorId: CREATOR, groupId: GROUP, fanId: FAN }, epochs: { ...fanslyReplySnapshot.epochs, document: EPOCH } });
    queueMicrotask(() => {
      history.pushState({}, '', `/messages/${OTHER}`);
      void port.focusComposer(identity);
    });
    expect(await asked).toBeNull();
    expect(port.current().route).toMatchObject({ epoch: 2, conversationRef: OTHER });
  });

  it('[FS-CTR-2] MAIN’s answer to a focus of an older generation changes nothing: a late refusal does not take back what a newer answer said', async () => {
    const answers: Array<{ resolve: (value: null) => void; reject: (error: unknown) => void }> = [];
    const main = scriptedMain({
      'fx.state': () => ({ ...NO_ONE, identity: fanslyIdentityWire }),
      'fx.ack': () => null,
      'fx.focus': () => new Promise((resolve, reject) => answers.push({ resolve, reject })),
    });
    const { port, page } = await startPort(`/messages/${GROUP}`, main.client);
    page.openChat(OTHER);
    await settle();
    expect(answers).toHaveLength(2);
    // The newer focus answers: MAIN observes chats.
    answers[1]?.resolve(null);
    await settle();
    expect(port.probe().capabilities.chatWindow).toEqual({ state: 'on' });
    // The older one refuses late, as a MAIN that could not: of another generation, it is not heard.
    answers[0]?.reject(new BridgeCallError('not-ready', 'fx.focus'));
    await settle();
    expect(port.probe().capabilities.chatWindow).toEqual({ state: 'on' });
  });
});

// ── Over the real MAIN of P7a ────────────────────────────────────────────

/** The page's XHR as the natives look (Node has none): `send()` fires `loadstart`, `respond` `load` and `loadend`. */
class PageXhr extends EventTarget {
  static readonly DONE = 4;
  responseURL = '';
  status = 0;
  responseType: XMLHttpRequestResponseType = '';
  responseText = '';
  private address = '';
  open(_method: string, url: string): void {
    this.address = url;
  }
  send(): void {
    this.dispatchEvent(new Event('loadstart'));
  }
  respond(status: number, body: string): void {
    this.responseURL = this.address;
    this.status = status;
    this.responseText = body;
    this.dispatchEvent(new Event('load'));
    this.dispatchEvent(new Event('loadend'));
  }
}

/**
 * A window over happy-dom's document for both worlds: MAIN's natives are fakes with the natives' shape, its messaging
 * goes over Node's MessageChannel with `source` set (happy-dom sets none), and its listeners are kept by type.
 */
function pageWindow(): Window {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const of = (type: string): Set<(event: unknown) => void> => {
    let set = listeners.get(type);
    if (set === undefined) listeners.set(type, (set = new Set()));
    return set;
  };
  const win = {
    get location() {
      return window.location;
    },
    document,
    performance,
    crypto,
    URL,
    EventTarget,
    WebSocket: class WebSocket extends EventTarget {},
    XMLHttpRequest: PageXhr,
    setTimeout: (callback: () => void, ms?: number) => setTimeout(callback, ms),
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
    addEventListener: (type: string, listener: (event: unknown) => void) => of(type).add(listener),
    removeEventListener: (type: string, listener: (event: unknown) => void) => of(type).delete(listener),
    dispatchEvent: (event: Event) => {
      for (const listener of [...of(event.type)]) listener(event);
      return true;
    },
    postMessage(data: unknown, _origin: string, transfer: MessagePort[] = []) {
      const event = { source: win, data: structuredClone(data), ports: transfer };
      setTimeout(() => {
        for (const listener of [...of('message')]) listener(event);
      }, 0);
    },
  };
  return win as unknown as Window;
}

describe('[host:fansly] the port over the real MAIN', () => {
  it('[BG-002] [UI-011] [AI-122] the start: MAIN’s first state, its /account/me as the tab’s account, every batch acknowledged; the group’s fan from the page’s own answer once MAIN observes chats (P7b), honestly unknown while it cannot', async () => {
    history.replaceState({}, '', '/messages');
    const page = createFakeFanslyPage();
    const win = pageWindow();
    // MAIN at document_start: the page has not begun.
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
    const main = installFanslyMain(win, { socketHosts: ['wsv3.fansly.com'], apiOrigins: ['https://apiv3.fansly.com'] });
    Reflect.deleteProperty(document, 'readyState');
    const diagnostics: FanslyDiagnostic[] = [];
    const started = startFanslyHost({ win, validation: loadValidation, redeem: NO_TOKEN, handshakeTimeoutMs: 1000, onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) });
    const port = await started.host;
    cleanups.push(() => port.dispose(), () => main.dispose(), () => page.destroy(), () => void started.bridge.then((bridge) => bridge?.close()));
    /** The page's own request and its answer, as Fansly's API gives it. */
    const answer = (path: string, response: unknown): void => {
      const xhr = new (win as unknown as { XMLHttpRequest: typeof PageXhr }).XMLHttpRequest();
      xhr.open('GET', `https://apiv3.fansly.com/api/v1${path}`);
      xhr.send();
      xhr.respond(200, JSON.stringify({ success: true, response }));
    };
    const until = async (done: () => boolean): Promise<void> => {
      for (let i = 0; i < 10 && !done(); i += 1) await settle();
    };
    page.openChat(GROUP);
    await settle();
    expect(port.current()).toMatchObject({ identity: null, accounts: [], route: { name: 'chat', conversationRef: GROUP, chat: null } });
    // The page's own /account/me: MAIN reads its creator, the port takes it from the stream and acknowledges the batch.
    answer('/account/me?ngsw-bypass=true', { account: { id: CREATOR } });
    await until(() => port.current().accounts.length > 0 && port.probe().capabilities.chatWindow.reason !== 'focus');
    expect(port.current().accounts).toEqual([{ host: 'fansly-web', hostAccountId: CREATOR, platform: 'fansly', platformAccountId: CREATOR, username: null, displayName: null }]);
    expect(port.identity()).toMatchObject({ host: 'fansly-web', documentEpoch: main.documentEpoch, hostAccountId: CREATOR, platformAccountId: CREATOR, chat: null });
    // Until MAIN names the group's fan, the chat is unknown — «чат ещё грузится».
    expect(port.current().route.chat).toBeNull();
    // The page's own `GET /group/<id>/`: the group's one fan.
    answer(`/group/${GROUP}/`, {
      id: GROUP,
      type: 1,
      groupFlags: 0,
      createdBy: CREATOR,
      users: [CREATOR, FAN].map((userId) => ({ groupId: GROUP, userId, type: 0, permissionFlags: 0 })),
      lastMessage: null,
      dmPermissionFlags: [],
      accountDmPermissionFlags: { flags: 0, metadata: '{}' },
    });
    const chat = { host: 'fansly-web', hostAccountId: CREATOR, platformFanId: FAN } as const;
    // Whether MAIN observes chats is its own word, its answer to the focus: P7a's says `not-ready`, from P7b on it does.
    if (port.probe().capabilities.chatWindow.state === 'on') {
      await until(() => port.current().route.chat !== null);
      expect(port.current().route).toMatchObject({ epoch: 2, conversationRef: GROUP, conversationKind: 'direct', chat });
      expect(port.chatWindow(chat, 200)).toMatchObject({ chat, state: 'ready' });
      expect(port.current().composer).toMatchObject({ chat, ready: true, hidden: false });
      expect(port.fansly.headerSlot()).toEqual({ state: 'ready', groupId: GROUP, fanId: FAN });
      // The target's snapshot through the port: its own group, creator and fan.
      expect(await port.freshness.snapshot(chat, { conversationRef: GROUP, feature: 'reply', window: 30, withText: true })).toMatchObject({ feature: 'reply', identity: { creatorId: CREATOR, groupId: GROUP, fanId: FAN } });
    } else {
      await settle();
      expect(port.probe().capabilities.chatWindow).toEqual({ state: 'off', reason: 'observation', code: 'CG-HOST-NOT-READY' });
      expect([port.current().route.chat, port.chatWindow(chat, 200), port.current().composer]).toEqual([null, null, null]);
      expect(await port.freshness.snapshot(chat, { conversationRef: GROUP, feature: 'reply', window: 30, withText: true })).toBeNull();
    }
    expect(await port.freshness.snapshot(chat, { conversationRef: OTHER, feature: 'reply', window: 30, withText: true })).toBeNull();
    const health = await port.health();
    expect(health.main?.stream).toMatchObject({ unacked: 0, gaps: 0 });
    expect(health.isolated.stream).toMatchObject({ states: 1, gaps: 0, refused: 0, skipped: 0 });
    expect(health.isolated.stream?.acked).toBe(health.main?.stream.batches);
    expect(health.isolated.staleChats).toBe(0);
    expect(port.probe().extensions['fansly-web'].anchors.accountMe).toBe('ok');
    expect(health.isolated.route).toEqual({ changes: 1, unsignalled: 0, restorations: 0 });
    expect(diagnostics).toEqual([]);
  });
});


describe('[host:fansly] the vault’s facts: start order and losses (review of P13a)', () => {
  it('[VA-006] the album the page loaded last is the load it STARTED last; a loss of MAIN’s facts forgets it and is said to the uploader', async () => {
    let lastBatch = 0;
    const main = scriptedMain({ 'fx.state': () => ({ ...NO_ONE, lastBatch }), 'fx.ack': () => null, 'fx.focus': () => null });
    const { port } = await startPort('/creator/vault', main.client);
    // A → B quickly; A's answer comes last.
    main.batch(1, { t: 'fx.vaultLoaded', p: { albumId: '700000000000000302', seq: 5 } });
    main.batch(2, { t: 'fx.vaultLoaded', p: { albumId: '700000000000000301', seq: 4 } });
    expect(port.vault.album()).toEqual({ albumId: '700000000000000302', seq: 5 });
    let losses = 0;
    const off = port.vault.onLost(() => (losses += 1));
    // MAIN's queue overflowed: its next state says where its stream goes on.
    lastBatch = 3;
    main.gap();
    expect(losses).toBe(1);
    expect(port.vault.album()).toBeNull();
    await settle();
    main.batch(4, { t: 'fx.vaultLoaded', p: { albumId: '700000000000000301', seq: 9 } });
    expect(port.vault.album()).toEqual({ albumId: '700000000000000301', seq: 9 });
    off();
  });
});

describe('[host:fansly] coexistence invalidates the vault’s work (P13a over P7g)', () => {
  it('[AU-036] [VA-004] a port that steps aside forgets the album and says no account: a file in flight is not known, and no run belongs to the tab', async () => {
    const coexistence = watchCoexistence(window);
    cleanups.push(() => {
      coexistence.dispose();
      document.documentElement.removeAttribute('data-fx-instance');
      document.querySelector('[data-host="reload-notice"]')?.remove();
    });
    const main = scriptedMain({ 'fx.state': () => ({ ...NO_ONE, identity: fanslyIdentityWire }), 'fx.ack': () => null, 'fx.focus': () => null });
    const { port } = await startPort('/creator/vault', main.client, undefined, undefined, coexistence);
    const vaultPage = createFakeVaultPage();
    cleanups.push(() => vaultPage.destroy());
    vaultPage.openAlbum('Set 1');
    vaultPage.expandUploader();
    vaultPage.cards([]);
    main.batch(1, { t: 'fx.vaultLoaded', p: { albumId: '700000000000000301', seq: 3 } });
    const uploader = createVaultUploader({ win: window, port });
    const target = vaultTargetOf(uploader.view());
    expect(target).toEqual({ hostAccountId: CREATOR, albumId: '700000000000000301', title: 'Set 1' });
    if (target === null) return;
    const step = uploader.upload(new File(['x'], 'a.jpg', { type: 'image/jpeg' }), target);
    main.batch(2, { t: 'fx.identity', p: { ...fanslyIdentityWire, legacy: true } });
    expect(await step).toEqual({ state: 'unknown', halt: 'account-changed', path: 'data-transfer' });
    expect(port.vault.album()).toBeNull();
    expect(vaultTargetOf(uploader.view())).toBeNull();
    expect(uploader.stats().watching).toBe(false);
  });
});

describe('[host:fansly] coexistence invalidates pending work', () => {
  it('[NEW-12] [FS-CO-1] a late legacy identity retires the port, drops a pending snapshot, and cannot be revived by a later clean identity', async () => {
    const coexistence = watchCoexistence(window);
    cleanups.push(() => {
      coexistence.dispose();
      document.documentElement.removeAttribute('data-fx-instance');
      document.querySelector('[data-host="reload-notice"]')?.remove();
    });
    let release: (value: unknown) => void = () => undefined;
    const main = scriptedMain({
      'fx.state': () => ({ ...NO_ONE, identity: fanslyIdentityWire }),
      'fx.ack': () => null, 'fx.focus': () => null,
      'fx.generationSnapshot': () => new Promise((resolve) => { release = resolve; }),
    });
    const { port, page } = await startPort(`/messages/${GROUP}`, main.client, undefined, undefined, coexistence);
    page.openChat(GROUP); await settle();
    main.batch(1, chatOf(GROUP, 1));
    const identity = open(port.identity());
    const chat = { host: 'fansly-web', hostAccountId: CREATOR, platformFanId: FAN } as const;
    const request = { conversationRef: GROUP, feature: 'reply', window: 30, withText: true } as const;
    const pending = port.freshness.snapshot(chat, request);
    main.batch(2, { t: 'fx.identity', p: { ...fanslyIdentityWire, legacy: true } });
    release(fanslyReplySnapshot);
    expect(await pending).toBeNull();
    expect(port.current()).toMatchObject({ accounts: [], identity: null, composer: null });
    expect(await port.focusComposer(identity)).toBe(false);
    const calls = main.calls.length;
    expect(await port.freshness.snapshot(chat, request)).toBeNull();
    await port.recheck();
    expect(main.calls).toHaveLength(calls);
    main.batch(3, identityEvent(CREATOR));
    expect(port.listCachedAccounts()).toEqual([]);
    expect(port.probe().capabilities.identity).toMatchObject({ state: 'off', reason: 'legacy' });
  });
});
