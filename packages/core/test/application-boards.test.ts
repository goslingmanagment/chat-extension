// The R12 surface controllers end to end inside a tab: the Spenders board
// and its statistics, previews, «Новые» and the fan panel over the tab
// protocol — answered by the real R10 scheduler, tokens and send coordinator
// with the fake hub behind them — and over the fake host port. What is
// checked is what a person would see and what leaves the tab: the view
// models, the requests, and every write to the host.

import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, type Bootstrap, type CgCode, type HostContractReport, type HostEvent, type HostPort, type HubFrame, type NavigateOptions, type NavigationIntent, type NavigationReceipt, type NewcomerRowVM, type PartVM, type PersonaCatalog, type PreviewSource, type SendAttemptView, type SessionIdentity, type SettingsV1, type SpendersBoardVM, type UiAction, type ViewSelector } from '@cg/contracts';
import { createBoardsControllers, fanHandle, type BoardsControllers, type PreviewSendClick } from '@cg/core/application/boards';
import { type BoardHandover } from '@cg/core/application/preview';
import { FEED_PAGE_SIZE } from '@cg/core/application/preview';
import { createI18n, type LiveI18n } from '@cg/core/domain/i18n';
import { PreviewSendDriver } from '@cg/core/services';
import { createFakeHub, hubCall, type FakeHub, type FakeHubConfigPatch } from '@cg/testing/fake-hub';
import { DOCUMENT, FakeHostPort, HOST_IDS, contractReport, hostAccount, memory as hostMemory, startSnapshot, type FakeMediaVault, type HostAnswers, type HostScript, type HostStep } from '@cg/testing/host';
import { NOW_MS, WORLD, contextFrame, meta } from '@cg/testing/hub';

import { BoardsBackground } from './support/boards-background';
import { FakeClock, sequentialIds, settle } from './support/clock';
import { type ScriptStep } from './support/fake-hub';

const TAB = '00000000-0000-4000-8000-0000000000a1';
const PAGE = WORLD.pages.one;
const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const iso = (ms: number): string => new Date(ms).toISOString();

const session: SessionIdentity = { hubOrigin: WORLD.hubOrigin, userId: WORLD.user.userId, login: WORLD.user.username, role: 'chatter', epoch: 3 };
const settings: SettingsV1 = {
  ...DEFAULT_SETTINGS,
  generation: { ...DEFAULT_SETTINGS.generation, split: true },
  personas: { scope: { hubOrigin: WORLD.hubOrigin, userId: WORLD.user.userId }, byPageId: { [String(PAGE.pageId)]: { key: WORLD.persona.key, definitionId: WORLD.persona.definitionId } } },
};
const catalog: PersonaCatalog = { personas: [{ key: WORLD.persona.key, displayName: 'Лора · VIP', version: 3, definitionId: WORLD.persona.definitionId, status: 'active' }] };

/** The owner switched X8 on for the page and approved a receipt profile. */
const X8: FakeHubConfigPatch = {
  flags: { previewSend: true, previewSendMarkAiGenerated: true },
  limits: { previewSendReceiptProfiles: [{ id: 'chatspace-0.172', adapterVersion: '1.0.0', modules: { notificationEntry: 'sha256-0001' } }] },
};

interface Options {
  readonly config?: FakeHubConfigPatch;
  readonly session?: SessionIdentity | null;
  readonly answers?: HostAnswers;
  /** The fan whose checkpoint MAIN gives; null — MAIN gives none. */
  readonly checkpointFan?: string | null;
  readonly start?: Partial<HostScript['start']>;
  readonly memory?: Partial<HostScript['memory']>;
  readonly watchForSound?: boolean;
  readonly queuePageSize?: number;
  readonly audiencePageSize?: number;
  readonly clipboard?: boolean;
  readonly storedDrafts?: unknown;
  /** The host answers a navigation only when the test releases it (a chat that takes its time to open). */
  readonly slowNavigate?: boolean;
  /** 1.20.0: the site's own fan panel stands next to the chat (ChatSpace 0.195). */
  readonly fanPanelBesideHost?: boolean;
  /** 1.30.0 (X53): the vault the media picker reads; absent — the host has none. */
  readonly media?: FakeMediaVault;
}

interface Harness {
  readonly clock: FakeClock;
  readonly hub: FakeHub;
  readonly bg: BoardsBackground;
  readonly host: FakeHostPort;
  readonly timeline: HostStep[];
  readonly i18n: LiveI18n;
  /** The controllers of the tab as it is now (a `reload()` makes new ones). */
  readonly boards: BoardsControllers;
  readonly driver: PreviewSendDriver;
  /** F5: the tab's controllers and send driver are gone with their memory; new ones start over the same background, host and storage. */
  reload(): Promise<void>;
  /** Another ChatSpace tab of the same person: controllers of its own (and a memory of its own) over the same background and storage. */
  secondTab(): Promise<BoardsControllers>;
  readonly clicks: PreviewSendClick[];
  readonly notes: { readonly code: CgCode; readonly scope: string }[];
  /** What «Открыть и вставить» handed to the dock of the opened chat (§6.5). */
  readonly handovers: BoardHandover[];
  readonly copied: string[];
  /** `newcomers.drafts` as every tab of the browser shares it: `external` is another tab's write, `failSaves` the browser refusing writes. */
  readonly draftStore: { value: unknown; saves: number; failSaves: number; external(value: unknown): void };
  readonly fresh: { readonly eventRef: string; readonly fanRef: string }[][];
  readonly online: { set(value: boolean): void };
  /** Navigations the host has not answered yet (`slowNavigate`). */
  readonly nav: { pending(): number; aborted(): number; release(): void };
  readonly bootstrap: Bootstrap;
  dispatch(action: UiAction): Promise<Awaited<NonNullable<ReturnType<BoardsControllers['spenders']['dispatch']>>>>;
  /** Moves both clocks (the tab's and the hub's) and lets everything settle. */
  advance(ms: number): Promise<void>;
  flush(): Promise<void>;
  /** A host event now (a route change, an incoming message). */
  hostEvent(event: HostEvent): void;
  /** The host's contract report changes now (a store ChatSpace created, a profile that matched). */
  hostContract(report: HostContractReport): void;
  /** A state MAIN observed for an attempt. */
  sendState(view: SendAttemptView): void;
  /** Scripts the next AI stream of the operation with the n-th id (0 — the first Generate). */
  script(n: number, feature: Parameters<typeof meta>[0], text: string, known?: readonly string[]): { readonly opId: string; readonly generationRef: string };
}

const live: Harness[] = [];
const extraTabs: BoardsControllers[] = [];
afterEach(() => {
  for (const tab of extraTabs.splice(0)) tab.dispose();
  for (const h of live.splice(0)) {
    h.boards.dispose();
    h.driver.dispose();
    h.host.dispose();
  }
});

