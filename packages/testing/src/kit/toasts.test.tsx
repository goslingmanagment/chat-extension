import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';

import { type ToastVM } from '@cg/contracts';
import { ToastStack } from '@cg/ui/kit';

import { aiReadyToast, button, cgError, ctxOf, entry, scenarioById, toast, toasts, views, type AppClientScenario } from '../scenarios/app-client';
import { type MountedKit, flush, mountKit } from './harness';

const ctx = ctxOf({ lang: 'ru' });
let kit: MountedKit | null = null;

afterEach(() => {
  kit?.unmount();
  kit = null;
});

function withToasts(list: readonly ToastVM[]): AppClientScenario {
  return { ...scenarioById('gallery-ready'), id: 'kit-toasts', views: [entry({ of: 'toasts' }, toasts(list.length === 0 ? views.empty({ key: 'common.empty' }) : views.ready(), list))] };
}

function mountToasts(list: readonly ToastVM[]): MountedKit {
  kit = mountKit(ToastStack, { scenario: withToasts(list), kind: 'toasts' });
  return kit;
}

const hubDown = toast(ctx, 'toast-hub', 'error', {
  code: 'CG-HUB-UNAVAILABLE',
  title: cgError(ctx, 'CG-HUB-UNAVAILABLE').title,
  body: cgError(ctx, 'CG-HUB-UNAVAILABLE').body,
  copyCode: true,
  actions: [button('common.settings', { type: 'OpenSettings', route: { section: 'status', code: 'CG-HUB-UNAVAILABLE' } })],
});

