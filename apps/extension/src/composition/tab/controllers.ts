// The controllers of the tab, family by family, as they are loaded and
// plugged into the AppClient router (architecture.md §10.2, §11):
//
// - with the dock: the AI workspace and the dock's controller (R11), the
//   keys and navigation (R17) and the shell (toasts, the tab's own actions);
// - right after it: Recap and Coach (Review is a turn of Coach) over the same workspace;
// - with the first board surface: Spenders, «Новые», the fan panel and the
//   preview (R12) — the same wiring as R12's `createBoardsControllers`, cut
//   in two chunks, because one would not fit the 30 KiB of a lazy chunk.
//
// What a composition root has to say and no package can: who answers for an
// action two families could take, and how the three «what is open» states —
// R17's overlays, R12's surfaces, R11's Coach switch — become one.

import type { Tone } from '@cg/contracts/features';
import { CG_REGISTRY } from '@cg/contracts/errors/registry';
import type { CgCode } from '@cg/contracts/errors';
import type { FeatureSlice } from '@cg/contracts/features/types';
import { FAN_QUEUES_CAPABILITY, ONLINE_CAPABILITY, type ChatRef } from '@cg/contracts/ids';
import { OP_TIMEOUTS } from '@cg/contracts/limits';
import type { AiHostPolicy, OpState } from '@cg/contracts/ops';
import type { SendAttemptView } from '@cg/contracts/send';
import type { HostPort, NavigationReceipt } from '@cg/contracts/host';
import type { ActionCatalog, ActionReceipt, AppClient, ClipboardPort, DockVM, FanPanelVM, I18n, PreviewSource, TargetHandle, ToastPort, UiAction } from '@cg/contracts/vm';
import type { AppRouter } from '@cg/core/application';
import type { GreetHereState, GreetedChat } from '@cg/core/application/newcomers';
import type { GreetRun } from '@cg/core/application/shell';
import type { HotkeySink } from '@cg/core/application/hotkeys';
import { toastKindOf } from '@cg/core/domain/errors';
import type { OnlineSiteSource } from '@cg/core/application/online/source';
import type { Logger } from '@cg/core/domain/logging';

import type * as AiChunk from '../../../lazy/entries/ai';
import type * as AnalysisChunk from '../../../lazy/entries/ai-analysis';
import type * as CoachChunk from '../../../lazy/entries/ai-coach';
import type * as BoardsChunk from '../../../lazy/entries/boards';
import type * as PreviewChunk from '../../../lazy/entries/boards-preview';
import type * as NavigationChunk from '../../../lazy/entries/navigation';
import type { GestureGate } from './action-gate';
import { adopt, chatOnScreen, type ControllerRpc, type LooseController } from './client';
import { boardsHostOver, type HostFacts } from './host-facts';
import type { PinState } from './surfaces';
import type { TabKeys } from './keys';

/** Timers and time as every controller family takes them (numbers as handles). */
export interface TabClock {
  now(): number;
  setTimer(ms: number, fn: () => void): number;
  clearTimer(handle: unknown): void;
}

/** `newcomers.drafts` of storage.local (R12's DraftStorePort); the early bundle owns the browser API. */
export interface DraftStore {
  load(): Promise<unknown>;
  save(value: unknown): Promise<void>;
  onChanged(listener: (value: unknown) => void): () => void;
}

/** What every family gets from the application. */
export interface TabWorld {
  readonly registrationOf?: (fanId: string, i18n: I18n) => FanPanelVM['registration'];
  /** 1.20.0: the site's own fan panel stands next to the chat (the adapter's `fanPanelBesideHost`). */
  readonly fanPanelBesideHost?: true;
  readonly win: Window;
  /** The background's client with `token.issue` behind the gate (client.ts). */
  readonly rpc: ControllerRpc;
  readonly host: HostPort;
  /** The site's slice of the feature manifest (the adapter's `features`). */
  readonly features: FeatureSlice;
  /** The site's Reply tones (the adapter's `tones`); absent — every tone. */
  readonly tones?: readonly Tone[];
  /** The dock only on a bound account (the adapter's `dockOnlyWhenBound`). */
  readonly dockOnlyWhenBound?: true;
  /** The site's AI policy (the adapter's `ai`, R20 F10). */
  readonly aiPolicy: AiHostPolicy;
  readonly i18n: I18n;
  readonly clock: TabClock;
  readonly ids: { uuid(): string };
  /** The manifest's version of this build. */
  readonly extensionVersion: string;
  readonly router: AppRouter;
  /** The AppClient the surfaces use: the router behind the gate's grants. */
  readonly client: AppClient;
  readonly toasts: ToastPort;
  readonly clipboard: ClipboardPort;
  readonly keys: TabKeys;
  readonly gate: GestureGate;
  readonly logger: Logger;
  readonly drafts: DraftStore | null;
  /** 1.47.0: «Скачать MP3» of a voice take — a Blob saved inside our own closed root. */
  readonly files: AiChunk.FileSaver;
  /** What stands over the page without being a window: «Рассылка» folded into its chip. Absent — nothing. */
  readonly pins?: PinState;
  /**
   * 1.65.0: the site's own word of who is online, told to the hub before its list is read (Fansly's followers; since
   * 2026-10-31 ChatSpace's own); absent — the hub knows by itself.
   */
  readonly online?: OnlineSiteSource;
}