async function harness(options: Options = {}): Promise<Harness> {
  const clock = new FakeClock(NOW_MS);
  const hub = createFakeHub({ clock: NOW_MS, preset: 'pilot-on', ...(options.config === undefined ? {} : { config: options.config }) });
  const token = hub.issueToken();
  const call = async (route: Parameters<typeof hubCall>[2], request: unknown) => {
    const response = await hubCall(hub.fetch, hub.origin, route, request, { token });
    const retry = response.headers.get('retry-after');
    const body: unknown = await response.json();
    return retry === null ? { status: response.status, body } : { status: response.status, body, retryAfterSec: Number(retry) };
  };
  const bootstrap = (await call('clientBootstrap', null)).body as Bootstrap;
  const bg = new BoardsBackground({
    clock,
    call,
    session: options.session === undefined ? session : options.session,
    bootstrap,
    settings,
    catalog,
    tab: TAB,
    instanceId: WORLD.instanceId,
    ...(options.audiencePageSize === undefined ? {} : { audiencePageSize: options.audiencePageSize }),
  });

  const checkpointFan = options.checkpointFan === undefined ? '5000' : options.checkpointFan;
  const timeline: HostStep[] = [];
  const script: HostScript = {
    start: { ...startSnapshot, ...options.start },
    memory: { ...hostMemory, ...options.memory },
    checkpoint:
      checkpointFan === null
        ? null
        : {
            documentEpoch: DOCUMENT,
            socketEpoch: 1,
            subscriptionEpoch: 1,
            hostAccountId: HOST_IDS.acc,
            platformFanId: checkpointFan,
            fanSequence: 2,
            lastFanMessageId: HOST_IDS.messages.fanBefore,
            knownFanMessageIds: [HOST_IDS.messages.fanBefore, HOST_IDS.messages.fanEarlier],
            observedAt: NOW_MS,
            coverage: 'ok',
          },
    answers: options.answers ?? {},
    timeline,
    ...(options.media === undefined ? {} : { media: options.media }),
  };
  const host = new FakeHostPort(script, NOW_MS);
  const waiting: { aborted: boolean; run(): void }[] = [];
  const slowNavigate = (intent: NavigationIntent, navigateOptions?: NavigateOptions): Promise<NavigationReceipt> =>
    new Promise((resolve) => {
      const entry = {
        aborted: false,
        run: (): void => {
          // The navigation itself is not undone; an aborted insert is not written (HostPort.navigate).
          void host.navigate(intent).then((receipt) => resolve(entry.aborted && receipt.state === 'navigated' ? { ...receipt, insert: { state: 'rejected', code: 'CG-INSERT-CANCELED' } } : receipt));
        },
      };
      navigateOptions?.signal?.addEventListener('abort', () => {
        entry.aborted = true;
      });
      waiting.push(entry);
    });
  const port: HostPort =
    options.slowNavigate !== true
      ? host
      : new Proxy(host, {
          get(target, property) {
            if (property === 'navigate') return slowNavigate;
            const value: unknown = Reflect.get(target, property, target);
            return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
          },
        });
  const i18n = createI18n({ language: 'ru', now: () => clock.now(), timeZone: 'Europe/Moscow' });

  const viewListeners = new Set<(view: SendAttemptView) => void>();
  const clicks: PreviewSendClick[] = [];
  const attemptIds = sequentialIds(0x500);
  // As the tab's composition root does: the port is read at each click, it follows the host's capability.
  const newDriver = (): PreviewSendDriver =>
    new PreviewSendDriver({
      get port() {
        return host.previewSend;
      },
      background: bg.sendPort,
      ids: attemptIds,
      onView: (view) => viewListeners.forEach((listener) => listener(view)),
      clock,
    });
  let driver = newDriver();
  const notes: { code: CgCode; scope: string }[] = [];
  const handovers: BoardHandover[] = [];
  const copied: string[] = [];
  const draftListeners = new Set<(value: unknown) => void>();
  const draftStore = {
    value: options.storedDrafts,
    saves: 0,
    failSaves: 0,
    external(value: unknown): void {
      draftStore.value = structuredClone(value);
      for (const listener of [...draftListeners]) listener(structuredClone(value));
    },
  };
  const fresh: { eventRef: string; fanRef: string }[][] = [];
  let isOnline = true;
  const onlineListeners = new Set<(online: boolean) => void>();

  const newBoards = (): BoardsControllers => createBoardsControllers({
    rpc: bg.rpc,
    host: port,
    i18n,
    clock,
    ids: sequentialIds(0x9000),
    sender: {
      send: (click) => {
        clicks.push(click);
        return driver.send(click);
      },
      onView: (listener) => {
        viewListeners.add(listener);
        return () => viewListeners.delete(listener);
      },
    },
    drafts: {
      load: () => Promise.resolve(structuredClone(draftStore.value)),
      save: (value) => {
        if (draftStore.failSaves > 0) {
          draftStore.failSaves -= 1;
          return Promise.reject(new Error('storage refused'));
        }
        draftStore.value = structuredClone(value);
        draftStore.saves += 1;
        // storage.onChanged reaches every context, the writer's own included.
        for (const listener of [...draftListeners]) listener(structuredClone(value));
        return Promise.resolve();
      },
      onChanged: (listener) => {
        draftListeners.add(listener);
        return () => draftListeners.delete(listener);
      },
    },
    clipboard: { writeText: (text) => (options.clipboard === false ? Promise.resolve(false) : (copied.push(text), Promise.resolve(true))) },
    notifier: { notify: (code, scope) => notes.push({ code, scope }) },
    handover: (handover) => handovers.push(handover),
    connectivity: {
      online: () => isOnline,
      subscribe: (listener) => {
        onlineListeners.add(listener);
        return () => onlineListeners.delete(listener);
      },
    },
    random: () => 0.5,
    timeZone: 'Europe/Moscow',
    ...(options.queuePageSize === undefined ? {} : { queuePageSize: options.queuePageSize }),
    ...(options.watchForSound === undefined ? {} : { watchForSound: options.watchForSound }),
    ...(options.fanPanelBesideHost === undefined ? {} : { fanPanelBesideHost: options.fanPanelBesideHost }),
    onNewSubscribers: (events) => fresh.push([...events]),
  });
  // The surfaces are mounted: every view has a listener and is rebuilt on each change, as in the page.
  const mount = (made: BoardsControllers): BoardsControllers => {
    const mounted = [
      made.spenders.subscribe(BOARD, () => undefined),
      made.spenders.subscribe(STATS, () => undefined),
      made.newcomers.subscribe(NEWCOMERS, () => undefined),
      made.fanPanel.subscribe(PANEL, () => undefined),
      ...(['spenders', 'newcomers', 'palette'] as const).map((from) => made.preview.subscribe(preview(from), () => undefined)),
    ];
    expect(mounted).toHaveLength(7);
    return made;
  };
  let boards = mount(newBoards());

  const flush = (): Promise<void> => settle(12);
  const h: Harness = {
    clock,
    hub,
    bg,
    host,
    timeline,
    i18n,
    get boards() {
      return boards;
    },
    get driver() {
      return driver;
    },
    async reload() {
      boards.dispose();
      driver.dispose();
      viewListeners.clear();
      draftListeners.clear();
      driver = newDriver();
      boards = mount(newBoards());
      await flush();
    },
    async secondTab() {
      const tab = mount(newBoards());
      extraTabs.push(tab);
      await flush();
      return tab;
    },
    clicks,
    notes,
    handovers,
    copied,
    draftStore,
    fresh,
    bootstrap,
    online: {
      set(value) {
        isOnline = value;
        for (const listener of [...onlineListeners]) listener(value);
      },
    },
    nav: {
      pending: () => waiting.length,
      aborted: () => waiting.filter((entry) => entry.aborted).length,
      release() {
        for (const entry of waiting.splice(0)) entry.run();
      },
    },
    async dispatch(action) {
      for (const controller of boards.controllers) {
        const receipt = controller.dispatch(action);
        if (receipt !== null) {
          const answered = await receipt;
          await flush();
          return answered;
        }
      }
      throw new Error(`nobody took ${action.type}`);
    },
    async advance(ms) {
      hub.control({ op: 'clock', advanceMs: ms });
      await clock.advance(ms);
      await flush();
    },
    flush,
    hostEvent(event) {
      timeline.push({ kind: 'event', at: clock.now() - NOW_MS, event });
      host.advance();
    },
    hostContract(report) {
      timeline.push({ kind: 'contract', at: clock.now() - NOW_MS, report });
      host.advance();
    },
    sendState(view) {
      timeline.push({ kind: 'send-state', at: clock.now() - NOW_MS, view });
      host.advance();
    },
    script(n, feature, text, known = [HOST_IDS.messages.fanBefore, HOST_IDS.messages.fanEarlier]) {
      const opId = uuid(0x100 + n);
      const generationRef = uuid(0x200 + n);
      const frame = (f: HubFrame, afterMs?: number): ScriptStep => (afterMs === undefined ? { kind: 'frame', frame: f } : { kind: 'frame', frame: f, afterMs });
      bg.streams.streamScript.push({
        kind: 'stream',
        steps: [
          frame(meta(feature, { clientRequestId: opId, requestId: generationRef })),
          frame(contextFrame({ generationRef, knownFanMessages: known.map((id) => ({ id, state: 'included' })), live: { status: 'not_sent', accepted: 0, rejected: 0 } })),
          frame({ type: 'content_delta', text }, 20),
          frame({ type: 'done', stopReason: 'end_turn' }),
        ],
      });
      return { opId, generationRef };
    },
  };
  live.push(h);
  await flush();
  return h;
}

const BOARD = { of: 'spenders.board' } as const;
const STATS = { of: 'spenders.stats' } as const;
const NEWCOMERS = { of: 'newcomers' } as const;
const PANEL = { of: 'fan-panel' } as const;
const preview = (from: PreviewSource): Extract<ViewSelector, { of: 'preview' }> => ({ of: 'preview', from });
const open = (surface: 'spenders' | 'newcomers' | 'fan-panel', isOpen = true): UiAction => ({ type: 'Navigate', to: { kind: 'surface', surface, open: isOpen } });
const spender = (fanRef: string): string => fanHandle('spenders', PAGE.pageId, fanRef);
const newcomer = (fanRef: string): string => fanHandle('newcomers', PAGE.pageId, fanRef);
const count = (h: Harness, type: Parameters<BoardsBackground['count']>[0]): number => h.bg.count(type);
const lastPayload = (h: Harness, type: Parameters<BoardsBackground['count']>[0]): unknown => h.bg.requests.filter((request) => request.type === type).at(-1)?.payload;
const partsOf = (h: Harness, from: PreviewSource): readonly PartVM[] => h.boards.preview.getSnapshot(preview(from)).result?.parts ?? [];

describe('[SP-050] [SP-051] [SP-052] [SP-056] [DB-026] a preview shows the hub archive and touches nothing in ChatSpace', () => {
  it('[SP-050] opens with the header, the archive feed and its age; the chat stays unread: no navigation, no checkpoint, no history read', async () => {
    const h = await harness();
    await h.dispatch(open('spenders'));
    await h.dispatch({ type: 'RevealShelf', shelfId: 'shelf-600-plus' });
    expect(await h.dispatch({ type: 'OpenPreview', targetHandle: spender('5001') })).toMatchObject({ ok: true, outcome: 'opened' });
    const vm = h.boards.preview.getSnapshot(preview('spenders'));
    expect(vm.from).toBe('spenders');
    expect(vm.handle).toBe(spender('5001'));
    expect(vm.header).toMatchObject({ name: 'Fan 1', username: 'fan_1', lifetime: 3_717_000, period30: 1_239_000, newcomer: null });
    expect(vm.header?.weWroteAt).not.toBeNull();
    expect(vm.view).toEqual({ s: 'ready' });
    expect(vm.feed.items).toHaveLength(3);
    expect(vm.feed.hasOlder).toBe(false);
    expect(vm.feed.items[0]?.dayBreak).toBe(true);
    expect(vm.archive.stamp).toEqual({ asOf: iso(NOW_MS), coverage: 'complete' });
    expect(vm.archive.lagMinutes).toBeNull();
    expect(vm.unread).toBe('kept');
    expect(vm.idleHint).toEqual({ key: 'preview.empty' });
    expect(vm.result).toBeNull();
    expect(vm.claim).toBeNull();
    expect(Object.keys(vm.bar.actions)).toEqual(['reply', 'fix', 'hi', 'ping']);
    expect(lastPayload(h, 'feed.read')).toEqual({ pageId: PAGE.pageId, fanRef: '5001', cursor: null, limit: FEED_PAGE_SIZE, summaryWindow: 100 });
    // The board marks the row and knows a preview is open.
    const board = h.boards.spenders.getSnapshot(BOARD);
    expect(board.previewOpen).toBe(true);
    expect(board.shelves[0]?.rows.find((row) => row.selected)?.handle).toBe(spender('5001'));
    // Nothing was done to ChatSpace.
    expect(h.host.calls).toMatchObject({ navigations: [], inserts: [], checkpoints: [], preflights: [], commits: [] });
  });
});

/** A Spenders preview of fan 5000 with a finished two-part Reply, X8 on. */
async function withReply(options: Options = {}, text = 'Hey you\n[NEXT]\nMissed me?'): Promise<{ h: Harness; opId: string; handle: string }> {
  const h = await harness({ config: X8, ...options });
  await h.dispatch(open('spenders'));
  await h.dispatch({ type: 'RevealShelf', shelfId: 'shelf-600-plus' });
  const handle = spender('5000');
  await h.dispatch({ type: 'OpenPreview', targetHandle: handle });
  const { opId } = h.script(0, 'fast-reply', text);
  const receipt = await h.dispatch({ type: 'Generate', targetHandle: handle, feature: 'reply', options: {} });
  expect(receipt).toMatchObject({ ok: true, outcome: 'started', opId });
  await h.advance(200);
  return { h, opId, handle };
}

