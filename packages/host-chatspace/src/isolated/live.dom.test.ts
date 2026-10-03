// The live side of the HostPort (architecture.md §5.2, §6.6–§6.8) over a
// scripted bridge client: the flags and the receipt profile make the
// capability, the X8 port sends MAIN only what MAIN may know, and the facts of
// the tap and of the receipt observer come out as contract events.

import type { ToMainType } from '@cg/contracts/bridge';
import { MainSendRequestSchema } from '@cg/contracts/bridge-messages';
import { checkpoint, dispatchTicket, previewSendRequest, uuid } from '@cg/contracts/fixtures';
import type { ComposerState, HostEvent, HostTheme, MountPoints } from '@cg/contracts/host';
import { CoverageEventSchema, HostContractReportSchema, HumanSendFactSchema, IncomingFactSchema } from '@cg/contracts/host';
import type { PreviewSendRequest, SendAttemptView } from '@cg/contracts/send';
import { PreviewSendCommitSchema, PreviewSendPreflightSchema } from '@cg/contracts/send';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BridgeCallError, type BridgeEvent, type BridgeFailure, type MainBridgeClient } from './bridge-client';
import { ADAPTER_VERSION, createChatSpaceHostPort, HostContractError, type ChatSpaceLiveConfig, type HostDiagnostic } from './host-port';
import type { MountManager } from './mount';
import type { ThemeReader } from './theme';

const ACC = '1001';
const OPEN = '2099';
const account = { host: 'chatspace' as const, hostAccountId: ACC, platform: 'onlyfans' as const, platformAccountId: '3003', username: 'one', displayName: 'One' };
const openChat = { host: 'chatspace' as const, hostAccountId: ACC, platformFanId: OPEN };
const composer: ComposerState = { chat: openChat, instanceId: 'c1', ready: true, hidden: false, draft: { revision: 3, provenance: 'empty' } };
const wire = (over: Record<string, unknown> = {}) => ({ build: 'index-0000fake', missing: [], shape: [], receiptModules: {}, ...over });
const snapshot = (contract = wire()) => ({ route: { epoch: 4, name: 'chat', account, chat: openChat }, hostLoginEpoch: 'L1', composer, accounts: [account], contract });

/** The modules a page of the approved build has loaded. */
const MODULES = { notificationEntry: 'BBBBBBBB', composables: 'CCCCCCCC', messages: 'EEEEEEEE', accounts: 'FFFFFFFF', inbox: 'GGGGGGGG' };
const PROFILE = { id: 'chatspace-test', adapterVersion: ADAPTER_VERSION, modules: MODULES };
const CONFIG: ChatSpaceLiveConfig = { wsTap: true, previewSend: true, markAiGenerated: true, receiptProfiles: [PROFILE] };

type Answer = (payload: Record<string, unknown>) => unknown;

