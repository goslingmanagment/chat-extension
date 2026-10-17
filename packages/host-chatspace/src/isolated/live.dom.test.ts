// The live side of the HostPort (architecture.md §5.2, §6.6–§6.8) over a
// scripted bridge client: the flags and the receipt profile make the
// capability, the X8 port sends MAIN only what MAIN may know, and the facts of
// the tap and of the receipt observer come out as contract events.

import type { ToMainType } from '@cg/contracts/bridge';
import { MainSendRequestSchema } from '@cg/contracts/bridge-messages';
import { checkpoint, dispatchTicket, previewSendRequest, uuid } from '@cg/contracts/fixtures';
import type { ComposerState, HostEvent, HostTheme, MountPoints } from '@cg/contracts/host';
import { CoverageEventSchema, ChatSpaceContractReportSchema, HumanSendFactSchema, IncomingFactSchema } from '@cg/contracts/host';
import type { PreviewSendRequest, SendAttemptView } from '@cg/contracts/send';
import { PreviewSendCommitSchema, PreviewSendPreflightSchema } from '@cg/contracts/send';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BridgeCallError, type BridgeEvent, type BridgeFailure, type MainBridgeClient } from './bridge-client';
import { ADAPTER_VERSION, createChatSpaceHostPort, HostContractError, type ChatSpaceLiveConfig, type HostDiagnostic } from './host-port';
import { loadValidation } from './validation';
import type { MountManager } from './mount';
import type { ThemeReader } from './theme';

const ACC = '1001';
const OPEN = '2099';
const account = { host: 'chatspace' as const, hostAccountId: ACC, platform: 'onlyfans' as const, platformAccountId: '3003', username: 'one', displayName: 'One' };
const openChat = { host: 'chatspace' as const, hostAccountId: ACC, platformFanId: OPEN };
const composer: ComposerState = { chat: openChat, instanceId: 'c1', ready: true, hidden: false, draft: { revision: 3, provenance: 'empty' } };
const wire = (over: Record<string, unknown> = {}) => ({ build: 'index-0000fake', missing: [], shape: [], receiptModules: {}, ...over });
const snapshot = (contract = wire()) => ({ route: { epoch: 4, name: 'chat', account, chat: openChat }, hostLoginEpoch: 'L1', composer, accounts: [account], contract });

