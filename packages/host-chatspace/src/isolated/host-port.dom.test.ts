// HostPort over a scripted bridge client (what MAIN would answer), checked
// against the contracts: snapshots and events in, receipts out.

import type { ToMainType } from '@cg/contracts/bridge';
import type { AttachIntent, ComposerState, HostEvent, HostIdentity, HostTheme, InsertIntent, MountPoints, NavigationIntent } from '@cg/contracts/host';
import { InsertReceiptSchema, NavigationReceiptSchema } from '@cg/contracts/host';
import { ATTACH_LIMITS } from '@cg/contracts/limits';
import { beforeEach, describe, expect, it } from 'vitest';

import { BridgeCallError, type BridgeEvent, type MainBridgeClient } from './bridge-client';
import { createChatSpaceHostPort, HostContractError, type ChatSpaceHostPort, type HostDiagnostic } from './host-port';
import { loadValidation } from './validation';
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
  const renewed = new Set<() => void>();
  const points: MountPoints = { dock: { kind: 'in-flow', composerInstanceId: 'c1', width: 700 }, overlay: { ready: true, container: null } };
  const mounts = {
    update: (state: ComposerState | null) => updates.push(state),
    refresh: () => undefined,
    points: () => points,
    onChange: () => () => undefined,
    onRenewed: (listener: () => void) => (renewed.add(listener), () => renewed.delete(listener)),
    frameAnchor: () => frame,
    dispose: () => undefined,
  } as unknown as MountManager;
  /** The dock went over new nodes of the composer MAIN still names (mount.ts `onRenewed`). */
  const renew = (): void => renewed.forEach((listener) => listener());
  return { mounts, updates, renew, setFrame: (value: 'ok' | 'missing') => (frame = value) };
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

