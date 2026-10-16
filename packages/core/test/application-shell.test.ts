// The shell controller of a tab (core/application/shell): the background's
// toasts as the `toasts` view with their rules (ER-009…ER-015), and the
// actions that act on the tab itself.

import { describe, expect, it } from 'vitest';

import { UiActionSchema, type BackgroundToast, type TabEventPayload, type ToastsVM, type UiAction } from '@cg/contracts';
import { chatHandle } from '@cg/core/application/navigation';
import { createShellController, type ShellTab } from '@cg/core/application/shell';
import { createI18n } from '@cg/core/domain/i18n';

const NOW = Date.parse('2026-10-03T10:00:00.000Z');
const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const CHAT = { host: 'chatspace' as const, hostAccountId: '900001', platformFanId: '800001' };

interface Timer {
  readonly at: number;
  readonly fn: () => void;
}

function harness(tab: Partial<ShellTab> = {}) {
  let now = NOW;
  const timers = new Map<number, Timer>();
  let serial = 0;
  const calls: string[] = [];
  let emit: (payload: TabEventPayload<'toast'>) => void = () => undefined;
  let subscribed = 0;
  const i18n = createI18n({ language: 'ru', now: () => now });
  const shell = createShellController({
    rpc: {
      onEvent(_type, listener) {
        subscribed += 1;
        emit = listener;
        return () => {
          subscribed -= 1;
        };
      },
    },
    i18n,
    clock: {
      now: () => now,
      setTimer(ms, fn) {
        serial += 1;
        timers.set(serial, { at: now + ms, fn });
        return serial;
      },
      clearTimer: (handle) => void timers.delete(handle as number),
    },
    tab: {
      reload: () => void calls.push('reload'),
      reloadSurface(surface) {
        calls.push(`surface:${surface}`);
        return surface !== 'coach';
      },
      ...tab,
    },
    chatHandle,
  });
  const seen: ToastsVM[] = [];
  shell.subscribe({ of: 'toasts' }, (view) => seen.push(view));
  return {
    shell,
    i18n,
    calls,
    seen,
    view: (): ToastsVM => shell.getSnapshot({ of: 'toasts' }),
    toast: (toast: Partial<BackgroundToast> & Pick<BackgroundToast, 'toastId'>): void => emit({ toast: { kind: 'success', scope: 'op.ready', fanLabel: null, ...toast } }),
    advance(ms: number): void {
      const until = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (due === undefined) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = until;
    },
    timers: (): number => timers.size,
    subscribed: (): number => subscribed,
    dispatch: (action: UiAction) => shell.dispatch(action),
  };
}

