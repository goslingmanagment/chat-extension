// The tab's application — the lazy chunk `tab-app` (architecture.md §10.2,
// §11): the AppClient as a router of surface controllers, the texts of one
// language, the tab's logger, the action gate, and the order in which the
// rest of the tab comes to life. Loaded when ChatSpace shows a composer or a
// key of ours waits for it; everything it needs from the early bundle comes
// in through `env` (no browser API, no build constants here: a lazy chunk is
// a plain module).
//
// The start, in three steps:
// 1. the dock, its controller (the AI workspace) and the keys' other half —
//    three chunks at once; the dock is mounted with a controller behind it;
// 2. Recap, Review and Coach over the same workspace; then the early key
//    dispatcher is connected — a key pressed before that was kept (HK-024);
// 3. the boards (Spenders, «Новые», the fan panel, the preview) with the
//    first action that opens one, and each overlay's UI with its first show.
//
// Every surface draws only from view models and asks only with UiActions
// through ONE AppClient (client.ts); every controller talks to the
// background through ONE client whose `token.issue` is the gate's
// (action-gate.ts). Nothing here keeps a text of a conversation, a draft, a
// prompt or an answer, and nothing of the kind is logged.

import type { CgCode, CgErrorView, I18nKey } from '@cg/contracts/errors';
import { CG_REGISTRY } from '@cg/contracts/errors/registry';
import type { HostContractReport, HostContractShape, HostPort } from '@cg/contracts/host';
import type { ChatRef } from '@cg/contracts/ids';
import { DEFAULT_LOCALE, type Locale } from '@cg/contracts/i18n/keys';
import { LOG_LIMITS } from '@cg/contracts/limits';
import type { UiLocale, UiTheme } from '@cg/contracts/settings';
import type { PageCommand } from '@cg/contracts/tab-messages';
import type { TabHealthReport } from '@cg/contracts/telemetry';
import { PREVIEW_SOURCES, type ActionReceipt, type ColorScheme, type MountDeps, type MountSurfaceKind, type SurfaceGeometry, type UiAction } from '@cg/contracts/vm';
import { createAppRouter } from '@cg/core/application';
import { createShellController } from '@cg/core/application/shell';
import { toastKindOf, viewOfCode } from '@cg/core/domain/errors';
import { createLiveI18n, resolveLocale, translatorOf } from '@cg/core/domain/i18n/live';
import { createLogForwarder, createLogger, installErrorCapture, logEvent, logHostContract } from '@cg/core/domain/logging';
import type { TabRpcClient } from '@cg/platform';

import type * as AiChunk from '../../../lazy/entries/ai';
import type * as AnalysisChunk from '../../../lazy/entries/ai-analysis';
import type * as CoachChunk from '../../../lazy/entries/ai-coach';
import type * as BoardsChunk from '../../../lazy/entries/boards';
import type * as PreviewChunk from '../../../lazy/entries/boards-preview';
import type * as CoachUiChunk from '../../../lazy/entries/coach';
import type * as DialogsChunk from '../../../lazy/entries/dialogs';
import type * as DockChunk from '../../../lazy/entries/dock';
import type { LazyEntryName } from '../../../lazy/entries/names';
import type * as NavigationChunk from '../../../lazy/entries/navigation';
import type * as HealthChunk from '../../../lazy/entries/tab-health';
import { createActionTokens, createGestureGate, type TabActionTokens } from './action-gate';
import type { HostAppAdapter, HostDiagnostic, HostMounts, HostThemeSource, TokenRedeemer } from './adapter';
import { adopt, boardReceiptToast, chatOnScreen, closesPalette, controllerRpc, createTabClient, handoverToast, heldSilently, paletteReceiptToast } from './client';
import { dockChatBridge, startAi, startAnalysis, startBoards, startNavigation, type DraftStore, type TabBoards, type TabClock, type TabWorld } from './controllers';
import { createContractLog } from './contract-log';
import { contractFactsOf, forwardHostFacts, knownBootstrap } from './host-facts';
import type { TabKeys } from './keys';
import type { TabProbe } from './probe';
import { panelGeometryOf, toastPlaceOf, type DockBox } from './panel-geometry';
import { followRecapTab } from './recap-tab';
import { mountSurfaces, OVERLAY_MOUNTS, overlayRoot } from './surfaces';
import { toastOfTab, type ToastFacts } from './toast-events';
import { Value } from './values';

export type { TabActionTokens } from './action-gate';

export interface TabAppEnv<P extends HostPort = HostPort> {
  readonly win: Window;
  readonly life: AbortSignal;
  readonly rpc: TabRpcClient;
  readonly host: P;
  readonly mounts: HostMounts;
  readonly theme: HostThemeSource;
  /** The early key dispatcher and what it reads (tab/keys.ts). */
  readonly keys: TabKeys;
  /** A lazy chunk by its entry name (one retry, EX-009). */
  readonly lazy: <T>(entry: LazyEntryName) => Promise<T>;
  /** `moz-extension://<uuid>`: errors pointing at it are ours (ER-021). */
  readonly ownOrigin: string;
  /** The manifest's version of this build: below the hub's `minVersion` the dock says «расширение устарело» before a click. */
  readonly extensionVersion: string;
  readonly contractsVersion: string;
  readonly lateInjection: boolean;
  readonly staleHosts: number;
  readonly setNavInsertTimeoutMs: (ms: number) => void;
  readonly takeDiagnostics: (listener: (diagnostic: HostDiagnostic) => void) => HostDiagnostic[];
  /** `newcomers.drafts` of storage.local; null — drafts live until the tab reloads. */
  readonly drafts: DraftStore | null;
  /** Test builds only. */
  readonly probe: TabProbe | null;
}