const done = (type: UiAction['type'], outcome: Extract<ActionReceipt, { ok: true }>['outcome'] = 'done'): ActionReceipt => ({ ok: true, type, outcome });

// ── AI: the workspace, the dock, and — later — Recap, Coach ─────────────────

export interface TabAi {
  readonly workspace: AiChunk.AiWorkspace;
  /** Plugs a controller built over the workspace into the router. */
  plug(controller: AiChunk.AiController): void;
  /** The Recap controller, once its chunk is in (tab/recap-tab.ts reads it for the fan panel's Recap tab). */
  recap: AnalysisChunk.RecapController | null;
  /** «Очереди N» of the dock: the open chat's page's queues as last read (the palette's group «Очереди» reads it too). */
  readonly queues: AiChunk.QueuesCount;
  dispose(): void;
}

export function startAi(world: TabWorld, chunk: typeof AiChunk, catalog: ActionCatalog): TabAi {
  const { router, keys, gate, logger } = world;
  // «Онлайн N» on the dock's chip: the open chat's page, read every minute while the tab is on screen.
  const late: { workspace: AiChunk.AiWorkspace | null } = { workspace: null };
  const online = chunk.createOnlineCount({
    clock: world.clock,
    visible: () => world.win.document.visibilityState === 'visible',
    page: () => {
      const ready = late.workspace?.situation().ready ?? null;
      if (ready === null || world.features['online'] === undefined || !ready.bootstrap.capabilities.includes(ONLINE_CAPABILITY)) return null;
      return { pageId: ready.target.binding.pageId, account: ready.target.binding.platformAccountId };
    },
    async read(page: { readonly pageId: number; readonly account: string }, minutes: number) {
      await world.online?.seen(page.pageId, page.account).catch(() => undefined);
      const answer = await world.rpc.request('online.list', { pageId: page.pageId, minutes });
      return answer.ok ? answer.payload : null;
    },
  });
  // «Очереди N» on the dock's chip (2026-10-29): the open chat's page's queues with work today, or who answered («2 ↩»).
  const queues = chunk.createQueuesCount({
    clock: world.clock,
    visible: () => world.win.document.visibilityState === 'visible',
    page: () => {
      const ready = late.workspace?.situation().ready ?? null;
      if (ready === null || world.features['queues'] === undefined || !ready.bootstrap.capabilities.includes(FAN_QUEUES_CAPABILITY)) return null;
      return { pageId: ready.target.binding.pageId };
    },
    async read(page: { readonly pageId: number }) {
      const answer = await world.rpc.request('queues.list', { pageId: page.pageId });
      return answer.ok ? answer.payload : null;
    },
  });
  const ports: AiChunk.AiPorts = {
    rpc: world.rpc,
    host: world.host,
    i18n: world.i18n,
    clock: world.clock,
    ids: world.ids,
    catalog,
    features: world.features,
    ...(world.tones === undefined ? {} : { tones: world.tones }),
    ...(world.dockOnlyWhenBound === true ? { dockOnlyWhenBound: true as const } : {}),
    policy: world.aiPolicy,
    clipboard: world.clipboard,
    toasts: world.toasts,
    files: world.files,
    extensionVersion: world.extensionVersion,
    // Route and insert journal lines (LG-017): ids, lengths and fingerprints, never a text.
    journal: { write: (entry) => void logger.write(entry.level, entry.scope, entry.msg, { ...(entry.code === undefined ? {} : { code: entry.code }), ...(entry.fields === undefined ? {} : { fields: entry.fields }), ...(entry.ctx === undefined ? {} : { ctx: entry.ctx }) }) },
    // R11 opens and closes Coach through this switch; what is open is R17's one state.
    overlays: { open: (surface) => keys.overlays.set(surface, true), close: (surface) => keys.overlays.set(surface, false), isOpen: (surface) => keys.overlays.isOpen(surface) },
    online,
    queues,
  };
  const workspace = new chunk.AiWorkspace(ports);
  late.workspace = workspace;
  const controllers: AiChunk.AiController[] = [];
  const offs: (() => void)[] = [];
  /**
   * A target the AI controllers did not name is not theirs: the dock's own
   * handler answers a handle it does not know with «чат сменился», which
   * would take a preview's Reply away from the preview controller (R12).
   */
  const foreign = (action: UiAction): boolean => 'targetHandle' in action && chunk.readTargetHandle(action.targetHandle)?.surface !== 'dock';
  const plug = (controller: AiChunk.AiController): void => {
    controllers.push(controller);
    // The kind of the human action in flight — a click or a key — is the cause of what it starts (HumanCause).
    offs.push(router.register(adopt(controller, (action) => (foreign(action) ? null : controller.handle(action, gate.cause())))));
  };
  plug(chunk.createDockController(workspace));
  workspace.start();
  return {
    workspace,
    plug,
    recap: null,
    queues,
    dispose() {
      for (const off of offs.splice(0)) off();
      for (const controller of controllers.splice(0)) controller.dispose();
      online.dispose();
      queues.dispose();
      workspace.dispose();
    },
  };
}

