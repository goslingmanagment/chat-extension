// The tab's application — the lazy chunk `tab-app` (architecture.md §10.2,
// §11): the AppClient as a router of surface controllers, the texts of one
// language, the tab's logger, and — until R11 and R14 land — the TEMPORARY
// dock status controller with its status row. Loaded when ChatSpace shows a
// composer; everything it needs from the early bundle comes in through `env`
// (no browser API, no build constants here: a lazy chunk is a plain module).
//
// What R11/R12/R14/R15/R17 plug in later, without touching this file's
// wiring: their controllers go to `router.register(...)`, their surfaces are
// mounted with the same `deps` (MountDeps), and writes spend action tokens
// asked for through `tokens.issue` while the click or the key press is still
// in flight (tab/action-gate.ts).

import type { CgCode, CgErrorView } from '@cg/contracts/errors';
import type { HostContractReport } from '@cg/contracts/host';
import type { HostAccount, SessionIdentity } from '@cg/contracts/ids';
import type { Locale } from '@cg/contracts/i18n/keys';
import { LOG_LIMITS } from '@cg/contracts/limits';
import type { UiLocale, UiTheme } from '@cg/contracts/settings';
import type { TabHealthReport } from '@cg/contracts/telemetry';
import type { ColorScheme, MountDeps, SurfaceGeometry, ValueSignal } from '@cg/contracts/vm';
import { createAppRouter, createTempDockStatus, createUnboundCatalog, type TempDockSmoke } from '@cg/core/application';
import { viewOfCode } from '@cg/core/domain/errors';
import { createLiveI18n, resolveLocale, translatorOf } from '@cg/core/domain/i18n/live';
import { createLogForwarder, createLogger, installErrorCapture, logEvent, logHostContract } from '@cg/core/domain/logging';
import type { ChatSpaceHostPort, HostDiagnostic, MountDiagnostic, MountManager, ThemeReader, TokenRedeemer } from '@cg/host-chatspace/isolated';
import type { TabRpcClient } from '@cg/platform';

import type * as DockChunk from '../../../lazy/entries/dock';
import { createActionTokens, createGestureGate, type TabActionTokens } from './action-gate';
import type { TabProbe } from './probe';

export type { TabActionTokens } from './action-gate';

export interface TabAppEnv {
  readonly win: Window;
  readonly life: AbortSignal;
  readonly rpc: TabRpcClient;
  readonly host: ChatSpaceHostPort;
  readonly mounts: MountManager;
  readonly theme: ThemeReader;
  readonly lazy: <T>(path: string) => Promise<T>;
  readonly chunks: { readonly dock: string; readonly i18n: (language: string) => string };
  /** `moz-extension://<uuid>`: errors pointing at it are ours (ER-021). */
  readonly ownOrigin: string;
  readonly contractsVersion: string;
  readonly lateInjection: boolean;
  readonly staleHosts: number;
  readonly setNavInsertTimeoutMs: (ms: number) => void;
  readonly takeDiagnostics: (listener: (diagnostic: HostDiagnostic | MountDiagnostic) => void) => (HostDiagnostic | MountDiagnostic)[];
  /** Test builds only. */
  readonly probe: TabProbe | null;
}

export interface TabApp {
  /** `token.redeem` for HostPort: the token of a click is spent before a write reaches MAIN (§14). */
  readonly redeem: TokenRedeemer;
  /** For the controllers of R11/R12: the token of the human action in flight, asked for before the action it allows. */
  readonly tokens: TabActionTokens;
  dispose(): void;
}

