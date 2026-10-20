// Fansly's side of the early hotkey dispatcher (docs/project-unite/
// architecture.md §7.9, §9.1; FS-HK-1). The probe itself — where the focus
// is, the hand-over of a key to our own UI as a copy that cannot leave our
// closed root, the mark of a waiting key — is the shared mechanics of the
// page (@cg/host-kit/isolated/keyboard.ts). What is Fansly's own stands here
// (R20 P7i):
// - its message field: `textarea.message-input` under the conversation's
//   route — the open chat's composer (its chain or a stray field the dock
//   covers with an overlay, FS-PLC-3), never the mini-chat's, which repeats
//   the classes outside the route (§7.3: anchors only through the route).
//   Our keys work there as in ChatSpace's field, and Enter stays the page's:
//   it is not a key of ours, so the dispatcher never touches it;
// - a window of its own: while a modal of Fansly is open (`body.modal-opened`,
//   an O(1) read — Fansly sets it for as long as any modal stands) or the
//   focus is inside one of the neighbour's hosts (`fb-<feature>-ui`, FBuddy's
//   shadow-root UI: its panel, its notes, its toasts), Esc and plain letters
//   are that window's. A combination of ours still runs over it, as in the old
//   Fansly extension (the adapter's lenient `keyRules`; ⌘↵ excepted) — the window
//   is not ours to close, so «закройте окно» would be no answer. FBuddy's
//   roots are open but its own: we never read inside them — the focus behind
//   a host is enough, as `document.activeElement` names the outermost host;
// - but a window of ours stands over Fansly's modals (FS-PLC-6, X46): while
//   the focus is inside one of our overlay hosts — a panel, a window — the
//   keys are that window's, as if no modal of Fansly's stood under it (its
//   Esc closes it, its keys run). The dock and the launcher stay under the
//   modal: focus there yields as before.
// The route by the address is route.ts's (P7c).

import { HOST_ATTRIBUTE, LAYER_ATTRIBUTE } from '@cg/host-kit/isolated/hosts';
import { createKeyboardProbe as createProbe, type KeyboardProbe } from '@cg/host-kit/isolated/keyboard';
import type { ShadowRootRegistry } from '@cg/host-kit/isolated/shadow-registry';

import { FANSLY_SELECTORS } from './anchors';
import { LAUNCHER_LAYER } from './mount';

/** A host of FBuddy's UI (S5 §2.5): `fb-<feature>-ui`, a custom element with its own shadow root. */
export const NEIGHBOR_HOST = /^fb-[a-z0-9-]+-ui$/;

/** Fansly's message field: the field of the conversation under the route, its chain or not; the mini-chat's is another field. */
export function isFanslyComposer(active: Element): boolean {
  return active.matches(FANSLY_SELECTORS.textarea) && active.closest(FANSLY_SELECTORS.conversationRoute) !== null;
}

/** The focus is inside one of FBuddy's hosts: the active element is one, or stands in one (a slotted node). */
export function focusInNeighbor(doc: Document): boolean {
  for (let node: Element | null = doc.activeElement; node !== null && node !== doc.body && node !== doc.documentElement; node = node.parentElement) {
    if (NEIGHBOR_HOST.test(node.localName)) return true;
  }
  return false;
}

/** A window of Fansly's own is open (`body.modal-opened`), or the focus is in FBuddy's: Esc and plain letters are its (FS-HK-1). */
export function fanslyWindowOpen(doc: Document): boolean {
  return doc.body?.classList.contains(FANSLY_SELECTORS.modalFlag) === true || focusInNeighbor(doc);
}

/**
 * The focus is inside one of our windows over Fansly's modals (X46): an overlay host of ours — not the launcher, which
 * stands under them — whose closed root holds it. `document.activeElement` names the host: an O(1) read.
 */
export function focusInOurWindow(doc: Document, registry: ShadowRootRegistry): boolean {
  const active = doc.activeElement;
  if (active === null || active.getAttribute(HOST_ATTRIBUTE) !== 'overlay' || active.getAttribute(LAYER_ATTRIBUTE) === LAUNCHER_LAYER) return false;
  const focused = registry.rootOf(active)?.activeElement;
  return focused !== null && focused !== undefined;
}

/** The shared probe with Fansly's rules: its message field; a window of its own or of the neighbour's — unless ours is over it. */
export const createKeyboardProbe = (doc: Document, registry: ShadowRootRegistry): KeyboardProbe =>
  createProbe(doc, registry, isFanslyComposer, () => fanslyWindowOpen(doc) && !focusInOurWindow(doc, registry));