describe('the shell controller: toasts of the background', () => {
  it('[ER-011] «AI готово · {фан}» carries the way to its chat — a Navigate the person clicks, never a jump by itself', () => {
    const h = harness();
    expect(h.view()).toEqual({ view: { s: 'empty', why: { key: 'common.empty' } }, toasts: [] });
    h.toast({ toastId: uuid(1), opId: uuid(100), feature: 'reply', chat: CHAT, fanLabel: 'Mark' });
    const view = h.view();
    expect(view.view).toEqual({ s: 'ready' });
    expect(view.toasts).toHaveLength(1);
    expect(view.toasts[0]).toMatchObject({ id: uuid(1), kind: 'success', code: null, title: 'AI готово · Mark', body: null, copyCode: false, expiresAt: NOW + 4500 });
    expect(view.toasts[0]?.actions).toEqual([{ label: { key: 'common.openChat' }, action: { type: 'Navigate', to: { kind: 'chat', targetHandle: 'nav.chat.900001.800001' } }, enabled: true, reason: null, hotkey: null }]);
    for (const button of view.toasts[0]?.actions ?? []) expect(UiActionSchema.safeParse(button.action).success).toBe(true);
    expect(h.seen).toHaveLength(1);
  });

  it('[ER-009] a toast lives 4.5 s, an error 6.5 s with its code and «Скопировать код»; the queue is empty again after', () => {
    const h = harness();
    h.toast({ toastId: uuid(1), feature: 'reply', chat: CHAT, fanLabel: 'Mark' });
    h.toast({ toastId: uuid(2), kind: 'error', scope: 'op.failed', feature: 'reply', chat: CHAT, fanLabel: 'Mark', code: 'CG-PROVIDER-UNAVAILABLE', error: { code: 'CG-PROVIDER-UNAVAILABLE' } });
    expect(h.view().toasts.map((toast) => toast.id)).toEqual([uuid(2), uuid(1)]);
    const failed = h.view().toasts[0];
    expect(failed).toMatchObject({ kind: 'error', code: 'CG-PROVIDER-UNAVAILABLE', copyCode: true, expiresAt: NOW + 6500 });
    expect(failed?.title).toContain('Mark');
    expect(failed?.body).not.toBeNull();
    h.advance(4500);
    expect(h.view().toasts.map((toast) => toast.id)).toEqual([uuid(2)]);
    h.advance(2000);
    expect(h.view().toasts).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it('[ER-012] CG-RECAP-SAVE stays as long as an error although it is a warning', () => {
    const h = harness();
    h.toast({ toastId: uuid(1), kind: 'warning', scope: 'recap.profile', feature: 'recap', chat: CHAT, code: 'CG-RECAP-SAVE', error: { code: 'CG-RECAP-SAVE' } });
    expect(h.view().toasts[0]).toMatchObject({ code: 'CG-RECAP-SAVE', expiresAt: NOW + 6500 });
    h.toast({ toastId: uuid(2), scope: 'recap.profile', feature: 'recap', chat: CHAT });
    expect(h.view().toasts[0]).toMatchObject({ id: uuid(2), title: 'Recap сохранён в хаб', expiresAt: NOW + 4500 });
  });

  it('[ER-010] the same code and scope replace each other; at most three stay, the newest first', () => {
    const h = harness();
    h.toast({ toastId: uuid(1), feature: 'reply', fanLabel: 'A' });
    h.toast({ toastId: uuid(2), feature: 'reply', fanLabel: 'B' });
    expect(h.view().toasts.map((toast) => toast.title)).toEqual(['AI готово · B']);
    expect(h.timers()).toBe(1);
    for (const [index, scope] of ['s1', 's2', 's3'].entries()) h.toast({ toastId: uuid(10 + index), scope, feature: 'fix', fanLabel: scope });
    expect(h.view().toasts.map((toast) => toast.id)).toEqual([uuid(12), uuid(11), uuid(10)]);
    expect(h.timers()).toBe(3);
  });

  it('[ER-010] [ER-014] three ready operations replace one another; each toast still names its own group', () => {
    const h = harness();
    const groups = ['700003', '700001', '700002'];
    for (const [index, conversationRef] of groups.entries()) {
      const chat = { host: 'fansly-web' as const, hostAccountId: '900001', platformFanId: String(800001 + index) };
      h.toast({ toastId: uuid(index + 1), opId: uuid(100 + index), feature: 'reply', chat, conversationRef });
      expect(h.view().toasts).toHaveLength(1);
      expect(h.view().toasts[0]).toMatchObject({ id: uuid(index + 1), kind: 'success', actions: [
        { action: { type: 'Navigate', to: { kind: 'chat', targetHandle: `nav.chat.900001.${chat.platformFanId}.${conversationRef}` } } },
      ] });
      expect(h.timers()).toBe(1);
    }
    expect(h.seen).toHaveLength(3);
  });

  it('[ER-013] a toast under the pointer keeps its time and goes on with what was left; «Закрыть» removes it', async () => {
    const h = harness();
    h.toast({ toastId: uuid(1), feature: 'reply', fanLabel: 'Mark' });
    h.advance(4000);
    expect(await h.dispatch({ type: 'HoldToast', toastId: uuid(1), hold: true })).toMatchObject({ ok: true });
    expect(h.view().toasts[0]?.expiresAt).toBeNull();
    h.advance(60_000);
    expect(h.view().toasts).toHaveLength(1);
    expect(await h.dispatch({ type: 'HoldToast', toastId: uuid(1), hold: false })).toMatchObject({ ok: true });
    // 500 ms were left: a toast let go stays at least a second.
    h.advance(999);
    expect(h.view().toasts).toHaveLength(1);
    h.advance(1);
    expect(h.view().toasts).toEqual([]);

    h.toast({ toastId: uuid(2), feature: 'reply', fanLabel: 'Mark' });
    expect(await h.dispatch({ type: 'DismissToast', toastId: uuid(2) })).toMatchObject({ ok: true, outcome: 'done' });
    expect(h.view().toasts).toEqual([]);
    expect(h.timers()).toBe(0);
    // A toast of the overlay host's own queue is not the shell's.
    expect(h.dispatch({ type: 'DismissToast', toastId: 'local-1' })).toBeNull();
    expect(h.dispatch({ type: 'HoldToast', toastId: 'local-1', hold: true })).toBeNull();
  });

  it('an error whose code leads to a settings section offers «Настройки» only when the tab can open them', () => {
    const closed = harness();
    closed.toast({ toastId: uuid(1), kind: 'error', scope: 'op.failed', chat: CHAT, code: 'CG-QUOTA-DAILY', error: { code: 'CG-QUOTA-DAILY' } });
    expect(closed.view().toasts[0]?.actions.map((button) => button.action.type)).toEqual(['Navigate']);
    const open = harness({ openSettings: () => Promise.resolve(true) });
    open.toast({ toastId: uuid(1), kind: 'error', scope: 'op.failed', chat: CHAT, code: 'CG-QUOTA-DAILY', error: { code: 'CG-QUOTA-DAILY' } });
    expect(open.view().toasts[0]?.actions.map((button) => button.action)).toEqual([
      { type: 'Navigate', to: { kind: 'chat', targetHandle: 'nav.chat.900001.800001' } },
      { type: 'OpenSettings', route: { section: 'status', code: 'CG-QUOTA-DAILY' } },
    ]);
  });
});

describe('the shell controller: actions on the tab itself', () => {
  it('[UP-009] «Перезагрузить вкладку» reloads the tab; [ER-020] «Перезагрузить панель» mounts the surface again', async () => {
    const h = harness();
    expect(await h.dispatch({ type: 'ReloadTab' })).toEqual({ ok: true, type: 'ReloadTab', outcome: 'done' });
    expect(await h.dispatch({ type: 'ReloadSurface', surface: 'dock' })).toEqual({ ok: true, type: 'ReloadSurface', outcome: 'done' });
    expect(await h.dispatch({ type: 'ReloadSurface', surface: 'coach' })).toEqual({ ok: true, type: 'ReloadSurface', outcome: 'noop' });
    expect(h.calls).toEqual(['reload', 'surface:dock', 'surface:coach']);
  });

  it('«Настройки» opens the settings page through the tab; a page that did not open is a refusal with its code, and a tab that cannot open pages leaves the action to others', async () => {
    const routes: unknown[] = [];
    const h = harness({
      openSettings(route) {
        routes.push(route);
        return Promise.resolve(routes.length === 1);
      },
    });
    expect(await h.dispatch({ type: 'OpenSettings', route: { section: 'account', code: 'CG-AUTH-REQUIRED' } })).toEqual({ ok: true, type: 'OpenSettings', outcome: 'opened' });
    expect(await h.dispatch({ type: 'OpenSettings', route: { section: 'status' } })).toMatchObject({ ok: false, code: 'CG-RUNTIME-UNREACHABLE', error: { code: 'CG-RUNTIME-UNREACHABLE' } });
    expect(routes).toEqual([{ section: 'account', code: 'CG-AUTH-REQUIRED' }, { section: 'status' }]);
    expect(harness().dispatch({ type: 'OpenSettings', route: { section: 'status' } })).toBeNull();
  });

  it('[ER-020] «Выгрузить диагностику» of a failed surface leads to «Диагностика» of the settings: the files are saved there, a tab has nowhere to save them from', async () => {
    const routes: unknown[] = [];
    const h = harness({
      openSettings(route) {
        routes.push(route);
        return Promise.resolve(routes.length === 1);
      },
    });
    expect(await h.dispatch({ type: 'ExportDiagnostics' })).toEqual({ ok: true, type: 'ExportDiagnostics', outcome: 'opened' });
    expect(await h.dispatch({ type: 'ExportDiagnostics' })).toMatchObject({ ok: false, code: 'CG-RUNTIME-UNREACHABLE' });
    expect(routes).toEqual([{ section: 'diagnostics' }, { section: 'diagnostics' }]);
    expect(harness().dispatch({ type: 'ExportDiagnostics' })).toBeNull();
  });

  it('[DB-006] [DB-007] «Промпт» of a debug block hands the tab the opaque token of the snapshot and nothing else; debug off or a page that did not open is CG-NAV-FAILED', async () => {
    const tokens: string[] = [];
    const h = harness({
      openPrompt(token) {
        tokens.push(token);
        return tokens.length === 1 ? Promise.resolve(true) : tokens.length === 2 ? Promise.resolve(false) : Promise.reject(new Error('gone'));
      },
    });
    const action: UiAction = { type: 'Navigate', to: { kind: 'debug-prompt', promptHandle: 'prompt-token-1' } };
    expect(await h.dispatch(action)).toEqual({ ok: true, type: 'Navigate', outcome: 'opened' });
    expect(await h.dispatch(action)).toMatchObject({ ok: false, code: 'CG-NAV-FAILED' });
    expect(await h.dispatch(action)).toMatchObject({ ok: false, code: 'CG-NAV-FAILED' });
    expect(tokens).toEqual(['prompt-token-1', 'prompt-token-1', 'prompt-token-1']);
    // Every other navigation belongs to the navigation controller, and a tab that cannot open pages takes none.
    expect(h.dispatch({ type: 'Navigate', to: { kind: 'chat-step', direction: 'next' } })).toBeNull();
    expect(h.dispatch({ type: 'Navigate', to: { kind: 'journal', journal: 'operations' } })).toBeNull();
    expect(harness().dispatch(action)).toBeNull();
  });

  it('[ER-006] «Скопировать код» of an error card copies the code, its title and what to do — in the current language; a refused clipboard is CG-CLIPBOARD', async () => {
    const copied: string[] = [];
    let allow = true;
    const h = harness({
      copyText(text) {
        copied.push(text);
        return Promise.resolve(allow);
      },
    });
    expect(await h.dispatch({ type: 'CopyReport', scope: 'error', code: 'CG-QUOTA-DAILY' })).toEqual({ ok: true, type: 'CopyReport', outcome: 'done' });
    expect(copied).toHaveLength(1);
    expect(copied[0]?.split('\n')[0]).toBe(`CG-QUOTA-DAILY: ${h.i18n.t('cg.quotaDaily.title')}`);
    expect(copied[0]?.split('\n')).toHaveLength(2);
    allow = false;
    expect(await h.dispatch({ type: 'CopyReport', scope: 'error', code: 'CG-QUOTA-DAILY' })).toMatchObject({ ok: false, code: 'CG-CLIPBOARD' });
    // The status report is the settings page's; a report without a code is nobody's here.
    expect(h.dispatch({ type: 'CopyReport', scope: 'status' })).toBeNull();
    expect(h.dispatch({ type: 'CopyReport', scope: 'error' })).toBeNull();
    expect(harness().dispatch({ type: 'CopyReport', scope: 'error', code: 'CG-QUOTA-DAILY' })).toBeNull();
  });

  it('[I18-001] the language changes: the toasts on screen are said again in it', () => {
    const h = harness();
    h.toast({ toastId: uuid(1), scope: 'recap.profile', feature: 'recap', chat: CHAT });
    expect(h.view().toasts[0]?.title).toBe('Recap сохранён в хаб');
    h.i18n.setLanguage('en');
    expect(h.seen).toHaveLength(2);
    expect(h.view().toasts[0]?.title).not.toBe('Recap сохранён в хаб');
    expect(h.view().toasts[0]?.expiresAt).toBe(NOW + 4500);
  });

  it('an action of another controller is not the shell\'s; dispose drops the timers and the subscription', () => {
    const h = harness();
    expect(h.dispatch({ type: 'SetStatsExpanded', expanded: true })).toBeNull();
    h.toast({ toastId: uuid(1), feature: 'reply', fanLabel: 'Mark' });
    expect(h.shell.count()).toBe(1);
    h.shell.dispose();
    expect(h.timers()).toBe(0);
    expect(h.subscribed()).toBe(0);
    expect(h.shell.count()).toBe(0);
  });
});
