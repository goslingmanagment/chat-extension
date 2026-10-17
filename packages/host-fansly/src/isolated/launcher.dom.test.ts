// The floating launcher of a Fansly page (decision X46; SP-001, NF-001): what a click asks before and after the
// application is there, the buttons in their closed root, the layers of our hosts on a Fansly page. In Firefox, on the
// stand, beside the neighbour, with the real application opening the windows: suite-fansly-launcher.e2e.ts.

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { HostTheme } from '@cg/contracts/host';
import { LAYER_ATTRIBUTE, OVERLAY_Z } from '@cg/host-kit/isolated/hosts';

import { createFakeFanslyPage } from '../testing/fake-dom';
import { createFanslyLauncher, type LauncherTarget } from './launcher';
import { BUSY_MS, drawFanslyLauncher, LAUNCHER_TEXT, newcomersKeyLabel, spendersKeyLabel } from './launcher-view';
import { createFanslyMounts, FANSLY_OVERLAY_Z, LAUNCHER_LAYER, PAGE_Z } from './mount';
import { startFanslyTab } from './starter';
import { loadValidation } from './validation';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.documentElement.removeAttribute('data-fx-instance');
  document.documentElement.removeAttribute('data-fx-reload');
  document.querySelector('[data-host="reload-notice"]')?.remove();
  document.documentElement.className = '';
  history.replaceState({}, '', '/');
  vi.useRealTimers();
});

const settle = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function fakeTheme(scheme: HostTheme['scheme'] = 'dark') {
  const listeners = new Set<(theme: HostTheme) => void>();
  let current: HostTheme = { scheme, tokens: {}, fixedWidth: false };
  return {
    current: () => current,
    onChange(listener: (theme: HostTheme) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next: HostTheme['scheme']) {
      current = { ...current, scheme: next };
      for (const listener of listeners) listener(current);
    },
  };
}

/** The launcher drawn into a host of the Fansly mounts; the closed root is read through the mounts' own handle. */
function drawn(platform = 'MacIntel') {
  const mounts = createFanslyMounts(document);
  const launcher = createFanslyLauncher();
  const theme = fakeTheme();
  const host = mounts.launcher();
  const erase = drawFanslyLauncher({ host, theme, launcher, platform });
  cleanups.push(() => mounts.dispose());
  const button = (target: LauncherTarget): HTMLButtonElement => {
    const found = host.root.querySelector<HTMLButtonElement>(`button[data-launcher="${target}"]`);
    if (found === null) throw new Error(`no ${target} button`);
    return found;
  };
  return { mounts, launcher, theme, host, erase, button };
}

describe('[host:fansly] the launcher’s asks (X46)', () => {
  it('[SP-001] [NF-001] a click before the application is kept — the newest wins — and wants the application; the runner takes it at once', () => {
    const launcher = createFanslyLauncher();
    const wanted = vi.fn();
    const pending = vi.fn();
    launcher.onWanted(wanted);
    launcher.onPending(pending);
    expect(launcher.wanted()).toBe(false);
    launcher.ask('newcomers');
    launcher.ask('spenders');
    expect(launcher.wanted()).toBe(true);
    expect(launcher.pending()).toBe('spenders');
    // Every click says it: an application whose load failed is asked for again by the next one.
    expect(wanted).toHaveBeenCalledTimes(2);
    const run = vi.fn();
    const stop = launcher.serve(run);
    expect(run.mock.calls).toEqual([['spenders']]);
    expect(launcher.pending()).toBeNull();
    expect(pending).toHaveBeenCalledTimes(3);
    // Served: a click runs in its own step, nothing is kept, nobody is asked for the application again.
    launcher.ask('newcomers');
    expect(run.mock.calls).toEqual([['spenders'], ['newcomers']]);
    expect(launcher.pending()).toBeNull();
    expect(wanted).toHaveBeenCalledTimes(2);
    stop();
    launcher.ask('spenders');
    expect(run).toHaveBeenCalledTimes(2);
    expect(launcher.pending()).toBe('spenders');
  });
});

