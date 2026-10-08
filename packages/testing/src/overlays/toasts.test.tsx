// The toast host (ui-design §3.9, §4.22; architecture.md §9.5; ER-009…ER-015):
// the UI's own queue behind ToastPort and the surface that draws it together
// with the controller's toasts.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { type ToastRequest } from '@cg/contracts';
import { COMPONENTS_SOURCE } from '@cg/ui/kit';
import { TOASTS_STYLE, TOAST_LIFETIME_MS, TOAST_LIMIT, ToastsView, createToastHost, toastsSurface, type ToastHost } from '@cg/ui/overlays';

import { FANS, aiReadyToast, button, cgError, entry, handles, msg, toast, toasts, views } from '../scenarios/app-client';
import { type MountedKit, ctx, flush, mountSurface, scenarioOf, text } from '../dock/harness';

let kit: MountedKit | null = null;
let host: ToastHost | null = null;
afterEach(() => {
  kit?.unmount();
  kit = null;
  host?.dispose();
  host = null;
  vi.useRealTimers();
});

const request = (patch: Partial<ToastRequest> = {}): ToastRequest => ({ kind: 'info', code: null, scope: 'dock', title: msg('recap.savedToast'), body: null, ...patch });
const ids = (): string[] => host?.toasts.value.map((item) => item.id) ?? [];
const mount = (list: Parameters<typeof toasts>[1] = []): MountedKit => {
  host = host ?? createToastHost({ now: () => Date.now() });
  const current = host;
  return mountSurface(() => <ToastsView host={current} />, scenarioOf([entry({ of: 'toasts' }, toasts(list.length === 0 ? views.empty(msg('common.empty')) : views.ready(), list))]), 'toasts', [TOASTS_STYLE]);
};