/** The modules a page of the approved build has loaded (laid out like ChatSpace 0.195.0: two `onlyfans` modules). */
const MODULES = { notificationEntry: 'BBBBBBBB', composables: 'CCCCCCCC', onlyfans: 'DDDDDDDD+EEEEEEEE', accounts: 'FFFFFFFF', inbox: 'GGGGGGGG' };
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
  onRenewed: () => () => undefined,
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
  const host = createChatSpaceHostPort({ win: pageWindow, bridge: bridge.client, redeem: () => Promise.resolve(true), mounts, theme, validation: loadValidation, onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) });
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

    const report = ChatSpaceContractReportSchema.parse(await host.configure(CONFIG));
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
    expect(diagnostics).toContainEqual({ event: 'receipt-profile', code: 'CG-SEND-RECEIPT', detail: { profile: null, kind: null } });
    // The owner approves the new set: no release, the next bootstrap turns it on.
    await host.configure({ ...CONFIG, receiptProfiles: [PROFILE, { ...PROFILE, id: 'chatspace-next', modules: { ...MODULES, notificationEntry: 'NEWBUILD' } }] });
    expect(host.previewSend).not.toBeNull();
    expect(diagnostics.at(-1)).toEqual({ event: 'receipt-profile', detail: { profile: 'chatspace-next', kind: 'exact' } });
  });

  it('a page laid out like ChatSpace 0.172.0 — a `messages` module, no `onlyfans` one — matches no profile of this adapter: X8 off (CG-SEND-RECEIPT)', async () => {
    const { onlyfans: _gone, ...rest } = MODULES;
    const old = { ...rest, messages: 'EEEEEEEE' };
    loadModules(old);
    // Even a profile naming exactly what that page loaded, for this adapter version: `messages` is not a role any more.
    const { host, diagnostics } = await start({}, { configure: { ...CONFIG, receiptProfiles: [{ ...PROFILE, id: 'chatspace-0.172-like', modules: old }, PROFILE] } });
    expect(host.previewSend).toBeNull();
    expect(host.probe().capabilities.previewSend).toEqual({ state: 'off', reason: 'receiptProfile', code: 'CG-SEND-RECEIPT' });
    expect(host.probe().capabilities.insert).toEqual({ state: 'on' });
    expect(diagnostics).toContainEqual({ event: 'receipt-profile', code: 'CG-SEND-RECEIPT', detail: { profile: null, kind: null } });
  });

  it('[X8-06] the hub’s «any build» sentinel (decision X25): X8 on for a build no profile names — and the report, the log and «Статус» say so', async () => {
    const SENTINEL = { id: 'any-build', adapterVersion: ADAPTER_VERSION, modules: { '*': '*' } };
    // A build nobody reviewed: every fingerprint is new.
    loadModules({ notificationEntry: 'N1N1N1N1', composables: 'N2N2N2N2+N3N3N3N3', onlyfans: 'N4N4N4N4+N5N5N5N5', accounts: 'N6N6N6N6', inbox: 'N7N7N7N7' });
    const { host, diagnostics } = await start({}, { configure: { ...CONFIG, receiptProfiles: [PROFILE, SENTINEL] } });
    expect(host.previewSend).not.toBeNull();
    const report = ChatSpaceContractReportSchema.parse(host.probe());
    expect(report.capabilities.previewSend).toEqual({ state: 'on' });
    expect(report.capabilities.receipt).toEqual({ state: 'on' });
    expect(report.receiptMatch).toEqual({ profile: 'any-build', kind: 'anyBuild' });
    expect(diagnostics).toContainEqual({ event: 'receipt-profile', detail: { profile: 'any-build', kind: 'anyBuild' } });

    // The reviewed build again: an exact profile is named first, and the report says it is a reviewed one.
    loadModules();
    await host.recheck();
    expect(host.probe().receiptMatch).toEqual({ profile: 'chatspace-test', kind: 'exact' });
    expect(diagnostics.at(-1)).toEqual({ event: 'receipt-profile', detail: { profile: 'chatspace-test', kind: 'exact' } });

    // A sentinel of another adapter version lets nothing in: X8 off, no match reported.
    loadModules({ ...MODULES, inbox: 'N7N7N7N7' });
    await host.configure({ ...CONFIG, receiptProfiles: [{ ...SENTINEL, adapterVersion: '0.2.0' }] });
    expect(host.previewSend).toBeNull();
    expect(host.probe().capabilities.previewSend).toEqual({ state: 'off', reason: 'receiptProfile', code: 'CG-SEND-RECEIPT' });
    expect(host.probe().receiptMatch).toBeUndefined();
  });

  it('[X8-06] the sentinel waits for the send-path modules like any profile: before the main layout loaded, no match', async () => {
    const { notificationEntry: _late, ...early } = { ...MODULES, onlyfans: 'DDDDDDDD' };
    loadModules(early);
    const { host, bridge } = await start({}, { configure: { ...CONFIG, receiptProfiles: [{ id: 'any-build', adapterVersion: ADAPTER_VERSION, modules: { '*': '*' } }] } });
    expect(host.previewSend).toBeNull();
    expect(host.probe().receiptMatch).toBeUndefined();
    loadModules();
    bridge.emit({ t: 'contract', payload: wire() });
    expect(host.previewSend).not.toBeNull();
    expect(host.probe().receiptMatch).toEqual({ profile: 'any-build', kind: 'anyBuild' });
  });

  it('the main layout’s modules load after the page’s first ones: the profile is judged again when the route or the contract changes', async () => {
    // Before the main layout: the queue and the composer’s `onlyfans` module are not there, the small `onlyfans` one is.
    const { notificationEntry: _late, ...early } = { ...MODULES, onlyfans: 'DDDDDDDD' };
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

  it('MAIN’s own word about the tap stands: a probe that comes after `flags`, or while the tap is being switched off, does not switch it on', async () => {
    loadModules();
    const off = { state: 'off', reason: 'wsTap', code: 'CG-SEND-FRESHNESS' };
    /** A page whose tap handle is there (the probe sees it); the probe and the `flags` answer arrive when the test says. */
    const page = () => {
      const gate = { probe: (): void => undefined, flags: (): void => undefined };
      const probed = new Promise<void>((resolve) => (gate.probe = resolve));
      const flagged = new Promise<void>((resolve) => (gate.flags = resolve));
      const bridge = fakeBridge(
        { snapshot: () => snapshot(), listAccounts: () => [account], chatWindow: () => null, fan: () => null, listChats: () => [], flags: () => flagged.then(() => ({ wsTap: false, previewSend: false })) },
        true,
      );
      const probe = bridge.client.probe.bind(bridge.client);
      (bridge.client as { probe: MainBridgeClient['probe'] }).probe = () => probed.then(probe);
      const host = createChatSpaceHostPort({ win: pageWindow, bridge: bridge.client, redeem: () => Promise.resolve(true), mounts, theme, validation: loadValidation });
      return { host, gate };
    };

    // The runtime has no live port (the page took it first): `flags` reads back off although the bootstrap wants the tap.
    const answered = page();
    answered.gate.flags();
    await answered.host.configure(CONFIG);
    expect(answered.host.probe().capabilities.incoming).toEqual(off);
    answered.gate.probe();
    await answered.host.ready;
    expect(answered.host.probe().capabilities.incoming).toEqual(off);
    expect(answered.host.probe().capabilities.previewSend).toEqual(off);
    expect(answered.host.previewSend).toBeNull();
    answered.host.dispose();

    // The bootstrap switches the tap off; the probe arrives while MAIN has not answered yet.
    const pending = page();
    const configured = pending.host.configure({ ...CONFIG, wsTap: false });
    pending.gate.probe();
    await pending.host.ready;
    expect(pending.host.probe().capabilities.incoming).toEqual(off);
    pending.gate.flags();
    await configured;
    expect(pending.host.probe().capabilities.incoming).toEqual(off);
    pending.host.dispose();
  });

  it('[DB-031] before the page’s first chat composer the translator store is not there yet: no port, every send held with CG-SEND-HOST before MAIN is asked — then the store comes and X8 is on', async () => {
    loadModules();
    const { host, bridge } = await start({}, { contract: wire({ notYet: ['composerTranslator'] }) });
    const report = host.probe();
    expect(report.anchors.composerTranslator).toBe('notYet');
    expect(report.capabilities.previewSend).toEqual({ state: 'off', reason: 'composerTranslator', code: 'CG-SEND-HOST' });
    expect(report.capabilities.insert).toEqual({ state: 'on' });
    expect(host.previewSend).toBeNull();
    // The person opens a chat: ChatSpace creates the store with its composer, MAIN says so.
    bridge.emit({ t: 'contract', payload: wire() });
    expect(host.probe().anchors.composerTranslator).toBe('ok');
    expect(host.previewSend).not.toBeNull();
    // A port taken while it was on still refuses by itself the moment the store is «not yet» again (a new document's
    // MAIN): the send is held before MAIN is asked anything.
    const port = host.previewSend;
    bridge.emit({ t: 'contract', payload: wire({ notYet: ['composerTranslator'] }) });
    const asked = bridge.calls.length;
    expect(await port?.preflight(request())).toEqual({ ok: false, code: 'CG-SEND-HOST' });
    expect(await port?.commit(request(), ticket())).toEqual({ state: 'held', code: 'CG-SEND-HOST' });
    expect(bridge.calls.slice(asked).filter((call) => call.t.startsWith('previewSend'))).toEqual([]);
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

  it('[X53] the media a part takes along reach MAIN as they are, in the preflight and in the command', async () => {
    loadModules();
    const { host, bridge } = await start();
    const media = {
      items: [
        { id: '660000155', type: 'photo' as const, duration: 0, thumb: 'https://pw365.ompcdn.com/a.jpg', free: true },
        { id: '660000160', type: 'video' as const, duration: 75, thumb: null, free: false },
      ],
      priceCents: 2500,
      tags: { users: ['77'], guests: [] },
    };
    const req = request({ attemptId: uuid(81), media });
    await host.previewSend?.preflight(req);
    await host.previewSend?.commit(req, ticket({ attemptId: uuid(81) }));
    const sent = bridge.calls.filter((call) => call.t === 'previewSendPreflight' || call.t === 'previewSendCommit');
    expect(sent.map((call) => MainSendRequestSchema.parse(call.payload['req']).media)).toEqual([media, media]);
    // Without media nothing of them is sent.
    await host.previewSend?.commit(request({ attemptId: uuid(82) }), ticket({ attemptId: uuid(82) }));
    expect('media' in (bridge.calls.at(-1)?.payload['req'] as object)).toBe(false);
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

  it('an attempt that may have reached the queue is never forgotten here either: its command after seventy held ones is not a second command', async () => {
    loadModules();
    const answers = new Map<string, unknown>([
      [uuid(100), { state: 'nativeEnqueued', pendingId: 'pending-1' }],
      [uuid(101), { state: 'notEnqueued', code: 'CG-SEND-QUEUE' }],
      [uuid(102), { state: 'uncertain', code: 'CG-SEND-UNCERTAIN' }],
    ]);
    const { host, bridge } = await start({ previewSendCommit: (payload) => answers.get((payload['req'] as { attemptId: string }).attemptId) ?? { state: 'held', code: 'CG-SEND-BUSY' } });
    const port = host.previewSend;
    if (!port) throw new Error('no port');
    const commit = (n: number) => port.commit(request({ attemptId: uuid(n) }), ticket({ attemptId: uuid(n) }));
    const first = [await commit(100), await commit(101), await commit(102)];
    for (let n = 0; n < 70; n += 1) expect(await commit(200 + n)).toEqual({ state: 'held', code: 'CG-SEND-BUSY' });
    const commands = (): string[] => bridge.calls.filter((call) => call.t === 'previewSendCommit').map((call) => (call.payload['req'] as { attemptId: string }).attemptId);
    expect(commands()).toHaveLength(73);
    expect([await commit(100), await commit(101), await commit(102)]).toEqual(first);
    // A held attempt still remembered keeps its answer without a new command; the oldest held ones were let go.
    expect(await commit(269)).toEqual({ state: 'held', code: 'CG-SEND-BUSY' });
    expect(await commit(206)).toEqual({ state: 'held', code: 'CG-SEND-BUSY' });
    expect(commands()).toHaveLength(73);
    await commit(205);
    expect(commands()).toHaveLength(74);
    expect(commands().filter((id) => answers.has(id))).toHaveLength(3);
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

describe('[X8-06] the receipt profile stops matching in the middle of a send (§6.2)', () => {
  const view = (n: number, state: SendAttemptView['state'], over: Partial<SendAttemptView> = {}): SendAttemptView => ({ attemptId: uuid(n), state, ...over });

  it('a send on its way becomes uncertain; of what MAIN still says about it only the late linked pair passes; the next X8 is closed', async () => {
    loadModules();
    const { host, bridge, diagnostics } = await start({
      previewSendCommit: (payload) => {
        const attemptId = (payload['req'] as { attemptId: string }).attemptId;
        return attemptId === uuid(113) ? { state: 'held', code: 'CG-SEND-BUSY' } : { state: 'nativeEnqueued', pendingId: `pending-${attemptId}` };
      },
    });
    const port = host.previewSend;
    if (!port) throw new Error('no port');
    const heard = new Map<number, SendAttemptView[]>();
    const begin = async (n: number): Promise<SendAttemptView[]> => {
      const views: SendAttemptView[] = [];
      heard.set(n, views);
      port.onState(uuid(n), (state) => views.push(state));
      await port.commit(request({ attemptId: uuid(n) }), ticket({ attemptId: uuid(n) }));
      return views;
    };
    const onItsWay = await begin(110);
    const accepted = await begin(111);
    const ended = await begin(112);
    const held = await begin(113);
    bridge.emit({ t: 'previewSendState', payload: { view: view(111, 'nativeAccepted', { platformMessageId: '8011' }) } });
    bridge.emit({ t: 'previewSendState', payload: { view: view(112, 'nativeAccepted', { platformMessageId: '8012' }) } });
    bridge.emit({ t: 'previewSendState', payload: { view: view(112, 'sentObserved', { platformMessageId: '8012' }) } });

    // The page loads a second version of a send-path module; the adapter learns of it at the next contract event.
    loadModules({ ...MODULES, composables: 'CCCCCCCC+CHANGED0' });
    bridge.emit({ t: 'contract', payload: wire() });
    const uncertain = (n: number): SendAttemptView => ({ attemptId: uuid(n), state: 'uncertain', code: 'CG-SEND-UNCERTAIN' });
    expect(onItsWay).toEqual([uncertain(110)]);
    expect(accepted.at(-1)).toEqual(uncertain(111));
    // An attempt that ended, and one that never reached the queue, are not touched.
    expect(ended.map((state) => state.state)).toEqual(['nativeAccepted', 'sentObserved']);
    expect(held).toEqual([]);
    expect(host.previewSend).toBeNull();
    expect(host.probe().capabilities.previewSend).toEqual({ state: 'off', reason: 'receiptProfile', code: 'CG-SEND-RECEIPT' });
    expect(diagnostics.filter((diagnostic) => diagnostic.event === 'x8-profile-lost')).toEqual([
      { event: 'x8-profile-lost', code: 'CG-SEND-UNCERTAIN' },
      { event: 'x8-profile-lost', code: 'CG-SEND-UNCERTAIN' },
    ]);

    // Said once: judging again changes nothing.
    bridge.emit({ t: 'contract', payload: wire({ build: 'index-0001fake' }) });
    expect(onItsWay).toHaveLength(1);
    // A receipt read through a path that is no longer the approved one proves nothing; nor does a refusal or a second «uncertain».
    bridge.emit({ t: 'previewSendState', payload: { view: view(110, 'nativeAccepted', { platformMessageId: '8010' }) } });
    expect(onItsWay).toHaveLength(1);
    bridge.emit({ t: 'previewSendState', payload: { view: view(111, 'uncertain', { code: 'CG-SEND-UNCERTAIN' }) } });
    expect(accepted.map((state) => state.state)).toEqual(['nativeAccepted', 'uncertain']);
    // The old set is back and gone again (a module loaded twice, then a third version): what was said is not said again.
    loadModules();
    bridge.emit({ t: 'contract', payload: wire() });
    expect(host.previewSend).not.toBeNull();
    loadModules({ ...MODULES, composables: 'CHANGED1' });
    bridge.emit({ t: 'contract', payload: wire() });
    expect(onItsWay).toHaveLength(1);
    // The late linked pair — the receipt and the echo with the same id — is the one way out of «uncertain» (§6.7.7).
    bridge.emit({ t: 'previewSendState', payload: { view: view(110, 'sentObserved', { platformMessageId: '8010' }) } });
    expect(onItsWay.map((state) => state.state)).toEqual(['uncertain', 'sentObserved']);
  });

  it('a send whose command MAIN has not answered yet is not called uncertain: it may still turn out held; one that ended before the answer is not followed', async () => {
    loadModules();
    const answers = new Map<string, (answer: unknown) => void>();
    const { host, bridge } = await start({ previewSendCommit: (payload) => new Promise((resolve) => answers.set((payload['req'] as { attemptId: string }).attemptId, resolve)) });
    const port = host.previewSend;
    if (!port) throw new Error('no port');
    const heard: SendAttemptView[] = [];
    for (const n of [130, 131]) port.onState(uuid(n), (state) => heard.push(state));
    const asked = port.commit(request({ attemptId: uuid(130) }), ticket({ attemptId: uuid(130) }));
    const ended = port.commit(request({ attemptId: uuid(131) }), ticket({ attemptId: uuid(131) }));
    await vi.waitFor(() => expect(answers.size).toBe(2));
    // MAIN said the end of the second one before its command's answer came back.
    bridge.emit({ t: 'previewSendState', payload: { view: view(131, 'rejected', { code: 'CG-SEND-REJECTED', httpStatus: 403 }) } });
    answers.get(uuid(131))?.({ state: 'nativeEnqueued', pendingId: 'pending-131' });
    await ended;
    loadModules({ ...MODULES, composables: 'CHANGED0' });
    bridge.emit({ t: 'contract', payload: wire() });
    expect(heard.map((state) => [state.attemptId, state.state])).toEqual([[uuid(131), 'rejected']]);
    answers.get(uuid(130))?.({ state: 'held', code: 'CG-SEND-BUSY' });
    expect(await asked).toEqual({ state: 'held', code: 'CG-SEND-BUSY' });
    expect(heard).toHaveLength(1);
  });

  it('the flag going off is not a mismatch: a send already started is followed to its end', async () => {
    loadModules();
    const { host, bridge } = await start();
    const views: SendAttemptView[] = [];
    host.previewSend?.onState(uuid(120), (state) => views.push(state));
    await host.previewSend?.commit(request({ attemptId: uuid(120) }), ticket({ attemptId: uuid(120) }));
    await host.configure({ ...CONFIG, previewSend: false });
    bridge.emit({ t: 'contract', payload: wire() });
    expect(views).toEqual([]);
    bridge.emit({ t: 'previewSendState', payload: { view: view(120, 'nativeAccepted', { platformMessageId: '8020' }) } });
    expect(views.map((state) => state.state)).toEqual(['nativeAccepted']);
    // The flag comes back on a page whose modules changed meanwhile: the send that is still on its way is uncertain.
    loadModules({ ...MODULES, notificationEntry: 'NEWBUILD' });
    await host.configure(CONFIG);
    expect(views.map((state) => state.state)).toEqual(['nativeAccepted', 'uncertain']);
  });
});

describe('[X8-06] the fuse (decision X25): after a send, X8 is off when the receipt is not what we sent', () => {
  const fact = { attemptId: uuid(140), reason: 'text', where: 'echo', sentChars: 21, seenChars: 9 } as const;
  const tripped = (over: Record<string, unknown> = {}) => ({ trippedAt: Date.now(), reason: 'text' as const, where: 'echo' as const, build: 'index-0000fake', attemptId: uuid(140), ...over });

  it('MAIN’s word turns X8 off in this document at once: no port, CG-SEND-FUSE before MAIN is asked again; the tab hears it once, the log with its code and no text', async () => {
    loadModules();
    const { host, bridge, events, diagnostics } = await start();
    const port = host.previewSend;
    if (!port) throw new Error('no port');
    bridge.emit({ t: 'previewSendFuse', payload: fact });
    expect(host.previewSend).toBeNull();
    expect(host.probe().capabilities.previewSend).toEqual({ state: 'off', reason: 'fuse', code: 'CG-SEND-FUSE' });
    // The rest of the adapter is untouched: «Открыть и вставить» still works.
    expect(host.probe().capabilities.insert).toEqual({ state: 'on' });
    expect(host.probe().capabilities.receipt).toEqual({ state: 'on' });
    expect(events.filter((event) => event.type === 'sendFuse')).toEqual([{ type: 'sendFuse', fuse: fact }]);
    expect(diagnostics.filter((diagnostic) => diagnostic.event === 'x8-fuse')).toEqual([
      { event: 'x8-fuse', code: 'CG-SEND-FUSE', detail: { reason: 'text', where: 'echo', first: true, sentChars: 21, seenChars: 9 } },
    ]);
    // A port kept from before refuses on its own: nothing more reaches MAIN, and nothing is sent again.
    const commits = (): number => bridge.calls.filter((call) => call.t === 'previewSendCommit').length;
    expect(await port.preflight(request())).toEqual({ ok: false, code: 'CG-SEND-FUSE' });
    expect(await port.commit(request({ attemptId: uuid(141) }), ticket({ attemptId: uuid(141) }))).toEqual({ state: 'held', code: 'CG-SEND-FUSE' });
    expect(commits()).toBe(0);
    // A second word (another reason) is logged, not a second trip.
    bridge.emit({ t: 'previewSendFuse', payload: { attemptId: uuid(142), reason: 'count', where: 'echo' } });
    expect(diagnostics.filter((diagnostic) => diagnostic.event === 'x8-fuse').map((diagnostic) => diagnostic.detail?.['first'])).toEqual([true, false]);
  });

  it('a trip of this document holds until the person resets the fuse after it; a reset from before it does not lift it', async () => {
    loadModules();
    const { host, bridge } = await start();
    const before = Date.now() - 60_000;
    bridge.emit({ t: 'previewSendFuse', payload: fact });
    // The background has not heard yet, or kept the trip: off either way.
    await host.configure({ ...CONFIG, fuse: { fuse: null, resetAt: before } });
    expect(host.previewSend).toBeNull();
    await host.configure({ ...CONFIG, fuse: { fuse: tripped(), resetAt: before } });
    expect(host.probe().capabilities.previewSend).toEqual({ state: 'off', reason: 'fuse', code: 'CG-SEND-FUSE' });
    // «Сбросить предохранитель»: X8 is on again, on the same build.
    const resetAt = Date.now() + 1;
    await host.configure({ ...CONFIG, fuse: { fuse: null, resetAt } });
    expect(host.previewSend).not.toBeNull();
    expect(host.probe().capabilities.previewSend).toEqual({ state: 'on' });
    // It trips again after the reset: off again, until a reset after this trip.
    vi.useFakeTimers({ now: resetAt + 1000 });
    bridge.emit({ t: 'previewSendFuse', payload: { ...fact, attemptId: uuid(144) } });
    expect(host.previewSend).toBeNull();
    expect(host.probe().capabilities.previewSend).toEqual({ state: 'off', reason: 'fuse', code: 'CG-SEND-FUSE' });
    await host.configure({ ...CONFIG, fuse: { fuse: null, resetAt: resetAt + 2000 } });
    expect(host.previewSend).not.toBeNull();
  });

  it('the browser’s fuse holds the build it tripped on — another build is on by itself; one that names no build holds every build', async () => {
    loadModules();
    const { host, bridge } = await start();
    await host.configure({ ...CONFIG, fuse: { fuse: tripped(), resetAt: null } });
    expect(host.previewSend).toBeNull();
    expect(host.probe().capabilities.previewSend).toEqual({ state: 'off', reason: 'fuse', code: 'CG-SEND-FUSE' });
    // ChatSpace shipped a new build under the open page (its entry module changed): the fuse does not hold it.
    bridge.emit({ t: 'contract', payload: wire({ build: 'index-0001fake' }) });
    expect(host.previewSend).not.toBeNull();
    // Two builds in a row tripped: every build is held until the reset.
    await host.configure({ ...CONFIG, fuse: { fuse: tripped({ build: null }), resetAt: null } });
    expect(host.previewSend).toBeNull();
    // The owner's switch still speaks first.
    await host.configure({ ...CONFIG, previewSend: false, fuse: { fuse: tripped({ build: null }), resetAt: null } });
    expect(host.probe().capabilities.previewSend).toEqual({ state: 'off', reason: 'flag', code: 'CG-SEND-OFF' });
  });

  it('a send on its way when the fuse trips goes on to its end: the fuse turns nothing uncertain and repeats nothing', async () => {
    loadModules();
    const { host, bridge } = await start();
    const port = host.previewSend;
    if (!port) throw new Error('no port');
    const heard: SendAttemptView[] = [];
    port.onState(uuid(143), (state) => heard.push(state));
    expect(await port.commit(request({ attemptId: uuid(143) }), ticket({ attemptId: uuid(143) }))).toMatchObject({ state: 'nativeEnqueued' });
    bridge.emit({ t: 'previewSendFuse', payload: { attemptId: uuid(140), reason: 'target', where: 'echo' } });
    bridge.emit({ t: 'previewSendState', payload: { view: { attemptId: uuid(143), state: 'nativeAccepted', platformMessageId: '8020' } } });
    bridge.emit({ t: 'previewSendState', payload: { view: { attemptId: uuid(143), state: 'sentObserved', platformMessageId: '8020' } } });
    expect(heard.map((state) => state.state)).toEqual(['nativeAccepted', 'sentObserved']);
    expect(bridge.calls.filter((call) => call.t === 'previewSendCommit')).toHaveLength(1);
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
