// core/application/shell — what belongs to the tab as a whole and to no
// surface of its own (architecture.md §9.5, §10.2 «тосты»): the `toasts`
// view with the background's toasts — «AI готово · {фан}», a generation of
// another chat that failed, the dossier save of a Recap — and the actions
// that act on the tab itself: «Перезагрузить вкладку» (CG-RUNTIME-RELOADED),
// «Перезагрузить панель» (CG-UI-FAILED), «Настройки» — and the ones that
// lead out of the tab into our own pages or to the clipboard: «Выгрузить
// диагностику» of a failed surface (ER-020; the file is saved by the settings
// page, a content script has nowhere to save it from), «Промпт» of a result's
// debug block (DB-007), «Скопировать код» of an error card (ER-006).
//
// A toast the UI or a controller raises by itself (a key's reason, a render
// failure) goes through ToastPort and is the overlay host's own queue; the
// two queues are drawn together by the toasts surface. The rules are the
// same for both (ER-009…ER-015): 4.5 s, errors 6.5 s, the same code and scope
// replace each other, three on screen, a toast under the pointer or the
// focus keeps its time.
//
// Ports only: no browser.*, no DOM, no timers of its own.

import { type CgCode, type SettingsRoute } from '@cg/contracts/errors';
import { type ChatRef } from '@cg/contracts/ids';
import { type BackgroundToast, type TabEventPayload } from '@cg/contracts/tab-messages';
import { type ActionButtonVM, type ActionReceipt, type I18n, type MountSurfaceKind, type ToastVM, type ToastsVM, type UiAction, type UiActionType, type ViewSelector } from '@cg/contracts/vm';

import { TOAST_TIMING, errorView, settingsRouteOf, toastKey, toastLifetimeMs, viewOfCode } from '../../domain/errors';
import { translatorOf } from '../../domain/i18n/live';

export interface ShellClock {
  now(): number;
  setTimer(ms: number, fn: () => void): unknown;
  clearTimer(handle: unknown): void;
}

/** What the tab itself can do for an action of the shell. */
export interface ShellTab {
  /** Reloads the tab's document. */
  reload(): void;
  /** Mounts a surface again after its render failed; false — it is not on screen. */
  reloadSurface(surface: MountSurfaceKind): boolean;
  /** Opens the settings page at a section; false — it could not be opened. Absent — this tab cannot open our pages. */
  openSettings?(route: SettingsRoute): Promise<boolean>;
  /** Opens the prompt page for the opaque token of a snapshot (DB-006, DB-007); false — debug is off or it could not be opened. */
  openPrompt?(token: string): Promise<boolean>;
  /** Writes a short text of ours to the clipboard, inside the click; false — the browser refused. */
  copyText?(text: string): Promise<boolean>;
  /** 2026-10-21 «Скачать лог»: the log files of the last 24 hours, saved by the tab; false — they were not. Absent — this tab cannot. */
  downloadLog?(): Promise<boolean>;
}

export interface ShellPorts {
  /** The tab ↔ background client: only its `toast` event is read. */
  readonly rpc: { onEvent(type: 'toast', listener: (payload: TabEventPayload<'toast'>) => void): () => void };
  readonly i18n: I18n;
  readonly clock: ShellClock;
  readonly tab: ShellTab;
  /**
   * A chat as the navigation controller names it (`Navigate` → `kind: 'chat'`), with the toast's conversation when it is
   * not the fan (1.15.0, on Fansly); absent — toasts carry no «Открыть чат».
   */
  readonly chatHandle?: (chat: ChatRef, conversationRef?: string) => string;
}

export interface ShellController {
  readonly kinds: readonly ['toasts'];
  getSnapshot(selector: ViewSelector): ToastsVM;
  subscribe(selector: ViewSelector, listener: (view: ToastsVM) => void): () => void;
  dispatch(action: UiAction): Promise<ActionReceipt> | null;
  /** Toasts on screen now (diagnostics, tests). */
  count(): number;
  dispose(): void;
}

interface Entry {
  readonly toast: BackgroundToast;
  /** Epoch ms; null while held. */
  expiresAt: number | null;
  /** Lifetime left when the hold began. */
  left: number;
  timer: unknown;
}