describe('[SP-055] generation in a preview runs on the hub context, with the checkpoint of the click', () => {
  it('[SP-055] Generate starts a `preview` operation without fresh page text, with the checkpoint MAIN took at the click', async () => {
    const { h, opId } = await withReply();
    expect(h.host.calls.checkpoints).toEqual([{ host: 'chatspace', hostAccountId: HOST_IDS.acc, platformFanId: '5000' }]);
    const start = lastPayload(h, 'op.start') as Record<string, unknown>;
    expect(start).toMatchObject({ feature: 'reply', surface: 'preview', tone: null, split: true, window: 100 });
    expect(start['fresh']).toBeUndefined();
    expect(start['checkpoint']).toMatchObject({ platformFanId: '5000', fanSequence: 2 });
    expect((start['target'] as { fanRef: string }).fanRef).toBe('5000');
    // The checkpoint was asked before the hub request.
    const types = h.bg.requests.map((r) => r.type);
    expect(types.indexOf('token.issue')).toBeLessThan(types.indexOf('op.start'));
    // The hub got the known fan ids, never a fan text.
    expect(h.bg.streams.streams[0]?.body.knownFanMessageIds).toEqual([HOST_IDS.messages.fanBefore, HOST_IDS.messages.fanEarlier]);
    expect(h.bg.streams.streams[0]?.body.liveTextContext).toBeUndefined();
    const result = h.boards.preview.getSnapshot(preview('spenders')).result!;
    expect(result).toMatchObject({ opId, feature: 'reply', surface: 'preview', state: 'done', draftNotSent: true, targetName: 'fan_0', splitRequested: true, canRegenerate: true, sendProgress: null });
    expect(result.parts?.map((part) => part.text)).toEqual(['Hey you', 'Missed me?']);
    expect(result.meta).toContainEqual({ key: 'result.meta.parts', params: { n: 2 } });
    expect(h.boards.preview.getSnapshot(preview('spenders')).idleHint).toBeNull();
    // Nothing went anywhere by itself (NF-028, AI-120).
    expect(h.host.calls.commits).toEqual([]);
    expect(h.host.calls.inserts).toEqual([]);
    expect(h.clicks).toEqual([]);
  });
});

describe('[NF-016] the identity a generation was made for is checked before and after it', () => {
  it('another sign-in between the click and the hub request refuses Generate; nothing starts', async () => {
    const h = await harness({ config: X8 });
    await h.dispatch(open('spenders'));
    await h.dispatch({ type: 'RevealShelf', shelfId: 'shelf-600-plus' });
    await h.dispatch({ type: 'OpenPreview', targetHandle: spender('5000') });
    const release = h.bg.hold('token.issue');
    const pending = h.boards.preview.dispatch({ type: 'Generate', targetHandle: spender('5000'), feature: 'reply', options: {} })!;
    await h.flush();
    h.bg.signIn({ ...session, epoch: 4 });
    await h.flush();
    release();
    expect(await pending).toMatchObject({ ok: false, code: 'CG-CONTEXT-CHANGED' });
    await h.flush();
    expect(count(h, 'op.start')).toBe(0);
    expect(h.boards.preview.getSnapshot(preview('spenders')).handle).toBeNull();
  });

  it('a persona changed after the generation: the text stays readable and copyable, but is neither sent nor inserted', async () => {
    const { h, opId } = await withReply();
    expect(partsOf(h, 'spenders')[0]?.send).toEqual({ s: 'available' });
    const other = { key: 'night', definitionId: uuid(0xabc) };
    h.bg.setSettings({ ...settings, personas: { ...settings.personas, byPageId: { [String(PAGE.pageId)]: other } } });
    await h.flush();
    const [first] = partsOf(h, 'spenders');
    expect(first?.text).toBe('Hey you');
    expect(first?.send).toMatchObject({ s: 'unavailable', code: 'CG-CONTEXT-CHANGED' });
    expect(await h.dispatch({ type: 'SendPart', operationId: opId, part: 0 })).toMatchObject({ ok: false, code: 'CG-CONTEXT-CHANGED' });
    expect(await h.dispatch({ type: 'OpenAndInsertPart', operationId: opId, part: 0 })).toMatchObject({ ok: false, code: 'CG-CONTEXT-CHANGED' });
    expect(h.host.calls.commits).toEqual([]);
    expect(h.host.calls.navigations).toEqual([]);
    expect((await h.dispatch({ type: 'Copy', artifactHandle: first!.copyHandle })).ok).toBe(true);
  });

  it('[AI-140] the owner edited the persona after the generation (its key stays, the choice followed): the draft is still sent and inserted', async () => {
    const { h } = await withReply();
    h.bg.setSettings({ ...settings, personas: { ...settings.personas, byPageId: { [String(PAGE.pageId)]: { key: WORLD.persona.key, definitionId: WORLD.persona.otherDefinitionId } } } });
    await h.flush();
    const [first] = partsOf(h, 'spenders');
    expect(first?.send).toEqual({ s: 'available' });
    expect(first?.openInsert).toEqual({ s: 'available' });
  });
});

describe('[SP-054] [X8-01] [X8-08] «Отправить» is a button of one part; every state of its row', () => {
  it('available → queued → sending → accepted → sent, by the linked receipt and echo; one part at a time', async () => {
    const { h, opId } = await withReply();
    let [first, second] = partsOf(h, 'spenders');
    expect(first?.send).toEqual({ s: 'available' });
    expect(first?.sendOrder).toBeNull();
    expect(first?.openInsert).toEqual({ s: 'available' });
    expect(second?.send).toEqual({ s: 'available' });
    // Parts go in any order (audit 2026-10-20, row 13); only one of the fan's is on its way at a time.
    expect(second?.sendOrder).toBeNull();

    const sending = h.boards.preview.dispatch({ type: 'SendPart', operationId: opId, part: 0 })!;
    // Off from the first click, before anything answers.
    expect(partsOf(h, 'spenders')[0]?.send).toEqual({ s: 'queued' });
    const receipt = await sending;
    await h.flush();
    const attemptId = uuid(0x500);
    expect(receipt).toMatchObject({ ok: true, outcome: 'started', attemptId });
    expect(h.host.calls.commits).toHaveLength(1);
    expect(h.host.calls.commits[0]?.request).toMatchObject({ attemptId, plainText: 'Hey you', isAiGenerated: true, part: { index: 0 } });
    [first, second] = partsOf(h, 'spenders');
    expect(first?.send).toEqual({ s: 'sending' });
    expect(first?.openInsert).toEqual({ s: 'hidden' });
    expect(second?.sendOrder).toEqual({ kind: 'after', part: 1 });
    expect(h.boards.preview.getSnapshot(preview('spenders'))).toMatchObject({ unread: 'read-after-send' });
    expect(h.boards.preview.getSnapshot(preview('spenders')).result).toMatchObject({ draftNotSent: false, canRegenerate: false, regenerateReason: { id: 'parts-sending' } });

    h.sendState({ attemptId, state: 'nativeAccepted', platformMessageId: '4100' });
    await h.flush();
    expect(partsOf(h, 'spenders')[0]?.send).toEqual({ s: 'accepted' });
    h.sendState({ attemptId, state: 'sentObserved', platformMessageId: '4100' });
    await h.flush();
    [first, second] = partsOf(h, 'spenders');
    expect(first?.send).toEqual({ s: 'sent', at: iso(h.clock.now()) });
    expect(first?.collapsed).toBe(true);
    expect(second?.send).toEqual({ s: 'available' });
    expect(second?.sendOrder).toBeNull();
    expect(second?.next).toBe(true);
    const result = h.boards.preview.getSnapshot(preview('spenders')).result!;
    expect(result.sendProgress).toEqual({ sent: 1, total: 2 });
    expect(result.meta).toContainEqual({ key: 'result.meta.sentProgress', params: { sent: 1, total: 2 } });
    // The hub custody was told on proof only.
    expect(h.hub.status().claims.find((c) => c.fanRef === '5000')?.attempts).toEqual([{ attemptId, state: 'sent', partIndex: 0 }]);
    // The next part is a new click with its own attempt.
    await h.dispatch({ type: 'SendPart', operationId: opId, part: 1 });
    expect(h.host.calls.commits).toHaveLength(2);
    expect(h.host.calls.commits[1]?.request).toMatchObject({ attemptId: uuid(0x501), plainText: 'Missed me?' });
  });

  it('[X8-03] [DB-031] no chat opened since the page loaded: «Отправить» says to open any chat (CG-SEND-HOST) and sends nothing; with the store the first chat brings, the part can be sent', async () => {
    const waiting = { ...contractReport({ previewSend: { state: 'off', reason: 'composerTranslator', code: 'CG-SEND-HOST' } }), anchors: { ...contractReport().anchors, composerTranslator: 'notYet' as const } };
    const { h, opId } = await withReply({ start: { contract: waiting } });
    expect(h.host.previewSend).toBeNull();
    expect(partsOf(h, 'spenders')[0]?.send).toEqual({ s: 'unavailable', code: 'CG-SEND-HOST', reason: { key: 'send.reason.hostNotYet' } });
    expect(partsOf(h, 'spenders')[0]?.openInsert).toEqual({ s: 'available' });
    expect(await h.dispatch({ type: 'SendPart', operationId: opId, part: 0 })).toMatchObject({ ok: false, code: 'CG-SEND-HOST' });
    expect(h.clicks).toEqual([]);
    expect(h.host.calls.preflights).toEqual([]);
    expect(h.host.calls.commits).toEqual([]);

    // The person opened a chat and closed it again: ChatSpace created the store and keeps it — the row follows at once.
    h.hostContract(contractReport());
    await h.flush();
    expect(partsOf(h, 'spenders')[0]?.send).toEqual({ s: 'available' });
    expect(await h.dispatch({ type: 'SendPart', operationId: opId, part: 0 })).toMatchObject({ ok: true });
    await h.flush();
    expect(h.host.calls.commits).toHaveLength(1);

    // A chat's composer was there and the store did not come (ChatSpace changed): the general words, as before.
    const gone = { ...waiting, anchors: { ...waiting.anchors, composerTranslator: 'missing' as const } };
    const broken = await withReply({ start: { contract: gone } });
    expect(partsOf(broken.h, 'spenders')[0]?.send).toEqual({ s: 'unavailable', code: 'CG-SEND-HOST', reason: { key: 'send.reason.host' } });
  });

  it('uncertain (audit 2026-10-20, row 2): a quiet mark with «Открыть чат» and «Отправить ещё раз» by the person\'s own click; nothing else of the fan is held, nothing goes by itself', async () => {
    const { h, opId } = await withReply({ answers: { commit: [{ state: 'uncertain', code: 'CG-SEND-UNCERTAIN' }] } });
    await h.dispatch({ type: 'SendPart', operationId: opId, part: 0 });
    const attemptId = uuid(0x500);
    const [first, second] = partsOf(h, 'spenders');
    expect(first?.send).toEqual({ s: 'uncertain', since: iso(h.clock.now()), attemptId });
    expect(first?.openInsert).toEqual({ s: 'hidden' });
    expect(second?.sendOrder).toBeNull();
    expect(second?.send).toEqual({ s: 'available' });
    const vm = h.boards.preview.getSnapshot(preview('spenders'));
    expect(vm.stoppedNote).toBeNull();
    expect(vm.result).toMatchObject({ canRegenerate: true });
    // Nothing went again by itself.
    expect(h.host.calls.commits).toHaveLength(1);
    // Look at the chat: it navigates, with no insert riding it.
    expect(await h.dispatch({ type: 'OpenChatToVerify', attemptId })).toMatchObject({ ok: true, outcome: 'opened' });
    expect(h.host.calls.navigations).toHaveLength(1);
    expect(h.host.calls.navigations[0]?.thenInsert).toBeUndefined();
    expect(h.host.calls.commits).toHaveLength(1);
    expect(h.boards.preview.dispatch({ type: 'OpenChatToVerify', attemptId: uuid(0xbad) })).toBeNull();
  });

  it('[X8-03] condition 6: a result is not sent into the chat that is open — that chat has its composer; MAIN is not even asked', async () => {
    const { h, opId } = await withReply();
    expect(partsOf(h, 'spenders')[0]?.send).toEqual({ s: 'available' });
    const asked = h.host.calls.preflights.length;
    // The person opened this very chat in ChatSpace while the board still shows its preview.
    h.hostEvent({ type: 'route', route: { epoch: 6, name: 'chat', account: hostAccount, chat: { host: 'chatspace', hostAccountId: HOST_IDS.acc, platformFanId: '5000' } } });
    await h.flush();
    expect(partsOf(h, 'spenders').map((part) => part.send)).toEqual([
      { s: 'unavailable', code: 'CG-SEND-ACTIVE-CHAT', reason: { key: 'send.reason.activeChat' } },
      { s: 'unavailable', code: 'CG-SEND-ACTIVE-CHAT', reason: { key: 'send.reason.activeChat' } },
    ]);
    expect(h.host.calls.preflights).toHaveLength(asked);
    expect(await h.dispatch({ type: 'SendPart', operationId: opId, part: 0 })).toMatchObject({ ok: false, code: 'CG-SEND-ACTIVE-CHAT' });
    expect(h.clicks).toEqual([]);
    expect(h.host.calls.commits).toEqual([]);
    // Another chat on the route: the button is back.
    h.hostEvent({ type: 'route', route: { epoch: 7, name: 'chat', account: hostAccount, chat: { host: 'chatspace', hostAccountId: HOST_IDS.acc, platformFanId: '5009' } } });
    await h.flush();
    expect(partsOf(h, 'spenders')[0]?.send).toEqual({ s: 'available' });
  });

  it('[X8-08] one variant of a greeting goes: once a part of it reached ChatSpace, parts of the other variants are not sent', async () => {
    const h = await harness({ config: X8 });
    await h.dispatch(open('spenders'));
    await h.dispatch({ type: 'RevealShelf', shelfId: 'shelf-600-plus' });
    await h.dispatch({ type: 'OpenPreview', targetHandle: spender('5000') });
    const { opId } = h.script(0, 'hi-greeting', 'Hi A1\n[NEXT]\nHi A2\n[VARIANT]\nHi B1\n[VARIANT]\nHi C1');
    expect(await h.dispatch({ type: 'Generate', targetHandle: spender('5000'), feature: 'hi', options: {} })).toMatchObject({ ok: true, opId });
    await h.advance(200);
    const variants = (): readonly (readonly PartVM[])[] => (h.boards.preview.getSnapshot(preview('spenders')).result?.variants ?? []).map((variant) => variant.parts);
    expect(variants().map((parts) => parts.map((part) => part.text))).toEqual([['Hi A1', 'Hi A2'], ['Hi B1'], ['Hi C1']]);
    // Before anything is sent every variant is on offer.
    expect(variants().map((parts) => parts[0]?.send)).toEqual([{ s: 'available' }, { s: 'available' }, { s: 'available' }]);
    expect((await h.dispatch({ type: 'SendPart', operationId: opId, variant: 1, part: 0 })).ok).toBe(true);
    h.sendState({ attemptId: uuid(0x500), state: 'nativeAccepted', platformMessageId: '4100' });
    h.sendState({ attemptId: uuid(0x500), state: 'sentObserved', platformMessageId: '4100' });
    await h.flush();
    const [a, b, c] = variants();
    expect(b?.[0]?.send?.s).toBe('sent');
    // The block stays (X5); it says what it is — another variant went — not «часть устарела».
    expect(a?.map((part) => part.send)).toEqual([
      { s: 'unavailable', code: 'CG-SEND-PART', reason: { key: 'send.reason.otherVariant' } },
      { s: 'unavailable', code: 'CG-SEND-PART', reason: { key: 'send.reason.otherVariant' } },
    ]);
    expect(c?.[0]?.send).toMatchObject({ s: 'unavailable', code: 'CG-SEND-PART' });
    expect(await h.dispatch({ type: 'SendPart', operationId: opId, variant: 0, part: 0 })).toMatchObject({ ok: false, code: 'CG-SEND-PART' });
    expect(await h.dispatch({ type: 'SendPart', operationId: opId, variant: 2, part: 0 })).toMatchObject({ ok: false, code: 'CG-SEND-PART' });
    expect(h.clicks).toHaveLength(1);
    expect(h.host.calls.commits).toHaveLength(1);
  });
});

