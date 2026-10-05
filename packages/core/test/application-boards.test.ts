// The R12 surface controllers end to end inside a tab: the Spenders board
// and its statistics, previews, «Новые» and the fan panel over the tab
// protocol — answered by the real R10 scheduler, tokens and send coordinator
// with the fake hub behind them — and over the fake host port. What is
// checked is what a person would see and what leaves the tab: the view
// models, the requests, and every write to the host.

import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, sendLockKey, type Bootstrap, type CgCode, type HostEvent, type HostPort, type HubFrame, type IncomingFact, type NavigateOptions, type NavigationIntent, type NavigationReceipt, type PartVM, type PersonaCatalog, type PreviewSource, type SendAttemptView, type SessionIdentity, type SettingsV1, type SpendersStats, type UiAction, type ViewSelector } from '@cg/contracts';
import { createBoardsControllers, fanHandle, type BoardsControllers, type PreviewSendClick } from '@cg/core/application/boards';
import { FEED_PAGE_SIZE, RATE_LIMIT_HOLD_MS } from '@cg/core/application/preview';
import { SEARCH_DEBOUNCE_MS } from '@cg/core/application/spenders';
import { createI18n, type LiveI18n } from '@cg/core/domain/i18n';
import { PreviewSendDriver } from '@cg/core/services';
import { createFakeHub, hubCall, type FakeHub, type FakeHubConfigPatch } from '@cg/testing/fake-hub';
import { DOCUMENT, FakeHostPort, HOST_IDS, contractReport, hostAccount, memory as hostMemory, startSnapshot, type HostAnswers, type HostScript, type HostStep } from '@cg/testing/host';
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
  const newDriver = (): PreviewSendDriver => new PreviewSendDriver({ port: host.previewSend, background: bg.sendPort, ids: attemptIds, onView: (view) => viewListeners.forEach((listener) => listener(view)), clock });
  let driver = newDriver();
  const notes: { code: CgCode; scope: string }[] = [];
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
/** Time passes in small steps, so the hub's clock and the tab's stay together (a lease renewed at 40 s is renewed on the hub at 40 s). */
async function walk(h: Harness, ms: number, stepMs = 10_000): Promise<void> {
  for (let passed = 0; passed < ms; passed += stepMs) await h.advance(Math.min(stepMs, ms - passed));
}
/** The background says its flags moved: every context reads the sign-in, the bootstrap and the binding again. */
const reread = (h: Harness): void => h.bg.emit('flags.changed', { flags: {}, configRevision: h.bootstrap.configRevision });

describe('[SP-002] [SP-003] [SP-004] the Spenders board opens', () => {
  it('[SP-003] [SP-022] waits for the page identity, then shows 1000 of 1240 rows as a cut list with its data time and coverage; nothing is read while it is closed', async () => {
    const h = await harness();
    expect(count(h, 'spenders.board')).toBe(0);
    expect(count(h, 'spenders.stats')).toBe(0);
    await h.dispatch(open('spenders'));
    expect(h.boards.surfaces.current().spenders).toBe(true);
    const vm = h.boards.spenders.getSnapshot(BOARD);
    expect(vm.view).toEqual({ s: 'partial', gaps: [{ kind: 'truncated', shown: 1000, total: 1240 }] });
    expect(vm.pageName).toBe('Model One');
    expect(vm.period).toBe('30d');
    expect(vm.periods).toEqual(['lifetime', '30d', 'mtd', '7d', 'today']);
    expect(vm.footer).toMatchObject({ loaded: 1000, total: 1240, shown: null });
    expect(vm.footer.stamp.coverage).toBe('partial');
    expect(vm.canLoadMore).toBe(false);
    // SP-010: the plain view previews shelves; the $600+ shelf of 1000 rows starts collapsed.
    expect(vm.shelves[0]).toMatchObject({ id: 'shelf-600-plus', rows: [] });
    expect(vm.shelves[0]?.collapsed?.hidden).toBe(1000);
    expect(lastPayload(h, 'spenders.board')).toEqual({ pageId: PAGE.pageId, period: '30d' });
    expect(h.bg.schemaFailures).toEqual([]);
  });

  it('[SP-003] before the identity is known the board says «loading», not «empty»', async () => {
    const h = await harness();
    const release = h.bg.hold('session.get');
    void h.boards.context.refresh();
    await h.flush();
    void h.dispatch({ type: 'ReloadView', selector: BOARD });
    release();
    await h.flush();
    expect(h.boards.spenders.getSnapshot(BOARD).view.s).not.toBe('empty');
  });

  it('[SP-009] [SP-010] [SP-045] every shelf that has fans shows with its count; «показать» reveals it; a shelf nobody has is not drawn', async () => {
    const h = await harness();
    await h.dispatch(open('spenders'));
    const shelf = h.boards.spenders.getSnapshot(BOARD).shelves[0]!;
    expect(shelf.collapsed?.reveal.action).toEqual({ type: 'RevealShelf', shelfId: 'shelf-600-plus' });
    await h.dispatch(shelf.collapsed!.reveal.action);
    const revealed = h.boards.spenders.getSnapshot(BOARD).shelves;
    // SP-011: the fake hub counts 31 fans on a bucket the board lists 1000 rows on. A count its own rows disprove is not shown,
    // and a cut list is never summed as the shelf: the header says «—» instead of «31» next to the sum of a thousand rows.
    expect(revealed.map((s) => [s.id, s.fans, s.lifetime, s.period])).toEqual([['shelf-600-plus', null, null, null]]);
    expect(revealed[0]?.rows).toHaveLength(1000);
    expect(revealed[0]?.collapsed).toBeNull();
    expect(revealed[0]?.rows[0]).toMatchObject({ handle: spender('5000'), name: 'fan_0', lifetime: 3_720_000, period: 1_240_000, selected: false });
    expect((await h.dispatch({ type: 'RevealShelf', shelfId: 'shelf-nope' })).ok).toBe(true);
  });
});

describe('[SP-023] [SP-029] [SP-030] [SP-032] what the board says when it cannot show rows', () => {
  it('[SP-029] [SP-024] a failed read is an error card with «Повторить», never an empty list; the refresh reads past the cache', async () => {
    const h = await harness();
    h.bg.failNext('spenders.board', { code: 'CG-DATA-UNAVAILABLE', detail: 'HTTP 502' });
    await h.dispatch(open('spenders'));
    const failed = h.boards.spenders.getSnapshot(BOARD);
    expect(failed.view).toMatchObject({ s: 'error', error: { code: 'CG-DATA-UNAVAILABLE' }, retry: { type: 'ReloadView', selector: BOARD } });
    expect(failed.shelves).toEqual([]);
    // Nothing repeats by itself.
    await h.advance(60_000);
    expect(count(h, 'spenders.board')).toBe(1);
    await h.dispatch({ type: 'ReloadView', selector: BOARD });
    expect(h.boards.spenders.getSnapshot(BOARD).view.s).toBe('partial');
    expect(lastPayload(h, 'spenders.board')).toEqual({ pageId: PAGE.pageId, period: '30d', force: true });
  });

  it('[SP-030] an answered empty board is «empty»; a hub that does not answer is «offline»', async () => {
    const empty = await harness({ config: { spendersTotal: 0 } });
    await empty.dispatch(open('spenders'));
    expect(empty.boards.spenders.getSnapshot(BOARD).view).toEqual({ s: 'empty', why: { key: 'common.empty' } });
    const down = await harness();
    down.bg.failNext('spenders.board', { code: 'CG-HUB-UNAVAILABLE' });
    await down.dispatch(open('spenders'));
    expect(down.boards.spenders.getSnapshot(BOARD).view).toMatchObject({ s: 'offline', error: { code: 'CG-HUB-UNAVAILABLE' }, lastGoodAt: null });
  });

  it('[SP-032] without a sign-in, a binding or the owner switch the board is «forbidden» with the way out', async () => {
    const signedOut = await harness({ session: null });
    await signedOut.dispatch(open('spenders'));
    expect(signedOut.boards.spenders.getSnapshot(BOARD).view).toMatchObject({ s: 'forbidden', error: { code: 'CG-AUTH-REQUIRED' }, remedy: { type: 'OpenSettings', route: { section: 'account' } } });
    expect(count(signedOut, 'spenders.board')).toBe(0);

    const stranger = { ...hostAccount, platformAccountId: '3999' };
    const unbound = await harness({ start: { accounts: [stranger], route: { ...startSnapshot.route, account: stranger } } });
    await unbound.dispatch(open('spenders'));
    expect(unbound.boards.spenders.getSnapshot(BOARD).view).toMatchObject({ s: 'forbidden', error: { code: 'CG-BINDING-MISSING' } });

    const off = await harness({ config: { pageFlags: { [PAGE.pageLabel]: { spenders: false } } } });
    await off.dispatch(open('spenders'));
    expect(off.boards.spenders.getSnapshot(BOARD).view).toMatchObject({ s: 'forbidden', error: { code: 'CG-FEATURE-DISABLED', detail: 'flag_off' } });
    expect(count(off, 'spenders.board')).toBe(0);
  });

  it('[SP-024] a refresh shows what the hub has now, in the rows as well as in the footer', async () => {
    const h = await harness({ config: { spendersTotal: 3 } });
    // The mounted board is rendered on every change, the refresh in flight included.
    const seen: number[] = [];
    h.boards.spenders.subscribe(BOARD, (vm) => seen.push(vm.shelves[0]?.rows.length ?? 0));
    await h.dispatch(open('spenders'));
    const before = h.boards.spenders.getSnapshot(BOARD);
    expect(before.view).toEqual({ s: 'ready' });
    expect(before.footer).toMatchObject({ loaded: 3, total: 3 });
    expect(before.shelves[0]?.rows.map((row) => row.handle)).toEqual([spender('5000'), spender('5001'), spender('5002')]);
    h.hub.control({ op: 'config', patch: { spendersTotal: 5 } });
    await h.dispatch({ type: 'ReloadView', selector: BOARD });
    const after = h.boards.spenders.getSnapshot(BOARD);
    expect(after.footer).toMatchObject({ loaded: 5, total: 5 });
    // The first shelf previews four rows; the fifth is behind «показать».
    expect(after.shelves[0]?.rows.map((row) => row.handle)).toEqual([spender('5000'), spender('5001'), spender('5002'), spender('5003')]);
    expect(after.shelves[0]?.collapsed?.hidden).toBe(1);
    expect(seen.at(-1)).toBe(4);
  });

  it('[SP-031] an assembly that timed out is an error with «Повторить», not a wait without end', async () => {
    const h = await harness();
    h.bg.failNext('spenders.board', { code: 'CG-DATA-TIMEOUT', detail: 'timed_out' });
    await h.dispatch(open('spenders'));
    expect(h.boards.spenders.getSnapshot(BOARD).view).toMatchObject({ s: 'error', error: { code: 'CG-DATA-TIMEOUT' }, retry: { type: 'ReloadView', selector: BOARD } });
    expect(h.boards.spenders.getSnapshot(BOARD).shelves).toEqual([]);
  });

  it('[SP-023] a refresh that fails keeps the rows on screen and names the failure', async () => {
    const h = await harness();
    await h.dispatch(open('spenders'));
    h.bg.failNext('spenders.board', { code: 'CG-DATA-TIMEOUT' });
    await h.dispatch({ type: 'ReloadView', selector: BOARD });
    const vm = h.boards.spenders.getSnapshot(BOARD);
    expect(vm.view.s).toBe('partial');
    expect(vm.view.s === 'partial' && vm.view.gaps).toContainEqual({ kind: 'source-failed', source: 'board', code: 'CG-DATA-TIMEOUT' });
    expect(vm.footer.loaded).toBe(1000);
  });
});

describe('[SP-006] [SP-018] [SP-019] [SP-020] [SP-021] period, search, filters, sort', () => {
  it('[SP-006] [SP-026] a period is read once and kept for ten minutes; switching back does not ask again', async () => {
    const h = await harness();
    await h.dispatch(open('spenders'));
    await h.dispatch({ type: 'SetSpendersPeriod', period: '7d' });
    expect(lastPayload(h, 'spenders.board')).toEqual({ pageId: PAGE.pageId, period: '7d' });
    expect(h.boards.spenders.getSnapshot(BOARD).period).toBe('7d');
    await h.dispatch({ type: 'SetSpendersPeriod', period: '30d' });
    expect(count(h, 'spenders.board')).toBe(2);
    await h.advance(10 * 60_000 + 1);
    await h.dispatch({ type: 'SetSpendersPeriod', period: '7d' });
    expect(count(h, 'spenders.board')).toBe(3);
  });

  it('[SP-019] the field echoes at once, the list follows 150 ms after the last keystroke — one filtering for a burst', async () => {
    const h = await harness();
    await h.dispatch(open('spenders'));
    let renders = 0;
    const off = h.boards.spenders.subscribe(BOARD, () => {
      renders += 1;
    });
    for (const query of ['f', 'fa', 'fan_4', 'fan_42']) {
      void h.boards.spenders.dispatch({ type: 'Search', list: 'spenders', query });
      await h.clock.advance(40);
    }
    const typing = h.boards.spenders.getSnapshot(BOARD);
    expect(typing.query).toBe('fan_42');
    expect(typing.footer.shown).toBeNull();
    const before = renders;
    await h.clock.advance(SEARCH_DEBOUNCE_MS);
    const found = h.boards.spenders.getSnapshot(BOARD);
    expect(found.footer.shown).toBe(11);
    expect(found.shelves[0]?.rows).toHaveLength(11);
    expect(found.reset?.action).toEqual({ type: 'ResetFilters', list: 'spenders' });
    expect(renders - before).toBe(1);
    off();
    await h.dispatch({ type: 'Search', list: 'spenders', query: 'zzz-nobody' });
    await h.advance(SEARCH_DEBOUNCE_MS);
    expect(h.boards.spenders.getSnapshot(BOARD).view).toEqual({ s: 'empty', why: { key: 'spenders.empty' } });
    await h.dispatch({ type: 'ResetFilters', list: 'spenders' });
    const reset = h.boards.spenders.getSnapshot(BOARD);
    expect(reset).toMatchObject({ query: '', reset: null });
    expect(reset.footer.shown).toBeNull();
  });

  it('[SP-020] [SP-018] filters press one at a time per group with their counters; the sort changes the order inside a shelf', async () => {
    const h = await harness({ config: { pageFlags: { [PAGE.pageLabel]: { stats: false } } } });
    await h.dispatch(open('spenders'));
    const pressed = (): string[] => h.boards.spenders.getSnapshot(BOARD).filters.filter((f) => f.pressed).map((f) => f.id);
    expect(pressed()).toEqual(['all']);
    expect(h.boards.spenders.getSnapshot(BOARD).filters.find((f) => f.id === 'all')?.count).toBe(1000);
    await h.dispatch({ type: 'SetSpendersFilter', filter: 'waiting' });
    await h.dispatch({ type: 'SetSpendersFilter', filter: 'history' });
    expect(pressed()).toEqual(['waiting', 'history']);
    const waiting = h.boards.spenders.getSnapshot(BOARD);
    expect(waiting.footer.shown).toBe(waiting.filters.find((f) => f.id === 'waiting')?.count);
    await h.dispatch({ type: 'SetSpendersFilter', filter: 'all' });
    expect(pressed()).toEqual(['all']);
    await h.dispatch({ type: 'RevealShelf', shelfId: 'shelf-600-plus' });
    const bySum = h.boards.spenders.getSnapshot(BOARD).shelves[0]!.rows.slice(0, 3).map((row) => row.handle);
    await h.dispatch({ type: 'SetSpendersSort', sort: 'fan-age' });
    const byFan = h.boards.spenders.getSnapshot(BOARD);
    expect(byFan.sort).toBe('fan-age');
    expect(byFan.shelves[0]!.rows.slice(0, 3).map((row) => row.handle)).not.toEqual(bySum);
    // The most recent «Фан писал» is first, a fan who never wrote is last.
    expect(byFan.shelves[0]!.rows.at(-1)?.fanWroteAt).toBeNull();
  });

  it('[SP-047] «Ждут ответа» is the hub queue over the whole page, in cursor pages', async () => {
    const h = await harness({ queuePageSize: 2 });
    await h.dispatch(open('spenders'));
    await h.dispatch({ type: 'SetSpendersFilter', filter: 'waiting' });
    let vm = h.boards.spenders.getSnapshot(BOARD);
    expect(lastPayload(h, 'spenders.queue')).toEqual({ pageId: PAGE.pageId, cursor: null, limit: 2 });
    expect(vm.filters.find((f) => f.id === 'waiting')?.count).toBe(5);
    expect(vm.footer).toMatchObject({ loaded: 2, total: 5, shown: 2 });
    expect(vm.canLoadMore).toBe(true);
    expect(vm.shelves.flatMap((shelf) => shelf.rows.map((row) => row.handle))).toEqual([spender('5000'), spender('5003')]);
    expect(vm.shelves[0]?.rows.every((row) => row.waiting)).toBe(true);
    await h.dispatch({ type: 'LoadMore', list: 'spenders' });
    await h.dispatch({ type: 'LoadMore', list: 'spenders' });
    vm = h.boards.spenders.getSnapshot(BOARD);
    expect(vm.footer).toMatchObject({ loaded: 5, total: 5 });
    expect(vm.canLoadMore).toBe(false);
    expect(count(h, 'spenders.queue')).toBe(3);
    const cursors = h.bg.requests.filter((r) => r.type === 'spenders.queue').map((r) => (r.payload as { cursor: string | null }).cursor);
    expect(cursors[0]).toBeNull();
    expect(cursors[1]).not.toBeNull();
    expect(cursors[2]).not.toBe(cursors[1]);
  });
  it('[SP-047] a cursor the hub no longer takes (400 `cursor_invalid`) starts the walk over from the first page — once: no error card for it, and no loop of requests when the hub refuses again', async () => {
    const refused = { code: 'CG-HUB-REQUEST', detail: 'HTTP 400 • bad_request/cursor_invalid' } as const;
    const cursorsOf = (h: Harness): (string | null)[] => h.bg.requests.filter((r) => r.type === 'spenders.queue').map((r) => (r.payload as { cursor: string | null }).cursor);
    const h = await harness({ queuePageSize: 2 });
    await h.dispatch(open('spenders'));
    await h.dispatch({ type: 'SetSpendersFilter', filter: 'waiting' });
    expect(h.boards.spenders.getSnapshot(BOARD).footer).toMatchObject({ loaded: 2, total: 5 });

    // The queue was rebuilt under the walk: the second page's cursor is refused.
    h.bg.failNext('spenders.queue', refused);
    await h.dispatch({ type: 'LoadMore', list: 'spenders' });
    let vm = h.boards.spenders.getSnapshot(BOARD);
    // One more request, without a cursor: the first page again — and the list is a list, not an error.
    expect(cursorsOf(h).map((cursor) => cursor === null)).toEqual([true, false, true]);
    expect(vm.view.s).not.toBe('error');
    expect(vm.footer).toMatchObject({ loaded: 2, total: 5, shown: 2 });
    expect(vm.canLoadMore).toBe(true);
    // The new walk goes on from its own cursor.
    await h.dispatch({ type: 'LoadMore', list: 'spenders' });
    expect(h.boards.spenders.getSnapshot(BOARD).footer).toMatchObject({ loaded: 4, total: 5 });
    expect(cursorsOf(h)).toHaveLength(4);

    // Refused again in the same walk: the queue's own failure now (the board falls back to its own rows, as for
    // any failed queue read) — nothing is asked a third time by itself.
    h.bg.failNext('spenders.queue', refused);
    await h.dispatch({ type: 'LoadMore', list: 'spenders' });
    await h.advance(60_000);
    expect(cursorsOf(h)).toHaveLength(5);
    vm = h.boards.spenders.getSnapshot(BOARD);
    expect(vm.canLoadMore).toBe(false);
    expect(vm.footer.total).not.toBe(5);

    // A refusal of the FIRST page is not a cursor's: an error at once, no restart.
    const first = await harness({ queuePageSize: 2 });
    await first.dispatch(open('spenders'));
    first.bg.failNext('spenders.queue', refused);
    await first.dispatch({ type: 'SetSpendersFilter', filter: 'waiting' });
    expect(cursorsOf(first)).toEqual([null]);
    // Any other failure of a later page keeps its own error, without a restart either.
    const offline = await harness({ queuePageSize: 2 });
    await offline.dispatch(open('spenders'));
    await offline.dispatch({ type: 'SetSpendersFilter', filter: 'waiting' });
    offline.bg.failNext('spenders.queue', { code: 'CG-HUB-UNAVAILABLE' });
    await offline.dispatch({ type: 'LoadMore', list: 'spenders' });
    expect(cursorsOf(offline).map((cursor) => cursor === null)).toEqual([true, false]);
  });
});