async function port(answers: Partial<Record<ToMainType, Answer>> = {}, options: { redeem?: boolean; drafts?: ReturnType<typeof storage>; navInsertTimeoutMs?: number | (() => number | undefined) } = {}) {
  const bridge = fakeBridge({ snapshot: () => snapshot(), listAccounts: () => [account], chatWindow: () => null, fan: () => null, listChats: () => [], ...answers });
  const { mounts, updates, renew, setFrame } = fakeMounts();
  const redeemed: string[] = [];
  const diagnostics: HostDiagnostic[] = [];
  const host = createChatSpaceHostPort({
    win: window,
    bridge: bridge.client,
    validation: loadValidation,
    redeem: (request) => {
      redeemed.push(`${request.kind}:${request.intentId}:${request.actionToken}`);
      return Promise.resolve(options.redeem ?? true);
    },
    mounts,
    theme: themeStub,
    drafts: options.drafts ?? null,
    navInsertTimeoutMs: options.navInsertTimeoutMs ?? 20_000,
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  await host.ready;
  return { host, bridge, updates, redeemed, diagnostics, renew, setFrame };
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
  it('[RB-015] a route event moves the epoch and drops the composer of the chat we left; composer events move the dock', async () => {
    const { host, bridge, updates } = await port();
    const seen: HostEvent['type'][] = [];
    host.subscribe((event) => seen.push(event.type));
    bridge.emit({ t: 'route', payload: { route: { epoch: 5, name: 'chat', account, chat: chat(OTHER) }, hostLoginEpoch: 'L1' } });
    expect(host.identity()).toMatchObject({ routeEpoch: 5, chat: chat(OTHER), composerInstanceId: null });
    expect(host.current().composer).toBeNull();
    // The dock leaves the composer of the chat we left at once, not when MAIN reports the next one.
    expect(updates.at(-1)).toBeNull();
    bridge.emit({ t: 'composer', payload: { state: composer({ chat: chat(OTHER), instanceId: 'c2' }) } });
    expect(host.identity()?.composerInstanceId).toBe('c2');
    expect(updates.at(-1)).toMatchObject({ instanceId: 'c2' });
    expect(seen).toEqual(['composer', 'route', 'composer']);
  });

  it('[RB-015] events of the two types may come out of order (each is coalesced on its own); a late route of a chat already left does not lose the composer MAIN will not repeat', async () => {
    // What `pnpm perf` met after quick switches: MAIN reported the composer of the chat it came back to while that
    // chat's route event still waited in MAIN's coalescing, and a route event of a chat in between, held here by the
    // client's coalescing, came after it. MAIN never sends an unchanged state again: dropping the composer on that
    // late route left the dock «copy only» (CG-HOST-COMPOSER-MISSING) over a field that was there.
    const THIRD = '2004';
    const { host, bridge, updates } = await port();
    const route = (epoch: number, fan: string): BridgeEvent => ({ t: 'route', payload: { route: { epoch, name: 'chat', account, chat: chat(fan) }, hostLoginEpoch: 'L1' } });
    bridge.emit(route(5, OTHER));
    bridge.emit({ t: 'composer', payload: { state: null } });
    bridge.emit(route(6, THIRD));
    // MAIN is back on FAN (epochs 7 and 8), its route event not out yet: the composer of FAN comes first…
    bridge.emit({ t: 'composer', payload: { state: composer({ instanceId: 'c9' }) } });
    // …while this side is still on THIRD: no composer of the open chat yet.
    expect(host.identity()?.composerInstanceId).toBeNull();
    // The route of a chat MAIN has already left, then the route MAIN is on.
    bridge.emit(route(7, OTHER));
    expect(host.current().composer).toBeNull();
    bridge.emit(route(8, FAN));
    expect(host.identity()).toMatchObject({ routeEpoch: 8, chat: chat(), composerInstanceId: 'c9' });
    expect(host.current().composer).toMatchObject({ instanceId: 'c9', ready: true });
    expect(updates.at(-1)).toMatchObject({ instanceId: 'c9' });
  });

  it('[RB-014] [RB-015] an answer from the middle of a chat switch never becomes this side’s composer: «none yet» told to a question does not outlive the switch back, which MAIN has no event for', async () => {
    // CI on PR #16: a snapshot asked during a switch said «no composer yet», was taken as the composer, and MAIN — back
    // on the first chat before it had sent anything — had nothing new to say: the dock stayed «copy only» for good.
    let answer: Record<string, unknown> = snapshot();
    let lost = false;
    const { host, renew, updates } = await port({ snapshot: () => (lost ? Promise.reject(new BridgeCallError('timeout', 'snapshot')) : answer) });
    expect(host.identity()?.composerInstanceId).toBe('c1');
    const told = updates.length;
    answer = snapshot({ route: { epoch: 5, name: 'chat', account, chat: chat(OTHER) }, composer: null });
    renew();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // MAIN sends no composer event: when it looks, it is on the first chat again with the composer it last told of.
    expect(host.identity()).toMatchObject({ routeEpoch: 4, chat: chat(), composerInstanceId: 'c1' });
    expect(host.current().composer).toMatchObject({ instanceId: 'c1', ready: true });
    expect(updates.length).toBe(told);
    // A question that got no answer changes nothing either.
    lost = true;
    renew();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.identity()?.composerInstanceId).toBe('c1');
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
    expect(await host.insert(insertIntent({ expected: { ...insertIntent().expected, composerInstanceId: 'c9' } as InsertIntent['expected'] }))).toEqual({ state: 'rejected', code: 'CG-INSERT-CHAT-CHANGED' });
    expect(await host.insert(insertIntent({ expected: { ...insertIntent().expected, documentEpoch: 'doc0' } }))).toEqual({ state: 'rejected', code: 'CG-INSERT-CHAT-CHANGED' });
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
});

describe('navigation (§6.5, §6.9)', () => {
  const nav = (over: Partial<NavigationIntent> = {}): NavigationIntent => ({ intentId: uuid(10), cause: { kind: 'click', actionToken: TOKEN }, target: { hostAccountId: ACC, platformFanId: OTHER }, ...over });
  const thenInsert = { ...insertIntent({ target: chat(OTHER), expected: { kind: 'deferred', documentEpoch: 'doc1' }, expiresAt: Date.now() + 5000 }), cause: undefined } as unknown as Record<string, unknown>;
  delete thenInsert['cause'];
  // The deadline is five seconds from each test's start, not from collecting the file: on a loaded runner the gap ate
  // into it and the bridge's wait came out under 5000 ms.
  beforeEach(() => {
    thenInsert['expiresAt'] = Date.now() + 5000;
  });

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

  it('[NEW-01] MAIN’s deadline is never later than this side’s: a far insert deadline is lowered to the navigation timeout', async () => {
    const { host, bridge } = await port({ navigate: () => ({ state: 'navigated', routeEpoch: 5, insert: { state: 'rejected', code: 'CG-NAV-TIMEOUT' } }) });
    const far = { ...thenInsert, expiresAt: Date.now() + 120_000 };
    const started = Date.now();
    await host.navigate(nav({ thenInsert: far as never }));
    const call = bridge.calls.find((item) => item.t === 'navigate');
    const sent = (call?.payload['intent'] as { thenInsert: { expiresAt: number } }).thenInsert;
    expect(sent.expiresAt).toBeLessThanOrEqual(Date.now() + 20_000);
    expect(sent.expiresAt).toBeGreaterThanOrEqual(started + 20_000);
    expect(call?.timeoutMs).toBeLessThanOrEqual(21_000);
    expect(call?.timeoutMs).toBeGreaterThanOrEqual(sent.expiresAt - Date.now());
  });

  it('[NEW-01] the deferred insert’s applied receipt is checked against the target’s draft key too', async () => {
    const drafts = storage({ [`chat-space:draft:of:${ACC}:${OTHER}`]: storedDraft('other text') });
    const { host } = await port({ navigate: () => ({ state: 'navigated', routeEpoch: 5, insert: { state: 'applied', draftRevision: 2, draftDigest: '00000000000000cc', ms: 3 } }) }, { drafts });
    expect(await host.navigate(nav({ thenInsert: thenInsert as never }))).toEqual({ state: 'navigated', routeEpoch: 5, insert: { state: 'uncertain', code: 'CG-INSERT-UNCERTAIN' } });
  });

  it('[NEW-01] aborting the signal while MAIN waits sends cancelInsert for the deferred insert; aborted before, the insert never leaves', async () => {
    let answer: (value: unknown) => void = () => undefined;
    const { host, bridge } = await port({ navigate: () => new Promise((resolve) => (answer = resolve)), cancelInsert: () => ({ canceled: true }) });
    const controller = new AbortController();
    const pending = host.navigate(nav({ thenInsert: thenInsert as never }), { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    expect(bridge.calls.filter((call) => call.t === 'cancelInsert').map((call) => call.payload)).toEqual([{ intentId: thenInsert['intentId'] }]);
    answer({ state: 'navigated', routeEpoch: 5, insert: { state: 'rejected', code: 'CG-INSERT-CANCELED' } });
    expect(await pending).toEqual({ state: 'navigated', routeEpoch: 5, insert: { state: 'rejected', code: 'CG-INSERT-CANCELED' } });
    // A later abort reaches nothing.
    controller.abort();
    expect(bridge.calls.filter((call) => call.t === 'cancelInsert')).toHaveLength(1);

    const early = await port({ navigate: () => ({ state: 'navigated', routeEpoch: 6, insert: null }) });
    const aborted = new AbortController();
    aborted.abort();
    expect(await early.host.navigate(nav({ thenInsert: thenInsert as never }), { signal: aborted.signal })).toEqual({ state: 'navigated', routeEpoch: 6, insert: { state: 'rejected', code: 'CG-INSERT-CANCELED' } });
    expect(early.bridge.calls.find((call) => call.t === 'navigate')?.payload['intent']).not.toHaveProperty('thenInsert');
  });
});

describe('a file of ours into the composer (1.46.0)', () => {
  const NAME = `${uuid(31)}.mp3`;
  const KEY = `chat-space:draft:of:${ACC}:${FAN}`;
  const attachIntent = (host: ChatSpaceHostPort, expected: Partial<HostIdentity> = {}): AttachIntent => ({
    intentId: uuid(30),
    expected: { ...(host.identity() as HostIdentity), ...expected },
    cause: { kind: 'click', actionToken: TOKEN },
    file: { name: NAME, type: 'audio/mpeg', bytes: new ArrayBuffer(32) },
  });
  /** The chat's draft key as ChatSpace writes it, with its media (`uploadDescriptor` — the person's upload of a file). */
  const stored = (medias: readonly Record<string, unknown>[], gif: unknown = null) =>
    JSON.stringify({ body: { json: null, gif, media: medias.length > 0 ? { medias, price: null, lockedText: false } : null, taggedCreators: [] }, updatedAt: 1 });
  const uploaded = (name = NAME) => ({ id: 'p1', type: 'audio', isFree: true, uploadDescriptor: { processId: 'p1', host: 'h', name, extra: null } });

  it('spends the click’s token first, hands MAIN the file without it, and keeps an outcome the draft key shows', async () => {
    const drafts = storage();
    const order: number[] = [];
    let redeemedAtMain: () => number = () => -1;
    const { host, bridge, redeemed } = await port(
      {
        attachFile: () => {
          order.push(redeemedAtMain());
          drafts.entries[KEY] = stored([uploaded()]);
          return { state: 'attached', ms: 900 };
        },
      },
      { drafts },
    );
    redeemedAtMain = () => redeemed.length;
    const intent = attachIntent(host);
    expect(await host.attachFile(intent)).toEqual({ state: 'attached', ms: 900 });
    expect(order).toEqual([1]);
    expect(redeemed).toEqual([`insert:${intent.intentId}:${TOKEN}`]);
    const sent = bridge.calls.filter((call) => call.t === 'attachFile');
    expect(sent.map((call) => [call.payload, call.timeoutMs])).toEqual([[{ intentId: intent.intentId, expected: intent.expected, file: intent.file }, ATTACH_LIMITS.bridgeMs]]);
    expect(JSON.stringify(bridge.calls)).not.toContain(TOKEN);
    // A broken intent is a programming error: a name that is not the page's own kind.
    await expect(host.attachFile({ ...intent, file: { ...intent.file, name: 'voice.mp3' } })).rejects.toThrow(HostContractError);
  });

  it('the draft key decides MAIN’s word: our file there is attached, MAIN’s attached without it is unknown, a silent key leaves it', async () => {
    const drafts = storage();
    let main: unknown = null;
    let after: string | null = null;
    const { host, diagnostics } = await port(
      {
        attachFile: () => {
          if (after === null) delete drafts.entries[KEY];
          else drafts.entries[KEY] = after;
          return main;
        },
      },
      { drafts },
    );
    // MAIN lost sight of the upload; the draft holds our file by its name — or, the vault holding that audio already, a medium it did not have.
    main = { state: 'unknown' };
    after = stored([uploaded()]);
    expect(await host.attachFile(attachIntent(host))).toMatchObject({ state: 'attached' });
    main = { state: 'not-attached', reason: 'site-refused' };
    after = stored([{ id: '880001', type: 'audio', isFree: true }]);
    delete drafts.entries[KEY];
    expect(await host.attachFile(attachIntent(host))).toMatchObject({ state: 'attached' });
    // Another person's upload is not ours: MAIN's word stands — and MAIN's attached against it is unknown.
    after = stored([uploaded(`${uuid(99)}.mp3`)]);
    delete drafts.entries[KEY];
    expect(await host.attachFile(attachIntent(host))).toEqual({ state: 'not-attached', reason: 'site-refused' });
    main = { state: 'attached', ms: 5 };
    delete drafts.entries[KEY];
    expect(await host.attachFile(attachIntent(host))).toEqual({ state: 'unknown' });
    expect(diagnostics).toContainEqual({ event: 'attach-key-disagrees', code: 'CG-VOICE-ATTACH-UNKNOWN' });
    // No key at all says nothing: MAIN's word.
    after = null;
    delete drafts.entries[KEY];
    expect(await host.attachFile(attachIntent(host))).toEqual({ state: 'attached', ms: 5 });
  });

  it('refused before the token is spent: another composer, a draft holding an audio or a GIF; a refused token or a refusal before execution reaches nothing; a lost answer is unknown, asked once', async () => {
    const drafts = storage();
    const { host, bridge, redeemed } = await port({ attachFile: () => ({ state: 'attached', ms: 1 }) }, { drafts });
    expect(await host.attachFile(attachIntent(host, { composerInstanceId: 'c9' }))).toEqual({ state: 'refused', reason: 'identity' });
    expect(await host.attachFile(attachIntent(host, { routeEpoch: 3 }))).toEqual({ state: 'refused', reason: 'identity' });
    expect(await host.attachFile(attachIntent(host, { chat: chat(OTHER) }))).toEqual({ state: 'refused', reason: 'identity' });
    drafts.entries[KEY] = stored([{ id: '7', type: 'audio', isFree: true }]);
    expect(await host.attachFile(attachIntent(host))).toEqual({ state: 'refused', reason: 'busy' });
    drafts.entries[KEY] = stored([], { id: 'gif-1' });
    expect(await host.attachFile(attachIntent(host))).toEqual({ state: 'refused', reason: 'busy' });
    expect(redeemed).toEqual([]);
    expect(bridge.calls.some((call) => call.t === 'attachFile')).toBe(false);

    const refused = await port({ attachFile: () => ({ state: 'attached', ms: 1 }) }, { redeem: false });
    expect(await refused.host.attachFile(attachIntent(refused.host))).toEqual({ state: 'refused', reason: 'cause' });
    expect(refused.bridge.calls.some((call) => call.t === 'attachFile')).toBe(false);

    const old = await port({ attachFile: () => Promise.reject(new BridgeCallError('unknown-request', 'attachFile')) });
    expect(await old.host.attachFile(attachIntent(old.host))).toEqual({ state: 'refused', reason: 'anchor-missing' });
    const lost = await port({ attachFile: () => Promise.reject(new BridgeCallError('timeout', 'attachFile')) });
    expect(await lost.host.attachFile(attachIntent(lost.host))).toEqual({ state: 'unknown' });
    expect(lost.bridge.calls.filter((call) => call.t === 'attachFile')).toHaveLength(1);
  });
});