describe('[SP-054] [NF-022] what holds a send holds the fan — on every card of the fan, and after a tab reload (§6.7.8, §6.7.9)', () => {
  const UNCERTAIN = { answers: { commit: [{ state: 'uncertain', code: 'CG-SEND-UNCERTAIN' }] } } as const;
  const strip = (h: Harness, from: PreviewSource = 'spenders') => h.boards.preview.getSnapshot(preview(from)).bar.actions;

  it('a part on its way: the strip waits for it, the other part is not put into the chat meanwhile, and the result stays on the card', async () => {
    const { h, opId, handle } = await withReply();
    await h.dispatch({ type: 'SendPart', operationId: opId, part: 0 });
    expect(partsOf(h, 'spenders')[0]?.send).toEqual({ s: 'sending' });
    for (const feature of ['reply', 'hi', 'ping'] as const) {
      expect(strip(h)[feature], feature).toMatchObject({ enabled: false, reason: { id: 'parts-sending' } });
      expect(await h.dispatch({ type: 'Generate', targetHandle: handle, feature, options: {} }), feature).toMatchObject({ ok: false, code: 'CG-SEND-BUSY' });
    }
    expect(count(h, 'op.start')).toBe(1);
    expect(partsOf(h, 'spenders')[1]?.openInsert).toMatchObject({ s: 'unavailable', reason: { id: 'parts-sending' } });
    expect(await h.dispatch({ type: 'OpenAndInsertPart', operationId: opId, part: 1 })).toMatchObject({ ok: false, code: 'CG-SEND-BUSY' });
    expect(await h.dispatch({ type: 'HideResult', operationId: opId })).toMatchObject({ ok: false, code: 'CG-SEND-BUSY' });
    expect(h.host.calls.navigations).toEqual([]);
    expect(h.boards.preview.getSnapshot(preview('spenders')).result?.opId).toBe(opId);
    // Proven sent: everything of the strip is back, and a new reply is a new message of its own.
    h.sendState({ attemptId: uuid(0x500), state: 'nativeAccepted', platformMessageId: '4100' });
    h.sendState({ attemptId: uuid(0x500), state: 'sentObserved', platformMessageId: '4100' });
    await h.flush();
    expect(strip(h).reply).toMatchObject({ enabled: true, reason: null });
    expect(partsOf(h, 'spenders')[1]?.openInsert).toEqual({ s: 'available' });
    expect((await h.dispatch({ type: 'HideResult', operationId: opId })).ok).toBe(true);
  });

  it('F5 with an unknown outcome: the result comes back WITH the state of its parts — the row is «не подтвердилось», and nothing else of the fan is held (row 2)', async () => {
    const { h, opId, handle } = await withReply(UNCERTAIN);
    await h.dispatch({ type: 'SendPart', operationId: opId, part: 0 });
    const attemptId = uuid(0x500);
    const since = iso(h.clock.now());
    await h.advance(90_000);
    await h.reload();
    // The reloaded tab opens the board and the same fan again.
    await h.dispatch(open('spenders'));
    await h.dispatch({ type: 'RevealShelf', shelfId: 'shelf-600-plus' });
    await h.dispatch({ type: 'OpenPreview', targetHandle: handle });
    expect(lastPayload(h, 'send.list')).toEqual({ pageId: PAGE.pageId, fanRef: '5000' });
    const vm = h.boards.preview.getSnapshot(preview('spenders'));
    expect(vm.result?.opId).toBe(opId);
    const [first, second] = vm.result?.parts ?? [];
    // «с 09:21» is when the outcome became unknown, not when the tab reloaded.
    expect(first?.send).toEqual({ s: 'uncertain', since, attemptId });
    expect(first?.openInsert).toEqual({ s: 'hidden' });
    expect(second?.sendOrder).toBeNull();
    expect(vm.stoppedNote).toBeNull();
    expect(vm.unread).toBe('read-after-send');
    expect(vm.bar.actions.reply).toMatchObject({ enabled: true });
    expect(h.host.calls.commits).toHaveLength(1);
    // Look at the chat from the restored row, with no insert riding the navigation.
    expect(await h.dispatch({ type: 'OpenChatToVerify', attemptId })).toMatchObject({ ok: true, outcome: 'opened' });
    expect(h.host.calls.navigations).toHaveLength(1);
    expect(h.host.calls.navigations[0]?.thenInsert).toBeUndefined();
  });

  it('F5 after a sent part: it stays «Отправлено» with its own time, and is not offered for the chat again', async () => {
    const { h, opId, handle } = await withReply();
    await h.dispatch({ type: 'SendPart', operationId: opId, part: 0 });
    h.sendState({ attemptId: uuid(0x500), state: 'nativeAccepted', platformMessageId: '4100' });
    h.sendState({ attemptId: uuid(0x500), state: 'sentObserved', platformMessageId: '4100' });
    await h.flush();
    const sentAt = iso(h.clock.now());
    await h.advance(60_000);
    await h.reload();
    await h.dispatch(open('spenders'));
    await h.dispatch({ type: 'RevealShelf', shelfId: 'shelf-600-plus' });
    await h.dispatch({ type: 'OpenPreview', targetHandle: handle });
    const vm = h.boards.preview.getSnapshot(preview('spenders'));
    const [first, second] = vm.result?.parts ?? [];
    expect(first?.send).toEqual({ s: 'sent', at: sentAt });
    expect(first?.openInsert).toEqual({ s: 'hidden' });
    expect(vm.result?.sendProgress).toEqual({ sent: 1, total: 2 });
    expect(vm.unread).toBe('read-after-send');
    // The checkpoint of the generation did not survive the reload: a warning; «Отправить всё равно» takes one now (rows 3–4).
    expect(second?.send).toEqual({ s: 'unverified' });
    expect(second?.openInsert).toEqual({ s: 'available' });
    expect((await h.dispatch({ type: 'OpenAndInsertPart', operationId: opId, part: 0 })).ok).toBe(false);
  });

  it('a result that outlived the reload but not its sends list is not shown; nothing is generated while the journal does not answer', async () => {
    // The background does not answer `send.list`: the result is not brought back without the state of its parts.
    const lost = await withReply(UNCERTAIN);
    await lost.h.dispatch({ type: 'SendPart', operationId: lost.opId, part: 0 });
    await lost.h.reload();
    lost.h.bg.failNext('send.list', { code: 'CG-TIMEOUT' });
    await lost.h.dispatch(open('spenders'));
    await lost.h.dispatch({ type: 'RevealShelf', shelfId: 'shelf-600-plus' });
    await lost.h.dispatch({ type: 'OpenPreview', targetHandle: lost.handle });
    expect(lost.h.boards.preview.getSnapshot(preview('spenders')).result).toBeNull();
    // While the journal does not answer, nothing is generated for the fan: its sends are asked for again, and no answer is a refusal.
    const asked = count(lost.h, 'send.list');
    lost.h.bg.failNext('send.list', { code: 'CG-TIMEOUT' });
    expect(await lost.h.dispatch({ type: 'Generate', targetHandle: lost.handle, feature: 'reply', options: {} })).toMatchObject({ ok: false, code: 'CG-RUNTIME-UNREACHABLE' });
    expect(count(lost.h, 'op.start')).toBe(1);
    expect(count(lost.h, 'send.list')).toBe(asked + 1);
    // The journal answers the next click: an unknown outcome holds nothing (row 2), the generation starts.
    expect(lost.h.boards.preview.getSnapshot(preview('spenders')).bar.actions.reply?.enabled).toBe(true);
    expect(await lost.h.dispatch({ type: 'Generate', targetHandle: lost.handle, feature: 'reply', options: {} })).toMatchObject({ ok: true });
    expect(lost.h.boards.preview.getSnapshot(preview('spenders')).unread).toBe('read-after-send');
    // «Обновить архив» reads the journal as well.
    const asked2 = count(lost.h, 'send.list');
    await lost.h.dispatch({ type: 'RefreshArchive', targetHandle: lost.handle });
    expect(count(lost.h, 'send.list')).toBe(asked2 + 1);
  });

});