describe('[host:fansly] the launcher’s buttons (X46, ui-design §3.13)', () => {
  it('[SP-001] [NF-001] two buttons in a closed root of an overlay host in <html>, fixed bottom left under Fansly’s modals; a click asks for its window', () => {
    const { host, button, launcher } = drawn();
    expect(host.host.parentElement).toBe(document.documentElement);
    expect(host.host.getAttribute('data-host')).toBe('overlay');
    expect(host.host.getAttribute(LAYER_ATTRIBUTE)).toBe(LAUNCHER_LAYER);
    expect(host.host.childNodes).toHaveLength(0);
    expect(host.host.style.position).toBe('fixed');
    expect([host.host.style.left, host.host.style.bottom]).toEqual(['16px', '16px']);
    expect(Number(host.host.style.zIndex)).toBe(PAGE_Z);
    expect(PAGE_Z).toBeLessThan(998);
    expect([...host.root.querySelectorAll('button')].map((node) => [node.getAttribute('data-launcher'), node.textContent, node.getAttribute('aria-label')])).toEqual([
      ['spenders', LAUNCHER_TEXT.spenders.label, 'Открыть Spenders'],
      ['newcomers', 'Новые', 'Открыть «Новые»'],
    ]);
    expect(button('spenders').title).toBe('Spenders · ⌘⇧M');
    expect(button('newcomers').title).toBe('Новые фоловеры · ⌘⇧U');
    button('newcomers').click();
    expect(launcher.pending()).toBe('newcomers');
  });

  it('[SP-001] the key in the tooltip is the panel level of the platform', () => {
    expect(spendersKeyLabel('MacIntel')).toBe('⌘⇧M');
    expect(spendersKeyLabel('Win32')).toBe('Ctrl+Alt+M');
    expect(spendersKeyLabel('Linux x86_64')).toBe('Ctrl+Alt+M');
    expect(drawn('Win32').button('spenders').title).toBe('Spenders · Ctrl+Alt+M');
    // X49: «Новые» on the same panel modifiers.
    expect([newcomersKeyLabel('MacIntel'), newcomersKeyLabel('Win32')]).toEqual(['⌘⇧U', 'Ctrl+Alt+U']);
    expect(drawn('Win32').button('newcomers').title).toBe('Новые фоловеры · Ctrl+Alt+U');
  });

  it('[SP-001] the page’s scheme on the host, live; the kept click shows its wait until it is taken, at most BUSY_MS', () => {
    vi.useFakeTimers();
    const { host, theme, button, launcher } = drawn();
    expect(host.host.getAttribute('data-scheme')).toBe('dark');
    theme.set('light');
    expect(host.host.getAttribute('data-scheme')).toBe('light');
    button('spenders').click();
    expect(button('spenders').getAttribute('aria-busy')).toBe('true');
    expect(button('newcomers').hasAttribute('aria-busy')).toBe(false);
    launcher.serve(() => undefined);
    expect(button('spenders').hasAttribute('aria-busy')).toBe(false);
    const other = drawn();
    other.button('newcomers').click();
    vi.advanceTimersByTime(BUSY_MS);
    expect(other.button('newcomers').hasAttribute('aria-busy')).toBe(false);
  });

  it('erased: the buttons go, the theme is no longer heard; the host leaves with the mounts', () => {
    const { host, erase, mounts } = drawn();
    erase();
    expect(host.root.querySelectorAll('button')).toHaveLength(0);
    mounts.dispose();
    expect(host.host.isConnected).toBe(false);
  });
});

describe('[host:fansly] our layers on a Fansly page (FS-PLC-6, X46)', () => {
  it('[UI-017] [FX-009] panels, windows and toasts over Fansly’s modals (998), menus and cards (999–1000), under its alerts (9999) and FBuddy (1 000 000); ChatSpace’s table is untouched', () => {
    const mounts = createFanslyMounts(document);
    cleanups.push(() => mounts.dispose());
    const z = (['panel', 'modal', 'toast'] as const).map((layer) => Number(mounts.overlay(layer).host.style.zIndex));
    expect(z).toEqual([FANSLY_OVERLAY_Z.panel, FANSLY_OVERLAY_Z.modal, FANSLY_OVERLAY_Z.toast]);
    expect(z).toEqual([...z].sort((a, b) => a - b));
    for (const value of z) {
      expect(value).toBeGreaterThan(1000);
      expect(value).toBeLessThan(9999);
    }
    expect(OVERLAY_Z).toEqual({ panel: 900, modal: 950, toast: 960 });
  });
});

describe('[host:fansly] the launcher in the tab’s start (X46)', () => {
  it('[SP-001] [NF-001] drawn once the tab is admitted, on any page; a click wants the application', async () => {
    history.replaceState({}, '', '/home');
    const page = createFakeFanslyPage();
    const draw = vi.fn(drawFanslyLauncher);
    const started = startFanslyTab({ win: window, validation: loadValidation, redeem: () => Promise.resolve(false), handshakeTimeoutMs: 20, launcher: () => Promise.resolve({ drawFanslyLauncher: draw }) });
    const port = await started.host;
    cleanups.push(
      () => port.dispose(),
      () => started.mounts.dispose(),
      () => page.destroy(),
    );
    expect(await started.activation.ready).toBe(true);
    await settle();
    expect(draw).toHaveBeenCalledTimes(1);
    expect(started.wantsApp.current()).toBe(false);
    const wanted = vi.fn();
    started.wantsApp.onChange(wanted);
    const host = started.mounts.launcher();
    host.root.querySelector<HTMLButtonElement>('button[data-launcher="spenders"]')?.click();
    expect(started.wantsApp.current()).toBe(true);
    expect(wanted).toHaveBeenCalledTimes(1);
    // The application's half serves the very launcher the port carries.
    const run = vi.fn();
    port.launcher.serve(run);
    expect(run.mock.calls).toEqual([['spenders']]);
  });
});
