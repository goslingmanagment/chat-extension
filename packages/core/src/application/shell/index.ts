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
// The greeting reminder's toast (2026-10-24) «Ждёт приветствия · {фан}» stays
// until it is closed: its «Hi» opens the fan's chat, starts the dock's Hi
// there and puts the greeting into its field (2026-10-26; `GreetNewcomer`,
// answered by the boards), and the click closes it. The fan's next reminder
// (three, ten and fifteen minutes on, 2026-10-29) takes its place; the last
// one is red. 2026-10-29 (the owner chose «Hi прямо в напоминании»): with
// the boards' `greetHere` its «Hi» writes the greeting into the toast itself
// — «Пишу приветствие…», then the text with «Отправить» (the list's own send
// of a greeting, by that click), «Ещё вариант» and «Открыть чат» (the fan's
// chat with the text in its field, which closes the toast) — and the person
// stays in their chat; «Отправлено» closes it a moment later.
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
import { CG_REGISTRY } from '@cg/contracts/errors/registry';
import { type ChatRef } from '@cg/contracts/ids';
import { type BackgroundToast, type TabEventPayload } from '@cg/contracts/tab-messages';
import { type ActionButtonVM, type ActionReceipt, type GreetCardVM, type I18n, type Msg, type MountSurfaceKind, type ToastVM, type ToastsVM, type UiAction, type UiActionType, type ViewSelector } from '@cg/contracts/vm';

import { TOAST_TIMING, errorView, settingsRouteOf, toastKey, toastLifetimeMs, viewOfCode } from '../../domain/errors';
import { translatorOf } from '../../domain/i18n/live';
import { fanHandle } from '../boards/handles';
import { type GreetHereState } from '../newcomers/controller';

/** «Hi» of a greeting reminder about this fan of this page — the toast's own, or one another tab handed over (2026-10-25). */
export function greetNewcomer(pageId: number, fanRef: string): Extract<UiAction, { type: 'GreetNewcomer' }> {
  return { type: 'GreetNewcomer', targetHandle: fanHandle('newcomers', pageId, fanRef) };
}

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
  /**
   * 2026-10-29: the reminder's greeting the boards wrote for its toast, by the fan's handle (`fanHandle('newcomers', …)`);
   * absent — the toast's «Hi» opens the fan's chat, as before.
   */
  readonly greetHere?: {
    state(handle: string): GreetHereState | null;
    subscribe(listener: () => void): () => void;
  };
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
/** «Отправлено» in a reminder's toast stays this long, then the toast goes (2026-10-29). */
export const GREET_SENT_SHOWN_MS = 4000;
/** «Его уже поприветствовали» stays a little longer: there is something to read. */
export const GREET_GREETED_SHOWN_MS = 8000;

/** The registry's title of a shared code; a site's own code has none here. */
const titleOf = (code: string | null): Msg | null => (code !== null && Object.hasOwn(CG_REGISTRY, code) ? { key: CG_REGISTRY[code as keyof typeof CG_REGISTRY].title } : null);

const done = (type: UiActionType, outcome: Extract<ActionReceipt, { ok: true }>['outcome'] = 'done'): ActionReceipt => ({ ok: true, type, outcome });

