import { act } from 'preact/test-utils';
import { useState } from 'preact/hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SCHEME_ATTRIBUTE, type ToastsVM } from '@cg/contracts';
import {
  DISMISSIBLE_OPEN_ATTRIBUTE,
  Dialog,
  KIT_STYLE_SOURCES,
  LAYERS,
  OverlayLayer,
  ROOT_CLASS,
  SidePanel,
  ViewState,
  capturePageErrors,
  createKitEnv,
  createMountPort,
  minuteListenerCount,
  mountKitPage,
  mountKitSurface,
  useAnnounce,
  useDispatch,
  useI18n,
  useReducedMotion,
  useResultCap,
  useT,
  useKit,
  useValueSignal,
  useView,
  Age,
  attributeHolds,
} from '@cg/ui/kit';

import { entry, toast, toasts, views, cgError, type AppClientScenario } from '../scenarios/app-client';
import { type MountedKit, flush, kitWorld, mountKit, mountKitSettled } from './harness';

const mounted: MountedKit[] = [];
function track(kit: MountedKit): MountedKit {
  mounted.push(kit);
  return kit;
}

afterEach(() => {
  for (const kit of mounted.splice(0)) kit.unmount();
  document.body.replaceChildren();
  document.documentElement.removeAttribute(SCHEME_ATTRIBUTE);
});

function ToastCount() {
  const view = useView({ of: 'toasts' }).value;
  return <span data-count={view.toasts.length}>{view.toasts.map((item) => item.title).join('|')}</span>;
}