describe('[TL-004] [NF-019] a part the person sent with ChatSpace’s own Send is a sent part of its group (§6.6, §6.7.9)', () => {
  const applied: NavigationReceipt = { state: 'navigated', routeEpoch: 6, insert: { state: 'applied', draftRevision: 1, draftDigest: 'feedbeef0000aaaa', ms: 12 } };
  const reopen = async (h: Harness, handle: string): Promise<void> => {
    await h.dispatch(open('spenders'));
    await h.dispatch({ type: 'RevealShelf', shelfId: 'shelf-600-plus' });
    await h.dispatch({ type: 'OpenPreview', targetHandle: handle });
  };

  it('the preview send is off: after «Открыть и вставить» and the person’s Send the preview shows part 1 «Отправлено» and offers part 2 for «Открыть и вставить» — not «после части 1» for ever; nothing is sent by us', async () => {
    const { h, opId, handle } = await withReply({ config: {}, answers: { navigate: [applied, applied] } });
    const before = partsOf(h, 'spenders');
    expect(before.map((part) => part.send)).toMatchObject([{ s: 'unavailable', code: 'CG-SEND-OFF' }, { s: 'unavailable', code: 'CG-SEND-OFF' }]);
    // Parts go in any order (audit 2026-10-20, row 13).
    expect(before.map((part) => part.sendOrder)).toEqual([null, null]);
    expect(await h.dispatch({ type: 'OpenAndInsertPart', operationId: opId, part: 0 })).toMatchObject({ ok: true, outcome: 'opened' });
    expect(h.boards.surfaces.current()).toMatchObject({ spenders: false, preview: { spenders: null } });
    // The person presses ChatSpace's Send; the tab proves it by the receipt and the echo, the background journals the part as delivered.
    await h.advance(30_000);
    const sentAt = iso(h.clock.now());
    expect(h.bg.humanSent(opId, { index: 0 }, '4100')).toMatchObject({ state: 'sentObserved', platformMessageId: '4100' });
    await h.flush();
    await h.advance(5_000);
    await reopen(h, handle);
    const vm = h.boards.preview.getSnapshot(preview('spenders'));
    const [first, second] = vm.result?.parts ?? [];
    expect(vm.result?.opId).toBe(opId);
    expect(first?.send).toEqual({ s: 'sent', at: sentAt });
    expect(first?.openInsert).toEqual({ s: 'hidden' });
    expect(vm.result?.sendProgress).toEqual({ sent: 1, total: 2 });
    expect(vm.result?.draftNotSent).toBe(false);
    // The next part goes the same honest way: the person's own click opens the chat and inserts it. The send stays off.
    expect(second?.sendOrder).toBeNull();
    expect(second?.next).toBe(true);
    expect(second?.send).toMatchObject({ s: 'unavailable', code: 'CG-SEND-OFF' });
    expect(second?.openInsert).toEqual({ s: 'available' });
    // The sent part is not put into the chat again; the next one is, by its own click — one navigation, one deferred insert.
    expect((await h.dispatch({ type: 'OpenAndInsertPart', operationId: opId, part: 0 })).ok).toBe(false);
    expect(await h.dispatch({ type: 'OpenAndInsertPart', operationId: opId, part: 1 })).toMatchObject({ ok: true, outcome: 'opened' });
    expect(h.host.calls.navigations.map((intent) => intent.thenInsert?.part)).toEqual([{ index: 0 }, { index: 1 }]);
    // Nothing was sent or queued by us at any point.
    expect(h.host.calls.commits).toEqual([]);
    expect(count(h, 'op.start')).toBe(1);
  });

  it('X8 is on: the part sent by hand is not offered for «Отправить» again, and the next part may be sent by its own click', async () => {
    const { h, opId, handle } = await withReply({ answers: { navigate: [applied] } });
    expect(partsOf(h, 'spenders').map((part) => part.send?.s)).toEqual(['available', 'available']);
    await h.dispatch({ type: 'OpenAndInsertPart', operationId: opId, part: 0 });
    h.bg.humanSent(opId, { index: 0 }, '4100');
    // The person goes back to another chat: a result is never sent into the chat that is open (§6.7.4 п. 6).
    h.hostEvent({ type: 'route', route: { epoch: 7, name: 'chat', account: hostAccount, chat: { host: 'chatspace', hostAccountId: HOST_IDS.acc, platformFanId: '5009' } } });
    await h.flush();
    await reopen(h, handle);
    const [first, second] = partsOf(h, 'spenders');
    expect(first?.send?.s).toBe('sent');
    expect(second?.sendOrder).toBeNull();
    // The checkpoint of the generation is this tab's own: the second part may go through ChatSpace's queue by its own click.
    expect(second?.send).toEqual({ s: 'available' });
    expect((await h.dispatch({ type: 'SendPart', operationId: opId, part: 0 })).ok).toBe(false);
    expect(h.host.calls.commits).toEqual([]);
  });
});

describe('[SP-035] «Открыть и вставить» is one navigation with one deferred insert', () => {
  it('opens the exact chat with the part as a deferred insert, closes the board, and reports the insert', async () => {
    const { h, opId } = await withReply({ answers: { navigate: [{ state: 'navigated', routeEpoch: 6, insert: { state: 'applied', draftRevision: 1, draftDigest: 'feedbeef0000aaaa', ms: 12 } }] } });
    const receipt = await h.dispatch({ type: 'OpenAndInsertPart', operationId: opId, part: 1 });
    expect(receipt).toMatchObject({ ok: true, outcome: 'opened', opId });
    const intent = h.host.calls.navigations[0]!;
    expect(intent.target).toEqual({ hostAccountId: HOST_IDS.acc, platformFanId: '5000' });
    expect(intent.thenInsert).toMatchObject({ operationId: opId, part: { index: 1 }, text: 'Missed me?', mode: 'replace', confirmationId: null, expected: { kind: 'deferred', documentEpoch: DOCUMENT } });
    expect(intent.thenInsert!.expiresAt - intent.thenInsert!.createdAt).toBe(20_000);
    expect(h.host.calls.redeemed.at(-1)).toMatchObject({ kind: 'navigate', redeemed: true });
    expect(h.boards.surfaces.current()).toMatchObject({ spenders: false, preview: { spenders: null } });
    expect(lastPayload(h, 'op.reportInsert')).toMatchObject({ opId, part: { index: 1 }, receipt: { state: 'applied' } });
    expect(h.notes).toEqual([]);
    // Nothing was sent: the person presses ChatSpace's own Send.
    expect(h.host.calls.commits).toEqual([]);
  });

  it('the chat was not ready in time: «Чат не готов», a toast, the board stays, and nothing is retried', async () => {
    const { h, opId } = await withReply({ answers: { navigate: [{ state: 'failed', code: 'CG-NAV-TIMEOUT', insert: null }] } });
    expect(await h.dispatch({ type: 'OpenAndInsertPart', operationId: opId, part: 0 })).toMatchObject({ ok: false, code: 'CG-NAV-TIMEOUT' });
    expect(h.notes).toEqual([{ code: 'CG-NAV-TIMEOUT', scope: `preview:${spender('5000')}` }]);
    expect(h.boards.surfaces.current().spenders).toBe(true);
    expect(h.host.calls.navigations).toHaveLength(1);
    // The generation is kept.
    expect(partsOf(h, 'spenders')).toHaveLength(2);
    expect(partsOf(h, 'spenders')[0]?.openInsert).toEqual({ s: 'available' });
  });

  it('the person goes to another chat while the insert waits: «Вставка отменена»; our own chat opening is not that', async () => {
    const elsewhere = await withReply({ slowNavigate: true });
    void elsewhere.h.boards.preview.dispatch({ type: 'OpenAndInsertPart', operationId: elsewhere.opId, part: 0 });
    await elsewhere.h.flush();
    elsewhere.h.hostEvent({ type: 'route', route: { epoch: 6, name: 'chat', account: hostAccount, chat: { host: 'chatspace', hostAccountId: HOST_IDS.acc, platformFanId: '5009' } } });
    await elsewhere.h.flush();
    expect(elsewhere.h.nav.aborted()).toBe(1);
    expect(elsewhere.h.notes).toEqual([{ code: 'CG-INSERT-CANCELED', scope: `preview:${elsewhere.handle}` }]);
    expect(elsewhere.h.boards.surfaces.current().spenders).toBe(true);

    const ours = await withReply({ slowNavigate: true });
    const pending = ours.h.boards.preview.dispatch({ type: 'OpenAndInsertPart', operationId: ours.opId, part: 0 })!;
    await ours.h.flush();
    // The target chat is on the route before the host reports the insert: the board closes, the insert still waits.
    ours.h.hostEvent({ type: 'route', route: { epoch: 6, name: 'chat', account: hostAccount, chat: { host: 'chatspace', hostAccountId: HOST_IDS.acc, platformFanId: '5000' } } });
    await ours.h.flush();
    expect(ours.h.boards.surfaces.current()).toMatchObject({ spenders: false, preview: { spenders: null } });
    expect(ours.h.nav.aborted()).toBe(0);
    expect(ours.h.notes).toEqual([]);
    ours.h.nav.release();
    expect((await pending).type).toBe('OpenAndInsertPart');
    expect(ours.h.nav.aborted()).toBe(0);
  });

  it('§6.5: the page’s persona changes while the insert waits — the insert is given up, and the text of the old persona is not written', async () => {
    const { h, opId, handle } = await withReply({ slowNavigate: true });
    const pending = h.boards.preview.dispatch({ type: 'OpenAndInsertPart', operationId: opId, part: 0 })!;
    await h.flush();
    expect(h.nav.pending()).toBe(1);
    expect(h.nav.aborted()).toBe(0);
    h.bg.setSettings({ ...settings, personas: { ...settings.personas, byPageId: { [String(PAGE.pageId)]: { key: 'night', definitionId: uuid(0xabc) } } } });
    await h.flush();
    expect(h.nav.aborted()).toBe(1);
    expect(h.notes).toEqual([{ code: 'CG-INSERT-CANCELED', scope: `preview:${handle}` }]);
    expect(partsOf(h, 'spenders')[0]?.openInsert?.s).not.toBe('waiting');
    h.nav.release();
    expect(await pending).toMatchObject({ ok: false, code: 'CG-INSERT-CANCELED' });
    await h.flush();
    expect(h.host.calls.inserts).toEqual([]);
    expect(h.notes).toHaveLength(1);
    // A settings change that leaves the persona alone does not touch a waiting insert.
    const same = await withReply({ slowNavigate: true });
    void same.h.boards.preview.dispatch({ type: 'OpenAndInsertPart', operationId: same.opId, part: 0 });
    await same.h.flush();
    same.h.bg.setSettings({ ...settings, generation: { ...settings.generation, split: false } });
    await same.h.flush();
    expect(same.h.nav.aborted()).toBe(0);
    expect(same.h.notes).toEqual([]);
  });
});

