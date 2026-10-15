// The controllers of the tab, family by family, as they are loaded and
// plugged into the AppClient router (architecture.md §10.2, §11):
//
// - with the dock: the AI workspace and the dock's controller (R11), the
//   keys and navigation (R17) and the shell (toasts, the tab's own actions);
// - right after it: Recap, Review and Coach over the same workspace;
// - with the first board surface: Spenders, «Новые», the fan panel and the
//   preview (R12) — the same wiring as R12's `createBoardsControllers`, cut
//   in two chunks, because one would not fit the 30 KiB of a lazy chunk.
//
// What a composition root has to say and no package can: who answers for an
// action two families could take, and how the three «what is open» states —
// R17's overlays, R12's surfaces, R11's Coach switch — become one.

import { CG_REGISTRY } from '@cg/contracts/errors/registry';
import type { CgCode } from '@cg/contracts/errors';
import type { FeatureSlice } from '@cg/contracts/features/types';
import type { ChatRef } from '@cg/contracts/ids';
import type { AiHostPolicy } from '@cg/contracts/ops';
import type { SendAttemptView } from '@cg/contracts/send';
import type { HostPort } from '@cg/contracts/host';
import type { ActionCatalog, ActionReceipt, AppClient, ClipboardPort, DockVM, I18n, PreviewSource, ToastPort, UiAction } from '@cg/contracts/vm';
import type { AppRouter } from '@cg/core/application';
import type { HotkeySink } from '@cg/core/application/hotkeys';
import { toastKindOf } from '@cg/core/domain/errors';
import type { Logger } from '@cg/core/domain/logging';

import type * as AiChunk from '../../../lazy/entries/ai';
import type * as AnalysisChunk from '../../../lazy/entries/ai-analysis';
import type * as CoachChunk from '../../../lazy/entries/ai-coach';
import type * as BoardsChunk from '../../../lazy/entries/boards';
import type * as PreviewChunk from '../../../lazy/entries/boards-preview';
import type * as NavigationChunk from '../../../lazy/entries/navigation';
import type { GestureGate } from './action-gate';
import { adopt, type ControllerRpc, type LooseController } from './client';
import { boardsHostOver, type HostFacts } from './host-facts';
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
  readonly win: Window;
  /** The background's client with `token.issue` behind the gate (client.ts). */
  readonly rpc: ControllerRpc;
  readonly host: HostPort;
  /** The site's slice of the feature manifest (the adapter's `features`). */
  readonly features: FeatureSlice;
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
}

const done = (type: UiAction['type'], outcome: Extract<ActionReceipt, { ok: true }>['outcome'] = 'done'): ActionReceipt => ({ ok: true, type, outcome });

// ── AI: the workspace, the dock, and — later — Recap, Review, Coach ─────────

export interface TabAi {
  readonly workspace: AiChunk.AiWorkspace;
  /** Plugs a controller built over the workspace into the router. */
  plug(controller: AiChunk.AiController): void;
  /** The Recap controller, once its chunk is in (tab/recap-tab.ts reads it for the fan panel's Recap tab). */
  recap: AnalysisChunk.RecapController | null;
  dispose(): void;
}

export function startAi(world: TabWorld, chunk: typeof AiChunk, catalog: ActionCatalog): TabAi {
  const { router, keys, gate, logger } = world;
  const ports: AiChunk.AiPorts = {
    rpc: world.rpc,
    host: world.host,
    i18n: world.i18n,
    clock: world.clock,
    ids: world.ids,
    catalog,
    features: world.features,
    policy: world.aiPolicy,
    clipboard: world.clipboard,
    toasts: world.toasts,
    extensionVersion: world.extensionVersion,
    // Route and insert journal lines (LG-017): ids, lengths and fingerprints, never a text.
    journal: { write: (entry) => void logger.write(entry.level, entry.scope, entry.msg, { ...(entry.code === undefined ? {} : { code: entry.code }), ...(entry.fields === undefined ? {} : { fields: entry.fields }), ...(entry.ctx === undefined ? {} : { ctx: entry.ctx }) }) },
    // R11 opens and closes Coach through this switch; what is open is R17's one state.
    overlays: { open: (surface) => keys.overlays.set(surface, true), close: (surface) => keys.overlays.set(surface, false), isOpen: (surface) => keys.overlays.isOpen(surface) },
  };
  const workspace = new chunk.AiWorkspace(ports);
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
    dispose() {
      for (const off of offs.splice(0)) off();
      for (const controller of controllers.splice(0)) controller.dispose();
      workspace.dispose();
    },
  };
}

export function startAnalysis(ai: TabAi, analysis: typeof AnalysisChunk, coach: typeof CoachChunk): void {
  ai.recap = analysis.createRecapController(ai.workspace);
  ai.plug(ai.recap);
  ai.plug(analysis.createReviewController(ai.workspace));
  ai.plug(coach.createCoachController(ai.workspace));
}

// ── keys and navigation ──────────────────────────────────────────────────────

export interface TabNavigation {
  readonly navigation: NavigationChunk.NavigationController;
  /** Where the early dispatcher's commands go; connected once every controller a key may need is in. */
  readonly sink: HotkeySink;
  dispose(): void;
}

/** What the navigation family opens through the other families (the composition root binds them late). */
export interface NavigationOpeners {
  coach(): Promise<ActionReceipt>;
  /** The palette's «Онлайн» choice: OUR preview of the fan in its own window (the boards' `openOnline`, X24). */
  preview(chat: ChatRef, shown: readonly ChatRef[]): Promise<ActionReceipt>;
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
  });
  const quickJump = chunk.createQuickJumpController({ host, i18n, overlays, clock });
  const cheatsheet = chunk.createCheatsheetController({ catalog, features: world.features });

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
  for (const controller of [navigation, palette, quickJump, cheatsheet, bridges] as LooseController[]) offs.push(router.register(adopt(controller)));

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
}

/** The overlays R12's `Surfaces` opens and closes, mirrored into R17's one state. */
const PREVIEW_SOURCES: readonly PreviewSource[] = ['spenders', 'newcomers', 'palette'];

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

  const spenders = chunk.createSpendersController({ rpc, i18n, clock, context, surfaces, navigator, timeZone });
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
  const rowOf = (pageId: number, fanRef: string) => spenders.row(pageId, fanRef);
  const rowsChanged = (listener: () => void): (() => void) => spenders.directory.subscribe(listener);
  const palette = chunk.createPaletteDirectory({ host: boardsHost, context, rowOf, rowsChanged });

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
    directories: { spenders: spenders.directory, newcomers: newcomers.directory, palette },
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
  });
  late.preview = preview;
  dock.bind(preview.results);
  const offDrafts = preview.onDrafts(() => newcomers.draftsChanged());
  const fanPanel = chunk.createFanPanelController({ rpc, host: boardsHost, i18n, clock, context, surfaces, rowOf, rowsChanged });

  // R12's order: the preview first — it answers for the parts of its own results.
  const controllers = [preview, spenders, newcomers, fanPanel];
  const offs = controllers.map((controller) => router.register(adopt(controller as unknown as LooseController)));

  const mirror = (): void => {
    const state = surfaces.current();
    const wanted: readonly [Parameters<typeof overlays.set>[0], boolean][] = [
      ['spenders', state.spenders],
      ['newcomers', state.newcomers],
      ['fan-panel', state.fanPanel],
    ];
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