export interface TabApp {
  /** `token.redeem` for HostPort: the token of a click is spent before a write reaches MAIN (§14). */
  readonly redeem: TokenRedeemer;
  /** The tokens of the human action in flight, as the gate gives them. */
  readonly tokens: TabActionTokens;
  /** A click on the popup or the options page that acts in this tab (`tab.command`): a window of ours, or an account. */
  command(command: PageCommand): void;
  dispose(): void;
}

/** What the tab reads of the settings (the rest is the controllers' business). */
interface UiSettings {
  readonly locale: UiLocale;
  readonly theme: UiTheme;
  readonly debug: boolean;
}
/** Settings that could not be read: what a fresh install has (DEFAULT_SETTINGS.ui; the tab does not carry the settings schemas). */
const UNKNOWN_SETTINGS: UiSettings = { locale: DEFAULT_LOCALE, theme: 'host', debug: false };

/** Rows of ChatSpace's cached chat list read for the name of a toast's fan. */
const TOAST_NAME_ROWS = 200;

/**
 * The host contract in one word, for the e2e report: every capability is on, some are not, some broke — but for the
 * parts the owner switches on separately (the site's `switchedCapabilities`; ChatSpace: X8 and the WS tap, its part
 * B), which are off until the owner's flags switch them on: not a degraded contract.
 */
function contractOf(report: HostContractReport, shape: HostContractShape): 'ok' | 'degraded' | 'broken' {
  const states = Object.entries(report.capabilities).filter(([name]) => !(shape.switchedCapabilities as readonly string[]).includes(name));
  if (states.some(([, capability]) => capability.state === 'contractBroken')) return 'broken';
  return states.some(([, capability]) => capability.state !== 'on') ? 'degraded' : 'ok';
}

/** Overlays the boards' controllers answer for: they are loaded with the first action that opens one. */
const BOARD_SURFACES: readonly string[] = ['spenders', 'newcomers', 'fan-panel'];