export function startAnalysis(ai: TabAi, analysis: typeof AnalysisChunk, coach: typeof CoachChunk): void {
  ai.recap = analysis.createRecapController(ai.workspace);
  ai.plug(ai.recap);
  ai.plug(analysis.createVoiceController(ai.workspace));
  ai.plug(coach.createCoachController(ai.workspace));
}

// ── keys and navigation ──────────────────────────────────────────────────────

export interface TabNavigation {
  readonly navigation: NavigationChunk.NavigationController;
  /** Chat Memory week 1: «в разговоре» of every fan the tab names (the `talking` view; the preview's X8 warning). */
  readonly talking: NavigationChunk.TalkingController;
  /** Where the early dispatcher's commands go; connected once every controller a key may need is in. */
  readonly sink: HotkeySink;
  dispose(): void;
}

/** What the navigation family opens through the other families (the composition root binds them late). */
export interface NavigationOpeners {
  coach(): Promise<ActionReceipt>;
  /** The palette's «Онлайн» choice: OUR preview of the fan in its own window (the boards' `openOnline`, X24). */
  preview(chat: ChatRef, shown: readonly ChatRef[]): Promise<ActionReceipt>;
  /** 2026-10-26: a chat of the palette on a site without our navigation, the way its board opens a fan's (the boards' `openChat`). */
  chat(chat: ChatRef, conversationRef: string | undefined): Promise<NavigationReceipt>;
}

export function startNavigation(world: TabWorld, chunk: typeof NavigationChunk, catalog: ActionCatalog, ai: TabAi, open: NavigationOpeners): TabNavigation {
  const { router, keys, gate, client, host, i18n, clock, toasts, logger } = world;
  const overlays = keys.overlays;
  const offs: (() => void)[] = [];

  const navigation = chunk.createNavigationController({
    host,
    rpc: world.rpc,
    i18n,
    ids: world.ids,
    clock,
    overlays,
    toasts,
    // The key or the click itself says what it is: the gate reads the event in flight.
    cause: { mark: () => undefined, take: () => gate.cause() },
    // The owner's `navigation` switch of the page the account is bound to (its own feature; an account bound to
    // no hub page — the owner's `"*"` value). Unknown while nobody is signed in: ChatSpace's own list needs no hub.
    ownerSwitch: (hostAccountId) => ai.workspace.accountFlag(hostAccountId, 'navigation'),
    // What the site has (R20 §1.4): a window or a walk of a feature its slice lacks opens nothing.
    features: world.features,
    // A site without our navigation (its slice says so): the palette's chats open as its board opens a fan's.
    board: (chat, conversationRef) => open.chat(chat, conversationRef),
  });
  const dockView = (): DockVM | null => (router.serves('dock') ? router.getSnapshot({ of: 'dock' }) : null);
  const palette = chunk.createPaletteController({
    host,
    rpc: world.rpc,
    i18n,
    catalog,
    clock,
    overlays,
    dock: { get: dockView, subscribe: (listener) => router.subscribe({ of: 'dock' }, () => listener()) },
    // «Онлайн» (CS-030): a fan ChatSpace shows online opens in our preview window; no chat is opened (X24).
    preview: { open: (chat, shown) => open.preview(chat, shown) },
    // Its «Новые» are the hub's only where the site's slice says so.
    features: world.features,
    // «Очереди» (2026-10-29): the page's queues as the dock's chip last read them.
    queues: ai.queues,
  });
  const quickJump = chunk.createQuickJumpController({ host, i18n, overlays, clock });
  const cheatsheet = chunk.createCheatsheetController({ catalog, features: world.features });
  const talking = chunk.createTalkingController({ rpc: world.rpc });
  offs.push(() => talking.dispose());

  /**
   * What no package answers for, because it lies between two of them:
   * - «Перейти» of a generation that runs in another chat (R11) names the
   *   chat by the dock's own handle; ChatSpace's router is R17's;
   * - the strip and the key open Coach with `Navigate` (R14, R17), R11 opens
   *   it on a Coach `Generate` without a question — and closes it itself.
   */
  const bridges: LooseController = {
    kinds: [],
    getSnapshot: () => undefined,
    subscribe: () => () => undefined,
    dispatch(action) {
      if (action.type !== 'Navigate') return null;
      const to = action.to;
      if (to.kind === 'surface' && to.surface === 'coach') {
        if (to.open) return open.coach();
        const was = overlays.isOpen('coach');
        overlays.set('coach', false);
        return Promise.resolve(done(action.type, was ? 'done' : 'noop'));
      }
      return null;
    },
  };
  for (const controller of [navigation, palette, quickJump, cheatsheet, talking, bridges] as LooseController[]) offs.push(router.register(adopt(controller)));

  const runner = chunk.createHotkeyRunner({
    client,
    catalog,
    i18n,
    toasts,
    overlays,
    onDockSheet(sheet) {
      keys.state.setDockSheet(sheet);
      keys.dockSheet(sheet);
    },
    // X58: ⌘↵ / Ctrl+Enter is ours only while a Fix waits in the open chat.
    onFix: (fix) => keys.state.setFix(fix),
    // ⌘. stops what runs in the open chat when no sheet shows it: a Fix of the person's click has none (X68).
    runningHere: () => {
      const chat = ai.workspace.situation().chat;
      return chat === null ? null : (ai.workspace.running(chat.key)?.view.opId ?? null);
    },
  });
  keys.notices.attach({ toasts, refuse: (command, refusal) => runner.refuse(command, refusal) });

  /** A command reads views of controllers that may not be in: a failure there is said, never thrown into the key handler. */
  const guarded = (what: string, run: () => void): void => {
    try {
      run();
    } catch (error) {
      logger.error('tab.keys', 'a key command failed', { code: 'CG-UI-FAILED', fields: { what, name: error instanceof Error ? error.name : typeof error } });
      toasts.show({ kind: 'error', code: 'CG-UI-FAILED', scope: 'hotkey', title: { key: CG_REGISTRY['CG-UI-FAILED'].title }, body: { key: CG_REGISTRY['CG-UI-FAILED'].body } });
    }
  };
  const sink: HotkeySink = {
    run(command) {
      // A key the dispatcher kept (HK-024, HK-025) runs after its keydown is over: the gate takes it back for this step.
      const kept = keys.takeKept();
      const release = kept === null ? null : gate.resume(kept.event, kept.at);
      guarded(command.id, () => runner.run(command));
      release?.();
    },
    refuse: (command, refusal) => guarded(command, () => runner.refuse(command, refusal)),
    quickJump: (isOpen) => guarded('quick-jump', () => runner.quickJump(isOpen)),
    ready: (command) => runner.ready?.(command) !== false,
    onReady: (listener) => runner.onReady?.(listener) ?? (() => undefined),
  };

  return {
    navigation,
    talking,
    sink,
    dispose() {
      keys.dispatcher.disconnect();
      runner.dispose();
      quickJump.dispose();
      for (const off of offs.splice(0)) off();
    },
  };
}