/** A held toast that is let go lives at least this long: the pointer only passed over it. */
const HELD_MIN_LEFT_MS = 1000;

const done = (type: UiActionType, outcome: Extract<ActionReceipt, { ok: true }>['outcome'] = 'done'): ActionReceipt => ({ ok: true, type, outcome });

export function createShellController(ports: ShellPorts): ShellController {
  const { clock, i18n, tab } = ports;
  let entries: Entry[] = [];
  let cached: ToastsVM | null = null;
  const listeners = new Set<(view: ToastsVM) => void>();

  const refused = (type: UiActionType, code: CgCode): ActionReceipt => ({ ok: false, type, code, error: viewOfCode(code, translatorOf(i18n)) });

  const button = (label: ActionButtonVM['label']['key'], action: UiAction): ActionButtonVM => ({ label: { key: label }, action, enabled: true, reason: null, hotkey: null });

  function viewOf(entry: Entry): ToastVM {
    const { toast } = entry;
    const error = toast.error === undefined ? null : errorView(toast.error, translatorOf(i18n));
    const code = toast.code ?? toast.error?.code ?? null;
    const fan = toast.fanLabel;
    const actions: ActionButtonVM[] = [];
    // §9.5: a background toast leads to its chat — by the person's click only.
    if (toast.chat !== undefined && ports.chatHandle !== undefined) actions.push(button('common.openChat', { type: 'Navigate', to: { kind: 'chat', targetHandle: ports.chatHandle(toast.chat, toast.conversationRef) } }));
    const route = code === null ? null : settingsRouteOf(code);
    if (route !== null && tab.openSettings !== undefined) actions.push(button('common.settings', { type: 'OpenSettings', route }));
    let title: string;
    let body: string | null = null;
    if (error !== null) {
      title = fan === null ? error.title : `${error.title} · ${fan}`;
      body = error.body;
    } else if (toast.scope === 'recap.profile') title = i18n.t('recap.savedToast');
    else if (toast.feature !== undefined) title = i18n.t('toast.aiReady', { fan: fan ?? i18n.t(toast.feature === 'recap-short' ? 'dock.action.recap' : `dock.action.${toast.feature}`) });
    else title = i18n.t('result.label');
    return { id: toast.toastId, kind: toast.kind, code, title, body, actions, copyCode: toast.kind === 'error' && code !== null, expiresAt: entry.expiresAt };
  }

  const build = (): ToastsVM => (entries.length === 0 ? { view: { s: 'empty', why: { key: 'common.empty' } }, toasts: [] } : { view: { s: 'ready' }, toasts: entries.map(viewOf) });
  const snapshot = (): ToastsVM => (cached ??= build());
  const changed = (): void => {
    cached = null;
    if (listeners.size === 0) return;
    const view = snapshot();
    for (const listener of [...listeners]) listener(view);
  };

  const stop = (entry: Entry): void => {
    if (entry.timer !== null) clock.clearTimer(entry.timer);
    entry.timer = null;
  };
  const remove = (id: string): boolean => {
    const gone = entries.filter((entry) => entry.toast.toastId === id);
    if (gone.length === 0) return false;
    for (const entry of gone) stop(entry);
    entries = entries.filter((entry) => entry.toast.toastId !== id);
    changed();
    return true;
  };
  const arm = (entry: Entry, lifetime: number): void => {
    stop(entry);
    entry.expiresAt = clock.now() + lifetime;
    entry.timer = clock.setTimer(lifetime, () => {
      entry.timer = null;
      remove(entry.toast.toastId);
    });
  };

  function show(toast: BackgroundToast): void {
    const key = toastKey(toast.code ?? null, toast.scope);
    const same = (entry: Entry): boolean => toastKey(entry.toast.code ?? null, entry.toast.scope) === key;
    for (const entry of entries.filter(same)) stop(entry);
    const entry: Entry = { toast, expiresAt: null, left: 0, timer: null };
    const kept = [entry, ...entries.filter((item) => !same(item))];
    for (const extra of kept.slice(TOAST_TIMING.maxVisible)) stop(extra);
    entries = kept.slice(0, TOAST_TIMING.maxVisible);
    arm(entry, toastLifetimeMs(toast.kind, toast.code ?? null));
    changed();
  }

  const offs = [ports.rpc.onEvent('toast', ({ toast }) => show(toast)), i18n.subscribe(() => changed())];

  return {
    kinds: ['toasts'],
    getSnapshot: () => snapshot(),
    subscribe(_selector, listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch(action) {
      if (action.type === 'DismissToast') {
        // A toast of the overlay host's own queue is not ours to dismiss.
        return entries.some((entry) => entry.toast.toastId === action.toastId) ? Promise.resolve(done(action.type, remove(action.toastId) ? 'done' : 'noop')) : null;
      }
      if (action.type === 'HoldToast') {
        const entry = entries.find((item) => item.toast.toastId === action.toastId);
        if (entry === undefined) return null;
        if (action.hold && entry.expiresAt !== null) {
          entry.left = Math.max(0, entry.expiresAt - clock.now());
          stop(entry);
          entry.expiresAt = null;
          changed();
        } else if (!action.hold && entry.expiresAt === null) {
          arm(entry, Math.max(HELD_MIN_LEFT_MS, entry.left));
          changed();
        }
        return Promise.resolve(done(action.type));
      }
      if (action.type === 'ReloadTab') {
        tab.reload();
        return Promise.resolve(done(action.type));
      }
      if (action.type === 'ReloadSurface') return Promise.resolve(tab.reloadSurface(action.surface) ? done(action.type) : done(action.type, 'noop'));
      if (action.type === 'OpenSettings' && tab.openSettings !== undefined) {
        return tab.openSettings(action.route).then(
          (opened) => (opened ? done(action.type, 'opened') : refused(action.type, 'CG-RUNTIME-UNREACHABLE')),
          () => refused(action.type, 'CG-RUNTIME-UNREACHABLE'),
        );
      }
      // ER-020 «Выгрузить диагностику»: the files are saved by the settings page («Диагностика»); the tab leads there.
      if (action.type === 'ExportDiagnostics' && tab.openSettings !== undefined) {
        return tab.openSettings({ section: 'diagnostics' }).then(
          (opened) => (opened ? done(action.type, 'opened') : refused(action.type, 'CG-RUNTIME-UNREACHABLE')),
          () => refused(action.type, 'CG-RUNTIME-UNREACHABLE'),
        );
      }
      // «Скачать лог» (2026-10-21): the files are saved here, in this click's tab — the dock's button, its key.
      if (action.type === 'DownloadLog' && tab.downloadLog !== undefined) {
        return tab.downloadLog().then(
          (saved) => (saved ? done(action.type) : refused(action.type, 'CG-UNKNOWN')),
          () => refused(action.type, 'CG-RUNTIME-UNREACHABLE'),
        );
      }
      // DB-007 «Промпт»: the page of ours that shows the snapshot; the tab hands over the token and nothing else.
      if (action.type === 'Navigate' && action.to.kind === 'debug-prompt' && tab.openPrompt !== undefined) {
        return tab.openPrompt(action.to.promptHandle).then(
          (opened) => (opened ? done(action.type, 'opened') : refused(action.type, 'CG-NAV-FAILED')),
          () => refused(action.type, 'CG-NAV-FAILED'),
        );
      }
      // ER-006 «Скопировать код» of an error card: the code, what it means and what to do — nothing of a conversation.
      if (action.type === 'CopyReport' && action.scope === 'error' && action.code !== undefined && tab.copyText !== undefined) {
        const view = viewOfCode(action.code, translatorOf(i18n));
        return tab.copyText(`${view.code}: ${view.title}\n${view.body}`).then(
          (copied) => (copied ? done(action.type) : refused(action.type, 'CG-CLIPBOARD')),
          () => refused(action.type, 'CG-CLIPBOARD'),
        );
      }
      // Everything else belongs to a surface's own controller.
      return null;
    },
    count: () => entries.length,
    dispose() {
      for (const off of offs.splice(0)) off();
      for (const entry of entries) stop(entry);
      entries = [];
      cached = null;
      listeners.clear();
    },
  };
}