/** The application of a site's tab; `site` is the application's half of the site's adapter (tab/adapter.ts). */
export async function startTabApp<P extends HostPort, C>(env: TabAppEnv<P>, site: HostAppAdapter<P, C>): Promise<TabApp> {
  env.life.throwIfAborted();
  const { win, rpc, host, mounts, keys, probe } = env;
  const doc = win.document;
  const offs: (() => void)[] = [];
  let disposed = false;

  // ── settings the UI depends on ─────────────────────────────────────────────
  let ui: UiSettings = UNKNOWN_SETTINGS;
  const readSettings = (state: { readonly settings: { readonly ui: { readonly locale: UiLocale; readonly theme: UiTheme }; readonly debug: { readonly enabled: boolean } } }): UiSettings => ({
    locale: state.settings.ui.locale,
    theme: state.settings.ui.theme,
    debug: state.settings.debug.enabled,
  });
  const firstSettings = await rpc.request('settings.get', {});
  env.life.throwIfAborted();
  if (firstSettings.ok) ui = readSettings(firstSettings.payload);

  // ── the site's look and its phrases (R20 §1.5): read once, as the application starts ──
  const profile = site.ui(env.theme);

  // ── texts: one language, its own lazy chunk (§11) ──────────────────────────
  const catalogs: Partial<Record<Locale, Readonly<Record<string, unknown>>>> = {};
  const loadCatalog = async (language: Locale): Promise<void> => {
    if (catalogs[language] !== undefined) return;
    catalogs[language] = (await env.lazy<{ readonly CATALOG: Readonly<Record<string, unknown>> }>(`i18n-${language}`)).CATALOG;
  };
  const languageOf = (settings: UiSettings): Locale => resolveLocale(settings.locale, win.navigator.languages);
  // The texts and the first three chunks of the application travel together, with the site's AI policy.
  const [, dockChunk, aiChunk, navigationChunk, aiPolicy] = await Promise.all([
    loadCatalog(languageOf(ui)),
    env.lazy<typeof DockChunk>('dock'),
    env.lazy<typeof AiChunk>('ai'),
    env.lazy<typeof NavigationChunk>('navigation'),
    site.ai(env.lazy, rpc),
  ]);
  // No listeners or UI exist before this last asynchronous startup boundary.
  // From here initialization and installing the abort listener are synchronous.
  env.life.throwIfAborted();
  const i18n = createLiveI18n((language) => catalogs[language] ?? null, {
    language: languageOf(ui),
    onMissing: (key, language) => logger.warn('tab.i18n', 'text missing', { fields: { key, language } }),
    // The shared texts name no site: the site's own phrases go where they did (R20 F9b).
    phrases: profile.phrases,
  });
  const translator = translatorOf(i18n);
  const errorOf = (code: CgCode): CgErrorView => viewOfCode(code, translator);

  // ── the tab's log: redacted here, forwarded to the background (LG-011) ─────
  const forwarder = createLogForwarder({
    async send(records) {
      const answer = await rpc.request('log.write', { records: [...records] });
      if (!answer.ok) throw new Error(answer.error.code);
      return answer.payload;
    },
    schedule: (fn) => void setTimeout(fn, 250),
  });
  const logger = createLogger({
    now: () => Date.now(),
    debugEnabled: () => ui.debug,
    sinks: [forwarder.push],
    maxRecordBytes: LOG_LIMITS.maxRecordBytesFromUi,
    ctx: () => {
      const tabSessionId = rpc.tabSessionId();
      return { ...(tabSessionId === null ? {} : { tabSessionId }), routeEpoch: host.current().route.epoch };
    },
  });
  const capture = installErrorCapture(win, logger, { ownOrigin: env.ownOrigin, everythingIsOurs: false }, () => Date.now());
  offs.push(capture.uninstall);
  logEvent(logger, 'tabStarted', { fields: { lateInjection: env.lateInjection, staleHosts: env.staleHosts, contractsVersion: env.contractsVersion } });
  const onDiagnostic = (diagnostic: HostDiagnostic): void => {
    const { code, count } = diagnostic;
    const detail = diagnostic.detail ?? (count === undefined ? undefined : { count });
    logger.info('tab.host', diagnostic.event, { ...(code === undefined ? {} : { code }), ...(detail === undefined ? {} : { fields: detail }) });
  };
  for (const diagnostic of env.takeDiagnostics(onDiagnostic)) onDiagnostic(diagnostic);

  // ── client_health: its own chunk, once the dock is on screen (§9.6) ────────
  let health: HealthChunk.TabHealth | null = null;

  // ── the AppClient: a router of surface controllers ─────────────────────────
  const router = createAppRouter({
    errorOf,
    onFailure(failure) {
      logger.warn('tab.ui', 'router refused', { code: 'CG-UI-FAILED', fields: { ...failure } });
      health?.count('router.refused');
    },
  });

  // ── action tokens (§14): only for a human action, spent once ───────────────
  const gate = createGestureGate(win, { doc, mounts });
  offs.push(() => gate.dispose());
  const { tokens, redeem } = createActionTokens({
    gate,
    async request(kind, surface) {
      const answer = await rpc.request('token.issue', { kind, surface });
      // A refusal reaches the person with its own code: the background's (§8.3: the sign-in is gone, the owner's
      // switch, a bootstrap that expired while the hub is silent) or the port's (the event page did not answer,
      // the extension was reloaded under the tab).
      return answer.ok ? answer.payload.actionToken : { error: answer.error };
    },
    async spend(request) {
      const answer = await rpc.request('token.redeem', request);
      return answer.ok && answer.payload.redeemed;
    },
    onRefused: (facts) => logger.warn('tab.tokens', 'no action token: not a human action', { fields: { ...facts } }),
  });
  // The early dispatcher stops a key of ours before this chunk's listeners hear it: it hands every keydown in.
  keys.onKeydown((event) => tokens.noteGesture(event));
  offs.push(() => keys.onKeydown(null));

  // ── the scheme and the geometry our surfaces draw in ───────────────────────
  const darkQuery = win.matchMedia('(prefers-color-scheme: dark)');
  const schemeOf = (): ColorScheme => {
    if (ui.theme === 'light' || ui.theme === 'dark') return ui.theme;
    if (ui.theme === 'host') return env.theme.current().scheme;
    return darkQuery.matches ? 'dark' : 'light';
  };
  const scheme = new Value<ColorScheme>(schemeOf());
  const onScheme = (): void => scheme.set(schemeOf());
  darkQuery.addEventListener('change', onScheme);
  offs.push(() => darkQuery.removeEventListener('change', onScheme), env.theme.onChange(onScheme));

  const geometryOf = (): SurfaceGeometry => {
    const points = mounts.points();
    return { width: points.dock.width, feedHeight: null, viewportHeight: win.innerHeight, container: points.overlay.container };
  };
  const geometry = new Value<SurfaceGeometry>(geometryOf());
  // A side panel that would lie over our dock ends where the dock begins (tab/panel-geometry.ts): the composer and
  // the strip stay free. One beside the composer (ChatSpace 0.195's own panel of the fan is open) keeps its height.
  const dockBox = (): DockBox | null => {
    const dockHost = mounts.dock.host;
    if (mounts.points().dock.kind === 'none' || !dockHost.isConnected) return null;
    const rect = dockHost.getBoundingClientRect();
    return { top: rect.top, left: rect.left, right: rect.right };
  };
  const panelGeometryNow = (): SurfaceGeometry => panelGeometryOf(geometryOf(), dockBox(), { width: doc.documentElement.clientWidth, height: win.innerHeight });
  const panelGeometry = new Value<SurfaceGeometry>(panelGeometryNow());
  // The dock grows with its result and moves with the composer under it (a longer draft, another chat), and it
  // narrows when ChatSpace opens its own panel of the fan beside the chat: each is a resize of the dock or of the
  // frame it sits in. Nothing is polled.
  const dockResize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => panelGeometry.set(panelGeometryNow())) : null;
  let dockObserved: Element | null = null;
  const observeDock = (): void => {
    if (dockResize === null) return;
    const frame = mounts.dock.host.parentElement;
    if (frame === dockObserved) return;
    dockResize.disconnect();
    dockObserved = frame;
    dockResize.observe(mounts.dock.host);
    if (frame !== null) dockResize.observe(frame);
  };
  const onGeometry = (): void => {
    geometry.set(geometryOf());
    observeDock();
    panelGeometry.set(panelGeometryNow());
  };
  win.addEventListener('resize', onGeometry);
  offs.push(mounts.onChange(onGeometry), () => win.removeEventListener('resize', onGeometry), () => dockResize?.disconnect());
  observeDock();

  // ── ports every controller and every surface gets ──────────────────────────
  const clock: TabClock = { now: () => Date.now(), setTimer: (ms, fn) => win.setTimeout(fn, ms), clearTimer: (handle) => win.clearTimeout(handle as number) };
  const catalog = navigationChunk.createActionCatalog(keys.platform);
  const toasts = dockChunk.createToastHost();
  offs.push(() => toasts.dispose());
  // While a side panel is open the toasts stand left of it, never over its header (tab/panel-geometry.ts): they move
  // when a panel opens or closes and when the window or ChatSpace's container changes — not with the dock.
  const placeToasts = (): void => {
    const panelOpen = keys.overlays.list().some((overlay) => OVERLAY_MOUNTS[overlay]?.layer === 'panel');
    toasts.setPlace(toastPlaceOf(panelOpen, geometryOf(), doc.documentElement.clientWidth));
  };
  placeToasts();
  win.addEventListener('resize', placeToasts);
  offs.push(keys.overlays.subscribe(placeToasts), mounts.onChange(placeToasts), () => win.removeEventListener('resize', placeToasts));
  const clipboard: MountDeps['clipboard'] = {
    writeText: (text) =>
      win.navigator.clipboard.writeText(text).then(
        () => ({ ok: true }) as const,
        () => ({ ok: false, code: 'CG-CLIPBOARD' }) as const,
      ),
  };

  // Stage two and the boards are loaded behind the first paint; an action that needs them waits for them.
  let stageTwo: Promise<void> | null = null;
  let stageTwoIn = false;
  let boards: Promise<TabBoards> | null = null;
  const needsBoards = (action: UiAction): boolean => action.type === 'OpenPreview' || (action.type === 'Navigate' && action.to.kind === 'surface' && action.to.open && BOARD_SURFACES.includes(action.to.surface));
  /** What a board could not say itself (it has closed, or its row keeps nothing of it): a toast with the code. */
  const say = (code: CgCode, scope: string, title: I18nKey | null): void => {
    const entry = CG_REGISTRY[code];
    toasts.show({ kind: toastKindOf(code), code, scope, title: { key: title ?? entry.title }, body: title === null ? { key: entry.body } : null });
  };
  const client = createTabClient({
    router,
    tokens,
    before(action) {
      if (needsBoards(action)) return ensureBoards();
      return stageTwoIn ? null : stageTwo;
    },
    onAction: (action) => health?.action(action.type, action.type === 'Navigate' && action.to.kind === 'surface' && action.to.open ? action.to.surface : undefined),
    onReceipt(action, receipt) {
      // A row of the palette ran: the palette goes (R17's controller closes it only for a preview it opened itself).
      // A row that was refused leaves it open, and the reason is said: the palette has no place for it.
      if (keys.overlays.isOpen('palette')) {
        if (closesPalette(action, receipt)) keys.overlays.set('palette', false);
        const refused = paletteReceiptToast(action, receipt);
        if (refused !== null) return say(refused.code, refused.scope, refused.title);
      }
      // A click on a board's part that came to nothing the board itself shows: the reason, as a toast.
      const said = boardReceiptToast(action, receipt);
      if (said !== null) return say(said.code, said.scope, said.title);
      // «Отправить» began an attempt: if it was stopped before ChatSpace's queue and its row will not say why, we do.
      if (action.type !== 'SendPart' || !receipt.ok || receipt.attemptId === undefined) return;
      void rpc.request('send.status', { attemptId: receipt.attemptId }).then((answer) => {
        const code = heldSilently(answer.ok ? answer.payload.view : null);
        if (code !== null && !disposed) say(code, 'board.send', null);
      });
    },
  });

  const world: TabWorld = {
    win,
    rpc: controllerRpc(rpc, tokens, (type, payload) => {
      // `insertMs` is the host's own number, taken as the controller reports an applied insert.
      if (type !== 'op.reportInsert') return;
      const receipt = (payload as { readonly receipt?: { readonly state?: string; readonly ms?: number } }).receipt;
      if (receipt?.state === 'applied' && typeof receipt.ms === 'number') health?.record('insertMs', receipt.ms);
    }),
    host,
    features: site.features,
    ...(site.registrationOf === undefined ? {} : { registrationOf: site.registrationOf }),
    aiPolicy,
    i18n,
    clock,
    ids: { uuid: () => win.crypto.randomUUID() },
    extensionVersion: env.extensionVersion,
    router,
    client,
    toasts,
    clipboard,
    keys,
    gate,
    logger,
    drafts: env.drafts,
  };

  // ── stage one: the dock's controller, keys and navigation, the shell ───────
  const ai = startAi(world, aiChunk, catalog);
  offs.push(() => ai.dispose());

  /** The strip's Coach and its key ask with `Navigate`; R11's Coach opens on a `Generate` without a question. */
  const openCoach = async (): Promise<ActionReceipt> => {
    await stageTwo;
    const target = router.getSnapshot({ of: 'dock' }).targetHandle;
    if (target === null) return { ok: false, type: 'Navigate', code: 'CG-GATE-CHAT-LOADING', error: errorOf('CG-GATE-CHAT-LOADING') };
    const receipt = await router.dispatch({ type: 'Generate', targetHandle: target, feature: 'coach', options: {} });
    return { ...receipt, type: 'Navigate' };
  };
  /**
   * The palette's «Онлайн» (CS-030): OUR preview of the fan in its own window, with the boards (X24). The palette
   * stays open on a refusal — nobody signed in, no binding, ChatSpace no longer shows the fan online — and the
   * reason is a toast: the palette itself has no place for it.
   */
  const openOnline = async (chat: ChatRef, shown: readonly ChatRef[]): Promise<ActionReceipt> => {
    const receipt = await ensureBoards().then((started) => started.openOnline(chat, shown));
    if (!receipt.ok && !disposed) say(receipt.code, 'palette.online', null);
    return receipt;
  };
  const navigation = startNavigation(world, navigationChunk, catalog, ai, { coach: openCoach, preview: openOnline });
  offs.push(() => navigation.dispose());
  offs.push(router.register(adopt(dockChatBridge(aiChunk, navigation.navigation, gate))));

  let surfaces: ReturnType<typeof mountSurfaces> | null = null;
  /** Test builds only: writes what the dock shows into the e2e report. */
  let reportDock: (() => void) | null = null;
  let coachUi: typeof CoachUiChunk | null = null;
  let dialogHost: Promise<DialogsChunk.DialogHost> | null = null;
  /** A Б2 question stands in the dock; a DialogPort question stands on the modal layer. Either is «our dialog» for the keys. */
  let confirming = false;
  let asking = false;
  const setOverlay = (overlay: 'result-expanded' | 'dialog', isOpen: boolean): void => {
    if (keys.overlays.isOpen(overlay) !== isOpen) keys.overlays.set(overlay, isOpen);
  };
  /** A toast of the background, read by where this tab is at the moment it arrives (tab/toast-events.ts). */
  const toastFacts: ToastFacts = {
    showing: () => host.current().route.chat,
    visible: () => doc.visibilityState === 'visible',
    fanName(chat) {
      const fan = host.fan(chat) ?? host.listCachedChats(chat.hostAccountId, TOAST_NAME_ROWS).find((row) => row.chat.platformFanId === chat.platformFanId) ?? null;
      return fan === null ? null : (fan.displayName ?? fan.username);
    },
    // The boards come with the first action that opens one: before that no preview holds anything.
    inPreview: (opId) => router.serves('preview') && PREVIEW_SOURCES.some((from) => router.getSnapshot({ of: 'preview', from }).result?.opId === opId),
  };
  const shell = createShellController({
    rpc: {
      onEvent: (type, listener) =>
        rpc.onEvent(type, ({ toast }) => {
          const shown = toastOfTab(toast, toastFacts);
          if (shown !== null) listener({ toast: shown });
        }),
    },
    i18n,
    clock,
    chatHandle: (chat, conversationRef) => navigationChunk.chatHandle(chat, conversationRef),
    tab: {
      reload: () => win.location.reload(),
      reloadSurface: (surface) => surfaces?.reload(surface) ?? false,
      // A content script cannot open our pages: the background does (`settings.open`), into the one settings tab.
      openSettings: (route) => rpc.request('settings.open', { route }).then((answer) => answer.ok && answer.payload.opened),
      // «Промпт» of a debug block: the prompt page, by the opaque token of the snapshot (`debug.open`).
      openPrompt: (token) => rpc.request('debug.open', { token }).then((answer) => answer.ok && answer.payload.opened),
      copyText: (text) => clipboard.writeText(text).then((result) => result.ok),
    },
  });
  offs.push(router.register(adopt(shell)), () => shell.dispose());

  // ── the surfaces: the dock and the toasts now, every overlay with its first show ──
  const focus = { last: null as Element | null };
  // Where the person is as the application starts: with no chat open it starts on a key of ours (⌘K, HK-024), and
  // the window that key opens gives the focus back there — no focusin has been heard yet.
  const startedIn = doc.activeElement;
  if (startedIn !== null && startedIn !== doc.body && startedIn !== doc.documentElement && mounts.registry.rootOf(startedIn) === null) focus.last = startedIn;
  const onFocusIn = (event: Event): void => {
    // Where the person was before one of our windows took the focus: the composer, a row of ChatSpace's list.
    if (mounts.registry.hostOf(event) === null && event.target instanceof Element) focus.last = event.target;
  };
  doc.addEventListener('focusin', onFocusIn, true);
  offs.push(() => doc.removeEventListener('focusin', onFocusIn, true));

  const deps: MountDeps = {
    // The site's look (§1.5): every surface of the tab is mounted with it, the dialogs and the side panels too.
    profile,
    client,
    i18n,
    catalog,
    toasts,
    // The modal confirmation («Новый диалог» of Coach): its chunk comes with the first question.
    dialogs: {
      confirm(request) {
        dialogHost ??= env.lazy<typeof DialogsChunk>('dialogs').then((chunk) => {
          const host = chunk.createDialogHost();
          const mount = chunk.mountDialogs(overlayRoot(mounts, 'modal'), deps, { host, report: reportSurface });
          // While a question stands it is our top window for the keys (HK-027).
          const off = host.pending.subscribe((pending) => {
            asking = pending !== null;
            setOverlay('dialog', asking || confirming);
          });
          offs.push(() => {
            off();
            host.dispose();
            mount.unmount();
          });
          return host;
        });
        // A chunk that did not load asks nothing: the answer is «Отмена», never a silent «да».
        return dialogHost.then(
          (host) => host.confirm(request),
          () => {
            dialogHost = null;
            return 'cancel' as const;
          },
        );
      },
    },
    clipboard,
    scheme,
    geometry,
    focus: {
      token: null,
      restore() {
        const target: (Element & { focus?: () => void }) | null = focus.last;
        if (target === null || !target.isConnected || typeof target.focus !== 'function') return false;
        target.focus();
        return doc.activeElement === target;
      },
    },
    marks: {
      // Telemetry `shown` only for a result that was really visible (§9.6).
      resultShown: (opId) => ai.workspace.resultShown(opId),
      painted: (metric, mark) => health?.painted(metric, mark),
    },
  };

  /** ER-020: the surface and the error's class name — never its message, which may quote a draft. */
  function reportSurface(failure: DockChunk.KitFailure): void {
    logger.error('tab.ui', 'surface failed', { code: failure.code, fields: { kind: failure.kind, surface: failure.surface, name: failure.name } });
    health?.count(`ui.failed.${failure.surface ?? 'none'}`);
  }

  surfaces = mountSurfaces({
    mounts,
    deps,
    panelDeps: { ...deps, geometry: panelGeometry },
    ui: dockChunk,
    toasts,
    overlays: keys.overlays,
    // The Coach panel's chunk is remembered when it comes: a sign-out must reach its unsent questions.
    lazy: <T>(entry: LazyEntryName): Promise<T> =>
      env.lazy<T>(entry).then((module) => {
        if (entry === 'coach') coachUi = module as unknown as typeof CoachUiChunk;
        return module;
      }),
    report: reportSurface,
    ...(probe === null ? {} : { debug: (kind: MountSurfaceKind, error: unknown) => probe.set('surfaceError', `${kind}: ${String(error)}`), onChange: () => reportDock?.() }),
    onLoadFailed(kind: MountSurfaceKind) {
      // The window did not come: say so and let the keys go back to the page.
      toasts.show({ kind: 'error', code: 'CG-UI-FAILED', scope: `surface.${kind}`, title: { key: 'cg.uiFailed.title' }, body: { key: 'cg.uiFailed.body' } });
      // The palette's preview window is the boards' state: closed there, its overlay and its source go with it.
      if (kind === 'preview' && router.serves('preview')) void router.dispatch({ type: 'Navigate', to: { kind: 'surface', surface: 'preview', open: false } });
      for (const overlay of keys.overlays.list()) if (overlay === kind) keys.overlays.set(overlay, false);
    },
  });
  const mounted = surfaces;
  offs.push(() => mounted.dispose());
  // The site's own surfaces (R20 P13b: Fansly's vault), with what every surface of the tab is mounted with.
  if (site.start !== undefined) offs.push(site.start({ win, life: env.life, rpc, host, mounts, lazy: env.lazy, deps: { ...deps, geometry: panelGeometry }, features: site.features, report: reportSurface, probe }));

  // ── what the dock's view says about our overlays ───────────────────────────
  // «Развернуть ↗» is a window while a result, a Recap or a Review is expanded; a Б2 question is a dialog for
  // the keys (Esc is its «Отмена», ui-contract.md, decision 12). Recap and Review are read only while the sheet
  // shows them — their views start reads of their own.
  let offAnalysis: (() => void) | null = null;
  let analysisOf: 'recap' | 'review' | null = null;
  let analysisExpanded = false;
  const syncDock = (): void => {
    const dock = router.getSnapshot({ of: 'dock' });
    if (dock.analysis !== analysisOf) {
      offAnalysis?.();
      offAnalysis = null;
      analysisOf = dock.analysis;
      analysisExpanded = false;
      const read = (view: { readonly expanded: boolean }): void => {
        analysisExpanded = view.expanded;
        setOverlay('result-expanded', analysisExpanded || router.getSnapshot({ of: 'dock' }).result?.expanded === true);
      };
      if (analysisOf === 'recap' && router.serves('recap.view')) {
        offAnalysis = router.subscribe({ of: 'recap.view' }, read);
        analysisExpanded = router.getSnapshot({ of: 'recap.view' }).expanded;
      } else if (analysisOf === 'review' && router.serves('review')) {
        offAnalysis = router.subscribe({ of: 'review' }, read);
        analysisExpanded = router.getSnapshot({ of: 'review' }).expanded;
      }
    }
    setOverlay('result-expanded', analysisExpanded || dock.result?.expanded === true);
    confirming = dock.result?.confirm !== null && dock.result?.confirm !== undefined;
    setOverlay('dialog', asking || confirming);
  };
  offs.push(router.subscribe({ of: 'dock' }, syncDock), () => offAnalysis?.());
  syncDock();

  // The fan panel's Recap tab shows the recap of the open chat without the Recap sheet's own actions: while it
  // is on screen the recap controller reads what the hub holds for each chat opened under it (tab/recap-tab.ts).
  offs.push(followRecapTab({ overlays: keys.overlays, router, recap: () => ai.recap }));

  // ── the bootstrap: what it switches in the site's host port, and what a sign-out takes away ──
  const facts = forwardHostFacts({ host, site, rpc: world.rpc, setNavInsertTimeoutMs: env.setNavInsertTimeoutMs, onFailure: (what) => logger.warn('tab.host', 'the host adapter did not take its configuration', { fields: { what } }) });
  offs.push(() => facts.dispose());
  let signedIn: number | null | undefined = undefined;
  const onEnvironment = (): void => {
    const session = ai.workspace.env.session;
    // Only what is known: while the sign-in or its bootstrap is still being read the adapter keeps what it has.
    const known = knownBootstrap(session, ai.workspace.env.bootstrap);
    if (known !== undefined) facts.configure(known);
    if (session === undefined) return;
    const epoch = session?.epoch ?? null;
    // Another sign-in, or none: an unsent Coach question must not meet the next person on this tab.
    if (signedIn !== undefined && epoch !== signedIn) coachUi?.forgetUnsentQuestions();
    signedIn = epoch;
  };
  offs.push(ai.workspace.env.subscribe(onEnvironment));
  onEnvironment();

  // ── host → log, health ─────────────────────────────────────────────────────
  // The host contract goes to the background for «Статус» and client_health; the perf window rides along once
  // the health chunk is in.
  let healthFrom = Date.now();
  const domNodes = (): number => mounts.registry.hosts().reduce((sum, hostElement) => sum + (mounts.registry.rootOf(hostElement)?.querySelectorAll('*').length ?? 0), 0);
  const bareReport = (report: HostContractReport): TabHealthReport => {
    const to = Date.now();
    const out: TabHealthReport = { windowFrom: healthFrom, windowTo: to, host: report, perf: [], counters: {}, footprint: { cachesKB: 0, domNodes: domNodes() } };
    healthFrom = to;
    return out;
  };
  const sendHealth = (): void => {
    if (health !== null) health.report(true);
    else void rpc.request('health.report', { report: bareReport(host.current().contract) });
  };
  // ChatSpace's start-up is not written as a broken contract (tab/contract-log.ts); the health report is not delayed.
  const contractLog = createContractLog((facts, kind) => logHostContract(logger, facts, kind), {
    now: () => Date.now(),
    setTimer: (ms, fn) => win.setTimeout(fn, ms),
    clearTimer: (handle) => win.clearTimeout(handle as number),
  });
  offs.push(() => contractLog.dispose());
  const reportContract = (report: HostContractReport): void => {
    contractLog.report(contractFactsOf(report, site.contract));
    sendHealth();
  };
  offs.push(host.onContract(reportContract));
  reportContract(host.current().contract);
  offs.push(
    host.subscribe((event) => {
      if (event.type === 'route') health?.routeChanged();
    }),
    rpc.onEvent('op.update', (update) => {
      if (update.firstChunkAt !== undefined) health?.firstChunk(update.opId, update.firstChunkAt);
    }),
  );
  keys.onHandlerMs((ms) => health?.record('handlerMs', ms));
  offs.push(() => keys.onHandlerMs(null));

  // ── background → the tab's own settings ────────────────────────────────────
  offs.push(
    rpc.onState(() => {
      // A new tab session after a lost port: the background kept nothing of this tab in memory — the host
      // contract («Статус», client_health) goes to it again. Every controller family reads its own state anew,
      // each on the same event: the AI environment drops its bootstrap and bindings and reads them again (the dock
      // is not `ready` meanwhile) and the op store asks about its runs; the boards' page context is blocked while
      // the port is down and reads itself again, and the preview asks about its runs and the sends of its fans.
      if (rpc.state() === 'ready') sendHealth();
    }),
    rpc.onEvent('settings.changed', (state) => {
      const before = ui;
      ui = readSettings(state);
      // The theme follows the settings at once (ST-122): host, system, light or dark.
      scheme.set(schemeOf());
      const language = languageOf(ui);
      if (language === languageOf(before)) return;
      // The language switches on the fly (I18-001): the port tells every controller, every view is said anew.
      void loadCatalog(language).then(() => i18n.setLanguage(language));
    }),
  );

  // ── stage two: Recap, Review, Coach — then the keys ────────────────────────
  stageTwo = Promise.all([env.lazy<typeof AnalysisChunk>('ai-analysis'), env.lazy<typeof CoachChunk>('ai-coach')])
    .then(([analysis, coach]) => {
      if (!disposed) startAnalysis(ai, analysis, coach);
    })
    .catch((error: unknown) => {
      // The dock works without them; their buttons answer CG-UI-FAILED until the tab is reloaded.
      logger.error('tab.app', 'a part of the application did not load', { code: 'CG-UI-FAILED', fields: { part: 'analysis', name: error instanceof Error ? error.name : typeof error } });
    })
    .then(() => {
      stageTwoIn = true;
      if (disposed) return;
      syncDock();
      // From here a key runs at once; the one kept until now goes first (HK-024).
      keys.dispatcher.connect({
        ...navigation.sink,
        run(command) {
          health?.action('key');
          navigation.sink.run(command);
        },
      });
    });

  function ensureBoards(): Promise<TabBoards> {
    return (boards ??= Promise.all([stageTwo, env.lazy<typeof BoardsChunk>('boards'), env.lazy<typeof PreviewChunk>('boards-preview')]).then(
      ([, chunk, preview]) =>
        startBoards(world, chunk, preview, facts, {
          bind: (results) => ai.workspace.bindBoards(results),
          // §6.5: the chat is open — its dock goes on with the result. What the dock could not take is said aloud.
          handover(handover) {
            void ai.workspace.adoptBoardResult(handover).then(
              (taken) => taken,
              () => false,
            ).then((taken) => {
              // Said only in the chat it is about: the person may have gone on while the dock waited for the field.
              const left = disposed ? null : handoverToast(handover.outcome, taken, chatOnScreen(host.current().route, handover.chat));
              if (left !== null) say(left.code, left.scope, left.title);
            });
          },
        }),
      (error: unknown) => {
        boards = null;
        logger.error('tab.app', 'a part of the application did not load', { code: 'CG-UI-FAILED', fields: { part: 'boards', name: error instanceof Error ? error.name : typeof error } });
        toasts.show({ kind: 'error', code: 'CG-UI-FAILED', scope: 'surface.boards', title: { key: 'cg.uiFailed.title' }, body: { key: 'cg.uiFailed.body' } });
        throw error;
      },
    ));
  }
  offs.push(() => void boards?.then((started) => started.dispose()).catch(() => undefined));

  // ── client_health, behind everything the person sees ───────────────────────
  void env
    .lazy<typeof HealthChunk>('tab-health')
    .then((chunk) => {
      if (disposed) return;
      health = chunk.startTabHealth({
        send: (report) => rpc.request('health.report', { report }).then((answer) => answer.ok),
        contract: () => host.current().contract,
        diagnostics: host.diagnostics === undefined ? undefined : () => host.diagnostics!(),
        domNodes,
        now: () => Date.now(),
        perfNow: () => win.performance.now(),
        setInterval: (fn, ms) => win.setInterval(fn, ms),
        clearInterval: (handle) => win.clearInterval(handle as number),
      });
    })
    .catch(() => undefined);
  offs.push(() => health?.dispose());

  if (probe !== null) {
    // What the dock really shows, read from its view model and inside our closed root (WebDriver cannot).
    let reporting = false;
    const report = (): void => {
      if (reporting) return;
      reporting = true;
      // After the next paint — or a moment later in a tab the browser does not paint (hidden).
      let done = false;
      const read = (): void => {
        if (done) return;
        done = true;
        reporting = false;
        const root = mounts.dock.root;
        const hostElement = mounts.dock.host;
        const dock = router.getSnapshot({ of: 'dock' });
        const session = ai.workspace.env.session ?? null;
        const result = dock.result;
        // Where a pointer has to go to press what is inside the closed root: the centres of the strip's actions,
        // of each part's «Вставить» and of the banner's button, in viewport pixels. Nothing of a text.
        const hits: Record<string, { x: number; y: number }> = {};
        const hit = (name: string, element: Element | null | undefined): void => {
          const rect = element?.getBoundingClientRect();
          if (rect !== undefined && rect.width > 0 && rect.height > 0) hits[name] = { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
        };
        // The tone buttons stand in a slot of their own right after Reply: it is not an action's slot.
        const slots = [...root.querySelectorAll('.cg-strip__acts > .cg-slot:not(.cg-slot--more):not(.cg-slot--tones)')];
        Object.keys(dock.actions).forEach((id, index) => hit(`action:${id}`, slots[index]?.querySelector('button')));
        for (const row of root.querySelectorAll('[data-cg-part]')) hit(`insert:${row.getAttribute('data-cg-part') ?? ''}`, row.querySelector('.cg-ins'));
        // The one button of the status banner («Войти», «Назначить персону», «Повторить», «Подробнее»).
        hit('banner', root.querySelector('.cg-banner > .cg-btn--line'));
        probe.set('dock', {
          styleMode: mounted.dockStyleMode,
          kind: mounts.points().dock.kind,
          // MAIN's name of the field the dock stands over: another one after ChatSpace rendered the field again.
          composer: mounts.points().dock.composerInstanceId,
          inFlowFirstChild: hostElement.parentElement?.firstElementChild === hostElement,
          visible: dock.visible,
          status: dock.status,
          view: dock.view.s,
          mode: dock.mode,
          login: session?.login ?? '',
          persona: dock.persona?.label ?? '',
          // The hub page the open account is bound to (its label), once a generation could start for it.
          page: ai.workspace.situation().ready?.target.binding.pageLabel ?? '',
          banner: dock.statusError?.code ?? null,
          // The one status line of a dock that is otherwise ready (the owner switched the page off): its code.
          notice: dock.notice?.code ?? null,
          contract: contractOf(host.current().contract, site.contract),
          target: dock.targetHandle,
          actions: Object.fromEntries(Object.entries(dock.actions).map(([id, action]) => [id, action.enabled])),
          result:
            result === null
              ? null
              : {
                  opId: result.opId,
                  feature: result.feature,
                  state: result.state,
                  streaming: result.streamText !== null,
                  parts: result.parts?.length ?? 0,
                  inserted: (result.parts ?? []).filter((part) => part.insert === 'done').length,
                  error: result.error?.code ?? null,
                },
          refusal: dock.refusal?.error.code ?? null,
          // «Идут сейчас» of a refused start, and the generations of this tab that run in other chats: ids only.
          refusalRunning: (dock.refusal?.running ?? []).map((op) => op.opId),
          runningElsewhere: dock.runningElsewhere.map((op) => op.opId),
          hits,
          analysis: dock.analysis,
          resultStyle: dock.resultStyle,
          overlays: keys.overlays.list(),
          surfaces: mounted.mounted(),
          views: router.views(),
          // Rendered: what the closed root really holds.
          strip: root.querySelector('[data-cg-surface="dock"]') !== null,
          buttons: root.querySelectorAll('button').length,
          text: root.querySelector('[data-cg-surface="dock"]')?.textContent ?? null,
          height: hostElement.getBoundingClientRect().height,
          scheme: hostElement.getAttribute('data-scheme'),
          language: i18n.language,
        });
      };
      win.requestAnimationFrame(read);
      win.setTimeout(read, 250);
    };
    reportDock = report;
    offs.push(mounts.onChange(report), router.subscribe({ of: 'dock' }, report), keys.overlays.subscribe(report), i18n.subscribe(report), scheme.subscribe(report));
    void stageTwo.then(report);
    report();
    // The toasts on screen as their view model has them (R20 P8a): kind, code and the chat each «Открыть чат» names —
    // its handle carries the operation's own conversation on Fansly. Ids only, nothing of a text.
    const reportToasts = (): void =>
      probe.set(
        'toasts',
        shell.getSnapshot({ of: 'toasts' }).toasts.map((toast) => ({
          kind: toast.kind,
          code: toast.code,
          chats: toast.actions.flatMap((button) => (button.action.type === 'Navigate' && button.action.to.kind === 'chat' ? [button.action.to.targetHandle] : [])),
        })),
      );
    offs.push(shell.subscribe({ of: 'toasts' }, reportToasts));
  }

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const off of offs.splice(0).reverse()) {
      try {
        off();
      } catch {
        // Whatever is left goes with the document.
      }
    }
    router.dispose();
    void forwarder.flush();
  };
  env.life.addEventListener('abort', dispose, { once: true });
  offs.push(() => env.life.removeEventListener('abort', dispose));
  // The last records and the last health window reach the background while the page goes away (best effort).
  const onPageHide = (): void => {
    health?.report();
    void forwarder.flush();
  };
  win.addEventListener('pagehide', onPageHide);
  offs.push(() => win.removeEventListener('pagehide', onPageHide));

  /**
   * The person clicked on our popup or options page; the background brought this tab to the front and handed the
   * click over its port (§9.9; PU-017, ST-076). It runs as that click: the gate opens a navigation grant for it —
   * nothing else — and the router does the rest, loading the boards if the window is theirs.
   */
  const command = (asked: PageCommand): void => {
    if (disposed) return;
    const action: UiAction =
      asked.kind === 'surface'
        ? { type: 'Navigate', to: { kind: 'surface', surface: asked.surface, open: true } }
        : { type: 'Navigate', to: { kind: 'account', accountHandle: navigationChunk.accountHandle(asked.hostAccountId) } };
    tokens.vouched();
    void client.dispatch(action).then(
      (receipt) => {
        if (!receipt.ok) logger.warn('tab.command', 'a page command was refused', { code: receipt.code, fields: { kind: asked.kind } });
      },
      () => undefined,
    );
  };

  return { redeem, tokens, command, dispose };
}
