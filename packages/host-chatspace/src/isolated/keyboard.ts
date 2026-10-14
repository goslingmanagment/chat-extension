// ChatSpace's side of the early hotkey dispatcher (architecture.md §9.1 «Кому
// принадлежит клавиша», D-18). The probe itself — where the focus is, the
// hand-over of a key to our own UI as a copy that cannot leave our closed
// root, the mark of a waiting key — is the shared mechanics of the page
// (@cg/host-kit/isolated/keyboard.ts). What is ChatSpace's own stands here:
// which field is its message field, when a window of its own is open, and
// `routeOfLocation`, the dispatcher's route until MAIN reports one.

import { createKeyboardProbe as createProbe, type KeyboardProbe } from '@cg/host-kit/isolated/keyboard';
import type { ShadowRootRegistry } from '@cg/host-kit/isolated/shadow-registry';

import { EDITOR_SELECTOR, FRAME_SELECTOR } from './host-contract';

/**
 * What ChatSpace's own Esc rule treats as «something of ours is open»
 * (MainLayout `lastResort`, client-internals §5.1), minus the attribute we
 * set ourselves: PrimeVue renders these only while an overlay is open.
 */
export const NATIVE_OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]';

/** `/accounts/:accountId/chats/:chatId?` — ChatSpace's `chat` route (§6.1). */
export const CHAT_PATH_PATTERN = /^\/accounts\/([1-9]\d{0,29})\/chats(?:\/([1-9]\d{0,29}))?\/?$/;

/**
 * The route by the address alone, for the first moments of a document: MAIN
 * has not reported yet, but a key pressed in an open chat is already ours.
 * `epoch` is the path: a key kept for the lazy part runs only on the same one.
 */
export function routeOfLocation(location: Pick<Location, 'pathname'>): { readonly kind: 'chat' | 'account' | 'other'; readonly epoch: string } {
  const match = CHAT_PATH_PATTERN.exec(location.pathname);
  return { kind: match === null ? 'other' : match[2] === undefined ? 'account' : 'chat', epoch: location.pathname };
}

/** The shared probe with ChatSpace's two rules: its message field, and a dialog, menu or list of its own that is open and visible. */
export const createKeyboardProbe = (doc: Document, registry: ShadowRootRegistry): KeyboardProbe =>
  createProbe(
    doc,
    registry,
    // ChatSpace's message field: the Tiptap surface, or anything editable inside the composer frame.
    (active) => active.closest(EDITOR_SELECTOR) !== null || active.closest(FRAME_SELECTOR) !== null,
    () => {
      for (const element of doc.querySelectorAll(NATIVE_OVERLAY_SELECTOR)) {
        if (typeof element.checkVisibility !== 'function' || element.checkVisibility()) return true;
      }
      return false;
    },
  );