describe('the UI\'s own toast queue (ToastPort)', () => {
  it('[ER-009] a toast lives 4.5 s, an error 6.5 s, and then goes by itself', () => {
    vi.useFakeTimers();
    expect(TOAST_LIFETIME_MS).toEqual({ normal: 4500, error: 6500 });
    host = createToastHost({ now: () => Date.now() });
    const info = host.show(request());
    const error = host.show(request({ kind: 'error', code: 'CG-UI-FAILED', scope: 'cheatsheet', title: msg('cg.uiFailed.title') }));
    expect(ids()).toEqual([error, info]);
    vi.advanceTimersByTime(4_499);
    expect(ids()).toEqual([error, info]);
    vi.advanceTimersByTime(2);
    expect(ids()).toEqual([error]);
    vi.advanceTimersByTime(1_998);
    expect(ids()).toEqual([error]);
    vi.advanceTimersByTime(2);
    expect(ids()).toEqual([]);
    // An empty queue holds no timer.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('[ER-009] the same code and scope replace each other; another scope stands next to it', () => {
    vi.useFakeTimers();
    host = createToastHost({ now: () => Date.now() });
    const first = host.show(request({ kind: 'warning', code: 'CG-HOST-CONTRACT', scope: 'dock' }));
    vi.advanceTimersByTime(3_000);
    const second = host.show(request({ kind: 'warning', code: 'CG-HOST-CONTRACT', scope: 'dock' }));
    expect(ids()).toEqual([second]);
    expect(second).not.toBe(first);
    // The replacement starts its own 4.5 s.
    vi.advanceTimersByTime(4_000);
    expect(ids()).toEqual([second]);
    const other = host.show(request({ kind: 'warning', code: 'CG-HOST-CONTRACT', scope: 'coach' }));
    expect(ids()).toEqual([other, second]);
    expect(vi.getTimerCount()).toBe(2);
  });

  it('[ER-014] at most three on screen, the newest first; the oldest gives way', () => {
    vi.useFakeTimers();
    expect(TOAST_LIMIT).toBe(3);
    host = createToastHost({ now: () => Date.now() });
    const shown = ['a', 'b', 'c', 'd'].map((scope) => (host as ToastHost).show(request({ scope })));
    expect(ids()).toEqual([shown[3], shown[2], shown[1]]);
    expect(vi.getTimerCount()).toBe(3);
  });

  it('hover or focus holds the countdown; leaving resumes what was left; dismiss removes at once', () => {
    vi.useFakeTimers();
    host = createToastHost({ now: () => Date.now() });
    const id = host.show(request());
    vi.advanceTimersByTime(4_000);
    host.hold(id, true);
    expect(host.toasts.value[0]?.expiresAt).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(ids()).toEqual([id]);
    expect(vi.getTimerCount()).toBe(0);
    host.hold(id, false);
    // Half a second was left; a released toast stays at least a second.
    vi.advanceTimersByTime(999);
    expect(ids()).toEqual([id]);
    vi.advanceTimersByTime(2);
    expect(ids()).toEqual([]);
    const again = host.show(request());
    host.dismiss(again);
    expect(ids()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('[ER-009] where the stack stands: beside an open side panel (ui-design §3.9)', () => {
  it('the host keeps one place for the whole stack; an equal place changes nothing; null is the stack’s own place', () => {
    host = createToastHost({ now: () => Date.now() });
    expect(host.place.value).toBeNull();
    const seen: unknown[] = [];
    const off = host.place.subscribe((value) => seen.push(value));
    host.setPlace({ right: 340, width: 360 });
    host.setPlace({ right: 340, width: 360 });
    host.setPlace(null);
    host.setPlace(null);
    off();
    expect(seen).toEqual([null, { right: 340, width: 360 }, null]);
  });

  it('the UI’s own toasts and the controller’s move together, and come back when the panel closes; the top stays', async () => {
    kit = mount([toast(ctx, 'c-1', 'info', { title: 'one' })]);
    (host as ToastHost).show(request());
    await flush();
    const stack = kit.$('.cg-toasts') as HTMLElement;
    expect([stack.style.right, stack.style.width, stack.hasAttribute('data-cg-place')]).toEqual(['', '', false]);
    await flush(() => (host as ToastHost).setPlace({ right: 340, width: 300 }));
    expect([stack.style.right, stack.style.width, stack.getAttribute('data-cg-place')]).toEqual(['340px', '300px', 'beside-panel']);
    expect(kit.$$('.cg-toast')).toHaveLength(2);
    expect(stack.style.top).toBe('');
    await flush(() => (host as ToastHost).setPlace(null));
    expect([stack.style.right, stack.style.width, stack.hasAttribute('data-cg-place')]).toEqual(['', '', false]);
  });

  it('it slides there in the panel’s own 140 ms — never under reduced motion', () => {
    expect(COMPONENTS_SOURCE.css).toMatch(/\.cg-toasts \{[^}]*transition: right 140ms var\(--cg-ease\), width 140ms var\(--cg-ease\)/);
    expect(COMPONENTS_SOURCE.css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.cg-toasts \{ transition: none; \} \}/);
  });
});

describe('the toast host surface', () => {
  it('[ER-010] [ER-011] draws the controller\'s toasts: «ChatGoose · CG-…», the title, the explanation, «Настройки» and «Скопировать код»', async () => {
    const error = cgError(ctx, 'CG-HUB-UNAVAILABLE');
    kit = mount([
      toast(ctx, 'toast-hub', 'error', { code: 'CG-HUB-UNAVAILABLE', title: error.title, body: error.body, copyCode: true, actions: [button('common.settings', { type: 'OpenSettings', route: { section: 'status', code: 'CG-HUB-UNAVAILABLE' } })] }),
      aiReadyToast(ctx, FANS.theodore.name, handles.dock(FANS.theodore)),
    ]);
    const stack = kit.$('.cg-toasts') as HTMLElement;
    expect(stack.getAttribute('aria-live')).toBe('polite');
    const [first, second] = kit.$$('.cg-toast');
    expect(first?.getAttribute('role')).toBe('alert');
    expect(text(first?.querySelector('.cg-toast__code'))).toBe('ChatGoose · CG-HUB-UNAVAILABLE');
    expect(text(first?.querySelector('.cg-toast__t'))).toBe('Хаб недоступен');
    expect(first?.querySelector('.cg-dot--danger')).not.toBeNull();
    expect([...(first?.querySelectorAll('.cg-toast__acts button') ?? [])].map(text)).toEqual(['Настройки', 'Скопировать код']);
    expect(second?.hasAttribute('role')).toBe(false);
    expect(text(second?.querySelector('.cg-toast__t'))).toBe('AI готово · Theodore Whitfield');
    await flush(() => (first?.querySelector('.cg-toast__acts button') as HTMLElement).click());
    await flush(() => (second?.querySelector('.cg-toast__acts button') as HTMLElement).click());
    await flush(() => (second?.querySelector('.cg-toast__x') as HTMLElement).click());
    expect(kit.client.dispatched).toEqual([
      { type: 'OpenSettings', route: { section: 'status', code: 'CG-HUB-UNAVAILABLE' } },
      { type: 'Navigate', to: { kind: 'chat', targetHandle: handles.dock(FANS.theodore) } },
      { type: 'DismissToast', toastId: 'toast-ai-ready' },
    ]);
  });

  it('the UI\'s own toasts stand above the controller\'s; three in all; hold and dismiss go to the right queue', async () => {
    kit = mount([toast(ctx, 'c-1', 'info', { title: 'one' }), toast(ctx, 'c-2', 'info', { title: 'two' }), toast(ctx, 'c-3', 'info', { title: 'three' })]);
    const own = (host as ToastHost).show(request({ kind: 'error', code: 'CG-UI-FAILED', title: msg('cg.uiFailed.title'), body: msg('cg.uiFailed.body') }));
    await flush();
    const shown = kit.$$('.cg-toast');
    expect(shown.map((item) => item.getAttribute('data-cg-toast'))).toEqual([own, 'c-1', 'c-2']);
    expect(text(shown[0]?.querySelector('.cg-toast__t'))).toBe('Сбой интерфейса');
    expect(text(shown[0]?.querySelector('.cg-toast__code'))).toBe('ChatGoose · CG-UI-FAILED');
    // Hover holds: the local one in the UI's queue, the controller's through HoldToast.
    await flush(() => shown[0]?.dispatchEvent(new MouseEvent('mouseenter')));
    expect((host as ToastHost).toasts.value[0]?.expiresAt).toBeNull();
    await flush(() => shown[1]?.dispatchEvent(new MouseEvent('mouseenter')));
    expect(kit.client.dispatched).toEqual([{ type: 'HoldToast', toastId: 'c-1', hold: true }]);
    await flush(() => (shown[0]?.querySelector('.cg-toast__x') as HTMLElement).click());
    expect((host as ToastHost).toasts.value).toEqual([]);
    expect(kit.$$('.cg-toast').map((item) => item.getAttribute('data-cg-toast'))).toEqual(['c-1', 'c-2', 'c-3']);
  });

  it('never takes focus and stands 12 px under ChatSpace\'s top bar', async () => {
    kit = mount([toast(ctx, 'c-1', 'info', { title: 'one' })]);
    expect(kit.root.activeElement).toBeNull();
    await flush(() => kit?.deps.geometry.set({ width: null, feedHeight: null, viewportHeight: 900, container: { left: 64, top: 44, width: 1376, height: 856 } }));
    expect((kit.$('.cg-toasts') as HTMLElement).style.top).toBe('56px');
    expect(toastsSurface.styles).toEqual([TOASTS_STYLE]);
    expect(TOASTS_STYLE.css).toContain('z-index: 960');
  });
});
