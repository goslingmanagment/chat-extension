// FS-CO-1: the old tap's Symbol survives disabling its extension. Its DOM
// alone is sufficient too. A positive observation is latched until reload.
import { faultCounter, guardWith } from '@cg/host-kit/main/guard';
import type { MainBridgeHandle } from '@cg/host-kit/main/bridge';
// The MAIN bundle cannot import the isolated world: these literals must match isolated/legacy-markers.ts.
export const LEGACY_SELECTOR = '#chatgoose-root, #chatgoose-followers-launcher, style#chatgoose-bootstrap-style, style#chatgoose-style';
export const RELOAD_ATTRIBUTE = 'data-fx-reload';
// Looked at on every XHR and bridge request: one selector each takes Gecko's id-table path, a list walks the page.
const LEGACY_SELECTORS = LEGACY_SELECTOR.split(', ');
const hasLegacyDom = (doc: Document): boolean => LEGACY_SELECTORS.some((selector) => doc.querySelector(selector) !== null);

export const MAIN_INSTANCE = 'fxRuntime';
export const hasLegacy = (win: Window): boolean => Boolean(Reflect.get(win, Symbol.for('chatgoose.socketTap'))) || hasLegacyDom(win.document);

/** The last word list read and its answer: read on every XHR and bridge request, parsed again only when it changed. */
let lastWords: { text: string; present: boolean } | null = null;

function hasRestrictedWords(doc: Document): boolean {
  const text = doc.querySelector('script#fbuddy-restricted-words-data')?.textContent ?? '';
  if (lastWords?.text === text) return lastWords.present;
  let present: boolean;
  try {
    const data: unknown = JSON.parse(text);
    const words: unknown = Array.isArray(data) ? data : typeof data === 'object' && data !== null && 'words' in data ? data.words : null;
    present = Array.isArray(words) && words.some((word: unknown) => typeof word === 'string' && word.trim() !== '');
  } catch {
    present = false;
  }
  lastWords = { text, present };
  return present;
}

/** Diagnostics only: never copy the hook, its answers or its restricted words. */
export function readFBuddy(win: Window): { windowBridge: boolean; networkHook: boolean; styleFixes: boolean; wordFilter: boolean } {
  const doc = win.document;
  return {
    windowBridge: doc.querySelector('script#fbuddy-window-bridge-script') !== null,
    networkHook: Boolean(Reflect.get(win, '__FBUDDY_NETWORK_HOOK__')),
    styleFixes: doc.querySelector('style#fb-fansly-style-fixes') !== null,
    wordFilter: hasRestrictedWords(doc),
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