describe('[NEW-01] [NEW-05] after «Открыть и вставить» the result goes on in the dock of the opened chat (§6.5)', () => {
  const applied: NavigationReceipt = { state: 'navigated', routeEpoch: 6, insert: { state: 'applied', draftRevision: 1, draftDigest: 'feedbeef0000aaaa', ms: 12 } };
  const humanDraft: NavigationReceipt = { state: 'navigated', routeEpoch: 6, insert: { state: 'rejected', code: 'CG-DRAFT-CHANGED', needs: 'confirm-human-draft' } };
  const chat = { host: 'chatspace', hostAccountId: HOST_IDS.acc, platformFanId: '5000' } as const;

  it('the part went into the field: the result is handed to the dock with the persona it was made under; a chat that holds the person’s own text is handed over as a question, not as a toast', async () => {
    const inserted = await withReply({ answers: { navigate: [applied] } });
    expect(await inserted.h.dispatch({ type: 'OpenAndInsertPart', operationId: inserted.opId, part: 1 })).toMatchObject({ ok: true, outcome: 'opened' });
    expect(inserted.h.handovers).toEqual([{ opId: inserted.opId, chat, personaDefinitionId: WORLD.persona.definitionId, split: true, part: { index: 1 }, outcome: 'inserted' }]);

    const asked = await withReply({ answers: { navigate: [humanDraft] } });
    expect(await asked.h.dispatch({ type: 'OpenAndInsertPart', operationId: asked.opId, part: 0 })).toMatchObject({ ok: true, outcome: 'needs-confirm' });
    expect(asked.h.handovers).toEqual([{ opId: asked.opId, chat, personaDefinitionId: WORLD.persona.definitionId, split: true, part: { index: 0 }, outcome: 'needs-confirm' }]);
    // The chat is open with the person's words in its field: the board got out of the way, and nothing is said by a toast from here.
    expect(asked.h.boards.surfaces.current()).toMatchObject({ spenders: false, preview: { spenders: null } });
    expect(asked.h.notes).toEqual([]);
    expect(asked.h.host.calls.inserts).toEqual([]);
  });

  it('a result that came back after a tab reload has no known persona: it is handed over as such, so the dock declines it (§7 «Ограда») — and the controller does not follow it', async () => {
    const { h, opId, handle } = await withReply({ answers: { navigate: [applied] } });
    await h.reload();
    await h.dispatch(open('spenders'));
    await h.dispatch({ type: 'RevealShelf', shelfId: 'shelf-600-plus' });
    await h.dispatch({ type: 'OpenPreview', targetHandle: handle });
    expect(h.boards.preview.getSnapshot(preview('spenders')).result?.opId).toBe(opId);
    expect(await h.dispatch({ type: 'OpenAndInsertPart', operationId: opId, part: 0 })).toMatchObject({ ok: true, outcome: 'opened' });
    expect(h.handovers).toMatchObject([{ opId, personaDefinitionId: null, outcome: 'inserted' }]);
    expect(h.boards.preview.results.part(opId, { index: 0 })).toBeNull();
  });

  it('[NF-022] [X8-08] the dock’s click is answered from the journal as it is at that click (`sync`): what this tab was never told is read then; a journal that does not answer, and a result the controller does not hold, say so', async () => {
    const { h, opId } = await withReply({ config: {}, answers: { navigate: [applied] } });
    const results = h.boards.preview.results;
    // Not handed over: nothing of it is the dock's to ask about.
    expect(await results.sync(opId)).toBe('gone');
    await h.dispatch({ type: 'OpenAndInsertPart', operationId: opId, part: 0 });
    expect(results.part(opId, { index: 0 })).toEqual({ sentAt: null, hold: null });
    // The part is delivered — and the word about it does not reach this tab (it went over another tab's port).
    await h.advance(20_000);
    const sentAt = iso(h.clock.now());
    h.bg.quiet = true;
    h.bg.humanSent(opId, { index: 0 }, '4100');
    await h.flush();
    h.bg.quiet = false;
    expect(results.part(opId, { index: 0 })).toEqual({ sentAt: null, hold: null });
    // The click in the dock: the journal is read now, and the part is what the journal says it is.
    const asked = count(h, 'send.list');
    expect(await results.sync(opId)).toBe('read');
    expect(count(h, 'send.list')).toBe(asked + 1);
    expect(results.part(opId, { index: 0 })).toEqual({ sentAt, hold: null });
    // The journal does not answer: that is said — never taken for «nothing holds the fan».
    h.bg.failNext('send.list', { code: 'CG-RUNTIME-UNREACHABLE' });
    expect(await results.sync(opId)).toBe('unread');
    // Another sign-in: the result is nobody's here.
    h.bg.signIn({ ...session, userId: session.userId + 1, epoch: session.epoch + 1 });
    await h.flush();
    expect(await results.sync(opId)).toBe('gone');
    expect(results.part(opId, { index: 0 })).toBeNull();
  });
});

describe('[RB-010] the port to the background was down: nothing of the boards acts on what was read before the outage', () => {
  const applied: NavigationReceipt = { state: 'navigated', routeEpoch: 6, insert: { state: 'applied', draftRevision: 1, draftDigest: 'feedbeef0000aaaa', ms: 12 } };
  const otherPersona = (h: Harness): SettingsV1 => ({ ...h.bg.settings, personas: { ...h.bg.settings.personas, byPageId: { ...h.bg.settings.personas.byPageId, [String(PAGE.pageId)]: { key: 'other', definitionId: WORLD.persona.otherDefinitionId } } } });
  const insertOf = (h: Harness, index = 0) => partsOf(h, 'spenders')[index]?.openInsert;

  it('[NF-016] the persona changed while the port was down: «Открыть и вставить» of a result made under the old one puts nothing into the chat — during the outage, at the moment the port is back, and after', async () => {
    const { h, opId } = await withReply({ answers: { navigate: [applied] } });
    expect(insertOf(h)).toEqual({ s: 'available' });
    h.bg.setConnection('lost');
    h.bg.setSettings(otherPersona(h));
    await h.flush();
    // The port is down: the click is refused before anything is asked of the page.
    expect(await h.dispatch({ type: 'OpenAndInsertPart', operationId: opId, part: 0 })).toMatchObject({ ok: false });
    h.bg.setConnection('ready');
    // The very step the port came back in: the context has not read the settings yet — and is not trusted.
    const early = h.boards.preview.dispatch({ type: 'OpenAndInsertPart', operationId: opId, part: 0 })!;
    await h.flush();
    expect(await early).toMatchObject({ ok: false });
    // Read again: the page speaks as another persona now, and the text of the old one is not put into a chat.
    expect(await h.dispatch({ type: 'OpenAndInsertPart', operationId: opId, part: 0 })).toMatchObject({ ok: false, code: 'CG-CONTEXT-CHANGED' });
    expect(h.host.calls.navigations).toEqual([]);
    expect(h.host.calls.inserts).toEqual([]);
    expect(h.handovers).toEqual([]);
  });

  it('[TL-004] a part the person sent while the port was down is «Отправлено» once it is back: the sends of every fan this tab follows — an open card, a result in the dock — are read again', async () => {
    const { h, opId } = await withReply({ config: {}, answers: { navigate: [applied] } });
    const results = h.boards.preview.results;
    await h.dispatch({ type: 'OpenAndInsertPart', operationId: opId, part: 0 });
    expect(results.part(opId, { index: 0 })).toEqual({ sentAt: null, hold: null });
    await h.advance(20_000);
    const sentAt = iso(h.clock.now());
    h.bg.setConnection('reconnecting');
    // ChatSpace's own Send; another tab told the background — this tab's port was down.
    h.bg.humanSent(opId, { index: 0 }, '4100');
    await h.flush();
    expect(results.part(opId, { index: 0 })).toMatchObject({ sentAt: null });
    const asked = count(h, 'send.list');
    h.bg.setConnection('ready');
    await h.flush();
    expect(count(h, 'send.list')).toBe(asked + 1);
    expect(results.part(opId, { index: 0 })).toEqual({ sentAt, hold: null });
  });
});

/** «Новые» open on the card of fan 2010, X8 on. */
async function withCard(options: Options = {}): Promise<Harness> {
  const h = await harness({ config: X8, checkpointFan: '2010', ...options });
  await h.dispatch(open('newcomers'));
  await h.dispatch({ type: 'OpenPreview', targetHandle: newcomer('2010') });
  return h;
}

describe('[NF-009] [NF-013] [NF-021] the card of a new fan and the greeting lease', () => {

  it('[NF-013] «Сгенерировать» starts Hi with one variant on the `newcomers` surface and takes no lease (audit 2026-10-20, row 11)', async () => {
    const h = await withCard();
    h.script(0, 'hi-greeting', 'Hi there!\n[NEXT]\nSo happy you are here');
    const receipt = await h.dispatch({ type: 'Generate', targetHandle: newcomer('2010'), feature: 'hi', options: {} });
    expect(receipt.ok).toBe(true);
    expect(count(h, 'newcomers.claim')).toBe(0);
    expect(lastPayload(h, 'op.start')).toMatchObject({ feature: 'hi', surface: 'newcomers', variantCount: 1, tone: null });
    expect(h.host.calls.checkpoints).toHaveLength(1);
    await h.advance(200);
    const vm = h.boards.preview.getSnapshot(preview('newcomers'));
    expect(vm.claim).toEqual({ s: 'none' });
    expect(vm.result?.parts?.map((part) => part.text)).toEqual(['Hi there!', 'So happy you are here']);
    expect(vm.result?.parts?.[0]?.variant).toBe(0);
    expect(h.host.calls.commits).toEqual([]);
  });
});

