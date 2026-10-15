import { afterEach, describe, expect, it, vi } from 'vitest';
import { watchCoexistence, type Coexistence } from './legacy';
import { showReloadNotice } from './notice';
import { startFanslyTab } from './starter';
import { loadValidation } from './validation';
import { LEGACY_SELECTOR as MAIN_SELECTOR, RELOAD_ATTRIBUTE as MAIN_RELOAD, readFBuddy, previousMain, rememberMain } from '../main/legacy';
import { LEGACY_SELECTOR, RELOAD_ATTRIBUTE } from './legacy-markers';
import type { MainBridgeHandle } from '@cg/host-kit/main/bridge';

const watching: Coexistence[] = [];
afterEach(() => {
  watching.splice(0).forEach((watch) => watch.dispose());
  document.documentElement.removeAttribute('data-fx-instance');
  document.documentElement.removeAttribute('data-fx-reload');
  document.documentElement.replaceChildren(document.createElement('head'), document.createElement('body'));
  vi.restoreAllMocks();
});
const watch = (): Coexistence => { const result = watchCoexistence(window); watching.push(result); return result; };

describe('[NEW-12] [FS-CO-1] coexistence notices and retirement', () => {
  it('pins the dependency-free MAIN markers to the isolated markers', () => {
    expect([MAIN_SELECTOR, MAIN_RELOAD]).toEqual([LEGACY_SELECTOR, RELOAD_ATTRIBUTE]);
  });
  for (const marker of ['<div id="chatgoose-root"></div>', '<button id="chatgoose-followers-launcher"></button>', '<style id="chatgoose-bootstrap-style"></style>', '<style id="chatgoose-style"></style>']) {
    it(`recognises the old extension by ${marker}, latches after its DOM disappears and keeps foreign nodes`, () => {
      document.body.innerHTML = marker + '<fb-ui>neighbour</fb-ui><div data-host="foreign"></div>';
      const attach = vi.spyOn(Element.prototype, 'attachShadow');
      const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => undefined);
      const state = watch();
      expect(state.reason()).toBe('legacy');
      const root = attach.mock.results[0]?.value as ShadowRoot;
      expect(root.textContent).toContain('выключите старое расширение');
      root.querySelector('button')?.click();
      expect(reload).toHaveBeenCalledOnce();
      document.body.firstElementChild?.remove(); state.check();
      expect(state.reason()).toBe('legacy');
      expect(document.querySelector('fb-ui')?.textContent).toBe('neighbour');
      expect(document.querySelector('[data-host="foreign"]')).not.toBeNull();
    });
  }
  it('finds the old extension installed after us at DOMContentLoaded', () => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    const state = watch();
    document.body.innerHTML = '<div id="chatgoose-root"></div>';
    document.dispatchEvent(new Event('DOMContentLoaded'));
    expect(state.stopped.aborted).toBe(true);
  });
  it('a second isolated copy stops the first and replaces the inert notice with one live banner', async () => {
    const first = watch(); const second = watch();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect([first.reason(), second.reason()]).toEqual(['update', 'update']);
    showReloadNotice(document, 'update');
    expect(document.querySelectorAll('[data-host="reload-notice"]')).toHaveLength(1);
  });
  it('a second MAIN retires the old copy and signals the isolated side instead of wrapping its constructors again', async () => {
    const fake = Object.create(window) as Window;
    const dispose = vi.fn();
    const handle = { dispose } as unknown as MainBridgeHandle;
    const state = watch();
    rememberMain(fake, handle);
    expect(previousMain(fake)).toBe(handle);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dispose).toHaveBeenCalledOnce();
    expect(state.reason()).toBe('update');
  });
  it('old DOM before start admits no tab, clears accounts and denies every capability and fresh snapshot', async () => {
    document.body.innerHTML = '<div id="chatgoose-root"></div>';
    const started = startFanslyTab({ win: window, validation: loadValidation, handshakeTimeoutMs: 20 });
    expect(await started.activation.ready).toBe(false);
    const port = await started.host;
    expect(await started.bridge).toBeNull();
    expect(port.current()).toMatchObject({ accounts: [], identity: null, composer: null });
    expect(Object.values(port.probe().capabilities).every((value) => value.state === 'off' && value.reason === 'legacy')).toBe(true);
    expect(started.mounts.registry.hosts()).toEqual([]);
    port.dispose();
  });
  it('FBuddy markers alone never retire us; empty word data means no active filter', () => {
    document.head.innerHTML = '<script id="fbuddy-window-bridge-script"></script><style id="fb-fansly-style-fixes"></style><script id="fbuddy-restricted-words-data">  </script>';
    expect(readFBuddy(window)).toEqual({ windowBridge: true, networkHook: false, styleFixes: true, wordFilter: false });
    expect(watch().reason()).toBeNull();
  });
  it.each([
    ['{"words":[]}', false],
    ['{"words":["restricted"]}', true],
    ['[]', false],
    ['["restricted"]', true],
    ['{"words":["", "  ", null, 42]}', false],
    ['{"words":"restricted"}', false],
    ['null', false],
    ['{broken', false],
  ])('FBuddy word data %s reports only a decoded non-empty list', (data, active) => {
    const script = document.createElement('script');
    script.id = 'fbuddy-restricted-words-data';
    script.textContent = data;
    document.head.append(script);
    expect(readFBuddy(window).wordFilter).toBe(active);
    expect(script.textContent).toBe(data);
  });
});