export function createShellController(ports: ShellPorts): ShellController {
  const { clock, i18n, tab } = ports;
  let entries: Entry[] = [];
  let cached: ToastsVM | null = null;
  const listeners = new Set<(view: ToastsVM) => void>();

  const refused = (type: UiActionType, code: CgCode): ActionReceipt => ({ ok: false, type, code, error: viewOfCode(code, translatorOf(i18n)) });

  const button = (label: ActionButtonVM['label']['key'], action: UiAction): ActionButtonVM => ({ label: { key: label }, action, enabled: true, reason: null, hotkey: null });

  /** The greeting «Hi» wrote, as the toast shows it: the text, and why it did not go. */
  function cardOf(here: GreetHereState): GreetCardVM {
    const why = here.warn ?? titleOf(here.code);
    return { s: here.s, text: here.text, why: why === null ? null : i18n.t(why.key, why.params) };
  }

  /**
   * The buttons of a written greeting: «Отправить» (or «Отправить всё равно» over a warning), off while it cannot go by
   * a plain click; «Ещё вариант»; «Открыть чат» — the fan's chat with the text in its field, else the old «Hi».
   */
  function cardActions(target: Extract<UiAction, { type: 'GreetNewcomer' }>, here: GreetHereState): ActionButtonVM[] {
    const again = button('toast.greetAgain', { ...target, here: true, again: true });
    const open = button(here.s === 'uncertain' ? 'send.openToVerify' : 'common.openChat', here.open ?? target);
    const send: ActionButtonVM = { ...button(here.warn === undefined || here.warn === null ? 'send.button' : 'send.anyway', here.send ?? { type: 'SendNewcomerGreeting', targetHandle: target.targetHandle }), enabled: here.send !== null };
    switch (here.s) {
      case 'ready':
        return [send, again, open];
      case 'failed':
        return here.send === null ? [again, open] : [send, again, open];
      case 'uncertain':
        return here.open === null ? [] : [open];
      case 'writing':
      case 'sending':
      case 'sent':
      case 'greeted':
        return [];
    }
  }

  function viewOf(entry: Entry): ToastVM {
    const { toast } = entry;
    const error = toast.error === undefined ? null : errorView(toast.error, translatorOf(i18n));
    const code = toast.code ?? toast.error?.code ?? null;
    const fan = toast.fanLabel;
    const actions: ActionButtonVM[] = [];
    if (toast.greet !== undefined) {
      const target = greetNewcomer(toast.greet.pageId, toast.greet.fanRef);
      const name = fan ?? i18n.t('newcomers.col.fan');
      const here = ports.greetHere?.state(target.targetHandle) ?? null;
      // 1.61.0 (the owner: «с авой»): the fan as a card — picture, name, «@handle · 11 мин назад»; «Позже» closes it.
      // 2026-10-29: the last of the three reminders is red; what «Hi» wrote stands in it.
      const greet = {
        name,
        handle: toast.greet.username ?? null,
        avatarUrl: toast.greet.avatarUrl ?? null,
        since: toast.greet.since ?? null,
        page: toast.greet.page ?? null,
        ...(toast.greet.urgent === true ? { urgent: true } : {}),
        ...(here === null ? {} : { card: cardOf(here) }),
      };
      const later = button('toast.later', { type: 'DismissToast', toastId: toast.toastId });
      const hi = button('dock.action.hi', ports.greetHere === undefined ? target : { ...target, here: true });
      return { id: toast.toastId, kind: toast.kind, code: null, title: i18n.t('toast.greetDue', { fan: name }), body: null, actions: here === null ? [hi, later] : cardActions(target, here), copyCode: false, expiresAt: entry.expiresAt, greet };
    }
    // §9.5: a background toast leads to its chat — by the person's click only.
    if (toast.chat !== undefined && ports.chatHandle !== undefined) actions.push(button('common.openChat', { type: 'Navigate', to: { kind: 'chat', targetHandle: ports.chatHandle(toast.chat, toast.conversationRef) } }));
    const route = code === null ? null : settingsRouteOf(code);
    if (route !== null && tab.openSettings !== undefined) actions.push(button('common.settings', { type: 'OpenSettings', route }));
    let title: string;
    let body: string | null = null;
    if (error !== null) {
      title = fan === null ? error.title : `${error.title} · ${fan}`;
      body = error.body;
    } else if (toast.feature !== undefined) title = i18n.t('toast.aiReady', { fan: fan ?? i18n.t(toast.feature === 'recap-short' ? 'dock.action.recap' : `dock.action.${toast.feature}`) });
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
    if (toast.greet === undefined) arm(entry, toastLifetimeMs(toast.kind, toast.code ?? null));
    changed();
  }

  const offs = [
    ports.rpc.onEvent('toast', ({ toast }) => {
      // A full Recap linked as the dossier is the recap book's to know (`recap-book.ts`); nobody needs a toast for it
      // (the owner, 2026-10-22): only a failed save is said — here and as «Сохранить ещё раз» under the Recap.
      if (toast.scope === 'recap.profile' && toast.kind === 'success') return;
      show(toast);
    }),
    i18n.subscribe(() => changed()),
    ports.greetHere?.subscribe(() => {
      // «Отправлено» and «уже поприветствовали» say their word, then the toast goes.
      for (const entry of entries) {
        const greet = entry.toast.greet;
        if (greet === undefined || entry.timer !== null) continue;
        const s = ports.greetHere?.state(fanHandle('newcomers', greet.pageId, greet.fanRef))?.s;
        if (s === 'sent') arm(entry, GREET_SENT_SHOWN_MS);
        else if (s === 'greeted') arm(entry, GREET_GREETED_SHOWN_MS);
      }
      changed();
    }) ?? (() => undefined),
  ];

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
        // A reminder has no time to hold.
        if (entry.toast.greet !== undefined) return Promise.resolve(done(action.type, 'noop'));
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
      // «Hi» of a reminder: its toast goes; the boards open the fan's chat, start Hi there and put it into the field.
      // 2026-10-29: `here` — the greeting is written into the toast, which stays.
      if (action.type === 'GreetNewcomer') {
        if (action.here === true) return null;
        for (const entry of entries.filter((item) => item.toast.greet !== undefined && fanHandle('newcomers', item.toast.greet.pageId, item.toast.greet.fanRef) === action.targetHandle)) remove(entry.toast.toastId);
        return null;
      }
      // «Открыть чат» of a written greeting: the boards open the fan's chat with it; its toast goes.
      if (action.type === 'OpenAndInsertPart' || action.type === 'InsertNewcomerGreeting' || action.type === 'OpenChatToVerify') {
        const key = JSON.stringify(action);
        for (const entry of entries.filter((item) => item.toast.greet !== undefined)) {
          const greet = entry.toast.greet;
          const open = greet === undefined ? null : (ports.greetHere?.state(fanHandle('newcomers', greet.pageId, greet.fanRef))?.open ?? null);
          if (open !== null && JSON.stringify(open) === key) remove(entry.toast.toastId);
        }
        return null;
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