describe('[SP-044] [SP-049] statistics come after the ranking and fail on their own', () => {
  it('[SP-044] shows the hub numbers with their coverage and time; S expands', async () => {
    const h = await harness();
    await h.dispatch(open('spenders'));
    const vm = h.boards.spenders.getSnapshot(STATS);
    expect(lastPayload(h, 'spenders.stats')).toEqual({ pageId: PAGE.pageId, windowDays: 30, timeZone: 'Europe/Moscow' });
    expect(vm.view).toEqual({ s: 'ready' });
    expect(vm).toMatchObject({ expanded: false, windowDays: 30, timeZone: 'Europe/Moscow' });
    expect(vm.today.mills).toBe(3_290_000);
    expect(vm.d7).toMatchObject({ mills: 22_820_000, prev7: 22_330_000, changePct: 2.19 });
    expect(vm.d30).toMatchObject({ mills: 94_350_000, purchases: 1635 });
    expect(vm.payers.count).toBe(640);
    expect(vm.avgCheck.mills).toBe(58_623);
    expect(vm.attention.awaiting.count).toBe(5);
    // §8.7: «ждёт ответа; прочтение неизвестно» is a category of its own; SP-046: what the fans silent >21 d spent in all.
    expect(vm.attention.awaitingUnknown).toEqual({ count: 1, stamp: vm.stamp });
    expect(vm.attention.silentOver21).toEqual({ count: 300, stamp: vm.stamp, lifetime: 15_000_000 });
    expect(vm.attention.silent8to21.count).toBe(120);
    expect(vm.stamp).toEqual({ asOf: iso(NOW_MS), coverage: 'complete' });
    expect(vm.days).toHaveLength(30);
    // The board cut at 1000 cannot vouch for a shelf's lifetime sum… unless it holds the whole shelf.
    expect(vm.shelves.map((shelf) => shelf.id)).toEqual(['shelf-600-plus', 'shelf-0-25', 'shelf-outside', 'shelf-unattributed']);
    // The hub's two remainder tiers are two rows, each named by what it is.
    expect(vm.shelves.map((shelf) => shelf.remainder ?? null)).toEqual([null, null, 'untiered', 'unattributed']);
    // «Без тира» is the board's «вне полок» shelf; «не распределено» has no fans behind it: a click reveals nothing.
    expect(await h.dispatch({ type: 'RevealShelf', shelfId: 'shelf-unattributed' })).toMatchObject({ ok: true, outcome: 'noop' });
    await h.dispatch({ type: 'SetStatsExpanded', expanded: true });
    expect(h.boards.spenders.getSnapshot(STATS).expanded).toBe(true);
  });

  it('[SP-029] failed statistics are an error of their own column: every number unknown, the board untouched', async () => {
    const h = await harness();
    h.bg.failNext('spenders.stats', { code: 'CG-DATA-NOT-READY' });
    await h.dispatch(open('spenders'));
    const stats = h.boards.spenders.getSnapshot(STATS);
    expect(stats.view).toMatchObject({ s: 'error', error: { code: 'CG-DATA-NOT-READY' }, retry: { type: 'ReloadView', selector: STATS } });
    expect(stats.today.mills).toBeNull();
    expect(stats.payers.count).toBeNull();
    expect(stats.days).toEqual([]);
    expect(h.boards.spenders.getSnapshot(BOARD).footer.loaded).toBe(1000);
    await h.dispatch({ type: 'ReloadView', selector: STATS });
    expect(h.boards.spenders.getSnapshot(STATS).view).toEqual({ s: 'ready' });
  });

  it('[SP-044] a hub answer with unknowns shows them as unknown, never as zero (a scripted hub answer)', async () => {
    const h = await harness();
    const request = { pageLabel: PAGE.pageLabel, windowDays: 30, timeZone: 'Europe/Moscow' };
    const real = (await (await hubCall(h.hub.fetch, h.hub.origin, 'clientSpenderStats', request, { token: h.hub.issueToken() })).json()) as SpendersStats;
    const sparse: SpendersStats = {
      ...real,
      avgCheckMills: null,
      totals: { ...real.totals, d7DeltaPct: null },
      days: real.days.slice(1),
      coverage: { state: 'backfilling', reasons: ['history_incomplete'] },
    };
    h.hub.control({ op: 'scriptHttp', match: 'route', unscripted: 'model', exchanges: [{ route: 'clientSpenderStats', request, response: { status: 200, body: sparse } }] });
    await h.dispatch(open('spenders'));
    const vm = h.boards.spenders.getSnapshot(STATS);
    expect(vm.view).toEqual({ s: 'partial', gaps: [{ kind: 'coverage', level: 'unknown' }] });
    expect(vm.avgCheck.mills).toBeNull();
    expect(vm.d7).toMatchObject({ mills: 22_820_000, changePct: null, prev7: 22_330_000 });
    expect(vm.days).toHaveLength(30);
    expect(vm.days[0]).toEqual({ date: real.days[0]!.date, gross: null, today: false });
    expect(vm.days.filter((day) => day.gross === null)).toHaveLength(1);
    expect(vm.stamp).toEqual({ asOf: iso(NOW_MS), coverage: 'unknown' });
    // What the hub did send stays what it sent.
    expect(vm.payers.count).toBe(640);
    expect(h.bg.schemaFailures).toEqual([]);
  });

  it('[SP-028] the ranking shows at once and the statistics draw in after it; a refresh keeps the rows on screen', async () => {
    const h = await harness();
    const releaseStats = h.bg.hold('spenders.stats');
    void h.boards.spenders.dispatch(open('spenders'));
    await h.flush();
    expect(h.boards.spenders.getSnapshot(BOARD).footer.loaded).toBe(1000);
    expect(h.boards.spenders.getSnapshot(STATS).view.s).toBe('loading');
    releaseStats();
    await h.flush();
    expect(h.boards.spenders.getSnapshot(STATS).view).toEqual({ s: 'ready' });
    // A refresh in flight: the rows stay, marked as the last good read; nothing blinks to «loading».
    await h.dispatch({ type: 'RevealShelf', shelfId: 'shelf-600-plus' });
    const releaseBoard = h.bg.hold('spenders.board');
    const reload = h.boards.spenders.dispatch({ type: 'ReloadView', selector: BOARD });
    await h.flush();
    const during = h.boards.spenders.getSnapshot(BOARD);
    expect(during.shelves[0]?.rows).toHaveLength(1000);
    expect(during.view.s === 'partial' && during.view.gaps.map((gap) => gap.kind)).toEqual(['truncated', 'stale-cache']);
    releaseBoard();
    await reload;
    await h.flush();
    const after = h.boards.spenders.getSnapshot(BOARD);
    expect(after.view.s === 'partial' && after.view.gaps.map((gap) => gap.kind)).toEqual(['truncated']);
    // The revealed shelf stays revealed: nothing the person was looking at moved.
    expect(after.shelves[0]?.rows).toHaveLength(1000);
  });

  it('the statistics switch off without the board: «forbidden», no request', async () => {
    const h = await harness({ config: { pageFlags: { [PAGE.pageLabel]: { stats: false } } } });
    await h.dispatch(open('spenders'));
    expect(h.boards.spenders.getSnapshot(STATS).view).toMatchObject({ s: 'forbidden', error: { code: 'CG-FEATURE-DISABLED' } });
    expect(count(h, 'spenders.stats')).toBe(0);
    expect(h.boards.spenders.getSnapshot(BOARD).footer.loaded).toBe(1000);
  });
});

describe('[SP-033] [SP-034] [SP-035] [SP-042] [SP-043] keys, opening a chat, a changed identity, the language', () => {
  it('[SP-035] Enter or a click opens the chat through the host on the person’s token and closes the board; a failed navigation keeps it', async () => {
    const h = await harness();
    await h.dispatch(open('spenders'));
    const receipt = await h.dispatch({ type: 'Navigate', to: { kind: 'chat', targetHandle: spender('5001') } });
    expect(receipt).toMatchObject({ ok: true, outcome: 'opened' });
    expect(h.host.calls.navigations).toHaveLength(1);
    expect(h.host.calls.navigations[0]?.target).toEqual({ hostAccountId: HOST_IDS.acc, platformFanId: '5001' });
    expect(h.host.calls.navigations[0]?.thenInsert).toBeUndefined();
    expect(h.host.calls.redeemed[0]).toMatchObject({ kind: 'navigate', redeemed: true });
    expect(h.boards.surfaces.current().spenders).toBe(false);

    const failing = await harness({ answers: { navigate: [{ state: 'failed', code: 'CG-NAV-FAILED', insert: null }] } });
    await failing.dispatch(open('spenders'));
    expect(await failing.dispatch({ type: 'Navigate', to: { kind: 'chat', targetHandle: spender('5001') } })).toMatchObject({ ok: false, code: 'CG-NAV-FAILED' });
    expect(failing.boards.surfaces.current().spenders).toBe(true);
    // A handle of another page is nobody's.
    expect(failing.boards.spenders.dispatch({ type: 'Navigate', to: { kind: 'chat', targetHandle: fanHandle('spenders', 99, '5001') } })).toBeNull();
  });

  it('[SP-035] the click on a fan is the board’s own switch on its page, not `navigation`: with `navigation` off the Spenders row, a card of «Новые» and «Открыть и вставить» still open the chat; a board switched off on the page opens nothing', async () => {
    // The live pilot: `navigation` is off in the owner's `"*"` row and on the page itself.
    const navigationOff: FakeHubConfigPatch = { ...X8, flags: { ...X8.flags, navigation: false }, pageFlags: { [PAGE.pageLabel]: { navigation: false } } };
    const h = await harness({ config: navigationOff });
    expect(h.bootstrap.pages.find((page) => page.pageId === PAGE.pageId)?.features['navigation']).toEqual({ available: false, reason: 'flag_off' });
    expect(h.bootstrap.flags['navigation']).toBe(false);
    await h.dispatch(open('spenders'));
    expect(await h.dispatch({ type: 'Navigate', to: { kind: 'chat', targetHandle: spender('5001') } })).toMatchObject({ ok: true, outcome: 'opened' });
    await h.dispatch(open('newcomers'));
    expect(await h.dispatch({ type: 'Navigate', to: { kind: 'chat', targetHandle: newcomer('2010') } })).toMatchObject({ ok: true, outcome: 'opened' });
    expect(h.host.calls.navigations.map((intent) => intent.target.platformFanId)).toEqual(['5001', '2010']);
    const insert = await withReply({ config: navigationOff, answers: { navigate: [{ state: 'navigated', routeEpoch: 6, insert: { state: 'applied', draftRevision: 1, draftDigest: 'feedbeef0000aaaa', ms: 12 } }] } });
    expect(partsOf(insert.h, 'spenders')[0]?.openInsert).toMatchObject({ s: 'available' });
    expect(await insert.h.dispatch({ type: 'OpenAndInsertPart', operationId: insert.opId, part: 0 })).toMatchObject({ ok: true, outcome: 'opened' });
    expect(insert.h.host.calls.navigations[0]?.thenInsert).toMatchObject({ text: 'Hey you' });

    // The owner switches the board off on the page while it is open (`navigation` may say anything): the click of
    // a row that is still on screen opens nothing — neither the host nor the background is asked.
    for (const [surface, flag, handle] of [['spenders', 'spenders', spender('5001')], ['newcomers', 'newcomers', newcomer('2010')]] as const) {
      const off = await harness();
      await off.dispatch(open(surface));
      off.hub.control({ op: 'config', patch: { flags: { navigation: true }, pageFlags: { [PAGE.pageLabel]: { [flag]: false, navigation: true } } } });
      off.bg.setBootstrap((await hubCall(off.hub.fetch, off.hub.origin, 'clientBootstrap', null, { token: off.hub.issueToken() }).then((response) => response.json())) as Bootstrap);
      await off.flush();
      const tokens = count(off, 'token.issue');
      expect(await off.dispatch({ type: 'Navigate', to: { kind: 'chat', targetHandle: handle } }), `${flag} off on the page`).toMatchObject({ ok: false, code: 'CG-FEATURE-DISABLED' });
      expect([off.host.calls.navigations, count(off, 'token.issue') - tokens]).toEqual([[], 0]);
    }
    // The preview's own switch gates «Открыть и вставить» the same way.
    const previewOff = await withReply();
    previewOff.h.hub.control({ op: 'config', patch: { pageFlags: { [PAGE.pageLabel]: { preview: false } } } });
    previewOff.h.bg.setBootstrap((await hubCall(previewOff.h.hub.fetch, previewOff.h.hub.origin, 'clientBootstrap', null, { token: previewOff.h.hub.issueToken() }).then((response) => response.json())) as Bootstrap);
    await previewOff.h.flush();
    expect(await previewOff.h.dispatch({ type: 'OpenAndInsertPart', operationId: previewOff.opId, part: 0 })).toMatchObject({ ok: false });
    expect(previewOff.h.host.calls.navigations).toEqual([]);
  });

  it('[SP-033] [SP-034] the keys footer lists the board keys; a key becomes the action of the focused row', async () => {
    const h = await harness();
    await h.dispatch(open('spenders'));
    await h.dispatch({ type: 'RevealShelf', shelfId: 'shelf-600-plus' });
    const vm = h.boards.spenders.getSnapshot(BOARD);
    expect(vm.keys.map((key) => [key.label.key, key.hotkey.display])).toEqual([
      ['spenders.keys.row', 'J / K'],
      ['preview.label', 'Space'],
      ['common.openChat', 'O'],
      ['stats.title', 'S'],
      ['cheatsheet.row.search', '/'],
      ['common.close', 'Esc'],
    ]);
    const s = h.boards.spenders;
    expect(s.command('row-next', null)).toEqual({ focusRow: spender('5000') });
    expect(s.command('row-next', spender('5000'))).toEqual({ focusRow: spender('5001') });
    expect(s.command('row-previous', spender('5000'))).toEqual({ focusRow: spender('5000') });
    expect(s.command('preview', spender('5001'))).toEqual({ action: { type: 'OpenPreview', targetHandle: spender('5001') } });
    expect(s.command('open-chat', spender('5001'))).toEqual({ action: { type: 'Navigate', to: { kind: 'chat', targetHandle: spender('5001') } } });
    expect(s.command('open-chat', null)).toBeNull();
    expect(s.command('toggle-stats', null)).toEqual({ action: { type: 'SetStatsExpanded', expanded: true } });
    expect(s.command('focus-search', null)).toEqual({ focusSearch: true });
    expect(s.command('clear-search', null)).toEqual({ action: { type: 'Search', list: 'spenders', query: '' } });
    expect(s.command('close-board', null)).toEqual({ action: open('spenders', false) });
  });

  it('[SP-042] another sign-in or account closes the board and drops what it held', async () => {
    const h = await harness();
    await h.dispatch(open('spenders'));
    await h.dispatch({ type: 'SetSpendersFilter', filter: 'new' });
    h.bg.signIn({ ...session, epoch: 4 });
    await h.flush();
    expect(h.boards.surfaces.current().spenders).toBe(false);
    const vm = h.boards.spenders.getSnapshot(BOARD);
    expect(vm.shelves).toEqual([]);
    expect(vm.filters.filter((f) => f.pressed).map((f) => f.id)).toEqual(['all']);
    await h.dispatch(open('spenders'));
    expect(count(h, 'spenders.board')).toBe(2);
  });

  it('[SP-042] an answer for the previous identity is dropped, never shown', async () => {
    const h = await harness();
    const release = h.bg.hold('spenders.board');
    void h.boards.spenders.dispatch(open('spenders'));
    await h.flush();
    h.bg.signIn({ ...session, epoch: 4 });
    await h.flush();
    release();
    await h.flush();
    expect(h.boards.spenders.getSnapshot(BOARD).shelves).toEqual([]);
    expect(h.boards.spenders.getSnapshot(BOARD).footer.loaded).toBe(0);
  });

  it('[SP-042] a statistics answer for the previous identity is dropped, even when the new identity is already asking for its own', async () => {
    const h = await harness();
    const releaseOld = h.bg.hold('spenders.stats');
    const releaseNew = h.bg.hold('spenders.stats');
    void h.boards.spenders.dispatch(open('spenders'));
    await h.flush();
    expect(count(h, 'spenders.stats')).toBe(1);
    h.bg.signIn({ ...session, epoch: 4 });
    await h.flush();
    // The new sign-in opens the board: its own statistics are on their way.
    void h.boards.spenders.dispatch(open('spenders'));
    await h.flush();
    expect(count(h, 'spenders.stats')).toBe(2);
    releaseOld();
    await h.flush();
    const during = h.boards.spenders.getSnapshot(STATS);
    expect(during.view.s).toBe('loading');
    expect(during.today.mills).toBeNull();
    expect(during.days).toEqual([]);
    releaseNew();
    await h.flush();
    expect(h.boards.spenders.getSnapshot(STATS)).toMatchObject({ view: { s: 'ready' }, today: { mills: 3_290_000 } });
  });

  it('[SP-029] a failed read is repeated by the person, not by every event of the page: the error card stays, with one request behind it', async () => {
    const h = await harness();
    h.bg.failNext('spenders.board', { code: 'CG-DATA-UNAVAILABLE' });
    h.bg.failNext('spenders.stats', { code: 'CG-DATA-NOT-READY' });
    await h.dispatch(open('spenders'));
    expect(h.boards.spenders.getSnapshot(BOARD).view).toMatchObject({ s: 'error', error: { code: 'CG-DATA-UNAVAILABLE' } });
    expect(count(h, 'spenders.board')).toBe(1);
    expect(count(h, 'spenders.stats')).toBe(1);
    // The context is read again and again (flags, the catalog, the settings, the bootstrap): nothing repeats the failed reads.
    reread(h);
    await h.flush();
    h.bg.emit('catalog.changed', {});
    await h.flush();
    h.bg.setSettings({ ...settings, generation: { ...settings.generation, split: false } });
    await h.flush();
    h.bg.setBootstrap(h.bootstrap);
    await h.flush();
    await h.advance(120_000);
    expect(count(h, 'spenders.board')).toBe(1);
    expect(count(h, 'spenders.stats')).toBe(1);
    expect(h.boards.spenders.getSnapshot(BOARD).view.s).toBe('error');
    // «Повторить» is the one way on.
    await h.dispatch({ type: 'ReloadView', selector: BOARD });
    expect(count(h, 'spenders.board')).toBe(2);
    expect(h.boards.spenders.getSnapshot(BOARD).footer.loaded).toBe(1000);
  });

  it('[SP-042] two readings of the context overlap: the older one, answering last, is not applied over the newer', async () => {
    const h = await harness();
    await h.dispatch(open('spenders'));
    const epoch = h.boards.context.current().epoch;
    // A reading starts and waits for the bootstrap…
    const release = h.bg.hold('bootstrap.get');
    reread(h);
    await h.flush();
    // …another sign-in happens meanwhile, and its own reading finishes first.
    h.bg.signIn({ ...session, epoch: 4 });
    await h.flush();
    expect(h.boards.context.current()).toMatchObject({ phase: 'ready', epoch: epoch + 1, session: { epoch: 4 } });
    release();
    await h.flush();
    // The late reading had read the old sign-in: it changes nothing.
    expect(h.boards.context.current()).toMatchObject({ phase: 'ready', epoch: epoch + 1, session: { epoch: 4 } });
    expect(h.boards.context.current().binding?.loginEpoch).toBe(4);
  });

  it('[SP-042] a context read that merely failed is not another identity: the board, the preview and its result stay, the view says «нет связи»', async () => {
    const { h, opId, handle } = await withReply();
    const epoch = h.boards.context.current().epoch;
    // The background's port dropped while the context was read again.
    h.bg.failNext('bootstrap.get', { code: 'CG-RUNTIME-UNREACHABLE' });
    reread(h);
    await h.flush();
    const lost = h.boards.context.current();
    expect(lost).toMatchObject({ phase: 'blocked', blocker: { code: 'CG-RUNTIME-UNREACHABLE' }, epoch });
    expect(lost.binding?.pageId).toBe(PAGE.pageId);
    expect(h.boards.surfaces.current()).toMatchObject({ spenders: true, preview: { spenders: handle } });
    expect(h.boards.spenders.getSnapshot(BOARD).view).toMatchObject({ s: 'offline', error: { code: 'CG-RUNTIME-UNREACHABLE' } });
    expect(h.boards.spenders.getSnapshot(BOARD).shelves[0]?.rows.length).toBeGreaterThan(0);
    const during = h.boards.preview.getSnapshot(preview('spenders'));
    expect(during.result?.opId).toBe(opId);
    // Nothing is sent, inserted or generated while the identity cannot be confirmed.
    expect(during.result?.parts?.[0]?.send).toMatchObject({ s: 'unavailable' });
    expect((await h.dispatch({ type: 'OpenAndInsertPart', operationId: opId, part: 0 })).ok).toBe(false);
    expect((await h.dispatch({ type: 'Generate', targetHandle: handle, feature: 'ping', options: {} })).ok).toBe(false);
    expect(h.host.calls.navigations).toEqual([]);
    // A slow answer is the same: a failure of the read, not of the person.
    h.bg.failNext('session.get', { code: 'CG-TIMEOUT' });
    h.bg.emit('catalog.changed', {});
    await h.flush();
    expect(h.boards.context.current()).toMatchObject({ phase: 'blocked', epoch });
    // The next read answers: everything is where it was, on the same epoch.
    reread(h);
    await h.flush();
    expect(h.boards.context.current()).toMatchObject({ phase: 'ready', epoch });
    expect(h.boards.surfaces.current().spenders).toBe(true);
    const back = h.boards.preview.getSnapshot(preview('spenders'));
    expect(back.result?.opId).toBe(opId);
    expect(back.result?.parts?.[0]?.send).toEqual({ s: 'available' });
  });

  it('[SP-042] a refusal that names the person or the page ends the identity: revoked access closes the board', async () => {
    const { h } = await withReply();
    const epoch = h.boards.context.current().epoch;
    h.bg.failNext('bootstrap.get', { code: 'CG-AUTH-REVOKED' });
    reread(h);
    await h.flush();
    expect(h.boards.context.current().epoch).toBe(epoch + 1);
    expect(h.boards.surfaces.current()).toMatchObject({ spenders: false, preview: { spenders: null } });
    expect(h.boards.preview.getSnapshot(preview('spenders')).result).toBeNull();
    // A failed read that comes with ANOTHER sign-in is that sign-in's, not the old one's.
    const other = await withReply();
    const before = other.h.boards.context.current().epoch;
    other.h.bg.session = { ...session, epoch: 9 };
    other.h.bg.failNext('bootstrap.get', { code: 'CG-HUB-TIMEOUT' });
    reread(other.h);
    await other.h.flush();
    expect(other.h.boards.context.current().epoch).toBe(before + 1);
    expect(other.h.boards.surfaces.current().spenders).toBe(false);
  });

  it('[SP-043] the board speaks the chosen language and switches on the fly', async () => {
    const h = await harness({ session: null });
    await h.dispatch(open('spenders'));
    const ru = h.boards.spenders.getSnapshot(BOARD).view;
    expect(ru.s === 'forbidden' && ru.error.title).toBe('Нужно войти');
    let notified = 0;
    h.boards.spenders.subscribe(BOARD, () => {
      notified += 1;
    });
    h.i18n.setLanguage('en');
    const en = h.boards.spenders.getSnapshot(BOARD).view;
    expect(en.s === 'forbidden' && en.error.title).not.toBe('Нужно войти');
    expect(notified).toBeGreaterThan(0);
  });
});

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

  it('[SP-056] the neighbours follow the visible order; ← → open them; Esc closes the preview and unmarks the row', async () => {
    const h = await harness();
    await h.dispatch(open('spenders'));
    await h.dispatch({ type: 'RevealShelf', shelfId: 'shelf-600-plus' });
    await h.dispatch({ type: 'OpenPreview', targetHandle: spender('5001') });
    const vm = h.boards.preview.getSnapshot(preview('spenders'));
    expect(vm.neighbors).toEqual({ previous: { type: 'OpenPreview', targetHandle: spender('5000') }, next: { type: 'OpenPreview', targetHandle: spender('5002') } });
    expect(h.boards.spenders.command('fan-next', null)).toEqual({ action: vm.neighbors.next });
    await h.dispatch(vm.neighbors.next!);
    expect(h.boards.preview.getSnapshot(preview('spenders')).header?.name).toBe('Fan 2');
    await h.dispatch(vm.close);
    expect(h.boards.preview.getSnapshot(preview('spenders')).handle).toBeNull();
    expect(h.boards.spenders.getSnapshot(BOARD).previewOpen).toBe(false);
    expect((await h.dispatch({ type: 'OpenPreview', targetHandle: spender('9999') })).ok).toBe(false);
  });

  it('[SP-053] [CS-030] older pages come by the hub cursor: 50 → 100 → 112, then nothing older (a fan ChatSpace shows online, from the palette)', async () => {
    const h = await harness();
    const online = h.boards.palette.online();
    expect(online.map((fan) => fan.fanRef)).toEqual([HOST_IDS.fan]);
    await h.dispatch({ type: 'OpenPreview', targetHandle: online[0]!.handle });
    let vm = h.boards.preview.getSnapshot(preview('palette'));
    expect(vm.header?.name).toBe('Fan Two');
    expect(vm.feed.items).toHaveLength(50);
    expect(vm.feed.hasOlder).toBe(true);
    // Reading order: the oldest of the page first, the newest last.
    expect(vm.feed.items.at(-1)?.id).toBe('6000');
    await h.dispatch({ type: 'LoadOlder', targetHandle: online[0]!.handle });
    await h.dispatch({ type: 'LoadOlder', targetHandle: online[0]!.handle });
    vm = h.boards.preview.getSnapshot(preview('palette'));
    expect(vm.feed.items).toHaveLength(112);
    expect(new Set(vm.feed.items.map((item) => item.id)).size).toBe(112);
    expect(vm.feed.hasOlder).toBe(false);
    expect(vm.feed.items[0]?.id).toBe('6111');
    const reads = h.bg.requests.filter((r) => r.type === 'feed.read').map((r) => (r.payload as { cursor: string | null }).cursor);
    expect(reads[0]).toBeNull();
    expect(reads.slice(1).every((cursor) => typeof cursor === 'string')).toBe(true);
    await h.dispatch({ type: 'LoadOlder', targetHandle: online[0]!.handle });
    expect(count(h, 'feed.read')).toBe(3);
    // A fan ChatSpace does not show online has no preview from the palette.
    expect((await h.dispatch({ type: 'OpenPreview', targetHandle: fanHandle('palette', PAGE.pageId, HOST_IDS.previewFan) })).ok).toBe(false);
  });

  it('[SP-053] a cursor the hub no longer takes starts a new pass from the first page; a failed older page is an error of the feed, with the rows kept', async () => {
    const h = await harness();
    const handle = h.boards.palette.online()[0]!.handle;
    await h.dispatch({ type: 'OpenPreview', targetHandle: handle });
    h.hub.control({ op: 'archiveRebuild', pageLabel: PAGE.pageLabel, fanRef: HOST_IDS.fan });
    await h.dispatch({ type: 'LoadOlder', targetHandle: handle });
    let vm = h.boards.preview.getSnapshot(preview('palette'));
    expect(vm.feed.items).toHaveLength(50);
    expect(vm.feed.olderError).toBeNull();
    expect(count(h, 'feed.read')).toBe(3);
    h.bg.failNext('feed.read', { code: 'CG-HUB-TIMEOUT' });
    await h.dispatch({ type: 'LoadOlder', targetHandle: handle });
    vm = h.boards.preview.getSnapshot(preview('palette'));
    expect(vm.feed.olderError?.code).toBe('CG-HUB-TIMEOUT');
    expect(vm.feed.items).toHaveLength(50);
    expect(vm.feed.hasOlder).toBe(true);
  });

  it('[AI-038] the Ping chip is the hub summary; [DB-026] «Обновить архив» reads the first page again and shows a lag the hub reports', async () => {
    const h = await harness();
    const handle = h.boards.palette.online()[0]!.handle;
    await h.dispatch({ type: 'OpenPreview', targetHandle: handle });
    expect(h.boards.preview.getSnapshot(preview('palette')).ping).toEqual({ segment: 'active', fanSilenceDays: 0 });
    h.hub.control({ op: 'archiveMessage', pageLabel: PAGE.pageLabel, fanRef: HOST_IDS.fan, sender: 'fan', messageId: '7001' });
    const refresh = h.boards.preview.getSnapshot(preview('palette')).archive.refresh;
    expect(refresh.action).toEqual({ type: 'RefreshArchive', targetHandle: handle });
    await h.dispatch(refresh.action);
    const vm = h.boards.preview.getSnapshot(preview('palette'));
    expect(vm.feed.items.at(-1)?.id).toBe('7001');
    expect(vm.archive.refreshing).toBe(false);
    // A failed first read with nothing to show is the error card with «Повторить».
    const failing = await harness();
    failing.bg.failNext('feed.read', { code: 'CG-DATA-UNAVAILABLE' });
    await failing.dispatch({ type: 'OpenPreview', targetHandle: failing.boards.palette.online()[0]!.handle });
    expect(failing.boards.preview.getSnapshot(preview('palette')).view).toMatchObject({ s: 'error', error: { code: 'CG-DATA-UNAVAILABLE' }, retry: { type: 'RefreshArchive' } });
  });
});