function fakeBridge(answers: Partial<Record<ToMainType, Answer>>, tap: boolean) {
  const listeners = new Set<(event: BridgeEvent) => void>();
  const calls: Array<{ t: ToMainType; payload: Record<string, unknown> }> = [];
  const client: MainBridgeClient = {
    documentEpoch: 'doc1',
    probe: () => Promise.resolve({ v: 1, readyStateAtStart: 'loading', installMs: 0, wsTap: tap }),
    request: (t, payload) => {
      calls.push({ t, payload });
      const answer = answers[t];
      if (!answer) return Promise.reject(new BridgeCallError('not-ready', t));
      try {
        return Promise.resolve(answer(payload as Record<string, unknown>)) as never;
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error('failed'));
      }
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

const mounts = {
  update: () => undefined,
  refresh: () => undefined,
  points: (): MountPoints => ({ dock: { kind: 'in-flow', composerInstanceId: 'c1', width: 700 }, overlay: { ready: true, container: null } }),
  onChange: () => () => undefined,
  frameAnchor: () => 'ok',
  dispose: () => undefined,
} as unknown as MountManager;
const theme: ThemeReader = {
  current: (): HostTheme => ({ scheme: 'dark', tokens: {}, fixedWidth: false }),
  onChange: () => () => undefined,
  anchor: () => 'ok',
  dispose: () => undefined,
};

/** The modules the page has loaded, as its resource timing shows them (the approved build, or another one). */
let loaded: string[] = [];
function loadModules(modules: Record<string, string> = MODULES): void {
  loaded = Object.entries(modules).flatMap(([role, hashes]) => hashes.split('+').map((hash) => `${ORIGIN}/assets/${role}-${hash}.js`));
}
const ORIGIN = 'https://chat.example.test';
/** The page window as the port reads it for the receipt profile: its DOM, its resource timing, its origin. */
const pageWindow = {
  document: { querySelectorAll: () => [] },
  performance: { getEntriesByType: () => loaded.map((name) => ({ name })) },
  location: { origin: ORIGIN },
} as unknown as Window;

async function start(answers: Partial<Record<ToMainType, Answer>> = {}, options: { tap?: boolean; contract?: ReturnType<typeof wire>; configure?: ChatSpaceLiveConfig | null } = {}) {
  const tap = options.tap ?? true;
  let flags = { wsTap: tap, previewSend: false };
  const bridge = fakeBridge(
    {
      snapshot: () => snapshot(options.contract),
      listAccounts: () => [account],
      chatWindow: () => null,
      fan: () => null,
      listChats: () => [],
      flags: (payload) => (flags = { wsTap: tap && payload['wsTap'] === true, previewSend: tap && payload['wsTap'] === true && payload['previewSend'] === true }),
      previewSendPreflight: () => ({ ok: true }),
      previewSendCommit: (payload) => ({ state: 'nativeEnqueued', pendingId: `pending-${String((payload['req'] as { attemptId: string }).attemptId)}` }),
      checkpoint: () => checkpoint,
      ...answers,
    },
    tap,
  );
  const diagnostics: HostDiagnostic[] = [];
  const host = createChatSpaceHostPort({ win: pageWindow, bridge: bridge.client, redeem: () => Promise.resolve(true), mounts, theme, onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) });
  await host.ready;
  const events: HostEvent[] = [];
  host.subscribe((event) => events.push(event));
  if (options.configure !== null) await host.configure(options.configure ?? CONFIG);
  return { host, bridge, events, diagnostics, flags: () => flags };
}

const request = (over: Partial<PreviewSendRequest> = {}): PreviewSendRequest => ({ ...previewSendRequest, ...over });
const ticket = (over: Partial<typeof dispatchTicket> = {}) => ({ ...dispatchTicket, expiresAt: Date.now() + 10_000, ...over });

afterEach(() => {
  loaded = [];
  vi.useRealTimers();
});

describe('[X8-06] the preview send capability (§6.2, §6.7.11)', () => {
  it('is on with the flag, the tap script and an approved profile of the loaded modules — and only then is `previewSend` a port', async () => {
    loadModules();
    const { host, bridge, flags } = await start({}, { configure: null });
    // Before the bootstrap's flags are known nothing is on, and MAIN was told nothing.
    expect(host.previewSend).toBeNull();
    expect(host.probe().capabilities.previewSend).toEqual({ state: 'off', reason: 'flag', code: 'CG-SEND-OFF' });
    expect(host.probe().capabilities.incoming).toEqual({ state: 'on' });
    expect(bridge.calls.some((call) => call.t === 'flags')).toBe(false);

    const report = HostContractReportSchema.parse(await host.configure(CONFIG));
    expect(report.adapterVersion).toBe(ADAPTER_VERSION);
    expect(report.capabilities.previewSend).toEqual({ state: 'on' });
    expect(report.capabilities.receipt).toEqual({ state: 'on' });
    expect(report.capabilities.sendObserve).toEqual({ state: 'on' });
    expect(report.anchors.receiptProfile).toBe('ok');
    expect(host.previewSend).not.toBeNull();
    // MAIN's latch follows the flag.
    expect(flags()).toEqual({ wsTap: true, previewSend: true });

    // The owner turns the flag off: the port is gone at once, MAIN's latch closes.
    await host.configure({ ...CONFIG, previewSend: false });
    expect(host.previewSend).toBeNull();
    expect(flags().previewSend).toBe(false);
    expect(host.probe().capabilities.previewSend).toEqual({ state: 'off', reason: 'flag', code: 'CG-SEND-OFF' });
  });

  it('no approved profile for the loaded modules: X8 is off (CG-SEND-RECEIPT), the rest of the adapter is not', async () => {
    loadModules({ ...MODULES, notificationEntry: 'NEWBUILD' });
    const { host, diagnostics } = await start();
    expect(host.previewSend).toBeNull();
    expect(host.probe().capabilities.previewSend).toEqual({ state: 'off', reason: 'receiptProfile', code: 'CG-SEND-RECEIPT' });
    expect(host.probe().capabilities.insert).toEqual({ state: 'on' });
    expect(diagnostics).toContainEqual({ event: 'receipt-profile', code: 'CG-SEND-RECEIPT', detail: { profile: null } });
    // The owner approves the new set: no release, the next bootstrap turns it on.
    await host.configure({ ...CONFIG, receiptProfiles: [PROFILE, { ...PROFILE, id: 'chatspace-next', modules: { ...MODULES, notificationEntry: 'NEWBUILD' } }] });
    expect(host.previewSend).not.toBeNull();
    expect(diagnostics.at(-1)).toEqual({ event: 'receipt-profile', detail: { profile: 'chatspace-next' } });
  });

  it('the chat’s modules load with the first chat: the profile is judged again when the route or the contract changes', async () => {
    const { messages: _late, ...early } = MODULES;
    loadModules(early);
    const { host, bridge } = await start();
    expect(host.previewSend).toBeNull();
    loadModules();
    bridge.emit({ t: 'contract', payload: wire() });
    expect(host.previewSend).not.toBeNull();
  });

  it('no tap script, or one switched off: no facts, no checkpoint, no X8', async () => {
    loadModules();
    const none = await start({ checkpoint: () => Promise.reject(new BridgeCallError('disabled', 'checkpoint')) }, { tap: false });
    expect(none.host.previewSend).toBeNull();
    expect(none.host.probe().capabilities.previewSend).toEqual({ state: 'off', reason: 'wsTap', code: 'CG-SEND-FRESHNESS' });
    expect(none.host.probe().capabilities.incoming).toEqual({ state: 'off', reason: 'wsTap', code: 'CG-SEND-FRESHNESS' });
    expect(await none.host.checkpoint(previewSendRequest.target.chat)).toBeNull();

    const off = await start();
    expect(off.host.previewSend).not.toBeNull();
    await off.host.configure({ ...CONFIG, wsTap: false });
    expect(off.flags()).toEqual({ wsTap: false, previewSend: false });
    expect(off.host.previewSend).toBeNull();
    expect(off.host.probe().capabilities.sendObserve).toEqual({ state: 'off', reason: 'wsTap', code: 'CG-SEND-FRESHNESS' });
  });

  it('a condition’s anchor that cannot be read keeps X8 off', async () => {
    loadModules();
    const { host } = await start({}, { contract: wire({ missing: ['mimic'] }) });
    expect(host.previewSend).toBeNull();
    expect(host.probe().capabilities.previewSend).toEqual({ state: 'off', reason: 'mimic', code: 'CG-SEND-HOST' });
  });
});

describe('[X8-04] the freshness checkpoint (§6.7.5)', () => {
  it('is MAIN’s, schema-checked; without one the result can be inserted, never sent', async () => {
    loadModules();
    const { host, bridge } = await start();
    expect(await host.checkpoint(previewSendRequest.target.chat)).toEqual(checkpoint);
    expect(bridge.calls.at(-1)).toEqual({ t: 'checkpoint', payload: { acc: checkpoint.hostAccountId, fan: checkpoint.platformFanId } });
    const failing = await start({ checkpoint: () => Promise.reject(new BridgeCallError('timeout', 'checkpoint')) });
    expect(await failing.host.checkpoint(previewSendRequest.target.chat)).toBeNull();
  });
});

describe('[X8-02] [SP-054] the X8 port (§5.2, §6.7.7, §14)', () => {
  it('MAIN gets the host target, the text and the ticket’s deadline — never the hub binding, the ticket or the action token', async () => {
    loadModules();
    const { host, bridge } = await start();
    const port = host.previewSend;
    if (!port) throw new Error('no port');
    const req = request();
    const deadline = Date.now() + 9000;
    expect(PreviewSendPreflightSchema.parse(await port.preflight(req))).toEqual({ ok: true });
    expect(PreviewSendCommitSchema.parse(await port.commit(req, ticket({ expiresAt: deadline })))).toEqual({ state: 'nativeEnqueued', pendingId: `pending-${req.attemptId}` });
    const sent = bridge.calls.filter((call) => call.t === 'previewSendPreflight' || call.t === 'previewSendCommit');
    expect(sent.map((call) => call.t)).toEqual(['previewSendPreflight', 'previewSendCommit']);
    for (const call of sent) {
      const main = MainSendRequestSchema.parse(call.payload['req']);
      expect(main).toMatchObject({ attemptId: req.attemptId, acc: req.target.chat.hostAccountId, fan: req.target.chat.platformFanId, platformAccountId: req.target.binding.platformAccountId, plainText: req.plainText, isAiGenerated: true });
      const text = JSON.stringify(call.payload);
      for (const secret of [dispatchTicket.ticket, req.cause.actionToken, req.target.binding.hubOrigin, req.target.binding.pageLabel, req.generationRef]) expect(text).not.toContain(secret);
    }
    expect((sent[1]?.payload['req'] as { expiresAt: number }).expiresAt).toBe(deadline);
  });

  it('the AI mark is the request’s, unless the owner turned the mark off', async () => {
    loadModules();
    const { host, bridge } = await start({}, { configure: { ...CONFIG, markAiGenerated: false } });
    await host.previewSend?.commit(request(), ticket());
    await host.previewSend?.commit(request({ attemptId: uuid(77), isAiGenerated: false }), ticket({ attemptId: uuid(77) }));
    expect(bridge.calls.filter((call) => call.t === 'previewSendCommit').map((call) => (call.payload['req'] as { isAiGenerated: boolean }).isAiGenerated)).toEqual([false, false]);
    await host.configure(CONFIG);
    await host.previewSend?.commit(request({ attemptId: uuid(78) }), ticket({ attemptId: uuid(78) }));
    await host.previewSend?.commit(request({ attemptId: uuid(79), isAiGenerated: false }), ticket({ attemptId: uuid(79) }));
    expect(bridge.calls.filter((call) => call.t === 'previewSendCommit').slice(2).map((call) => (call.payload['req'] as { isAiGenerated: boolean }).isAiGenerated)).toEqual([true, false]);
  });

  it('twenty clicks of one attempt are one command; the first answer is the answer', async () => {
    loadModules();
    const { host, bridge } = await start();
    const port = host.previewSend;
    if (!port) throw new Error('no port');
    const answers = await Promise.all(Array.from({ length: 20 }, () => port.commit(request(), ticket())));
    expect(bridge.calls.filter((call) => call.t === 'previewSendCommit')).toHaveLength(1);
    expect(new Set(answers.map((answer) => JSON.stringify(answer))).size).toBe(1);
  });

  it.each<[string, BridgeFailure, { state: string; code: string }]>([
    ['a timeout', 'timeout', { state: 'uncertain', code: 'CG-SEND-UNCERTAIN' }],
    ['an answer that fails its schema', 'invalid-answer', { state: 'uncertain', code: 'CG-SEND-UNCERTAIN' }],
    ['MAIN’s `internal`', 'internal', { state: 'uncertain', code: 'CG-SEND-UNCERTAIN' }],
    ['a closed bridge', 'closed', { state: 'uncertain', code: 'CG-SEND-UNCERTAIN' }],
    ['`disabled` (the tap is gone)', 'disabled', { state: 'held', code: 'CG-SEND-HOST' }],
    ['`not-ready`', 'not-ready', { state: 'held', code: 'CG-SEND-HOST' }],
    ['`bad-request`', 'bad-request', { state: 'held', code: 'CG-SEND-HOST' }],
    ['a reloaded document', 'stale-document', { state: 'held', code: 'CG-CONTEXT-CHANGED' }],
  ])('the queue call’s bridge failure — %s: a call that may have run is uncertain and never sent again; a refusal before execution is held', async (_name, failure, expected) => {
    loadModules();
    const { host, bridge, diagnostics } = await start({ previewSendCommit: () => Promise.reject(new BridgeCallError(failure, 'previewSendCommit')) });
    const port = host.previewSend;
    const first = await port?.commit(request(), ticket());
    expect(first).toEqual(expected);
    expect(PreviewSendCommitSchema.safeParse(first).success).toBe(true);
    // The same attempt again — a retry of the caller, a second surface: never a second command.
    expect(await port?.commit(request(), ticket())).toEqual(expected);
    expect(bridge.calls.filter((call) => call.t === 'previewSendCommit')).toHaveLength(1);
    if (expected.state === 'uncertain') expect(diagnostics.at(-1)).toMatchObject({ event: 'x8-commit-lost', code: 'CG-SEND-UNCERTAIN' });
  });

  it('a late ticket is held here and nothing reaches MAIN; MAIN’s own answers pass through', async () => {
    loadModules();
    const answers: unknown[] = [{ state: 'held', code: 'CG-SEND-STALE' }, { state: 'notEnqueued', code: 'CG-SEND-QUEUE' }];
    const { host, bridge } = await start({ previewSendCommit: () => answers.shift(), previewSendPreflight: () => ({ ok: false, code: 'CG-SEND-MIMIC' }) });
    const port = host.previewSend;
    expect(await port?.commit(request(), ticket({ expiresAt: Date.now() - 1 }))).toEqual({ state: 'held', code: 'CG-TIMEOUT' });
    expect(bridge.calls.some((call) => call.t === 'previewSendCommit')).toBe(false);
    expect(await port?.preflight(request())).toEqual({ ok: false, code: 'CG-SEND-MIMIC' });
    expect(await port?.commit(request({ attemptId: uuid(80) }), ticket({ attemptId: uuid(80) }))).toEqual({ state: 'held', code: 'CG-SEND-STALE' });
    expect(await port?.commit(request({ attemptId: uuid(81) }), ticket({ attemptId: uuid(81) }))).toEqual({ state: 'notEnqueued', code: 'CG-SEND-QUEUE' });
  });

  it('a port kept from before the flag went off refuses on its own; a preflight the bridge cannot answer is CG-SEND-HOST', async () => {
    loadModules();
    const { host, bridge } = await start({ previewSendPreflight: () => Promise.reject(new BridgeCallError('timeout', 'previewSendPreflight')) });
    const port = host.previewSend;
    expect(await port?.preflight(request())).toEqual({ ok: false, code: 'CG-SEND-HOST' });
    await host.configure({ ...CONFIG, previewSend: false });
    const before = bridge.calls.length;
    expect(await port?.preflight(request())).toEqual({ ok: false, code: 'CG-SEND-OFF' });
    expect(await port?.commit(request(), ticket())).toEqual({ state: 'held', code: 'CG-SEND-OFF' });
    // The modules changed under an open page (no profile any more): refused before MAIN, too.
    await host.configure(CONFIG);
    loadModules({ ...MODULES, composables: 'CHANGED0' });
    expect(await port?.commit(request({ attemptId: uuid(82) }), ticket({ attemptId: uuid(82) }))).toEqual({ state: 'held', code: 'CG-SEND-RECEIPT' });
    expect(bridge.calls.slice(before).filter((call) => call.t.startsWith('previewSend'))).toEqual([]);
  });

  it('a request that breaks its contract is a programming error, not a refusal', async () => {
    loadModules();
    const { host } = await start();
    const port = host.previewSend;
    await expect(port?.preflight({ ...request(), plainText: '' })).rejects.toBeInstanceOf(HostContractError);
    await expect(port?.commit(request(), ticket({ attemptId: uuid(99) }))).rejects.toBeInstanceOf(HostContractError);
    await expect(port?.commit({ ...request(), cause: undefined } as never, ticket())).rejects.toBeInstanceOf(HostContractError);
  });

  it('[X8-06] the states MAIN observes reach the attempt’s listeners, in order, and only them', async () => {
    loadModules();
    const { host, bridge } = await start();
    const mine: SendAttemptView[] = [];
    const other: SendAttemptView[] = [];
    const stop = host.previewSend?.onState(uuid(5), (view) => mine.push(view));
    host.previewSend?.onState(uuid(6), (view) => other.push(view));
    const accepted: SendAttemptView = { attemptId: uuid(5), state: 'nativeAccepted', platformMessageId: '8001' };
    const sent: SendAttemptView = { attemptId: uuid(5), state: 'sentObserved', platformMessageId: '8001' };
    bridge.emit({ t: 'previewSendState', payload: { view: accepted } });
    bridge.emit({ t: 'previewSendState', payload: { view: sent } });
    expect(mine).toEqual([accepted, sent]);
    expect(other).toEqual([]);
    stop?.();
    bridge.emit({ t: 'previewSendState', payload: { view: sent } });
    expect(mine).toHaveLength(2);
  });
});

describe('[SN-001] [TL-004] facts of the tap and of the receipt observer', () => {
  it('an incoming message, a coverage change and a human send come out as contract facts, without any text', async () => {
    loadModules();
    const { bridge, events } = await start();
    bridge.emit({ t: 'incoming', payload: { acc: ACC, fan: '2003', msgId: '5001', fromFan: true, automatic: false, tip: true, sentAt: '2026-10-03T10:00:00.000Z', socketEpoch: 2, fanSequence: 7 } });
    bridge.emit({ t: 'coverage', payload: { acc: ACC, state: 'unknown', reason: 'reconnect' } });
    const draft = { revision: 5, provenance: 'our-insert' as const, insertIntentId: uuid(0x60), editedSinceInsert: false };
    bridge.emit({ t: 'humanSend', payload: { acc: ACC, fan: OPEN, pendingId: uuid(0x61), platformMessageId: '8101', textDigest: 'feedbeef00000061', draft } });
    const live = events.filter((event) => event.type === 'incoming' || event.type === 'coverage' || event.type === 'humanSend');
    expect(live).toEqual([
      { type: 'incoming', fact: { host: 'chatspace', hostAccountId: ACC, platformFanId: '2003', platformMessageId: '5001', fromFan: true, automatic: false, tip: true, sentAt: '2026-10-03T10:00:00.000Z', socketEpoch: 2, fanSequence: 7, source: 'ws-tap' } },
      { type: 'coverage', coverage: { hostAccountId: ACC, state: 'unknown', reason: 'reconnect' } },
      { type: 'humanSend', fact: { chat: openChat, pendingId: uuid(0x61), platformMessageId: '8101', textDigest: 'feedbeef00000061', draft } },
    ]);
    expect(IncomingFactSchema.safeParse((live[0] as { fact: unknown }).fact).success).toBe(true);
    expect(CoverageEventSchema.safeParse((live[1] as { coverage: unknown }).coverage).success).toBe(true);
    expect(HumanSendFactSchema.safeParse((live[2] as { fact: unknown }).fact).success).toBe(true);
  });
});