describe('[EX-012] the kit mounts a surface into the closed shadow root the host side created', () => {
  it('adopts the shared sheets, renders into one .cg-root and releases everything on Unmount', () => {
    const kit = track(mountKit(() => <p class="cg-probe">ok</p>));
    expect(kit.host.shadowRoot).toBeNull();
    expect(kit.mount.styleMode).toBe('adopted');
    expect(kit.root.adoptedStyleSheets).toHaveLength(KIT_STYLE_SOURCES.length);
    expect(kit.$(`.${ROOT_CLASS}`)?.getAttribute('data-cg-surface')).toBe('dock');
    expect(kit.$('.cg-probe')?.textContent).toBe('ok');
    expect(kit.$('[data-cg-live]')?.getAttribute('aria-live')).toBe('polite');
    expect(document.adoptedStyleSheets).toHaveLength(0);
    kit.mount.unmount();
    kit.mount.unmount();
    expect(kit.root.querySelector(`.${ROOT_CLASS}`)).toBeNull();
  });

  it('surfaces sharing one root (the overlay host): the sheets and data-scheme go with the last of them', () => {
    const world = kitWorld();
    const host = document.createElement('div');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'closed' });
    const own = new CSSStyleSheet();
    root.adoptedStyleSheets = [own];
    const panelCss = { id: 'kit-test-panel', css: '.cg-panel { color: red; }' };
    const port = createMountPort({ palette: { view: () => <p>palette</p> }, 'fan-panel': { view: () => <p>fan</p>, styles: [panelCss] } });
    const closePalette = port.mountSurface('palette', root, world.deps);
    const closePanel = port.mountSurface('fan-panel', root, world.deps);
    expect(root.adoptedStyleSheets).toHaveLength(1 + KIT_STYLE_SOURCES.length + 1);
    expect(attributeHolds(host, SCHEME_ATTRIBUTE)).toBe(2);
    closePanel();
    closePanel();
    // The palette still draws: the kit's sheets and the scheme stay; the panel's own sheet goes.
    expect(root.adoptedStyleSheets).toHaveLength(1 + KIT_STYLE_SOURCES.length);
    expect(host.getAttribute(SCHEME_ATTRIBUTE)).toBe('light');
    closePalette();
    // Only what the host side put there is left.
    expect(root.adoptedStyleSheets).toEqual([own]);
    expect(host.hasAttribute(SCHEME_ATTRIBUTE)).toBe(false);
    expect(attributeHolds(host, SCHEME_ATTRIBUTE)).toBe(0);
  });

  it('createMountPort is the UI’s MountPort: one definition per surface, an unknown one is an error', () => {
    const world = kitWorld();
    const port = createMountPort({ 'fan-panel': { view: () => <aside class="cg-panel">fan</aside>, styles: [{ id: 'panel', css: '.cg-panel { color: red; }' }] } });
    const host = document.createElement('div');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'closed' });
    const unmount = port.mountSurface('fan-panel', root, world.deps);
    expect(root.querySelector('.cg-panel')?.textContent).toBe('fan');
    expect(root.adoptedStyleSheets).toHaveLength(KIT_STYLE_SOURCES.length + 1);
    unmount();
    expect(root.querySelector('.cg-panel')).toBeNull();
    expect(() => port.mountSurface('palette', root, world.deps)).toThrow(/palette/);
  });

  it('[EX-011] an unmounted surface leaves no subscription and no timer behind', async () => {
    vi.useFakeTimers();
    try {
      const kit = track(
        await mountKitSettled(() => (
          <>
            <ToastCount />
            <Age from={Date.now() - 5 * 60_000} />
          </>
        )),
      );
      expect(minuteListenerCount()).toBe(1);
      const subscribe = vi.spyOn(kit.client, 'subscribe');
      await flush(() => kit.deps.scheme.set('dark'));
      kit.mount.unmount();
      // Preact 11 runs passive-effect cleanups of unmounted components after the next paint.
      vi.advanceTimersByTime(100);
      expect(minuteListenerCount()).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(subscribe).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('[I18-005] [I18-006] the scheme reaches every surface through data-scheme, live', () => {
  it('mirrors the resolved scheme on our host element and follows a switch without a remount', async () => {
    const kit = track(mountKit(() => <span>x</span>));
    expect(kit.host.getAttribute(SCHEME_ATTRIBUTE)).toBe('light');
    await flush(() => kit.deps.scheme.set('dark'));
    expect(kit.host.getAttribute(SCHEME_ATTRIBUTE)).toBe('dark');
    expect(kit.mount.env.scheme.value).toBe('dark');
  });

  it('extension pages get the scheme on <html>, the page font and the same sheets', async () => {
    const world = kitWorld('en-dark');
    const container = document.createElement('main');
    document.body.append(container);
    const page = mountKitPage(container, world.deps, { view: () => <h1>page</h1> }, { surface: null });
    expect(document.documentElement.getAttribute(SCHEME_ATTRIBUTE)).toBe(world.scenario.scheme);
    expect(container.classList.contains('cg-root--page')).toBe(true);
    expect(document.adoptedStyleSheets).toHaveLength(KIT_STYLE_SOURCES.length);
    await flush(() => world.deps.scheme.set('light'));
    expect(document.documentElement.getAttribute(SCHEME_ATTRIBUTE)).toBe('light');
    page.unmount();
    expect(container.classList.contains('cg-root--page')).toBe(false);
    expect(document.documentElement.hasAttribute(SCHEME_ATTRIBUTE)).toBe(false);
    expect(document.adoptedStyleSheets).toHaveLength(0);
  });
});

describe('useView: AppClient subscriptions become signals inside ui/ only', () => {
  it('reads the snapshot, re-renders on every update, and unsubscribes with the component', async () => {
    const scenario: AppClientScenario = {
      ...kitWorld().scenario,
      id: 'toasts-steps',
      views: [],
      steps: [
        {
          label: 'one toast',
          at: 1_000,
          views: [entry({ of: 'toasts' }, toasts(views.ready(), [toast(kitWorld().ctx, 't1', 'info', { title: 'Recap сохранён в хаб' })]))],
        },
      ],
    };
    const kit = track(mountKit(ToastCount, { scenario }));
    expect(kit.$('[data-count]')?.getAttribute('data-count')).toBe('0');
    await flush(() => kit.client.advance());
    expect(kit.$('[data-count]')?.textContent).toBe('Recap сохранён в хаб');
  });
});

describe('[EX-011] useView subscribes only for a committed component', () => {
  it('a render that throws after useView (caught by the boundary) leaves no subscription behind', async () => {
    const world = kitWorld();
    let live = 0;
    const subscribe = world.client.subscribe.bind(world.client);
    Object.assign(world.client, {
      subscribe: (...args: Parameters<typeof subscribe>) => {
        live += 1;
        const off = subscribe(...args);
        let done = false;
        return () => {
          if (!done) live -= 1;
          done = true;
          off();
        };
      },
    });
    function Broken(): null {
      useView({ of: 'toasts' });
      throw new TypeError('render failed');
    }
    function Fine() {
      const view = useView({ of: 'toasts' }).value;
      return <span class="cg-count">{view.toasts.length}</span>;
    }
    const host = document.createElement('div');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'closed' });
    const failures: unknown[] = [];
    let mount: ReturnType<typeof mountKitSurface> | null = null;
    await act(() => {
      mount = mountKitSurface('dock', root, world.deps, { view: Broken }, { report: (failure) => failures.push(failure) });
    });
    expect(failures).toEqual([{ kind: 'render', surface: 'dock', code: 'CG-UI-FAILED', name: 'TypeError' }]);
    expect(live).toBe(0);
    (mount as ReturnType<typeof mountKitSurface> | null)?.unmount();
    expect(live).toBe(0);
    // A component that commits subscribes once and lets go with the surface.
    let fine: ReturnType<typeof mountKitSurface> | null = null;
    await act(() => {
      fine = mountKitSurface('dock', root, world.deps, { view: Fine });
    });
    expect(live).toBe(1);
    expect(root.querySelector('.cg-count')?.textContent).toBe(String(world.client.getSnapshot({ of: 'toasts' }).toasts.length));
    (fine as ReturnType<typeof mountKitSurface> | null)?.unmount();
    expect(live).toBe(0);
  });
});

describe('port signals inside ui/', () => {
  it('useValueSignal follows a port ValueSignal and lets go with the component', async () => {
    function Width() {
      const geometry = useValueSignal(useKit().deps.geometry);
      return <span class="cg-w">{geometry.value.width ?? 'none'}</span>;
    }
    const kit = track(await mountKitSettled(Width));
    expect(kit.$('.cg-w')?.textContent).toBe('853');
    await flush(() => kit.deps.geometry.set({ width: 489, feedHeight: 574, viewportHeight: 900, container: null }));
    expect(kit.$('.cg-w')?.textContent).toBe('489');
  });
});

describe('[I18-001] RU / EN switch on the fly in kit components', () => {
  it('texts change with the language without a remount', async () => {
    function Words() {
      const t = useT();
      const i18n = useI18n();
      return (
        <span>
          {t('common.copy')} {i18n.formatMoneyMills(12_480_000)}
        </span>
      );
    }
    const kit = track(mountKit(Words, { language: 'ru' }));
    expect(kit.$('span')?.textContent).toBe('Копировать $12,480');
    await flush(() => kit.deps.i18n.setLanguage('en'));
    expect(kit.$('span')?.textContent).toBe('Copy $12,480');
  });
});

describe('[AU-018] the UI works before and without the hub', () => {
  it('a surface renders loading and offline states from a client with nothing else to give', () => {
    function States() {
      const error = cgError(kitWorld().ctx, 'CG-HUB-UNAVAILABLE');
      return (
        <>
          <ViewState view={views.loading()}>
            <p>data</p>
          </ViewState>
          <ViewState view={views.offline(error, { type: 'RecheckStatus' }, Date.now())}>
            <p class="cg-cached">cached rows</p>
          </ViewState>
        </>
      );
    }
    const kit = track(mountKit(States, { scenario: 'gallery-loading' }));
    expect(kit.$('.cg-state--loading')?.getAttribute('aria-busy')).toBe('true');
    expect(kit.$('.cg-card')?.getAttribute('data-cg-code')).toBe('CG-HUB-UNAVAILABLE');
    expect(kit.$('.cg-cached')?.textContent).toBe('cached rows');
    expect(kit.failures).toEqual([]);
  });
});

describe('[CS-005] our windows are overlays outside #app, stacked as ui-design §3.4 says', () => {
  it('layers keep their order under ChatSpace’s own dialogs', () => {
    expect(LAYERS.dockMenu).toBeLessThan(LAYERS.panel);
    expect(LAYERS.panel).toBeLessThan(LAYERS.scrim);
    expect(LAYERS.scrim).toBeLessThan(LAYERS.window);
    expect(LAYERS.window).toBeLessThan(LAYERS.toast);
    expect(LAYERS.toast).toBeLessThan(LAYERS.tooltip);
    expect(LAYERS.tooltip).toBeLessThan(1000);
  });

  it('a window stands in ChatSpace’s container box, marks our host dismissible-open, and gives focus back on close', async () => {
    let open = true;
    const close = vi.fn(() => {
      open = false;
    });
    function Window() {
      return (
        <OverlayLayer>
          <button class="cg-before">before</button>
          <Dialog open={open} label="Spenders" size="window" onClose={close}>
            <button class="cg-in">in</button>
          </Dialog>
        </OverlayLayer>
      );
    }
    const kit = track(mountKit(Window, { kind: 'spenders' }));
    await flush(() => kit.deps.geometry.set({ width: null, feedHeight: null, viewportHeight: 900, container: { left: 64, top: 44, width: 1376, height: 856 } }));
    const dialog = kit.$('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.style.left).toBe('64px');
    expect(dialog.style.top).toBe('44px');
    expect(dialog.style.width).toBe('1368px');
    expect(kit.host.hasAttribute(DISMISSIBLE_OPEN_ATTRIBUTE)).toBe(true);
    expect(kit.root.activeElement).toBe(kit.$('.cg-in'));
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('a nested confirmation closing keeps the window’s data-dismissible-open; the last one to close drops it', async () => {
    let setInner: (open: boolean) => void = () => undefined;
    let setOuter: (open: boolean) => void = () => undefined;
    function Coach() {
      const [outer, setO] = useState(true);
      const [inner, setI] = useState(true);
      setInner = setI;
      setOuter = setO;
      return (
        <OverlayLayer>
          <Dialog open={outer} label="Coach" size="window" onClose={() => setO(false)}>
            <button class="cg-in">in</button>
            <Dialog open={inner} label="Новый диалог" onClose={() => setI(false)}>
              <button class="cg-ok">ok</button>
            </Dialog>
          </Dialog>
        </OverlayLayer>
      );
    }
    const kit = track(await mountKitSettled(Coach, { kind: 'coach' }));
    expect(attributeHolds(kit.host, DISMISSIBLE_OPEN_ATTRIBUTE)).toBe(2);
    await flush(() => setInner(false));
    expect(kit.host.hasAttribute(DISMISSIBLE_OPEN_ATTRIBUTE)).toBe(true);
    await flush(() => setOuter(false));
    expect(kit.host.hasAttribute(DISMISSIBLE_OPEN_ATTRIBUTE)).toBe(false);
  });

  it('a window open in one surface keeps the mark when another surface of the same host unmounts', async () => {
    const world = kitWorld();
    const host = document.createElement('div');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'closed' });
    const port = createMountPort({
      spenders: { view: () => <Dialog open label="Spenders" size="window" onClose={() => undefined}><button>x</button></Dialog> },
      palette: { view: () => <Dialog open label="Палитра" onClose={() => undefined}><input /></Dialog> },
    });
    let closeSpenders: () => void = () => undefined;
    let closePalette: () => void = () => undefined;
    await flush(() => {
      closeSpenders = port.mountSurface('spenders', root, world.deps);
      closePalette = port.mountSurface('palette', root, world.deps);
    });
    expect(attributeHolds(host, DISMISSIBLE_OPEN_ATTRIBUTE)).toBe(2);
    await flush(() => closePalette());
    expect(host.hasAttribute(DISMISSIBLE_OPEN_ATTRIBUTE)).toBe(true);
    await flush(() => closeSpenders());
    expect(host.hasAttribute(DISMISSIBLE_OPEN_ATTRIBUTE)).toBe(false);
  });

  it('a side panel stands at the right edge of the container and closes on Esc with focus going back', async () => {
    const restore = vi.fn(() => true);
    const close = vi.fn();
    const kit = track(
      mountKit(() => (
        <SidePanel label="Панель фана" onClose={close}>
          <button class="cg-in">x</button>
        </SidePanel>
      )),
    );
    Object.assign(kit.deps.focus, { restore });
    await flush(() => kit.deps.geometry.set({ width: null, feedHeight: null, viewportHeight: 900, container: { left: 64, top: 44, width: 1376, height: 856 } }));
    const panel = kit.$('[role="complementary"]') as HTMLElement;
    expect(panel.style.left).toBe(`${64 + 1376 - 320}px`);
    (kit.$('.cg-in') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(close).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledTimes(1);
  });
});

describe('result height limit (ui-design §3.2, owner’s ruling)', () => {
  it('writes --cg-cap from the MountPort geometry for both result styles', async () => {
    function Cap({ style }: { readonly style: 'bare' | 'sheet' }) {
      const cap = useResultCap(style);
      return <div class="cg-cap" style={cap.style} data-cap={cap.cap} />;
    }
    const kit = track(mountKit(() => <Cap style="sheet" />));
    await flush(() => kit.deps.geometry.set({ width: 693, feedHeight: 474, viewportHeight: 800, container: null }));
    expect(kit.$('.cg-cap')?.getAttribute('data-cap')).toBe('312');
    expect(kit.$('.cg-cap')?.style.getPropertyValue('--cg-cap')).toBe('312px');
  });
});

describe('[ER-022] a failed call to the background is reported, never thrown into a click', () => {
  it('a rejected dispatch resolves to null and reports its class name only', async () => {
    let result: unknown = 'pending';
    function Broken() {
      const dispatch = useDispatch();
      return (
        <button
          class="cg-go"
          onClick={() => {
            // A raw persona key breaks the contract: the fake rejects it with ContractViolation.
            void dispatch({ type: 'Copy', artifactHandle: 'a', persona: 'raw' } as never).then((receipt) => {
              result = receipt;
            });
          }}
        >
          go
        </button>
      );
    }
    const kit = track(mountKit(Broken));
    await act(async () => {
      kit.$('.cg-go')?.click();
      await Promise.resolve();
    });
    expect(result).toBeNull();
    expect(kit.failures).toEqual([{ kind: 'dispatch', surface: 'dock', code: 'CG-UI-FAILED', name: 'ContractViolation' }]);
    expect(JSON.stringify(kit.failures)).not.toContain('raw');
  });
});

describe('[ER-021] our extension pages report uncaught errors and rejections', () => {
  it('reports the class name only, and lets go on release', () => {
    const report = vi.fn();
    const release = capturePageErrors(window, report, 'options');
    window.dispatchEvent(new ErrorEvent('error', { error: new TypeError('secret draft text') }));
    const rejection = new Event('unhandledrejection') as Event & { reason?: unknown };
    rejection.reason = new RangeError('another secret');
    window.dispatchEvent(rejection);
    window.dispatchEvent(new ErrorEvent('error', {}));
    expect(report.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      { kind: 'page', surface: 'options', code: 'CG-UI-FAILED', name: 'TypeError' },
      { kind: 'page', surface: 'options', code: 'CG-UI-FAILED', name: 'RangeError' },
      { kind: 'page', surface: 'options', code: 'CG-UI-FAILED', name: 'null' },
    ]);
    expect(JSON.stringify(report.mock.calls)).not.toContain('secret');
    release();
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('x') }));
    expect(report).toHaveBeenCalledTimes(3);
  });
});