describe('[NF-019] a greeting is sent part by part, under the lease, and counts only by the receipt and its echo', () => {
  async function greeting(text = 'Hi there!\n[NEXT]\nSo happy you are here'): Promise<{ h: Harness; opId: string }> {
    const h = await withCard();
    const { opId } = h.script(0, 'hi-greeting', text);
    await h.dispatch({ type: 'Generate', targetHandle: newcomer('2010'), feature: 'hi', options: {} });
    await h.advance(200);
    return { h, opId };
  }

  it('the first confirmed part greets the fan; the rest of the group follows by its own clicks; the draft has done its work', async () => {
    const { h, opId } = await greeting();
    await h.dispatch({ type: 'SetPreviewDraft', targetHandle: newcomer('2010'), text: 'my own hello' });
    expect(h.boards.newcomers.getSnapshot(NEWCOMERS).rows[0]).toMatchObject({ hasDraft: true, draftStale: false });
    expect(partsOf(h, 'newcomers').map((part) => part.send?.s)).toEqual(['available', 'available']);
    expect(await h.dispatch({ type: 'SendPart', operationId: opId, variant: 0, part: 0 })).toMatchObject({ ok: true, attemptId: uuid(0x500) });
    expect(h.clicks[0]).toMatchObject({ purpose: 'greeting', part: { variant: 0, index: 0 }, group: { variant: 0, partCount: 2 } });
    // No lease rides the greeting: the hub claims the fan at the send (row 11).
    expect(h.clicks[0]?.leaseToken).toBeUndefined();
    expect(h.boards.preview.getSnapshot(preview('newcomers')).greeting).toEqual({ s: 'sending', sent: 0, total: 2 });
    h.sendState({ attemptId: uuid(0x500), state: 'nativeAccepted', platformMessageId: '4100' });
    await h.flush();
    // A receipt alone is not a greeting.
    expect(h.boards.preview.getSnapshot(preview('newcomers')).greeting).toEqual({ s: 'sending', sent: 0, total: 2 });
    h.sendState({ attemptId: uuid(0x500), state: 'sentObserved', platformMessageId: '4100' });
    await h.flush();
    const vm = h.boards.preview.getSnapshot(preview('newcomers'));
    expect(vm.greeting).toEqual({ s: 'sending', sent: 1, total: 2 });
    expect(vm.result?.sendProgress).toEqual({ sent: 1, total: 2 });
    expect(vm.unread).toBe('read-after-send');
    // The group is not finished: the fan stays in «Поздороваться» with the count.
    expect(h.boards.newcomers.getSnapshot(NEWCOMERS).rows.find((row) => row.handle === newcomer('2010'))?.greeting).toEqual({ s: 'sending', sent: 1, total: 2 });
    expect(h.hub.status().claims.find((c) => c.fanRef === '2010')?.greeting).toBe('confirmed');
    // NF-012: the greeting draft is cleared once a part is confirmed.
    expect(h.boards.preview.draftOf('newcomers', PAGE.pageId, '2010')).toBeNull();
    // §6.7.9: another Hi would be a second greeting — the card does not offer one, by the strip or by «Ещё раз».
    // X5, in its own words: «уже поздоровались — дальше Reply».
    expect(vm.result).toMatchObject({ canRegenerate: false, regenerateReason: { id: 'hi-greeted', code: 'CG-GATE-HI', text: { key: 'dock.reason.hiGreeted' } } });
    expect(vm.bar.actions.hi).toMatchObject({ enabled: false, reason: { id: 'hi-greeted' } });
    expect(await h.dispatch({ type: 'Regenerate', operationId: opId })).toMatchObject({ ok: false, code: 'CG-GATE-HI' });
    expect(await h.dispatch({ type: 'Generate', targetHandle: newcomer('2010'), feature: 'hi', options: {} })).toMatchObject({ ok: false, code: 'CG-GATE-HI' });
    expect(count(h, 'op.start')).toBe(1);
    expect(h.boards.preview.getSnapshot(preview('newcomers')).result?.opId).toBe(opId);
    // The owner still sends the rest of the group.
    expect(partsOf(h, 'newcomers')[1]?.send).toEqual({ s: 'available' });
    await h.dispatch({ type: 'SendPart', operationId: opId, variant: 0, part: 1 });
    h.sendState({ attemptId: uuid(0x501), state: 'nativeAccepted', platformMessageId: '4101' });
    h.sendState({ attemptId: uuid(0x501), state: 'sentObserved', platformMessageId: '4101' });
    await h.flush();
    expect(h.boards.preview.getSnapshot(preview('newcomers')).greeting).toMatchObject({ s: 'greeted' });
    expect(h.host.calls.commits).toHaveLength(2);
    // Greeted: the fan leaves «Поздороваться» and stays in «Все».
    expect(h.boards.newcomers.getSnapshot(NEWCOMERS).rows.find((row) => row.handle === newcomer('2010'))).toBeUndefined();
    await h.dispatch({ type: 'SetNewcomersTab', tab: 'all' });
    expect(h.boards.newcomers.getSnapshot(NEWCOMERS).rows.find((row) => row.handle === newcomer('2010'))?.greeting.s).toBe('greeted');
  });

  it('[NF-017] an answer that cannot be a message — too long for a preview, or still carrying a part marker — is copy-only', async () => {
    const { h, opId } = await greeting('x'.repeat(5001));
    const vm = h.boards.preview.getSnapshot(preview('newcomers'));
    expect(vm.result?.unparsed).toBe(true);
    expect(vm.result?.meta).toContainEqual({ key: 'result.meta.unparsed' });
    expect(vm.result?.parts?.[0]?.send).toMatchObject({ s: 'unavailable', code: 'CG-SEND-PART' });
    expect((await h.dispatch({ type: 'SendPart', operationId: opId, variant: 0, part: 0 })).ok).toBe(false);
    expect(h.clicks).toEqual([]);
    // Copy-only: the unusable text does not ride a navigation into the chat either.
    expect(vm.result?.parts?.[0]?.openInsert).toMatchObject({ s: 'unavailable', reason: { id: 'unparsed' } });
    expect(await h.dispatch({ type: 'OpenAndInsertPart', operationId: opId, variant: 0, part: 0 })).toMatchObject({ ok: false, code: 'CG-OUTPUT-UNUSABLE' });
    expect(h.host.calls.navigations).toEqual([]);
    expect((await h.dispatch({ type: 'Copy', artifactHandle: vm.result!.parts![0]!.copyHandle })).ok).toBe(true);
    expect(h.copied).toHaveLength(1);
    // The same for a Spenders reply that is too long to be one message.
    const long = await withReply({}, 'y'.repeat(5001));
    const part = partsOf(long.h, 'spenders')[0];
    expect(long.h.boards.preview.getSnapshot(preview('spenders')).result?.unparsed).toBe(true);
    expect(part?.openInsert).toMatchObject({ s: 'unavailable', reason: { id: 'unparsed' } });
    expect(await long.h.dispatch({ type: 'OpenAndInsertPart', operationId: long.opId, part: 0 })).toMatchObject({ ok: false, code: 'CG-OUTPUT-UNUSABLE' });
    expect(long.h.host.calls.navigations).toEqual([]);
  });
});

// ── decision X53: the media picker of a preview ──

const photo = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: 'photo' as const, duration: 0, ready: true, thumb: `https://pw365.ompcdn.com/${id}.jpg`, createdAt: null, ...extra });
const VAULT: FakeMediaVault = {
  folders: [
    { id: '880001', name: 'Messages', kind: 'messages', photos: 6215, videos: 1067, other: 2 },
    { id: '880002', name: 'Stand set', kind: 'custom', photos: 14, videos: 0, other: 0 },
  ],
  items: {
    all: [photo('11'), photo('12'), photo('13', { type: 'video', duration: 75 }), photo('14', { ready: false })],
    '880002': [photo('21'), photo('22')],
  },
  states: { '5000': [{ id: '11', state: 'paid', priceCents: 1500 }, { id: '12', state: 'free', priceCents: null }] },
  tags: { '12': { users: ['77'], guests: [] } },
};
const pv = (h: Harness) => h.boards.preview.getSnapshot(preview('spenders'));

describe('X59 on ChatSpace: a batch draft of «Новые» is sent by its row’s own «Отправить»', () => {
  it('one click sends the greeting’s next part by the card’s own send, the card never opened; nothing more while it goes', async () => {
    const h = await harness({ config: X8, checkpointFan: '2010' });
    await h.dispatch(open('newcomers'));
    h.script(0, 'hi-greeting', 'Hi there!\n[NEXT]\nSo happy you are here');
    expect(await h.dispatch({ type: 'SetBatchPick', list: 'newcomers', targetHandles: [newcomer('2010')], picked: true })).toMatchObject({ ok: true });
    expect(await h.dispatch({ type: 'GenerateBatch', list: 'newcomers' })).toMatchObject({ ok: true, outcome: 'started' });
    await h.advance(500);
    const row = (): NewcomerRowVM | undefined => h.boards.newcomers.getSnapshot(NEWCOMERS).rows.find((entry) => entry.handle === newcomer('2010'));
    expect(row()).toMatchObject({ batch: { state: 'ready', text: 'Hi there!' }, send: { can: true, refused: null } });
    // Generating sent nothing.
    expect(h.clicks).toEqual([]);
    expect(await h.dispatch({ type: 'SendNewcomerGreeting', targetHandle: newcomer('2010') })).toMatchObject({ ok: true });
    expect(h.clicks).toHaveLength(1);
    expect(h.clicks[0]).toMatchObject({ purpose: 'greeting', part: { variant: 0, index: 0 }, group: { variant: 0, partCount: 2 } });
    expect(count(h, 'op.start')).toBe(1);
    // While it goes the row's «Отправить» waits, and a second click sends nothing.
    expect(row()?.send?.can).toBe(false);
    expect((await h.dispatch({ type: 'SendNewcomerGreeting', targetHandle: newcomer('2010') })).ok).toBe(false);
    expect(h.clicks).toHaveLength(1);
    // Confirmed: the next click is the greeting's next part, by its own click.
    h.sendState({ attemptId: uuid(0x500), state: 'nativeAccepted', platformMessageId: '4100' });
    h.sendState({ attemptId: uuid(0x500), state: 'sentObserved', platformMessageId: '4100' });
    await h.flush();
    expect(row()?.send?.can).toBe(true);
    expect(await h.dispatch({ type: 'SendNewcomerGreeting', targetHandle: newcomer('2010') })).toMatchObject({ ok: true });
    expect(h.clicks).toHaveLength(2);
    expect(h.clicks[1]).toMatchObject({ part: { variant: 0, index: 1 } });
  });
});

