// The chatter's log of a site's tab (2026-10-21, «Скачать лог»): what the person pressed, what our surfaces
// decided and why, the toasts, what the site did that changes our decisions, and the configuration — written into
// the tab's log, which the background keeps for the file the chatter sends the owner. Wiring only: the records'
// words and the maps of what is on and off are `@cg/core/application/journal`'s.
//
// One place hears every action: the tab's AppClient (client.ts) hands each one here in the step of its click or key,
// with what the gate saw of that click. The decisions are read from the view models the surfaces draw — the dock
// always, a board and its preview while its window is open — so a function that goes grey is written once, when it
// does, and once again when it comes back. Nothing of a conversation is read here: the models' ids, codes and our
// own sentences only.

import type { CgCode, CgErrorView } from '@cg/contracts/errors';
import type { HostContractReport, HostContractShape, HostPort } from '@cg/contracts/host';
import { chatKeyOf, type HostAccount } from '@cg/contracts/ids';
import type { BackgroundToast } from '@cg/contracts/tab-messages';
import type { SettingsV1 } from '@cg/contracts/settings';
import type { ActionReceipt, I18n, NewcomersVM, PreviewSource, PreviewVM, SpendersBoardVM, ToastRequest, UiAction } from '@cg/contracts/vm';
import type { AppRouter } from '@cg/core/application';
import type { TabEnvironment } from '@cg/core/application/ai';
import {
  configFacts,
  createActionJournal,
  createConfigWatch,
  createDecisionWatch,
  dockAvailability,
  logToast,
  newcomersAvailability,
  previewAvailability,
  spendersAvailability,
  type ActionContext,
  type AvailabilityMap,
  type DecisionWatch,
} from '@cg/core/application/journal';
import type { OverlayState } from '@cg/core/application/navigation';
import type { Logger } from '@cg/core/domain/logging';
import type { TabRpcClient } from '@cg/platform';

import type { GestureGate } from './action-gate';
import { contractFactsOf } from './host-facts';

export interface TabJournalDeps<P extends HostPort> {
  readonly win: Window;
  readonly logger: Logger;
  readonly router: AppRouter;
  readonly overlays: OverlayState;
  readonly gate: Pick<GestureGate, 'describe'>;
  readonly host: P;
  readonly contract: HostContractShape;
  /** The contract in one word (tab/app.ts `contractOf`). */
  readonly contractWord: (report: HostContractReport) => string;
  readonly i18n: Pick<I18n, 'text'>;
  readonly errorOf: (code: CgCode) => CgErrorView;
  readonly env: Pick<TabEnvironment, 'session' | 'settings' | 'bootstrap' | 'catalog' | 'binding' | 'persona' | 'subscribe'>;
  readonly rpc: Pick<TabRpcClient, 'onState' | 'state'>;
  readonly version: string;
  readonly contractsVersion: string;
}

export interface TabJournal {
  /** The AppClient took the person's action (client.ts `onPressed`): its record, and where its answer goes. */
  pressed(action: UiAction): (receipt: ActionReceipt | null) => void;
  /** A click of our popup or settings page, brought to this tab: the actions it dispatches are that page's. */
  asCommand<T>(run: () => T): T;
  /** A click on one of our controls that is off (RenderMarks.offClick): nothing was dispatched, the log says why. */
  offClick(control: string, reason: string): void;
  /** The toast host's `onShow`. */
  toast(request: ToastRequest): void;
  /** A toast of the background, and whether this tab showed it (the open chat's dock may say it itself). */
  backgroundToast(toast: BackgroundToast, shown: boolean): void;
  /** Settings the tab heard of (`settings.get`, `settings.changed`). */
  settings(settings: SettingsV1): void;
  /** A surface of the site's own (Fansly's notes and vault): its decisions by the same rules. */
  watch(surface: string): DecisionWatch;
  dispose(): void;
}

/** Where a board's preview is drawn: the board's own window, or the palette's preview window. */
const PREVIEW_WINDOW: Readonly<Record<PreviewSource, string>> = { spenders: 'spenders', newcomers: 'newcomers', palette: 'preview' };
/** How long a burst of changes of the configuration is waited out before its snapshot. */
const CONFIG_SETTLE_MS = 600;
/**
 * A surface's state is read once it has held this long: a chat that is switching shows its composer missing for a
 * moment, a streaming result redraws every 50 ms — none of that is a decision the person saw.
 */
const DECISION_SETTLE_MS = 400;

