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
import { createAnchorWatcher } from './anchors';
import { BridgeCallError, type FanslyBridgeEvent, type FanslyMainBridgeClient } from './bridge-client';
import { createFanslyHostPort, type FanslyDiagnostic, type FanslyPort } from './host-port';
import { createFanslyMounts } from './mount';
import { createRouteWatcher } from './route';
import { startFanslyHost } from './start';
import { parseEvent } from './validate';
import { loadValidation } from './validation';

const { creator: CREATOR, fan: FAN, group: GROUP, otherGroup: OTHER } = FANSLY_IDS;
const SECOND_CREATOR = '700000000000000009';
/** The fixtures' snapshot names this document epoch. */
const EPOCH = 'doc1';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  history.replaceState({}, '', '/');
});

/** Lets the port, the observers and the bridge's promises run. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

const NO_ONE: FanslyState = {
  identity: { ...fanslyIdentityWire, creatorId: null, accountMeSeen: false },
  socket: { epoch: 0, confirmed: false },
  chat: null,
  contract: { anchors: { accountMe: 'notYet', socket: 'notYet', frames: 'notYet', xhr: 'notYet' }, tap: 'ok' },
  lastBatch: 0,
};

type Answer = (payload: never) => unknown;

/** A MAIN the test scripts: its answers by request type (none — `not-ready`, as a MAIN before P7b says), its events through Fansly's schemas. */
function scriptedMain(script: Partial<Record<string, Answer>>) {
  const listeners = new Set<(event: FanslyBridgeEvent) => void>();
  const calls: Array<{ readonly t: string; readonly payload: unknown }> = [];
  const client = {
    documentEpoch: EPOCH,
    probe: () => Promise.resolve(PROBE),
    request(t: string, payload: unknown) {
      calls.push({ t, payload });
      const answer = script[t];
      if (answer === undefined) return Promise.reject(new BridgeCallError('not-ready', t));
      try {
        return Promise.resolve(answer(payload as never));
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
    onEvent(listener: (event: FanslyBridgeEvent) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    stats: () => ({ rejected: {}, invalidAnswers: 0, invalidEvents: 0, stale: 0, late: 0, timeouts: 0, coalesced: 0 }),
    close: () => listeners.clear(),
  } as unknown as FanslyMainBridgeClient;
  /** Delivers a wire event as the client would after its checks: what Fansly's schemas make of it. */
  const deliver = (t: 'fx.batch' | 'fx.gap' | 'fault', payload: unknown): void => {
    const parsed = parseEvent(t, payload);
    if (parsed === null) throw new Error(`the client would drop this ${t}`);
    for (const listener of [...listeners]) listener({ t, payload: parsed } as FanslyBridgeEvent);
  };
  return {
    client,
    calls,
    /** The requests of a type, their payloads. */
    asked: (t: string): unknown[] => calls.filter((call) => call.t === t).map((call) => call.payload),
    batch: (n: number, ...events: FanslyBatchEvent[]): void => deliver('fx.batch', { n, events }),
    /** A batch the schemas refuse: only its number goes on (validate.ts). */
    refused: (n: number): void => deliver('fx.batch', { n, events: [{ t: 'fx.identity', p: { creatorId: 'not-an-id' } }] }),
    gap: (): void => deliver('fx.gap', { reason: 'overflow' }),
    fault: (source: string, count: number): void => deliver('fault', { source, count }),
  };
}

const light = { current: () => ({ scheme: 'light', tokens: {}, fixedWidth: false }) as const, onChange: () => () => undefined, dispose: () => undefined };

interface Started {
  readonly port: FanslyPort;
  readonly page: FakeFanslyPage;
  readonly events: HostEvent[];
  readonly diagnostics: FanslyDiagnostic[];
}

/** The port on a Fansly-like page at `path`, over `main` (null — no MAIN), once its first state was taken. */
async function startPort(path: string, main: FanslyMainBridgeClient | null): Promise<Started> {
  history.replaceState({}, '', path);
  const page = createFakeFanslyPage();
  const diagnostics: FanslyDiagnostic[] = [];
  const route = createRouteWatcher(window, (diagnostic) => diagnostics.push(diagnostic));
  const anchors = createAnchorWatcher(document, route);
  const port = createFanslyHostPort({ win: window, bridge: main, mounts: createFanslyMounts(document), theme: light, route, anchors, onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) });
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
    const { port, page, diagnostics } = await startPort('/messages', main.client);
    expect(diagnostics).toContainEqual({ event: 'state-failed', detail: { failure: 'timeout' } });
    await settle();
    expect(main.asked('fx.state')).toHaveLength(1);
    answering = true;
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
    const started = startFanslyHost({ win, validation: loadValidation, handshakeTimeoutMs: 1000, onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) });
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
    expect(health.isolated.route).toEqual({ changes: 1, unsignalled: 0 });
    expect(diagnostics).toEqual([]);
  });
});
