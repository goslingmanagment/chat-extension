// HostPort over a scripted bridge client (what MAIN would answer), checked
// against the contracts: snapshots and events in, receipts out.

import type { ToMainType } from '@cg/contracts/bridge';
import type { ComposerState, HostEvent, HostTheme, InsertIntent, MountPoints, NavigationIntent } from '@cg/contracts/host';
import { HostContractReportSchema, InsertReceiptSchema, LiveTextTailSchema, NavigationReceiptSchema } from '@cg/contracts/host';
import { describe, expect, it } from 'vitest';

import { BridgeCallError, type BridgeEvent, type MainBridgeClient } from './bridge-client';
import { createChatSpaceHostPort, HostContractError, type HostDiagnostic } from './host-port';
import type { MountManager } from './mount';
import type { ThemeReader } from './theme';

const ACC = '1001';
const FAN = '2002';
const OTHER = '2003';
const chat = (fan = FAN) => ({ host: 'chatspace' as const, hostAccountId: ACC, platformFanId: fan });
const account = { host: 'chatspace' as const, hostAccountId: ACC, platform: 'onlyfans' as const, platformAccountId: '3003', username: 'one', displayName: 'One' };
const composer = (over: Partial<ComposerState> = {}): ComposerState => ({ chat: chat(), instanceId: 'c1', ready: true, hidden: false, draft: { revision: 3, provenance: 'empty' }, ...over });
const wire = (over: Record<string, unknown> = {}) => ({ build: 'index-0000fake', missing: [], shape: [], receiptModules: {}, ...over });
const snapshot = (over: Record<string, unknown> = {}) => ({
  route: { epoch: 4, name: 'chat', account, chat: chat() },
  hostLoginEpoch: 'L1',
  composer: composer(),
  accounts: [account],
  contract: wire(),
  ...over,
});
const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const TOKEN = 'tok_abcdefghijklmnop';

type Answer = (payload: Record<string, unknown>) => unknown;

function fakeBridge(answers: Partial<Record<ToMainType, Answer>>) {
  const listeners = new Set<(event: BridgeEvent) => void>();
  const calls: Array<{ t: ToMainType; payload: Record<string, unknown>; timeoutMs: number | undefined }> = [];
  const client: MainBridgeClient = {
    documentEpoch: 'doc1',
    probe: () => Promise.resolve({ v: 1, readyStateAtStart: 'loading', installMs: 0, wsTap: false }),
    request: (t, payload, timeoutMs) => {
      calls.push({ t, payload: payload, timeoutMs });
      const answer = answers[t];
      if (!answer) return Promise.reject(new BridgeCallError('not-ready', t));
      return Promise.resolve(answer(payload as Record<string, unknown>)) as never;
    },
    onEvent: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stats: () => ({ rejected: {}, invalidAnswers: 0, invalidEvents: 0, stale: 0, late: 0, timeouts: 0, coalesced: 0 }),
    close: () => undefined,
  };
  return { client, calls, emit: (event: BridgeEvent) => listeners.forEach((listener) => listener(event)) };
}

function fakeMounts() {
  const updates: Array<ComposerState | null> = [];
  let frame: 'ok' | 'missing' = 'ok';
  const points: MountPoints = { dock: { kind: 'in-flow', composerInstanceId: 'c1', width: 700 }, overlay: { ready: true, container: null } };
  const mounts = {
    update: (state: ComposerState | null) => updates.push(state),
    points: () => points,
    onChange: () => () => undefined,
    frameAnchor: () => frame,
    dispose: () => undefined,
  } as unknown as MountManager;
  return { mounts, updates, setFrame: (value: 'ok' | 'missing') => (frame = value) };
}

const themeStub: ThemeReader = {
  current: (): HostTheme => ({ scheme: 'dark', tokens: { '--color-om-neutral-0': '255 255 255' }, fixedWidth: false }),
  onChange: () => () => undefined,
  anchor: () => 'ok',
  dispose: () => undefined,
};

function storage(entries: Record<string, string> = {}) {
  return { getItem: (key: string) => entries[key] ?? null, entries };
}
const storedDraft = (text: string) => JSON.stringify({ body: { json: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }, gif: null, media: null, taggedCreators: [] }, updatedAt: 1 });