export function startTabJournal<P extends HostPort>(deps: TabJournalDeps<P>): TabJournal {
  const { win, logger, router, overlays, host } = deps;
  const offs: (() => void)[] = [];
  const clock = { now: () => Date.now(), setTimer: (ms: number, fn: () => void): unknown => win.setTimeout(fn, ms), clearTimer: (handle: unknown) => win.clearTimeout(handle as number) };
  const say = (message: Parameters<I18n['text']>[0]): string => {
    try {
      return deps.i18n.text(message);
    } catch {
      return message.key;
    }
  };
  const guard = (work: () => void): void => {
    try {
      work();
    } catch {
      // The log never breaks the tab.
    }
  };

  // ── actions ──
  const actions = createActionJournal(logger, clock);
  let command = 0;
  const contextOf = (): ActionContext => {
    if (command > 0) return { input: 'command', via: 'popup' };
    const seen = deps.gate.describe();
    const via = seen.via === 'overlay' ? (overlays.top() ?? 'overlay') : seen.via;
    return { input: seen.input, via };
  };

  // ── decisions: the dock always, a board and its preview while its window is open ──
  /** The latest model of a surface, read once it settled (DECISION_SETTLE_MS). */
  const settled = <V>(read: (vm: V) => void): ((vm: V) => void) => {
    let latest: V | null = null;
    let timer: number | null = null;
    offs.push(() => {
      if (timer !== null) win.clearTimeout(timer);
    });
    return (vm) => {
      latest = vm;
      if (timer !== null) win.clearTimeout(timer);
      timer = win.setTimeout(() => {
        timer = null;
        const now = latest;
        if (now !== null) guard(() => read(now));
      }, DECISION_SETTLE_MS);
    };
  };
  const dock = createDecisionWatch(logger, 'dock');
  offs.push(
    router.subscribe(
      { of: 'dock' },
      settled((vm) => {
        const chat = host.current().route.chat;
        if (chat === null || !vm.visible) {
          dock.reset();
          return;
        }
        dock.see(chatKeyOf(chat), dockAvailability(vm, say));
      }),
    ),
  );
  const boardWatch = <V>(surface: string, window: string, subscribe: (listener: (vm: V) => void) => () => void, mapOf: (vm: V) => { readonly subject: string | null; readonly map: AvailabilityMap | null }): void => {
    const watch = createDecisionWatch(logger, surface);
    offs.push(
      subscribe(
        settled((vm: V) => {
          if (!overlays.isOpen(window as never)) {
            watch.reset();
            return;
          }
          const { subject, map } = mapOf(vm);
          if (subject === null) watch.reset();
          else watch.see(subject, map);
        }),
      ),
      overlays.subscribe(() => {
        if (!overlays.isOpen(window as never)) watch.reset();
      }),
    );
  };
  boardWatch<SpendersBoardVM>('spenders', 'spenders', (listener) => router.subscribe({ of: 'spenders.board' }, listener), (vm) => ({ subject: 'spenders', map: spendersAvailability(vm, say) }));
  boardWatch<NewcomersVM>('newcomers', 'newcomers', (listener) => router.subscribe({ of: 'newcomers' }, listener), (vm) => ({ subject: 'newcomers', map: newcomersAvailability(vm, say) }));
  for (const from of ['spenders', 'newcomers', 'palette'] as const satisfies readonly PreviewSource[]) {
    boardWatch<PreviewVM>(`preview:${from}`, PREVIEW_WINDOW[from], (listener) => router.subscribe({ of: 'preview', from }, listener), (vm) => ({ subject: vm.handle, map: previewAvailability(vm, say) }));
  }

  // ── what the site did that our decisions follow ──
  let accounts = '';
  let routeAccount: string | null | undefined = undefined;
  offs.push(
    host.subscribe((event) =>
      guard(() => {
        if (event.type === 'coverage') {
          logger.info('tab.site', 'socket coverage', { fields: { accountId: event.coverage.hostAccountId, state: event.coverage.state, reason: event.coverage.reason } });
        } else if (event.type === 'accounts') {
          const ids = event.accounts.map((account: HostAccount) => account.hostAccountId).sort();
          if (ids.join(',') === accounts) return;
          accounts = ids.join(',');
          logger.info('tab.site', 'accounts', { fields: { accountCount: ids.length, accountIds: ids.slice(0, 50) } });
        } else if (event.type === 'route') {
          const account = event.route.account?.hostAccountId ?? null;
          if (account !== routeAccount) {
            routeAccount = account;
            logger.info('tab.site', 'account on screen', { fields: { accountId: account } });
          }
          scheduleConfig('route');
        } else if (event.type === 'humanSend') {
          logger.info('tab.site', 'chatter sent', {
            ctx: { chatKey: chatKeyOf(event.fact.chat) },
            fields: { fanId: event.fact.chat.platformFanId, messageId: event.fact.platformMessageId, ours: event.fact.draft.insertIntentId !== null, ...(event.fact.draft.insertIntentId === null ? {} : { intentId: event.fact.draft.insertIntentId }) },
          });
        } else if (event.type === 'sendFuse') {
          logger.warn('tab.site', 'send fuse', { fields: { reason: event.fuse.reason, source: event.fuse.where, attemptId: event.fuse.attemptId } });
        } else if (event.type === 'reloadNeeded') {
          logger.warn('tab.site', 'reload needed');
        }
      }),
    ),
  );
  let connection = deps.rpc.state();
  offs.push(
    deps.rpc.onState(() =>
      guard(() => {
        const state = deps.rpc.state();
        if (state === connection) return;
        connection = state;
        logger.info('tab.site', 'connection', { fields: { state } });
        scheduleConfig('connection');
      }),
    ),
  );

  // ── the configuration: at the start, then whenever any of it changes ──
  const config = createConfigWatch(logger);
  let settingsNow: SettingsV1 | null = null;
  let configTimer: number | null = null;
  let configWhy: string | null = null;
  function scheduleConfig(why: string): void {
    configWhy ??= why;
    if (configTimer !== null) return;
    configTimer = win.setTimeout(() => {
      configTimer = null;
      const trigger = configWhy ?? 'change';
      configWhy = null;
      guard(() => config.see(snapshot(), trigger));
    }, CONFIG_SETTLE_MS);
  }
  function snapshot(): Readonly<Record<string, unknown>> {
    const now = host.current();
    const facts = contractFactsOf(now.contract, deps.contract);
    const session = deps.env.session;
    const account = now.route.account;
    const binding = account === null || session === null || session === undefined ? null : deps.env.binding(account);
    const bootstrap = deps.env.bootstrap.s === 'ready' ? deps.env.bootstrap.value : null;
    const bound = binding?.s === 'ready' ? binding.value : null;
    const page = bound === null ? undefined : bootstrap?.pages.find((item) => item.pageId === bound.pageId);
    const catalog = deps.env.catalog.s === 'ready' ? deps.env.catalog.value.personas : [];
    const persona = bound === null ? null : deps.env.persona(bound.pageId);
    const settings = deps.env.settings?.settings ?? settingsNow;
    return configFacts({
      version: deps.version,
      contractsVersion: deps.contractsVersion,
      site: host.kind,
      siteBuild: facts.build,
      contract: deps.contractWord(now.contract),
      missing: facts.missing,
      degraded: facts.degraded,
      signIn: session === undefined ? undefined : session === null ? null : { userId: session.userId, role: session.role, epoch: session.epoch, hubOrigin: session.hubOrigin },
      accountId: account?.hostAccountId ?? null,
      accounts: now.accounts.length,
      page: bound === null ? null : { pageId: bound.pageId, pageName: page?.title ?? bound.pageLabel, bindingRevision: bound.bindingRevision },
      bindingCode: binding?.s === 'error' ? binding.error.code : null,
      bootstrap,
      settings,
      persona: persona === null ? null : { status: persona.status, key: persona.key, label: persona.label },
      personaNames: catalog.filter((item) => item.status === 'active').map((item) => item.displayName),
      debug: settings?.debug.enabled ?? false,
    });
  }
  offs.push(
    deps.env.subscribe(() => scheduleConfig('environment')),
    host.onContract(() => scheduleConfig('contract')),
    () => {
      if (configTimer !== null) win.clearTimeout(configTimer);
    },
  );
  scheduleConfig('start');

  return {
    pressed(action) {
      try {
        return actions.pressed(action, contextOf());
      } catch {
        return () => undefined;
      }
    },
    asCommand(run) {
      command += 1;
      try {
        return run();
      } finally {
        command -= 1;
      }
    },
    offClick(control, reason) {
      guard(() => {
        const context = contextOf();
        logger.info('ui.action', 'pressed while off', { fields: { control, say: reason, input: context.input, via: context.via } });
      });
    },
    toast(request) {
      guard(() => logToast(logger, { kind: request.kind, code: request.code, scope: request.scope, say: say(request.title) }));
    },
    backgroundToast(toast, shown) {
      guard(() =>
        logToast(
          logger,
          { kind: toast.kind, code: toast.code ?? null, scope: toast.scope, say: toast.code === undefined ? null : deps.errorOf(toast.code).title },
          { shown, ...(toast.feature === undefined ? {} : { feature: toast.feature }), ...(toast.opId === undefined ? {} : { opId: toast.opId }), ...(toast.chat === undefined ? {} : { fanId: toast.chat.platformFanId }) },
        ),
      );
    },
    settings(settings) {
      settingsNow = settings;
      scheduleConfig('settings');
    },
    watch: (surface) => createDecisionWatch(logger, surface),
    dispose() {
      for (const off of offs.splice(0).reverse()) {
        try {
          off();
        } catch {
          // Whatever is left goes with the document.
        }
      }
    },
  };
}