/** A value that changes, as MountDeps takes it (scheme, geometry, the smoke lines). */
class Value<T> implements ValueSignal<T> {
  private readonly listeners = new Set<(value: T) => void>();
  constructor(private current: T) {}
  get value(): T {
    return this.current;
  }
  set(next: T): void {
    if (JSON.stringify(next) === JSON.stringify(this.current)) return;
    this.current = next;
    for (const listener of [...this.listeners]) listener(next);
  }
  subscribe(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/** What the tab reads of the settings (the rest is the controllers' business). */
interface UiSettings {
  readonly locale: UiLocale;
  readonly theme: UiTheme;
  readonly debug: boolean;
}
const UNKNOWN_SETTINGS: UiSettings = { locale: 'system', theme: 'host', debug: false };

/** Codes of `binding.resolve` that mean «not yet», not «no». */
const NOT_YET: readonly CgCode[] = ['CG-DATA-NOT-READY', 'CG-AUTH-REQUIRED', 'CG-RUNTIME-UNREACHABLE'];

export async function startTabApp(env: TabAppEnv): Promise<TabApp> {
  const { win, rpc, host, mounts, probe } = env;
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
  if (firstSettings.ok) ui = readSettings(firstSettings.payload);

  // ── texts: one language, its own lazy chunk (§11) ──────────────────────────
  const catalogs: Partial<Record<Locale, Readonly<Record<string, unknown>>>> = {};
  const loadCatalog = async (language: Locale): Promise<void> => {
    if (catalogs[language] !== undefined) return;
    catalogs[language] = (await env.lazy<{ readonly CATALOG: Readonly<Record<string, unknown>> }>(env.chunks.i18n(language))).CATALOG;
  };
  const languageOf = (settings: UiSettings): Locale => resolveLocale(settings.locale, win.navigator.languages);
  await loadCatalog(languageOf(ui));
  const i18n = createLiveI18n((language) => catalogs[language] ?? null, {
    language: languageOf(ui),
    onMissing: (key, language) => logger.warn('tab.i18n', 'text missing', { fields: { key, language } }),
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
  logEvent(logger, 'tabStarted', { fields: { lateInjection: env.lateInjection, staleHosts: env.staleHosts, contracts: env.contractsVersion } });
  const onDiagnostic = (diagnostic: HostDiagnostic | MountDiagnostic): void => {
    const code = 'code' in diagnostic ? diagnostic.code : undefined;
    const detail = 'detail' in diagnostic ? diagnostic.detail : 'count' in diagnostic && diagnostic.count !== undefined ? { count: diagnostic.count } : undefined;
    logger.info('tab.host', diagnostic.event, { ...(code === undefined ? {} : { code }), ...(detail === undefined ? {} : { fields: detail }) });
  };
  for (const diagnostic of env.takeDiagnostics(onDiagnostic)) onDiagnostic(diagnostic);

  // ── the AppClient: a router of surface controllers ─────────────────────────
  const router = createAppRouter({
    errorOf,
    onFailure: (failure) => logger.warn('tab.ui', 'router refused', { code: 'CG-UI-FAILED', fields: { ...failure } }),
  });
  // TEMPORARY (M1): the dock's status until R11's dock controller serves `dock`.
  const dock = createTempDockStatus({ errorOf });
  offs.push(router.register(dock));

  // ── action tokens (§14): only for a trusted click or key press in flight, spent once ──
  const gate = createGestureGate(win, { doc: win.document, mounts });
  offs.push(() => gate.dispose());
  const { tokens, redeem } = createActionTokens({
    gate,
    async request(kind, surface) {
      const answer = await rpc.request('token.issue', { kind, surface });
      return answer.ok ? answer.payload.actionToken : null;
    },
    async spend(request) {
      const answer = await rpc.request('token.redeem', request);
      return answer.ok && answer.payload.redeemed;
    },
    onRefused: (facts) => logger.warn('tab.tokens', 'no action token: not a human action in flight', { fields: { ...facts } }),
  });

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
  offs.push(mounts.onChange(() => geometry.set(geometryOf())));


  // ── what the dock's status is made of ──────────────────────────────────────
  /** null — not signed in, or the background has not said yet. */
  let session: SessionIdentity | null = null;
  let boundFor = '';
  /** A newer request of the same kind makes an older answer stale. */
  let bindingRound = 0;
  let bootstrapRound = 0;

  const runtimeOf = (): 'connecting' | 'ready' | 'unreachable' | 'reloaded' => {
    const state = rpc.state();
    return state === 'ready' ? 'ready' : state === 'reloaded' ? 'reloaded' : state === 'lost' || state === 'closed' ? 'unreachable' : 'connecting';
  };

  async function resolveBinding(account: HostAccount | null, force = false): Promise<void> {
    const key = account === null || session === null ? '' : `${session.epoch}|${account.hostAccountId}|${account.platformAccountId ?? ''}`;
    if (!force && key === boundFor) return;
    boundFor = key;
    const round = ++bindingRound;
    if (account === null || session === null) {
      dock.update({ binding: { state: 'none' } });
      return;
    }
    dock.update({ binding: { state: 'loading' } });
    const answer = await rpc.request('binding.resolve', { account });
    if (round !== bindingRound || disposed) return;
    if (!answer.ok) {
      // «Not yet» is asked again with the next route, account or bootstrap event; a refusal is shown with its code.
      if (NOT_YET.includes(answer.error.code)) boundFor = '';
      dock.update({ binding: NOT_YET.includes(answer.error.code) ? { state: 'loading' } : { state: 'refused', code: answer.error.code } });
      return;
    }
    const { binding } = answer.payload;
    const page = pages.get(binding.pageId) ?? null;
    dock.update({ binding: { state: 'bound', binding, pageTitle: page } });
  }

  /** Page titles of the last bootstrap, for the smoke line. */
  const pages = new Map<number, string>();
  async function readBootstrap(): Promise<void> {
    const round = ++bootstrapRound;
    if (session === null) {
      pages.clear();
      dock.update({ hub: { state: 'unknown' } });
      return;
    }
    const answer = await rpc.request('bootstrap.get', {});
    if (round !== bootstrapRound || disposed) return;
    if (!answer.ok) {
      dock.update({ hub: { state: 'failed', code: answer.error.code } });
      return;
    }
    pages.clear();
    for (const page of answer.payload.pages) pages.set(page.pageId, page.title);
    env.setNavInsertTimeoutMs(answer.payload.limits.navInsertTimeoutSec * 1000);
    dock.update({ hub: { state: 'ok' } });
    await resolveBinding(host.current().route.account, true);
  }

  async function onSession(next: SessionIdentity | null): Promise<void> {
    session = next;
    boundFor = '';
    dock.update({ session: next, binding: { state: 'none' }, hub: { state: 'unknown' } });
    await readBootstrap();
  }

  // host → status
  const snapshot = host.current();
  dock.update({
    runtime: runtimeOf(),
    needsReload: env.lateInjection,
    route: snapshot.route,
    contract: snapshot.contract,
    composer: snapshot.composer === null ? null : { ready: snapshot.composer.ready, hidden: snapshot.composer.hidden },
  });
  offs.push(
    host.subscribe((event) => {
      if (event.type === 'route') {
        dock.update({ route: event.route });
        void resolveBinding(event.route.account);
      } else if (event.type === 'composer') {
        dock.update({ composer: event.composer === null ? null : { ready: event.composer.ready, hidden: event.composer.hidden } });
      } else if (event.type === 'accounts') {
        void resolveBinding(host.current().route.account);
      } else if (event.type === 'reloadNeeded') {
        dock.update({ needsReload: true });
      }
    }),
  );

  // host contract → status, log, client_health (the background keeps it for «Статус»).
  // The tab measures nothing yet: its health report carries the contract only. R18's
  // TabHealthCollector takes this over with the first metric a controller records
  // (it is left out of this chunk until then: §11, 30 KiB).
  let healthFrom = Date.now();
  const healthReport = (report: HostContractReport, domNodes: number): TabHealthReport => {
    const to = Date.now();
    const out: TabHealthReport = { windowFrom: healthFrom, windowTo: to, host: report, perf: [], counters: {}, footprint: { cachesKB: 0, domNodes } };
    healthFrom = to;
    return out;
  };
  const sendHealth = (report: HostContractReport): void => {
    const nodes = mounts.dock.root.querySelectorAll('*').length;
    void rpc.request('health.report', { report: healthReport(report, nodes) });
  };
  let contractLogged = false;
  const reportContract = (report: HostContractReport): void => {
    dock.update({ contract: report });
    const missing = Object.entries(report.anchors)
      .filter(([, state]) => state !== 'ok')
      .map(([anchor]) => anchor);
    const degraded = Object.entries(report.capabilities)
      .filter(([, capability]) => capability.state !== 'on')
      .map(([name]) => name);
    logHostContract(logger, { build: report.build, adapterVersion: report.adapterVersion, ok: missing.length === 0, missing, degraded }, contractLogged);
    contractLogged = true;
    sendHealth(report);
  };
  offs.push(host.onContract(reportContract));
  reportContract(snapshot.contract);

  // background → status
  offs.push(
    rpc.onState(() => {
      dock.update({ runtime: runtimeOf() });
      if (rpc.state() !== 'ready') return;
      // A new tab session after a lost port: the background started again. It may have another sign-in…
      void rpc.request('session.get', {}).then((answer) => (answer.ok ? onSession(answer.payload.session) : undefined));
      // …and it kept nothing of this tab in memory: the host contract («Статус», client_health) goes to it again.
      sendHealth(host.current().contract);
    }),
    rpc.onEvent('session.changed', (event) => void onSession(event.session)),
    rpc.onEvent('bootstrap.changed', () => void readBootstrap()),
    rpc.onEvent('settings.changed', (state) => {
      const before = ui;
      ui = readSettings(state);
      scheme.set(schemeOf());
      const language = languageOf(ui);
      if (language === languageOf(before)) return;
      void loadCatalog(language).then(() => {
        i18n.setLanguage(language);
        dock.retranslate();
      });
    }),
  );
  const firstSession = await rpc.request('session.get', {});
  if (firstSession.ok) await onSession(firstSession.payload.session);
  else dock.update({ runtime: runtimeOf(), hub: { state: 'failed', code: firstSession.error.code } });

  // ── the UI: MountDeps and the dock surface ─────────────────────────────────
  const deps: MountDeps = {
    client: router,
    i18n,
    // TEMPORARY (M1): keys and their labels are R17's.
    catalog: createUnboundCatalog(/mac/i.test(win.navigator.platform) ? 'mac' : 'win'),
    // Toasts and dialogs are R14's overlay surfaces; nothing raises one yet.
    toasts: { show: () => '', dismiss: () => undefined },
    dialogs: { confirm: () => Promise.resolve('cancel') },
    clipboard: {
      writeText: (text) =>
        win.navigator.clipboard.writeText(text).then(
          () => ({ ok: true }) as const,
          () => ({ ok: false, code: 'CG-CLIPBOARD' }) as const,
        ),
    },
    scheme,
    geometry,
    focus: { token: null, restore: () => false },
    marks: { resultShown: () => undefined, painted: () => undefined },
  };

  const smoke = new Value<TempDockSmoke>(dock.smoke());
  offs.push(dock.onSmoke((next) => smoke.set(next)));

  const dockChunk = await env.lazy<typeof DockChunk>(env.chunks.dock);
  const mounted = dockChunk.mountTempDock(mounts.dock.root, deps, smoke, {
    report: (failure) => logger.error('tab.ui', 'surface failed', { code: failure.code, fields: { kind: failure.kind, surface: failure.surface, name: failure.name } }),
  });
  offs.push(mounted.unmount);

  if (probe !== null) {
    // What the dock really shows, read inside our closed root (WebDriver cannot).
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
        const row = root.querySelector('[data-cg-temp="dock-status"]');
        const hostElement = mounts.dock.host;
        probe.set('dock', {
          styleMode: mounted.styleMode,
          kind: mounts.points().dock.kind,
          inFlowFirstChild: hostElement.parentElement?.firstElementChild === hostElement,
          status: row?.getAttribute('data-cg-status') ?? null,
          mode: row?.getAttribute('data-cg-mode') ?? null,
          login: root.querySelector('[data-cg-temp-login]')?.getAttribute('data-cg-temp-login') ?? null,
          page: root.querySelector('[data-cg-temp-page]')?.getAttribute('data-cg-temp-page') ?? null,
          bindingCode: root.querySelector('[data-cg-temp-binding-code]')?.getAttribute('data-cg-temp-binding-code') ?? null,
          contract: root.querySelector('[data-cg-temp-contract]')?.getAttribute('data-cg-temp-contract') ?? null,
          banner: root.querySelector('[data-cg-code]')?.getAttribute('data-cg-code') ?? null,
          text: row?.textContent ?? null,
          height: hostElement.getBoundingClientRect().height,
          scheme: hostElement.getAttribute('data-cg-scheme'),
          language: i18n.language,
        });
      };
      win.requestAnimationFrame(read);
      win.setTimeout(read, 250);
    };
    offs.push(smoke.subscribe(report), mounts.onChange(report), router.subscribe({ of: 'dock' }, report));
    report();
  }

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const off of offs.splice(0)) {
      try {
        off();
      } catch {
        // Whatever is left goes with the document.
      }
    }
    router.dispose();
    void forwarder.flush();
  };
  env.life.addEventListener('abort', dispose);
  // The last records of the tab reach the background while the page goes away (best effort).
  win.addEventListener('pagehide', () => void forwarder.flush());

  return { redeem, tokens, dispose };
}