describe('[X53] media from the vault go with a part sent from the preview', () => {

  it('picks in the order of the clicks, a medium not ready is never picked; the price and the release forms decide whether a part may take them', async () => {
    const { h, handle, opId } = await withReply({ media: VAULT });
    await h.dispatch({ type: 'SetMediaOpen', targetHandle: handle, open: true });
    await h.flush();
    await h.dispatch({ type: 'PickMedia', targetHandle: handle, mediaId: '12' });
    await h.dispatch({ type: 'PickMedia', targetHandle: handle, mediaId: '11' });
    expect(await h.dispatch({ type: 'PickMedia', targetHandle: handle, mediaId: '14' })).toMatchObject({ ok: true, outcome: 'noop' });
    // The release forms are being read: the parts wait for them.
    expect(pv(h).media).toMatchObject({ picks: 2, tags: 'loading', attached: null, blocked: { key: 'preview.media.blocked.tagsLoading' } });
    expect(partsOf(h, 'spenders')[0]?.send).toEqual({ s: 'unavailable', code: 'CG-SEND-MEDIA', reason: { key: 'preview.media.blocked.tagsLoading' } });
    await h.advance(300);
    expect(h.host.calls.media.at(-1)).toEqual({ of: 'tags', acc: HOST_IDS.acc, ids: ['12', '11'] });
    expect(pv(h).media).toMatchObject({ tags: 'ok', attached: { count: 2, priceCents: 0 }, blocked: null, summary: { key: 'preview.media.summaryFree' } });
    expect(pv(h).media?.grid.items.slice(0, 2).map((cell) => cell.order)).toEqual([2, 1]);
    expect(partsOf(h, 'spenders')[0]?.send).toEqual({ s: 'available' });

    // A price below OnlyFans' $3: the field says so, the part's «Отправить» is held, a click sends nothing.
    await h.dispatch({ type: 'SetMediaPrice', targetHandle: handle, text: '2' });
    expect(pv(h).media?.price).toEqual({ text: '2', problem: { key: 'preview.media.price.min' } });
    expect(partsOf(h, 'spenders')[0]?.send).toEqual({ s: 'unavailable', code: 'CG-SEND-MEDIA', reason: { key: 'preview.media.blocked.price' } });
    expect(await h.dispatch({ type: 'SendPart', operationId: opId, part: 0 })).toMatchObject({ ok: false, code: 'CG-SEND-MEDIA' });
    expect(h.clicks).toEqual([]);

    // A priced message whose every medium is a free preview cannot go either.
    await h.dispatch({ type: 'SetMediaPrice', targetHandle: handle, text: '24.99' });
    await h.dispatch({ type: 'ToggleMediaFree', targetHandle: handle, mediaId: '12' });
    await h.dispatch({ type: 'ToggleMediaFree', targetHandle: handle, mediaId: '11' });
    expect(pv(h).media).toMatchObject({ priced: true, allFree: true, blocked: { key: 'preview.media.blocked.allFree' } });
    await h.dispatch({ type: 'ToggleMediaFree', targetHandle: handle, mediaId: '11' });
    expect(pv(h).media).toMatchObject({ allFree: false, attached: { count: 2, priceCents: 2499 }, blocked: null });
  });

  it('«Отправить» of a part takes the picks: one click, one message — the text, the media in order, the price, the previews, the tags; once the platform took it they are gone', async () => {
    const { h, handle, opId } = await withReply({ media: VAULT });
    await h.dispatch({ type: 'SetMediaOpen', targetHandle: handle, open: true });
    await h.flush();
    await h.dispatch({ type: 'PickMedia', targetHandle: handle, mediaId: '12' });
    await h.dispatch({ type: 'PickMedia', targetHandle: handle, mediaId: '13' });
    await h.dispatch({ type: 'SetMediaPrice', targetHandle: handle, text: '$25' });
    await h.dispatch({ type: 'ToggleMediaFree', targetHandle: handle, mediaId: '12' });
    await h.advance(300);
    expect(await h.dispatch({ type: 'SendPart', operationId: opId, part: 0 })).toMatchObject({ ok: true });
    await h.flush();
    const media = {
      items: [
        { id: '12', type: 'photo', duration: 0, thumb: 'https://pw365.ompcdn.com/12.jpg', free: true },
        { id: '13', type: 'video', duration: 75, thumb: 'https://pw365.ompcdn.com/13.jpg', free: false },
      ],
      priceCents: 2500,
      tags: { users: ['77'], guests: [] },
    };
    expect(h.clicks).toHaveLength(1);
    expect(h.clicks[0]?.media).toEqual(media);
    expect(h.host.calls.commits.map((commit) => [commit.request.plainText, commit.request.media])).toEqual([['Hey you', media]]);
    // The background never sees the media, only their two marks for who sent it (X48); MAIN does.
    expect(JSON.stringify(h.bg.begins)).not.toContain('pw365');
    expect(JSON.stringify(h.bg.begins)).not.toContain('"media"');
    expect(h.bg.begins.map((begin) => begin.marks)).toEqual([{ priced: true, withMedia: true }]);
    // The picks left the picker with the click: what the person does there now changes nothing of this send.
    expect(pv(h).media).toMatchObject({ open: false, picks: 0, attached: null });
    const attemptId = h.host.calls.commits[0]!.request.attemptId;
    h.sendState({ attemptId, state: 'nativeAccepted', platformMessageId: '9001' });
    await h.flush();
    expect(pv(h).media).toMatchObject({ open: false, picks: 0, attached: null });
    // The next part goes as text alone.
    expect(partsOf(h, 'spenders')[1]?.send?.s).not.toBe('unavailable');
  });

  it('picks come back only when the send proved it never reached the platform; picks made meanwhile stand', async () => {
    const { h, handle, opId } = await withReply({ media: VAULT, answers: { commit: [{ state: 'notEnqueued', code: 'CG-SEND-QUEUE' }] } });
    await h.dispatch({ type: 'SetMediaOpen', targetHandle: handle, open: true });
    await h.flush();
    await h.dispatch({ type: 'PickMedia', targetHandle: handle, mediaId: '12' });
    await h.advance(300);
    expect(await h.dispatch({ type: 'SendPart', operationId: opId, part: 0 })).toMatchObject({ ok: true });
    await h.flush();
    // The queue refused it: nothing went, the pick is back for the next click.
    expect(pv(h).media).toMatchObject({ picks: 1 });
    expect(partsOf(h, 'spenders')[0]?.send).toMatchObject({ s: 'rejected', canRetry: true });
    // A send that may have gone keeps its picks: an uncertain outcome gives nothing back.
    const second = await withReply({ media: VAULT, answers: { commit: [{ state: 'uncertain', code: 'CG-SEND-UNCERTAIN' }] } });
    await second.h.dispatch({ type: 'SetMediaOpen', targetHandle: second.handle, open: true });
    await second.h.flush();
    await second.h.dispatch({ type: 'PickMedia', targetHandle: second.handle, mediaId: '12' });
    await second.h.advance(300);
    await second.h.dispatch({ type: 'SendPart', operationId: second.opId, part: 0 });
    await second.h.flush();
    expect(pv(second.h).media).toMatchObject({ picks: 0 });
  });

  it('a failed read is a card with «Повторить»; failed release forms are a warning: the part goes with its media, without tags (2026-10-22)', async () => {
    const { h, handle, opId } = await withReply({ media: { ...VAULT, fail: { folders: 'session', tags: 'http' } } });
    await h.dispatch({ type: 'SetMediaOpen', targetHandle: handle, open: true });
    await h.flush();
    expect(pv(h).media?.folders.error).toMatchObject({ code: 'CG-HOST-SESSION' });
    expect(pv(h).media?.grid.items).toHaveLength(4);
    await h.dispatch({ type: 'PickMedia', targetHandle: handle, mediaId: '11' });
    await h.advance(300);
    expect(pv(h).media).toMatchObject({ tags: 'failed', blocked: null, attached: { count: 1 } });
    const before = h.host.calls.media.length;
    await h.dispatch({ type: 'RetryMedia', targetHandle: handle });
    await h.advance(300);
    expect(h.host.calls.media.slice(before).map((request) => request.of)).toEqual(['folders', 'tags']);
    // Still unreadable: the part is the person's to send, and it goes with the pick and no tags.
    expect(partsOf(h, 'spenders')[0]?.send).toEqual({ s: 'available' });
    expect(await h.dispatch({ type: 'SendPart', operationId: opId, part: 0 })).toMatchObject({ ok: true });
    expect(h.clicks.at(-1)?.media).toMatchObject({ items: [{ id: '11' }], tags: { users: [], guests: [] } });
  });
});

describe('1.32.0 a batch of the Spenders board', () => {
  it('ticks fans, starts one generation each by one click, shows each row how it went, and sends nothing', async () => {
    const h = await harness({ config: X8 });
    await h.dispatch(open('spenders'));
    await h.dispatch({ type: 'RevealShelf', shelfId: 'shelf-600-plus' });
    const fans = ['5000', '5001'];
    h.script(0, 'fast-reply', 'Hey you');
    h.script(1, 'fast-reply', 'Missed me?');
    expect(await h.dispatch({ type: 'SetBatchPick', list: 'spenders', targetHandles: fans.map(spender), picked: true })).toMatchObject({ ok: true, outcome: 'done' });
    const board = (): SpendersBoardVM => h.boards.spenders.getSnapshot({ of: 'spenders.board' });
    expect(board().batch).toMatchObject({ picked: 2, queued: 0 });
    expect(await h.dispatch({ type: 'GenerateBatch', list: 'spenders' })).toMatchObject({ ok: true, outcome: 'started' });
    await h.advance(500);
    expect(count(h, 'op.start')).toBe(2);
    const rows = board().shelves.flatMap((shelf) => shelf.rows).filter((row) => fans.includes(row.handle.split(':').pop() ?? ''));
    expect(rows.map((row) => row.batch?.state)).toEqual(['ready', 'ready']);
    expect(rows.map((row) => row.batch?.text).sort()).toEqual(['Hey you', 'Missed me?']);
    expect(board().batch).toMatchObject({ picked: 0, ready: 2, generating: 0 });
    // The result waits on the fan's card; nothing went anywhere by itself.
    await h.dispatch({ type: 'OpenPreview', targetHandle: spender('5000') });
    expect(h.boards.preview.getSnapshot(preview('spenders')).result?.state).toBe('done');
    expect(h.clicks).toEqual([]);
    expect(h.host.calls.inserts).toEqual([]);
  });
});