describe('the root’s services', () => {
  it('announces through one polite live region, a repeated phrase again', async () => {
    let say: (text: string) => void = () => undefined;
    function Speaker() {
      say = useAnnounce();
      return null;
    }
    const kit = track(mountKit(Speaker));
    const live = kit.$('[data-cg-live]') as HTMLElement;
    await flush(() => say('Вставлено'));
    const first = live.firstElementChild;
    expect(live.textContent).toBe('Вставлено');
    await flush(() => say('Вставлено'));
    expect(live.firstElementChild).not.toBe(first);
    await flush(() => say(''));
    expect(live.textContent).toBe('Вставлено');
  });

  it('follows prefers-reduced-motion live', async () => {
    const listeners = new Set<() => void>();
    const query = { matches: false, addEventListener: (_: string, l: () => void) => listeners.add(l), removeEventListener: (_: string, l: () => void) => listeners.delete(l) };
    const matchMedia = vi.spyOn(window, 'matchMedia').mockReturnValue(query as unknown as MediaQueryList);
    function Motion() {
      return <span class="cg-m">{useReducedMotion() ? 'still' : 'moving'}</span>;
    }
    const kit = track(mountKit(Motion));
    expect(kit.$('.cg-m')?.textContent).toBe('moving');
    query.matches = true;
    await flush(() => {
      for (const listener of listeners) listener();
    });
    expect(kit.$('.cg-m')?.textContent).toBe('still');
    kit.mount.unmount();
    expect(listeners.size).toBe(0);
    matchMedia.mockRestore();
  });

  it('an env without a window still works (no matchMedia)', () => {
    const world = kitWorld();
    const fragment = document.createDocumentFragment() as unknown as ShadowRoot;
    Object.defineProperty(fragment, 'ownerDocument', { value: { defaultView: null } });
    const env = createKitEnv({ deps: world.deps, root: fragment, host: null });
    expect(env.reducedMotion.value).toBe(false);
    env.announce('x');
    expect(env.announcement.value.text).toBe('x');
    env.dispose();
  });

  it('the toasts view selector works through useView (types follow the selector)', () => {
    const vm: ToastsVM = kitWorld('hub-down').client.getSnapshot({ of: 'toasts' });
    expect(vm.toasts[0]?.code).toBe('CG-HUB-UNAVAILABLE');
  });
});
