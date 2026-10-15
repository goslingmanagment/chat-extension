// FS-CO-1: the old tap's Symbol survives disabling its extension. Its DOM
// alone is sufficient too. A positive observation is latched until reload.
import { faultCounter, guardWith } from '@cg/host-kit/main/guard';
import type { MainBridgeHandle } from '@cg/host-kit/main/bridge';
// The MAIN bundle cannot import the isolated world. Pinned to its literals by legacy.dom.test.ts.
export const LEGACY_SELECTOR = '#chatgoose-root, #chatgoose-followers-launcher, style#chatgoose-bootstrap-style, style#chatgoose-style';
export const RELOAD_ATTRIBUTE = 'data-fx-reload';
const hasLegacyDom = (doc: Document): boolean => doc.querySelector(LEGACY_SELECTOR) !== null;

export const MAIN_INSTANCE = 'fxRuntime';
export const hasLegacy = (win: Window): boolean => Boolean(Reflect.get(win, Symbol.for('chatgoose.socketTap'))) || hasLegacyDom(win.document);

/** Diagnostics only: never copy the hook, its answers or its restricted words. */
export function readFBuddy(win: Window): { windowBridge: boolean; networkHook: boolean; styleFixes: boolean; wordFilter: boolean } {
  const doc = win.document;
  return {
    windowBridge: doc.querySelector('script#fbuddy-window-bridge-script') !== null,
    networkHook: Boolean(Reflect.get(win, '__FBUDDY_NETWORK_HOOK__')),
    styleFixes: doc.querySelector('style#fb-fansly-style-fixes') !== null,
    wordFilter: Boolean(doc.querySelector('script#fbuddy-restricted-words-data')?.textContent?.trim()),
  };
}

/** A second copy cannot adopt the first copy's one-use bridge or missed socket. */
export function previousMain(win: Window): MainBridgeHandle | null {
  const previous = Reflect.get(win, Symbol.for(MAIN_INSTANCE)) as MainBridgeHandle | undefined;
  if (!previous) return null;
  previous.dispose();
  // The previous bridge is closed: failures stay local, never escape into the page.
  const guard = guardWith(faultCounter(() => undefined));
  const mark = guard('oldCopy', () => { win.document.documentElement?.setAttribute(RELOAD_ATTRIBUTE, 'update'); });
  mark();
  if (!win.document.documentElement) win.document.addEventListener('DOMContentLoaded', mark, { once: true });
  return previous;
}

export function rememberMain(win: Window, handle: MainBridgeHandle): void {
  Object.defineProperty(win, Symbol.for(MAIN_INSTANCE), { value: handle });
}