/** `Navigate` to a chat named by the dock's handle (`runningElsewhere[].go`, the refusal's «Перейти»). */
export function dockChatBridge(ai: typeof AiChunk, navigation: NavigationChunk.NavigationController, gate: GestureGate): LooseController {
  return {
    kinds: [],
    getSnapshot: () => undefined,
    subscribe: () => () => undefined,
    dispatch(action) {
      if (action.type !== 'Navigate' || action.to.kind !== 'chat') return null;
      const target = ai.readTargetHandle(action.to.targetHandle);
      return target === null || target.surface !== 'dock' ? null : navigation.open({ hostAccountId: target.chat.hostAccountId, platformFanId: target.chat.platformFanId }, gate.cause());
    },
  };
}

// ── boards: Spenders, «Новые», the fan panel, the preview ───────────────────

export interface TabBoards {
  /** The palette's «Онлайн» choice: OUR preview of the fan in its own window, walking the list the palette showed (X24). */
  openOnline(chat: ChatRef, shown: readonly ChatRef[]): Promise<ActionReceipt>;
  /**
   * 2026-10-26: a chat the person chose in the palette on a site without our navigation (Fansly): opened as the Spenders
   * board opens its fan's — the page's `spenders`, the board's token (decision X13) — with the chat the palette's row
   * named, never a search of the site's inbox (and so never a new group of Fansly's).
   */
  openChat(chat: ChatRef, conversationRef: string | undefined): Promise<NavigationReceipt>;
  /** A list's batch started this generation: its row says how it ended, a toast does not. */
  fromBatch(opId: string): boolean;
  /** The open «Новые» card (a pass's) shows this generation's result in its field. */
  inCard(opId: string): boolean;
  /** 2026-10-29: what «Hi» of a reminder's toast wrote for the fan of this handle, as the toast shows it; null — nothing. */
  greetHere(handle: TargetHandle): GreetHereState | null;
  /** A greeting `greetHere` tells of changed. */
  onGreetHere(listener: () => void): () => void;
  /** 2026-10-31: how the old-way «Hi» of a reminder's fan goes in this tab (the card of a handed-over Hi reads it); null — not run here. */
  greetRun(handle: TargetHandle): GreetRun | null;
  /** A run `greetRun` tells of changed. */
  onGreetRun(listener: () => void): () => void;
  dispose(): void;
}

/**
 * Where a board's result goes on once «Открыть и вставить» has opened its chat (architecture.md §6.5): the dock
 * of that chat. The boards and the AI workspace live in different chunks and know nothing of each other; this
 * is the one place they meet.
 */