describe('[ER-009] toasts: four kinds, top right, a polite stack, newest first', () => {
  it('renders error, warning, success and info with their gutter marks', () => {
    const k = mountToasts([
      hubDown,
      toast(ctx, 'w', 'warning', { code: 'CG-HOST-CONTRACT', title: 'ChatSpace обновился — часть функций выключена' }),
      aiReadyToast(ctx, 'Theodore Whitfield', 'h-chat'),
      toast(ctx, 'i', 'info', { title: 'Recap сохранён в хаб' }),
    ]);
    const stack = k.$('.cg-toasts') as HTMLElement;
    expect(stack.getAttribute('aria-live')).toBe('polite');
    const items = k.$$('.cg-toast');
    expect(items.map((item) => item.className.replace('cg-toast cg-toast--', ''))).toEqual(['error', 'warning', 'success', 'info']);
    expect(items[0]?.querySelector('.cg-dot--danger')).not.toBeNull();
    expect(items[1]?.querySelector('.cg-dot--ring')).not.toBeNull();
    expect(items[2]?.querySelector('.cg-toast__ok')).not.toBeNull();
    expect(items[3]?.querySelector('.cg-toast__info')).not.toBeNull();
    // Only an error interrupts; the rest is polite.
    expect(items.map((item) => item.getAttribute('role'))).toEqual(['alert', null, null, null]);
  });

  it('× and Esc inside dismiss; hover and focus hold the timer, once per change', async () => {
    const k = mountToasts([hubDown]);
    const item = k.$('.cg-toast') as HTMLElement;
    await flush(() => {
      item.dispatchEvent(new MouseEvent('mouseenter'));
      item.dispatchEvent(new FocusEvent('focusin'));
      item.dispatchEvent(new MouseEvent('mouseleave'));
    });
    await flush(() => {
      item.dispatchEvent(new FocusEvent('focusout', { relatedTarget: null }));
    });
    await flush(() => (k.$('.cg-toast__x') as HTMLElement).click());
    await flush(() => {
      item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(k.client.dispatched).toEqual([
      { type: 'HoldToast', toastId: 'toast-hub', hold: true },
      { type: 'HoldToast', toastId: 'toast-hub', hold: false },
      { type: 'DismissToast', toastId: 'toast-hub' },
      { type: 'DismissToast', toastId: 'toast-hub' },
    ]);
    expect(k.$('.cg-toast__x')?.getAttribute('aria-label')).toBe('Закрыть');
  });

  it('an empty queue draws nothing', () => {
    const k = mountToasts([]);
    expect(k.$$('.cg-toast')).toHaveLength(0);
  });
});

describe('[ER-010] the error toast: whose error, what happened, what to do', () => {
  it('«ChatGoose · CG-…» above the title, the explanation, «Скопировать код»', async () => {
    const k = mountToasts([hubDown]);
    expect(k.$('.cg-toast__code')?.textContent).toBe('ChatGoose · CG-HUB-UNAVAILABLE');
    expect(k.$('.cg-toast__t')?.textContent).toBe('Хаб недоступен');
    expect(k.$('.cg-toast__sub')?.textContent).toBe(cgError(ctx, 'CG-HUB-UNAVAILABLE').body);
    const copy = k.$$('.cg-toast__acts .cg-btn').find((b) => b.textContent === 'Скопировать код') as HTMLElement;
    expect(copy.classList.contains('cg-btn--quiet')).toBe(true);
    await act(async () => {
      copy.click();
      await Promise.resolve();
    });
    expect(k.deps.clipboard.written).toEqual(['CG-HUB-UNAVAILABLE']);
    expect(copy.textContent).toBe('Скопировано');
  });
});

describe('[ER-011] «Настройки» in a toast opens the section of its code', () => {
  it('is a plain button that dispatches the controller’s OpenSettings route', async () => {
    const k = mountToasts([hubDown]);
    const settings = k.$$('.cg-toast__acts .cg-btn').find((b) => b.textContent === 'Настройки') as HTMLElement;
    expect(settings.classList.contains('cg-btn--plain')).toBe(true);
    await flush(() => settings.click());
    expect(k.client.dispatched).toEqual([{ type: 'OpenSettings', route: { section: 'status', code: 'CG-HUB-UNAVAILABLE' } }]);
  });
});

describe('[ER-012] the unsynced Recap toast', () => {
  it('shows CG-RECAP-SAVE with its registry text', () => {
    const error = cgError(ctx, 'CG-RECAP-SAVE');
    const k = mountToasts([toast(ctx, 'recap', 'error', { code: 'CG-RECAP-SAVE', title: error.title, body: error.body, copyCode: true })]);
    expect(k.$('.cg-toast__code')?.textContent).toBe('ChatGoose · CG-RECAP-SAVE');
    expect(k.$('.cg-toast__t')?.textContent).toBe(error.title);
  });
});

describe('[ER-013] toasts outside the registry', () => {
  it('have no code line and no «Скопировать код»', () => {
    const k = mountToasts([toast(ctx, 'plain', 'info', { title: 'Сначала закройте справку', copyCode: true })]);
    expect(k.$('.cg-toast__code')).toBeNull();
    expect(k.$('.cg-toast__acts')).toBeNull();
    expect(k.$('.cg-toast__t')?.textContent).toBe('Сначала закройте справку');
  });
});

describe('[ER-014] background generation toasts «AI готово · чат N»', () => {
  it('success about another chat with «Открыть чат» as a line button', async () => {
    const k = mountToasts([aiReadyToast(ctx, 'Theodore Whitfield', 'h-chat')]);
    expect(k.$('.cg-toast__t')?.textContent).toBe('AI готово · Theodore Whitfield');
    const open = k.$('.cg-toast__acts .cg-btn') as HTMLElement;
    expect(open.textContent).toBe('Открыть чат');
    expect(open.classList.contains('cg-btn--line')).toBe(true);
    await flush(() => open.click());
    expect(k.client.dispatched).toEqual([{ type: 'Navigate', to: { kind: 'chat', targetHandle: 'h-chat' } }]);
  });

  it('a failure in another chat is an error toast with the code', () => {
    const error = cgError(ctx, 'CG-PROVIDER-RATE-LIMIT');
    const k = mountToasts([toast(ctx, 'other', 'error', { code: 'CG-PROVIDER-RATE-LIMIT', title: 'AI: не получилось · Theodore Whitfield', body: error.body, copyCode: true })]);
    expect(k.$('.cg-toast')?.getAttribute('role')).toBe('alert');
    expect(k.$('.cg-toast__code')?.textContent).toBe('ChatGoose · CG-PROVIDER-RATE-LIMIT');
  });
});

describe('[ER-015] «Hub settings updating» toast', () => {
  it('an info toast with no buttons', () => {
    const k = mountToasts([toast(ctx, 'hub-settings', 'info', { title: 'Настройки хаба обновляются' })]);
    expect(k.$('.cg-toast--info .cg-toast__t')?.textContent).toBe('Настройки хаба обновляются');
    expect(k.$$('.cg-toast__acts .cg-btn')).toHaveLength(0);
  });
});