async function port(answers: Partial<Record<ToMainType, Answer>> = {}, options: { redeem?: boolean; drafts?: ReturnType<typeof storage> } = {}) {
  const bridge = fakeBridge({ snapshot: () => snapshot(), listAccounts: () => [account], chatWindow: () => null, fan: () => null, listChats: () => [], ...answers });
  const { mounts, updates, setFrame } = fakeMounts();
  const redeemed: string[] = [];
  const diagnostics: HostDiagnostic[] = [];
  const host = createChatSpaceHostPort({
    win: window,
    bridge: bridge.client,
    redeem: (request) => {
      redeemed.push(`${request.kind}:${request.intentId}:${request.actionToken}`);
      return Promise.resolve(options.redeem ?? true);
    },
    mounts,
    theme: themeStub,
    drafts: options.drafts ?? null,
    navInsertTimeoutMs: 20_000,
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  await host.ready;
  return { host, bridge, updates, redeemed, diagnostics, setFrame };
}

const insertIntent = (over: Partial<InsertIntent> = {}): InsertIntent => ({
  intentId: uuid(1),
  operationId: uuid(2),
  part: { index: 0 },
  target: chat(),
  expected: { kind: 'open', documentEpoch: 'doc1', routeEpoch: 4, composerInstanceId: 'c1', draftRevision: 3, draftDigest: '0123456789abcdef' },
  mode: 'replace',
  text: 'Hello',
  confirmationId: null,
  createdAt: Date.now() - 5,
  expiresAt: Date.now() + 10_000,
  cause: { kind: 'click', actionToken: TOKEN },
  ...over,
});

describe('[BG-002] state from MAIN', () => {
  it('[AU-030] identity, route, composer, accounts and the contract come from the first snapshot', async () => {
    const { host, updates } = await port();
    expect(host.identity()).toEqual({
      host: 'chatspace',
      documentEpoch: 'doc1',
      hostLoginEpoch: 'L1',
      hostAccountId: ACC,
      platformAccountId: '3003',
      chat: chat(),
      routeEpoch: 4,
      composerInstanceId: 'c1',
    });
    const current = host.current();
    expect(current.route.epoch).toBe(4);
    expect(current.accounts).toEqual([account]);
    expect(host.listCachedAccounts()).toEqual([account]);
    expect(updates.at(-1)).toEqual(composer());
    const report = HostContractReportSchema.parse(host.probe());
    expect(report.capabilities.identity).toEqual({ state: 'on' });
    expect(report.capabilities.insert).toEqual({ state: 'on' });
    expect(report.capabilities.previewSend).toEqual({ state: 'off', reason: 'not-yet' });
    expect(host.previewSend).toBeNull();
    expect(await host.checkpoint(chat())).toBeNull();
  });

  it('[AU-030] [ER-048] without MAIN: no identity, every host capability off with CG-HOST-NOT-READY', async () => {
    const { mounts } = fakeMounts();
    const host = createChatSpaceHostPort({ win: window, bridge: null, redeem: () => Promise.resolve(true), mounts, theme: themeStub });
    await host.ready;
    expect(host.identity()).toBeNull();
    expect(host.probe().capabilities.identity).toEqual({ state: 'off', reason: 'bridge', code: 'CG-HOST-NOT-READY' });
    expect(await host.insert(insertIntent())).toEqual({ state: 'rejected', code: 'CG-HOST-NOT-READY' });
    expect(await host.navigate({ intentId: uuid(9), cause: { kind: 'click', actionToken: TOKEN }, target: { hostAccountId: ACC, platformFanId: FAN } })).toEqual({ state: 'failed', code: 'CG-NAV-FAILED', insert: null });
    await expect(host.readDraft(host.current().identity ?? ({} as never))).rejects.toBeInstanceOf(BridgeCallError);
  });

  it('[RB-015] a route event moves the epoch and drops the composer of the chat we left; composer events move the dock', async () => {
    const { host, bridge, updates } = await port();
    const seen: HostEvent['type'][] = [];
    host.subscribe((event) => seen.push(event.type));
    bridge.emit({ t: 'route', payload: { route: { epoch: 5, name: 'chat', account, chat: chat(OTHER) }, hostLoginEpoch: 'L1' } });
    expect(host.identity()).toMatchObject({ routeEpoch: 5, chat: chat(OTHER), composerInstanceId: null });
    expect(host.current().composer).toBeNull();
    bridge.emit({ t: 'composer', payload: { state: composer({ chat: chat(OTHER), instanceId: 'c2' }) } });
    expect(host.identity()?.composerInstanceId).toBe('c2');
    expect(updates.at(-1)).toMatchObject({ instanceId: 'c2' });
    expect(seen).toEqual(['composer', 'route', 'composer']);
  });

  it('[BG-002] MAIN injected after document_start (an update under an open tab): reloadNeeded, also for a late subscriber', async () => {
    const bridge = fakeBridge({ snapshot: () => snapshot(), listAccounts: () => [account], chatWindow: () => null, fan: () => null, listChats: () => [] });
    bridge.client.probe = () => Promise.resolve({ v: 1, readyStateAtStart: 'complete', installMs: 0, wsTap: false });
    const { mounts } = fakeMounts();
    const diagnostics: HostDiagnostic[] = [];
    const host = createChatSpaceHostPort({ win: window, bridge: bridge.client, redeem: () => Promise.resolve(true), mounts, theme: themeStub, onDiagnostic: (d) => diagnostics.push(d) });
    await host.ready;
    const seen: string[] = [];
    host.subscribe((event) => seen.push(event.type));
    await Promise.resolve();
    expect(seen).toEqual(['reloadNeeded']);
    expect(diagnostics).toContainEqual({ event: 'late-start', detail: { readyStateAtStart: 'complete' } });
    const normal = await port();
    const quiet: string[] = [];
    normal.host.subscribe((event) => quiet.push(event.type));
    await Promise.resolve();
    expect(quiet).toEqual([]);
  });

  it('[DB-031] [NEW-09] [RB-008] contract changes reach onContract once per change, with the build fingerprint', async () => {
    const { host, bridge, diagnostics, setFrame } = await port();
    const reports: unknown[] = [];
    host.onContract((report) => reports.push(report));
    bridge.emit({ t: 'contract', payload: wire({ missing: ['chatMessages'] }) });
    bridge.emit({ t: 'contract', payload: wire({ missing: ['chatMessages'] }) });
    expect(reports).toHaveLength(1);
    expect(host.probe().capabilities.freshText).toEqual({ state: 'off', reason: 'chatMessages' });
    expect(host.probe().anchors.chatMessages).toBe('missing');
    bridge.emit({ t: 'contract', payload: wire({ build: 'index-NEWbuild1', shape: ['accounts'] }) });
    expect(host.probe().build).toBe('index-NEWbuild1');
    expect(host.probe().capabilities.accounts).toEqual({ state: 'contractBroken', reason: 'accounts', code: 'CG-HOST-CONTRACT' });
    expect(diagnostics).toContainEqual({ event: 'build-changed', detail: { from: 'index-0000fake', to: 'index-NEWbuild1' } });
    setFrame('missing');
    expect((await host.recheck()).capabilities.dockMount).toEqual({ state: 'degraded', reason: 'composerFrame' });
  });

  it('reads answer from the cache that chat-cache events refresh; nothing is loaded for other chats', async () => {
    const window = { chat: chat(), state: 'ready', loaded: 2, fanMessages: 1, modelMessages: 1, lastFanMessageId: '4004', lastFanMessageAt: null, lastModelMessageAt: null, hasOlder: null } as const;
    const row = { chat: chat(), position: 0, displayName: 'Two', username: 'two', unreadCount: 1, isOnline: null };
    const { host, bridge } = await port({ chatWindow: () => window, listChats: () => [row], fan: (payload) => ({ chat: chat(payload['fan'] as string), username: 'x', displayName: null, isBlocked: false, canReceiveMessages: true, isRestricted: null, isOnline: null, lastSeenAt: null, buyingPowerLabel: null, insights: null, bio: null, lists: null }) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.chatWindow(chat(), 50)).toEqual(window);
    expect(host.chatWindow(chat(OTHER), 50)).toBeNull();
    expect(host.listCachedChats(ACC, 10)).toEqual([row]);
    expect(host.fan(chat(OTHER))).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.fan(chat(OTHER))?.chat).toEqual(chat(OTHER));
    const events: HostEvent[] = [];
    host.subscribe((event) => events.push(event));
    bridge.emit({ t: 'chatCache', payload: { acc: ACC, fan: FAN } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events.filter((event) => event.type === 'chatCache')).not.toHaveLength(0);
    expect(bridge.calls.filter((call) => call.t === 'chatWindow').every((call) => call.payload['fan'] === FAN)).toBe(true);
  });

  it('[RB-008] an anchor that turns ok later (history landed after the route settled) gets its data read at once', async () => {
    const window = { chat: chat(), state: 'ready', loaded: 1, fanMessages: 1, modelMessages: 0, lastFanMessageId: '4004', lastFanMessageAt: null, lastModelMessageAt: null, hasOlder: null } as const;
    const { host, bridge } = await port({ snapshot: () => snapshot({ contract: wire({ missing: ['chatMessages'] }) }), chatWindow: () => window });
    expect(host.probe().capabilities.chatWindow.state).toBe('off');
    expect(bridge.calls.filter((call) => call.t === 'chatWindow')).toHaveLength(0);
    // A chatCache that comes before the contract finds the capability off and reads nothing…
    bridge.emit({ t: 'chatCache', payload: { acc: ACC, fan: FAN } });
    expect(bridge.calls.filter((call) => call.t === 'chatWindow')).toHaveLength(0);
    // …the contract that turns it on reads the window without waiting for the next change.
    bridge.emit({ t: 'contract', payload: wire() });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bridge.calls.filter((call) => call.t === 'chatWindow')).toHaveLength(1);
    expect(host.chatWindow(chat(), 50)).toEqual(window);
  });

  it('a cache change during an in-flight read is not lost: one more read follows; the chat list is only marked stale', async () => {
    const answers: Array<(value: unknown) => void> = [];
    const { host, bridge } = await port({ chatWindow: () => new Promise((resolve) => answers.push(resolve)), listChats: () => [] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const windows = () => bridge.calls.filter((call) => call.t === 'chatWindow').length;
    const lists = () => bridge.calls.filter((call) => call.t === 'listChats').length;
    expect(windows()).toBe(1);
    const listed = lists();
    host.listCachedChats(ACC, 10);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const listedAfterRead = lists();
    bridge.emit({ t: 'chatCache', payload: { acc: ACC, fan: FAN } });
    bridge.emit({ t: 'chatCache', payload: { acc: ACC, fan: FAN } });
    expect(windows()).toBe(1);
    answers.shift()?.(null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(windows()).toBe(2);
    answers.shift()?.(null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(windows()).toBe(2);
    // The list is not re-read on every cache change: only marked stale, then read when someone asks for it.
    expect(lists()).toBe(listedAfterRead);
    expect(listedAfterRead).toBeGreaterThanOrEqual(listed);
    host.listCachedChats(ACC, 10);
    expect(lists()).toBe(listedAfterRead + 1);
  });

  it('[UI-016] the fresh tail goes to the hub trimmed to its 60-message limit and the asked max', async () => {
    const messages = Array.from({ length: 80 }, (_, i) => ({ platformMessageId: String(5000 + i), direction: 'fan', sentAt: '2026-10-03T10:00:00.000Z', text: `m${i}` }));
    const { host, bridge } = await port({ readTail: () => ({ capturedAt: '2026-10-03T10:00:00.000Z', messages }) });
    const tail = LiveTextTailSchema.parse(await host.readVisibleTail(host.identity() as never, 100));
    expect(tail.messages).toHaveLength(60);
    expect(tail.messages.at(-1)?.platformMessageId).toBe('5079');
    expect((await host.readVisibleTail(host.identity() as never, 5))?.messages).toHaveLength(5);
    bridge.emit({ t: 'contract', payload: wire({ shape: ['chatMessages'] }) });
    expect(await host.readVisibleTail(host.identity() as never, 5)).toBeNull();
  });

  it('readDraft pairs MAIN’s draft with the identity; a non-empty draft without its key degrades draftRead', async () => {
    const drafts = storage();
    const { host } = await port({ readDraft: () => ({ composerInstanceId: 'c1', revision: 7, plainText: 'typed', provenance: 'human-or-unknown', digest: '00000000000000aa' }) }, { drafts });
    const draft = await host.readDraft(host.identity() as never);
    expect(draft).toMatchObject({ revision: 7, plainText: 'typed', provenance: 'human-or-unknown', identity: { composerInstanceId: 'c1' } });
    expect(host.probe().capabilities.draftRead).toEqual({ state: 'degraded', reason: 'draftKey' });
    drafts.entries[`chat-space:draft:of:${ACC}:${FAN}`] = storedDraft('typed');
    await host.readDraft(host.identity() as never);
    expect(host.probe().capabilities.draftRead).toEqual({ state: 'on' });
  });
});

describe('guarded insert (§6.4)', () => {
  it('[UI-019] spends the action token, sends the intent WITHOUT it, and keeps MAIN’s applied receipt', async () => {
    const applied = { state: 'applied', draftRevision: 5, draftDigest: '00000000000000bb', ms: 12 } as const;
    const { host, bridge, redeemed } = await port({ insertGuarded: () => applied });
    const intent = insertIntent();
    expect(InsertReceiptSchema.parse(await host.insert(intent))).toEqual(applied);
    expect(redeemed).toEqual([`insert:${intent.intentId}:${TOKEN}`]);
    const sent = bridge.calls.find((call) => call.t === 'insertGuarded')?.payload['intent'] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('cause');
    expect(JSON.stringify(bridge.calls)).not.toContain(TOKEN);
  });

  it('[RB-014] prechecks fail before the token is spent; a refused token sends nothing', async () => {
    const { host, bridge, redeemed } = await port({ insertGuarded: () => ({ state: 'applied', draftRevision: 5, draftDigest: '00000000000000bb', ms: 1 }) });
    expect(await host.insert(insertIntent({ target: chat(OTHER) }))).toEqual({ state: 'rejected', code: 'CG-INSERT-CHAT-CHANGED' });
    expect(await host.insert(insertIntent({ expected: { ...insertIntent().expected, routeEpoch: 3 } as InsertIntent['expected'] }))).toEqual({ state: 'rejected', code: 'CG-INSERT-CHAT-CHANGED' });
    expect(redeemed).toEqual([]);
    const refused = await port({}, { redeem: false });
    expect(await refused.host.insert(insertIntent())).toEqual({ state: 'rejected', code: 'CG-INSERT-FAILED' });
    expect(refused.bridge.calls.some((call) => call.t === 'insertGuarded')).toBe(false);
    expect(bridge.calls.some((call) => call.t === 'insertGuarded')).toBe(false);
  });

  it('[UI-026] a write that may have run is uncertain and never retried; a refusal before execution is a plain «not done»', async () => {
    const lost = await port({ insertGuarded: () => Promise.reject(new BridgeCallError('timeout', 'insertGuarded')) });
    expect(await lost.host.insert(insertIntent())).toEqual({ state: 'uncertain', code: 'CG-INSERT-UNCERTAIN' });
    expect(lost.bridge.calls.filter((call) => call.t === 'insertGuarded')).toHaveLength(1);
    const stale = await port({ insertGuarded: () => Promise.reject(new BridgeCallError('stale-document', 'insertGuarded')) });
    expect(await stale.host.insert(insertIntent())).toEqual({ state: 'rejected', code: 'CG-INSERT-CHAT-CHANGED' });
    const internal = await port({ insertGuarded: () => Promise.reject(new BridgeCallError('internal', 'insertGuarded')) });
    expect(await internal.host.insert(insertIntent())).toEqual({ state: 'uncertain', code: 'CG-INSERT-UNCERTAIN' });
  });

  it('[NEW-06] an applied insert is checked against the target’s own draft key: a disagreement is uncertain', async () => {
    const drafts = storage({ [`chat-space:draft:of:${ACC}:${FAN}`]: storedDraft('something else') });
    const { host, diagnostics } = await port({ insertGuarded: () => ({ state: 'applied', draftRevision: 5, draftDigest: '00000000000000bb', ms: 1 }) }, { drafts });
    expect(await host.insert(insertIntent())).toEqual({ state: 'uncertain', code: 'CG-INSERT-UNCERTAIN' });
    expect(diagnostics).toContainEqual({ event: 'insert-key-disagrees', code: 'CG-INSERT-UNCERTAIN' });
    drafts.entries[`chat-space:draft:of:${ACC}:${FAN}`] = storedDraft('Hello');
    expect(await host.insert(insertIntent({ intentId: uuid(3) }))).toMatchObject({ state: 'applied' });
  });

  it('[UI-027] with the insert capability off only copying is left (CG-HOST-COMPOSER-MISSING); a blocked or unready composer writes nothing', async () => {
    const { host, bridge } = await port({ snapshot: () => snapshot({ contract: wire({ missing: ['composerBridge'] }) }) });
    expect(host.probe().capabilities.insert).toEqual({ state: 'off', reason: 'composerBridge', code: 'CG-HOST-COMPOSER-MISSING' });
    expect(await host.insert(insertIntent())).toEqual({ state: 'rejected', code: 'CG-HOST-COMPOSER-MISSING' });
    bridge.emit({ t: 'contract', payload: wire() });
    bridge.emit({ t: 'composer', payload: { state: composer({ ready: false }) } });
    expect(await host.insert(insertIntent())).toEqual({ state: 'rejected', code: 'CG-HOST-COMPOSER-MISSING' });
  });

  it('a deferred intent through insert() or a broken one is a programming error', async () => {
    const { host } = await port();
    await expect(host.insert(insertIntent({ expected: { kind: 'deferred', documentEpoch: 'doc1' } }))).rejects.toBeInstanceOf(HostContractError);
    await expect(host.insert({ ...insertIntent(), cause: undefined } as never)).rejects.toBeInstanceOf(HostContractError);
  });

  it('[UI-019] focus goes to the composer through MAIN; any failure is just «not focused»', async () => {
    const { host } = await port({ focus: () => ({ focused: true }) });
    expect(await host.focusComposer(host.identity() as never)).toBe(true);
    const failing = await port();
    expect(await failing.host.focusComposer(failing.host.identity() as never)).toBe(false);
  });
});

describe('navigation (§6.5, §6.9)', () => {
  const nav = (over: Partial<NavigationIntent> = {}): NavigationIntent => ({ intentId: uuid(10), cause: { kind: 'click', actionToken: TOKEN }, target: { hostAccountId: ACC, platformFanId: OTHER }, ...over });
  const thenInsert = { ...insertIntent({ target: chat(OTHER), expected: { kind: 'deferred', documentEpoch: 'doc1' }, expiresAt: Date.now() + 5000 }), cause: undefined } as unknown as Record<string, unknown>;
  delete thenInsert['cause'];

  it('[SP-035] [NF-011] redeems the human cause and pushes; MAIN gets the target without a token', async () => {
    const { host, bridge, redeemed } = await port({ navigate: () => ({ state: 'navigated', routeEpoch: 5, insert: null }) });
    expect(NavigationReceiptSchema.parse(await host.navigate(nav()))).toEqual({ state: 'navigated', routeEpoch: 5, insert: null });
    expect(redeemed).toEqual([`navigate:${uuid(10)}:${TOKEN}`]);
    expect(bridge.calls.find((call) => call.t === 'navigate')?.payload).toEqual({ intent: { intentId: uuid(10), acc: ACC, fan: OTHER } });
    const refused = await port({}, { redeem: false });
    expect(await refused.host.navigate(nav())).toEqual({ state: 'failed', code: 'CG-NAV-FAILED', insert: null });
  });

  it('[NEW-01] open and insert: the bridge waits until the insert deadline (plus grace); a lost answer is a timeout with an uncertain insert', async () => {
    const { host, bridge } = await port({ navigate: () => Promise.reject(new BridgeCallError('timeout', 'navigate')) });
    const receipt = await host.navigate(nav({ thenInsert: thenInsert as never }));
    expect(receipt).toEqual({ state: 'failed', code: 'CG-NAV-TIMEOUT', insert: { state: 'uncertain', code: 'CG-INSERT-UNCERTAIN' } });
    const timeout = bridge.calls.find((call) => call.t === 'navigate')?.timeoutMs ?? 0;
    expect(timeout).toBeGreaterThan(5000);
    expect(timeout).toBeLessThanOrEqual(6100);
  });

  it('[NEW-01] the deferred insert’s applied receipt is checked against the target’s draft key too', async () => {
    const drafts = storage({ [`chat-space:draft:of:${ACC}:${OTHER}`]: storedDraft('other text') });
    const { host } = await port({ navigate: () => ({ state: 'navigated', routeEpoch: 5, insert: { state: 'applied', draftRevision: 2, draftDigest: '00000000000000cc', ms: 3 } }) }, { drafts });
    expect(await host.navigate(nav({ thenInsert: thenInsert as never }))).toEqual({ state: 'navigated', routeEpoch: 5, insert: { state: 'uncertain', code: 'CG-INSERT-UNCERTAIN' } });
  });

  it('a refusal before execution is CG-NAV-FAILED', async () => {
    const { host } = await port({ navigate: () => Promise.reject(new BridgeCallError('bad-request', 'navigate')) });
    expect(await host.navigate(nav({ thenInsert: thenInsert as never }))).toEqual({ state: 'failed', code: 'CG-NAV-FAILED', insert: { state: 'rejected', code: 'CG-NAV-FAILED' } });
    await expect(host.navigate({ ...nav(), cause: undefined } as never)).rejects.toBeInstanceOf(HostContractError);
  });
});