export interface BoardsDock {
  /** The preview's word about the parts of the results the dock shows; null — the boards are gone. */
  bind(results: PreviewChunk.BoardResults | null): void;
  /** The chat is open: the dock takes the result (and asks the Б2 question when the composer holds the person's text). */
  handover(handover: PreviewChunk.BoardHandover): void;
  /** Chat Memory week 1: «в разговоре» of the tab (the navigation family's): the preview's X8 warning reads it. */
  readonly talking?: NavigationChunk.TalkingController;
  /**
   * 2026-10-26: a greeting reminder's «Hi» goes on in the fan's chat it opened. The dock's handle of `chat` once its dock
   * can start a generation there; null — not within `ms`.
   */
  readyFor(chat: ChatRef, ms: number): Promise<TargetHandle | null>;
  /** The fan's name as the dock shows it now, while `chat` is the open one; null — another chat, or no name. */
  fanName(chat: ChatRef): string | null;
  /** How the dock's operation ended within `ms`: its terminal state; null — still running, or unknown here. */
  ended(opId: string, ms: number): Promise<Exclude<OpState, 'admitted' | 'requesting' | 'streaming'> | null>;
}

/** The overlays R12's `Surfaces` opens and closes, mirrored into R17's one state. */
const PREVIEW_SOURCES: readonly PreviewSource[] = ['spenders', 'newcomers', 'palette', 'outreach', 'online', 'queue'];
/** A greeting reminder's «Hi» (2026-10-26): the fan's chat it opened becomes the dock's within this long, or Hi is the person's. */
export const GREET_CHAT_READY_MS = 15_000;
/** …and its greeting is written within this long, or it stays in the dock for the person to put in. */
const GREET_RESULT_WAIT_MS = OP_TIMEOUTS.hi.maxMs + 15_000;
/** The old-way «Hi» runs a tab remembers for the cards of handed-over ones (2026-10-31). */
const GREET_RUNS_KEPT = 20;

/** An old-way «Hi» as it goes: how it ends, the fan's name and chat once known. */
interface GreetRunNow {
  s: GreetRun['s'];
  name: string | null;
  chat: ChatRef | null;
}

/**
 * Resolves once the boards know whose they are. They are made with the first
 * action that opens one, and the action waits for this: the page context
 * reads the sign-in, the bootstrap and the binding first — a board opened
 * before that would be closed by its own «another identity» rule (SP-042) the
 * moment the first read lands — and the preview reads its local drafts.
 */