describe('[NEW-10] [NF-012] the local draft of a preview', () => {
  it('[NEW-10] the draft stays in the preview and in local storage, never in ChatSpace; Fix needs it', async () => {
    const h = await harness();
    await h.boards.preview.ready();
    await h.dispatch(open('spenders'));
    await h.dispatch({ type: 'RevealShelf', shelfId: 'shelf-600-plus' });
    await h.dispatch({ type: 'OpenPreview', targetHandle: spender('5000') });
    let vm = h.boards.preview.getSnapshot(preview('spenders'));
    expect(vm.draft).toEqual({ text: '', maxChars: 5000, placeholder: { key: 'preview.draft.placeholder' } });
    expect(vm.bar.actions.fix).toMatchObject({ enabled: false, reason: { id: 'needs-draft', code: 'CG-GATE-DRAFT' } });
    expect((await h.dispatch({ type: 'Generate', targetHandle: spender('5000'), feature: 'fix', options: {} })).ok).toBe(false);
    await h.dispatch({ type: 'SetPreviewDraft', targetHandle: spender('5000'), text: 'hey you, miss me?' });
    vm = h.boards.preview.getSnapshot(preview('spenders'));
    expect(vm.draft.text).toBe('hey you, miss me?');
    expect(vm.bar.actions.fix).toMatchObject({ enabled: true, reason: null });
    expect(h.draftStore.saves).toBe(1);
    expect(JSON.stringify(h.draftStore.value)).toContain('hey you, miss me?');
    expect(h.host.calls.inserts).toEqual([]);
    // It is there again when the preview reopens, and for no other fan.
    await h.dispatch({ type: 'OpenPreview', targetHandle: spender('5001') });
    expect(h.boards.preview.getSnapshot(preview('spenders')).draft.text).toBe('');
    await h.dispatch({ type: 'OpenPreview', targetHandle: spender('5000') });
    expect(h.boards.preview.getSnapshot(preview('spenders')).draft.text).toBe('hey you, miss me?');
  });

  it('[NF-012] the draft field of a «Новые» card is the greeting\'s own: its placeholder says so, a preview\'s talks about Fix', async () => {
    const h = await harness();
    await h.boards.preview.ready();
    await h.dispatch(open('newcomers'));
    // No fan on the card yet, and one opened: the same words either way.
    expect(h.boards.preview.getSnapshot(preview('newcomers')).draft.placeholder).toEqual({ key: 'newcomers.greetingDraft.placeholder' });
    await h.dispatch({ type: 'OpenPreview', targetHandle: newcomer('2010') });
    expect(h.boards.preview.getSnapshot(preview('newcomers')).draft.placeholder).toEqual({ key: 'newcomers.greetingDraft.placeholder' });
    expect(h.boards.preview.getSnapshot(preview('spenders')).draft.placeholder).toEqual({ key: 'preview.draft.placeholder' });
  });

  it('[NF-012] a sign-out erases the drafts from memory and storage; another user signing in finds none', async () => {
    const h = await harness();
    await h.boards.preview.ready();
    await h.dispatch(open('spenders'));
    await h.dispatch({ type: 'RevealShelf', shelfId: 'shelf-600-plus' });
    await h.dispatch({ type: 'OpenPreview', targetHandle: spender('5000') });
    await h.dispatch({ type: 'SetPreviewDraft', targetHandle: spender('5000'), text: 'secret draft of user A' });
    expect(JSON.stringify(h.draftStore.value)).toContain('secret draft of user A');
    h.bg.signIn(null, 'sign-out');
    await h.flush();
    expect(JSON.stringify(h.draftStore.value ?? null)).not.toContain('secret draft');
    expect(h.draftStore.value).toEqual({ v: 1, drafts: [] });
    h.bg.signIn({ ...session, userId: 99, epoch: 5 });
    await h.flush();
    expect(JSON.stringify(h.draftStore.value ?? null)).not.toContain('secret draft');
    expect(h.boards.preview.draftOf('spenders', PAGE.pageId, '5000')).toBeNull();
    // User A comes back: the draft is gone for good, not kept aside.
    h.bg.signIn(session);
    await h.flush();
    expect(h.boards.preview.draftOf('spenders', PAGE.pageId, '5000')).toBeNull();
  });

  it('[NF-012] another user’s drafts left on disk are erased when this user’s sign-in is read', async () => {
    const theirs = `${WORLD.hubOrigin}|99|${PAGE.pageId}|spenders|5001`;
    const h = await harness({ storedDrafts: { v: 1, drafts: [{ key: theirs, text: 'someone else', revision: 1, threadRevision: null, updatedAt: NOW_MS - 1000 }] } });
    await h.boards.preview.ready();
    await h.flush();
    expect(JSON.stringify(h.draftStore.value)).not.toContain('someone else');
  });

  it('[NEW-10] two ChatSpace tabs share the drafts: a write merges draft by draft, each tab follows the other, a removal is not undone', async () => {
    const h = await harness();
    await h.boards.preview.ready();
    await h.dispatch(open('spenders'));
    await h.dispatch({ type: 'RevealShelf', shelfId: 'shelf-600-plus' });
    await h.dispatch({ type: 'OpenPreview', targetHandle: spender('5000') });
    const otherKey = `${WORLD.hubOrigin}|${WORLD.user.userId}|${PAGE.pageId}|spenders|5001`;
    const other = { key: otherKey, text: 'draft from the other tab', revision: 1, threadRevision: null, updatedAt: NOW_MS + 10 };
    // The other tab wrote while this one was not listening (no change event): this tab's next write keeps it.
    h.draftStore.value = { v: 1, drafts: [other] };
    await h.advance(20);
    await h.dispatch({ type: 'SetPreviewDraft', targetHandle: spender('5000'), text: 'draft from this tab' });
    expect(JSON.stringify(h.draftStore.value)).toContain('draft from the other tab');
    expect(JSON.stringify(h.draftStore.value)).toContain('draft from this tab');
    expect(h.boards.preview.draftOf('spenders', PAGE.pageId, '5001')?.text).toBe('draft from the other tab');
    // The other tab edits its draft: this tab follows at once.
    const stored = h.draftStore.value as { v: 1; drafts: { key: string }[] };
    await h.advance(20);
    h.draftStore.external({ v: 1, drafts: [...stored.drafts.filter((d) => d.key !== otherKey), { ...other, text: 'edited in the other tab', revision: 2, updatedAt: h.clock.now() }] });
    await h.flush();
    expect(h.boards.preview.draftOf('spenders', PAGE.pageId, '5001')?.text).toBe('edited in the other tab');
    expect(h.boards.preview.getSnapshot(preview('spenders')).draft.text).toBe('draft from this tab');
    // The other tab clears this fan's draft: it stays cleared here, and this tab does not write it back.
    const now = h.clock.now();
    await h.advance(20);
    const mine = `${WORLD.hubOrigin}|${WORLD.user.userId}|${PAGE.pageId}|spenders|5000`;
    const current = h.draftStore.value as { v: 1; drafts: { key: string }[] };
    h.draftStore.external({ v: 1, drafts: current.drafts.filter((d) => d.key !== mine), removed: [{ key: mine, revision: 9, removedAt: now + 20 }] });
    await h.flush();
    expect(h.boards.preview.getSnapshot(preview('spenders')).draft.text).toBe('');
    expect(JSON.stringify(h.draftStore.value)).not.toContain('draft from this tab');
    // A write the browser refuses is said once, as a toast; nothing is lost from the field.
    h.draftStore.failSaves = 2;
    await h.dispatch({ type: 'SetPreviewDraft', targetHandle: spender('5000'), text: 'typed while storage refuses' });
    await h.dispatch({ type: 'SetPreviewDraft', targetHandle: spender('5000'), text: 'typed while storage refuses!' });
    expect(h.notes.filter((note) => note.code === 'CG-STORAGE-WRITE')).toEqual([{ code: 'CG-STORAGE-WRITE', scope: 'preview:drafts' }]);
    expect(h.boards.preview.getSnapshot(preview('spenders')).draft.text).toBe('typed while storage refuses!');
    await h.dispatch({ type: 'SetPreviewDraft', targetHandle: spender('5000'), text: 'typed while storage refuses!!' });
    expect(JSON.stringify(h.draftStore.value)).toContain('typed while storage refuses!!');
  });

  it('[NF-012] a stored draft comes back after a reload; another user’s never shows', async () => {
    const mine = `${WORLD.hubOrigin}|${WORLD.user.userId}|${PAGE.pageId}|spenders|5000`;
    const theirs = `${WORLD.hubOrigin}|99|${PAGE.pageId}|spenders|5001`;
    const stored = { v: 1, drafts: [{ key: mine, text: 'kept draft', revision: 4, threadRevision: null, updatedAt: NOW_MS - 1000 }, { key: theirs, text: 'someone else', revision: 1, threadRevision: null, updatedAt: NOW_MS - 1000 }] };
    const h = await harness({ storedDrafts: stored });
    await h.boards.preview.ready();
    expect(h.boards.preview.draftOf('spenders', PAGE.pageId, '5000')).toEqual({ text: 'kept draft', threadRevision: null });
    expect(h.boards.preview.draftOf('spenders', PAGE.pageId, '5001')).toBeNull();
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

  it('while it runs: the stage line, a locked strip, the stream as text without buttons; a second click shows it, another feature is refused', async () => {
    const h = await harness({ config: X8 });
    await h.dispatch(open('spenders'));
    await h.dispatch({ type: 'RevealShelf', shelfId: 'shelf-600-plus' });
    await h.dispatch({ type: 'OpenPreview', targetHandle: spender('5000') });
    const { opId } = h.script(0, 'fast-reply', 'Hey you');
    await h.dispatch({ type: 'Generate', targetHandle: spender('5000'), feature: 'reply', options: { tone: 'flirty' } });
    const running = h.boards.preview.getSnapshot(preview('spenders'));
    expect(running.result).toMatchObject({ opId, state: expect.stringMatching(/admitted|requesting|streaming/) as unknown, parts: null, canRegenerate: false });
    expect(running.result?.phase?.cancel).toEqual({ type: 'CancelGeneration', operationId: opId });
    expect(running.bar.locked).toBe(true);
    expect(running.bar.actions.reply).toMatchObject({ busy: true, enabled: true });
    expect(running.bar.actions.ping).toMatchObject({ enabled: false, reason: { id: 'chat-busy' } });
    expect(await h.dispatch({ type: 'Generate', targetHandle: spender('5000'), feature: 'reply', options: {} })).toMatchObject({ ok: true, outcome: 'noop', opId });
    expect(await h.dispatch({ type: 'Generate', targetHandle: spender('5000'), feature: 'ping', options: {} })).toMatchObject({ ok: false, code: 'CG-OP-CHAT-BUSY' });
    expect(count(h, 'op.start')).toBe(1);
    await h.advance(200);
    const finished = h.boards.preview.getSnapshot(preview('spenders')).result!;
    expect(finished.state).toBe('done');
    expect(finished.toneUsed).toBe('flirty');
    expect(finished.meta[0]).toEqual({ key: 'result.meta.tone', params: { tone: 'Flirt' } });
    expect(finished.parts).toHaveLength(1);
  });

  it('a result outlives the preview: closing and reopening shows it again; «Скрыть» hides it and the same click brings it back', async () => {
    const { h, opId, handle } = await withReply();
    await h.dispatch({ type: 'Navigate', to: { kind: 'surface', surface: 'preview', open: false } });
    await h.dispatch({ type: 'OpenPreview', targetHandle: handle });
    expect(h.boards.preview.getSnapshot(preview('spenders')).result?.opId).toBe(opId);
    await h.dispatch({ type: 'HideResult', operationId: opId });
    expect(h.boards.preview.getSnapshot(preview('spenders')).result).toBeNull();
    // The same request reopens the same result: no second generation.
    await h.dispatch({ type: 'Generate', targetHandle: handle, feature: 'reply', options: {} });
    await h.advance(100);
    expect(h.boards.preview.getSnapshot(preview('spenders')).result?.opId).toBe(opId);
    expect(h.bg.streams.streams).toHaveLength(1);
    // An operation of another surface is not this controller's.
    expect(h.boards.preview.dispatch({ type: 'HideResult', operationId: uuid(0xdead) })).toBeNull();
  });

  it('results of closed cards are bounded (§9.4): 30 minutes each and 24 in the tab; a closed card asks MAIN nothing', async () => {
    const h = await harness({ config: X8 });
    await h.dispatch(open('spenders'));
    await h.dispatch({ type: 'RevealShelf', shelfId: 'shelf-600-plus' });
    const ops: string[] = [];
    for (let i = 0; i < 26; i += 1) {
      // The last card is fan 5000's: the one MAIN gave a freshness checkpoint for.
      const fan = String(i === 25 ? 5000 : 5001 + i);
      await h.dispatch({ type: 'OpenPreview', targetHandle: spender(fan) });
      ops.push(h.script(i, 'fast-reply', `Hey ${fan}`).opId);
      expect((await h.dispatch({ type: 'Generate', targetHandle: spender(fan), feature: 'reply', options: {} })).ok).toBe(true);
      await h.advance(200);
    }
    const tracked = (opId: string): boolean => h.boards.preview.dispatch({ type: 'ExpandResult', operationId: opId, expanded: false }) !== null;
    // 26 results were made: the two oldest are no longer tracked, the one on the open card is.
    expect(ops.map(tracked).filter(Boolean)).toHaveLength(24);
    expect(ops.slice(0, 2).map(tracked)).toEqual([false, false]);
    expect(tracked(ops[25]!)).toBe(true);
    // Only the open card's result asks MAIN again on a host event: 24 kept results are not 24 bridge calls.
    const asked = h.host.calls.preflights.length;
    h.hostEvent({ type: 'route', route: { epoch: 6, name: 'accounts-overview', account: hostAccount, chat: null } });
    await h.flush();
    expect(h.host.calls.preflights.length - asked).toBe(1);
    // The card closes; half an hour later nothing of the closed cards is kept, with no further action of anyone.
    await h.dispatch({ type: 'Navigate', to: { kind: 'surface', surface: 'preview', open: false } });
    const before = h.host.calls.preflights.length;
    h.hostEvent({ type: 'route', route: { epoch: 7, name: 'accounts-overview', account: hostAccount, chat: null } });
    await h.flush();
    expect(h.host.calls.preflights.length).toBe(before);
    await h.advance(31 * 60_000);
    expect(ops.map(tracked).filter(Boolean)).toEqual([]);
    // A card that stays open keeps its result past the half hour.
    const { h: kept, opId } = await withReply();
    await kept.advance(31 * 60_000);
    expect(kept.boards.preview.getSnapshot(preview('spenders')).result?.opId).toBe(opId);
    expect((await kept.dispatch({ type: 'ExpandResult', operationId: opId, expanded: true })).ok).toBe(true);
    expect(kept.boards.preview.getSnapshot(preview('spenders')).result?.expanded).toBe(true);
    // A closed card of «Новые» (its subscription check does not depend on the card) asks MAIN nothing either.
    const card = await withCard();
    card.script(0, 'hi-greeting', 'Hi there!');
    await card.dispatch({ type: 'Generate', targetHandle: newcomer('2010'), feature: 'hi', options: {} });
    await card.advance(200);
    card.hostEvent({ type: 'coverage', coverage: { hostAccountId: HOST_IDS.acc, state: 'ok', reason: 'armed' } });
    await card.flush();
    const whileOpen = card.host.calls.preflights.length;
    expect(whileOpen).toBeGreaterThan(1);
    await card.dispatch({ type: 'Navigate', to: { kind: 'surface', surface: 'preview', open: false } });
    card.hostEvent({ type: 'coverage', coverage: { hostAccountId: HOST_IDS.acc, state: 'ok', reason: 'armed' } });
    card.hostEvent({ type: 'route', route: { epoch: 6, name: 'accounts-overview', account: hostAccount, chat: null } });
    await card.flush();
    expect(card.host.calls.preflights.length).toBe(whileOpen);
  });

  it('a failed generation is the error card with «Ещё раз»; «Копировать» writes the part and reports it', async () => {
    const h = await harness({ config: X8 });
    await h.dispatch(open('spenders'));
    await h.dispatch({ type: 'RevealShelf', shelfId: 'shelf-600-plus' });
    await h.dispatch({ type: 'OpenPreview', targetHandle: spender('5000') });
    h.bg.streams.streamScript.push({ kind: 'http-error', status: 429, body: { error: 'quota_denied' } });
    await h.dispatch({ type: 'Generate', targetHandle: spender('5000'), feature: 'reply', options: {} });
    await h.advance(200);
    const failed = h.boards.preview.getSnapshot(preview('spenders')).result!;
    expect(failed).toMatchObject({ state: 'failed', error: { code: 'CG-QUOTA-DAILY' }, parts: null, draftNotSent: false });
    expect(failed.meta).toContainEqual({ key: 'result.meta.failed' });

    const { h: ok, opId } = await withReply();
    const part = partsOf(ok, 'spenders')[0]!;
    expect(await ok.dispatch({ type: 'Copy', artifactHandle: part.copyHandle })).toMatchObject({ ok: true });
    expect(ok.copied).toEqual(['Hey you']);
    expect(partsOf(ok, 'spenders')[0]?.copy).toBe('done');
    expect(lastPayload(ok, 'op.reportCopy')).toEqual({ opId, part: { index: 0 } });
    await ok.advance(2100);
    expect(partsOf(ok, 'spenders')[0]?.copy).toBe('idle');
    const blocked = await withReply({ clipboard: false });
    expect(await blocked.h.dispatch({ type: 'Copy', artifactHandle: partsOf(blocked.h, 'spenders')[0]!.copyHandle })).toMatchObject({ ok: false, code: 'CG-CLIPBOARD' });
    expect(count(blocked.h, 'op.reportCopy')).toBe(0);
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
});

describe('[SP-054] [X8-01] [X8-08] «Отправить» is a button of one part; every state of its row', () => {
  it('available → queued → sending → accepted → sent, by the linked receipt and echo; one part at a time', async () => {
    const { h, opId } = await withReply();
    let [first, second] = partsOf(h, 'spenders');
    expect(first?.send).toEqual({ s: 'available' });
    expect(first?.sendOrder).toBeNull();
    expect(first?.openInsert).toEqual({ s: 'available' });
    expect(second?.send).toEqual({ s: 'available' });
    expect(second?.sendOrder).toEqual({ kind: 'after', part: 1 });
    // The second part cannot jump the queue.
    expect(await h.dispatch({ type: 'SendPart', operationId: opId, part: 1 })).toMatchObject({ ok: false });
    expect(h.host.calls.commits).toEqual([]);

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

  it('[X8-01] twenty fast clicks of one part are one attempt and one queue call', async () => {
    const { h, opId } = await withReply();
    const receipts = await Promise.all(Array.from({ length: 20 }, () => h.boards.preview.dispatch({ type: 'SendPart', operationId: opId, part: 0 })!));
    await h.flush();
    expect(receipts.filter((receipt) => receipt.ok)).toHaveLength(1);
    expect(h.host.calls.commits).toHaveLength(1);
    expect(h.clicks).toHaveLength(1);
  });

  it('unavailable: the switch is off, no receipt profile, no checkpoint, the hub does not confirm the subscription — each with its code, none a toast', async () => {
    const off = await withReply({ config: { flags: { previewSend: false } } });
    expect(partsOf(off.h, 'spenders')[0]?.send).toEqual({ s: 'unavailable', code: 'CG-SEND-OFF', reason: { key: 'send.reason.off' } });
    expect(await off.h.dispatch({ type: 'SendPart', operationId: off.opId, part: 0 })).toMatchObject({ ok: false, code: 'CG-SEND-OFF' });
    expect(off.h.clicks).toEqual([]);
    // «Открыть и вставить» still works with X8 off.
    expect(partsOf(off.h, 'spenders')[0]?.openInsert).toEqual({ s: 'available' });

    const noProfile = await withReply({ config: { flags: { previewSend: true } } });
    expect(partsOf(noProfile.h, 'spenders')[0]?.send).toMatchObject({ s: 'unavailable', code: 'CG-SEND-RECEIPT' });

    const noCheckpoint = await withReply({ checkpointFan: null });
    expect(partsOf(noCheckpoint.h, 'spenders')[0]?.send).toMatchObject({ s: 'unavailable', code: 'CG-SEND-FRESHNESS' });
    expect((lastPayload(noCheckpoint.h, 'op.start') as Record<string, unknown>)['checkpoint']).toBeUndefined();

    // The WS tap is the page's own switch, and freshness is the tap's: with `wsTap` off on THIS page nothing of it
    // may be vouched for — whatever the tab's one tap hears for another page (the host's capability stays on).
    const noTap = await withReply({ config: { ...X8, pageFlags: { [PAGE.pageLabel]: { wsTap: false } } } });
    expect(noTap.h.host.current().contract.capabilities.previewSend.state).toBe('on');
    expect(partsOf(noTap.h, 'spenders')[0]?.send).toMatchObject({ s: 'unavailable', code: 'CG-SEND-FRESHNESS' });
    expect(await noTap.h.dispatch({ type: 'SendPart', operationId: noTap.opId, part: 0 })).toMatchObject({ ok: false, code: 'CG-SEND-FRESHNESS' });
    expect(noTap.h.clicks).toEqual([]);
    expect(partsOf(noTap.h, 'spenders')[0]?.openInsert).toEqual({ s: 'available' });

    const noCard = await harness({ config: X8 });
    noCard.bg.failNext('fan.card', { code: 'CG-DATA-UNAVAILABLE' });
    await noCard.dispatch(open('spenders'));
    await noCard.dispatch({ type: 'RevealShelf', shelfId: 'shelf-600-plus' });
    await noCard.dispatch({ type: 'OpenPreview', targetHandle: spender('5000') });
    noCard.script(0, 'fast-reply', 'Hey you');
    await noCard.dispatch({ type: 'Generate', targetHandle: spender('5000'), feature: 'reply', options: {} });
    await noCard.advance(200);
    expect(partsOf(noCard, 'spenders')[0]?.send).toMatchObject({ s: 'unavailable', code: 'CG-SEND-FAN', reason: { key: 'send.reason.fan' } });
  });

  it('unavailable by the page: MAIN’s own answer explains the button (Mimic), and the context the hub did not serve holds it', async () => {
    const mimic = await withReply({ answers: { preflight: [{ ok: false, code: 'CG-SEND-MIMIC' }] } });
    expect(partsOf(mimic.h, 'spenders')[0]?.send).toEqual({ s: 'unavailable', code: 'CG-SEND-MIMIC', reason: { key: 'send.reason.mimic' } });
    expect(mimic.h.host.calls.commits).toEqual([]);

    const h = await harness({ config: X8 });
    await h.dispatch(open('spenders'));
    await h.dispatch({ type: 'RevealShelf', shelfId: 'shelf-600-plus' });
    await h.dispatch({ type: 'OpenPreview', targetHandle: spender('5000') });
    // The hub's context did not include a fan message this page had seen before Generate.
    h.script(0, 'fast-reply', 'Hey you', [HOST_IDS.messages.fanEarlier]);
    await h.dispatch({ type: 'Generate', targetHandle: spender('5000'), feature: 'reply', options: {} });
    await h.advance(200);
    expect(partsOf(h, 'spenders')[0]?.send).toMatchObject({ s: 'unavailable', code: 'CG-SEND-FRESHNESS' });
  });

  it('held-stale: a fan message after the checkpoint holds every send; a repeat click does not lift it; the archive is polled for it', async () => {
    const { h, opId } = await withReply();
    const fact: IncomingFact = { host: 'chatspace', hostAccountId: HOST_IDS.acc, platformFanId: '5000', platformMessageId: HOST_IDS.messages.fanAfter, fromFan: true, automatic: false, tip: false, sentAt: iso(h.clock.now()), socketEpoch: 1, fanSequence: 3, source: 'ws-tap' };
    h.hostEvent({ type: 'incoming', fact });
    await h.flush();
    const vm = h.boards.preview.getSnapshot(preview('spenders'));
    expect(vm.fanWroteNew).toBe(true);
    expect(vm.result?.parts?.[0]?.send).toEqual({ s: 'held-stale', at: fact.sentAt });
    expect(await h.dispatch({ type: 'SendPart', operationId: opId, part: 0 })).toMatchObject({ ok: false, code: 'CG-SEND-STALE' });
    expect(await h.dispatch({ type: 'SendPart', operationId: opId, part: 0 })).toMatchObject({ ok: false, code: 'CG-SEND-STALE' });
    expect(h.host.calls.commits).toEqual([]);
    // The fan's text is not in the feed: only what the hub archive holds.
    expect(vm.feed.items.some((item) => item.id === HOST_IDS.messages.fanAfter)).toBe(false);
    // The hub archive is asked every 5 s, for two minutes at most.
    const reads = count(h, 'feed.read');
    await h.advance(5_000);
    expect(count(h, 'feed.read')).toBe(reads + 1);
    await h.advance(120_000);
    const capped = count(h, 'feed.read');
    await h.advance(60_000);
    expect(count(h, 'feed.read')).toBe(capped);
    expect(capped - reads).toBeLessThanOrEqual(24);
    // A message of ours, or one the checkpoint already knew, does not hold.
    const calm = await withReply();
    calm.h.hostEvent({ type: 'incoming', fact: { ...fact, fromFan: false } });
    calm.h.hostEvent({ type: 'incoming', fact: { ...fact, platformMessageId: HOST_IDS.messages.fanBefore } });
    await calm.h.flush();
    expect(partsOf(calm.h, 'spenders')[0]?.send).toEqual({ s: 'available' });
  });

  it('rejected: «Отправить ещё раз» only where nothing reached ChatSpace (the queue’s null); a proven refusal has no retry', async () => {
    const queue = await withReply({ answers: { commit: [{ state: 'notEnqueued', code: 'CG-SEND-QUEUE' }] } });
    await queue.h.dispatch({ type: 'SendPart', operationId: queue.opId, part: 0 });
    expect(partsOf(queue.h, 'spenders')[0]?.send).toEqual({ s: 'rejected', code: 'CG-SEND-QUEUE', canRetry: true });
    expect(partsOf(queue.h, 'spenders')[0]?.openInsert).toEqual({ s: 'available' });
    // A new click is a new attempt with a new id.
    expect(await queue.h.dispatch({ type: 'SendPart', operationId: queue.opId, part: 0 })).toMatchObject({ ok: true, attemptId: uuid(0x501) });
    expect(queue.h.host.calls.commits.map((c) => c.request.attemptId)).toEqual([uuid(0x500), uuid(0x501)]);
    expect(partsOf(queue.h, 'spenders')[0]?.send).toEqual({ s: 'sending' });

    const refused = await withReply();
    await refused.h.dispatch({ type: 'SendPart', operationId: refused.opId, part: 0 });
    refused.h.sendState({ attemptId: uuid(0x500), state: 'rejected', code: 'CG-SEND-GUARD', httpStatus: 422, detail: { guardTopics: ['off-platform'] } });
    await refused.h.flush();
    expect(partsOf(refused.h, 'spenders')[0]?.send).toEqual({ s: 'rejected', code: 'CG-SEND-GUARD', detail: 'off-platform', canRetry: false });
    expect(await refused.h.dispatch({ type: 'SendPart', operationId: refused.opId, part: 0 })).toMatchObject({ ok: false, code: 'CG-SEND-GUARD' });
    expect(refused.h.host.calls.commits).toHaveLength(1);
    // The same unchanged part does not go again; the later part waits behind it.
    expect(partsOf(refused.h, 'spenders')[1]?.sendOrder).toEqual({ kind: 'after', part: 1 });
  });

  it('uncertain: only «Открыть чат для проверки»; nothing is sent again, the group is held, «Ещё раз» is off', async () => {
    const { h, opId } = await withReply({ answers: { commit: [{ state: 'uncertain', code: 'CG-SEND-UNCERTAIN' }] } });
    await h.dispatch({ type: 'SendPart', operationId: opId, part: 0 });
    const attemptId = uuid(0x500);
    const [first, second] = partsOf(h, 'spenders');
    expect(first?.send).toEqual({ s: 'uncertain', since: iso(h.clock.now()), attemptId });
    expect(first?.openInsert).toEqual({ s: 'hidden' });
    expect(second?.sendOrder).toEqual({ kind: 'held', part: 1 });
    const vm = h.boards.preview.getSnapshot(preview('spenders'));
    expect(vm.stoppedNote).toEqual({ key: 'newcomers.stopped', params: { n: 1 } });
    expect(vm.result).toMatchObject({ canRegenerate: false, regenerateReason: { id: 'part-uncertain', code: 'CG-SEND-UNCERTAIN' } });
    for (const part of [0, 1]) expect(await h.dispatch({ type: 'SendPart', operationId: opId, part })).toMatchObject({ ok: false });
    expect((await h.dispatch({ type: 'Regenerate', operationId: opId })).ok).toBe(false);
    expect((await h.dispatch({ type: 'OpenAndInsertPart', operationId: opId, part: 0 })).ok).toBe(false);
    expect(h.host.calls.commits).toHaveLength(1);
    expect(count(h, 'op.start')).toBe(1);
    // The only way on: look at the chat. It navigates, with no insert riding it.
    expect(await h.dispatch({ type: 'OpenChatToVerify', attemptId })).toMatchObject({ ok: true, outcome: 'opened' });
    expect(h.host.calls.navigations).toHaveLength(1);
    expect(h.host.calls.navigations[0]?.thenInsert).toBeUndefined();
    expect(h.host.calls.commits).toHaveLength(1);
    // The chat opened, so the board got out of its way. The late linked pair is the only automatic way out:
    // back on the card the row is «Отправлено», and the next part is free for its own click.
    expect(h.boards.surfaces.current()).toMatchObject({ spenders: false, preview: { spenders: null } });
    h.sendState({ attemptId, state: 'uncertain', code: 'CG-SEND-UNCERTAIN', platformMessageId: '4100' });
    h.sendState({ attemptId, state: 'sentObserved', platformMessageId: '4100' });
    await h.flush();
    const sentAt = iso(h.clock.now());
    await h.dispatch(open('spenders'));
    await h.dispatch({ type: 'RevealShelf', shelfId: 'shelf-600-plus' });
    await h.dispatch({ type: 'OpenPreview', targetHandle: spender('5000') });
    const [sent, next] = partsOf(h, 'spenders');
    expect(sent?.send).toEqual({ s: 'sent', at: sentAt });
    expect(next?.send).toEqual({ s: 'available' });
    expect(next?.sendOrder).toBeNull();
    expect(h.boards.preview.getSnapshot(preview('spenders'))).toMatchObject({ stoppedNote: null, result: { canRegenerate: true, sendProgress: { sent: 1, total: 2 } } });
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
    expect(a?.map((part) => part.send)).toEqual([
      { s: 'unavailable', code: 'CG-SEND-PART', reason: { key: 'send.reason.part' } },
      { s: 'unavailable', code: 'CG-SEND-PART', reason: { key: 'send.reason.part' } },
    ]);
    expect(c?.[0]?.send).toMatchObject({ s: 'unavailable', code: 'CG-SEND-PART' });
    expect(await h.dispatch({ type: 'SendPart', operationId: opId, variant: 0, part: 0 })).toMatchObject({ ok: false, code: 'CG-SEND-PART' });
    expect(await h.dispatch({ type: 'SendPart', operationId: opId, variant: 2, part: 0 })).toMatchObject({ ok: false, code: 'CG-SEND-PART' });
    expect(h.clicks).toHaveLength(1);
    expect(h.host.calls.commits).toHaveLength(1);
  });

  it('[X8-01] a Fix answers one revision of the local draft: once the draft moves on, its parts are not sent', async () => {
    const h = await harness({ config: X8 });
    await h.boards.preview.ready();
    await h.dispatch(open('spenders'));
    await h.dispatch({ type: 'RevealShelf', shelfId: 'shelf-600-plus' });
    await h.dispatch({ type: 'OpenPreview', targetHandle: spender('5000') });
    await h.dispatch({ type: 'SetPreviewDraft', targetHandle: spender('5000'), text: 'hey you, miss me?' });
    const { opId } = h.script(0, 'improve-draft', 'Hey you — missed me?');
    expect(await h.dispatch({ type: 'Generate', targetHandle: spender('5000'), feature: 'fix', options: {} })).toMatchObject({ ok: true, opId });
    await h.advance(200);
    expect(lastPayload(h, 'op.start')).toMatchObject({ feature: 'fix', draft: { text: 'hey you, miss me?' } });
    expect(partsOf(h, 'spenders')[0]?.send).toEqual({ s: 'available' });
    // The person keeps typing: the result is of the old text.
    await h.dispatch({ type: 'SetPreviewDraft', targetHandle: spender('5000'), text: 'hey you, miss me? I was thinking' });
    expect(partsOf(h, 'spenders')[0]?.send).toEqual({ s: 'unavailable', code: 'CG-SEND-PART', reason: { key: 'send.reason.part' } });
    expect(await h.dispatch({ type: 'SendPart', operationId: opId, part: 0 })).toMatchObject({ ok: false, code: 'CG-SEND-PART' });
    expect(h.clicks).toEqual([]);
    expect(h.host.calls.commits).toEqual([]);
    // A Reply does not depend on the draft: typing does not void it.
    const reply = await withReply();
    await reply.h.dispatch({ type: 'SetPreviewDraft', targetHandle: reply.handle, text: 'a note to myself' });
    expect(partsOf(reply.h, 'spenders')[0]?.send).toEqual({ s: 'available' });
  });

  it('[RB-020] a state of an attempt never moves back: a late or repeated view from the background changes nothing', async () => {
    const { h, opId } = await withReply();
    await h.dispatch({ type: 'SendPart', operationId: opId, part: 0 });
    const attemptId = uuid(0x500);
    h.sendState({ attemptId, state: 'nativeAccepted', platformMessageId: '4100' });
    h.sendState({ attemptId, state: 'sentObserved', platformMessageId: '4100' });
    await h.flush();
    const sent = partsOf(h, 'spenders')[0]?.send;
    expect(sent?.s).toBe('sent');
    // The background's own events arrive late and out of order (another tab's port, a restored journal).
    await h.advance(5_000);
    for (const state of ['preparing', 'nativeEnqueued', 'nativeAccepted', 'uncertain'] as const) h.bg.emit('send.state', { view: { attemptId, state, ...(state === 'uncertain' ? { code: 'CG-SEND-UNCERTAIN' as const } : {}) } });
    await h.flush();
    expect(partsOf(h, 'spenders')[0]?.send).toEqual(sent);
    expect(partsOf(h, 'spenders')[1]?.send).toEqual({ s: 'available' });
    expect(h.boards.preview.getSnapshot(preview('spenders'))).toMatchObject({ stoppedNote: null, result: { canRegenerate: true } });
    // An unknown outcome is not walked back to «sending» by a late view either.
    const unknown = await withReply({ answers: { commit: [{ state: 'uncertain', code: 'CG-SEND-UNCERTAIN' }] } });
    await unknown.h.dispatch({ type: 'SendPart', operationId: unknown.opId, part: 0 });
    unknown.h.bg.emit('send.state', { view: { attemptId, state: 'nativeEnqueued' } });
    unknown.h.bg.emit('send.state', { view: { attemptId, state: 'ready' } });
    await unknown.h.flush();
    expect(partsOf(unknown.h, 'spenders')[0]?.send).toMatchObject({ s: 'uncertain', attemptId });
    expect(unknown.h.host.calls.commits).toHaveLength(1);
  });

  it('a click the hub refuses for its rate limit leaves the part unsent and says why; the button comes back after the hub’s minute', async () => {
    const { h, opId } = await withReply({ config: { ...X8, limits: { ...X8.limits, previewSendPerMinute: 0 } } });
    await h.dispatch({ type: 'SendPart', operationId: opId, part: 0 });
    expect(partsOf(h, 'spenders')[0]?.send).toMatchObject({ s: 'unavailable', code: 'CG-HUB-RATE-LIMIT', reason: { key: 'send.reason.rateLimit' } });
    expect(h.host.calls.commits).toEqual([]);
    expect(h.clicks).toHaveLength(1);
    // While the hub's minute runs, a click starts nothing; after it the button is back — for a new click, not a repeat.
    await h.advance(RATE_LIMIT_HOLD_MS - 1000);
    expect(await h.dispatch({ type: 'SendPart', operationId: opId, part: 0 })).toMatchObject({ ok: false, code: 'CG-HUB-RATE-LIMIT' });
    expect(h.clicks).toHaveLength(1);
    await h.advance(1000);
    expect(partsOf(h, 'spenders')[0]?.send).toEqual({ s: 'available' });
    expect(h.clicks).toHaveLength(1);
    expect(h.host.calls.commits).toEqual([]);
  });
});

describe('[SP-054] [NF-022] what holds a send holds the fan — on every card of the fan, and after a tab reload (§6.7.8, §6.7.9)', () => {
  const UNCERTAIN = { answers: { commit: [{ state: 'uncertain', code: 'CG-SEND-UNCERTAIN' }] } } as const;
  /** Fan 5000 of the board is also a fan ChatSpace shows online: the palette has a card of the same chat. */
  const onlineToo = { chatList: [...hostMemory.chatList, { chat: { host: 'chatspace' as const, hostAccountId: HOST_IDS.acc, platformFanId: '5000' }, position: 2, displayName: 'fan_0', username: 'fan_0', unreadCount: 0, isOnline: true }] };
  const strip = (h: Harness, from: PreviewSource = 'spenders') => h.boards.preview.getSnapshot(preview(from)).bar.actions;

  it('an unknown outcome: no feature of the strip generates for the fan, no part is offered for «Открыть и вставить», the result cannot be hidden', async () => {
    const { h, opId, handle } = await withReply({ ...UNCERTAIN, memory: onlineToo });
    await h.dispatch({ type: 'SendPart', operationId: opId, part: 0 });
    const attemptId = uuid(0x500);
    const held = h.boards.preview.getSnapshot(preview('spenders'));
    expect(held.result?.parts?.[0]?.send).toMatchObject({ s: 'uncertain', attemptId });
    // Every feature, not only «Ещё раз»: a new generation would take the unknown part off the card.
    for (const feature of ['reply', 'fix', 'hi', 'ping'] as const) {
      expect(strip(h)[feature], feature).toMatchObject({ enabled: false, reason: { id: 'part-uncertain', code: 'CG-SEND-UNCERTAIN', text: { params: { n: 1 } } } });
      expect(await h.dispatch({ type: 'Generate', targetHandle: handle, feature, options: { tone: 'flirty' } }), feature).toMatchObject({ ok: false, code: 'CG-SEND-UNCERTAIN' });
    }
    expect(count(h, 'op.start')).toBe(1);
    expect((await h.dispatch({ type: 'HideResult', operationId: opId })).ok).toBe(false);
    const still = h.boards.preview.getSnapshot(preview('spenders'));
    expect(still.result?.opId).toBe(opId);
    expect(still.result?.parts?.[0]?.send).toMatchObject({ s: 'uncertain', attemptId });
    expect(still.stoppedNote).toEqual({ key: 'newcomers.stopped', params: { n: 1 } });
    expect(still.unread).toBe('read-after-send');
    // The other part of the group is held with it: neither sent nor put into the chat by us.
    expect(still.result?.parts?.[1]?.openInsert).toMatchObject({ s: 'unavailable', reason: { id: 'part-uncertain' } });
    expect(await h.dispatch({ type: 'OpenAndInsertPart', operationId: opId, part: 1 })).toMatchObject({ ok: false, code: 'CG-SEND-UNCERTAIN' });
    expect(h.host.calls.navigations).toEqual([]);

    // The same fan on another card (the palette's online fans): held there too.
    const palette = fanHandle('palette', PAGE.pageId, '5000');
    expect((await h.dispatch({ type: 'OpenPreview', targetHandle: palette })).ok).toBe(true);
    const other = h.boards.preview.getSnapshot(preview('palette'));
    expect(other.bar.actions.reply).toMatchObject({ enabled: false, reason: { id: 'part-uncertain' } });
    expect(other.stoppedNote).toEqual({ key: 'newcomers.stopped', params: { n: 1 } });
    expect(other.unread).toBe('read-after-send');
    expect(await h.dispatch({ type: 'Generate', targetHandle: palette, feature: 'ping', options: {} })).toMatchObject({ ok: false, code: 'CG-SEND-UNCERTAIN' });
    expect(count(h, 'op.start')).toBe(1);
    expect(h.host.calls.commits).toHaveLength(1);

    // The late linked pair is the only automatic way out: the part is sent, and the fan is free again.
    h.sendState({ attemptId, state: 'uncertain', code: 'CG-SEND-UNCERTAIN', platformMessageId: '4100' });
    h.sendState({ attemptId, state: 'sentObserved', platformMessageId: '4100' });
    await h.flush();
    const free = h.boards.preview.getSnapshot(preview('spenders'));
    expect(free.result?.parts?.[0]?.send).toMatchObject({ s: 'sent' });
    expect(free.stoppedNote).toBeNull();
    expect(free.result?.canRegenerate).toBe(true);
    expect(strip(h).reply).toMatchObject({ enabled: true, reason: null });
    expect(free.result?.parts?.[1]?.openInsert).toEqual({ s: 'available' });
    expect(h.boards.preview.getSnapshot(preview('palette')).bar.actions.reply).toMatchObject({ enabled: true });
  });

  it('an unknown outcome of ANOTHER result of the fan: the parts of the result on the card say «прошлая отправка не проверена» before any click', async () => {
    // Part 1 of the first reply is sent; the next reply's part ends unknown.
    const { h, opId, handle } = await withReply({ answers: { commit: [{ state: 'nativeEnqueued', pendingId: 'pending-first' }, { state: 'uncertain', code: 'CG-SEND-UNCERTAIN' }] }, memory: onlineToo });
    // The palette's card of the same fan shows the first reply.
    const palette = fanHandle('palette', PAGE.pageId, '5000');
    await h.dispatch({ type: 'OpenPreview', targetHandle: palette });
    expect(h.boards.preview.getSnapshot(preview('palette')).result?.opId).toBe(opId);
    await h.dispatch({ type: 'SendPart', operationId: opId, part: 0 });
    h.sendState({ attemptId: uuid(0x500), state: 'nativeAccepted', platformMessageId: '4100' });
    h.sendState({ attemptId: uuid(0x500), state: 'sentObserved', platformMessageId: '4100' });
    await h.flush();
    const second = h.script(1, 'ping', 'Ping one\n[NEXT]\nPing two');
    expect(await h.dispatch({ type: 'Generate', targetHandle: handle, feature: 'ping', options: {} })).toMatchObject({ ok: true, opId: second.opId });
    await h.advance(200);
    await h.dispatch({ type: 'SendPart', operationId: second.opId, part: 0 });
    expect(partsOf(h, 'spenders')[0]?.send).toMatchObject({ s: 'uncertain', attemptId: uuid(0x501) });
    // The first reply still stands on the palette's card: its unsent part is held by the other result's unknown outcome.
    const other = h.boards.preview.getSnapshot(preview('palette'));
    expect(other.result?.opId).toBe(opId);
    const [sent, unsent] = other.result?.parts ?? [];
    expect(sent?.send?.s).toBe('sent');
    expect(unsent?.send).toEqual({ s: 'unavailable', code: 'CG-SEND-UNCERTAIN', reason: { key: 'send.reason.otherUncertain' } });
    expect(unsent?.openInsert).toMatchObject({ s: 'unavailable', reason: { id: 'part-uncertain' } });
    expect(other.result).toMatchObject({ canRegenerate: false, regenerateReason: { id: 'part-uncertain' } });
    // The note names the unknown part even though it is not on this card.
    expect(other.stoppedNote).toEqual({ key: 'newcomers.stopped', params: { n: 1 } });
    expect((await h.dispatch({ type: 'SendPart', operationId: opId, part: 1 })).ok).toBe(false);
    expect(h.clicks).toHaveLength(2);
    expect(h.host.calls.commits).toHaveLength(2);
  });

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

  it('F5 with an unknown outcome: the result comes back WITH the state of its parts — the row is «неизвестно», nothing is inserted or generated', async () => {
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
    expect(second?.sendOrder).toEqual({ kind: 'held', part: 1 });
    expect(second?.openInsert).toMatchObject({ s: 'unavailable', reason: { id: 'part-uncertain' } });
    expect(vm.result).toMatchObject({ canRegenerate: false, regenerateReason: { id: 'part-uncertain' }, draftNotSent: false });
    expect(vm.stoppedNote).toEqual({ key: 'newcomers.stopped', params: { n: 1 } });
    expect(vm.unread).toBe('read-after-send');
    expect(vm.bar.actions.reply).toMatchObject({ enabled: false, reason: { id: 'part-uncertain' } });
    for (const part of [0, 1]) {
      expect((await h.dispatch({ type: 'OpenAndInsertPart', operationId: opId, part })).ok).toBe(false);
      expect((await h.dispatch({ type: 'SendPart', operationId: opId, part })).ok).toBe(false);
    }
    expect((await h.dispatch({ type: 'Regenerate', operationId: opId })).ok).toBe(false);
    expect((await h.dispatch({ type: 'Generate', targetHandle: handle, feature: 'ping', options: {} })).ok).toBe(false);
    expect(h.host.calls.navigations).toEqual([]);
    expect(h.host.calls.commits).toHaveLength(1);
    expect(count(h, 'op.start')).toBe(1);
    // The one way on still works from the restored row: look at the chat, with no insert riding the navigation.
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
    // The checkpoint of the generation did not survive the reload: the rest can be inserted by the person, not sent by us.
    expect(second?.send).toMatchObject({ s: 'unavailable', code: 'CG-SEND-FRESHNESS' });
    expect(second?.openInsert).toEqual({ s: 'available' });
    expect((await h.dispatch({ type: 'OpenAndInsertPart', operationId: opId, part: 0 })).ok).toBe(false);
  });

  it('the hub resolves the unknown outcome: the tab learns it from the journal — «не ушло» frees the part, «ушло» shows it sent', async () => {
    for (const outcome of ['not_sent', 'sent'] as const) {
      const { h, opId, handle } = await withReply(UNCERTAIN);
      await h.dispatch({ type: 'SendPart', operationId: opId, part: 0 });
      const attemptId = uuid(0x500);
      expect(strip(h).reply?.enabled).toBe(false);
      // An owner or a team lead looked at the chat and resolved it in the hub; the background reads the custody.
      h.hub.control({ op: 'resolveCustody', pageLabel: PAGE.pageLabel, fanRef: '5000', attemptId, outcome, ...(outcome === 'sent' ? { platformMessageId: '4100' } : {}) });
      await h.bg.coordinator.reconcileFan(sendLockKey({ hubOrigin: WORLD.hubOrigin, pageId: PAGE.pageId, platform: 'onlyfans', fanRef: '5000' }));
      await h.flush();
      const vm = h.boards.preview.getSnapshot(preview('spenders'));
      expect(vm.stoppedNote, outcome).toBeNull();
      expect(vm.bar.actions.reply, outcome).toMatchObject({ enabled: true, reason: null });
      expect(vm.result?.canRegenerate, outcome).toBe(true);
      const [first, second] = vm.result?.parts ?? [];
      if (outcome === 'sent') {
        expect(first?.send?.s).toBe('sent');
        expect(first?.openInsert).toEqual({ s: 'hidden' });
        expect(vm.result?.sendProgress).toEqual({ sent: 1, total: 2 });
        expect(second?.sendOrder).toBeNull();
      } else {
        expect(first?.send).toEqual({ s: 'available' });
        expect(first?.openInsert).toEqual({ s: 'available' });
      }
      expect(second?.openInsert, outcome).toEqual({ s: 'available' });
      expect((await h.dispatch({ type: 'Generate', targetHandle: handle, feature: 'ping', options: {} })).ok, outcome).toBe(true);
    }
  });

  it('a result that outlived the reload but not its sends list is not shown; a fan held by a result this tab no longer has is still held', async () => {
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
    // The journal answers the next click: Generate is refused by what it says, though the card itself never learned it.
    expect(lost.h.boards.preview.getSnapshot(preview('spenders')).bar.actions.reply?.enabled).toBe(true);
    expect(await lost.h.dispatch({ type: 'Generate', targetHandle: lost.handle, feature: 'reply', options: {} })).toMatchObject({ ok: false, code: 'CG-SEND-UNCERTAIN' });
    expect(count(lost.h, 'op.start')).toBe(1);
    // …and from then on the card says so: the fan is held, though the result itself is not on the card.
    const vm = lost.h.boards.preview.getSnapshot(preview('spenders'));
    expect(vm.result).toBeNull();
    expect(vm.bar.actions.reply).toMatchObject({ enabled: false, reason: { id: 'part-uncertain', text: { params: { n: 1 } } } });
    expect(vm.stoppedNote).toEqual({ key: 'newcomers.stopped', params: { n: 1 } });
    expect(vm.unread).toBe('read-after-send');
    // «Обновить архив» reads the journal as well.
    const asked2 = count(lost.h, 'send.list');
    await lost.h.dispatch({ type: 'RefreshArchive', targetHandle: lost.handle });
    expect(count(lost.h, 'send.list')).toBe(asked2 + 1);
  });

  it('two tabs of one person: a part whose outcome became unknown in one tab holds the fan in the other at its next click', async () => {
    const { h, opId, handle } = await withReply(UNCERTAIN);
    // The second tab opens the same fan and shows the same finished result, nothing sent yet.
    const second = await h.secondTab();
    const act = async (action: UiAction) => {
      for (const controller of second.controllers) {
        const receipt = controller.dispatch(action);
        if (receipt !== null) {
          const answered = await receipt;
          await h.flush();
          return answered;
        }
      }
      throw new Error(`nobody took ${action.type}`);
    };
    await act(open('spenders'));
    await act({ type: 'RevealShelf', shelfId: 'shelf-600-plus' });
    await act({ type: 'OpenPreview', targetHandle: handle });
    const there = (): readonly PartVM[] => second.preview.getSnapshot(preview('spenders')).result?.parts ?? [];
    expect(second.preview.getSnapshot(preview('spenders')).result?.opId).toBe(opId);
    expect(there().map((part) => part.openInsert)).toEqual([{ s: 'available' }, { s: 'available' }]);
    // In the first tab part 1 is sent, and its outcome is unknown.
    await h.dispatch({ type: 'SendPart', operationId: opId, part: 0 });
    expect(partsOf(h, 'spenders')[0]?.send).toMatchObject({ s: 'uncertain' });
    // The second tab has not been told. Its next click asks the journal first: nothing is put into the chat, nothing is generated.
    const navigations = h.host.calls.navigations.length;
    expect(await act({ type: 'OpenAndInsertPart', operationId: opId, part: 1 })).toMatchObject({ ok: false, code: 'CG-SEND-UNCERTAIN' });
    expect(h.host.calls.navigations).toHaveLength(navigations);
    expect(there()[0]?.send).toMatchObject({ s: 'uncertain', attemptId: uuid(0x500) });
    expect(there()[1]?.openInsert).toMatchObject({ s: 'unavailable', reason: { id: 'part-uncertain' } });
    expect(await act({ type: 'Generate', targetHandle: handle, feature: 'ping', options: {} })).toMatchObject({ ok: false, code: 'CG-SEND-UNCERTAIN' });
    expect(count(h, 'op.start')).toBe(1);
    expect(h.host.calls.commits).toHaveLength(1);
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

  it('while the chat opens the row waits until its deadline; the person closing the preview first gives the insert up', async () => {
    const { h, opId, handle } = await withReply({ slowNavigate: true });
    const pending = h.boards.preview.dispatch({ type: 'OpenAndInsertPart', operationId: opId, part: 0 })!;
    await h.flush();
    expect(h.nav.pending()).toBe(1);
    expect(partsOf(h, 'spenders')[0]?.openInsert).toEqual({ s: 'waiting', until: h.clock.now() + 20_000 });
    // The other part can still be asked for: it replaces the one waiting (one deferred insert per tab).
    expect(partsOf(h, 'spenders')[1]?.openInsert).toEqual({ s: 'available' });
    await h.dispatch({ type: 'Navigate', to: { kind: 'surface', surface: 'preview', open: false } });
    expect(h.nav.aborted()).toBe(1);
    expect(h.notes).toEqual([{ code: 'CG-INSERT-CANCELED', scope: `preview:${handle}` }]);
    // The chat opens after all: the board gets out of its way, nothing is written, nothing is said twice.
    h.nav.release();
    expect(await pending).toMatchObject({ ok: false, code: 'CG-INSERT-CANCELED' });
    await h.flush();
    expect(h.notes).toHaveLength(1);
    expect(h.host.calls.inserts).toEqual([]);
    expect(h.host.calls.navigations).toHaveLength(1);
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

  it('the deadline passes with the chat still not ready: «Чат не готов» once, the result is kept, nothing is repeated', async () => {
    const { h, opId, handle } = await withReply({ slowNavigate: true });
    const pending = h.boards.preview.dispatch({ type: 'OpenAndInsertPart', operationId: opId, part: 0 })!;
    await h.flush();
    await h.advance(20_000);
    expect(h.notes).toEqual([]);
    await h.advance(1_500);
    expect(h.notes).toEqual([{ code: 'CG-NAV-TIMEOUT', scope: `preview:${handle}` }]);
    expect(h.nav.aborted()).toBe(1);
    expect(partsOf(h, 'spenders').map((part) => part.openInsert)).toEqual([{ s: 'available' }, { s: 'available' }]);
    h.nav.release();
    expect((await pending).ok).toBe(false);
    await h.flush();
    expect(h.notes).toHaveLength(1);
    expect(h.host.calls.navigations).toHaveLength(1);
    expect(h.host.calls.inserts).toEqual([]);
  });

  it('with the insertion switch off, or a host that cannot navigate, the row says why and no navigation starts', async () => {
    const off = await withReply({ config: { ...X8, pageFlags: { [PAGE.pageLabel]: { insertion: false } } } });
    expect(partsOf(off.h, 'spenders')[0]?.openInsert).toMatchObject({ s: 'unavailable', reason: { id: 'feature-disabled' } });
    expect((await off.h.dispatch({ type: 'OpenAndInsertPart', operationId: off.opId, part: 0 })).ok).toBe(false);
    expect(off.h.host.calls.navigations).toEqual([]);
    const degraded = await withReply({ start: { contract: contractReport({ navigate: { state: 'contractBroken', reason: 'router' } }) } });
    expect(partsOf(degraded.h, 'spenders')[0]?.openInsert).toMatchObject({ s: 'unavailable', reason: { id: 'host-degraded', code: 'CG-HOST-CONTRACT' } });
  });
});

describe('[NF-001] [NF-002] [NF-004] [NF-007] [NF-008] «Новые»', () => {
  it('[NF-004] [NF-028] opens with one read of the 48-hour window and shows who subscribed, the persona Hi speaks as, and that AI sends nothing by itself', async () => {
    const h = await harness();
    expect(count(h, 'newcomers.list')).toBe(0);
    await h.dispatch(open('newcomers'));
    const vm = h.boards.newcomers.getSnapshot(NEWCOMERS);
    expect(lastPayload(h, 'newcomers.list')).toEqual({ pageId: PAGE.pageId, windowHours: 48, cursor: null });
    expect(vm.view).toEqual({ s: 'ready' });
    expect(vm).toMatchObject({ pageName: 'Model One', personaLabel: 'Лора · VIP', tab: 'todo', windowHours: 48, windowOptions: [24, 48, 72, 168], query: '', cardOpen: false, scan: null, incomplete: null, canLoadMore: false });
    expect(vm.rows.map((row) => [row.handle, row.kind, row.greeting.s])).toEqual([
      [newcomer('2010'), 'new', 'none'],
      [newcomer('2011'), 'new', 'none'],
      [newcomer('2012'), 'returning', 'none'],
      [newcomer('2013'), 'new', 'none'],
      [newcomer('2014'), 'new', 'none'],
    ]);
    expect(vm.footer).toEqual({ count: 5, stamp: { asOf: iso(NOW_MS), coverage: 'complete' } });
    expect(vm.hint).toEqual({ key: 'newcomers.hint', params: { window: '48 часов' } });
    expect(vm.noAutoSend).toEqual({ key: 'newcomers.noAutoSend' });
    expect(vm.tabs.map((tab) => [tab.id, tab.count])).toEqual([['todo', 5], ['all', 5]]);
    expect(vm.filters.find((f) => f.id === 'none')).toMatchObject({ count: 5, pressed: false });
    // Opening «Новые» closes Spenders: one of our windows at a time.
    await h.dispatch(open('spenders'));
    expect(h.boards.surfaces.current()).toMatchObject({ spenders: true, newcomers: false });
  });

  it('[NF-003] the window: any whole hours inside the hub limit; a new window is a new pass from the first page', async () => {
    const h = await harness({ audiencePageSize: 2, config: { limits: { audienceWindowHours: 96 } } });
    await h.dispatch(open('newcomers'));
    expect(h.boards.newcomers.getSnapshot(NEWCOMERS).windowOptions).toEqual([24, 48, 72]);
    await h.dispatch({ type: 'LoadMore', list: 'newcomers' });
    await h.dispatch({ type: 'SetNewcomersWindow', hours: 3 });
    expect(lastPayload(h, 'newcomers.list')).toEqual({ pageId: PAGE.pageId, windowHours: 3, cursor: null });
    let vm = h.boards.newcomers.getSnapshot(NEWCOMERS);
    expect(vm.windowHours).toBe(3);
    expect(vm.hint.params).toEqual({ window: '3 часа' });
    // Subscribed 1, 2 and 3 hours ago; the list reads one page of two after a window change.
    expect(vm.rows.map((row) => row.handle)).toEqual([newcomer('2010'), newcomer('2011')]);
    await h.dispatch({ type: 'SetNewcomersWindow', hours: 500 });
    vm = h.boards.newcomers.getSnapshot(NEWCOMERS);
    expect(vm.windowHours).toBe(96);
    expect(vm.hint.params).toEqual({ window: '4 дня' });
    expect((lastPayload(h, 'newcomers.list') as { windowHours: number }).windowHours).toBe(96);
    expect((await h.dispatch({ type: 'SetNewcomersWindow', hours: 96 })).ok).toBe(true);
  });

  it('[NF-006] pages by the cursor with the same window; tabs, filters with counters and the search', async () => {
    const h = await harness({ audiencePageSize: 2 });
    h.hub.control({ op: 'desktopGreeting', pageLabel: PAGE.pageLabel, fanRef: '2011' });
    await h.dispatch(open('newcomers'));
    let vm = h.boards.newcomers.getSnapshot(NEWCOMERS);
    expect(vm.rows).toHaveLength(1);
    expect(vm.canLoadMore).toBe(true);
    await h.dispatch({ type: 'LoadMore', list: 'newcomers' });
    await h.dispatch({ type: 'LoadMore', list: 'newcomers' });
    const lists = h.bg.requests.filter((r) => r.type === 'newcomers.list').map((r) => r.payload as { windowHours: number; cursor: string | null });
    expect(lists.map((l) => l.windowHours)).toEqual([48, 48, 48]);
    expect(lists[0]?.cursor).toBeNull();
    expect(lists[1]?.cursor).not.toBeNull();
    vm = h.boards.newcomers.getSnapshot(NEWCOMERS);
    expect(vm.canLoadMore).toBe(false);
    // [NF-005] the desktop's outbox confirmed a greeting: the fan is «поздоровались» and leaves «Поздороваться».
    expect(vm.rows.map((row) => row.handle)).toEqual([newcomer('2010'), newcomer('2012'), newcomer('2013'), newcomer('2014')]);
    expect(vm.tabs.map((tab) => tab.count)).toEqual([4, 5]);
    await h.dispatch({ type: 'SetNewcomersTab', tab: 'all' });
    await h.dispatch({ type: 'SetNewcomersFilter', filter: 'greeted' });
    vm = h.boards.newcomers.getSnapshot(NEWCOMERS);
    expect(vm.rows.map((row) => [row.handle, row.greeting.s])).toEqual([[newcomer('2011'), 'greeted']]);
    expect(vm.filters.find((f) => f.id === 'greeted')).toMatchObject({ count: 1, pressed: true });
    await h.dispatch({ type: 'ResetFilters', list: 'newcomers' });
    await h.dispatch({ type: 'Search', list: 'newcomers', query: 'NEWFAN_3' });
    expect(h.boards.newcomers.getSnapshot(NEWCOMERS)).toMatchObject({ query: 'NEWFAN_3' });
    expect(h.boards.newcomers.getSnapshot(NEWCOMERS).rows).toHaveLength(5);
    await h.advance(150);
    expect(h.boards.newcomers.getSnapshot(NEWCOMERS).rows.map((row) => row.handle)).toEqual([newcomer('2013')]);
    await h.dispatch({ type: 'Search', list: 'newcomers', query: 'nobody' });
    await h.advance(150);
    expect(h.boards.newcomers.getSnapshot(NEWCOMERS).view).toEqual({ s: 'empty', why: { key: 'spenders.empty' } });
  });

  it('[NF-004] polls every 30 s while open, not while closed; pauses offline and comes back with a spread; failures slow it down', async () => {
    const h = await harness();
    await h.dispatch(open('newcomers'));
    expect(count(h, 'newcomers.list')).toBe(1);
    await h.advance(29_000);
    expect(count(h, 'newcomers.list')).toBe(1);
    await h.advance(1_000);
    expect(count(h, 'newcomers.list')).toBe(2);
    await h.advance(30_000);
    expect(count(h, 'newcomers.list')).toBe(3);
    // Offline: no polls, and the view says so with what it last showed.
    h.online.set(false);
    await h.advance(120_000);
    expect(count(h, 'newcomers.list')).toBe(3);
    expect(h.boards.newcomers.getSnapshot(NEWCOMERS).view).toMatchObject({ s: 'offline', error: { code: 'CG-NETWORK' } });
    expect(h.boards.newcomers.getSnapshot(NEWCOMERS).rows).toHaveLength(5);
    h.online.set(true);
    await h.advance(2_500);
    expect(count(h, 'newcomers.list')).toBe(4);
    // A failed poll keeps the rows and doubles the wait.
    h.bg.failNext('newcomers.list', { code: 'CG-HUB-UNAVAILABLE' });
    await h.advance(30_000);
    expect(count(h, 'newcomers.list')).toBe(5);
    expect(h.boards.newcomers.getSnapshot(NEWCOMERS).view.s).toBe('offline');
    await h.advance(30_000);
    expect(count(h, 'newcomers.list')).toBe(5);
    await h.advance(30_000);
    expect(count(h, 'newcomers.list')).toBe(6);
    expect(h.boards.newcomers.getSnapshot(NEWCOMERS).view).toEqual({ s: 'ready' });
    // Closed: nothing more is read.
    await h.dispatch(open('newcomers', false));
    await h.advance(300_000);
    expect(count(h, 'newcomers.list')).toBe(6);
  });

  it('[NF-004] a tab asked to watch for the subscriber sound polls every 60 s; the first snapshot and a reconnect are silent, a subscription is news once', async () => {
    const h = await harness({ watchForSound: true });
    await h.advance(60_000);
    expect(count(h, 'newcomers.list')).toBe(1);
    expect(h.fresh).toEqual([]);
    h.hub.control({ op: 'audienceEvent', pageLabel: PAGE.pageLabel, fanRef: '2020' });
    await h.advance(60_000);
    expect(count(h, 'newcomers.list')).toBe(2);
    expect(h.fresh).toHaveLength(1);
    expect(h.fresh[0]).toMatchObject([{ fanRef: '2020' }]);
    await h.advance(60_000);
    expect(h.fresh).toHaveLength(1);
    // A reconnect: what arrived while away is not news.
    h.online.set(false);
    h.hub.control({ op: 'audienceEvent', pageLabel: PAGE.pageLabel, fanRef: '2021' });
    h.online.set(true);
    await h.advance(65_000);
    expect(h.fresh).toHaveLength(1);
    h.hub.control({ op: 'audienceEvent', pageLabel: PAGE.pageLabel, fanRef: '2022' });
    await h.advance(60_000);
    expect(h.fresh).toHaveLength(2);
    expect(h.fresh[1]).toMatchObject([{ fanRef: '2022' }]);
    // SN-012: a poll that failed is a reconnect too — who subscribed while the hub was away is not news when it answers again.
    h.bg.failNext('newcomers.list', { code: 'CG-HUB-UNAVAILABLE' });
    await h.advance(60_000);
    h.hub.control({ op: 'audienceEvent', pageLabel: PAGE.pageLabel, fanRef: '2023' });
    await h.advance(130_000);
    expect(h.boards.newcomers.getSnapshot(NEWCOMERS).view.s).not.toBe('offline');
    expect(h.fresh).toHaveLength(2);
    // The next subscription after that is news again, once.
    h.hub.control({ op: 'audienceEvent', pageLabel: PAGE.pageLabel, fanRef: '2024' });
    await h.advance(60_000);
    expect(h.fresh).toHaveLength(3);
    expect(h.fresh[2]).toMatchObject([{ fanRef: '2024' }]);
    // The background's own notice reads at once.
    const reads = count(h, 'newcomers.list');
    h.bg.emit('newcomers.changed', { pageId: PAGE.pageId });
    await h.flush();
    expect(count(h, 'newcomers.list')).toBe(reads + 1);
  });

  it('[NF-025] [NF-026] an incomplete list says so; another sign-in drops the list, the leases and the pass in flight', async () => {
    const h = await harness();
    await h.dispatch(open('newcomers'));
    const release = h.bg.hold('newcomers.list');
    void h.boards.newcomers.refresh();
    await h.flush();
    h.bg.signIn({ ...session, epoch: 4 });
    await h.flush();
    release();
    await h.flush();
    expect(h.boards.surfaces.current().newcomers).toBe(false);
    expect(h.boards.newcomers.getSnapshot(NEWCOMERS).rows).toEqual([]);

    const cut = await harness();
    cut.hub.control({
      op: 'scriptHttp',
      match: 'route',
      unscripted: 'model',
      exchanges: [
        {
          route: 'clientAudienceNew',
          request: { pageLabel: PAGE.pageLabel, windowHours: 48 },
          response: {
            status: 200,
            body: {
              pageLabel: PAGE.pageLabel,
              window: { hours: 48, from: iso(NOW_MS - 48 * 3_600_000), to: iso(NOW_MS), snapshotAt: iso(NOW_MS) },
              serverNow: iso(NOW_MS),
              coverage: { state: 'partial', deliveryFrontier: null, lastAudienceSweepAt: null, reasons: ['audience_sweep_pending'] },
              unknownCount: 2,
              welcomeTemplate: null,
              items: [],
              nextCursor: null,
            },
          },
        },
      ],
    });
    await cut.dispatch(open('newcomers'));
    const vm = cut.boards.newcomers.getSnapshot(NEWCOMERS);
    expect(vm.incomplete).toEqual({ key: 'newcomers.incomplete.body' });
    expect(vm.footer.stamp.coverage).toBe('partial');
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
  it('[NF-009] the card is a preview from «Новые»: who, when they subscribed, the archive, only Hi in the strip', async () => {
    const h = await withCard();
    const vm = h.boards.preview.getSnapshot(preview('newcomers'));
    expect(vm.header).toMatchObject({ name: 'newfan_0', lifetime: null, period30: null, newcomer: { kind: 'new' } });
    expect(Object.keys(vm.bar.actions)).toEqual(['hi']);
    expect(vm.bar.actions.hi).toMatchObject({ enabled: true });
    expect(vm.claim).toEqual({ s: 'none' });
    expect(vm.greeting).toEqual({ s: 'none' });
    expect(vm.ping).toBeNull();
    expect(h.boards.newcomers.getSnapshot(NEWCOMERS)).toMatchObject({ cardOpen: true });
    expect(h.boards.newcomers.getSnapshot(NEWCOMERS).rows.find((row) => row.selected)?.handle).toBe(newcomer('2010'));
    expect(count(h, 'fan.card')).toBe(0);
    expect(count(h, 'newcomers.claim')).toBe(0);
  });

  it('[NF-013] [NF-021] «Сгенерировать» takes the lease first, then starts Hi with one variant on the `newcomers` surface', async () => {
    const h = await withCard();
    h.script(0, 'hi-greeting', 'Hi there!\n[NEXT]\nSo happy you are here');
    const receipt = await h.dispatch({ type: 'Generate', targetHandle: newcomer('2010'), feature: 'hi', options: {} });
    expect(receipt.ok).toBe(true);
    const types = h.bg.requests.map((r) => r.type);
    expect(types.indexOf('newcomers.claim')).toBeGreaterThan(-1);
    expect(types.indexOf('newcomers.claim')).toBeLessThan(types.indexOf('op.start'));
    expect(lastPayload(h, 'newcomers.claim')).toEqual({ pageId: PAGE.pageId, fanRef: '2010', action: 'claim' });
    expect(lastPayload(h, 'op.start')).toMatchObject({ feature: 'hi', surface: 'newcomers', variantCount: 1, tone: null });
    expect(h.host.calls.checkpoints).toHaveLength(1);
    await h.advance(200);
    const vm = h.boards.preview.getSnapshot(preview('newcomers'));
    expect(vm.claim).toMatchObject({ s: 'mine', until: NOW_MS + 119_000, renew: { action: { type: 'RenewClaim', targetHandle: newcomer('2010') } }, release: { action: { type: 'ReleaseClaim', targetHandle: newcomer('2010') } } });
    expect(vm.greeting).toEqual({ s: 'claim-mine' });
    expect(vm.result?.parts?.map((part) => part.text)).toEqual(['Hi there!', 'So happy you are here']);
    expect(vm.result?.parts?.[0]?.variant).toBe(0);
    expect(h.boards.newcomers.getSnapshot(NEWCOMERS).rows[0]?.greeting).toEqual({ s: 'claim-mine' });
    expect(h.host.calls.commits).toEqual([]);
  });

  it('[NF-013] §6.7.5: the freshness checkpoint is taken at the click — before the lease is asked for and before the hub request', async () => {
    const h = await withCard();
    h.script(0, 'hi-greeting', 'Hi there!');
    // The hub takes its time with the lease.
    const release = h.bg.hold('newcomers.claim');
    const pending = h.boards.preview.dispatch({ type: 'Generate', targetHandle: newcomer('2010'), feature: 'hi', options: {} })!;
    await h.flush();
    expect(count(h, 'newcomers.claim')).toBe(1);
    // MAIN was already asked while the lease is still on its way: a fan message that lands during the claim is after the checkpoint.
    expect(h.host.calls.checkpoints).toEqual([{ host: 'chatspace', hostAccountId: HOST_IDS.acc, platformFanId: '2010' }]);
    expect(count(h, 'token.issue')).toBe(0);
    expect(count(h, 'op.start')).toBe(0);
    release();
    expect((await pending).ok).toBe(true);
    await h.flush();
    expect(h.host.calls.checkpoints).toHaveLength(1);
    expect((lastPayload(h, 'op.start') as Record<string, unknown>)['checkpoint']).toMatchObject({ platformFanId: '2010', fanSequence: 2 });
  });

  it('[NF-021] the lease is renewed every 40 s while the person works with the fan, lapses when they stop, and is released explicitly', async () => {
    const h = await withCard();
    h.script(0, 'hi-greeting', 'Hi there!');
    await h.dispatch({ type: 'Generate', targetHandle: newcomer('2010'), feature: 'hi', options: {} });
    await h.advance(200);
    const claims = (): string[] => h.bg.requests.filter((r) => r.type === 'newcomers.claim').map((r) => (r.payload as { action: string }).action);
    expect(claims()).toEqual(['claim']);
    await h.advance(40_000);
    expect(claims()).toEqual(['claim', 'renew']);
    await h.advance(40_000);
    expect(claims()).toEqual(['claim', 'renew', 'renew']);
    // No action with the fan for longer than the activity window: no more renewals, and the lease runs out.
    await h.advance(80_000);
    const renewals = claims().length;
    await h.advance(200_000);
    expect(claims()).toHaveLength(renewals);
    const lapsed = h.boards.preview.getSnapshot(preview('newcomers'));
    expect(lapsed.claim).toMatchObject({ s: 'expired', error: { code: 'CG-CLAIM-EXPIRED' } });
    expect(lapsed.result?.parts?.[0]?.send).toMatchObject({ s: 'unavailable', code: 'CG-CLAIM-EXPIRED' });
    expect(lapsed.result?.parts?.[0]?.openInsert).toMatchObject({ s: 'unavailable', reason: { id: 'claim-expired' } });
    // «Продлить бронь» takes it again; «Снять бронь» releases it.
    expect((await h.dispatch({ type: 'RenewClaim', targetHandle: newcomer('2010') })).ok).toBe(true);
    expect(h.boards.preview.getSnapshot(preview('newcomers')).claim?.s).toBe('mine');
    expect((await h.dispatch({ type: 'ReleaseClaim', targetHandle: newcomer('2010') })).ok).toBe(true);
    expect(claims().at(-1)).toBe('release');
    expect(h.boards.preview.getSnapshot(preview('newcomers')).claim).toEqual({ s: 'none' });
    expect(h.hub.status().claims.find((c) => c.fanRef === '2010')?.lease).toBe('released');
  });

  it('[NF-021] a Generate refused after the lease was taken does not leave it renewing: the lease this click took goes back at once', async () => {
    const h = await withCard();
    const claims = (): string[] => h.bg.requests.filter((r) => r.type === 'newcomers.claim').map((r) => (r.payload as { action: string }).action);
    // The fourth generation of the tab, a hub that does not answer: the operation never starts.
    h.bg.failNext('op.start', { code: 'CG-OP-TAB-LIMIT' });
    expect(await h.dispatch({ type: 'Generate', targetHandle: newcomer('2010'), feature: 'hi', options: {} })).toMatchObject({ ok: false, code: 'CG-OP-TAB-LIMIT' });
    expect(claims()).toEqual(['claim', 'release']);
    expect(h.hub.status().claims.find((c) => c.fanRef === '2010')?.lease).toBe('released');
    expect(h.boards.preview.getSnapshot(preview('newcomers')).claim).toEqual({ s: 'none' });
    // The person leaves; twenty minutes later nothing more was asked of the hub for this fan.
    await h.dispatch(open('newcomers', false));
    await walk(h, 10 * 60_000);
    expect(claims()).toEqual(['claim', 'release']);
    // The same with a token the background refuses to issue.
    const noToken = await withCard();
    noToken.bg.failNext('token.issue', { code: 'CG-RUNTIME-UNREACHABLE' });
    expect((await noToken.dispatch({ type: 'Generate', targetHandle: newcomer('2010'), feature: 'hi', options: {} })).ok).toBe(false);
    await walk(noToken, 10 * 60_000);
    expect(noToken.bg.requests.filter((r) => r.type === 'newcomers.claim').map((r) => (r.payload as { action: string }).action)).toEqual(['claim', 'release']);
  });

  it('[NF-021] a refused Generate under a lease the tab already held keeps the lease, and it lapses once the person stops working', async () => {
    const h = await withCard();
    const claims = (): string[] => h.bg.requests.filter((r) => r.type === 'newcomers.claim').map((r) => (r.payload as { action: string }).action);
    h.script(0, 'hi-greeting', 'Hi there!');
    await h.dispatch({ type: 'Generate', targetHandle: newcomer('2010'), feature: 'hi', options: {} });
    await h.advance(200);
    expect(claims()).toEqual(['claim']);
    h.bg.failNext('op.start', { code: 'CG-HUB-UNAVAILABLE' });
    expect((await h.dispatch({ type: 'Generate', targetHandle: newcomer('2010'), feature: 'hi', options: {} })).ok).toBe(false);
    // The lease was not this click's to give back.
    expect(claims()).toEqual(['claim', 'renew']);
    expect(h.boards.preview.getSnapshot(preview('newcomers')).claim?.s).toBe('mine');
    // Nobody at the card: renewals go on only inside the activity window (120 s), then the lease runs out.
    await h.dispatch(open('newcomers', false));
    await walk(h, 10 * 60_000);
    const asked = claims();
    expect(asked).toEqual(['claim', 'renew', 'renew', 'renew', 'renew']);
    expect(h.hub.status().claims.find((c) => c.fanRef === '2010')?.lease).toBe('expired');
    await walk(h, 5 * 60_000);
    expect(claims()).toEqual(asked);
    expect(h.boards.newcomers.greeting.leaseToken('2010')).toBeNull();
  });

  it('[NF-021] a running generation is «working with the fan»: the lease is renewed while it runs, even past the activity window', async () => {
    // The owner set a short activity window: 20 s without an action of the person and the lease is no longer renewed.
    const h = await withCard({ config: { ...X8, limits: { ...X8.limits, claimActivityWindowSec: 20 } } });
    const claims = (): string[] => h.bg.requests.filter((r) => r.type === 'newcomers.claim').map((r) => (r.payload as { action: string }).action);
    const opId = uuid(0x100);
    const generationRef = uuid(0x200);
    // A slow answer: it is still being written when the renewal comes due at 40 s.
    h.bg.streams.streamScript.push({
      kind: 'stream',
      steps: [
        { kind: 'frame', frame: meta('hi-greeting', { clientRequestId: opId, requestId: generationRef }) },
        { kind: 'frame', frame: contextFrame({ generationRef, knownFanMessages: [HOST_IDS.messages.fanBefore, HOST_IDS.messages.fanEarlier].map((id) => ({ id, state: 'included' })), live: { status: 'not_sent', accepted: 0, rejected: 0 } }) },
        { kind: 'frame', frame: { type: 'content_delta', text: 'Hi ' }, afterMs: 25_000 },
        { kind: 'frame', frame: { type: 'content_delta', text: 'there!' }, afterMs: 25_000 },
        { kind: 'frame', frame: { type: 'done', stopReason: 'end_turn' } },
      ],
    });
    expect((await h.dispatch({ type: 'Generate', targetHandle: newcomer('2010'), feature: 'hi', options: {} })).ok).toBe(true);
    await walk(h, 45_000);
    expect(h.boards.preview.getSnapshot(preview('newcomers')).result?.state).toBe('streaming');
    // The person only waited, for longer than the window — the operation of theirs kept the lease.
    expect(claims()).toEqual(['claim', 'renew']);
    await walk(h, 10_000);
    expect(h.boards.preview.getSnapshot(preview('newcomers')).result?.state).toBe('done');
    // Done, and nobody acts: 20 s later the lease is no longer renewed.
    await walk(h, 120_000);
    expect(claims()).toEqual(['claim', 'renew']);
  });

  it('[NF-021] «in flight» is not for ever: an operation whose end never reaches the tab does not renew the lease for as long as the tab lives', async () => {
    const h = await withCard();
    const claims = (): string[] => h.bg.requests.filter((r) => r.type === 'newcomers.claim').map((r) => (r.payload as { action: string }).action);
    // The background was unloaded mid-stream: the end of the operation is never told to the tab.
    const emit = h.bg.emit.bind(h.bg) as (type: string, payload: unknown) => void;
    h.bg.emit = (type: string, payload: unknown) => (type === 'op.done' ? undefined : emit(type, payload));
    h.script(0, 'hi-greeting', 'Hi there!');
    expect((await h.dispatch({ type: 'Generate', targetHandle: newcomer('2010'), feature: 'hi', options: {} })).ok).toBe(true);
    await h.advance(200);
    expect(h.boards.preview.getSnapshot(preview('newcomers')).result?.state).not.toBe('done');
    // The person leaves. The generation still looks «running» to the tab — for five minutes that keeps the lease, then nothing does.
    await h.dispatch(open('newcomers', false));
    await walk(h, 15 * 60_000);
    const asked = claims();
    expect(asked).toEqual(['claim', ...Array.from({ length: 7 }, () => 'renew')]);
    expect(h.hub.status().claims.find((c) => c.fanRef === '2010')?.lease).toBe('expired');
    await walk(h, 10 * 60_000);
    expect(claims()).toEqual(asked);
    expect(h.boards.newcomers.greeting.leaseToken('2010')).toBeNull();
  });

  it('[NF-021] the fan’s chat left open is not «working with the fan» for ever; typing in it is', async () => {
    const chat = { host: 'chatspace' as const, hostAccountId: HOST_IDS.acc, platformFanId: '2010' };
    const opened: HostEvent = { type: 'route', route: { epoch: 6, name: 'chat', account: hostAccount, chat } };
    const typed = (revision: number): HostEvent => ({ type: 'composer', composer: { chat, instanceId: 'composer-2', ready: true, hidden: false, draft: { revision, provenance: 'human-or-unknown' } } });
    const start = async (): Promise<{ h: Harness; claims: () => string[] }> => {
      const h = await withCard();
      h.script(0, 'hi-greeting', 'Hi there!');
      await h.dispatch({ type: 'Generate', targetHandle: newcomer('2010'), feature: 'hi', options: {} });
      await h.advance(200);
      // The person is in the fan's own chat now (after «Открыть и вставить», or by ChatSpace's own list).
      h.hostEvent(opened);
      await h.flush();
      return { h, claims: () => h.bg.requests.filter((r) => r.type === 'newcomers.claim').map((r) => (r.payload as { action: string }).action) };
    };
    // Nobody at the keyboard: the open chat keeps the lease for five minutes after the last sign of life, not for as long as the tab lives.
    const idle = await start();
    await walk(idle.h, 20 * 60_000);
    expect(idle.claims().filter((action) => action === 'renew')).toHaveLength(7);
    expect(idle.h.hub.status().claims.find((c) => c.fanRef === '2010')?.lease).toBe('expired');
    // The person keeps typing in that chat: the lease is theirs for as long as they do.
    const busy = await start();
    for (let minute = 0; minute < 20; minute += 1) {
      await walk(busy.h, 60_000);
      busy.h.hostEvent(typed(10 + minute));
      await busy.h.flush();
    }
    expect(busy.h.hub.status().claims.find((c) => c.fanRef === '2010')?.lease).toBe('active');
    expect(busy.h.boards.newcomers.greeting.leaseToken('2010')).not.toBeNull();
    // Typing in another fan's chat is not work with this fan.
    const other = await start();
    for (let minute = 0; minute < 20; minute += 1) {
      await walk(other.h, 60_000);
      other.h.hostEvent({ type: 'composer', composer: { chat: { ...chat, platformFanId: '2011' }, instanceId: 'composer-3', ready: true, hidden: false, draft: { revision: 10 + minute, provenance: 'human-or-unknown' } } });
      await other.h.flush();
    }
    expect(other.h.hub.status().claims.find((c) => c.fanRef === '2010')?.lease).toBe('expired');
  });

  it('[NF-021] a renewal that does not go through is tried again and the card says so; the lease does not lapse while the person works', async () => {
    const h = await withCard();
    const claims = (): string[] => h.bg.requests.filter((r) => r.type === 'newcomers.claim').map((r) => (r.payload as { action: string }).action);
    h.script(0, 'hi-greeting', 'Hi there!');
    await h.dispatch({ type: 'Generate', targetHandle: newcomer('2010'), feature: 'hi', options: {} });
    await h.advance(200);
    // The person keeps working with the fan: a keystroke in the draft every 15 s.
    const work = async (seconds: number): Promise<void> => {
      for (let passed = 0; passed < seconds; passed += 15) {
        await h.advance(15_000);
        await h.dispatch({ type: 'SetPreviewDraft', targetHandle: newcomer('2010'), text: `hello ${h.clock.now()}` });
      }
    };
    h.bg.failNext('newcomers.claim', { code: 'CG-HUB-TIMEOUT' });
    await work(45);
    expect(claims()).toEqual(['claim', 'renew']);
    const failed = h.boards.preview.getSnapshot(preview('newcomers')).claim;
    // The lease is still ours to its own deadline; the card names the failed renewal.
    expect(failed).toMatchObject({ s: 'mine', until: NOW_MS + 119_000, renewError: { code: 'CG-HUB-TIMEOUT' } });
    await work(15);
    expect(claims()).toEqual(['claim', 'renew', 'renew']);
    const renewed = h.boards.preview.getSnapshot(preview('newcomers')).claim;
    expect(renewed?.s === 'mine' && renewed.renewError).toBeUndefined();
    expect(renewed?.s === 'mine' && renewed.until).toBeGreaterThan(NOW_MS + 119_000);
    await work(120);
    expect(h.boards.preview.getSnapshot(preview('newcomers')).claim?.s).toBe('mine');
    expect(h.hub.status().claims.find((c) => c.fanRef === '2010')?.lease).toBe('active');
  });

  it('[NF-021] renewals that keep failing are retried every 10 s up to the deadline; then «бронь истекла» shows at once, without anyone asking', async () => {
    const h = await withCard();
    const claims = (): string[] => h.bg.requests.filter((r) => r.type === 'newcomers.claim').map((r) => (r.payload as { action: string }).action);
    h.script(0, 'hi-greeting', 'Hi there!');
    await h.dispatch({ type: 'Generate', targetHandle: newcomer('2010'), feature: 'hi', options: {} });
    await h.advance(200);
    const seen: string[] = [];
    h.boards.preview.subscribe(preview('newcomers'), (vm) => seen.push(vm.claim?.s ?? '-'));
    for (let i = 0; i < 20; i += 1) h.bg.failNext('newcomers.claim', { code: 'CG-HUB-UNAVAILABLE' });
    for (let passed = 0; passed < 110; passed += 10) {
      await h.advance(10_000);
      await h.dispatch({ type: 'SetPreviewDraft', targetHandle: newcomer('2010'), text: `still here ${passed}` });
    }
    // 40 s, then every 10 s: 40, 50, … 110 — eight tries, none a claim.
    expect(claims()).toEqual(['claim', ...Array.from({ length: 8 }, () => 'renew')]);
    expect(seen.at(-1)).toBe('mine');
    seen.length = 0;
    await h.advance(9_000);
    // The deadline: the view is pushed as expired, nothing had to read it first.
    expect(seen.at(-1)).toBe('expired');
    expect(h.boards.preview.getSnapshot(preview('newcomers')).claim).toMatchObject({ s: 'expired', error: { code: 'CG-CLAIM-EXPIRED' } });
    await h.advance(60_000);
    expect(claims().filter((action) => action === 'renew')).toHaveLength(8);
  });

  it('[NF-021] [NF-024] claim races: a colleague’s lease refuses Hi with the fan’s name and no countdown; when it is released the fan can be claimed', async () => {
    const h = await withCard();
    const colleague = h.hub.issueToken({ username: WORLD.otherUser.username });
    const theirs = { action: 'claim', leaseToken: uuid(0xc01), instanceId: WORLD.otherInstanceId } as const;
    const claimed = await hubCall(h.hub.fetch, h.hub.origin, 'clientFanClaim', { pageLabel: PAGE.pageLabel, fanRef: '2010', body: theirs }, { token: colleague });
    expect(claimed.status).toBe(200);
    h.script(0, 'hi-greeting', 'Hi there!');
    const refused = await h.dispatch({ type: 'Generate', targetHandle: newcomer('2010'), feature: 'hi', options: {} });
    expect(refused).toMatchObject({ ok: false, code: 'CG-CLAIM-BUSY', error: { title: 'Другой чаттер уже здоровается с newfan_0' } });
    expect(count(h, 'op.start')).toBe(0);
    const vm = h.boards.preview.getSnapshot(preview('newcomers'));
    expect(vm.claim).toMatchObject({ s: 'other', error: { code: 'CG-CLAIM-BUSY' } });
    expect(JSON.stringify(vm.claim)).not.toMatch(/until|expires/);
    expect(vm.greeting).toEqual({ s: 'claim-other' });
    expect(vm.bar.actions.hi).toMatchObject({ enabled: false, reason: { id: 'claim-busy', code: 'CG-CLAIM-BUSY' } });
    expect(h.boards.newcomers.getSnapshot(NEWCOMERS).rows[0]?.greeting).toEqual({ s: 'claim-other' });
    // The colleague lets go; the next read of the list shows the fan free again.
    await hubCall(h.hub.fetch, h.hub.origin, 'clientFanClaim', { pageLabel: PAGE.pageLabel, fanRef: '2010', body: { ...theirs, action: 'release' } }, { token: colleague });
    expect((await h.dispatch({ type: 'RenewClaim', targetHandle: newcomer('2010') })).ok).toBe(true);
    expect(h.boards.preview.getSnapshot(preview('newcomers')).claim?.s).toBe('mine');
    expect((await h.dispatch({ type: 'Generate', targetHandle: newcomer('2010'), feature: 'hi', options: {} })).ok).toBe(true);
  });

  it('[NF-021] the list already shows a colleague’s lease: Hi is off before any click; the same person elsewhere is told apart', async () => {
    const h = await harness({ config: X8, checkpointFan: '2011' });
    const colleague = h.hub.issueToken({ username: WORLD.otherUser.username });
    await hubCall(h.hub.fetch, h.hub.origin, 'clientFanClaim', { pageLabel: PAGE.pageLabel, fanRef: '2011', body: { action: 'claim', leaseToken: uuid(0xc02), instanceId: WORLD.otherInstanceId } }, { token: colleague });
    // This person, on another device (another install and token).
    const elsewhere = h.hub.issueToken();
    await hubCall(h.hub.fetch, h.hub.origin, 'clientFanClaim', { pageLabel: PAGE.pageLabel, fanRef: '2012', body: { action: 'claim', leaseToken: uuid(0xc03), instanceId: uuid(0x999) } }, { token: elsewhere });
    await h.dispatch(open('newcomers'));
    const rows = h.boards.newcomers.getSnapshot(NEWCOMERS).rows;
    expect(rows.map((row) => row.greeting.s)).toEqual(['none', 'claim-other', 'claim-elsewhere', 'none', 'none']);
    await h.dispatch({ type: 'OpenPreview', targetHandle: newcomer('2011') });
    expect(h.boards.preview.getSnapshot(preview('newcomers')).bar.actions.hi).toMatchObject({ enabled: false, reason: { id: 'claim-busy' } });
    expect(h.boards.preview.getSnapshot(preview('newcomers')).claim?.s).toBe('other');
    expect((await h.dispatch({ type: 'Generate', targetHandle: newcomer('2011'), feature: 'hi', options: {} })).ok).toBe(false);
    expect(count(h, 'newcomers.claim')).toBe(0);
    await h.dispatch({ type: 'OpenPreview', targetHandle: newcomer('2012') });
    const mineElsewhere = h.boards.preview.getSnapshot(preview('newcomers'));
    expect(mineElsewhere.claim).toEqual({ s: 'elsewhere', note: { key: 'newcomers.claim.elsewhere' } });
    expect(mineElsewhere.bar.actions.hi).toMatchObject({ enabled: false, reason: { id: 'claim-elsewhere' } });
  });

  it('[NF-023] one action per fan at a time: a second claim while the first has not answered is refused, not queued', async () => {
    const h = await withCard();
    const release = h.bg.hold('newcomers.claim');
    const first = h.boards.newcomers.dispatch({ type: 'RenewClaim', targetHandle: newcomer('2010') })!;
    await h.flush();
    const second = await h.dispatch({ type: 'RenewClaim', targetHandle: newcomer('2010') });
    expect(second).toMatchObject({ ok: false, code: 'CG-CLAIM-ROW-BUSY' });
    release();
    expect((await first).ok).toBe(true);
    await h.flush();
    expect(count(h, 'newcomers.claim')).toBe(1);
    // Another fan is not blocked by this one.
    expect((await h.dispatch({ type: 'RenewClaim', targetHandle: newcomer('2011') })).ok).toBe(true);
  });

  it('[NF-026] a claim answer that arrives after another sign-in is nobody’s', async () => {
    const h = await withCard();
    const release = h.bg.hold('newcomers.claim');
    const pending = h.boards.newcomers.dispatch({ type: 'RenewClaim', targetHandle: newcomer('2010') })!;
    await h.flush();
    h.bg.signIn({ ...session, epoch: 4 });
    await h.flush();
    release();
    expect(await pending).toMatchObject({ ok: false, code: 'CG-CONTEXT-CHANGED' });
    await h.flush();
    expect(h.boards.newcomers.greeting.leaseToken('2010')).toBeNull();
  });

  it('[NF-015] a thread the archive proves to be a dialogue gets no Hi, and no AI call', async () => {
    const h = await harness({ config: X8, checkpointFan: '2010' });
    for (let i = 0; i < 11; i += 1) h.hub.control({ op: 'archiveMessage', pageLabel: PAGE.pageLabel, fanRef: '2010', sender: 'fan', messageId: String(8100 + i) });
    await h.dispatch(open('newcomers'));
    await h.dispatch({ type: 'OpenPreview', targetHandle: newcomer('2010') });
    expect(h.boards.preview.getSnapshot(preview('newcomers')).bar.actions.hi).toMatchObject({ enabled: false, reason: { id: 'hi-gate', code: 'CG-GATE-HI' } });
    expect(await h.dispatch({ type: 'Generate', targetHandle: newcomer('2010'), feature: 'hi', options: {} })).toMatchObject({ ok: false, code: 'CG-GATE-HI' });
    expect(count(h, 'op.start')).toBe(0);
    expect(count(h, 'newcomers.claim')).toBe(0);
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
    expect(h.clicks[0]?.leaseToken).toBe(h.boards.newcomers.greeting.leaseToken('2010'));
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
    expect(vm.result).toMatchObject({ canRegenerate: false, regenerateReason: { id: 'hi-gate', code: 'CG-GATE-HI' } });
    expect(vm.bar.actions.hi).toMatchObject({ enabled: false, reason: { id: 'hi-gate' } });
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

  it('[NF-021] the hub lost the lease behind the tab’s back: the part is held, «Продлить бронь» takes it again, and a new click sends', async () => {
    const { h, opId } = await greeting('Hi there!');
    // The hub's clock ran ahead of the tab's: the lease is gone there, still live here.
    h.hub.control({ op: 'clock', advanceMs: 200_000 });
    expect(h.boards.preview.getSnapshot(preview('newcomers')).claim?.s).toBe('mine');
    await h.dispatch({ type: 'SendPart', operationId: opId, variant: 0, part: 0 });
    const held = h.boards.preview.getSnapshot(preview('newcomers'));
    expect(held.result?.parts?.[0]?.send).toMatchObject({ s: 'unavailable', code: 'CG-CLAIM-EXPIRED' });
    expect(held.claim).toMatchObject({ s: 'expired' });
    expect(h.host.calls.commits).toEqual([]);
    expect((await h.dispatch({ type: 'RenewClaim', targetHandle: newcomer('2010') })).ok).toBe(true);
    const again = h.boards.preview.getSnapshot(preview('newcomers'));
    expect(again.claim?.s).toBe('mine');
    expect(again.result?.parts?.[0]?.send).toEqual({ s: 'available' });
    // Nothing went by itself; the next send is the person's click, a new attempt.
    expect(h.host.calls.commits).toEqual([]);
    expect(await h.dispatch({ type: 'SendPart', operationId: opId, variant: 0, part: 0 })).toMatchObject({ ok: true, attemptId: uuid(0x501) });
    expect(h.host.calls.commits).toHaveLength(1);
  });

  it('[NF-022] an unknown outcome stops the fan: the card says which part, Hi is off, nothing else goes', async () => {
    const h = await withCard({ answers: { commit: [{ state: 'uncertain', code: 'CG-SEND-UNCERTAIN' }] } });
    const { opId } = h.script(0, 'hi-greeting', 'Hi there!\n[NEXT]\nSo happy you are here\n[NEXT]\nA gift for you');
    await h.dispatch({ type: 'Generate', targetHandle: newcomer('2010'), feature: 'hi', options: {} });
    await h.advance(200);
    await h.dispatch({ type: 'SendPart', operationId: opId, variant: 0, part: 0 });
    const vm = h.boards.preview.getSnapshot(preview('newcomers'));
    expect(vm.greeting).toEqual({ s: 'stopped', sent: 0, total: 3, part: 1 });
    expect(vm.claim).toMatchObject({ s: 'held-uncertain', part: 1, error: { code: 'CG-SEND-UNCERTAIN' } });
    expect(vm.stoppedNote).toEqual({ key: 'newcomers.stopped', params: { n: 1 } });
    expect(vm.bar.actions.hi).toMatchObject({ enabled: false, reason: { id: 'part-uncertain' } });
    expect(vm.result?.parts?.map((part) => part.sendOrder)).toEqual([null, { kind: 'held', part: 1 }, { kind: 'held', part: 1 }]);
    expect(h.boards.newcomers.getSnapshot(NEWCOMERS).rows[0]?.greeting).toEqual({ s: 'stopped', sent: 0, total: 3, part: 1 });
    for (const part of [0, 1, 2]) expect((await h.dispatch({ type: 'SendPart', operationId: opId, variant: 0, part })).ok).toBe(false);
    expect((await h.dispatch({ type: 'Generate', targetHandle: newcomer('2010'), feature: 'hi', options: {} })).ok).toBe(false);
    expect(h.host.calls.commits).toHaveLength(1);
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

  it('[X8-09] [NF-019] «Новые» confirms the subscription only by a status with its data time: without one the greeting is not sent from the card', async () => {
    const h = await harness({ config: X8, checkpointFan: '2010' });
    const page = (await movedThread(h)) as { items: { status: { asOf: string | null } }[] };
    page.items[0]!.status.asOf = null;
    h.hub.control({ op: 'scriptHttp', match: 'route', unscripted: 'model', exchanges: [{ route: 'clientAudienceNew', request: { pageLabel: PAGE.pageLabel, windowHours: 48 }, response: { status: 200, body: page } }] });
    await h.dispatch(open('newcomers'));
    await h.dispatch({ type: 'OpenPreview', targetHandle: newcomer('2010') });
    const { opId } = h.script(0, 'hi-greeting', 'Hi there!');
    await h.dispatch({ type: 'Generate', targetHandle: newcomer('2010'), feature: 'hi', options: {} });
    await h.advance(200);
    expect(partsOf(h, 'newcomers')[0]?.send).toMatchObject({ s: 'unavailable', code: 'CG-SEND-FAN', reason: { key: 'send.reason.fan' } });
    expect(await h.dispatch({ type: 'SendPart', operationId: opId, variant: 0, part: 0 })).toMatchObject({ ok: false, code: 'CG-SEND-FAN' });
    expect(h.clicks).toEqual([]);
    // «Открыть и вставить» stays: the person sends with ChatSpace's own button.
    expect(partsOf(h, 'newcomers')[0]?.openInsert).toEqual({ s: 'available' });
  });

  it('[NF-018] a draft written before the thread changed is «устарел» in the list', async () => {
    const h = await withCard();
    await h.dispatch({ type: 'SetPreviewDraft', targetHandle: newcomer('2010'), text: 'welcome!' });
    expect(h.boards.newcomers.getSnapshot(NEWCOMERS).rows[0]).toMatchObject({ hasDraft: true, draftStale: false });
    h.hub.control({
      op: 'scriptHttp',
      match: 'route',
      unscripted: 'model',
      exchanges: [
        {
          route: 'clientAudienceNew',
          request: { pageLabel: PAGE.pageLabel, windowHours: 48 },
          response: { status: 200, body: await movedThread(h) },
        },
      ],
    });
    await h.boards.newcomers.refresh();
    await h.flush();
    expect(h.boards.newcomers.getSnapshot(NEWCOMERS).rows[0]).toMatchObject({ hasDraft: true, draftStale: true });
  });
});

/** The «Новые» page as the hub serves it now, with the first fan's thread one message further. */
async function movedThread(h: Harness): Promise<unknown> {
  const token = h.hub.issueToken();
  const response = await hubCall(h.hub.fetch, h.hub.origin, 'clientAudienceNew', { pageLabel: PAGE.pageLabel, windowHours: 48, limit: 100 }, { token });
  const page = (await response.json()) as { items: { thread: { storedMessageCount: number; lastMessageAt: string | null } | null }[] };
  const first = page.items[0]!;
  first.thread = { ...(first.thread as NonNullable<typeof first.thread>), storedMessageCount: 2, lastMessageAt: iso(NOW_MS) };
  return page;
}

describe('[CS-031] [CS-033] [CS-034] [CS-035] [CS-036] [CS-037] the fan panel follows the open chat', () => {
  const chatOf = (fan: string) => ({ host: 'chatspace' as const, hostAccountId: HOST_IDS.acc, platformFanId: fan });
  const routeTo = (fan: string | null): HostEvent => ({ type: 'route', route: { epoch: 6, name: fan === null ? 'accounts-overview' : 'chat', account: hostAccount, chat: fan === null ? null : chatOf(fan) } });

  it('[CS-031] nothing is read while the panel is closed; without an open chat it says «Выберите чат»', async () => {
    const h = await harness({ start: { route: { epoch: 5, name: 'accounts-overview', account: hostAccount, chat: null } } });
    expect(count(h, 'fan.card')).toBe(0);
    await h.dispatch(open('fan-panel'));
    const vm = h.boards.fanPanel.getSnapshot(PANEL);
    expect(vm.view).toEqual({ s: 'empty', why: { key: 'fanPanel.empty.title' } });
    expect(vm).toMatchObject({ fan: null, spent: null, subscription: null, personaLabel: 'Лора · VIP', tab: 'fan', close: open('fan-panel', false) });
    expect(count(h, 'fan.card')).toBe(0);
    await h.dispatch({ type: 'SetFanPanelTab', tab: 'recap' });
    expect(h.boards.fanPanel.getSnapshot(PANEL).tab).toBe('recap');
  });

  it('[CS-033] [CS-034] [CS-036] [DB-026] money by kind and the subscription of this page from the hub; the data time and the archive coverage in the footer — with no board loaded', async () => {
    const h = await harness();
    await h.dispatch(open('fan-panel'));
    h.hostEvent(routeTo('5001'));
    await h.flush();
    const cards = h.bg.requests.filter((r) => r.type === 'fan.card').map((r) => r.payload as { fanRef: string; period: string });
    expect(cards.filter((c) => c.fanRef === '5001').map((c) => c.period).sort()).toEqual(['30d', 'lifetime']);
    const vm = h.boards.fanPanel.getSnapshot(PANEL);
    expect(vm.view).toEqual({ s: 'ready' });
    expect(vm.fan).toMatchObject({ name: 'Fan 1', username: 'fan_1', initials: 'F1', lastSeenAt: null, online: null });
    expect(vm.spent).toMatchObject({ total: 3_717_000, period30: 1_239_000 });
    expect(vm.spent?.byKind).toEqual([{ kind: 'messages', mills: 1_239_000 }]);
    expect(vm.subscription).toEqual({ months: null, since: null, autoRenew: null, churnRisk: null });
    expect(vm.footer.stamp.asOf).toBe(iso(NOW_MS));
    // DB-026: the archive's coverage is read for the open chat itself — one row of the hub's feed; the Spenders board was never opened.
    expect(count(h, 'spenders.board')).toBe(0);
    expect(h.bg.requests.filter((r) => r.type === 'feed.read' && (r.payload as { fanRef: string }).fanRef === '5001').map((r) => r.payload)).toEqual([{ pageId: PAGE.pageId, fanRef: '5001', cursor: null, limit: 1 }]);
    expect(vm.footer).toMatchObject({ archiveMessages: null, stamp: { coverage: 'complete' } });
    // Nothing was asked of ChatSpace for it: no navigation, no history read, no checkpoint.
    expect(h.host.calls.navigations).toEqual([]);
    expect(h.host.calls.checkpoints).toEqual([]);
    // With the board loaded, its row gives the retention status and the number of archived messages.
    await h.dispatch(open('spenders'));
    const withRow = h.boards.fanPanel.getSnapshot(PANEL);
    expect(withRow.subscription?.churnRisk).toBe('low');
    expect(withRow.footer).toMatchObject({ archiveMessages: 11, stamp: { coverage: 'complete' } });
    // Going back to a chat reuses the card for a minute.
    const reads = count(h, 'fan.card');
    h.hostEvent(routeTo('5002'));
    await h.flush();
    h.hostEvent(routeTo('5001'));
    await h.flush();
    expect(count(h, 'fan.card')).toBe(reads + 2);
    await h.dispatch({ type: 'ReloadView', selector: PANEL });
    expect(count(h, 'fan.card')).toBe(reads + 4);
  });

  it('[DB-026] [CS-036] an archive whose state nobody told is said: the panel is «partial», never «ready» over an unknown archive', async () => {
    // The page has no archive feed (the preview is off): nothing is asked, and the footer does not pretend.
    const off = await harness({ config: { pageFlags: { [PAGE.pageLabel]: { preview: false } } } });
    await off.dispatch(open('fan-panel'));
    off.hostEvent(routeTo('5001'));
    await off.flush();
    expect(count(off, 'feed.read')).toBe(0);
    const unknown = off.boards.fanPanel.getSnapshot(PANEL);
    expect(unknown.view).toEqual({ s: 'partial', gaps: [{ kind: 'coverage', level: 'unknown' }] });
    expect(unknown.footer).toMatchObject({ archiveMessages: null, stamp: { coverage: 'unknown' } });
    expect(unknown.spent?.total).toBe(3_717_000);
    // The feed read failed: the failure is named, the coverage is unknown — and the board's row, once there, stands in.
    const h = await harness();
    await h.dispatch(open('fan-panel'));
    h.bg.failNext('feed.read', { code: 'CG-HUB-TIMEOUT' });
    h.hostEvent(routeTo('5001'));
    await h.flush();
    const failed = h.boards.fanPanel.getSnapshot(PANEL);
    expect(failed.view).toEqual({ s: 'partial', gaps: [{ kind: 'source-failed', source: 'feed', code: 'CG-HUB-TIMEOUT' }, { kind: 'coverage', level: 'unknown' }] });
    await h.dispatch(open('spenders'));
    const withRow = h.boards.fanPanel.getSnapshot(PANEL);
    expect(withRow.footer).toMatchObject({ archiveMessages: 11, stamp: { coverage: 'complete' } });
    expect(withRow.view).toEqual({ s: 'partial', gaps: [{ kind: 'source-failed', source: 'feed', code: 'CG-HUB-TIMEOUT' }] });
    // «Повторить» reads the archive again.
    await h.dispatch({ type: 'ReloadView', selector: PANEL });
    expect(h.boards.fanPanel.getSnapshot(PANEL).view).toEqual({ s: 'ready' });
  });

  it('[CS-035] the bio is the hub profile of the fan (`fan.dossier`); ChatSpace’s own «О себе» stands in only while the hub has none', async () => {
    const chatspace = { bio: 'Works shifts.', lists: ['VIP'], buyingPowerLabel: 'High', insights: [{ label: 'Tips', value: '8/10' }] };
    const fans = [{ ...hostMemory.fans[0]!, ...chatspace }, { ...hostMemory.fans[0]!, ...chatspace, chat: chatOf('5001'), username: 'fan_1', displayName: 'Fan 1' }];
    const h = await harness({ memory: { fans } });
    await h.dispatch(open('fan-panel'));
    // The open chat's fan has a profile in the hub: its body is the bio, whatever ChatSpace holds.
    expect(h.bg.requests.filter((r) => r.type === 'fan.dossier').map((r) => r.payload)).toEqual([{ pageId: PAGE.pageId, fanRef: WORLD.fan }]);
    const hub = h.boards.fanPanel.getSnapshot(PANEL);
    expect(hub).toMatchObject({ bio: '## Fan\nLikes short replies.', bioSource: 'hub' });
    // Lists and ChatSpace's own scores are its memory: decoration, shown when it holds them.
    expect(hub.lists).toEqual(['VIP']);
    expect(hub.host).toEqual({ buyingPower: 'High', scores: [{ label: 'Tips', value: '8/10' }] });
    // A fan the hub has no profile for: ChatSpace's «О себе», named as such.
    h.hostEvent(routeTo('5001'));
    await h.flush();
    const host = h.boards.fanPanel.getSnapshot(PANEL);
    expect(host).toMatchObject({ bio: 'Works shifts.', bioSource: 'host' });
    expect(host.view).toEqual({ s: 'ready' });
    // Nothing in the hub and nothing in ChatSpace's memory: no bio, and no source named.
    h.hostEvent(routeTo('5002'));
    await h.flush();
    const none = h.boards.fanPanel.getSnapshot(PANEL);
    expect(none.bio).toBeNull();
    expect('bioSource' in none).toBe(false);
    // The profile read fails: whether the hub has a bio is unknown — the gap is named, the stand-in is still marked as ChatSpace's.
    const failing = await harness({ memory: { fans } });
    failing.bg.failNext('fan.dossier', { code: 'CG-HUB-UNAVAILABLE' });
    await failing.dispatch(open('fan-panel'));
    const failed = failing.boards.fanPanel.getSnapshot(PANEL);
    expect(failed).toMatchObject({ bio: 'Works shifts.', bioSource: 'host' });
    expect(failed.view.s === 'partial' && failed.view.gaps).toContainEqual({ kind: 'source-failed', source: 'fan.dossier', code: 'CG-HUB-UNAVAILABLE' });
    await failing.dispatch({ type: 'ReloadView', selector: PANEL });
    expect(failing.boards.fanPanel.getSnapshot(PANEL)).toMatchObject({ bio: '## Fan\nLikes short replies.', bioSource: 'hub' });
  });

  it('[SP-042] [CS-036] a read of the page identity that merely failed: the panel says «нет связи» over the fan it showed, and shows nobody once the access is gone', async () => {
    const h = await harness();
    await h.dispatch(open('fan-panel'));
    h.hostEvent(routeTo('5001'));
    await h.flush();
    const loadedAt = h.clock.now();
    expect(h.boards.fanPanel.getSnapshot(PANEL).view).toEqual({ s: 'ready' });
    const reads = count(h, 'fan.card');
    await h.advance(5_000);
    // The background's port dropped while the context was read again.
    h.bg.failNext('bootstrap.get', { code: 'CG-RUNTIME-UNREACHABLE' });
    reread(h);
    await h.flush();
    const lost = h.boards.fanPanel.getSnapshot(PANEL);
    expect(lost.view).toMatchObject({ s: 'offline', error: { code: 'CG-RUNTIME-UNREACHABLE' }, retry: { type: 'ReloadView', selector: PANEL }, lastGoodAt: loadedAt });
    expect(lost.fan).toMatchObject({ name: 'Fan 1', username: 'fan_1' });
    expect(lost.spent?.total).toBe(3_717_000);
    expect(count(h, 'fan.card')).toBe(reads);
    // The next read answers: the same fan, nothing read twice.
    reread(h);
    await h.flush();
    expect(h.boards.fanPanel.getSnapshot(PANEL)).toMatchObject({ view: { s: 'ready' }, fan: { name: 'Fan 1' } });
    expect(count(h, 'fan.card')).toBe(reads);
    // The access itself is gone: nobody is shown.
    h.bg.failNext('bootstrap.get', { code: 'CG-AUTH-REVOKED' });
    reread(h);
    await h.flush();
    const revoked = h.boards.fanPanel.getSnapshot(PANEL);
    expect(revoked.view).toMatchObject({ s: 'forbidden', error: { code: 'CG-AUTH-REVOKED' } });
    expect(revoked).toMatchObject({ fan: null, spent: null, bio: null });
  });

  it('[CS-031] a chat of another OnlyMonster account is not this page’s fan: under this binding the panel shows nobody and reads nothing for it', async () => {
    const h = await harness();
    await h.dispatch(open('fan-panel'));
    const before = h.bg.requests.length;
    // ChatSpace shows a chat of another account while the bound account is still the one the context knows.
    h.hostEvent({ type: 'route', route: { epoch: 6, name: 'chat', account: hostAccount, chat: { host: 'chatspace', hostAccountId: '9999', platformFanId: '5001' } } });
    await h.flush();
    const vm = h.boards.fanPanel.getSnapshot(PANEL);
    expect(vm.view).toEqual({ s: 'empty', why: { key: 'fanPanel.empty.title' } });
    expect(vm).toMatchObject({ fan: null, spent: null, subscription: null, bio: null });
    expect(h.bg.requests.slice(before).filter((r) => r.type === 'fan.card' || r.type === 'fan.dossier' || r.type === 'feed.read')).toEqual([]);
  });

  it('[CS-037] a fan the hub has no money for still shows who they are, with the gap named; the switch off reads nothing', async () => {
    const h = await harness({ memory: { fans: [{ ...hostMemory.fans[0]!, buyingPowerLabel: 'High', insights: [{ label: 'Tips', value: '8/10' }] }] } });
    await h.dispatch(open('fan-panel'));
    const vm = h.boards.fanPanel.getSnapshot(PANEL);
    expect(vm.view.s).toBe('partial');
    expect(vm.view.s === 'partial' && vm.view.gaps).toContainEqual({ kind: 'source-failed', source: 'fan.card', code: expect.any(String) as unknown });
    expect(vm.fan).toMatchObject({ name: 'Fan Two', username: 'fan_two', online: true });
    expect(vm.fan?.lastSeenAt).not.toBeNull();
    expect(vm.spent).toBeNull();
    expect(vm.subscription).toBeNull();
    expect(vm.host).toEqual({ buyingPower: 'High', scores: [{ label: 'Tips', value: '8/10' }] });
    // The switch off: «forbidden», and no read.
    const off = await harness({ config: { pageFlags: { [PAGE.pageLabel]: { fanPanel: false } } } });
    await off.dispatch(open('fan-panel'));
    expect(off.boards.fanPanel.getSnapshot(PANEL).view).toMatchObject({ s: 'forbidden', error: { code: 'CG-FEATURE-DISABLED' } });
    expect(count(off, 'fan.card')).toBe(0);
    expect(count(off, 'fan.dossier')).toBe(0);
    expect(count(off, 'feed.read')).toBe(0);
  });
});

describe('the router contract of the controllers', () => {
  it('each controller names its views, answers null for an action that is not its own, and stops on dispose', async () => {
    const h = await harness();
    expect(h.boards.controllers.map((controller) => controller.kinds)).toEqual([['preview'], ['spenders.board', 'spenders.stats'], ['newcomers'], ['fan-panel']]);
    const foreign: UiAction[] = [
      { type: 'InsertPart', operationId: uuid(1), part: 0 },
      { type: 'SignOut' },
      { type: 'Navigate', to: { kind: 'surface', surface: 'coach', open: true } },
      { type: 'Navigate', to: { kind: 'chat', targetHandle: 'dock:f2002' } },
      { type: 'Generate', targetHandle: 'dock:f2002', feature: 'reply', options: {} },
      { type: 'Search', list: 'palette', query: 'x' },
      { type: 'ReloadView', selector: { of: 'dock' } },
      { type: 'Copy', artifactHandle: 'recap:1' },
    ];
    for (const action of foreign) for (const controller of h.boards.controllers) expect(controller.dispatch(action)).toBeNull();
    await h.dispatch(open('newcomers'));
    h.boards.dispose();
    const reads = h.bg.requests.length;
    await h.advance(300_000);
    expect(h.bg.requests).toHaveLength(reads);
  });
});