export async function startBoards(
  world: TabWorld,
  chunk: typeof BoardsChunk,
  previewChunk: typeof PreviewChunk,
  inserts: Pick<HostFacts, 'noteInsert' | 'forgetInsert'>,
  dock: BoardsDock,
): Promise<TabBoards> {
  const { router, keys, host, i18n, clock, ids, win, toasts } = world;
  const rpc = world.rpc;
  const overlays = keys.overlays;

  // A part of a board goes into the composer through the host port as it is; the tab only remembers which insert
  // belongs to which part — before the insert starts — so a human send of that draft is reported for its
  // operation (§6.6; host-facts.ts).
  const boardsHost = boardsHostOver(host, inserts);

  const context = chunk.createPageContext({ rpc, host: boardsHost });
  const surfaces = new chunk.Surfaces();
  const navigator = chunk.createChatNavigator({ rpc, host: boardsHost, ids, context });
  let timeZone = 'UTC';
  try {
    timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    // The statistics' calendar falls back to UTC.
  }

  const spenders = chunk.createSpendersController({ rpc, host: boardsHost, i18n, clock, context, surfaces, navigator, timeZone });
  // The preview keeps the drafts and «Новые» shows whether a fan has one: the two meet through this late binding.
  const late: { preview: ReturnType<typeof previewChunk.createPreviewController> | null } = { preview: null };
  const onlineListeners = new Set<(online: boolean) => void>();
  const onOnline = (): void => onlineListeners.forEach((listener) => listener(win.navigator.onLine));
  win.addEventListener('online', onOnline);
  win.addEventListener('offline', onOnline);
  const newcomers = chunk.createNewcomersController({
    rpc,
    host: boardsHost,
    i18n,
    clock,
    context,
    surfaces,
    navigator,
    connectivity: {
      online: () => win.navigator.onLine,
      subscribe(listener) {
        onlineListeners.add(listener);
        return () => {
          onlineListeners.delete(listener);
        };
      },
    },
    random: Math.random,
    draftOf: (pageId, fanRef) => late.preview?.draftOf('newcomers', pageId, fanRef) ?? null,
  });
  // «Рассылка»: its own window over the Spenders board's fans; each site sends its versions its own way (the chunk says how).
  const outreach = chunk.createOutreachController({ rpc, host: boardsHost, i18n, clock, context, surfaces, board: spenders.outreachBoard });
  const rowOf = (pageId: number, fanRef: string) => spenders.row(pageId, fanRef);
  const rowsChanged = (listener: () => void): (() => void) => spenders.directory.subscribe(listener);
  const palette = chunk.createPaletteDirectory({ host: boardsHost, context, rowOf, rowsChanged });
  // «Онлайн»: the hub's list of who came online; the site's own dots (ChatSpace's loaded chats) say «в сети» (the chunk
  // says how each site reads who is active and sends).
  const online = chunk.createOnlineController({
    rpc,
    host: boardsHost,
    i18n,
    clock,
    context,
    surfaces,
    navigator,
    live: { online: () => new Set(palette.online().map((fan) => fan.fanRef)), subscribe: (listener) => palette.subscribe(listener) },
    visible: () => win.document.visibilityState === 'visible',
    openChat: () => boardsHost.current().route.chat?.platformFanId ?? null,
    ...(world.online === undefined ? {} : { source: world.online }),
  });
  // «Очереди»: the person's fan queues of the page (the hub's), a portion at a time; the chunk says how each site sends.
  const queues = chunk.createQueuesController({
    rpc,
    host: boardsHost,
    i18n,
    clock,
    context,
    surfaces,
    navigator,
    visible: () => win.document.visibilityState === 'visible',
    openChat: () => boardsHost.current().route.chat?.platformFanId ?? null,
  });

  // X8: one click — one attempt. The driver asks MAIN, then the background, then MAIN's queue; every state goes on.
  const sendListeners = new Set<(view: SendAttemptView) => void>();
  const driver = new previewChunk.PreviewSendDriver({
    // null while the capability is off: read at each click, it follows the bootstrap and the receipt profile.
    get port() {
      return host.previewSend;
    },
    background: {
      async begin(begin) {
        const answer = await rpc.request('send.begin', begin);
        if (answer.ok) return answer.payload.ok ? { ok: true, ticket: answer.payload.ticket } : { ok: false, view: answer.payload.view };
        return { ok: false, view: { attemptId: begin.attemptId, state: 'held', code: answer.error.code } };
      },
      async report(view, pendingId) {
        await rpc.request('send.report', pendingId === undefined ? { view } : { view, pendingId });
      },
    },
    ids,
    onView: (view) => sendListeners.forEach((listener) => listener(view)),
    clock,
  });

  const preview = previewChunk.createPreviewController({
    rpc,
    host: boardsHost,
    i18n,
    clock,
    ids,
    context,
    surfaces,
    navigator,
    directories: { spenders: spenders.directory, newcomers: newcomers.directory, palette, outreach: outreach.directory, online: online.directory, queue: queues.directory },
    greeting: newcomers.greeting,
    sender: {
      send: (click) => driver.send(click),
      onView(listener) {
        sendListeners.add(listener);
        return () => {
          sendListeners.delete(listener);
        };
      },
    },
    drafts: world.drafts,
    clipboard: { writeText: (text) => world.clipboard.writeText(text).then((result) => result.ok) },
    // A message from a surface that has just closed («Вставка отменена», «Чат не готов…»).
    notifier: { notify: (code: CgCode, scope: string) => void toasts.show({ kind: toastKindOf(code), code, scope, title: { key: CG_REGISTRY[code].title }, body: { key: CG_REGISTRY[code].body } }) },
    handover: (handover) => dock.handover(handover),
    ...(dock.talking === undefined ? {} : { talking: dock.talking }),
    // The hub's key of the person's own text (a manual group): sha256 of its UTF-8 bytes, lower-case hex.
    sha256: async (text) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
  });
  late.preview = preview;
  // 1.32.0: a batch of a list starts its generations through the preview's own Generate.
  spenders.attachBatch(preview);
  newcomers.attachBatch?.(preview);
  outreach.attachBatch(preview);
  online.attachBatch(preview);
  queues.attachBatch(preview);
  dock.bind(preview.results);
  const offDrafts = preview.onDrafts(() => newcomers.draftsChanged());
  const fanPanel = chunk.createFanPanelController({ rpc, host: boardsHost, i18n, clock, context, surfaces, rowOf, rowsChanged, ...(world.registrationOf === undefined ? {} : { registrationOf: world.registrationOf }), ...(world.fanPanelBesideHost === true ? { besideHostPanel: true } : {}) });

  // R12's order: the preview first — it answers for the parts of its own results.
  const controllers = [preview, spenders, newcomers, fanPanel, outreach, online, queues];
  const offs = controllers.map((controller) => router.register(adopt(controller as unknown as LooseController)));

  /**
   * «Hi» of a greeting reminder's toast (2026-10-24; 2026-10-25, the owner: «по hi нажимая начиналась генерация сообщения
   * сразу и в чате уже оказалось оно»). 2026-10-26 (the owner: «жму, он чето грузит, открывает всех, прогружает, потом
   * генерирует — это неудобно и долго»): no window and no list any more — the fan's chat opens at once, the dock's own Hi
   * writes one greeting there, and it goes into the site's field for the person's own send. Each step rides the click's
   * deferred greet grant (action-gate.ts, `afterGreet`): the navigation, the generation, the insert — never a send.
   * A fan of another model goes to a tab of that model (`greetElsewhere`). A fan somebody wrote to meanwhile (the owner:
   * «если один нажал на hi и там месага уже есть — ошибка "кто-то уже поприветствовал его" и чат открылся») gets no
   * greeting in the field: the toast says «Кто-то уже поприветствовал …», the chat is open already. A person who went
   * on to another chat meanwhile keeps the greeting in the dock of the fan's chat.
   */
  /** 2026-10-31: the old-way «Hi» of each reminder's fan in this tab, as it goes — what the card of a handed-over Hi says. */
  const runs = new Map<string, GreetRun>();
  const runListeners = new Set<() => void>();
  const ran = (handle: string, run: GreetRun): void => {
    runs.delete(handle);
    runs.set(handle, run);
    for (const old of runs.keys()) {
      if (runs.size <= GREET_RUNS_KEPT) break;
      runs.delete(old);
    }
    for (const listener of [...runListeners]) listener();
  };

  async function greet(handle: string): Promise<ActionReceipt> {
    // How it ended, for the card: put in, somebody greeted the fan, or nothing to say (stopped, or the person's now).
    const run: GreetRunNow = { s: 'idle', name: null, chat: null };
    ran(handle, { s: 'writing', name: null });
    try {
      return await greetSteps(handle, run);
    } finally {
      // The dock knows the fan's name once Fansly drew the chat's header.
      ran(handle, { s: run.s, name: run.name ?? (run.chat === null ? null : dock.fanName(run.chat)) });
    }
  }

  async function greetSteps(handle: string, run: GreetRunNow): Promise<ActionReceipt> {
    const as = (receipt: ActionReceipt): ActionReceipt => ({ ...receipt, type: 'GreetNewcomer' });
    // Said by a toast of its own: the reminder's toast is gone with the click.
    const failed = (code: CgCode): ActionReceipt => {
      notify(code, 'greet.open');
      return { ok: true, type: 'GreetNewcomer', outcome: 'noop' };
    };
    const away = (await newcomers.greetElsewhere?.(handle, () => void world.gate.afterGreet('Navigate'))) ?? null;
    if (away !== null) {
      if (!away) toasts.show({ kind: 'warning', code: null, scope: 'greet.handover', title: { key: 'toast.greetNoTab' }, body: { key: 'toast.greetNoTabBody' } });
      return { ok: true, type: 'GreetNewcomer', outcome: away ? 'opened' : 'noop' };
    }
    const target = (await newcomers.greetChat?.(handle)) ?? null;
    // No way to the fan's chat now (Fansly could not find or make it): «Новые» open, the fan is there for the person.
    if (target === null) return as(await router.dispatch({ type: 'Navigate', to: { kind: 'surface', surface: 'newcomers', open: true } }));
    run.name = target.name;
    run.chat = target.chat;
    ran(handle, { s: 'writing', name: run.name });
    surfaces.setList('newcomers', false);
    world.gate.afterGreet('Navigate');
    const opened = await navigator.open(target.chat, 'newcomers', ['newcomers'], target.conversationRef ?? undefined);
    if (opened.state !== 'navigated') return failed(opened.code);
    const dockHandle = await dock.readyFor(target.chat, GREET_CHAT_READY_MS);
    // The chat did not become the dock's in time (the person went on, the page is slow): the chat is open, Hi is theirs.
    if (dockHandle === null) return { ok: true, type: 'GreetNewcomer', outcome: 'opened' };
    run.name ??= dock.fanName(target.chat);
    world.gate.afterGreet('Generate');
    const started = await router.dispatch({ type: 'Generate', targetHandle: dockHandle, feature: 'hi', options: { variants: 1 } });
    // A refused start is the dock's to show (its sheet says why); a Hi already running there is the person's own.
    const opId = started.ok && started.outcome === 'started' ? started.opId : undefined;
    if (opId === undefined) return as(started);
    // Whether somebody wrote to the fan is asked while Hi writes: a «yes» stops it at once.
    const early = (newcomers.greetedNow?.(handle, target) ?? Promise.resolve(null)).catch(() => null);
    const first = await Promise.race([dock.ended(opId, GREET_RESULT_WAIT_MS), early.then((found) => found ?? new Promise<never>(() => undefined))]);
    if (first !== null && typeof first === 'object') {
      run.s = 'greeted';
      return greetedAlready(first, opId);
    }
    if (first !== 'done') return as(started);
    // Asked again once it is written: the page has loaded the chat by now (Fansly), a colleague may have just written.
    const greeted = (await early) ?? (await newcomers.greetedNow?.(handle, target).catch(() => null)) ?? null;
    if (greeted !== null) {
      run.s = 'greeted';
      return greetedAlready(greeted, opId);
    }
    if (!chatOnScreen(host.current().route, target.chat) || world.gate.afterGreet('InsertPart') !== null) return as(started);
    const inserted = await router.dispatch({ type: 'InsertPart', operationId: opId, variant: 0, part: 0 });
    // Б2 («в поле уже есть ваш текст») asks first: the greeting is not in the field until the person answers.
    if (inserted.ok && inserted.outcome === 'done') run.s = 'inserted';
    return as(inserted);
  }

  /**
   * 2026-10-29 (the owner chose «Hi прямо в напоминании»): «Hi» of a reminder's toast writes the fan's greeting without
   * leaving the chat the person is in; the toast shows it with «Отправить», «Ещё вариант» and «Открыть чат» (the boards'
   * `greetHere`). A fan of another model's tab, a fan whose chat is the open one, or a list that cannot write it so go
   * the old way (`GreetNewcomer` without `here`: its toast closes, the chat opens with the greeting in its field). Its
   * generation rides the click's deferred greet grant (`afterGreet`), opened right before its token is asked for.
   */
  async function hiHere(handle: string, again: boolean): Promise<ActionReceipt> {
    const as = (receipt: ActionReceipt): ActionReceipt => ({ ...receipt, type: 'GreetNewcomer' });
    const fan = chunk.parseFanHandle(handle);
    const binding = context.current().binding;
    const ownFan = fan !== null && fan.source === 'newcomers' && binding !== null && fan.pageId === binding.pageId;
    const onScreen = ownFan && chatOnScreen(host.current().route, { hostAccountId: binding.hostAccountId, platformFanId: fan.fanRef });
    if (!ownFan || onScreen || newcomers.greetHere === undefined) return as(await router.dispatch({ type: 'GreetNewcomer', targetHandle: handle }));
    return as(await newcomers.greetHere(handle, again, () => void world.gate.afterGreet('Generate')));
  }

  function notify(code: CgCode, scope: string): void {
    void toasts.show({ kind: toastKindOf(code), code, scope, title: { key: CG_REGISTRY[code].title }, body: { key: CG_REGISTRY[code].body } });
  }

  /**
   * Somebody wrote to the reminder's fan already: the Hi stops and its sheet goes — nothing to put into the field —, the
   * chat is open with what they were sent, and the toast says why.
   */
  async function greetedAlready(greeted: GreetedChat, opId: string): Promise<ActionReceipt> {
    await router.dispatch({ type: 'CancelGeneration', operationId: opId });
    await router.dispatch({ type: 'HideResult', operationId: opId });
    toasts.show({
      kind: 'warning',
      code: null,
      scope: `greet.${greeted.chat.platformFanId}`,
      // The dock's name of the fan, read now: the site draws its header a moment after the chat opens.
      title: { key: 'toast.greetedAlready', params: { fan: greeted.name ?? dock.fanName(greeted.chat) ?? i18n.t('newcomers.col.fan') } },
      body: { key: 'toast.greetedAlreadyOpened' },
    });
    return { ok: true, type: 'GreetNewcomer', outcome: 'opened' };
  }
  offs.push(
    router.register(
      adopt({
        kinds: [],
        getSnapshot: () => undefined,
        subscribe: () => () => undefined,
        dispatch: (action) => (action.type !== 'GreetNewcomer' ? null : action.here === true ? hiHere(action.targetHandle, action.again === true) : greet(action.targetHandle)),
      }),
    ),
  );

  const mirror = (): void => {
    const state = surfaces.current();
    const wanted: readonly [Parameters<typeof overlays.set>[0], boolean][] = [
      ['spenders', state.spenders],
      ['newcomers', state.newcomers],
      ['outreach', state.outreach],
      ['online', state.online],
      ['queues', state.queues],
      ['fan-panel', state.fanPanel],
    ];
    world.pins?.set('outreach-chip', state.outreachChip && !state.outreach);
    for (const [overlay, isOpen] of wanted) if (overlays.isOpen(overlay) !== isOpen) overlays.set(overlay, isOpen);
    const from = PREVIEW_SOURCES.find((source) => state.preview[source] !== null) ?? null;
    if (overlays.previewFrom() !== from) overlays.setPreview(from);
  };
  const offSurfaces = surfaces.subscribe(mirror);
  mirror();

  // A read that fails is a state the boards show by themselves (not signed in, no binding): nothing to wait for.
  await Promise.all([context.refresh().catch(() => undefined), preview.ready().catch(() => undefined)]);

  return {
    openOnline: (chat, shown) => previewChunk.openOnlinePreview(palette, preview, i18n, chat, shown),
    openChat: (chat, conversationRef) => navigator.open(chat, 'preview', ['spenders'], conversationRef),
    fromBatch: (opId) => preview.fromBatch(opId) || (newcomers.fromBatch?.(opId) ?? false),
    inCard: (opId) => newcomers.inCard?.(opId) ?? false,
    greetHere: (handle) => newcomers.greetHereState?.(handle) ?? null,
    onGreetHere: (listener) => newcomers.onGreetHere?.(listener) ?? (() => undefined),
    greetRun: (handle) => runs.get(handle) ?? null,
    onGreetRun(listener) {
      runListeners.add(listener);
      return () => {
        runListeners.delete(listener);
      };
    },
    dispose() {
      dock.bind(null);
      win.removeEventListener('online', onOnline);
      win.removeEventListener('offline', onOnline);
      offSurfaces();
      offDrafts();
      driver.dispose();
      for (const off of offs.splice(0)) off();
      for (const controller of controllers) controller.dispose();
      palette.dispose();
      surfaces.closeAll();
      mirror();
      surfaces.clear();
      context.dispose();
    },
  };
}
